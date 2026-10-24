// Generates small fixture files for import tests (nothing is checked in; files are created in a temp dir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const GAME_MODEL = (n) => path.join(ROOT, 'saint-marrow/assets/models', n + '.glb');
export const GAME_TEX = (n) => path.join(ROOT, 'saint-marrow/assets/tex', n + '.webp');

export function tmpDir(prefix = 'smstudio-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

export function makeWav(file, { seconds = 0.5, freq = 440, rate = 22050, channels = 1 } = {}) {
  const n = Math.floor(seconds * rate), data = Buffer.alloc(n * 2 * channels);
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000), (i * channels + c) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2 * channels, 28); h.writeUInt16LE(2 * channels, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
export function makePng(file, w = 8, h = 8, rgb = [200, 60, 40]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1] * ((x + y) % 2 ? 1 : 0.5); raw[o + 2] = rgb[2]; } }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}

/** A one-triangle glTF 2.0 file with an embedded buffer and ONE external texture reference. */
export function makeGltf(dir, { texture = 'tri.png', withTexture = true } = {}) {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), uv = new Float32Array([0, 0, 1, 0, 0, 1]);
  const buf = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(uv.buffer)]);
  const gltf = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Tri' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ name: 'TriMat', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }], images: [{ uri: texture }],
    buffers: [{ byteLength: buf.length, uri: 'data:application/octet-stream;base64,' + buf.toString('base64') }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
  };
  const f = path.join(dir, 'tri.gltf');
  fs.writeFileSync(f, JSON.stringify(gltf));
  if (withTexture) makePng(path.join(dir, texture));
  return f;
}

/** A glTF 2.0 file with one triangle and one animation clip per entry of `clips` ({name: seconds}). Everything is embedded. */
export function makeAnimatedGltf(dir, clips = { Idle: 1, Fire: 0.1, Reload: 2 }, name = 'animated.gltf') {
  const parts = [Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer)];
  const bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: 36 }];
  const accessors = [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }];
  const animations = []; let off = 36;
  for (const [clip, dur] of Object.entries(clips)) {
    parts.push(Buffer.from(new Float32Array([0, dur]).buffer), Buffer.from(new Float32Array([0, 0, 0, 0, 0.1, 0]).buffer));
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: 8 }, { buffer: 0, byteOffset: off + 8, byteLength: 24 });
    const a = accessors.length;
    accessors.push({ bufferView: bufferViews.length - 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [dur] }, { bufferView: bufferViews.length - 1, componentType: 5126, count: 2, type: 'VEC3' });
    animations.push({ name: clip, samplers: [{ input: a, output: a + 1, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] });
    off += 32;
  }
  const buf = Buffer.concat(parts);
  const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Gun' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: buf.length, uri: 'data:application/octet-stream;base64,' + buf.toString('base64') }], bufferViews, accessors, animations };
  const f = path.join(dir, name);
  fs.writeFileSync(f, JSON.stringify(gltf));
  return f;
}

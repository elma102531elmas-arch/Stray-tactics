// Loads the embedded CC0 assets (see assets/CREDITS.md): photo-scanned PBR
// textures, glTF models (meshopt compressed) and recorded sound effects.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as R from './registry.js';

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const models = R.models || {}, tex = R.tex || {}, sfx = R.sfx || {};
export const hasModel = (n) => !!models[n];
export const hasTex = (n) => !!tex[n + '_diff'];
export const sfxNames = () => Object.keys(sfx);
export const texNames = () => Object.keys(tex).filter((k) => k.endsWith('_diff')).map((k) => k.slice(0, -5));

async function bytes(url) { const r = await fetch(url); return r.arrayBuffer(); }

// ---------------------------------------------------------------- models
const gltfCache = new Map();
export function loadGLTF(name) {
  if (!models[name]) return Promise.reject(new Error('no model ' + name));
  if (!gltfCache.has(name)) {
    gltfCache.set(name, bytes(models[name]).then((buf) => gltfLoader.parseAsync(buf, '')).then((g) => {
      g.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) { if (m.map) m.map.anisotropy = 8; }
        }
      });
      return g;
    }));
  }
  return gltfCache.get(name);
}
// independent copy (skinned meshes get their own skeleton)
export async function instanceModel(name) {
  const g = await loadGLTF(name);
  return { scene: cloneSkinned(g.scene), animations: g.animations };
}

// ---------------------------------------------------------------- textures
const imgCache = new Map();
function loadImage(url) {
  if (!imgCache.has(url)) {
    imgCache.set(url, new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = rej; im.src = url; }));
  }
  return imgCache.get(url);
}
function resizeImage(im, size) {
  if (!size || (im.width <= size && im.height <= size)) return im;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, size, size);
  return c;
}
const texCache = new Map();
// map: 'diff' | 'nor' | 'arm'
export async function loadTexture(name, map, opts = {}) {
  const key = name + '_' + map;
  const url = tex[key];
  if (!url) return null;
  const ck = key + '@' + (opts.size || 0);
  if (texCache.has(ck)) return texCache.get(ck);
  const p = loadImage(url).then((im) => {
    const t = new THREE.Texture(resizeImage(im, opts.size));
    t.colorSpace = map === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = opts.aniso || 8;
    t.needsUpdate = true;
    return t;
  });
  texCache.set(ck, p);
  return p;
}
// average luminance of a texture (for anti-tiling macro variation)
const avgCache = new Map();
export async function textureAverage(name) {
  if (avgCache.has(name)) return avgCache.get(name);
  const im = await loadImage(tex[name + '_diff']);
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0, 8, 8);
  const d = x.getImageData(0, 0, 8, 8).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
  const v = s / 64; avgCache.set(name, v); return v;
}
export const texURL = (name, map = 'diff') => tex[name + '_' + map];

// ---------------------------------------------------------------- sounds
export async function decodeSfx(ctx) {
  const out = {};
  await Promise.all(Object.entries(sfx).map(async ([name, url]) => {
    try { out[name] = await ctx.decodeAudioData(await bytes(url)); } catch (e) { console.warn('sfx decode failed', name, e); }
  }));
  return out;
}

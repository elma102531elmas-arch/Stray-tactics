import test from 'node:test';
import assert from 'node:assert/strict';
import { planImport, inspectGlb, gltfExtensionSupport, resolvePath, extOf, kindOfExt, gltfDependencies, objDependencies, mtlDependencies, classifyForDisplay } from '../../js/assets/classify.js';

function glb(json, { truncate = 0, version = 2, magic = 0x46546c67 } = {}) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  const jsonLen = text.length + pad;
  const total = 12 + 8 + jsonLen;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, magic, true); dv.setUint32(4, version, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  buf.set(text, 20); buf.fill(0x20, 20 + text.length);
  return truncate ? buf.slice(0, total - truncate) : buf;
}
const F = (path, size = 100) => ({ path, size });

test('GLB inspection accepts valid files and explains every kind of damage', () => {
  assert.equal(inspectGlb(glb({ asset: { version: '2.0' } })).ok, true);
  assert.match(inspectGlb(glb({ a: 1 }, { truncate: 8 })).error, /truncated/);
  assert.match(inspectGlb(glb({ a: 1 }, { magic: 0x12345678 })).error, /header is missing/);
  assert.match(inspectGlb(glb({ a: 1 }, { version: 1 })).error, /Unsupported glTF version 1/);
  assert.match(inspectGlb(new Uint8Array(4)).error, /too small/);
});

test('glTF extension support lists what the viewer cannot decode', () => {
  const r = gltfExtensionSupport({ extensionsRequired: ['KHR_draco_mesh_compression', 'MSFT_fancy_thing'] });
  assert.deepEqual(r.unsupported, ['MSFT_fancy_thing']);
});

test('path resolution handles ./ ../ encoded names and absolute urls', () => {
  assert.equal(resolvePath('models/a', '../tex/wood.png'), 'models/tex/wood.png');
  assert.equal(resolvePath('models', './x.bin'), 'models/x.bin');
  assert.equal(resolvePath('m', 'my%20file.png'), 'm/my file.png');
  assert.equal(resolvePath('m', 'https://example.com/x.png'), 'https://example.com/x.png');
});

test('dependency discovery: glTF, OBJ, MTL', () => {
  assert.deepEqual(gltfDependencies({ buffers: [{ uri: 'a.bin' }, { uri: 'data:application/octet-stream;base64,AAA' }], images: [{ uri: 'tex/b.png' }] }, 'dir/m.gltf').map((d) => d.path), ['dir/a.bin', 'dir/tex/b.png']);
  assert.deepEqual(objDependencies('mtllib chair.mtl\nv 0 0 0', 'o/chair.obj').map((d) => d.path), ['o/chair.mtl']);
  assert.deepEqual(mtlDependencies('newmtl a\nmap_Kd wood.jpg\nmap_Bump -bm 1.0 n.png\n', 'o/chair.mtl').map((d) => d.path), ['o/wood.jpg', 'o/n.png']);
});

test('plan: glTF + bin + texture become ONE model asset', async () => {
  const gltf = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'lamp.bin' }], images: [{ uri: 'lamp.png' }] });
  const plan = await planImport([F('lamp/lamp.gltf'), F('lamp/lamp.bin'), F('lamp/lamp.png'), F('sfx/door.wav')], async () => gltf);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.items.length, 2);
  const model = plan.items.find((i) => i.kind === 'model');
  assert.deepEqual(model.files.sort(), ['lamp/lamp.bin', 'lamp/lamp.gltf', 'lamp/lamp.png']);
  assert.equal(plan.items.find((i) => i.kind === 'audio').path, 'sfx/door.wav');
});

test('plan: OBJ + MTL + texture grouped; missing texture is a warning, not a crash', async () => {
  const texts = { 'c.obj': 'mtllib c.mtl\nv 0 0 0', 'c.mtl': 'newmtl m\nmap_Kd wood.jpg\nmap_Bump nrm.png' };
  const plan = await planImport([F('c.obj'), F('c.mtl'), F('wood.jpg')], async (p) => texts[p]);
  assert.equal(plan.items.length, 1);
  assert.deepEqual(plan.items[0].files.sort(), ['c.mtl', 'c.obj', 'wood.jpg']);
  assert.ok(plan.warnings.some((w) => /nrm\.png/.test(w.message)));
});

test('plan: glTF with a missing buffer warns with advice', async () => {
  const plan = await planImport([F('a.gltf')], async () => JSON.stringify({ buffers: [{ uri: 'a.bin' }] }));
  assert.ok(plan.warnings.some((w) => /was not included/.test(w.message) && /folder/.test(w.message)));
});

test('plan: unsupported formats give specific, actionable errors', async () => {
  const plan = await planImport([F('x.blend'), F('y.max'), F('z.xyz'), F('doc.pdf')], async () => '');
  assert.equal(plan.items.length, 0);
  assert.equal(plan.errors.length, 4);
  assert.match(plan.errors.find((e) => e.path === 'x.blend').message, /Blender/i);
  assert.match(plan.errors.find((e) => e.path === 'z.xyz').message, /Unsupported file type/);
});

test('plan: invalid glTF JSON is reported per file and the rest still imports', async () => {
  const plan = await planImport([F('bad.gltf'), F('ok.png')], async () => '{ nope');
  assert.equal(plan.errors.length, 1); assert.match(plan.errors[0].message, /not valid glTF JSON/);
  assert.equal(plan.items.length, 1);
});

test('plan: stray .bin / .mtl files are warnings', async () => {
  const plan = await planImport([F('orphan.bin'), F('orphan.mtl')], async () => '');
  assert.equal(plan.items.length, 0); assert.equal(plan.warnings.length, 2);
});

test('kinds and display grouping', () => {
  assert.equal(kindOfExt('ktx2'), 'image'); assert.equal(kindOfExt('fbx'), 'model'); assert.equal(kindOfExt('mp3'), 'audio'); assert.equal(kindOfExt('exe'), null);
  assert.equal(extOf('A/B.TXT'), 'txt');
  const g = classifyForDisplay([{ path: 'a.glb' }, { path: 'b.png' }, { path: 'c.exe' }]);
  assert.deepEqual(Object.keys(g).sort(), ['Models', 'Other (will be ignored unless referenced)', 'Textures'].sort());
});

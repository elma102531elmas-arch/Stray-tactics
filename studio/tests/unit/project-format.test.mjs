import test from 'node:test';
import assert from 'node:assert/strict';
import { Project, FORMAT, FORMAT_VERSION, migrate, referencedAssets } from '../../js/core/project.js';
import { makeNode } from '../../js/core/scene.js';
import { exportBundle, importBundle, projectToJSON, projectFromJSON } from '../../js/store/bundle.js';
import { MemoryStorage } from '../../js/store/storage.js';
import { zipSync, strToU8 } from '../../lib/fflate.module.js';
import { sha256Hex } from '../../js/core/util.js';

function sample() {
  const p = new Project('Sample');
  p.scene.insert(makeNode('wall', { name: 'W', props: { length: 7 } }));
  p.scene.insert(makeNode('model', { name: 'M', props: { asset: 'user_asset_1' } }));
  p.data.materials.mat_x = { name: 'X', color: '#123456' };
  return p;
}

test('save -> reload gives an identical project', () => {
  const p = sample();
  const text = projectToJSON(p);
  const q = projectFromJSON(text);
  const strip = (t) => { const j = JSON.parse(t); delete j.meta.modified; return j; };
  assert.deepEqual(strip(projectToJSON(q)), strip(text));
  assert.equal(q.scene.byName('W').props.length, 7);
  assert.equal(q.data.materials.mat_x.color, '#123456');
});

test('files carry format + version', () => {
  const j = sample().toJSON();
  assert.equal(j.format, FORMAT); assert.equal(j.version, FORMAT_VERSION);
});

test('migration: an unversioned prototype file (sceneNodes) opens', () => {
  const old = { meta: { name: 'Old' }, sceneNodes: [{ id: 'a', name: 'Old wall', type: 'wall', parent: 'root', t: { p: [1, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, props: {} }] };
  const m = migrate(old);
  assert.equal(m.version, FORMAT_VERSION);
  const p = Project.fromJSON(old);
  assert.equal(p.scene.byName('Old wall').t.p[0], 1);
});

test('files from a NEWER studio are refused with a clear message', () => {
  assert.throws(() => migrate({ format: FORMAT, version: FORMAT_VERSION + 1, scene: { nodes: [] } }), /newer Studio/);
});

test('garbage files give readable errors, never a crash', () => {
  assert.throws(() => migrate(null), /not a Saint Marrow Studio project/);
  assert.throws(() => migrate({ format: 'something-else' }), /Unrecognised file format/);
  assert.throws(() => migrate({ format: FORMAT, version: 1 }), /no scene data/);
  assert.throws(() => projectFromJSON('{ not json'), /not valid JSON/);
});

test('referencedAssets finds assets used by nodes and materials', () => {
  const p = sample();
  p.data.materials.mat_x.map = 'user_tex';
  const refs = referencedAssets(p);
  assert.ok(refs.has('user_asset_1')); assert.ok(refs.has('user_tex'));
});

test('bundle export/import round trip keeps assets byte-for-byte', async () => {
  const st = new MemoryStorage();
  const p = sample();
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251]);
  const hash = await sha256Hex(bytes);
  p.data.assets.user_asset_1 = { id: 'user_asset_1', name: 'thing', kind: 'model', path: 'thing.glb', files: ['thing.glb'], hash };
  await st.putBlob(`${p.meta.id}/user_asset_1/thing.glb`, new Blob([bytes]));
  const { blob, missing } = await exportBundle(p, st);
  assert.deepEqual(missing, []);
  const st2 = new MemoryStorage();
  const { project, warnings, assetFilesStored } = await importBundle(blob, st2);
  assert.deepEqual(warnings, []);
  assert.equal(assetFilesStored, 1);
  assert.equal(project.meta.id, p.meta.id);
  const back = new Uint8Array(await (await st2.getBlob(`${project.meta.id}/user_asset_1/thing.glb`)).arrayBuffer());
  assert.deepEqual([...back], [...bytes]);
});

test('bundle with a tampered asset is reported, not silently accepted', async () => {
  const st = new MemoryStorage();
  const p = sample();
  p.data.assets.user_asset_1 = { id: 'user_asset_1', name: 'thing', kind: 'model', path: 'thing.glb', files: ['thing.glb'], hash: 'deadbeef' };
  await st.putBlob(`${p.meta.id}/user_asset_1/thing.glb`, new Blob([new Uint8Array([9, 9, 9])]));
  const { blob } = await exportBundle(p, st);
  const { warnings } = await importBundle(blob, new MemoryStorage());
  assert.ok(warnings.some((w) => /checksum/.test(w)), warnings.join('|'));
});

test('bundle with missing asset files exports with a "missing" list', async () => {
  const p = sample();
  p.data.assets.user_asset_1 = { id: 'user_asset_1', name: 'thing', kind: 'model', path: 'thing.glb', files: ['thing.glb'] };
  const { missing } = await exportBundle(p, new MemoryStorage());
  assert.equal(missing.length, 1);
});

test('non-zip / zip without project.json / unsafe paths are handled', async () => {
  await assert.rejects(importBundle(new Uint8Array([1, 2, 3, 4]), new MemoryStorage()), /not a valid Saint Marrow bundle/);
  const noProject = zipSync({ 'readme.txt': strToU8('hi') });
  await assert.rejects(importBundle(noProject, new MemoryStorage()), /no project.json/);
  const p = sample();
  const evil = zipSync({ 'project.json': strToU8(projectToJSON(p)), 'assets/../../evil.txt': strToU8('x') });
  const st = new MemoryStorage();
  const { warnings } = await importBundle(evil, st);
  assert.ok(warnings.some((w) => /unsafe/.test(w)));
  assert.equal((await st.listBlobKeys('')).length, 0);
});

test('a bundle from a newer bundle version is refused', async () => {
  const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify({ version: 99 })), 'project.json': strToU8(projectToJSON(sample())) });
  await assert.rejects(importBundle(zip, new MemoryStorage()), /newer Studio/);
});

test('plain JSON project files are accepted by importBundle', async () => {
  const { project } = await importBundle(new TextEncoder().encode(projectToJSON(sample())), new MemoryStorage());
  assert.equal(project.meta.name, 'Sample');
});

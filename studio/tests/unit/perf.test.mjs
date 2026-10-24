import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGameModules, importChapterDef, importIntoProject } from '../../js/core/importers/sm-chapter.js';
import { Project } from '../../js/core/project.js';
import { History } from '../../js/core/history.js';
import { setBuiltinLibrary } from '../../js/core/builtin.js';
import * as P from '../../js/core/perf.js';

test('budgets: status thresholds and the table of values', () => {
  const b = P.BUDGETS.find((x) => x.key === 'calls');
  assert.equal(P.status(b, 100), 'ok'); assert.equal(P.status(b, b.warn), 'warn'); assert.equal(P.status(b, b.bad - 1), 'warn'); assert.equal(P.status(b, b.bad), 'bad');
  const ev = P.evaluate({ calls: 900, tris: 5, geometries: 2000, textureMB: 10 });
  assert.deepEqual(ev.map((e) => [e.key, e.status]), [['calls', 'warn'], ['tris', 'ok'], ['geometries', 'bad'], ['textureMB', 'ok'], ['lights', 'ok'], ['colliders', 'ok']]);
  assert.equal(ev.find((e) => e.key === 'lights').value, 0, 'missing values count as 0');
});

test('aggregate finds repeated geometry, the heaviest models and the busiest materials', () => {
  const rec = [];
  for (let i = 0; i < 40; i++) rec.push({ geo: 'barrel', mat: 'rust', matName: 'Rust', tris: 2000, name: 'Barrel' });
  for (let i = 0; i < 3; i++) rec.push({ geo: 'statue', mat: 'stone', matName: 'Stone', tris: 150000, name: 'Statue' });
  for (let i = 0; i < 7; i++) rec.push({ geo: 'chair' + i, mat: 'wood', matName: 'Wood', tris: 500, name: 'Chair' });
  const a = P.aggregate(rec);
  assert.equal(a.meshes, 50); assert.equal(a.tris, 40 * 2000 + 3 * 150000 + 7 * 500);
  assert.deepEqual(a.repeated.map((g) => [g.name, g.instances]), [['Barrel', 40]], 'only geometry drawn 8+ times');
  assert.deepEqual(a.heaviest.slice(0, 2).map((g) => [g.name, g.total]), [['Statue', 450000], ['Barrel', 80000]]);
  assert.deepEqual(a.materials[0], { mat: 'rust', name: 'Rust', calls: 40 });
  assert.equal(a.uniqueGeometries, 9); assert.equal(a.uniqueMaterials, 3);
});

test('hints say what would be saved and stay quiet when nothing stands out', () => {
  const rec = [...Array.from({ length: 130 }, () => ({ geo: 'b', mat: 'm', matName: 'Rust', tris: 2000, name: 'Barrel' })), ...Array.from({ length: 3 }, () => ({ geo: 's', mat: 's', matName: 'Stone', tris: 150000, name: 'Statue' }))];
  const agg = P.aggregate(rec), stats = { calls: 133, tris: 130 * 2000 + 450000, lights: 60, fps: 12 };
  const msgs = P.hints(stats, agg).map((h) => h.message);
  assert.ok(msgs.some((m) => /“Barrel” is drawn 130 times.*save about 129 draw calls/.test(m)));
  assert.ok(msgs.some((m) => /“Rust” accounts for 98 %/.test(m)));
  assert.ok(msgs.some((m) => /“Statue” \(3×150,000 triangles\) is 63 %/.test(m)));
  assert.ok(msgs.some((m) => /60 lights/.test(m))); assert.ok(msgs.some((m) => /12 fps/.test(m)));
  assert.deepEqual(P.hints({ calls: 3, tris: 30, lights: 1 }, P.aggregate([{ geo: 'a', mat: 'm', tris: 10, name: 'A' }, { geo: 'b', mat: 'n', tris: 20, name: 'B' }])), []);
});

test('measureCore times the editor steps on a real imported chapter and reports what it processed (generous budgets: a regression guard, not a benchmark)', async () => {
  setBuiltinLibrary(JSON.parse(fs.readFileSync(new URL('../../assets-builtin/library.json', import.meta.url))));
  const mods = await loadGameModules(new URL('../../../saint-marrow', import.meta.url).href);
  const p = new Project('perf'); const t0 = performance.now(); importIntoProject(p, new History(p.ctx), importChapterDef(mods.CHAPTERS[1], mods)); const importMs = Math.round(performance.now() - t0);
  const r = P.measureCore(p);
  process.stderr.write(`[perf] chapter 2 (${r.counts.nodes} objects): import ${importMs} ms, ${JSON.stringify(r.ms)}\n`);
  assert.ok(r.counts.nodes > 400 && r.counts.colliders > 100 && r.counts.navNodes > 10000);
  assert.ok(importMs < 5000, `import ${importMs} ms`); assert.ok(r.ms.navmesh < 4000, `navmesh ${r.ms.navmesh} ms`); assert.ok(r.ms.validation < 6000, `validation ${r.ms.validation} ms`);
});

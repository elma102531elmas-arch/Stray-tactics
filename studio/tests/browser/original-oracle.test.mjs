// The ORIGINAL game is the oracle. This test runs it (read-only) in Chromium and compares what it reports with what the Studio's importer and
// validator say, so a mistake such as "shifted a collider", "lost the open gate" or "flags reachable items as unreachable" fails here.
// Nothing in /saint-marrow is modified; the page only reads state through the game's own window.__game handle.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, sleep } from './helpers.mjs';
import { loadGameModules, importChapterDef, importIntoProject } from '../../js/core/importers/sm-chapter.js';
import { Project } from '../../js/core/project.js';
import { History } from '../../js/core/history.js';
import { setBuiltinLibrary } from '../../js/core/builtin.js';
import { validateProject } from '../../js/core/validate.js';
import { worldColliders, nodeWorldAABB } from '../../js/core/geometry.js';
import * as THREE from '../../lib/three.module.js';

let h, page, mods;
const studio = {};          // chapter -> { project, unreachable:[names], colliders }
const orig = {};            // chapter -> { cells, items:[{name, reach}], colliders:[...], fusebox }
before(async () => {
  setBuiltinLibrary(JSON.parse(fs.readFileSync(new URL('../../assets-builtin/library.json', import.meta.url))));
  mods = await loadGameModules(new URL('../../../saint-marrow', import.meta.url).href);
  h = await launch({ width: 1000, height: 700 });
  page = h.page; page.setDefaultTimeout(180000);
  await page.goto(new URL('/saint-marrow/index.html', h.url).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.player && document.getElementById('loadLabel')?.textContent === 'Tap to start', null, { timeout: 180000 });
  await sleep(800);
});
after(async () => { await h?.close(); });

const importChapter = (n) => { const p = new Project('c' + n), hist = new History(p.ctx); importIntoProject(p, hist, importChapterDef(mods.CHAPTERS[n - 1], mods)); return p; };

for (let n = 1; n <= 5; n++) {
  test(`chapter ${n}: the running original game and the Studio import agree (colliders, interaction points, reachability)`, async () => {
    const p = importChapter(n);
    const v = validateProject(p, { only: ['reachability'] });
    const flagged = v.issues.filter((i) => i.code === 'unreachable').map((i) => { const nd = p.scene.get(i.nodes[0]), w = p.scene.worldPosition(nd.id); return { name: nd.name, x: w.x, z: w.z }; });
    const spawn = p.scene.worldPosition(p.scene.find((x) => x.type === 'playerSpawn')[0].id);
    const allItems = p.scene.find((x) => x.type === 'itemSpawn' || x.type === 'interaction').map((nd) => { const w = p.scene.worldPosition(nd.id); return { name: nd.name, x: w.x, y: w.y, z: w.z }; });

    await page.evaluate((n) => window.__game.startSolo(n), n);
    await page.waitForFunction((n) => window.__game.chapterNo === n && window.__game.level && window.__game.state !== 'loading', n, { timeout: 180000 });
    await sleep(400);
    const o = await page.evaluate(([sx, sz, items]) => {
      const L = window.__game.level, g = L.grid;
      const interactables = L.interactables.map((i) => { const p = i.pos(); return { id: i.id, use: i.use, x: p.x, y: p.y, z: p.z }; });
      const cols = g.colliders.filter((c) => c.prop).map((c) => ({ prop: c.prop, minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ, minY: c.minY, maxY: c.maxY }));
      g.doors.forEach((d) => { d.blocking = () => false; });                 // the player can open/unlock every door: test topology only
      g.colliders.forEach((c) => { if (c.noNav === false && c.maxY === 2.5) c.disabled = c.disabled; });
      const R = 0.3, S = 0.25, nx = Math.floor(g.w / S), nz = Math.floor(g.h / S);
      const ok = (x, z) => { const [cx, cz] = g.collide(x, z, R); return Math.hypot(cx - x, cz - z) < 0.02; };
      const key = (i, j) => j * nx + i, seen = new Uint8Array(nx * nz), si = Math.round(sx / S), sj = Math.round(sz / S), q = [[si, sj]]; seen[key(si, sj)] = 1;
      while (q.length) { const [i, j] = q.pop(); for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz || seen[key(a, b)] || !ok(a * S, b * S)) continue; seen[key(a, b)] = 1; q.push([a, b]); } }
      const near = (x, z, rad) => { const r = Math.ceil(rad / S); for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = Math.round(x / S) + di, b = Math.round(z / S) + dj; if (a >= 0 && b >= 0 && a < nx && b < nz && Math.hypot(di * S, dj * S) <= rad && seen[key(a, b)]) return true; } return false; };
      // the game's own pickup logic: can ANY reachable standing spot within 2.3 m look at the object so that findInteractable() returns it?
      const V = (x, y, z) => ({ x, y, z });
      const reach = items.map((it) => {
        let target = null, td = 1.0;
        for (const i of L.interactables) { const p = i.pos(); const d = Math.hypot(p.x - it.x, p.z - it.z); if (d < td) { td = d; target = i; } }
        let usable = false, spot = null;
        if (target) {
          const tp = target.pos();
          search: for (let dj = -10; dj <= 10; dj++) for (let di = -10; di <= 10; di++) {
            const a = Math.round(tp.x / S) + di, b = Math.round(tp.z / S) + dj;
            if (a < 0 || b < 0 || a >= nx || b >= nz || !seen[key(a, b)]) continue;
            const ox = a * S, oz = b * S, oy = 1.62, dx = tp.x - ox, dy = tp.y - oy, dz = tp.z - oz, len = Math.hypot(dx, dy, dz);
            if (len > 2.3 + target.radius || len < 0.05) continue;
            const THREEV = L.interactables[0].pos().constructor;
            const found = L.findInteractable(new THREEV(ox, oy, oz), new THREEV(dx / len, dy / len, dz / len), 2.3);
            if (found === target) { usable = true; spot = [ox, oz]; break search; }
          }
        }
        return { name: it.name, interactable: !!target, canInteract: usable, spot };
      });
      return { cells: seen.reduce((s, v) => s + v, 0), interactables, cols, reach };
    }, [spawn.x, spawn.z, allItems]);
    orig[n] = o; studio[n] = { p, flagged };

    // 1. colliders. The game also scatters RANDOM clutter each session (not reproducible, listed in the importer report), so compare from the Studio side:
    //    every prop the importer placed from an explicit map mark must have a collider in the game with the same name nearby, and when the game does not
    //    randomise its orientation (`free`) or wall side (`wall`) the boxes must agree to within 10 cm.
    const studioCols = worldColliders(p.scene, p.geoCtx).filter((c) => c.kind === 'solid' && ['model', 'box', 'cylinder'].includes(p.scene.get(c.nodeId).type) && /^[a-z0-9_]+ \(\d+,\d+\)$/i.test(p.scene.get(c.nodeId).name));
    const stat = { exact: 0, random: 0, bad: [], missing: [] };
    for (const s of studioCols) {
      const prop = p.scene.get(s.nodeId).name.split(' (')[0], preset = mods.PRESETS[prop] || {};
      const sx = (s.aabb.min.x + s.aabb.max.x) / 2, sz = (s.aabb.min.z + s.aabb.max.z) / 2;
      let best = null, bd = Infinity;
      for (const c of o.cols) { if (c.prop !== prop) continue; const d = Math.hypot((c.minX + c.maxX) / 2 - sx, (c.minZ + c.maxZ) / 2 - sz); if (d < bd) { bd = d; best = c; } }
      if (!best || bd > 1.0) { stat.missing.push(`${prop} @ ${sx.toFixed(1)},${sz.toFixed(1)}`); continue; }
      if (preset.wall && !preset.free) {                                           // random wall side: the footprint may be turned by 90°, so compare its two extents
        const ext = (a, b, c, d) => [Math.abs(b - a), Math.abs(d - c)].sort((x, y) => x - y);
        const e1 = ext(s.aabb.min.x, s.aabb.max.x, s.aabb.min.z, s.aabb.max.z), e2 = ext(best.minX, best.maxX, best.minZ, best.maxZ);
        if (Math.abs(e1[0] - e2[0]) <= 0.12 && Math.abs(e1[1] - e2[1]) <= 0.12) stat.sizeOk = (stat.sizeOk || 0) + 1; else stat.bad.push(`${prop} @ ${sx.toFixed(1)},${sz.toFixed(1)} footprint ${e1.map((v) => v.toFixed(2))} vs game ${e2.map((v) => v.toFixed(2))}`);
        stat.random++; continue;
      }
      if (preset.free || preset.wall) { stat.random++; continue; }
      const dev = Math.max(Math.abs(s.aabb.min.x - best.minX), Math.abs(s.aabb.max.x - best.maxX), Math.abs(s.aabb.min.z - best.minZ), Math.abs(s.aabb.max.z - best.maxZ));
      if (dev <= 0.1) stat.exact++; else stat.bad.push(`${prop} @ ${sx.toFixed(1)},${sz.toFixed(1)} off by ${dev.toFixed(2)} m`);
    }
    process.stderr.write(`[oracle] chapter ${n}: ${studioCols.length} imported prop colliders vs ${o.cols.length} in the game (the rest are random clutter) — ${stat.exact} fixed props match within 10 cm, ${stat.random} are randomly rotated/mounted (${stat.sizeOk || 0} wall-side props have the game's footprint), ${stat.bad.length} deviate, ${stat.missing.length} have no counterpart ${stat.missing.join('; ')}\n`);
    assert.ok(studioCols.length > 5 && o.cols.length > 5);
    assert.deepEqual(stat.bad, [], 'fixed-orientation props are placed exactly as in the game');
    assert.ok(stat.missing.length <= Math.ceil(studioCols.length * 0.1), `imported props with no game counterpart: ${stat.missing.join('; ')}`);

    // 2. interaction points: every "use" interactable the game registers exists in the import, centred on the same x, y AND z
    let compared = 0;
    for (const i of o.interactables.filter((x) => x.use && x.use !== 'gate')) {
      const nd = p.scene.find((x) => x.type === 'interaction' && x.name === 'use:' + i.use)[0];
      if (!nd) continue;                                                         // not every use becomes a volume (reported by the importer)
      const c = nodeWorldAABB(p.scene, nd.id, p.geoCtx).getCenter(new THREE.Vector3());
      assert.ok(Math.hypot(c.x - i.x, c.z - i.z) < 0.3 && Math.abs(c.y - i.y) < 0.15, `${i.use}: import centred at (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) vs game (${i.x.toFixed(2)}, ${i.y.toFixed(2)}, ${i.z.toFixed(2)})`);
      compared++;
    }
    process.stderr.write(`[oracle] chapter ${n}: ${compared} interaction points identical to the game\n`);

    // 3. reachability: the Studio never flags an item as unreachable when the game's own collision can walk next to it (no false positives)
    const falsePositives = flagged.filter((f) => o.reach.find((r) => r.name === f.name)?.canInteract);
    assert.deepEqual(falsePositives.map((f) => f.name), [], `flagged unreachable by the Studio but reachable in the original game (chapter ${n})`);
  });
}

test('the original fusebox interaction really is at y = 2.9 (the importer keeps the original coordinates, including this quirk)', () => {
  const fb = orig[2].interactables.find((i) => i.use === 'fusebox');
  assert.ok(Math.abs(fb.y - 2.9) < 0.01, `the running game reports y=${fb.y}`);
  const vol = studio[2].p.scene.find((x) => x.type === 'interaction' && x.name === 'use:fusebox')[0], w = studio[2].p.scene.worldPosition(vol.id);
  assert.ok(Math.abs(w.x - fb.x) < 0.01 && Math.abs(w.z - fb.z) < 0.01, 'same x/z');
});

test('chapter 5 imports the gate OPEN (as the game builds it): the grounds are connected to the start, theo and the medkit are reachable', () => {
  const gate = studio[5].p.scene.find((x) => x.name === 'Iron gate (open)')[0];
  assert.ok(gate, 'open gate present'); assert.equal(gate.props.collision, 'none');
  assert.ok(Math.abs(gate.t.r[1] + 91.67) < 0.1, `rotated about the hinge like the game (got ${gate.t.r[1]})`);
  const names = studio[5].flagged.map((f) => f.name);
  assert.ok(!names.includes('theo') && !names.some((x) => x.startsWith('medkit')), `still flagged: ${names.join(', ')}`);
  const g1 = studio[1].p.scene.find((x) => x.name === 'Iron gate')[0]; assert.equal(g1.props.collision, 'custom', 'chapter 1: the gate is shut');
});

test('everything the Studio still flags is also unreachable in the original game (or is a documented tight doorway the original squeezes through)', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    for (const f of studio[n].flagged) {
      const r = orig[n].reach.find((x) => x.name === f.name);
      assert.ok(r && !r.canInteract, `chapter ${n}: ${f.name} is flagged by the Studio but the game's own findInteractable() can pick it from ${JSON.stringify(r?.spot)}`);
    }
  }
  const flagged = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, studio[n].flagged.map((f) => f.name).sort()]));
  assert.deepEqual(flagged, {
    1: ['bandage (9,55)', 'battery (7,53)', 'hutNote', 'theo'],                       // hut interior (0.43 m doorway squeeze) + theo behind the chained gate
    2: [], 3: [],
    4: ['ammo9 (12,6)', 'ammo9 (20,33)', 'ammo9 (27,26)', 'battery (21,2)', 'medkit (32,25)', 'note n_lab', 'painkillers (35,22)', 'use:ladder'],   // basement region joined by the game's scripts
    5: ['bandage (9,55)', 'battery (7,53)', 'hutNote'],
  }, 'the known list, each entry explained in docs/KNOWN_LIMITATIONS.md and core/diagnostics.js');
});

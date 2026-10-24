// The chapter importer is tested against the REAL game data with independent oracles (cell counts taken from the game's own Grid),
// so a bug such as "lost a door" or "shifted the map by one cell" fails here.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGameModules, importChapterDef, importIntoProject } from '../../js/core/importers/sm-chapter.js';
import { Project } from '../../js/core/project.js';
import { History } from '../../js/core/history.js';
import { setBuiltinLibrary } from '../../js/core/builtin.js';
import { validateProject } from '../../js/core/validate.js';
import { referencedAssets } from '../../js/core/project.js';
import { projectToJSON, projectFromJSON } from '../../js/store/bundle.js';

let mods, lib;
before(async () => {
  lib = JSON.parse(fs.readFileSync(new URL('../../assets-builtin/library.json', import.meta.url)));
  setBuiltinLibrary(lib);
  mods = await loadGameModules(new URL('../../../saint-marrow', import.meta.url).href);
});

const importOne = (def) => { const p = new Project('imp'); const h = new History(p.ctx); const r = importChapterDef(def, mods); importIntoProject(p, h, r); return { p, h, r }; };
const cellsOf = (def) => { const g = new mods.Grid({ grid: def.map, legend: def.legend || {}, defaultTheme: def.defaultTheme ?? 0, themes: def.themes }); const c = {}; for (let i = 0; i < g.type.length; i++) c[g.type[i]] = (c[g.type[i]] || 0) + 1; return { g, c }; };

test('the game exposes five chapters', () => { assert.equal(mods.CHAPTERS.length, 5); });

for (let n = 1; n <= 5; n++) {
  test(`chapter ${n}: imported object counts match the game's own grid`, () => {
    const def = mods.CHAPTERS[n - 1];
    const { p, r } = importOne(def);
    const { c } = cellsOf(def);
    const T = mods.T;
    assert.equal(p.scene.find((x) => x.type === 'door').length, c[T.DOOR] || 0, 'door count');
    assert.equal(p.scene.find((x) => x.type === 'window').length, c[T.WINDOW] || 0, 'window count');
    const floored = [T.FLOOR, T.DOOR, T.WATER, T.GROUND, T.ROAD, T.PATH, T.GRASS, T.TREE, T.FENCE].reduce((s, k) => s + (c[k] || 0), 0);
    const area = p.scene.find((x) => x.type === 'floor').reduce((s, f) => s + f.props.w * f.props.d, 0);
    assert.equal(Math.round(area), floored, 'floor area equals the number of walkable/ground cells (1 cell = 1 m²)');
    assert.ok(p.scene.find((x) => x.type === 'playerSpawn').length >= 1, 'has a player spawn');
    assert.ok(r.report.unimportable.length >= 1, 'report lists what could not be imported');
  });

  test(`chapter ${n}: coordinates are preserved (1 cell = 1 m, cell centre = x+0.5)`, () => {
    const def = mods.CHAPTERS[n - 1];
    const { p } = importOne(def);
    const { g } = cellsOf(def);
    for (const door of p.scene.find((x) => x.type === 'door')) {
      const [cx, cz] = door.meta.source.cell;
      assert.equal(g.type[cz * g.w + cx], mods.T.DOOR, `door "${door.name}" sits on a DOOR cell`);
      const w = p.scene.worldPosition(door.id);
      assert.ok(Math.abs(w.x - (cx + 0.5)) < 0.51 && Math.abs(w.z - (cz + 0.5)) < 0.51, `${door.name} world ${w.x},${w.z} vs cell ${cx},${cz}`);
    }
    // nothing outside the map rectangle
    for (const node of p.scene.find((x) => x.type !== 'group')) {
      const w = p.scene.worldPosition(node.id);
      assert.ok(w.x > -2 && w.z > -2 && w.x < g.w + 2 && w.z < g.h + 2, `${node.name} at ${w.x},${w.z} is outside the ${g.w}x${g.h} map`);
    }
  });

  test(`chapter ${n}: every object carries provenance; nothing is fabricated`, () => {
    const def = mods.CHAPTERS[n - 1];
    const { p } = importOne(def);
    const noSource = p.scene.find((x) => x.type !== 'group' && !x.meta?.source);
    assert.deepEqual(noSource.map((x) => x.name).slice(0, 5), [], 'every imported leaf node says where it came from');
    for (const node of p.scene.find((x) => x.meta?.source)) assert.equal(node.meta.source.game, 'saint-marrow');
  });

  test(`chapter ${n}: one undo removes the whole import; JSON round trip and validation do not crash`, () => {
    const def = mods.CHAPTERS[n - 1];
    const { p, h } = importOne(def);
    const text = projectToJSON(p);
    const q = projectFromJSON(text);
    assert.equal(q.scene.size, p.scene.size);
    const v = validateProject(p);
    assert.ok(!v.issues.some((i) => i.code === 'validator-error'), JSON.stringify(v.issues.filter((i) => i.code === 'validator-error')));
    h.undo();
    assert.equal(p.scene.size, 0);
  });

  test(`chapter ${n}: every asset the import references exists in the built-in library`, () => {
    const def = mods.CHAPTERS[n - 1];
    const { p } = importOne(def);
    const missing = [...referencedAssets(p).keys()].filter((id) => id.startsWith('builtin:') && !id.startsWith('builtin:decal/') && !lib.models[id] && !lib.textures[id]);
    assert.deepEqual(missing, []);
  });
}

test('importing the same chapter twice is deterministic (same names and counts)', () => {
  const a = importOne(mods.CHAPTERS[1]).p, b = importOne(mods.CHAPTERS[1]).p;
  assert.equal(a.scene.size, b.scene.size);
  assert.deepEqual(a.scene.all().map((n) => n.name), b.scene.all().map((n) => n.name));
});

test('chapter scripts are kept as READ-ONLY reference text and are never executed', () => {
  const { p } = importOne(mods.CHAPTERS[0]);
  const refs = Object.values(p.data.scripts);
  assert.ok(refs.length > 0);
  assert.ok(refs.every((s) => s.readOnly === true && /NOT executed/.test(s.code)));
});

test('locks on imported doors are copied verbatim from the game legend', () => {
  const def = mods.CHAPTERS[0];
  const { p } = importOne(def);
  for (const door of p.scene.find((x) => x.type === 'door')) {
    const leg = def.legend?.[door.meta.source.mark];
    if (leg?.door) assert.equal(door.props.locked || '', leg.lock || leg.locked || '', `lock of ${door.name}`);
  }
});

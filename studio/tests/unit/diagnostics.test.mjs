// Triage of validator issues. The expensive claims (what the running original game does) are verified by tests/browser/original-oracle.test.mjs;
// these tests check that every claim the classifier makes about the original's SOURCE is true, and that nothing imported is left unexplained.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGameModules, importChapterDef, importIntoProject } from '../../js/core/importers/sm-chapter.js';
import { Project } from '../../js/core/project.js';
import { History } from '../../js/core/history.js';
import { makeNode } from '../../js/core/scene.js';
import { setBuiltinLibrary } from '../../js/core/builtin.js';
import { validateProject } from '../../js/core/validate.js';
import * as D from '../../js/core/diagnostics.js';
import { fixCommand } from '../../js/core/fixes.js';

let mods; const projects = {}, issues = {};
before(async () => {
  setBuiltinLibrary(JSON.parse(fs.readFileSync(new URL('../../assets-builtin/library.json', import.meta.url))));
  mods = await loadGameModules(new URL('../../../saint-marrow', import.meta.url).href);
  for (let n = 1; n <= 5; n++) { const p = new Project('ch' + n); importIntoProject(p, new History(p.ctx), importChapterDef(mods.CHAPTERS[n - 1], mods)); projects[n] = p; issues[n] = D.enrichIssues(p, validateProject(p).issues); }
});

test('every issue on an imported chapter is explained: none is left as an unverified guess, none is called a bug in the map', () => {
  for (let n = 1; n <= 5; n++) {
    const unexplained = issues[n].filter((i) => i.triage.cls === 'unverified' || i.triage.cls === 'bug');
    assert.deepEqual(unexplained.map((i) => `${i.code}: ${i.message}`), [], `chapter ${n}`);
    for (const i of issues[n]) { assert.ok(i.triage.imported, 'imported'); if (['quirk', 'script', 'limit'].includes(i.triage.cls)) assert.ok(i.triage.evidence.length >= 1, `${i.code} ${i.names[0]} cites evidence`); }
  }
});

test('the class counts per chapter are pinned (a change means the importer or validator changed behaviour)', () => {
  const counts = {}; for (let n = 1; n <= 5; n++) counts[n] = D.summarize(issues[n]);
  assert.deepEqual(counts, {
    1: { bug: 0, quirk: 5, script: 3, limit: 3, unverified: 0, note: 1 },
    2: { bug: 0, quirk: 4, script: 2, limit: 0, unverified: 0, note: 0 },
    3: { bug: 0, quirk: 1, script: 1, limit: 0, unverified: 0, note: 2 },
    4: { bug: 0, quirk: 4, script: 11, limit: 0, unverified: 0, note: 0 },
    5: { bug: 0, quirk: 7, script: 2, limit: 3, unverified: 0, note: 0 },
  });
});

test('no entry of the quirk registry is stale: each one explains at least one real issue', () => {
  const used = new Set(); for (let n = 1; n <= 5; n++) for (const i of issues[n]) if (i.triage.quirk) used.add(i.triage.quirk);
  assert.deepEqual(D.KNOWN_QUIRKS.map((q) => q.id).filter((id) => !used.has(id)), []);
  assert.ok(used.has('dead-trigger'), 'the data-driven rule also fired');
  for (const q of D.KNOWN_QUIRKS) { assert.ok(q.evidence.length && q.explanation.length > 40 && q.title && D.CLASSES[q.cls], q.id); }
});

test('claim “writing-no-wall”: every flagged blood-writing sits in a map cell with NO adjacent wall in the game’s own grid', () => {
  const T = mods.T; let checked = 0;
  for (const n of [2, 3, 4]) {
    const def = mods.CHAPTERS[n - 1], g = new mods.Grid({ grid: def.map, legend: def.legend || {}, defaultTheme: def.defaultTheme ?? 0, themes: def.themes });
    for (const i of issues[n].filter((x) => x.triage.quirk === 'writing-no-wall')) {
      const node = projects[n].scene.get(i.nodes[0]), [cx, cz] = node.meta.source.cell;
      const adj = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dz]) => g.get(cx + dx, cz + dz));
      assert.ok(!adj.some((t) => t === T.WALL || t === T.EXT || t === T.WINDOW), `chapter ${n} (${cx},${cz}) has a wall next to it: ${adj}`); checked++;
    }
  }
  assert.equal(checked, 3);
});

test('claim “note-off-desk”: the legend sets y explicitly, and no desk covers the note’s position', () => {
  let checked = 0;
  for (const n of [2, 4]) {
    const def = mods.CHAPTERS[n - 1];
    for (const i of issues[n].filter((x) => x.triage.quirk === 'note-off-desk')) {
      const node = projects[n].scene.get(i.nodes[0]), mark = node.meta.source.mark, w = projects[n].scene.worldPosition(node.id);
      assert.equal(def.legend[mark].y, 0.79, 'explicit y in the legend');
      const covered = projects[n].scene.find((x) => /^desk/.test(x.name)).some((d) => { const b = d.props; const p = projects[n].scene.worldPosition(d.id); return Math.abs(w.x - p.x) < 1.2 && Math.abs(w.z - p.z) < 0.5; });
      assert.equal(covered, false, 'no desk within reach of the note’s xz'); checked++;
    }
  }
  assert.equal(checked, 2);
});

test('claim “handled by the original script” / “dead trigger”: decided from the original chapter functions themselves (not from the importer’s copy)', () => {
  let script = 0; const dead = [];
  for (let n = 1; n <= 5; n++) {
    const def = mods.CHAPTERS[n - 1], fnSrc = Object.entries(def).filter(([, v]) => typeof v === 'function').map(([, v]) => v.toString()).join('\n');
    for (const i of issues[n].filter((x) => x.code === 'unhandled-event')) {
      const id = i.names[0].split(':')[1], mentioned = new RegExp(`['"\`]${id}['"\`]`).test(fnSrc);
      assert.equal(i.triage.cls, mentioned ? 'script' : 'quirk', `${i.names[0]} (chapter ${n})`);
      if (mentioned) script++; else dead.push(`ch${n}:${i.names[0]}`);
    }
  }
  assert.equal(script, 11, 'events handled by original JavaScript');
  assert.deepEqual(dead.sort(), ['ch1:trigger:gateInside', 'ch2:trigger:nearStairs', 'ch4:trigger:nearExit', 'ch5:trigger:bay', 'ch5:trigger:gateInside', 'ch5:trigger:wheel'], 'triggers the original defines but never handles');
});

test('issue keys survive a re-import (node ids change, source cells do not); different issues have different keys', () => {
  const p = new Project('again'); importIntoProject(p, new History(p.ctx), importChapterDef(mods.CHAPTERS[1], mods));
  const k2 = D.enrichIssues(p, validateProject(p).issues).map((i) => i.key).sort();
  assert.deepEqual(k2, issues[2].map((i) => i.key).sort());
  assert.equal(new Set(k2).size, k2.length, 'unique');
});

test('authored objects are bugs, info is a note: classification does not depend on the original game for the user’s own map', () => {
  const p = new Project('mine'); p.scene.insert(makeNode('floor', { props: { w: 10, d: 10 } }));
  p.scene.insert(makeNode('decal', { name: 'Mine', p: [0, 1.5, 0], props: { texture: 'builtin:decal/writing' } }));
  p.scene.insert(makeNode('itemSpawn', { name: 'Lamp', p: [2, 3, 2], props: { item: 'lamp' } }));
  const e = D.enrichIssues(p, validateProject(p).issues);
  const byCode = Object.fromEntries(e.map((i) => [i.code, i.triage]));
  assert.equal(byCode['decal-floating'].cls, 'bug'); assert.equal(byCode['spawn-floating'].cls, 'bug');
  assert.ok(!byCode['decal-floating'].imported);
  assert.equal(D.classifyIssue(p, { code: 'x', severity: 'info', message: 'm', nodes: [] }).cls, 'note');
});

test('tracker: quirks start as accepted, bugs as open; trackedState notices when an issue stops reproducing', () => {
  const fuse = issues[2].find((i) => i.triage.quirk === 'ch2-fusebox-high' && i.code === 'interaction-out-of-reach');
  const t = D.newTracked(fuse); assert.equal(t.status, 'accepted'); assert.equal(t.cls, 'quirk'); assert.match(t.title, /Fuse box/); assert.ok(t.evidence.length >= 1); assert.deepEqual(t.nodeNames, ['use:fusebox']);
  assert.equal(D.trackedState([t], issues[2])[0].reproduces, true);
  // the author fixes it in their copy: the issue disappears and the tracker says so
  const p = projects[2], h = new History(p.ctx); h.exec(fixCommand(p, fuse.fix));              // the author applies the offered fix in their copy
  const after = D.enrichIssues(p, validateProject(p).issues);
  assert.equal(D.trackedState([t], after)[0].reproduces, false, 'the tracker notices the issue no longer reproduces'); h.undo();
  assert.equal(D.trackedState([t], D.enrichIssues(p, validateProject(p).issues))[0].reproduces, true);
  assert.equal(D.newTracked({ ...fuse, triage: { ...fuse.triage, cls: 'bug', quirk: null } }).status, 'open');
});

test('the markdown report groups by class, explains each group and cites evidence', () => {
  const md = D.reportMarkdown(projects[2], issues[2]);
  assert.match(md, /# Diagnostics — ch2/); assert.match(md, /## Original-game quirk/); assert.match(md, /### Fuse box interaction point sits 2\.9 m up/); assert.match(md, /Evidence: \[running game\]/); assert.match(md, /\| Original script logic \| 2 \|/); assert.match(md, /### Trigger the original never handles/);
});

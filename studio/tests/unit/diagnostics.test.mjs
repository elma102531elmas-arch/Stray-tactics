// Triage of validator issues on the imported game. What the running game does is checked by tests/browser/original-oracle.test.mjs;
// these tests check that every claim the classifier makes about the game's SOURCE is true, and that nothing imported is left unexplained.
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
import { removeNodes } from '../../js/core/commands.js';

let mods, N; const projects = {}, issues = {};
before(async () => {
  setBuiltinLibrary(JSON.parse(fs.readFileSync(new URL('../../assets-builtin/library.json', import.meta.url))));
  mods = await loadGameModules(new URL('../../../saint-marrow', import.meta.url).href);
  N = mods.CHAPTERS.length;
  for (let n = 1; n <= N; n++) { const p = new Project('ch' + n); importIntoProject(p, new History(p.ctx), importChapterDef(mods.CHAPTERS[n - 1], mods)); projects[n] = p; issues[n] = D.enrichIssues(p, validateProject(p).issues); }
});

test('every issue on an imported chapter is explained: none is left as an unverified guess, none is called a bug in the map', () => {
  for (let n = 1; n <= N; n++) {
    const unexplained = issues[n].filter((i) => i.triage.cls === 'unverified' || i.triage.cls === 'bug');
    assert.deepEqual(unexplained.map((i) => `${i.code}: ${i.message}`), [], `chapter ${n}`);
    for (const i of issues[n]) { assert.ok(i.triage.imported, 'imported'); if (['quirk', 'script', 'limit'].includes(i.triage.cls)) assert.ok(i.triage.evidence.length >= 1, `${i.code} ${i.names[0]} cites evidence`); }
  }
});

test('the class counts per chapter are pinned (a change means the game, the importer or the validator changed behaviour)', () => {
  const counts = {}; for (let n = 1; n <= N; n++) counts[n] = D.summarize(issues[n]);
  assert.deepEqual(counts, {
    1: { bug: 0, quirk: 0, script: 6, limit: 0, unverified: 0, note: 0 },
    2: { bug: 0, quirk: 1, script: 2, limit: 0, unverified: 0, note: 0 },
    3: { bug: 0, quirk: 1, script: 3, limit: 0, unverified: 0, note: 0 },
    4: { bug: 0, quirk: 0, script: 1, limit: 0, unverified: 0, note: 2 },
    5: { bug: 0, quirk: 1, script: 4, limit: 0, unverified: 0, note: 0 },
    6: { bug: 0, quirk: 0, script: 5, limit: 0, unverified: 0, note: 0 },
    7: { bug: 0, quirk: 0, script: 0, limit: 0, unverified: 0, note: 0 },
  });
});

test('no entry of the quirk registry is stale: each one explains at least one real issue', () => {
  const used = new Set(); for (let n = 1; n <= N; n++) for (const i of issues[n]) if (i.triage.quirk) used.add(i.triage.quirk);
  assert.deepEqual(D.KNOWN_QUIRKS.map((q) => q.id).filter((id) => !used.has(id)), []);
  assert.ok(used.has('dead-trigger'), 'the data-driven rule also fired');
  for (const q of D.KNOWN_QUIRKS) { assert.ok(q.evidence.length && q.explanation.length > 40 && q.title && D.CLASSES[q.cls], q.id); }
});

test('fixed in the game, kept fixed: blood writing is on a wall and notes lie on something, in every chapter', () => {
  let writing = 0;
  for (let n = 1; n <= N; n++) {
    assert.deepEqual(issues[n].filter((i) => i.code === 'decal-floating' || i.code === 'spawn-floating').map((i) => i.message), [], `chapter ${n}`);
    writing += projects[n].scene.find((x) => /^Blood writing/.test(x.name)).length;
  }
  assert.ok(writing >= 5, `blood writing imported (${writing})`);
  // the two story notes that used to lie on the floor in front of their desks
  for (const [n, name] of [[2, 'codeNote'], [3, 'plan']]) {
    const y = projects[n].scene.worldPosition(projects[n].scene.byName(name).id).y;
    assert.ok(Math.abs(y - 0.79) < 0.02, `${name} on the desk top (y = ${y})`);
  }
});

test('“handled by the game script” / “dead trigger”: decided from the chapter functions themselves (not from the importer’s copy)', () => {
  let script = 0; const dead = [];
  for (let n = 1; n <= N; n++) {
    const def = mods.CHAPTERS[n - 1], fnSrc = Object.entries(def).filter(([, v]) => typeof v === 'function').map(([, v]) => v.toString()).join('\n');
    for (const i of issues[n].filter((x) => x.code === 'unhandled-event')) {
      const id = i.names[0].split(':')[1], mentioned = D.sourceMentions(fnSrc, id);
      assert.equal(i.triage.cls, mentioned ? 'script' : 'quirk', `${i.names[0]} (chapter ${n})`);
      if (mentioned) script++; else dead.push(`ch${n}:${i.names[0]}`);
    }
  }
  assert.equal(script, 21, 'events handled by the game’s JavaScript');
  assert.deepEqual(dead.sort(), ['ch2:trigger:nearStairs', 'ch3:trigger:nearExit', 'ch5:trigger:nearStairs'], 'triggers the game defines but never handles');
  // a prefix test in a handler counts: chapter 5 handles relay1…3 with id.startsWith('relay')
  assert.ok(issues[5].filter((i) => /^use:relay/.test(i.names[0])).every((i) => i.triage.cls === 'script'));
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
  const dead = issues[2].find((i) => i.triage.quirk === 'dead-trigger');
  const t = D.newTracked(dead); assert.equal(t.status, 'accepted'); assert.equal(t.cls, 'quirk'); assert.match(t.title, /never handles/); assert.ok(t.evidence.length >= 1); assert.deepEqual(t.nodeNames, ['trigger:nearStairs']);
  assert.equal(D.trackedState([t], issues[2])[0].reproduces, true);
  // the author deletes the useless trigger in their copy: the issue disappears and the tracker says so
  const p = projects[2], h = new History(p.ctx); h.exec(removeNodes([p.scene.byName('trigger:nearStairs').id]));
  assert.equal(D.trackedState([t], D.enrichIssues(p, validateProject(p).issues))[0].reproduces, false, 'the tracker notices the issue no longer reproduces'); h.undo();
  assert.equal(D.trackedState([t], D.enrichIssues(p, validateProject(p).issues))[0].reproduces, true);
  assert.equal(D.newTracked({ ...dead, triage: { ...dead.triage, cls: 'bug', quirk: null } }).status, 'open');
});

test('the markdown report groups by class, explains each group and cites evidence', () => {
  const md = D.reportMarkdown(projects[2], issues[2]);
  assert.match(md, /# Diagnostics — ch2/); assert.match(md, /## Original-game quirk/); assert.match(md, /### Trigger the original never handles/); assert.match(md, /- Evidence: /); assert.match(md, /\| Original script logic \| 2 \|/); assert.match(md, /### Handled by the original game’s script/);
});

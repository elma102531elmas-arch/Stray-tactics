// App-level behaviour (selection, creation helpers, tools that build geometry) exercised without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../../js/app.js';
import { MemoryStorage } from '../../js/store/storage.js';
import { createRoom } from '../../js/tools/build.js';
import { validateProject } from '../../js/core/validate.js';
import { ROOT_ID } from '../../js/core/scene.js';

const mk = () => { globalThis.localStorage ??= { getItem: () => null, setItem() {} }; return new App({ storage: new MemoryStorage(), baseUrl: 'file:///studio/' }); };
const ROOM = { height: 2.8, thick: 0.2, wallMaterial: 'mat_plaster', floorMaterial: 'mat_tile', ceilingMaterial: 'mat_plaster', doorSide: 'none' };

test('createNode adds, names uniquely and selects; undo removes it', () => {
  const app = mk();
  const a = app.createNode('wall'), b = app.createNode('wall');
  assert.equal(a.name, 'Wall'); assert.equal(b.name, 'Wall 2');
  assert.deepEqual(app.selection, [b.id]);
  app.undo();
  assert.equal(app.scene.size, 1);
  assert.deepEqual(app.selection, []);            // selection drops nodes that vanished
});

test('selection API: add / toggle / topSelection ignores children of selected groups', () => {
  const app = mk();
  const g = app.createNode('group'); const c = app.createNode('box', {}, { parentId: g.id });
  app.select([g.id, c.id]);
  assert.deepEqual(app.topSelection(), [g.id]);
  app.select([c.id], { toggle: true });
  assert.deepEqual(app.selection, [g.id]);
  app.select([c.id], { add: true });
  assert.equal(app.selection.length, 2);
});

test('copy / paste duplicates with fresh ids and offset', () => {
  const app = mk();
  const w = app.createNode('wall', { p: [1, 0, 1] });
  app.copy(); app.paste();
  assert.equal(app.scene.size, 2);
  const pasted = app.scene.get(app.selection[0]);
  assert.notEqual(pasted.id, w.id);
  assert.deepEqual(pasted.t.p, [2, 0, 2]);
});

test('Room tool output is one undo step and passes validation (no wall gaps, floor present)', () => {
  const app = mk();
  createRoom(app, { cx: 5, cz: 5, y: 0, w: 6, d: 4 }, { ...ROOM, doorSide: 'S' });
  assert.equal(app.history.undoStack.length, 1);
  const room = app.scene.byName('Room');
  assert.equal(room.children.length, 7);                                 // floor, ceiling, 4 walls, door
  const issues = validateProject(app.project, { only: ['wallGaps', 'overlappingOpenings', 'openingPlacement'] }).issues;
  assert.deepEqual(issues.map((i) => i.message), []);
  app.undo(); assert.equal(app.scene.size, 0);
  app.redo(); assert.equal(app.scene.size, 8);
});

test('a door in a room cuts a real opening in the wall (collision follows)', async () => {
  const { worldColliders } = await import('../../js/core/geometry.js');
  const app = mk();
  createRoom(app, { cx: 0, cz: 0, y: 0, w: 6, d: 4 }, { ...ROOM, doorSide: 'S' });
  const cols = worldColliders(app.scene, app.project.geoCtx);
  const south = app.scene.byName('Wall South');
  assert.equal(cols.filter((c) => c.nodeId === south.id).length, 3);     // two jambs + lintel
});

test('exec reports errors instead of throwing into UI code', () => {
  const app = mk();
  const w = app.createNode('wall');
  const logs = [];
  app.on('log', (l) => logs.push(l));
  assert.equal(app.setProps(w.id, { length: -5 }), null);
  assert.ok(logs.some((l) => l.level === 'error' && /at least/.test(l.msg)));
  assert.equal(app.scene.get(w.id).props.length, 4);
});

test('actions: unknown ids are logged, disabled actions do not run', async () => {
  const app = mk();
  const logs = [];
  app.on('log', (l) => logs.push(l));
  await app.run('does.not.exist');
  assert.ok(logs.some((l) => /Unknown action/.test(l.msg)));
  let ran = false;
  app.register({ id: 't.off', label: 'x', enabled: () => false, run: () => { ran = true; } });
  await app.run('t.off');
  assert.equal(ran, false);
});

test('project replacement resets history and selection', () => {
  const app = mk();
  app.createNode('box');
  assert.ok(app.dirty);
  app.setProject(new (app.project.constructor)('Other'));
  assert.equal(app.scene.size, 0); assert.equal(app.dirty, false); assert.deepEqual(app.selection, []);
  assert.ok(app.scene.has !== undefined && !app.scene.has('nope') && app.scene.get(ROOT_ID));
});

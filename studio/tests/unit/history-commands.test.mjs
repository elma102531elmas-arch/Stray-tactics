import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneModel, makeNode, ROOT_ID } from '../../js/core/scene.js';
import { History } from '../../js/core/history.js';
import * as C from '../../js/core/commands.js';
import { newProjectData } from '../../js/core/project.js';

const setup = () => { const scene = new SceneModel(), data = newProjectData(); const h = new History({ scene, data }); return { scene, data, h }; };
const state = (scene) => JSON.stringify(scene.toJSON());

test('add / undo / redo restores exact state', () => {
  const { scene, h } = setup();
  const before = state(scene);
  const w = makeNode('wall', { p: [2, 0, 0] });
  h.exec(C.addNode(w));
  const after = state(scene);
  assert.equal(scene.size, 1);
  h.undo(); assert.equal(state(scene), before);
  h.redo(); assert.equal(state(scene), after);
});

test('property edits coalesce into ONE undo step (typing / dragging a field)', () => {
  const { scene, h } = setup();
  const w = makeNode('wall'); h.exec(C.addNode(w));
  const t = Date.now();
  for (const v of [5, 5.5, 6, 6.25]) h.exec(C.setProps(w.id, { length: v }), { now: t + 10 });
  assert.equal(h.undoStack.length, 2);                 // add + one merged edit
  assert.equal(scene.get(w.id).props.length, 6.25);
  h.undo(); assert.equal(scene.get(w.id).props.length, 4);   // schema default
  h.redo(); assert.equal(scene.get(w.id).props.length, 6.25);
});

test('edits far apart in time are separate undo steps', () => {
  const { scene, h } = setup();
  const w = makeNode('wall'); h.exec(C.addNode(w));
  h.exec(C.setProps(w.id, { length: 5 }), { now: 1000 });
  h.exec(C.setProps(w.id, { length: 6 }), { now: 5000 });
  assert.equal(h.undoStack.length, 3);
});

test('invalid property values are rejected and leave no history entry', () => {
  const { scene, h } = setup();
  const w = makeNode('wall'); h.exec(C.addNode(w));
  const n = h.undoStack.length;
  assert.throws(() => h.exec(C.setProps(w.id, { length: -3 })), /at least/);
  assert.equal(h.undoStack.length, n);
  assert.equal(scene.get(w.id).props.length, 4);
});

test('transactions group many commands into one undo step', () => {
  const { scene, h } = setup();
  h.transaction('Build', () => { for (let i = 0; i < 5; i++) h.exec(C.addNode(makeNode('box', { p: [i, 0, 0] }))); });
  assert.equal(scene.size, 5); assert.equal(h.undoStack.length, 1);
  h.undo(); assert.equal(scene.size, 0);
  h.redo(); assert.equal(scene.size, 5);
});

test('delete / undo restores nodes at the same index with the same ids', () => {
  const { scene, h } = setup();
  const a = makeNode('box', { name: 'A' }), b = makeNode('box', { name: 'B' }), c = makeNode('box', { name: 'C' });
  [a, b, c].forEach((n) => h.exec(C.addNode(n)));
  const before = state(scene);
  h.exec(C.removeNodes([b.id]));
  assert.deepEqual(scene.all().map((n) => n.name), ['A', 'C']);
  h.undo();
  assert.equal(state(scene), before);
});

test('deleting a group removes its subtree and undo brings it all back', () => {
  const { scene, h } = setup();
  const g = makeNode('group'); h.exec(C.addNode(g));
  h.exec(C.addNode(makeNode('box'), g.id)); h.exec(C.addNode(makeNode('box'), g.id));
  const before = state(scene);
  h.exec(C.removeNodes([g.id]));
  assert.equal(scene.size, 0);
  h.undo(); assert.equal(state(scene), before);
});

test('group / ungroup preserve world transforms and undo restores', () => {
  const { scene, h } = setup();
  const a = makeNode('box', { p: [4, 0, 0] }), b = makeNode('box', { p: [8, 0, 4] });
  h.exec(C.addNode(a)); h.exec(C.addNode(b));
  const before = state(scene);
  const gid = h.exec(C.groupNodes([a.id, b.id]));
  assert.equal(scene.get(a.id).parent, gid);
  assert.ok(Math.abs(scene.worldPosition(a.id).x - 4) < 1e-6);
  assert.ok(Math.abs(scene.worldPosition(b.id).z - 4) < 1e-6);
  h.exec(C.ungroupNode(gid));
  assert.equal(scene.get(a.id).parent, ROOT_ID);
  assert.ok(Math.abs(scene.worldPosition(b.id).x - 8) < 1e-6);
  h.undo(); h.undo();
  assert.equal(state(scene), before);
});

test('duplicate creates independent copies with new ids; undo removes only the copies', () => {
  const { scene, h } = setup();
  const w = makeNode('wall', { name: 'Wall' }); h.exec(C.addNode(w));
  const ids = h.exec(C.duplicateNodes([w.id]));
  assert.equal(scene.size, 2);
  assert.notEqual(ids[0], w.id);
  assert.equal(scene.get(ids[0]).name, 'Wall 2');
  h.exec(C.setProps(ids[0], { length: 9 }));
  assert.equal(scene.get(w.id).props.length, 4);        // original untouched
  h.undo(); h.undo();
  assert.equal(scene.size, 1);
});

test('reparent keeps world position; refuses to nest into itself', () => {
  const { scene, h } = setup();
  const g = makeNode('group', { p: [10, 0, 0], r: [0, 45, 0] }), b = makeNode('box', { p: [3, 1, 2] });
  h.exec(C.addNode(g)); h.exec(C.addNode(b));
  const w0 = scene.worldPosition(b.id).clone();
  h.exec(C.reparent([b.id], g.id));
  assert.ok(scene.worldPosition(b.id).distanceTo(w0) < 1e-5);
  assert.throws(() => h.exec(C.reparent([g.id], b.id)), /into itself/);
  h.undo();
  assert.equal(scene.get(b.id).parent, ROOT_ID);
  assert.ok(scene.worldPosition(b.id).distanceTo(w0) < 1e-5);
});

test('setTransforms with explicit "from" undoes to the pre-drag value (gizmo commit)', () => {
  const { scene, h } = setup();
  const b = makeNode('box', { p: [1, 0, 1] }); h.exec(C.addNode(b));
  const from = JSON.parse(JSON.stringify(scene.get(b.id).t));
  scene.setTransform(b.id, { p: [5, 0, 5] });          // live drag edits without history
  h.exec(C.setTransforms([{ id: b.id, from, t: { p: [5, 0, 5] } }], { label: 'Move' }));
  assert.deepEqual(scene.get(b.id).t.p, [5, 0, 5]);
  h.undo();
  assert.deepEqual(scene.get(b.id).t.p, [1, 0, 1]);
});

test('setData edits project data by path and is undoable', () => {
  const { data, h } = setup();
  h.exec(C.setData(['environment', 'fog', 'density'], 0.2));
  assert.equal(data.environment.fog.density, 0.2);
  h.undo(); assert.equal(data.environment.fog.density, 0.045);
});

test('dirty tracking follows undo/redo and save points', () => {
  const { h } = setup();
  assert.equal(h.dirty, false);
  h.exec(C.addNode(makeNode('box')));
  assert.equal(h.dirty, true);
  h.markSaved(); assert.equal(h.dirty, false);
  h.undo(); assert.equal(h.dirty, true);
  h.redo(); assert.equal(h.dirty, false);
});

test('a new edit after undo discards the redo stack', () => {
  const { h } = setup();
  const a = makeNode('box'); h.exec(C.addNode(a)); h.undo();
  assert.equal(h.canRedo, true);
  h.exec(C.addNode(makeNode('box')));
  assert.equal(h.canRedo, false);
});

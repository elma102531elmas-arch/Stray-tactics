import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../lib/three.module.js';
import { SceneModel, makeNode, ROOT_ID } from '../../js/core/scene.js';
import { TYPES, defaultProps, validateProp, localBox } from '../../js/core/schema.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test('creating a scene: empty root, nodes get unique ids and schema defaults', () => {
  const s = new SceneModel();
  assert.equal(s.size, 0);
  const a = s.insert(makeNode('wall')), b = s.insert(makeNode('wall'));
  assert.notEqual(a.id, b.id);
  assert.equal(s.size, 2);
  assert.equal(a.props.length, TYPES.wall.props.find((p) => p.key === 'length').default);
  assert.deepEqual(a.t, { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] });
});

test('unknown node types are rejected', () => { assert.throws(() => makeNode('dragon'), /Unknown node type/); });

test('placement and movement: world matrices follow parent transforms', () => {
  const s = new SceneModel();
  const g = s.insert(makeNode('group', { p: [10, 0, 0], r: [0, 90, 0] }));
  const c = s.insert(makeNode('box', { p: [2, 0, 0] }), g.id);
  const w = s.worldPosition(c.id);
  // child at local +X of a group rotated 90deg about Y ends up on world -Z
  near(w.x, 10); near(w.z, -2);
  s.setTransform(g.id, { p: [0, 5, 0] });
  near(s.worldPosition(c.id).y, 5);
});

test('localTransformFromWorld reproduces a world matrix under any parent', () => {
  const s = new SceneModel();
  const g = s.insert(makeNode('group', { p: [3, 1, -2], r: [10, 35, -20], s: [2, 2, 2] }));
  const c = s.insert(makeNode('box'), g.id);
  const target = new THREE.Matrix4().compose(new THREE.Vector3(7, 2, 4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.9, 0.1)), new THREE.Vector3(1, 1, 1));
  s.setTransform(c.id, s.localTransformFromWorld(g.id, target));
  const got = s.worldMatrix(c.id).elements, want = target.elements;
  for (let i = 0; i < 16; i++) near(got[i], want[i], 1e-5);
});

test('property edits validate against the schema', () => {
  assert.equal(validateProp('wall', 'length', 5), null);
  assert.match(validateProp('wall', 'length', -1), /at least/);
  assert.match(validateProp('wall', 'length', NaN), /finite/);
  assert.match(validateProp('door', 'state', 'ajar'), /one of/);
  assert.match(validateProp('light', 'color', 'red'), /colour/);
  assert.match(validateProp('stairs', 'steps', 2.5), /whole number/);
  assert.match(validateProp('wall', 'nope', 1), /Unknown property/);
});

test('local bounding boxes come from properties', () => {
  const w = makeNode('wall', { props: { length: 6, height: 3, thick: 0.4 } });
  assert.deepEqual(localBox(w), [-3, 0, -0.2, 3, 3, 0.2]);
  const f = makeNode('floor', { props: { w: 4, d: 2, thick: 0.1 } });
  assert.deepEqual(localBox(f), [-2, -0.1, -1, 2, 0, 1]);
});

test('hierarchy: reparent guard, descendants, removal cascades', () => {
  const s = new SceneModel();
  const g = s.insert(makeNode('group')), c = s.insert(makeNode('box'), g.id), d = s.insert(makeNode('box'), c.id);
  assert.deepEqual(s.descendants(g.id).map((n) => n.id), [c.id, d.id]);
  assert.throws(() => s.move(g.id, d.id), /into itself/);
  assert.ok(s.isDescendant(d.id, g.id));
  const { snapshot } = s.detach(g.id);
  assert.equal(s.size, 0);
  s.insertSnapshot(snapshot, ROOT_ID);
  assert.equal(s.size, 3);
  assert.equal(s.get(d.id).parent, c.id);
});

test('effective visibility / lock inherit from ancestors', () => {
  const s = new SceneModel();
  const g = s.insert(makeNode('group', { visible: false })), c = s.insert(makeNode('box'), g.id);
  assert.equal(s.isVisible(c.id), false);
  s.patch(g.id, { visible: true, locked: true });
  assert.equal(s.isVisible(c.id), true);
  assert.equal(s.isLocked(c.id), true);
});

test('JSON round trip keeps ids, order, hierarchy and props; fills new props forward-compatibly', () => {
  const s = new SceneModel();
  const g = s.insert(makeNode('group', { name: 'G' }));
  s.insert(makeNode('wall', { name: 'W', p: [1, 2, 3], props: { length: 9 } }), g.id);
  s.insert(makeNode('light', { name: 'L' }));
  const json = JSON.parse(JSON.stringify(s.toJSON()));
  json.nodes.find((n) => n.name === 'W').props = { length: 9 };           // an older file without the other wall props
  const r = SceneModel.fromJSON(json);
  assert.deepEqual(r.all().map((n) => n.name), ['G', 'W', 'L']);
  assert.equal(r.byName('W').props.length, 9);
  assert.equal(r.byName('W').props.height, defaultProps('wall').height);
  assert.equal(r.byName('W').parent, g.id);
});

test('corrupt scene files fail with readable errors', () => {
  assert.throws(() => SceneModel.fromJSON({ nodes: [{ id: 'a', name: 'x', type: 'wall', parent: 'missing', t: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } }] }), /missing parent/);
  assert.throws(() => SceneModel.fromJSON({ nodes: [{ id: 'a', name: 'x', type: 'warpdrive', parent: 'root', t: {} }] }), /unknown node type "warpdrive"/);
});

test('every registered node type builds with defaults and has a sane box', () => {
  for (const type of Object.keys(TYPES)) {
    const n = makeNode(type);
    const b = localBox(n, {});
    assert.equal(b.length, 6, type);
    assert.ok(b.every(Number.isFinite), `${type} box has non-finite values`);
    assert.ok(b[3] >= b[0] && b[4] >= b[1] && b[5] >= b[2], `${type} box is inverted`);
  }
});

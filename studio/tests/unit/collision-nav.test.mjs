import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../lib/three.module.js';
import { SceneModel, makeNode } from '../../js/core/scene.js';
import { worldColliders, wallPieces, wallOpenings, sceneBounds } from '../../js/core/geometry.js';
import { CollisionWorld } from '../../js/core/collision.js';
import { buildNavMesh } from '../../js/core/navmesh.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const build = (fn) => { const s = new SceneModel(); fn(s); return { s, w: new CollisionWorld(worldColliders(s, {})) }; };
const walk = (w, st, dx, dz, frames) => { for (let i = 0; i < frames; i++) st = w.movePlayer(st, dx, dz, 1 / 60); return st; };

test('walls are solid: a walking player stops in front of the wall', () => {
  const { w } = build((s) => { s.insert(makeNode('floor', { props: { w: 20, d: 20 } })); s.insert(makeNode('wall', { p: [0, 0, 3], props: { length: 6 } })); });
  const st = walk(w, { x: 2, y: 0, z: 0, vy: 0 }, 0, 0.05, 90);
  assert.ok(st.z < 3 - 0.1 - 0.25, `player should be stopped before the wall, z=${st.z}`);
  assert.ok(st.z > 2, `player should have reached the wall, z=${st.z}`);
  assert.ok(Math.abs(st.y) < 0.01, 'stays on the floor');
});

test('doors cut an opening in a wall only when open', () => {
  const { s, w } = build((sc) => { sc.insert(makeNode('floor', { props: { w: 20, d: 20 } })); sc.insert(makeNode('wall', { name: 'Wall', p: [0, 0, 3], props: { length: 6 } })); sc.insert(makeNode('door', { name: 'D1', p: [0, 0, 3] })); });
  const wall = s.byName('Wall');
  assert.equal(wallOpenings(s, wall).length, 1);
  const pieces = wallPieces(s, wall);
  assert.equal(pieces.length, 3);                                       // left, right, lintel
  let st = walk(w, { x: 0, y: 0, z: 0, vy: 0 }, 0, 0.05, 120);
  assert.ok(st.z < 2.8, `closed door blocks, z=${st.z}`);
  w.doorOpen.set('D1', true);
  st = walk(w, st, 0, 0.05, 120);
  assert.ok(st.z > 3.4, `open door lets the player through, z=${st.z}`);
});

test('a door far from any wall does not cut it', () => {
  const { s } = build((sc) => { sc.insert(makeNode('wall', { name: 'Wall', p: [0, 0, 3], props: { length: 6 } })); sc.insert(makeNode('door', { p: [0, 0, 9] })); });
  assert.equal(wallOpenings(s, s.byName('Wall')).length, 0);
});

test('a rotated door aligned to a rotated wall still cuts it', () => {
  const { s } = build((sc) => { sc.insert(makeNode('wall', { name: 'Wall', p: [4, 0, 4], r: [0, 90, 0], props: { length: 6 } })); sc.insert(makeNode('door', { p: [4, 0, 4], r: [0, 90, 0] })); });
  assert.equal(wallOpenings(s, s.byName('Wall')).length, 1);
});

test('stairs can be climbed, a tall block cannot', () => {
  const { w } = build((s) => {
    s.insert(makeNode('floor', { props: { w: 30, d: 30 } }));
    s.insert(makeNode('stairs', { p: [0, 0, 2], props: { steps: 10, stepH: 0.18, stepD: 0.3 } }));
    s.insert(makeNode('box', { p: [6, 0, 0], props: { w: 2, h: 2, d: 2 } }));
  });
  let st = walk(w, { x: 0, y: 0, z: 0, vy: 0 }, 0, 0.05, 92);       // 4.6 m: stops on the top platform (stairs end at z=5)
  assert.ok(st.y > 1.6, `climbed the stairs, y=${st.y}`);
  st = walk(w, { x: 3, y: 0, z: 0, vy: 0 }, 0.05, 0, 120);
  assert.ok(st.x < 5.0 && st.y < 0.1, `a 2 m block stops the player, x=${st.x} y=${st.y}`);
});

test('raycast hits, misses and reports the nearest face', () => {
  const { w } = build((s) => { s.insert(makeNode('box', { p: [0, 0, 5], props: { w: 2, h: 2, d: 2 } })); });
  const hit = w.raycast(V(0, 1, 0), V(0, 0, 1), 20);
  assert.ok(hit); assert.ok(Math.abs(hit.point.z - 4) < 1e-6); assert.ok(hit.normal.z < -0.99);
  assert.equal(w.raycast(V(5, 1, 0), V(0, 0, 1), 20), null);
});

test('line of sight is blocked by walls and not by open space', () => {
  const { w } = build((s) => { s.insert(makeNode('wall', { p: [0, 0, 5], props: { length: 8 } })); });
  assert.equal(w.hasLineOfSight(V(0, 1.5, 0), V(0, 1.5, 10)), false);
  assert.equal(w.hasLineOfSight(V(0, 1.5, 0), V(0, 1.5, 4)), true);
});

test('navmesh: finds a path around an obstacle and flags unreachable islands', () => {
  const { s, w } = build((sc) => {
    sc.insert(makeNode('floor', { props: { w: 20, d: 20 } }));
    sc.insert(makeNode('wall', { p: [0, 0, 0], props: { length: 14 } }));           // wall across the middle, open at both ends
    sc.insert(makeNode('floor', { p: [30, 0, 0], props: { w: 6, d: 6 } }));          // island far away
  });
  const nav = buildNavMesh(w, sceneBounds(s, {}), { seeds: [V(0, 0, -5)] });
  assert.ok(nav.stats.components >= 2, JSON.stringify(nav.stats));
  const path = nav.findPath(V(0, 0, -5), V(0, 0, 5));
  assert.ok(path && path.length > 2, 'path exists');
  assert.ok(path.some((p) => Math.abs(p.x) > 6.5), 'path detours around the wall end');
  assert.equal(nav.findPath(V(0, 0, -5), V(30, 0, 0)), null, 'no path onto the island');
  assert.equal(nav.isReachable(V(30, 0, 0)), false);
  assert.equal(nav.isReachable(V(0, 0, 5)), true);
});

test('navmesh respects nav blockers', () => {
  const { s, w } = build((sc) => { sc.insert(makeNode('floor', { props: { w: 10, d: 10 } })); sc.insert(makeNode('navBlocker', { p: [0, 1, 0], props: { size: [10, 2, 2] } })); });
  const nav = buildNavMesh(w, sceneBounds(s, {}), { seeds: [V(0, 0, -4)] });
  assert.equal(nav.findPath(V(0, 0, -4), V(0, 0, 4)), null);
});

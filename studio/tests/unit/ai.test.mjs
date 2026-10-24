import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../lib/three.module.js';
import { SceneModel, makeNode } from '../../js/core/scene.js';
import { worldColliders, sceneBounds } from '../../js/core/geometry.js';
import { CollisionWorld } from '../../js/core/collision.js';
import { buildNavMesh } from '../../js/core/navmesh.js';
import { EnemyAgent, defaultArchetype, validateArchetype, REFERENCE_ARCHETYPES, BEHAVIORS, CONDITIONS } from '../../js/core/ai.js';
import { HOLLOW_REFERENCE, WARDEN_REFERENCE } from '../../js/core/game-constants.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function arena(fn) {
  const s = new SceneModel();
  s.insert(makeNode('floor', { props: { w: 40, d: 40 } }));
  fn?.(s);
  const world = new CollisionWorld(worldColliders(s, {}));
  const nav = buildNavMesh(world, sceneBounds(s, {}), { seeds: [V(0, 0, 0)] });
  return { s, world, nav };
}
const run = (agent, secs, ctx, dt = 1 / 30) => { for (let i = 0; i < secs / dt; i++) agent.update(dt, typeof ctx === 'function' ? ctx(agent) : ctx); };
const player = (x, z) => ({ pos: V(x, 0, z), radius: 0.3 });

test('default archetype is valid; every behaviour/condition it uses is defined', () => {
  const a = defaultArchetype('Test');
  const issues = validateArchetype(a);
  assert.deepEqual(issues.filter((i) => i.severity !== 'info'), []);
  for (const n of a.graph.nodes) assert.ok(BEHAVIORS[n.data.behavior], n.data.behavior);
  for (const e of a.graph.edges) assert.ok(CONDITIONS[e.data.cond], e.data.cond);
});

test('reference archetypes carry the game\'s own numbers and are read-only', () => {
  const h = REFERENCE_ARCHETYPES.ref_hollow(), w = REFERENCE_ARCHETYPES.ref_warden();
  assert.equal(h.walkSpeed, HOLLOW_REFERENCE.walkSpeed); assert.equal(h.attack.damage, HOLLOW_REFERENCE.attack.damage); assert.equal(h.vision.range, 15);
  assert.equal(w.invulnerable, true); assert.equal(w.attack.damage, WARDEN_REFERENCE.attack.damage);
  assert.ok(h.readOnly && h.imported && /NOT the game's code/.test(h.notes));
});

test('validation: missing start, stuck states, dead links, unreachable states, bad phases', () => {
  const a = defaultArchetype(); a.start = 'nope';
  assert.ok(validateArchetype(a).some((i) => /start state/.test(i.message)));
  const b = defaultArchetype(); b.graph.edges = b.graph.edges.filter((e) => e.from.node !== 'wander');
  assert.ok(validateArchetype(b).some((i) => /no way out/.test(i.message) && /Wander/.test(i.message)));
  const c = defaultArchetype(); c.graph.edges.push({ id: 'x', from: { node: 'idle', port: 'out' }, to: { node: 'ghost', port: 'in' }, data: { cond: 'always' } });
  assert.ok(validateArchetype(c).some((i) => /no longer exists/.test(i.message)));
  const d = defaultArchetype(); d.phases = [{ id: 'p', name: 'Rage', hpBelow: 150 }];
  assert.ok(validateArchetype(d).some((i) => /out of range/.test(i.message)));
  const e = defaultArchetype(); e.graph.edges = e.graph.edges.filter((x) => !(x.from.node === 'chase' && ['nearPlayer', 'lostSight'].includes(x.data.cond)));
  assert.ok(validateArchetype(e).some((i) => /chases forever/.test(i.message)));
});

test('sight: inside the cone and range with line of sight; not behind, not too far, not through walls; close targets are always seen', () => {
  const { world } = arena((s) => { s.insert(makeNode('wall', { p: [0, 0, -6], props: { length: 6 } })); });
  const e = new EnemyAgent(defaultArchetype(), { pos: [0, 0, 0], yaw: 0, collision: world, startState: 'idle' });   // yaw 0 faces -Z
  assert.equal(e.canSee(V(0, 0, -4)), true, 'in front');
  assert.equal(e.canSee(V(0, 0, 4)), false, 'behind');
  assert.equal(e.canSee(V(0, 0, -20)), false, 'out of range');
  assert.equal(e.canSee(V(0, 0, -10)), false, 'behind a wall');
  assert.equal(e.canSee(V(0, 0, 1.5)), true, 'within the always-seen radius even when behind');
  assert.equal(e.canSee(V(12, 0, -1)), false, 'outside the 71.6° half angle');
});

test('hearing: noises are heard inside their radius only; last heard position is remembered', () => {
  const { world } = arena();
  const e = new EnemyAgent(defaultArchetype(), { pos: [0, 0, 0], yaw: 0, collision: world });
  e.update(0.05, { player: player(30, 30), noises: [{ pos: V(8, 0, 0), radius: 6, t: 0 }], time: 0 });
  assert.equal(e.heardNoise, false);
  e.update(0.05, { player: player(30, 30), noises: [{ pos: V(3, 0, 0), radius: 6, t: 0.1 }], time: 0.1 });
  assert.equal(e.heardNoise, true); assert.deepEqual(e.lastHeard.toArray(), [3, 0, 0]);
});

test('behaviour flow: idle → hears → investigate → reaches → search, then spots the player → chase → attack (damage after the windup) → back to chase', () => {
  const { world, nav } = arena();
  const hits = [];
  const e = new EnemyAgent(defaultArchetype(), { pos: [0, 0, 0], yaw: 0, collision: world, nav, startState: 'idle' });
  const noise = { pos: V(0, 0, -6), radius: 20, t: 0 };
  e.update(0.05, { player: player(30, 30), noises: [noise], time: 0 });
  assert.equal(e.states.get(e.state).data.name, 'Investigate');
  run(e, 8, { player: player(30, 30), noises: [] });
  assert.equal(e.states.get(e.state).data.name, 'Search', e.states.get(e.state).data.name);
  const ahead = e.pos.clone().add(e.facing().multiplyScalar(6));          // appears right in front of it
  const P = player(ahead.x, ahead.z);
  run(e, 1, { player: P, noises: [], damagePlayer: (d) => hits.push(d) });
  const names = e.history.map((h) => e.states.get(h.to).data.name);
  assert.ok(names.includes('Chase'), names.join('>'));
  run(e, 12, { player: P, noises: [], damagePlayer: (d) => hits.push(d) });
  assert.ok(hits.length >= 1, 'attack landed');
  assert.equal(hits[0].amount, 15);
  assert.ok(e.pos.distanceTo(P.pos) < 2, 'it walked up to the player');
});

test('attack windup: no damage before the windup ends; none if the player stepped out of reach', () => {
  const { world } = arena();
  const hits = [];
  const e = new EnemyAgent(defaultArchetype(), { pos: [0, 0, 0], yaw: 0, collision: world, startState: 'attack' });
  e.update(0.2, { player: player(0, -1), noises: [], damagePlayer: (d) => hits.push(d) });
  assert.equal(hits.length, 0);
  const e2 = new EnemyAgent(defaultArchetype(), { pos: [0, 0, 0], yaw: 0, collision: world, startState: 'attack' });
  run(e2, 1, { player: player(0, -6), noises: [], damagePlayer: (d) => hits.push(d) });
  assert.equal(hits.length, 0, 'player out of hit reach');
});

test('chasing finds a path around an obstacle (navmesh) and gives up after losing sight', () => {
  const { world, nav } = arena((s) => { s.insert(makeNode('wall', { p: [0, 0, -5], props: { length: 12 } })); });
  const e = new EnemyAgent(defaultArchetype(), { pos: [0, 0, 0], yaw: 0, collision: world, nav, startState: 'chase' });
  e.lastSeen = V(0, 0, -10); e.lastSeenAt = 0;
  run(e, 6, { player: player(0, -10), noises: [] });
  assert.ok(e.pos.z < -4, `went around the wall (z=${e.pos.z.toFixed(1)})`);
  assert.ok(Math.abs(e.pos.x) > 3 || e.pos.z < -6, 'took a detour instead of walking through the wall');
  const far = new EnemyAgent(defaultArchetype(), { pos: [0, 0, 0], yaw: 0, collision: world, nav, startState: 'chase' });
  run(far, 8, { player: player(0, -30), noises: [] });
  assert.equal(far.states.get(far.state).data.name, 'Search', 'lost sight for 4 s → search');
});

test('damage: weak spots multiply, invulnerable enemies only stagger, killing switches to the dead state and stops it', () => {
  const a = defaultArchetype();
  const e = new EnemyAgent(a, { pos: [0, 0, 0], collision: null, startState: 'idle' });
  assert.equal(e.takeDamage(10, 'head'), 26); assert.equal(e.hp, 74);
  assert.equal(e.takeDamage(10, 'arm'), 6);
  e.takeDamage(1000, 'body');
  assert.equal(e.behavior, 'dead'); assert.equal(e.alive, false);
  const pos = e.pos.clone(); e.update(1, { player: player(1, 1), noises: [] });
  assert.ok(e.pos.equals(pos));
  const inv = new EnemyAgent({ ...a, invulnerable: true }, { pos: [0, 0, 0], collision: null, startState: 'chase' });
  assert.equal(inv.takeDamage(500, 'head', { heavy: true }), 0);
  inv.update(0.05, { player: player(10, 0), noises: [] });
  assert.equal(inv.states.get(inv.state).data.name, 'Stagger', 'heavy hit staggers an invulnerable enemy');
});

test('boss phases: crossing a health threshold fires its event once and overrides speed / damage', () => {
  const a = defaultArchetype('Boss'); a.health = 200;
  a.phases = [{ id: 'p1', name: 'Enraged', hpBelow: 60, event: 'boss-enraged', overrides: { runSpeed: 6, attack: { damage: 40 } } }];
  const events = [];
  const e = new EnemyAgent(a, { pos: [0, 0, 0], collision: null, startState: 'idle', emit: (n) => events.push(n) });
  e.takeDamage(60); e.update(0.05, { player: player(30, 30), noises: [] });
  assert.equal(events.includes('boss-enraged'), false);
  assert.equal(e.params.runSpeed, a.runSpeed);
  e.takeDamage(40); e.update(0.05, { player: player(30, 30), noises: [] });
  assert.equal(events.filter((x) => x === 'boss-enraged').length, 1);
  assert.equal(e.params.runSpeed, 6); assert.equal(e.params.attack.damage, 40);
  e.takeDamage(1); e.update(0.05, { player: player(30, 30), noises: [] });
  assert.equal(events.filter((x) => x === 'boss-enraged').length, 1, 'only once');
  assert.equal(a.attack.damage, 15, 'the archetype data is not modified by phases');
});

test('wander picks reachable points and keeps moving; patrol visits waypoints in order and loops', () => {
  const { world, nav } = arena();
  let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const w = new EnemyAgent(defaultArchetype(), { pos: [0, 0, 0], yaw: 0, collision: world, nav, rng, startState: 'wander' });
  w.states.get('wander').data.behavior = 'wander';
  const moved = (() => { let d = 0, last = w.pos.clone(); for (let i = 0; i < 300; i++) { w.update(1 / 30, { player: player(100, 100), noises: [] }); d += w.pos.distanceTo(last); last = w.pos.clone(); if (w.states.get(w.state).data.name !== 'Wander') w.setState('wander'); } return d; })();
  assert.ok(moved > 5, `wandered ${moved.toFixed(1)} m`);
  const a = defaultArchetype(); a.graph.nodes.find((n) => n.id === 'idle').data.behavior = 'patrol';
  const wps = [V(5, 0, 0), V(5, 0, 5), V(0, 0, 5)];
  const p = new EnemyAgent(a, { pos: [0, 0, 0], collision: world, nav, patrol: wps, startState: 'idle' });
  const visited = new Set();
  for (let i = 0; i < 900; i++) { p.update(1 / 30, { player: player(100, 100), noises: [] }); if (p.states.get(p.state).data.name !== 'Idle') p.setState('idle'); wps.forEach((wp, k) => { if (p.pos.distanceTo(wp) < 0.8) visited.add(k); }); }
  assert.deepEqual([...visited].sort(), [0, 1, 2], 'visited every waypoint');
});

test('events can drive transitions ("event" condition) and onEnter emits game events', () => {
  const a = defaultArchetype();
  a.graph.edges.push({ id: 'ev', from: { node: 'idle', port: 'out' }, to: { node: 'chase', port: 'in' }, data: { cond: 'event', name: 'alarm', priority: 5 } });
  a.graph.nodes.find((n) => n.id === 'chase').data.onEnter = 'enemy-chasing';
  const emitted = [];
  const e = new EnemyAgent(a, { pos: [0, 0, 0], collision: null, startState: 'idle', emit: (n) => emitted.push(n) });
  e.update(0.05, { player: player(50, 50), noises: [] });
  assert.equal(e.states.get(e.state).data.name, 'Idle');
  e.signal('alarm'); e.update(0.05, { player: player(50, 50), noises: [] });
  assert.equal(e.states.get(e.state).data.name, 'Chase');
  assert.ok(emitted.includes('enemy-chasing'));
});

test('debug snapshot reports state, perception, path and recent transitions', () => {
  const { world, nav } = arena();
  const e = new EnemyAgent(defaultArchetype(), { pos: [0, 0, 0], yaw: 0, collision: world, nav, startState: 'chase' });
  e.update(0.05, { player: player(0, -8), noises: [] });
  const d = e.debug();
  assert.equal(d.state, 'Chase'); assert.equal(d.sees, true); assert.ok(d.path.length >= 1); assert.ok(d.history.length >= 1);
});

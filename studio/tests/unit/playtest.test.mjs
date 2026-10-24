import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../../js/core/project.js';
import { makeNode } from '../../js/core/scene.js';
import { PlaytestWorld } from '../../js/core/playtest.js';
import { newGraph, newNode } from '../../js/core/events.js';
import { PLAYER_REFERENCE } from '../../js/core/game-constants.js';

function map(fn) {
  const p = new Project('pt'); const S = p.scene;
  S.insert(makeNode('floor', { props: { w: 40, d: 40 } }));
  S.insert(makeNode('playerSpawn', { p: [0, 0, 0] }));                                   // yaw 0 faces -Z
  S.insert(makeNode('wall', { name: 'Wall', p: [0, 0, -3], props: { length: 8 } }));
  S.insert(makeNode('door', { name: 'D1', p: [0, 0, -3], props: { doorId: 'D1', locked: 'item:key' } }));
  fn?.(p, S);
  return p;
}
const graph = (nodes, edges) => { const g = newGraph('g'); const ids = {}; for (const [k, [t, d]] of Object.entries(nodes)) { const n = newNode(t, 0, 0, d); ids[k] = n.id; g.nodes.push(n); } edges.forEach(([a, port, b], i) => g.edges.push({ id: 'e' + i, from: { node: ids[a], port }, to: { node: ids[b], port: 'in' } })); return g; };
const walk = (w, secs, input) => { for (let i = 0; i < secs * 60; i++) w.step(1 / 60, input); };
/** Point the player's view at a world position (game yaw 0 faces -Z). */
const lookAt = (w, x, y, z) => { const e = w.eye(); const dx = x - e.x, dy = y - e.y, dz = z - e.z; w.player.yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI; w.player.pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI; };
const snapshot = (p) => JSON.stringify(p.scene.toJSON());

test('the player spawns at the spawn point, on the floor', () => {
  const w = new PlaytestWorld(map());
  assert.ok(Math.abs(w.player.x) < 1e-6 && Math.abs(w.player.z) < 1e-6);
  assert.equal(w.player.grounded, true); assert.ok(Math.abs(w.player.y) < 0.01);
});

test('walking forward is stopped by a closed door/wall; speeds follow the game reference values', () => {
  const w = new PlaytestWorld(map());
  walk(w, 1, { my: 1 });
  assert.ok(Math.abs(-w.player.z - PLAYER_REFERENCE.walkSpeed) < 0.1, `1 s walking covers ~${PLAYER_REFERENCE.walkSpeed} m, got ${-w.player.z}`);
  walk(w, 4, { my: 1 });
  assert.ok(w.player.z > -3 + 0.1, `stopped by the door at z=-3, got ${w.player.z}`);
  const sprint = new PlaytestWorld(map()); walk(sprint, 0.5, { my: 1, sprint: true });
  assert.ok(-sprint.player.z > PLAYER_REFERENCE.walkSpeed * 0.5 * 1.6, 'sprinting is faster');
});

test('looking: yaw turns the view; the door is only "in focus" when looked at and in reach', () => {
  const w = new PlaytestWorld(map());
  w.player.z = -1.2; w.player.yaw = 0;
  assert.equal(w.focus()?.kind, 'door'); assert.equal(w.focus().label, 'locked');
  w.player.yaw = 180; assert.equal(w.focus(), null);
  w.player.yaw = 0; w.player.z = 3;
  assert.equal(w.focus(), null, 'too far away');
});

test('item lock: refused with a message until the key is picked up, then unlocks, opens, and the player walks through', () => {
  const p = map((pp, S) => { S.insert(makeNode('itemSpawn', { name: 'Key', p: [0, 0, -1.2], props: { item: 'key' } })); });
  const w = new PlaytestWorld(p);
  // look at the item first (it sits in front of the door)
  w.player.z = -0.4; lookAt(w, 0, 0.2, -1.2);
  assert.equal(w.focus()?.kind, 'item');
  assert.deepEqual(w.use(), { kind: 'item', item: 'key' });
  assert.equal(w.inventory.key, 1);
  w.player.z = -1.6; w.player.yaw = 0; w.player.pitch = 0;
  assert.equal(w.focus()?.kind, 'door');
  const r = w.use(); assert.equal(r.ok, true);
  assert.equal(w.doors.get('D1').open, true); assert.equal(w.doors.get('D1').locked, '');
  w.player.yaw = 0; walk(w, 3, { my: 1 });
  assert.ok(w.player.z < -3.5, `walked through the open door, z=${w.player.z}`);
  assert.ok(w.runtime.effects.some((e) => e.type === 'event' && e.name === 'door:open:D1'));
});

test('without the key: message, door stays shut', () => {
  const w = new PlaytestWorld(map());
  w.player.z = -1.6;
  const r = w.use();
  assert.equal(r.ok, false); assert.match(r.message, /You need: key/);
  assert.equal(w.doors.get('D1').open, false);
  assert.ok(w.messages.some((m) => /You need: key/.test(m.text)));
});

test('keypad lock asks for a code, rejects wrong ones, accepts the right one', () => {
  const p = map((pp, S) => { S.get(S.byName('D1').id).props.locked = 'code:4711'; });
  const w = new PlaytestWorld(p); w.player.z = -1.6;
  assert.equal(w.use().needsCode, true);
  assert.equal(w.use({ code: '0000' }).ok, false); assert.equal(w.doors.get('D1').open, false);
  assert.equal(w.use({ code: '4711' }).ok, true); assert.equal(w.doors.get('D1').open, true);
});

test('power / chain / jammed locks show the game\'s message; "script" locks emit use:<id> so a graph can react', () => {
  for (const [lock, re] of [['power', /no power/], ['chain', /chained/], ['jammed', /jammed/]]) {
    const w = new PlaytestWorld(map((pp, S) => { S.byName('D1').props.locked = lock; })); w.player.z = -1.6;
    assert.match(w.use().message, re);
  }
  const g = graph({ t: ['on.event', { name: 'use:D1' }], u: ['act.door', { doorId: 'D1', action: 'unlock' }], o: ['act.door', { doorId: 'D1', action: 'open' }] }, [['t', 'out', 'u'], ['u', 'out', 'o']]);
  const p = map((pp, S) => { S.byName('D1').props.locked = 'script'; pp.data.events.graphs[g.id] = g; });
  const w = new PlaytestWorld(p); w.player.z = -1.6;
  w.use();
  assert.equal(w.doors.get('D1').open, true);
});

test('trigger volumes fire their enter event once; graphs react (lights, text); exiting fires onExit', () => {
  const g = graph({ t: ['on.event', { name: 'hall-entered' }], l: ['act.light', { group: 'hall', action: 'off' }], s: ['act.say', { text: 'The lights die.' }] }, [['t', 'out', 'l'], ['l', 'out', 's']]);
  const p = map((pp, S) => { S.byName('D1').props.locked = ''; S.insert(makeNode('trigger', { name: 'Hall zone', p: [0, 1, -6], props: { size: [6, 3, 4], onEnter: 'hall-entered', onExit: 'hall-left', once: true } })); pp.data.events.graphs[g.id] = g; });
  const w = new PlaytestWorld(p);
  w.world.doorOpen.set('D1', true); w.doors.get('D1').open = true;
  walk(w, 5, { my: 1 });
  assert.equal(w.lights.hall, 'off');
  assert.ok(w.messages.some((m) => /lights die/.test(m.text)));
  assert.equal(w.fired.filter((f) => f.trigger === 'Hall zone').length, 1);
  walk(w, 4, { my: 1 });                                   // keep walking out the far side
  assert.ok(w.runtime.effects.some((e) => e.type === 'event' && e.name === 'hall-left'));
});

test('disabled triggers do nothing until a graph enables them', () => {
  const p = map((pp, S) => { S.byName('D1').props.locked = ''; S.insert(makeNode('trigger', { name: 'Zone', p: [0, 1, 0], props: { size: [4, 3, 4], onEnter: 'zone', enabled: false } })); });
  const w = new PlaytestWorld(p); walk(w, 0.5, {});
  assert.equal(w.fired.length, 0);
  w.enabled.set(w.scene.byName('Zone').id, true);
  w.volumes[0].inside = false; walk(w, 0.2, {});
  assert.equal(w.fired.length, 1);
});

test('interaction volumes: need items, honour "once", emit their event', () => {
  const p = map((pp, S) => { S.insert(makeNode('interaction', { name: 'Lever', p: [0, 1.3, -1.6], props: { size: [0.8, 0.8, 0.6], event: 'lever', requires: 'handle', once: true, prompt: 'pull' } })); S.byName('D1').props.locked = ''; });
  const w = new PlaytestWorld(p); w.player.z = -1.0;
  assert.equal(w.focus()?.kind, 'interaction'); assert.equal(w.focus().label, 'pull');
  assert.equal(w.use().ok, false);
  w.inventory.handle = 1;
  assert.deepEqual(w.use(), { kind: 'interaction', ok: true, event: 'lever' });
  assert.notEqual(w.focus()?.kind, 'interaction', 'single-use interaction is gone');
});

test('checkpoints save state and restore it', () => {
  const p = map((pp, S) => { S.insert(makeNode('checkpoint', { name: 'CP', p: [0, 1, 1.5], props: { size: [4, 3, 3], checkpointId: 'cp1' } })); S.insert(makeNode('itemSpawn', { name: 'Coin', p: [0, 0, -1.2], props: { item: 'coin' } })); S.byName('D1').props.locked = ''; });
  const w = new PlaytestWorld(p);
  walk(w, 0.5, {});
  assert.equal(w.checkpointSnap?.id, 'cp1');
  w.player.z = -0.4; lookAt(w, 0, 0.2, -1.2); w.use();
  w.runtime.setFlag('seen', true); w.player.x = 7;
  assert.equal(w.inventory.coin, 1);
  assert.equal(w.restoreCheckpoint(), true);
  assert.equal(w.inventory.coin, undefined); assert.ok(Math.abs(w.player.x) < 1e-6); assert.equal(w.runtime.state.flags.seen, undefined);
  assert.equal(w.used.size, 0);
});

test('walking makes noise sized by speed (for enemy hearing); crouching is quiet', () => {
  const a = new PlaytestWorld(map()); walk(a, 1, { my: 1 });
  const b = new PlaytestWorld(map()); walk(b, 2, { my: 1, crouch: true });
  const c = new PlaytestWorld(map()); walk(c, 1, { my: 1, sprint: true });
  const maxR = (w) => Math.max(0, ...w.noises.map((n) => n.radius), ...w.runtime.effects.map(() => 0));
  const noisy = new PlaytestWorld(map()); let seen = [];
  for (let i = 0; i < 180; i++) { noisy.step(1 / 60, { my: 1, sprint: true }); seen.push(...noisy.noises.map((n) => n.radius)); }
  assert.ok(seen.includes(11), 'sprint footsteps radius 11 m');
  const quiet = new PlaytestWorld(map()); seen = [];
  for (let i = 0; i < 240; i++) { quiet.step(1 / 60, { my: 1, crouch: true }); seen.push(...quiet.noises.map((n) => n.radius)); }
  assert.ok(seen.every((r) => r <= 1.5) && seen.length > 0, 'crouch footsteps radius 1.5 m');
});

test('playtest NEVER modifies the scene model', () => {
  const p = map((pp, S) => { S.insert(makeNode('itemSpawn', { name: 'Key', p: [0, 0, -1.2], props: { item: 'key' } })); S.insert(makeNode('trigger', { name: 'Z', p: [0, 1, 0], props: { size: [4, 3, 4], onEnter: 'z' } })); });
  const before = snapshot(p);
  const w = new PlaytestWorld(p);
  w.player.z = -0.4; lookAt(w, 0, 0.2, -1.2); w.use(); w.player.pitch = 0; w.player.yaw = 0; w.player.z = -1.6; w.use();
  walk(w, 3, { my: 1 });
  w.saveCheckpoint('x'); w.restoreCheckpoint();
  assert.equal(snapshot(p), before);
});

test('door visuals animate toward the open state', () => {
  const w = new PlaytestWorld(map((pp, S) => { S.byName('D1').props.locked = ''; })); w.player.z = -1.6;
  w.use(); assert.equal(w.doors.get('D1').amount, 0);
  walk(w, 0.2, {}); assert.ok(w.doors.get('D1').amount > 0.3 && w.doors.get('D1').amount < 1);
  walk(w, 0.5, {}); assert.equal(w.doors.get('D1').amount, 1);
});

test('maps without a spawn still start (with a message), event graphs run on map start', () => {
  const p = new Project('x'); p.scene.insert(makeNode('floor'));
  const g = graph({ t: ['on.start', {}], s: ['act.say', { text: 'hello' }] }, [['t', 'out', 's']]); p.data.events.graphs[g.id] = g;
  const w = new PlaytestWorld(p);
  assert.ok(w.messages.some((m) => /No player spawn/.test(m.text)) && w.messages.some((m) => /hello/.test(m.text)));
});

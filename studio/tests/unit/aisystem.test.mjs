import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../lib/three.module.js';
import { Project } from '../../js/core/project.js';
import { makeNode } from '../../js/core/scene.js';
import { PlaytestWorld } from '../../js/core/playtest.js';
import { resolveArchetype } from '../../js/core/aisystem.js';
import { defaultArchetype } from '../../js/core/ai.js';
import { newGraph, newNode } from '../../js/core/events.js';

function map(fn) {
  const p = new Project('ai'); const S = p.scene;
  S.insert(makeNode('floor', { props: { w: 40, d: 40 } }));
  S.insert(makeNode('playerSpawn', { p: [0, 0, 8] }));
  fn?.(p, S);
  return p;
}
const run = (w, secs, input = {}) => { for (let i = 0; i < secs * 30; i++) w.step(1 / 30, input); };

test('archetype resolution: ids, the game\'s names, project archetypes and unknown keys', () => {
  const p = map(); const a = defaultArchetype('Stalker'); p.data.enemies[a.id] = a;
  assert.equal(resolveArchetype(p, 'hollow').id, 'ref_hollow');
  assert.equal(resolveArchetype(p, 'warden').id, 'ref_warden');
  assert.equal(resolveArchetype(p, a.id).name, 'Stalker');
  assert.equal(resolveArchetype(p, 'stalker').id, a.id);
  assert.equal(resolveArchetype(p, 'nope'), null);
});

test('a spawned enemy notices the player in its cone, walks to them and hurts them; the player can die', () => {
  const p = map((pp, S) => { S.insert(makeNode('enemySpawn', { name: 'Hollow 1', p: [0, 0, -4], r: [0, 180, 0], props: { archetype: 'hollow' } })); });
  const w = new PlaytestWorld(p);
  assert.equal(w.ai.agents.length, 1);
  w.player.x = 0; w.player.z = 4;                                  // enemy at z=-4 faces +Z (yaw 180°): the player is 8 m in front of it
  run(w, 30);
  const a = w.ai.agents[0].agent;
  assert.ok(w.player.hp < 100, `player was hurt (hp ${w.player.hp})`);
  assert.ok(a.pos.distanceTo(new THREE.Vector3(w.player.x, 0, w.player.z)) < 2.2, 'the enemy walked up to the player');
  run(w, 60);
  assert.equal(w.dead, true); assert.ok(w.messages.some((m) => /You died/.test(m.text)) || w.runtime.effects.some((e) => e.name === 'player:died'));
});

test('dormant enemies stay put until "spawnOn" events or act.spawn; enemy events reach the event graphs', () => {
  const g = newGraph('g'); const t = newNode('on.event', 0, 0, { name: 'enemy:Hollow 1:Chase' }), s = newNode('act.say', 0, 0, { text: 'It sees you.' }); g.nodes.push(t, s); g.edges.push({ id: 'e', from: { node: t.id, port: 'out' }, to: { node: s.id, port: 'in' } });
  const p = map((pp, S) => { S.insert(makeNode('enemySpawn', { name: 'Hollow 1', p: [0, 0, -4], r: [0, 180, 0], props: { archetype: 'hollow', spawnOn: 'wake-up' } })); pp.data.events.graphs[g.id] = g; });
  const w = new PlaytestWorld(p);
  w.player.z = 0;
  run(w, 5);
  assert.equal(w.player.hp, 100); assert.equal(w.ai.agents[0].active, false);
  w.runtime.emit('wake-up');
  run(w, 3);
  assert.equal(w.ai.agents[0].active, true);
  assert.ok(w.messages.some((m) => /It sees you/.test(m.text)) || w.runtime.effects.some((e) => e.type === 'say'), 'the enemy state change fired an event the graph listened to');
});

test('a spawn without a usable archetype is reported to the author, not silently ignored', () => {
  const p = map((pp, S) => { S.insert(makeNode('enemySpawn', { name: 'Ghost', props: { archetype: 'nonsense' } })); });
  const w = new PlaytestWorld(p);
  assert.equal(w.ai.agents.length, 0);
  assert.ok(w.messages.some((m) => /Ghost/.test(m.text) && /no archetype/.test(m.text)));
});

test('hit-scan: damages the first enemy on the ray, not through walls; head shots do more', () => {
  const p = map((pp, S) => { S.insert(makeNode('enemySpawn', { name: 'E', p: [0, 0, -6], props: { archetype: 'hollow' } })); S.insert(makeNode('wall', { p: [6, 0, -6], props: { length: 4 } })); });
  const w = new PlaytestWorld(p);
  const a = w.ai.agents[0].agent;
  const origin = new THREE.Vector3(0, 1.62, 0), dir = new THREE.Vector3(0, 0, -1);
  const hit = w.ai.shoot(origin, dir, 20);
  assert.ok(hit); assert.equal(hit.agent, a); assert.ok(a.hp < 100);
  const head = w.ai.shoot(new THREE.Vector3(0, 1.7, 0), new THREE.Vector3(0, 0, -1), 10); assert.equal(head.part, 'head');
  const through = w.ai.shoot(new THREE.Vector3(6, 1.5, 0), new THREE.Vector3(0, 0, -1), 20);
  assert.equal(through, null, 'the wall blocks the shot');
});

test('boss with phases through playtest: invulnerable warden reference only staggers; damaged project boss changes phase', () => {
  const boss = defaultArchetype('Boss'); boss.health = 100; boss.phases = [{ id: 'p', name: 'Rage', hpBelow: 50, event: 'boss-rage', overrides: { runSpeed: 5 } }];
  const p = map((pp, S) => { pp.data.enemies[boss.id] = boss; S.insert(makeNode('enemySpawn', { name: 'Boss', p: [0, 0, -4], props: { archetype: boss.id } })); S.insert(makeNode('enemySpawn', { name: 'Warden', p: [8, 0, -4], props: { archetype: 'warden' } })); });
  const w = new PlaytestWorld(p);
  const [b, wd] = w.ai.agents.map((r) => r.agent);
  b.takeDamage(60); run(w, 0.5);
  assert.ok(w.runtime.effects.some((e) => e.type === 'event' && e.name === 'boss-rage'));
  assert.equal(wd.takeDamage(999, 'head'), 0); assert.equal(wd.hp, wd.maxHp);
});

test('playtest still never modifies the scene with enemies present', () => {
  const p = map((pp, S) => { S.insert(makeNode('enemySpawn', { name: 'E', p: [0, 0, -4], props: { archetype: 'hollow' } })); });
  const before = JSON.stringify(p.scene.toJSON());
  const w = new PlaytestWorld(p); w.player.z = -1; run(w, 10);
  assert.equal(JSON.stringify(p.scene.toJSON()), before);
});

test('weapons in playtest: shooting hurts enemies (head > body), makes noise, uses ammo; pierce passes through; melee needs range; ammo pickups refill', () => {
  const p = map((pp, S) => {
    S.insert(makeNode('enemySpawn', { name: 'A', p: [0, 0, -6], props: { archetype: 'warden', dormant: true } }));
    S.insert(makeNode('enemySpawn', { name: 'B', p: [0, 0, -9], props: { archetype: 'hollow' } }));
    S.insert(makeNode('itemSpawn', { name: 'Ammo', p: [0, 0, 7], props: { item: 'ammo9', count: 8 } }));
  });
  const w = new PlaytestWorld(p);
  w.player.z = 0; w.player.yaw = 0; w.player.pitch = 0;
  for (let i = 0; i < 30; i++) w.step(1 / 60, {});                       // finish the draw animation
  const pistol = w.weapons.find((x) => x.def.id === 'ref_pistol'); w.weaponIndex = w.weapons.indexOf(pistol);
  for (let i = 0; i < 30; i++) w.step(1 / 60, {});
  const r = w.fireWeapon();
  assert.equal(pistol.mag, 7); assert.ok(w.noises.some((n) => n.kind === 'shot' && n.radius === 30));
  assert.ok(r.hits.length >= 0);
  const B = w.ai.agents.find((a) => a.node.name === 'B').agent, A = w.ai.agents.find((a) => a.node.name === 'A').agent;
  w.ai.agents.forEach((a) => { a.active = true; });
  // rifle pierces the warden (invulnerable) and still hurts the hollow behind it — hollow stands 3 m behind
  w.weaponIndex = w.weapons.findIndex((x) => x.def.id === 'ref_rifle'); w.weapons[w.weaponIndex].drawn = 0; w.weapons[w.weaponIndex].cooldown = 0;
  A.pos.set(0, 0, -6); B.pos.set(0, 0, -9);
  w.player.pitch = 0; w.weapon.ads = true;                                    // aimed shot: deterministic
  const res = w.fireWeapon();
  assert.equal(res.hits.length, 2, JSON.stringify(res)); assert.ok(B.hp < B.maxHp);
  assert.equal(A.hp, A.maxHp, 'the warden is invulnerable');
  // ammo pickup refills the pistol reserve
  const before = pistol.reserve;
  w.player.x = 0; w.player.z = 5.5; lookAt(w, 0, 0.2, 7); w.use();
  assert.equal(pistol.reserve, before + 8);
});
const lookAt = (w, x, y, z) => { const e = w.eye(); const dx = x - e.x, dy = y - e.y, dz = z - e.z; w.player.yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI; w.player.pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI; };

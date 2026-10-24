import test from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_WEAPONS, newWeapon, validateWeapon, weaponStats, WeaponRuntime, allWeapons } from '../../js/core/weapons.js';
import { Project } from '../../js/core/project.js';

const basis = { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
const seeded = (s = 1) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const wait = (w, secs) => { for (let i = 0; i < secs * 60; i++) w.update(1 / 60); };

test('reference weapons carry the game numbers (angles converted to degrees) and are read-only', () => {
  const p = REFERENCE_WEAPONS.ref_pistol, r = REFERENCE_WEAPONS.ref_rifle, c = REFERENCE_WEAPONS.ref_crowbar;
  assert.equal(p.damage, 34); assert.equal(p.magazine, 8); assert.equal(p.reloadTime, 1.85); assert.ok(Math.abs(p.spreadDeg - 1.26) < 0.01);
  assert.equal(r.damage, 135); assert.equal(r.perRoundReload, true); assert.equal(r.pierce, true);
  assert.equal(c.kind, 'melee'); assert.equal(c.range, 1.75);
  assert.ok([p, r, c].every((w) => w.readOnly && /player\.js/.test(w.source)));
});

test('stats: shots/time to kill, DPS and spread radius at a distance', () => {
  const s = weaponStats(REFERENCE_WEAPONS.ref_pistol, { enemyHp: 100, distance: 10 });
  assert.equal(s.shotsToKill, 3); assert.ok(Math.abs(s.timeToKill - 0.4) < 1e-9);
  assert.ok(Math.abs(s.burstDps - 170) < 1e-6);
  assert.ok(Math.abs(s.hipSpreadRadius - Math.tan(1.26 * Math.PI / 180) * 10) < 0.01);
  assert.equal(weaponStats(REFERENCE_WEAPONS.ref_rifle, { enemyHp: 100 }).shotsToKill, 1);
  const head = weaponStats(REFERENCE_WEAPONS.ref_pistol, { enemyHp: 100, headshot: true }); assert.equal(head.shotsToKill, 2);
  const slow = { ...newWeapon(), damage: 10, magazine: 3, fireInterval: 1, reloadTime: 2 };
  assert.equal(weaponStats(slow, { enemyHp: 100 }).timeToKill, 9 * 1 + 3 * 2, '10 shots, 3 reloads');
});

test('firing consumes ammo, respects the fire interval, and the magazine runs dry', () => {
  const w = new WeaponRuntime(REFERENCE_WEAPONS.ref_pistol, { rng: seeded() });
  wait(w, 0.5);
  assert.ok(w.fire(basis)); assert.equal(w.mag, 7);
  assert.equal(w.fire(basis), null, 'still cooling down');
  wait(w, 0.21); assert.ok(w.fire(basis)); assert.equal(w.mag, 6);
  for (let i = 0; i < 6; i++) { wait(w, 0.21); w.fire(basis); }
  assert.equal(w.mag, 0); wait(w, 0.3);
  assert.equal(w.fire(basis), null); assert.equal(w.state, 'empty'); assert.ok(w.log.includes('click (empty)'));
});

test('reload: full-magazine reload takes reloadTime and uses reserve; cannot fire meanwhile; no reload when full or out of ammo', () => {
  const w = new WeaponRuntime({ ...REFERENCE_WEAPONS.ref_pistol, reserve: 10 }, { rng: seeded() });
  wait(w, 0.5);
  assert.equal(w.startReload(), false, 'already full');
  for (let i = 0; i < 5; i++) { wait(w, 0.21); w.fire(basis); }
  assert.equal(w.mag, 3);
  assert.equal(w.startReload(), true); assert.equal(w.state, 'reloading'); assert.equal(w.fire(basis), null);
  wait(w, 1.9);
  assert.equal(w.mag, 8); assert.equal(w.reserve, 5); assert.equal(w.state, 'ready');
  const dry = new WeaponRuntime({ ...REFERENCE_WEAPONS.ref_pistol, reserve: 0 }, { ammo: { mag: 0, reserve: 0 } }); assert.equal(dry.startReload(), false);
});

test('per-round reload (rifle): one round per reloadTime and can be interrupted', () => {
  const w = new WeaponRuntime({ ...REFERENCE_WEAPONS.ref_rifle, reserve: 20 }, { rng: seeded(), ammo: { mag: 1, reserve: 20 } });
  wait(w, 0.5);
  assert.equal(w.startReload(), true);
  wait(w, 0.65); assert.equal(w.mag, 2);
  wait(w, 0.6); assert.equal(w.mag, 3);
  assert.equal(w.interruptReload(), true); wait(w, 2); assert.equal(w.mag, 3, 'interrupted: no more rounds');
  w.startReload(); wait(w, 3); assert.equal(w.mag, 5); assert.equal(w.state, 'ready');
});

test('spread: ADS is tighter than hip fire; pellets multiply rays; directions are unit length; recoil accumulates and recovers', () => {
  const def = { ...newWeapon(), spreadDeg: 6, adsSpreadDeg: 0.2, pellets: 8, fireInterval: 0.01, magazine: 1000 };
  const w = new WeaponRuntime(def, { rng: seeded(5) }); wait(w, 1);
  const worst = (ads) => { w.ads = ads; let m = 0; for (let i = 0; i < 200; i++) { wait(w, 0.02); const s = w.fire(basis); for (const d of s.dirs) { assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9); m = Math.max(m, Math.acos(-d.z) * 180 / Math.PI); } } return m; };
  const hip = worst(false), ads = worst(true);
  assert.ok(hip > 3 && hip <= 6.01, `hip ${hip}`); assert.ok(ads <= 0.21, `ads ${ads}`);
  assert.equal(w.fire(basis)?.dirs.length ?? 8, 8);
  const r = new WeaponRuntime({ ...newWeapon(), recoilDeg: 2, fireInterval: 0.01 }); wait(r, 1); r.fire(basis); assert.equal(r.recoil, 2); wait(r, 2); assert.ok(r.recoil < 0.05, 'recovers');
});

test('melee weapons return a swing, never consume ammo', () => {
  const w = new WeaponRuntime(REFERENCE_WEAPONS.ref_crowbar); wait(w, 0.5);
  const s = w.fire(basis); assert.deepEqual([s.melee, s.damage, s.range], [true, 38, 1.75]);
  assert.equal(w.mag, Infinity);
});

test('validation catches impossible values and ADS worse than hip', () => {
  const bad = { ...newWeapon(), fireInterval: 0, magazine: 0, reloadTime: 0, adsSpreadDeg: 9, spreadDeg: 1, noise: 200 };
  const msgs = validateWeapon(bad).map((m) => m.message).join('|');
  assert.match(msgs, /Time between shots/); assert.match(msgs, /magazine/); assert.match(msgs, /Reload time/); assert.match(msgs, /LESS accurate/); assert.match(msgs, /huge/);
  assert.deepEqual(validateWeapon(newWeapon()).filter((m) => m.severity !== 'info'), []);
  const p = new Project('x'); assert.match(validateWeapon({ ...newWeapon(), model: 'user_gone' }, p).map((m) => m.message).join(), /not in the project/);
});

test('project weapons merge with references', () => {
  const p = new Project('x'); const w = newWeapon('Mine'); p.data.weapons[w.id] = w;
  const all = allWeapons(p); assert.ok(all.ref_pistol && all[w.id]);
});

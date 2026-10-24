// Weapon definitions, firing/reload runtime and balance statistics. DOM-free.
// Reference weapons are transcribed from saint-marrow/js/entities/player.js (WEAPONS) and are read-only; copy one to edit.

import { uid, deepClone } from './util.js';

const R2D = 180 / Math.PI;

export const WEAPON_KINDS = ['gun', 'melee'];

/** The game's own numbers (angles converted from radians to degrees for readability). */
export const REFERENCE_WEAPONS = {
  ref_crowbar: { id: 'ref_crowbar', name: 'Crowbar (game reference)', kind: 'melee', damage: 38, range: 1.75, fireInterval: 0.62, noise: 6, source: 'player.js WEAPONS.crowbar' },
  ref_pistol: { id: 'ref_pistol', name: 'Service pistol (game reference)', kind: 'gun', damage: 34, magazine: 8, fireInterval: 0.2, spreadDeg: 0.022 * R2D, adsSpreadDeg: 0.004 * R2D, recoilDeg: 0.045 * R2D, reloadTime: 1.85, perRoundReload: false, noise: 30, pellets: 1, pierce: false, automatic: false, range: 80, ammoType: 'ammo9', source: 'player.js WEAPONS.pistol' },
  ref_rifle: { id: 'ref_rifle', name: 'Bolt-action rifle (game reference)', kind: 'gun', damage: 135, magazine: 5, fireInterval: 1.25, spreadDeg: 0.03 * R2D, adsSpreadDeg: 0.0008 * R2D, recoilDeg: 0.11 * R2D, reloadTime: 0.6, perRoundReload: true, noise: 42, pellets: 1, pierce: true, automatic: false, range: 120, ammoType: 'ammo762', source: 'player.js WEAPONS.rifle' },
};
for (const w of Object.values(REFERENCE_WEAPONS)) { w.readOnly = true; w.imported = true; w.headMultiplier = 2.6; w.model = ''; w.sounds = {}; w.clips = {}; w.viewmodel = { pos: [0.18, -0.2, -0.45], rot: [0, 0, 0], scale: 1 }; w.adsFov = 50; w.reserve = 40; w.notes = `Numbers copied from ${w.source}. The game's animation and viewmodel code is not importable.`; }

export function newWeapon(name = 'New weapon') {
  return { id: uid('wpn'), name, kind: 'gun', damage: 25, headMultiplier: 2, magazine: 12, reserve: 48, fireInterval: 0.15, automatic: false, spreadDeg: 1.2, adsSpreadDeg: 0.2, recoilDeg: 1.5, recoilRecover: 8, reloadTime: 2, perRoundReload: false, noise: 30, pellets: 1, pierce: false, range: 80, adsFov: 50, ammoType: 'ammo', model: '', sounds: {}, clips: {}, viewmodel: { pos: [0.18, -0.2, -0.45], rot: [0, 0, 0], scale: 1 }, notes: '' };
}

export function allWeapons(project) { return { ...deepClone(REFERENCE_WEAPONS), ...Object.fromEntries(Object.entries(project.data.weapons || {}).filter(([, w]) => w && w.kind)) }; }

export function validateWeapon(w, project) {
  const out = [];
  const add = (severity, message) => out.push({ severity, message });
  if (!(w.damage >= 0)) add('error', 'Damage must be zero or more.');
  if (!(w.fireInterval > 0)) add('error', 'Time between shots must be more than 0.');
  if (w.kind === 'gun') {
    if (!(w.magazine >= 1)) add('error', 'The magazine must hold at least 1 round.');
    if (!(w.reloadTime > 0)) add('error', 'Reload time must be more than 0.');
    if ((w.pellets || 1) < 1) add('error', 'Pellets must be at least 1.');
    if (w.adsSpreadDeg > w.spreadDeg) add('warn', 'Aiming is LESS accurate than hip fire — probably reversed.');
    if (w.noise > 80) add('info', `Noise radius ${w.noise} m is huge: every enemy within that distance hears each shot.`);
  }
  if (project && w.model && !project.data.assets[w.model] && !w.model.startsWith('builtin:')) add('warn', `Model “${w.model}” is not in the project.`);
  if (project) for (const [slot, id] of Object.entries(w.sounds || {})) if (id && !id.startsWith('builtin:') && !project.data.assets[id]) add('warn', `Sound “${slot}” (${id}) is not in the project.`);
  return out;
}

/** Balance numbers for the editor: DPS, mag dump, shots/time to kill, spread at distance. */
export function weaponStats(w, { enemyHp = 100, headshot = false, distance = 10 } = {}) {
  const dmg = w.damage * (headshot ? w.headMultiplier || 1 : 1) * (w.pellets || 1);
  const shotsToKill = dmg > 0 ? Math.ceil(enemyHp / dmg) : Infinity;
  const reloads = w.kind === 'gun' && Number.isFinite(shotsToKill) ? Math.floor((shotsToKill - 1) / w.magazine) : 0;
  const reloadT = w.kind === 'gun' ? (w.perRoundReload ? w.reloadTime * w.magazine : w.reloadTime) : 0;
  const ttk = Number.isFinite(shotsToKill) ? (shotsToKill - 1) * w.fireInterval + reloads * reloadT : Infinity;
  const burst = dmg / w.fireInterval;
  const cycle = w.kind === 'gun' ? (w.magazine * w.fireInterval + reloadT) : w.fireInterval;
  const sustained = w.kind === 'gun' ? (dmg * w.magazine) / cycle : burst;
  const rad = (d) => Math.tan((d * Math.PI) / 180) * distance;
  return { damagePerShot: dmg, shotsToKill, timeToKill: ttk, burstDps: burst, sustainedDps: sustained, magDumpTime: w.kind === 'gun' ? (w.magazine - 1) * w.fireInterval : 0, hipSpreadRadius: w.kind === 'gun' ? rad(w.spreadDeg) : 0, adsSpreadRadius: w.kind === 'gun' ? rad(w.adsSpreadDeg) : 0 };
}

export class WeaponRuntime {
  constructor(def, { rng = Math.random, ammo = null } = {}) {
    this.def = def; this.rng = rng;
    this.mag = def.kind === 'gun' ? Math.min(def.magazine, ammo?.mag ?? def.magazine) : Infinity;
    this.reserve = ammo?.reserve ?? def.reserve ?? 0;
    this.cooldown = 0; this.reloading = 0; this.ads = false; this.recoil = 0; this.shots = 0; this.drawn = 0.3;
    this.log = [];
  }
  get state() { return this.reloading > 0 ? 'reloading' : this.drawn > 0 ? 'drawing' : this.cooldown > 0 ? 'cooldown' : this.def.kind === 'gun' && this.mag <= 0 ? 'empty' : 'ready'; }
  canFire() { return this.state === 'ready'; }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt); this.drawn = Math.max(0, this.drawn - dt);
    this.recoil = Math.max(0, this.recoil - (this.def.recoilRecover || 8) * dt * Math.max(0.2, this.recoil / (this.def.recoilDeg || 1)));
    if (this.reloading > 0) {
      this.reloading -= dt;
      const d = this.def;
      if (d.perRoundReload) {
        // one round every reloadTime until full or out of reserve
        this._acc = (this._acc || 0) + dt;
        while (this._acc >= d.reloadTime && this.mag < d.magazine && this.reserve > 0) { this._acc -= d.reloadTime; this.mag++; this.reserve--; this.reloading = this.mag < d.magazine && this.reserve > 0 ? d.reloadTime : 0; this.log.push('round loaded'); }
        if (this.mag >= d.magazine || this.reserve <= 0) { this.reloading = 0; this._acc = 0; }
      } else if (this.reloading <= 0) {
        const take = Math.min(d.magazine - this.mag, this.reserve); this.mag += take; this.reserve -= take; this.reloading = 0; this.log.push('reloaded');
      }
    }
  }

  startReload() {
    const d = this.def;
    if (d.kind !== 'gun' || this.reloading > 0 || this.mag >= d.magazine || this.reserve <= 0) return false;
    this.reloading = d.reloadTime; this._acc = 0; this.ads = false; this.log.push('reload started');
    return true;
  }
  interruptReload() { if (this.def.perRoundReload && this.reloading > 0) { this.reloading = 0; this._acc = 0; return true; } return false; }

  /**
   * Fire one shot. Returns null if it cannot fire, else { dirs:[unit vectors as {x,y,z}], damage, noise, recoilDeg, pierce }.
   * `basis` = { right, up, forward } unit vectors of the aim direction ({x,y,z}).
   */
  fire(basis) {
    const d = this.def;
    if (!this.canFire()) { if (d.kind === 'gun' && this.mag <= 0 && this.reloading <= 0) this.log.push('click (empty)'); return null; }
    this.cooldown = d.fireInterval; this.shots++;
    if (d.kind === 'melee') return { melee: true, damage: d.damage, range: d.range, noise: d.noise };
    this.mag--;
    const spread = (this.ads ? d.adsSpreadDeg : d.spreadDeg) * Math.PI / 180;
    const dirs = [];
    for (let i = 0; i < (d.pellets || 1); i++) {
      // uniform point in a cone of half-angle `spread`
      const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * Math.tan(spread);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const v = { x: basis.forward.x + basis.right.x * x + basis.up.x * y, y: basis.forward.y + basis.right.y * x + basis.up.y * y, z: basis.forward.z + basis.right.z * x + basis.up.z * y };
      const l = Math.hypot(v.x, v.y, v.z); dirs.push({ x: v.x / l, y: v.y / l, z: v.z / l });
    }
    this.recoil += d.recoilDeg || 0;
    return { dirs, damage: d.damage, noise: d.noise, recoilDeg: d.recoilDeg || 0, pierce: !!d.pierce, headMultiplier: d.headMultiplier || 1 };
  }
}

// Local first-person player: movement, camera, flashlight battery, injuries, inventory and weapons.
import * as THREE from '../../lib/three.module.js';
import { CFG, DIFF } from '../settings.js';
import { clamp, damp, lerp, rand, noise2, pick } from '../util.js';

export const WEAPONS = {
  crowbar: { kind: 'melee', dmg: 38, range: 1.75, rate: 0.62, noise: 6 },
  pistol: { kind: 'gun', dmg: 34, mag: 8, rate: 0.2, spread: 0.022, adsSpread: 0.004, recoil: 0.045, reload: 1.85, ammo: 'ammo9', noise: 30, sound: 'shot_pistol', pellets: 1 },
  rifle: { kind: 'gun', dmg: 135, mag: 5, rate: 1.25, spread: 0.03, adsSpread: 0.0008, recoil: 0.11, reload: 0.6, perRound: true, ammo: 'ammo762', noise: 42, sound: 'shot_rifle', pellets: 1, pierce: true },
};
export const WEAPON_ORDER = ['none', 'crowbar', 'pistol', 'rifle'];

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.eye = 1.62;
    this.reset(true);
  }

  reset(full) {
    this.hp = 100; this.stamina = 100; this.staminaWait = 0;
    this.bleed = 0; this.fracture = false; this.painkiller = 0; this.regenWait = 0;
    this.dead = false; this.downed = false; this.bleedout = 0;
    this.hidden = null;
    this.crouch = false;
    this.aim = false;
    this.flashOn = true;
    this.trauma = 0;
    this.hurtFlash = 0;
    this.noiseT = 0;
    this.stepPhase = 0; this.lastStep = 0;
    this.reloading = 0; this.fireCd = 0; this.meleeHit = 0;
    this.useItemT = 0; this.useItemKind = null;
    this.holdT = 0; this.holdTarget = null;
    this.breathT = 0;
    this.limpPhase = 0;
    this.dmgDir = 0; this.dmgDirT = 0;
    if (full) {
      this.battery = 1;
      this.inv = { bandage: 1, medkit: 0, painkillers: 0, battery: 0, ammo9: 0, ammo762: 0 };
      this.owned = { none: true, crowbar: false, pistol: false, rifle: false };
      this.mag = { pistol: 0, rifle: 0 };
      this.weapon = 'none';
    }
  }

  // serialisable inventory for checkpoints / chapter transitions
  saveState() {
    return { inv: { ...this.inv }, owned: { ...this.owned }, mag: { ...this.mag }, weapon: this.weapon, battery: this.battery, hp: Math.max(60, this.hp) };
  }
  loadState(s) {
    if (!s) return;
    Object.assign(this.inv, s.inv || {});
    Object.assign(this.owned, s.owned || {});
    Object.assign(this.mag, s.mag || {});
    this.weapon = this.owned[s.weapon] ? s.weapon : 'none';
    this.battery = s.battery ?? 1;
    this.hp = s.hp ?? 100;
  }

  spawn(p, yaw = 0) {
    this.pos.copy(p); this.pos.y = 0;
    this.yaw = yaw; this.pitch = 0;
    this.vel.set(0, 0, 0);
  }

  get eyeHeight() { return this.downed ? 0.45 : (this.crouch ? 1.05 : 1.62); }

  camPos(out) { return out.set(this.pos.x, this.pos.y + this.eye, this.pos.z); }
  forward(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  canAct() { return !this.dead && !this.downed && !this.hidden && this.useItemT <= 0; }

  update(dt, I) {
    const g = this.game;
    if (this.dead) { this.eye = damp(this.eye, 0.25, 3, dt); return; }
    const diff = DIFF[CFG.difficulty] || DIFF.normal;
    // ---- look
    const aimK = this.aim ? (this.weapon === 'rifle' && g.vm.state.ads > 0.8 ? 0.35 : CFG.aimSens) : 1;
    const sens = (I.lookScale ?? 1) * aimK;
    this.yaw -= clamp(I.lookDX * sens, -0.6, 0.6);
    this.pitch -= clamp(I.lookDY * sens, -0.6, 0.6);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    if (this.hidden) { this.updateHidden(dt, I); return; }

    // ---- toggles
    if (I.pressed.has('crouch') && !this.downed) this.crouch = !this.crouch;
    if (I.pressed.has('flash')) this.toggleFlash();
    if (I.pressed.has('aim')) this.aimToggle = g.input.touchMode ? !this.aimToggle : true;
    if (I.released.has('aim') && !g.input.touchMode) this.aimToggle = false;
    this.aim = !!this.aimToggle && this.weapon !== 'none' && this.weapon !== 'crowbar' && !this.downed;

    // ---- movement
    const fwdIn = -I.my, sideIn = I.mx;
    const moving = Math.hypot(fwdIn, sideIn) > 0.08;
    let canSprint = I.sprint && !this.crouch && !this.downed && fwdIn > 0.3 && (!this.fracture || this.painkiller > 0) && this.stamina > 2 && !this.aim;
    let speed = this.downed ? 0.55 : this.crouch ? 1.25 : canSprint ? 4.8 : 2.45;
    if (this.fracture && this.painkiller <= 0) speed *= 0.62;
    if (this.aim) speed *= 0.6;
    if (this.useItemT > 0) speed *= 0.5;
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    const tx = (-sinY * fwdIn + cosY * sideIn) * speed;
    const tz = (-cosY * fwdIn - sinY * sideIn) * speed;
    const acc = moving ? 11 : 13;
    this.vel.x = damp(this.vel.x, tx, acc, dt);
    this.vel.z = damp(this.vel.z, tz, acc, dt);
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    [nx, nz] = g.level.grid.collide(nx, nz, 0.3);
    const realV = Math.hypot(nx - this.pos.x, nz - this.pos.z) / Math.max(dt, 1e-4);
    this.pos.x = nx; this.pos.z = nz;
    this.speed = realV;
    this.sprinting = canSprint && realV > 3;
    // ---- stamina
    if (this.sprinting) { this.stamina = Math.max(0, this.stamina - 15 * dt); this.staminaWait = 0.9; }
    else if (this.staminaWait > 0) this.staminaWait -= dt;
    else this.stamina = Math.min(100, this.stamina + (this.crouch ? 18 : 13) * dt);

    // ---- eye height, bob & footsteps
    this.eye = damp(this.eye, this.eyeHeight, 10, dt);
    const stepLen = this.sprinting ? 1.9 : this.crouch ? 1.0 : 1.45;
    this.stepPhase += realV * dt / stepLen * Math.PI;
    if (realV > 0.4 && Math.floor(this.stepPhase / Math.PI) !== this.lastStep) {
      this.lastStep = Math.floor(this.stepPhase / Math.PI);
      this.footstep();
    }
    // ---- noise for the monsters
    this.noiseT -= dt;
    if (this.noiseT <= 0 && realV > 0.4) {
      this.noiseT = 0.5;
      const r = this.sprinting ? 11 : this.crouch ? 1.5 : 4.5;
      g.makeNoise(this.pos, r, 'step');
    }
    // ---- breathing / heart
    this.breathT -= dt;
    const tired = this.stamina < 35 || this.hp < 35;
    if (this.breathT <= 0) {
      this.breathT = tired ? 0.62 : 2.6 + Math.random();
      if (tired || this.sprinting) g.audio.play(this.breathIn ? 'breath_out_h' : 'breath_in_h', { vol: tired ? 0.55 : 0.3, reverb: 0.05, vary: 0.1 });
      this.breathIn = !this.breathIn;
    }

    // ---- injuries over time
    if (this.bleed > 0) {
      this.hp -= (this.bleed === 2 ? 1.4 : 0.6) * dt * diff.dmgTaken;
      this.dripT = (this.dripT || 0) - dt;
      if (this.dripT <= 0) {
        this.dripT = this.bleed === 2 ? 0.25 : 0.7;
        if (CFG.blood !== 'off') g.fx.bloodDrip(_v.set(this.pos.x + rand(-0.15, 0.15), 0.9, this.pos.z + rand(-0.15, 0.15)));
      }
      this.regenWait = 6;
    }
    if (this.painkiller > 0) { this.painkiller -= dt; if (this.painkillerHeal > 0) { const h = Math.min(this.painkillerHeal, 2.5 * dt); this.hp = Math.min(100, this.hp + h); this.painkillerHeal -= h; } }
    if (this.regenWait > 0) this.regenWait -= dt;
    else if (this.hp < 35 && this.hp > 0 && !this.downed) this.hp = Math.min(35, this.hp + 0.6 * dt);
    if (this.hp <= 0 && !this.downed) this.goDown();
    if (this.downed) {
      this.bleedout -= dt;
      if (this.bleedout <= 0) this.die();
    }

    // ---- weapons & items
    this.fireCd -= dt;
    if (this.useItemT > 0) {
      this.useItemT -= dt;
      if (this.useItemT <= 0) this.finishUseItem();
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.finishReload();
    }
    if (this.meleeHit > 0) { this.meleeHit -= dt; if (this.meleeHit <= 0) this.meleeStrike(); }
    if (this.canAct()) {
      if (I.pressed.has('weapon') || I.pressed.has('wnext')) this.cycleWeapon(1);
      if (I.pressed.has('wprev')) this.cycleWeapon(-1);
      for (const [k, w] of [['w1', 'crowbar'], ['w2', 'pistol'], ['w3', 'rifle'], ['w4', 'none']]) if (I.pressed.has(k) && this.owned[w]) this.equip(w);
      if (I.held.fire || I.pressed.has('fire')) this.tryFire(I.pressed.has('fire'));
      if (I.pressed.has('reload')) this.tryReload();
      if (I.pressed.has('heal')) this.useBest();
      if (I.pressed.has('medkit')) this.useItem('medkit');
      if (I.pressed.has('battery')) this.useItem('battery');
    }
    // flashlight battery
    if (this.flashOn) {
      this.battery -= dt / 300;
      if (this.battery <= 0) {
        this.battery = 0;
        if (this.inv.battery > 0) { this.useItem('battery'); } else { this.flashOn = false; g.ui.toast(g.t('noBattery')); }
      }
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.3);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 0.6);
    this.dmgDirT = Math.max(0, this.dmgDirT - dt);
  }

  updateHidden(dt, I) {
    const L = this.hidden;
    // limit looking around inside the locker
    const base = L.yaw;
    let d = this.yaw - base;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.yaw = base + clamp(d, -0.45, 0.45);
    this.pitch = clamp(this.pitch, -0.3, 0.25);
    this.eye = damp(this.eye, 1.55, 8, dt);
    this.speed = 0;
    if (I.pressed.has('use') || I.pressed.has('tapUse') || I.pressed.has('crouch')) this.game.leaveLocker();
    this.breathT -= dt;
    if (this.breathT <= 0) { this.breathT = 1.8; this.game.audio.play(this.breathIn ? 'breath_out' : 'breath_in', { vol: 0.25, reverb: 0.02 }); this.breathIn = !this.breathIn; }
    if (this.flashOn) this.flashOn = false;
  }

  footstep() {
    const g = this.game;
    const surf = g.level.surfaceAt(this.pos.x, this.pos.z);
    const v = (Math.random() * 4) | 0;
    const vol = this.sprinting ? 0.55 : this.crouch ? 0.12 : 0.3;
    g.audio.play(`step_${surf}_${v}`, { vol, rate: 0.92 + Math.random() * 0.16, reverb: 0.12 });
    if (this.fracture && this.painkiller <= 0 && Math.random() < 0.08) g.audio.play('hurt_' + ((Math.random() * 3) | 0), { vol: 0.25 });
  }

  toggleFlash() {
    const g = this.game;
    if (!this.flashOn && this.battery <= 0) { g.ui.toast(g.t('noBattery')); g.audio.play('click', { vol: 0.5 }); return; }
    this.flashOn = !this.flashOn;
    g.audio.play('click', { vol: 0.6 });
    g.vm.flashToggle();
  }

  // ---------------- weapons
  cycleWeapon(dir) {
    const list = WEAPON_ORDER.filter((w) => this.owned[w]);
    const i = list.indexOf(this.weapon);
    this.equip(list[(i + dir + list.length) % list.length]);
  }
  equip(w) {
    if (!this.owned[w] || this.weapon === w) return;
    this.weapon = w;
    this.reloading = 0;
    this.aimToggle = false;
    this.game.vm.setWeapon(w === 'none' ? null : w);
    this.game.audio.play(w === 'crowbar' ? 'swing' : 'mag_in', { vol: 0.3, rate: 1.3 });
    this.fireCd = 0.35;
  }

  tryFire(edge) {
    const w = WEAPONS[this.weapon];
    if (!w || this.fireCd > 0 || this.reloading > 0 || this.sprinting) return;
    if (w.kind === 'melee') {
      if (!edge && this.game.input.touchMode === false && !this.game.input.held.fire) return;
      this.fireCd = w.rate;
      this.game.vm.melee();
      this.game.audio.play('swing', { vol: 0.5, vary: 0.15 });
      this.meleeHit = 0.2;
      return;
    }
    // semi-automatic: one shot per press
    if (!edge) return;
    if (this.mag[this.weapon] <= 0) {
      this.game.audio.play('dryfire', { vol: 0.6 });
      this.fireCd = 0.3;
      if (this.inv[w.ammo] > 0) this.tryReload();
      return;
    }
    this.mag[this.weapon]--;
    this.fireCd = w.rate;
    this.shoot(w);
  }

  shoot(w) {
    const g = this.game;
    const cam = g.camera;
    cam.getWorldPosition(_o);
    cam.getWorldDirection(_d);
    const spread = (this.aim ? w.adsSpread : w.spread) * (this.speed > 0.5 ? 1.6 : 1) * (this.fracture ? 1.3 : 1) * (this.hp < 30 ? 1.4 : 1);
    _d.x += rand(-spread, spread); _d.y += rand(-spread, spread); _d.z += rand(-spread, spread);
    _d.normalize();
    g.fireShot(_o.clone(), _d.clone(), w, this.weapon);
    g.vm.fire(this.weapon);
    // recoil
    this.pitch += w.recoil * (this.aim ? 0.6 : 1) * (0.8 + Math.random() * 0.4);
    this.yaw += rand(-0.012, 0.012) * (w.recoil / 0.045);
    this.trauma = Math.min(1, this.trauma + (this.weapon === 'rifle' ? 0.35 : 0.12));
    if (this.weapon === 'pistol') {
      // eject a casing to the right
      _v.set(0.18, -0.12, -0.35).applyMatrix4(cam.matrixWorld);
      const right = new THREE.Vector3(1, 0, 0).transformDirection(cam.matrixWorld);
      g.fx.casing(_v, right.multiplyScalar(rand(1.5, 2.4)).add(new THREE.Vector3(0, rand(1.5, 2.5), 0)), g.assets);
    }
  }

  meleeStrike() {
    this.game.meleeAttack(WEAPONS.crowbar);
  }

  tryReload() {
    const w = WEAPONS[this.weapon];
    if (!w || w.kind !== 'gun' || this.reloading > 0) return;
    if (this.mag[this.weapon] >= w.mag || this.inv[w.ammo] <= 0) return;
    const g = this.game;
    if (w.perRound) {
      const n = Math.min(w.mag - this.mag[this.weapon], this.inv[w.ammo]);
      this.reloading = 0.6 + n * w.reload;
      this.reloadRounds = n;
      g.vm.reload('rifle', this.reloading);
      g.audio.play('bolt_open', { vol: 0.6 });
      for (let i = 0; i < n; i++) g.audio.play('round_in', { vol: 0.5, delay: 0.35 + i * w.reload });
      g.audio.play('bolt_close', { vol: 0.6, delay: this.reloading - 0.2 });
    } else {
      this.reloading = w.reload;
      g.vm.reload('pistol', w.reload);
      g.audio.play('mag_out', { vol: 0.6 });
      g.audio.play('mag_in', { vol: 0.6, delay: w.reload * 0.55 });
      g.audio.play('slide', { vol: 0.6, delay: w.reload * 0.82 });
    }
    this.aimToggle = false;
  }

  finishReload() {
    const w = WEAPONS[this.weapon];
    if (!w) return;
    const need = w.mag - this.mag[this.weapon];
    const n = Math.min(need, this.inv[w.ammo], w.perRound ? this.reloadRounds : need);
    this.mag[this.weapon] += n;
    this.inv[w.ammo] -= n;
  }

  // ---------------- items & injuries
  useBest() {
    if (this.bleed > 0 && this.inv.bandage > 0) return this.useItem('bandage');
    if ((this.fracture || this.hp < 50) && this.inv.medkit > 0) return this.useItem('medkit');
    if (this.hp < 80 && this.inv.painkillers > 0) return this.useItem('painkillers');
    if (this.inv.bandage > 0 && this.hp < 100) return this.useItem('bandage');
    this.game.ui.toast(this.game.t('nothingToUse'));
  }

  useItem(kind) {
    const g = this.game;
    if (this.useItemT > 0 || !this.inv[kind]) return;
    const dur = { bandage: 2.4, medkit: 4.0, painkillers: 1.2, battery: 1.2 }[kind] || 1.5;
    this.useItemT = dur;
    this.useItemKind = kind;
    this.useItemDur = dur;
    this.reloading = 0;
    this.aimToggle = false;
    g.vm.use(dur);
    const snd = { bandage: 'tape_rip', medkit: 'zip', painkillers: 'pills', battery: 'battery' }[kind];
    g.audio.play(snd, { vol: 0.6 });
    if (kind === 'bandage') g.audio.play('tape_rip', { vol: 0.5, delay: 1.2 });
    if (kind === 'medkit') g.audio.play('tape_rip', { vol: 0.5, delay: 2.0 });
  }

  finishUseItem() {
    const k = this.useItemKind;
    const g = this.game;
    if (!this.inv[k]) return;
    this.inv[k]--;
    if (k === 'bandage') { this.bleed = Math.max(0, this.bleed - 2); this.hp = Math.min(100, this.hp + 12); g.ui.toast(g.t('bandaged')); }
    if (k === 'medkit') { this.bleed = 0; this.fracture = false; this.hp = Math.min(100, this.hp + 55); g.ui.toast(g.t('patched')); }
    if (k === 'painkillers') { this.painkiller = 60; this.painkillerHeal = 25; g.ui.toast(g.t('pills')); }
    if (k === 'battery') { this.battery = 1; this.flashOn = true; g.ui.toast(g.t('newBattery')); }
    this.useItemKind = null;
  }

  // amount: raw damage; opts: {bleed: 0..2, fracture: chance, from: Vector3, kind}
  takeDamage(amount, opts = {}) {
    const g = this.game;
    if (this.dead) return;
    const diff = DIFF[CFG.difficulty] || DIFF.normal;
    if (this.downed) { this.bleedout -= amount * 0.2; return; }
    if (this.hidden) g.leaveLocker(true);
    amount *= diff.dmgTaken;
    this.hp -= amount;
    this.regenWait = 8;
    this.trauma = Math.min(1, this.trauma + 0.5 + amount / 60);
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.45 + amount / 50);
    if (opts.bleed && this.bleed < opts.bleed) {
      this.bleed = opts.bleed;
      g.ui.toast(g.t(opts.bleed === 2 ? 'bleedHeavy' : 'bleeding'), 'bad');
    }
    if (opts.fracture && Math.random() < opts.fracture && !this.fracture) {
      this.fracture = true;
      g.ui.toast(g.t('fracture'), 'bad');
      g.audio.play('crunch', { vol: 0.8 });
    }
    if (opts.from) {
      const a = Math.atan2(opts.from.x - this.pos.x, opts.from.z - this.pos.z);
      this.dmgDir = a; this.dmgDirT = 1.2;
    }
    g.audio.play('hurt_' + ((Math.random() * 3) | 0), { vol: 0.7, vary: 0.1 });
    g.audio.play('flesh', { vol: 0.6 });
    if (CFG.blood !== 'off') {
      // spray away from the attacker, below eye level so it doesn't fill the screen
      const away = opts.from ? new THREE.Vector3(this.pos.x - opts.from.x, -0.2, this.pos.z - opts.from.z).normalize() : new THREE.Vector3(Math.sin(this.yaw), -0.2, Math.cos(this.yaw));
      g.fx.bloodHit(_v.set(this.pos.x + away.x * 0.25, 0.95, this.pos.z + away.z * 0.25), away, 0.5);
    }
    if (this.hp <= 0) this.goDown();
  }

  goDown() {
    const g = this.game;
    this.hp = 0;
    if (g.isCoop() && !this.downed && g.anyTeammateUp()) {
      this.downed = true;
      this.bleedout = 45;
      this.crouch = false;
      this.aimToggle = false;
      this.bleed = 0;
      g.audio.play('death', { vol: 0.8 });
      g.ui.toast(g.t('downed'), 'bad');
      g.onLocalDowned();
    } else this.die();
  }

  revive() {
    this.downed = false;
    this.hp = 30;
    this.bleed = 0;
    this.game.ui.toast(this.game.t('revived'));
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.downed = false;
    this.hp = 0;
    this.game.audio.play('death', { vol: 0.9 });
    this.game.onLocalDeath();
  }

  // camera transform including bob, limp, shake
  applyCamera(cam, dt, t) {
    const bobAmt = this.hidden ? 0 : clamp(this.speed / 4.8, 0, 1);
    const ph = this.stepPhase;
    const limp = this.fracture && this.painkiller <= 0 ? 1 : 0;
    const by = Math.abs(Math.sin(ph)) * (0.035 + 0.03 * bobAmt) * bobAmt * (limp && Math.sin(ph) > 0 ? 2.2 : 1);
    const bx = Math.cos(ph) * 0.025 * bobAmt;
    const tr = this.trauma * this.trauma;
    const sx = noise2(t * 23, 1.3) * tr * 0.06, sy = noise2(t * 23, 7.7) * tr * 0.06;
    const idle = Math.sin(t * 1.2) * 0.004 + (this.hp < 35 ? Math.sin(t * 2.3) * 0.006 : 0);
    const right = _v.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.set(this.pos.x + right.x * bx, this.pos.y + this.eye - by + idle, this.pos.z + right.z * bx);
    const roll = noise2(t * 17, 3.3) * tr * 0.05 + (limp ? Math.sin(ph) * 0.025 * bobAmt : 0) + Math.cos(ph) * 0.006 * bobAmt;
    cam.rotation.set(this.pitch + sy, this.yaw + sx, roll, 'YXZ');
  }
}

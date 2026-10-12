// Local first-person player: movement, weapons, recoil, scope, damage.
import * as THREE from 'three';
import { input } from './input.js';
import { audio } from './audio.js';
import { GunState, traceShot, damageFor, spreadFor, applySpread } from './combat.js';
import { rayCapsule } from './character.js';
import { WEAPONS } from '../weapons/weapons.js';
import { settings } from '../core/settings.js';
import { clamp, damp, DEG } from '../core/util.js';

const GRAV = 20, JUMP_V = 5.1, STAND_EYE = 1.64, CROUCH_EYE = 1.12, RADIUS = 0.32;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _dir = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Player {
  constructor(game, name, team) {
    this.game = game; this.name = name; this.team = team; this.isBot = false; this.isLocal = true;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.punch = new THREE.Vector2(); this.punchVel = new THREE.Vector2();
    this.hp = 100; this.alive = false; this.kills = 0; this.deaths = 0; this.score = 0; this.hs = 0;
    this.st = { pos: this.pos, vel: this.vel, onGround: true, landSpeed: 0, gravity: GRAV };
    this.crouchAmt = 0; this.eyeH = STAND_EYE;
    this.guns = {}; this.slot = 'primary'; this.lastSlot = 'pistol';
    this.scoped = 0; this.busyUntil = 0; this.knifeAlt = 0; this.stepAcc = 0; this.stepIdx = 0;
    this.spawnProtect = 0; this.lastDamageT = -10; this.sprayAdd = 0;
  }

  get gun() { return this.guns[this.slot]; }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z); }

  setLoadout(primary) {
    this.guns = { primary: new GunState(primary), pistol: new GunState('pistol'), knife: new GunState('knife') };
  }

  async spawn(sp) {
    this.pos.copy(sp.pos); this.vel.set(0, 0, 0); this.yaw = sp.yaw; this.pitch = 0;
    this.hp = 100; this.alive = true; this.st.onGround = true; this.crouchAmt = 0; this.eyeH = STAND_EYE;
    for (const k in this.guns) this.guns[k].refill();
    this.scoped = 0; this.spawnProtect = 2; this.punch.set(0, 0); this.punchVel.set(0, 0);
    await this.equip('primary', true);
  }

  async equip(slot, force) {
    if (!this.guns[slot]) return;
    if (slot === this.slot && !force) return;
    if (slot !== this.slot) this.lastSlot = this.slot;
    // cancel everything the previous weapon was doing
    const old = this.guns[this.slot];
    if (old) { old.reloading = false; old.ammoGiven = false; }
    this.pendingMelee = null; this.rescope = 0;
    const g = this.guns[slot];
    g.reloading = false; this.scoped = 0;
    this.slot = slot;
    // block firing until the draw animation is far enough along (set now, not after the await)
    const seq = (this._equipSeq = (this._equipSeq || 0) + 1);
    this.busyUntil = this.game.time + 10;
    const vm = this.game.vm;
    const dur = await vm.equip(g.def.kind, { skin: this.skinFor ? this.skinFor(g.def.id) : null });
    if (seq !== this._equipSeq) return; // a newer switch happened while loading
    vm.slideLocked = !!g.def.slideLock && g.mag === 0;
    this.busyUntil = this.game.time + (dur || 0.5) * 0.75;
    this.game.hud.weaponChanged(this);
  }

  // ----------------------------------------------------------------- update
  update(dt) {
    const game = this.game, t = game.time;
    if (!this.alive) return;
    input.poll();
    this.spawnProtect = Math.max(0, this.spawnProtect - dt);
    // ---- look
    const [lx, ly] = input.consumeLook();
    const zoomSens = this.scoped ? settings.scopeSens * (this.game.camera.fov / settings.fov) : 1;
    const k = 0.0022 * settings.sens * zoomSens;
    this.lookDX = -lx * k; this.lookDY = (settings.invertY ? 1 : -1) * ly * k;
    this.yaw += this.lookDX; this.pitch = clamp(this.pitch + this.lookDY, -1.5, 1.5);

    // ---- crouch
    const wantCrouch = input.crouch;
    let canStand = true;
    if (!wantCrouch && this.crouchAmt > 0.01) {
      const hit = game.world.collision.raycast(_v.set(this.pos.x, this.pos.y + 1.0, this.pos.z), _v2.set(0, 1, 0), 0.85, {});
      canStand = !hit;
    }
    this.crouchAmt = damp(this.crouchAmt, wantCrouch || !canStand ? 1 : 0, 14, dt);
    const crouching = this.crouchAmt > 0.5;
    this.eyeH = STAND_EYE + (CROUCH_EYE - STAND_EYE) * this.crouchAmt;

    // ---- movement (CS-like)
    const def = this.gun.def;
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw), rgtX = Math.cos(this.yaw), rgtZ = -Math.sin(this.yaw);
    let wx = fwdX * -input.moveZ + rgtX * input.moveX, wz = fwdZ * -input.moveZ + rgtZ * input.moveX;
    const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
    let wishSpeed = (def.speed || 5.4) * Math.min(1, wl);
    if (this.scoped) wishSpeed *= 0.55;
    if (input.walk) wishSpeed *= 0.52;
    if (crouching) wishSpeed *= 0.36;
    const v = this.vel;
    if (this.st.onGround) {
      const sp = Math.hypot(v.x, v.z);
      if (sp > 0) { const drop = Math.max(sp, 1.9) * 5.2 * dt; const ns = Math.max(sp - drop, 0) / sp; v.x *= ns; v.z *= ns; }
      const cur = v.x * wx + v.z * wz, add = wishSpeed - cur;
      if (add > 0) { const acc = Math.min(5.5 * wishSpeed * dt, add); v.x += acc * wx; v.z += acc * wz; }
      if ((input.edge('jump') || input.jumpHeld) && !crouching && t > (this.nextJump || 0)) { v.y = JUMP_V; this.st.onGround = false; this.nextJump = t + 0.35; }
    } else {
      const ws = Math.min(wishSpeed, 0.8), cur = v.x * wx + v.z * wz, add = ws - cur;
      if (add > 0) { const acc = Math.min(12 * wishSpeed * dt, add); v.x += acc * wx; v.z += acc * wz; }
      input.edge('jump');
    }
    const wasGround = this.st.onGround;
    game.world.collision.moveCharacter(this.st, dt, RADIUS, crouching ? 1.3 : 1.8, 0.45);
    if (!wasGround && this.st.onGround && this.st.landSpeed > 3) {
      audio.play('land', { vol: Math.min(1, this.st.landSpeed / 8) * 0.8 });
      if (this.st.landSpeed > 11.5) this.takeDamage((this.st.landSpeed - 11.5) * 9, null, 'legs', null, 'fall');
    }
    const speed = Math.hypot(v.x, v.z);
    // footsteps
    if (this.st.onGround && speed > 2.6 && !input.walk && !crouching) {
      this.stepAcc += speed * dt;
      if (this.stepAcc > 2.1) { this.stepAcc = 0; audio.play('step' + (this.stepIdx++ % 3), { vol: 0.32, pitchVar: 0.15, reverb: 0.05 }); }
    }

    // ---- weapons
    this.handleWeapons(dt, speed, crouching);

    // ---- recoil view punch recovery (spring back)
    const rec = this.gun.def.recoilReset || 0.3;
    const sinceShot = t - this.gun.lastShot;
    if (sinceShot > 0.05) {
      const back = Math.min(1, dt * (sinceShot > rec ? 9 : 4));
      this.punch.x -= this.punch.x * back; this.punch.y -= this.punch.y * back;
    }
    if (sinceShot > rec) this.gun.spray = 0;
    this.sprayAdd = damp(this.sprayAdd, 0, 6, dt);

    // ---- camera
    const cam = game.camera;
    cam.position.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z);
    const off = game.vm.camOffset;
    _e.set(this.pitch + this.punch.x + off.x, this.yaw + this.punch.y + off.y, off.z, 'YXZ');
    cam.quaternion.setFromEuler(_e);
    const targetFov = this.scoped ? def.scope[this.scoped - 1] : settings.fov;
    cam.fov = this.scoped ? targetFov : damp(cam.fov, targetFov, 20, dt);
    cam.updateProjectionMatrix();

    this.vmCtx = { lookDX: this.lookDX, lookDY: this.lookDY, speed: Math.min(1, speed / 5.5), onGround: this.st.onGround, landSpeed: (!wasGround && this.st.onGround) ? this.st.landSpeed : 0, crouch: crouching, strafe: input.moveX };
  }

  handleWeapons(dt, speed, crouching) {
    const game = this.game, t = game.time, vm = game.vm, g = this.gun, def = g.def;
    // switching (after a switch nothing else happens this frame)
    const order = ['primary', 'pistol', 'knife'];
    let to = null;
    if (input.edge('slot1')) to = 'primary';
    if (input.edge('slot2')) to = 'pistol';
    if (input.edge('slot3')) to = 'knife';
    if (input.edge('last')) to = this.lastSlot;
    if (input.edge('next')) to = order[(order.indexOf(this.slot) + 1) % 3];
    if (input.edge('prev')) to = order[(order.indexOf(this.slot) + 2) % 3];
    if (to && to !== this.slot) { this.equip(to); input.edge('fire'); input.edge('fire2'); input.edge('reload'); input.edge('inspect'); return; }
    if (input.edge('inspect') && !g.reloading && t > this.busyUntil && !this.scoped) vm.play('inspect');
    const busy = t < this.busyUntil || g.reloading;

    // reload
    if (!def.melee && (input.edge('reload') || (g.mag === 0 && g.reserve > 0 && t > g.nextFire && !busy)) && !g.reloading && g.mag < def.mag && g.reserve > 0 && t > this.busyUntil) {
      this.startReload();
    }
    // reload finished by time (fallback if no 'ammo' event)
    if (g.reloading && t >= g.reloadEnd) this.finishReload();

    // scope
    if (def.scope && input.edge('fire2') && !busy) { this.scoped = (this.scoped + 1) % (def.scope.length + 1); audio.play('dry', { vol: 0.3, rate: 1.6 }); }
    else if (!def.scope && !def.melee) input.edge('fire2');

    // knife
    if (def.melee) {
      const heavy = input.edge('fire2');
      const light = input.firing && !heavy;
      if ((light || heavy) && t >= g.nextFire && t > this.busyUntil) this.knifeAttack(heavy);
      input.edge('fire');
      return;
    }

    // fire
    const wants = def.auto ? input.firing : input.edge('fire');
    if (!def.auto) { /* consumed above */ } else input.edge('fire');
    if (wants && !busy && t >= g.nextFire) {
      if (g.mag <= 0) { audio.play('dry', { vol: 0.5 }); g.nextFire = t + 0.25; return; }
      this.shoot(speed, crouching);
    }
  }

  startReload() {
    const g = this.gun, vm = this.game.vm;
    if (vm.player.name === 'inspect') vm.stopClip(0.1);
    const empty = g.mag === 0;
    const name = empty && vm.has('reloadEmpty') ? 'reloadEmpty' : 'reload';
    g.reloading = true; this.scoped = 0;
    const dur = vm.play(name, { blend: 0.12, onEnd: () => { if (g.reloading && this.gun === g) this.finishReload(); } }) || 2;
    g.reloadStart = this.game.time; g.reloadEnd = this.game.time + dur + 0.05;
    g.ammoGiven = false;
  }
  giveAmmo() {
    const g = this.gun; if (!g.reloading || g.ammoGiven) return;
    const need = g.def.mag - g.mag, take = Math.min(need, g.reserve);
    g.mag += take; g.reserve -= take; g.ammoGiven = true;
    this.game.vm.slideLocked = false;
    this.game.hud.ammo(this);
  }
  finishReload() { const g = this.gun; if (!g.ammoGiven) this.giveAmmo(); g.reloading = false; g.spray = 0; }

  shoot(speed, crouching) {
    const game = this.game, t = game.time, g = this.gun, def = g.def, vm = game.vm;
    g.mag--; g.nextFire = t + def.delay; g.lastShot = t;
    const cam = game.camera;
    // bullet direction: view (without visual cam offsets) + pattern
    const pat = def.pattern ? def.pattern[Math.min(g.spray, def.pattern.length - 1)] : null;
    g.spray++;
    const scopedNow = this.scoped > 0;
    const spread = spreadFor(def, { scoped: scopedNow, speedFrac: speed / 5.4, onGround: this.st.onGround, crouch: crouching, sprayAdd: this.sprayAdd });
    // accumulate view punch from the pattern
    if (pat) { this.punch.x += pat[0] * DEG * def.viewKick * (def.patternScale || 1); this.punch.y += pat[1] * DEG * def.viewKick * (def.patternScale || 1); }
    else { this.punch.x += def.viewKick * DEG * (0.8 + Math.random() * 0.4); this.punch.y += (Math.random() - 0.5) * def.viewKick * 0.4 * DEG; }
    this.sprayAdd += def.recoverySpread || 0;
    _e.set(this.pitch + this.punch.x * 2.0, this.yaw + this.punch.y * 2.0, 0, 'YXZ');
    _dir.set(0, 0, -1).applyQuaternion(_q.setFromEuler(_e));
    const dir = applySpread(_dir, spread, new THREE.Vector3());
    const origin = this.eye(new THREE.Vector3());
    const res = traceShot(game, this, origin, dir, def.range);
    game.onShot(this, origin, dir, res, def);
    // feedback
    audio.play('shot_' + def.sound, { vol: 0.9, pitchVar: 0.06, reverb: 0.35 });
    vm.fire();
    if (g.mag === 0 && def.slideLock) vm.slideLocked = true;
    // muzzle smoke + light in world
    const mz = _v.set(0.14, -0.12, -0.7).applyQuaternion(cam.quaternion).add(cam.position);
    game.effects.muzzleSmoke(mz, _v2.copy(dir));
    game.world.flash(mz, 4);
    // tracer every N shots, from the gun not the eye
    if ((g.spray % (def.tracerEvery || 3)) === 1 || def.tracerEvery === 1) game.effects.tracer(mz.clone(), res.end, 420);
    if (scopedNow && def.boltAction) { this.scoped = 0; this.rescope = t + 1.2; }
    if (def.boltAction) this.busyUntil = t + def.delay * 0.9;
    game.hud.ammo(this);
    game.hud.shotFired(spread);
  }

  knifeAttack(heavy) {
    const game = this.game, t = game.time, g = this.gun, def = g.def, vm = game.vm;
    const clip = heavy ? 'stab' : (this.knifeAlt++ % 2 ? 'slash2' : 'slash1');
    vm.play(clip, { blend: 0.04 });
    g.nextFire = t + (heavy ? def.heavyDelay : def.delay);
    // damage applied at the clip 'hit' event
    this.pendingMelee = { heavy, at: t + (heavy ? 0.44 : 0.17) };
  }
  doMelee(heavy) {
    const game = this.game, def = this.gun.def;
    if (!def.melee) return;
    const origin = this.eye(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(game.camera.quaternion);
    const res = traceShot(game, this, origin, dir, def.range);
    if (res.actor) {
      // backstab check
      const victimFwd = new THREE.Vector3(-Math.sin(res.actor.yaw), 0, -Math.cos(res.actor.yaw));
      const back = victimFwd.dot(new THREE.Vector3(dir.x, 0, dir.z).normalize()) > 0.5;
      const dmg = back ? def.backstab : heavy ? def.dmgHeavy : def.dmg;
      game.applyDamage(this, res.actor, dmg, 'chest', dir, 'knife');
    } else if (res.normal) {
      game.effects.impact(res.end, res.normal, res.mat, { noDecal: false });
    }
  }

  update2(dt) {
    // pending melee timing + auto re-scope after bolt
    const t = this.game.time;
    if (this.pendingMelee && t >= this.pendingMelee.at) { const h = this.pendingMelee.heavy; this.pendingMelee = null; this.doMelee(h); }
    if (this.rescope && t > this.rescope) { this.rescope = 0; if (input.fire2 || settings.isTouch) { /* manual rescope */ } }
  }

  // ----------------------------------------------------------------- hits
  raycast(o, d, maxT) {
    const p = this.pos, h = this.crouchAmt > 0.5 ? 1.3 : 1.8;
    let best = maxT, zone = null;
    const test = (ay, by, r, z) => { _a.set(p.x, p.y + ay, p.z); _b.set(p.x, p.y + by, p.z); const t = rayCapsule(o, d, _a, _b, r); if (t < best) { best = t; zone = z; } };
    test(this.eyeH + 0.02, this.eyeH + 0.1, 0.13, 'head');
    test(h * 0.58, h * 0.8, 0.22, 'chest');
    test(h * 0.45, h * 0.58, 0.2, 'stomach');
    test(0.12, h * 0.45, 0.17, 'legs');
    return zone ? { t: best, zone } : null;
  }
  takeDamage(dmg, attacker, zone, dir, weapon) {
    if (!this.alive || this.spawnProtect > 0) return 0;
    this.hp -= dmg; this.lastDamageT = this.game.time;
    audio.play('hurt', { vol: 0.6 });
    this.game.hud.damaged(this, attacker, dir);
    this.game.renderer.damage = Math.min(0.9, this.game.renderer.damage + dmg / 60);
    // aim punch when hit
    this.punch.x += (Math.random() * 0.6 + 0.4) * 0.03; this.punch.y += (Math.random() - 0.5) * 0.03;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; return dmg; }
    return dmg;
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

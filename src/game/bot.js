// Bot AI: perception (FOV + line of sight + hearing), human-like aim with
// reaction time and settling error, burst fire, strafing, nav-grid pathing.
import * as THREE from 'three';
import { Character } from './character.js';
import { GunState, traceShot, spreadFor, applySpread } from './combat.js';
import { audio } from './audio.js';
import { clamp, wrapAngle, rand, pick } from '../core/util.js';

const DIFF = {
  easy: { react: [0.55, 0.85], err: 9, settle: 2.2, turn: 4.5, head: 0.08, burst: [2, 4], spread: 1.8 },
  normal: { react: [0.3, 0.55], err: 6, settle: 3.2, turn: 7, head: 0.2, burst: [3, 6], spread: 1.25 },
  hard: { react: [0.18, 0.32], err: 3.5, settle: 5, turn: 11, head: 0.38, burst: [4, 8], spread: 1.0 },
};
const NAMES = ['Viper', 'Kestrel', 'Nomad', 'Rook', 'Sable', 'Mirage', 'Dune', 'Falcon', 'Cobra', 'Ghost', 'Jinn', 'Saber', 'Vortex', 'Talon', 'Onyx', 'Raptor', 'Scorch', 'Zephyr', 'Havoc', 'Bishop'];
let nameIdx = 0;
export function botName() { return NAMES[(nameIdx++) % NAMES.length]; }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export class Bot {
  constructor(game, team, name, difficulty = 'normal') {
    this.game = game; this.team = team; this.name = name; this.isBot = true;
    this.D = DIFF[difficulty] || DIFF.normal;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.st = { pos: this.pos, vel: this.vel, onGround: true, gravity: 20 };
    this.yaw = 0; this.pitch = 0; this.hp = 100; this.alive = false;
    this.kills = 0; this.deaths = 0; this.score = 0; this.hs = 0;
    this.char = new Character(team);
    this.path = null; this.pathIdx = 0; this.goal = new THREE.Vector3(); this.repathT = 0;
    this.target = null; this.reactT = 0; this.aimErr = new THREE.Vector2(); this.burstLeft = 0; this.burstPause = 0;
    this.strafeDir = 1; this.strafeT = 0; this.crouch = false; this.thinkT = Math.random() * 0.2;
    this.lastSeen = new THREE.Vector3(); this.lastSeenT = -10; this.alertDir = null; this.alertT = 0;
    this.stuckT = 0; this.lastPos = new THREE.Vector3();
  }
  async init(primary) {
    this.primary = primary;
    this.gun = new GunState(primary);
    await this.char.build(primary);
    this.game.world.dynamic.add(this.char.group);
    this.char.group.visible = false;
  }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + (this.crouch ? 1.15 : 1.62), this.pos.z); }

  spawn(sp) {
    this.pos.copy(sp.pos); this.vel.set(0, 0, 0); this.yaw = sp.yaw; this.pitch = 0;
    this.hp = 100; this.alive = true; this.gun.refill(); this.target = null; this.path = null; this.crouch = false;
    this.char.revive(); this.char.group.visible = true; this.spawnProtect = 1.5;
    this.char.group.position.copy(this.pos); this.char.group.rotation.y = this.yaw;
    this.pickGoal();
  }

  pickGoal() {
    const g = this.game, nav = g.nav;
    if (!nav) return;
    // mostly push toward the enemy side, sometimes roam
    const enemySpawns = g.world.spawns.filter((s) => s.team !== this.team);
    if (enemySpawns.length && Math.random() < 0.45) this.goal.copy(pick(enemySpawns).pos);
    else nav.randomPoint(this.goal);
    this.path = nav.findPath(this.pos, this.goal); this.pathIdx = 0; this.repathT = 6 + Math.random() * 6;
  }

  // ------------------------------------------------------------------ think
  perceive() {
    const g = this.game, eye = this.eye(_v);
    const fwd = _v2.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    let best = null, bestD = 1e9;
    for (const a of g.actors) {
      if (!a.alive || a.team === this.team) continue;
      const head = a.eye(_v3); const d = head.distanceTo(eye);
      if (d > 90) continue;
      const dir = head.clone().sub(eye).multiplyScalar(1 / d);
      const inFov = fwd.x * dir.x + fwd.z * dir.z > Math.cos(75 * Math.PI / 180) * Math.hypot(dir.x, dir.z) || d < 4 || (this.target === a);
      if (!inFov) continue;
      const chest = a.pos.clone(); chest.y += 1.2;
      if (!g.world.collision.lineOfSight(eye, head) && !g.world.collision.lineOfSight(eye, chest)) continue;
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best && best !== this.target) {
      if (!this.target || bestD < this.targetDist - 6) {
        this.target = best; this.reactT = rand(...this.D.react) * (this.alertT > 0 ? 0.6 : 1);
        this.aimErr.set((Math.random() - 0.5) * 2 * this.D.err, (Math.random() - 0.5) * 2 * this.D.err * 0.7);
        this.wantHead = Math.random() < this.D.head;
        this.burstLeft = 0; this.burstPause = 0;
      }
    }
    if (best) { this.targetDist = bestD; this.lastSeen.copy(best.pos); this.lastSeenT = g.time; this.seeing = true; }
    else { this.seeing = false; if (this.target && g.time - this.lastSeenT > 2.5) this.target = null; }
  }

  hear(pos) {
    if (!this.alive || this.target) return;
    this.alertDir = pos.clone(); this.alertT = 2.5;
  }
  onDamaged(attacker) {
    if (attacker && attacker.alive && (!this.target || !this.seeing)) {
      this.alertDir = attacker.pos.clone(); this.alertT = 3;
      if (!this.target) { this.target = attacker; this.reactT = rand(...this.D.react) * 0.7; this.aimErr.set((Math.random() - 0.5) * 2 * this.D.err * 1.4, (Math.random() - 0.5) * 2 * this.D.err); }
    }
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game, t = g.time;
    if (!this.alive) { this.char.update(dt, {}); return; }
    this.spawnProtect = Math.max(0, (this.spawnProtect || 0) - dt);
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.12 + Math.random() * 0.06; this.perceive(); }
    this.alertT -= dt;

    let wishX = 0, wishZ = 0, speedMul = 1;
    let aimYaw = this.yaw, aimPitch = 0;
    const tgt = this.target && this.target.alive ? this.target : null;
    if (!tgt) this.target = null;

    if (tgt && this.seeing) {
      const eye = this.eye(_v);
      const aimPt = this.wantHead ? tgt.eye(_v3).add(_v2.set(0, 0.04, 0)) : _v3.copy(tgt.pos).add(_v2.set(0, tgt.crouchAmt > 0.5 ? 0.85 : 1.2, 0));
      const d = aimPt.clone().sub(eye);
      aimYaw = Math.atan2(-d.x, -d.z); aimPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      // settle aim error over time
      const k = Math.exp(-this.D.settle * dt);
      this.aimErr.multiplyScalar(k);
      aimYaw += this.aimErr.x * Math.PI / 180; aimPitch += this.aimErr.y * Math.PI / 180;
      // combat movement: strafe, occasionally crouch
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(0.35, 1.1); this.strafeDir = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.25) this.strafeDir = 0; this.crouch = this.gun.def.cls !== 'sniper' && this.targetDist > 18 && Math.random() < 0.25; }
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      wishX = rx * this.strafeDir; wishZ = rz * this.strafeDir;
      speedMul = this.burstLeft > 0 ? 0.35 : 0.8;
      this.reactT -= dt;
    } else if (tgt || this.alertT > 0) {
      // go check last seen position / look toward noise
      const look = tgt ? this.lastSeen : this.alertDir;
      if (look) { const d = look.clone().sub(this.pos); aimYaw = Math.atan2(-d.x, -d.z); }
      if (tgt && this.pos.distanceTo(this.lastSeen) > 2) {
        if (!this.path || this.repathT < 0 || this.path.goalId !== 'seen') { this.path = g.nav.findPath(this.pos, this.lastSeen); this.pathIdx = 0; if (this.path) this.path.goalId = 'seen'; this.repathT = 1.5; }
      }
      this.crouch = false;
    }
    if (!(tgt && this.seeing)) {
      // follow path
      this.repathT -= dt;
      if (!this.path || this.pathIdx >= this.path.length || this.repathT < 0) { if (!tgt) this.pickGoal(); }
      if (this.path && this.pathIdx < this.path.length) {
        const wp = this.path[this.pathIdx];
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, dl = Math.hypot(dx, dz);
        if (dl < 0.7) this.pathIdx++;
        else { wishX = dx / dl; wishZ = dz / dl; if (!tgt && this.alertT <= 0) aimYaw = Math.atan2(-dx, -dz); }
      }
      speedMul = 1;
    }

    // turn toward aim
    const turn = this.D.turn * dt * (tgt && this.seeing ? 1 : 0.6);
    const diff = wrapAngle(aimYaw - this.yaw);
    this.yaw = wrapAngle(this.yaw + clamp(diff * Math.min(1, dt * 14), -turn, turn));
    this.pitch += (aimPitch - this.pitch) * Math.min(1, dt * 10);

    // movement
    const spd = this.gun.def.speed * speedMul * (this.crouch ? 0.4 : 1);
    const v = this.vel, accel = 9;
    v.x += (wishX * spd - v.x) * Math.min(1, accel * dt); v.z += (wishZ * spd - v.z) * Math.min(1, accel * dt);
    // keep personal space from other characters
    for (const a of g.actors) {
      if (a === this || !a.alive) continue;
      const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.5 && d2 > 1e-6 && Math.abs(this.pos.y - a.pos.y) < 1.5) { const d = Math.sqrt(d2), k = (0.71 - d) * 4; v.x += dx / d * k; v.z += dz / d * k; }
    }
    g.world.collision.moveCharacter(this.st, dt, 0.32, this.crouch ? 1.3 : 1.8, 0.45);
    // stuck detection
    this.stuckT += dt;
    if (this.stuckT > 1) {
      if (this.pos.distanceTo(this.lastPos) < 0.3 && (wishX || wishZ) && !(tgt && this.seeing)) { if (this.st.onGround) v.y = 5; this.path = null; }
      this.lastPos.copy(this.pos); this.stuckT = 0;
    }

    // shooting
    if (tgt && this.seeing && this.reactT <= 0) this.tryFire(dt, aimYaw, aimPitch);
    // reload when empty or idle
    const gun = this.gun;
    if (gun.reloading && t >= gun.reloadEnd) { const take = Math.min(gun.def.mag - gun.mag, gun.reserve); gun.mag += take; gun.reserve -= take; gun.reloading = false; }
    if (!gun.reloading && gun.mag === 0 && gun.reserve > 0) this.startReload();
    if (!gun.reloading && !tgt && gun.mag < gun.def.mag * 0.4 && gun.reserve > 0) this.startReload();

    // character visuals
    const c = this.char;
    c.group.position.copy(this.pos); c.group.rotation.y = this.yaw;
    const sp = Math.hypot(v.x, v.z);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    c.update(dt, { speed: sp, fwd: sp > 0.1 ? (v.x * fx + v.z * fz) / sp : 1, side: sp > 0.1 ? (v.x * Math.cos(this.yaw) - v.z * Math.sin(this.yaw)) / sp : 0, crouch: this.crouch, pitch: this.pitch, onGround: this.st.onGround });
    this.crouchAmt = this.crouch ? 1 : 0;
    c.updateHitboxes();
    // footsteps
    if (sp > 2.6 && this.st.onGround) { this.stepAcc = (this.stepAcc || 0) + sp * dt; if (this.stepAcc > 2.1) { this.stepAcc = 0; audio.play('step' + ((Math.random() * 3) | 0), { pos: this.pos, vol: 0.5, pitchVar: 0.2 }); } }
  }

  startReload() { const gun = this.gun; gun.reloading = true; gun.reloadEnd = this.game.time + (gun.def.cls === 'sniper' ? 2.6 : gun.def.cls === 'pistol' ? 1.8 : gun.def.cls === 'shotgun' ? 3.2 : 2.3); audio.play('magOut', { pos: this.pos, vol: 0.5 }); }

  tryFire(dt, aimYaw, aimPitch) {
    const g = this.game, t = g.time, gun = this.gun, def = gun.def;
    if (gun.reloading || gun.mag <= 0 || t < gun.nextFire) return;
    // only fire when the aim has roughly converged
    const err = Math.abs(wrapAngle(aimYaw - this.yaw)) + Math.abs(aimPitch - this.pitch);
    const tol = (def.cls === 'sniper' ? 0.02 : 0.06) + 0.6 / Math.max(5, this.targetDist);
    if (err > tol) return;
    if (this.burstPause > 0) { this.burstPause -= dt; return; }
    if (this.burstLeft <= 0) {
      this.burstLeft = def.auto ? Math.round(rand(...this.D.burst) * (this.targetDist < 10 ? 1.8 : 1)) : 1;
    }
    gun.mag--; gun.nextFire = t + def.delay * (def.auto ? 1 : 1.6 + Math.random()); gun.lastShot = t;
    this.burstLeft--;
    if (this.burstLeft <= 0) this.burstPause = def.auto ? rand(0.15, 0.45) : rand(0.2, 0.6);
    const eye = this.eye(new THREE.Vector3());
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)).normalize();
    const spread = spreadFor(def, { scoped: true, speedFrac: Math.hypot(this.vel.x, this.vel.z) / 5.4, onGround: this.st.onGround, crouch: this.crouch, sprayAdd: Math.min(gun.spray, 10) * 0.004 }) * this.D.spread;
    gun.spray = t - gun.lastShot < 0.3 ? gun.spray + 1 : 0;
    const d2 = applySpread(dir, spread);
    const res = traceShot(g, this, eye, d2, def.range);
    g.onShot(this, eye, d2, res, def);
    // visuals + 3D audio
    const mz = this.char.muzzleWorld(new THREE.Vector3());
    g.effects.muzzleFlash(mz, dir);
    if (Math.random() < 0.6 || def.cls === 'sniper') g.effects.tracer(mz.clone(), res.end, 380);
    this.char.fired();
    const ear = g.camera.position;
    const occluded = !g.world.collision.lineOfSight(eye, ear);
    const far = mz.distanceTo(g.camera.position) > 45;
    const useFar = far && audio.recorded?.has('shot_distant'), mx = audio.shotMix(useFar ? 'distant' : def.sound);
    audio.play(useFar ? 'shot_distant' : 'shot_' + def.sound, { pos: mz, vol: (useFar ? 1.6 : 1.0) * mx.vol, pitchVar: mx.pitchVar, reverb: 0.3, occluded });
  }

  raycast(o, d, maxT) { return this.char.raycast(o, d, maxT); }
  takeDamage(dmg, attacker, zone, dir) {
    if (!this.alive || this.spawnProtect > 0) return 0;
    this.hp -= dmg;
    this.onDamaged(attacker);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.char.die(dir); }
    return dmg;
  }
}

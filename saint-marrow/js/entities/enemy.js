// Monsters: Hollows (killable infected patients) and the Warden (unkillable stalker).
// AI runs on the host only; clients receive snapshots and animate locally.
import * as THREE from '../../lib/three.module.js';
import { buildCreatureTemplate, instantiate, animate, deadPose, crawlPose } from './creatures.js';
import { CFG, DIFF } from '../settings.js';
import { clamp, damp, dampAngle, wrapAngle, rand, pick, lerp } from '../util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
export const STATE_CODES = ['dormant', 'rise', 'idle', 'wander', 'investigate', 'chase', 'attack', 'stagger', 'dead', 'absent', 'search', 'leave', 'grab', 'bash'];

let nextId = 1;

export class Enemy {
  constructor(game, kind, x, z, opts = {}) {
    this.game = game;
    this.kind = kind;
    this.id = opts.id || kind + '_' + (nextId++);
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = opts.yaw ?? Math.random() * Math.PI * 2;
    this.vel = new THREE.Vector3();
    this.speed = 0; this.phase = Math.random() * 6;
    const diff = DIFF[CFG.difficulty] || DIFF.normal;
    this.maxHp = kind === 'hollow' ? 100 * diff.enemyHp : Infinity;
    this.hp = this.maxHp;
    this.crawler = !!opts.crawler;
    this.state = opts.dormant ? 'dormant' : (kind === 'warden' ? 'absent' : 'idle');
    this.stateT = 0;
    this.path = null; this.pathT = 0; this.pathGoal = null;
    this.target = null;           // player ref {slot, pos}
    this.alert = 0;               // detection meter 0..1
    this.lastSeen = null; this.lastSeenT = 99;
    this.attackT = 0; this.attackCd = 0;
    this.flinch = 0; this.limp = 0;
    this.deadK = 0; this.riseK = 0; this.crawlK = this.crawler ? 1 : 0;
    this.voiceT = rand(2, 6);
    this.stepAcc = 0;
    this.yawLook = 0;
    this.dropSide = 1;
    this.wakeRadius = opts.wakeRadius ?? 3.2;
    this.noTarget = 0;
    this.leaveT = 0;
    this.bashT = 0;
    const tpl = buildCreatureTemplate(kind, game.assets, game.skinDetail, game.renderer.qname, opts.variant || {});
    this.inst = instantiate(tpl, game.assets);
    this.root = this.inst.root;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    game.scene.add(this.root);
    if (this.state === 'dormant') { this.deadK = 1; this.dropSide = opts.side ?? 1; }
    if (this.state === 'absent') this.root.visible = false;
    this.netPos = this.pos.clone(); this.netYaw = this.yaw;
    this.loop = null;
    this.hitParts = [];
    this.update(0, 0);
  }

  dispose() {
    this.game.scene.remove(this.root);
    if (this.loop) { this.loop.stop(0.2); this.loop = null; }
  }

  isAlive() { return this.state !== 'dead'; }
  visibleActive() { return this.state !== 'absent' && this.state !== 'dead'; }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    if (s === 'chase' && this.kind === 'warden') this.game.onWardenChase(this, true);
    if (s !== 'chase' && this.kind === 'warden') this.game.onWardenChase(this, false);
  }

  // --------------------------------------------------------------- host AI
  think(dt) {
    const g = this.game;
    this.stateT += dt;
    this.attackCd -= dt;
    this.voiceT -= dt;
    if (this.state === 'dead' || this.state === 'absent') return;
    if (this.state === 'dormant') {
      // wake when someone gets close or makes noise nearby
      const p = g.nearestPlayer(this.pos, true);
      if (p && p.dist < this.wakeRadius && !this.scriptOnly) this.wake(p.p);
      return;
    }
    if (this.state === 'rise') {
      this.riseK = Math.min(1, this.stateT / 1.6);
      if (this.riseK >= 1) { this.deadK = 0; this.setState(this.target ? 'chase' : 'idle'); }
      return;
    }
    if (this.state === 'stagger') { if (this.stateT > (this.kind === 'warden' ? this.staggerDur : 0.45)) this.setState(this.target ? 'chase' : 'investigate'); return; }
    if (this.state === 'attack' || this.state === 'grab') { this.doAttack(dt); return; }
    if (this.state === 'bash') {
      if (this.stateT > 1.1) {
        const d = this.bashDoor;
        if (d && d.blocking()) g.netEvent({ t: 'door', id: d.id, open: true, slam: true, dir: d.dirFrom(this.pos.x, this.pos.z) });
        this.bashDoor = null; this.setState('chase');
      }
      return;
    }

    // perception
    this.perceive(dt);
    const T = this.target;
    let goal = null, speed = 0;
    const walk = this.kind === 'warden' ? 1.45 : 1.05;
    const run = (this.kind === 'warden' ? 4.25 * (DIFF[CFG.difficulty] || DIFF.normal).wardenSpeed : this.crawler ? 2.7 : 3.4) * (1 - this.limp * 0.4);
    switch (this.state) {
      case 'idle':
        if (this.stateT > rand(3, 7)) this.setState('wander');
        break;
      case 'wander':
        if (!this.wanderGoal || this.pos.distanceTo(this.wanderGoal) < 0.8 || this.stateT > 14) {
          const r = g.level.grid.randomWalkable(Math.random, this.home || this.pos, this.kind === 'warden' ? 14 : 7);
          this.wanderGoal = r ? new THREE.Vector3(r.x, 0, r.z) : null;
          if (this.kind === 'warden' && Math.random() < 0.6) {
            // the Warden drifts toward wherever people are
            const p = g.randomPlayer();
            if (p) { const q = g.level.grid.randomWalkable(Math.random, p.pos, 7); if (q) this.wanderGoal = new THREE.Vector3(q.x, 0, q.z); }
          }
          this.stateT = 0;
          if (this.kind !== 'warden' && Math.random() < 0.4) { this.setState('idle'); break; }
        }
        goal = this.wanderGoal; speed = walk;
        break;
      case 'investigate':
      case 'search':
        goal = this.investigate; speed = walk * 1.4;
        if (!goal || this.pos.distanceTo(goal) < 1.0) {
          if (this.state === 'investigate') { this.setState('search'); this.investigate = this.pickNear(this.pos, 4); }
          else if (this.stateT > 8) this.setState(this.kind === 'warden' ? 'wander' : 'idle');
          else this.investigate = this.pickNear(this.pos, 4);
        }
        break;
      case 'chase':
        if (!T) { this.setState('search'); break; }
        goal = this.lastSeenT < 0.5 ? T.pos : this.lastSeen;
        speed = run;
        if (this.lastSeenT > (this.kind === 'warden' ? 5 : 7)) { this.investigate = this.lastSeen; this.target = null; this.setState('search'); break; }
        if (T.p.hidden) {
          if (this.kind === 'warden' && T.p.hiddenSeen) { goal = T.pos; }
          else { this.investigate = this.lastSeen; this.target = null; this.setState('search'); break; }
        }
        {
          const d = Math.hypot(T.pos.x - this.pos.x, T.pos.z - this.pos.z);
          const reach = this.kind === 'warden' ? 1.45 : 1.25;
          if (d < reach && this.attackCd <= 0 && !T.p.downed) {
            this.setState(this.kind === 'warden' ? 'grab' : 'attack');
            this.attackT = 0; this.hitDone = false; this.attackTarget = T;
          }
          if (T.p.downed && this.kind === 'hollow' && d < 1.4) { speed = 0; goal = null; }
        }
        break;
      case 'leave':
        goal = this.leaveGoal; speed = walk * 1.2;
        if (!goal || this.pos.distanceTo(goal) < 1 || (this.stateT > 4 && !g.anyPlayerSees(this.pos, 18))) this.vanish();
        break;
    }
    this.moveToward(goal, speed, dt);
    // vocalise
    if (this.voiceT <= 0) {
      this.voiceT = this.state === 'chase' ? rand(2.5, 5) : rand(5, 11);
      if (this.kind === 'hollow') g.netSound(this.state === 'chase' ? 'hollow_attack' : 'hollow_idle_' + ((Math.random() * 3) | 0), this.headPos(), 0.8, 0.15);
      else g.netSound(this.state === 'chase' ? 'warden_hit' : 'warden_breath', this.headPos(), 1.0, 0.1);
    }
  }

  pickNear(p, r) {
    const q = this.game.level.grid.randomWalkable(Math.random, p, r);
    return q ? new THREE.Vector3(q.x, 0, q.z) : p.clone();
  }

  wake(p) {
    this.target = p ? this.game.playerRef(p) : null;
    this.setState('rise');
    this.game.netSound('hollow_alert', this.headPos(), 1.0, 0.1);
    this.game.netEvent({ t: 'ewake', id: this.id });
  }

  hear(pos, radius, kind) {
    if (this.state === 'dead' || this.state === 'absent' || this.state === 'attack' || this.state === 'grab') return;
    const d = this.pos.distanceTo(pos);
    if (d > radius) return;
    if (this.state === 'dormant') { if (d < radius * 0.6 && !this.scriptOnly) this.wake(null); return; }
    if (this.state === 'chase') return;
    this.investigate = pos.clone(); this.investigate.y = 0;
    if (this.state !== 'investigate') { this.setState('investigate'); if (this.kind === 'hollow' && Math.random() < 0.5) this.game.netSound('hollow_idle_1', this.headPos(), 0.8); }
  }

  perceive(dt) {
    const g = this.game;
    this.lastSeenT += dt;
    let best = null, bestScore = 0;
    for (const P of g.allPlayers()) {
      if (P.p.dead || (P.p.hidden && !(this.kind === 'warden' && P.p.hiddenSeen && this.target && this.target.slot === P.slot))) continue;
      const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const range = this.kind === 'warden' ? 22 : 15;
      if (d > range) continue;
      const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - this.yaw));
      const fov = this.state === 'chase' ? Math.PI : 1.25;
      const close = d < 2.2;
      if (ang > fov && !close) continue;
      _a.set(this.pos.x, 1.6, this.pos.z); _b.set(P.pos.x, P.p.crouch ? 0.9 : 1.4, P.pos.z);
      if (!g.level.grid.lineOfSight(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z)) continue;
      // how visible is the player: flashlight on and lit areas count a lot
      let vis = 0.35 + (P.p.flashOn ? 0.75 : 0) + (P.p.sprinting ? 0.4 : 0) - (P.p.crouch ? 0.25 : 0);
      vis *= clamp(1.4 - d / range, 0.15, 1.4);
      if (close) vis += 1.5;
      if (vis > bestScore) { bestScore = vis; best = P; }
    }
    if (best) {
      this.alert = Math.min(1.5, this.alert + bestScore * dt * (this.state === 'chase' ? 3 : 1.1));
      if (this.alert >= 1 || this.state === 'chase') {
        if (!this.target || this.target.slot !== best.slot) this.target = best;
        this.lastSeen = best.pos.clone(); this.lastSeenT = 0;
        if (this.target.p.hidden) this.target.p.hiddenSeen = true;
        if (this.state !== 'chase') {
          this.setState('chase');
          this.game.netSound(this.kind === 'warden' ? 'warden_scream' : 'hollow_alert', this.headPos(), 1.0, 0.1);
          if (this.kind === 'warden') this.game.stinger('sting_jump');
        }
      }
    } else this.alert = Math.max(0, this.alert - dt * 0.35);
    // refresh target position (players move)
    if (this.target) { const fresh = g.playerRef(this.target.p); if (fresh) this.target = fresh; }
  }

  moveToward(goal, speed, dt) {
    const g = this.game;
    const grid = g.level.grid;
    let dirX = 0, dirZ = 0;
    if (goal && speed > 0) {
      const direct = this.pos.distanceTo(goal) < 7 && grid.lineOfSight(this.pos.x, 1.0, this.pos.z, goal.x, 1.0, goal.z);
      if (direct) { this.path = null; dirX = goal.x - this.pos.x; dirZ = goal.z - this.pos.z; }
      else {
        this.pathT -= dt;
        if (!this.path || this.pathT <= 0 || !this.pathGoal || this.pathGoal.distanceTo(goal) > 1.5) {
          this.path = grid.findPath(this.pos.x, this.pos.z, goal.x, goal.z, true);
          this.pathGoal = goal.clone();
          this.pathT = 0.6;
          if (!this.path) { this.stuck = (this.stuck || 0) + 1; }
        }
        if (this.path && this.path.length) {
          let wp = this.path[0];
          while (this.path.length > 1 && Math.hypot(wp[0] - this.pos.x, wp[1] - this.pos.z) < 0.45) { this.path.shift(); wp = this.path[0]; }
          // skip ahead when the next-next waypoint is visible
          if (this.path.length > 1) {
            const n2 = this.path[1];
            if (grid.lineOfSight(this.pos.x, 1, this.pos.z, n2[0], 1, n2[1])) { this.path.shift(); wp = n2; }
          }
          dirX = wp[0] - this.pos.x; dirZ = wp[1] - this.pos.z;
          // doors on the way: hollows open, the Warden smashes
          const cx = Math.floor(wp[0]), cz = Math.floor(wp[1]);
          const door = grid.doorAt(cx, cz);
          if (door && door.blocking() && Math.hypot(wp[0] - this.pos.x, wp[1] - this.pos.z) < 1.4) {
            if (door.locked) { this.path = null; this.pathT = 1; }
            else if (this.kind === 'warden') { this.bashDoor = door; this.setState('bash'); g.netSound('warden_hit', this.headPos(), 1); return; }
            else g.netEvent({ t: 'door', id: door.id, open: true, dir: door.dirFrom(this.pos.x, this.pos.z) });
          }
        }
      }
    }
    const L = Math.hypot(dirX, dirZ);
    let tvx = 0, tvz = 0;
    if (L > 0.05) { tvx = dirX / L * speed; tvz = dirZ / L * speed; }
    // separation from other monsters
    for (const e of g.enemies) {
      if (e === this || !e.visibleActive()) continue;
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.7 && d > 0.001) { tvx += dx / d * 1.5; tvz += dz / d * 1.5; }
    }
    this.vel.x = damp(this.vel.x, tvx, 6, dt);
    this.vel.z = damp(this.vel.z, tvz, 6, dt);
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    [nx, nz] = grid.collide(nx, nz, this.kind === 'warden' ? 0.34 : 0.28);
    this.speed = Math.hypot(nx - this.pos.x, nz - this.pos.z) / Math.max(dt, 1e-4);
    this.pos.x = nx; this.pos.z = nz;
    if (this.speed > 0.2) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 7, dt);
    else if (this.target && this.state === 'chase') this.yaw = dampAngle(this.yaw, Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z), 6, dt);
  }

  doAttack(dt) {
    const g = this.game;
    const T = this.attackTarget;
    const dur = this.kind === 'warden' ? 1.4 : 0.85;
    this.attackT += dt / dur;
    if (T) {
      const fresh = g.playerRef(T.p);
      if (fresh) this.yaw = dampAngle(this.yaw, Math.atan2(fresh.pos.x - this.pos.x, fresh.pos.z - this.pos.z), 10, dt);
    }
    this.speed = 0;
    if (!this.hitDone && this.attackT > (this.kind === 'warden' ? 0.35 : 0.45)) {
      this.hitDone = true;
      const fresh = T && g.playerRef(T.p);
      if (fresh && !fresh.p.dead) {
        const d = Math.hypot(fresh.pos.x - this.pos.x, fresh.pos.z - this.pos.z);
        const reach = this.kind === 'warden' ? 1.9 : 1.7;
        const hidden = fresh.p.hidden && !fresh.p.hiddenSeen;
        if (d < reach && !hidden) {
          if (this.kind === 'warden') {
            g.damagePlayer(fresh.slot, 48, { bleed: 2, fracture: 0.45, from: this.pos.clone(), kind: 'warden' });
            g.netSound('warden_scream', this.headPos(), 1, 0.15);
            g.netSound('crunch', fresh.pos.clone().setY(1.2), 1);
          } else {
            g.damagePlayer(fresh.slot, 15, { bleed: Math.random() < 0.45 ? (Math.random() < 0.2 ? 2 : 1) : 0, fracture: 0.03, from: this.pos.clone(), kind: 'hollow' });
            g.netSound('flesh_tear', fresh.pos.clone().setY(1.2), 0.8);
          }
        }
      }
      g.netSound(this.kind === 'warden' ? 'warden_hit' : 'hollow_attack', this.headPos(), 1);
    }
    if (this.attackT >= 1) {
      this.attackCd = this.kind === 'warden' ? 2 : 1.1;
      if (this.kind === 'warden' && this.hitDone) {
        // after landing a grab the Warden withdraws into the dark for a while
        this.startLeave();
      } else this.setState('chase');
    }
  }

  startLeave() {
    const g = this.game;
    const far = g.level.grid.randomWalkable(Math.random, this.pos, 18);
    this.leaveGoal = far ? new THREE.Vector3(far.x, 0, far.z) : this.pos.clone();
    this.target = null;
    this.setState('leave');
  }

  vanish() {
    this.root.visible = false;
    this.setState('absent');
    this.game.onWardenGone(this);
  }

  appear(x, z) {
    this.pos.set(x, 0, z);
    this.netPos.copy(this.pos);
    this.root.visible = true;
    this.alert = 0; this.target = null;
    this.home = this.pos.clone();
    this.setState('wander');
    this.presence = 0;
  }

  // part-aware damage (host)
  damage(dmg, part, dir, by) {
    if (this.state === 'dead' || this.state === 'absent') return;
    const g = this.game;
    if (this.state === 'dormant') this.wake(null);
    if (this.kind === 'warden') {
      // bullets only make him stagger
      this.staggerDur = Math.min(3.2, (this.state === 'stagger' ? this.staggerDur : 0) + (dmg > 80 ? 2.6 : 0.9));
      this.flinch = 1;
      this.setState('stagger');
      g.netSound('warden_hit', this.headPos(), 1, 0.1);
      if (by !== undefined && !this.target) { const p = g.playerBySlot(by); if (p) { this.target = p; this.lastSeen = p.pos.clone(); this.lastSeenT = 0; } }
      return;
    }
    const mult = part === 'head' ? 2.6 : part === 'leg' ? 0.75 : part === 'arm' ? 0.6 : 1;
    this.hp -= dmg * mult;
    this.flinch = 1;
    if (part === 'leg' && Math.random() < 0.5) { this.limp = Math.min(1, this.limp + 0.6); if (this.limp >= 1 && !this.crawler && Math.random() < 0.5) this.crawler = true; }
    if (by !== undefined) { const p = g.playerBySlot(by); if (p) { this.target = p; this.lastSeen = p.pos.clone(); this.lastSeenT = 0; this.alert = 1.2; } }
    if (this.hp <= 0) this.die(dir);
    else {
      g.netSound('hollow_pain', this.headPos(), 0.9, 0.12);
      if (this.state !== 'attack') { this.setState('stagger'); }
    }
  }

  die(dir) {
    const g = this.game;
    this.hp = 0;
    this.dropSide = dir ? (Math.sign(Math.sin(this.yaw) * dir.x + Math.cos(this.yaw) * dir.z) || 1) : 1;
    this.setState('dead');
    this.deadK = 0;
    g.netSound('hollow_death', this.headPos(), 1, 0.1);
    g.netEvent({ t: 'edie', id: this.id, side: this.dropSide });
    g.onEnemyKilled(this);
  }

  headPos() { return _c.set(this.pos.x, this.kind === 'warden' ? 2.3 : 1.6, this.pos.z).clone(); }

  // --------------------------------------------------------------- all peers
  update(dt, t) {
    const g = this.game;
    if (this.state === 'absent') { this.root.visible = false; if (this.loop) { this.loop.stop(0.5); this.loop = null; } return; }
    this.root.visible = true;
    this.phase += dt * (this.speed * (this.kind === 'warden' ? 2.0 : this.crawler ? 3.2 : 2.9) + 0.0);
    this.flinch = damp(this.flinch, 0, 6, dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const inst = this.inst;
    if (this.state === 'dead') {
      this.deadK = Math.min(1, this.deadK + dt * 2.2);
      const e = 1 - Math.pow(1 - this.deadK, 3);
      deadPose(inst, e, this.dropSide);
      if (!this.pooled && this.deadK >= 1) {
        this.pooled = true;
        if (CFG.blood !== 'off') { g.fx.bloodPool(this.pos.x, this.pos.z, 1.1); setTimeout(() => g.fx.bloodPool(this.pos.x + rand(-0.2, 0.2), this.pos.z + rand(-0.2, 0.2), 1.8), 1500); }
        g.audio.play('flesh', { pos: this.pos.clone().setY(0.3), vol: 0.6 });
      }
    } else if (this.state === 'dormant') {
      deadPose(inst, 1, this.dropSide);
    } else if (this.state === 'rise') {
      const k = this.riseK || Math.min(1, this.stateT / 1.6);
      deadPose(inst, 1 - k * k * (3 - 2 * k), this.dropSide);
      inst.bones.head.rotation.z += Math.sin(t * 25) * 0.15 * (1 - k);
    } else if (this.crawler) {
      this.crawlK = Math.min(1, this.crawlK + dt * 2);
      crawlPose(inst, this.phase, this.crawlK, t);
    } else {
      const sp = this.kind === 'warden' ? this.speed / 2.2 : this.speed / 1.6;
      const st = {
        phase: this.phase, speed: sp, t, twitch: this.kind === 'hollow' ? 0.35 + (this.state === 'chase' ? 0.3 : 0) : 0.08,
        reach: this.kind === 'hollow' ? (this.state === 'chase' ? 0.7 : 0.25) : (this.state === 'chase' ? 0.15 : 0),
        hunch: this.kind === 'warden' ? 0.35 : 0.15, flinch: this.flinch,
        attack: (this.state === 'attack' || this.state === 'grab') ? clamp(this.attackT, 0, 1) : 0, grab: this.state === 'grab',
        yaw: Math.sin(t * 0.7 + this.phase) * 0.3, pitch: this.kind === 'warden' ? -0.15 : 0.1, tilt: this.kind === 'hollow' ? Math.sin(t * 0.5) * 0.3 : 0,
      };
      if (this.state === 'stagger') { st.flinch = 1; st.hunch += 0.4; }
      if (this.state === 'bash') { st.attack = (this.stateT % 0.55) / 0.55; st.grab = true; }
      animate(inst, st);
    }
    // footsteps
    if (this.speed > 0.3 && this.state !== 'dead') {
      this.stepAcc += this.speed * dt;
      const stride = this.kind === 'warden' ? 1.3 : 0.75;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        const vol = this.kind === 'warden' ? 1.0 : 0.45;
        g.audio.play(this.kind === 'warden' ? 'warden_step' : 'bare_step', { pos: _d.set(this.pos.x, 0.1, this.pos.z).clone(), vol, ref: this.kind === 'warden' ? 3 : 1.5, vary: 0.15 });
        if (this.kind === 'warden' && Math.random() < 0.5) g.audio.play('warden_drag', { pos: this.pos.clone().setY(0.4), vol: 0.35, ref: 2 });
      }
    }
  }

  // hit-test against simple body-part shapes built from bone positions
  raycast(o, d, maxT) {
    if (this.state === 'absent' || this.state === 'dead') return null;
    const B = this.inst.bones;
    this.root.updateMatrixWorld(true);
    const w = (b, out) => b.getWorldPosition(out);
    const s = this.inst.scale;
    const parts = [
      ['head', w(B.head, new THREE.Vector3()).add(new THREE.Vector3(0, 0.1 * s, 0)), null, 0.12 * s],
      ['body', w(B.hips, new THREE.Vector3()), w(B.neck, new THREE.Vector3()), 0.19 * s],
      ['arm', w(B.armL, new THREE.Vector3()), w(B.handL, new THREE.Vector3()), 0.065 * s],
      ['arm', w(B.armR, new THREE.Vector3()), w(B.handR, new THREE.Vector3()), 0.065 * s],
      ['leg', w(B.thighL, new THREE.Vector3()), w(B.footL, new THREE.Vector3()), 0.085 * s],
      ['leg', w(B.thighR, new THREE.Vector3()), w(B.footR, new THREE.Vector3()), 0.085 * s],
    ];
    let best = null;
    for (const [part, a, b, r] of parts) {
      const t = b ? rayCapsule(o, d, a, b, r) : raySphere(o, d, a, r);
      if (t !== null && t > 0 && t < maxT && (!best || t < best.t)) best = { t, part };
    }
    if (best) best.point = o.clone().addScaledVector(d, best.t);
    return best;
  }

  snapshot() {
    return [this.id, Math.round(this.pos.x * 100) / 100, Math.round(this.pos.z * 100) / 100, Math.round(this.yaw * 100) / 100, STATE_CODES.indexOf(this.state), Math.round(this.speed * 10) / 10, this.crawler ? 1 : 0, Math.round(clamp(this.attackT, 0, 1) * 20) / 20];
  }
  applySnapshot(s, dt) {
    this.netPos.set(s[1], 0, s[2]);
    this.netYaw = s[3];
    const st = STATE_CODES[s[4]];
    if (st !== this.state) {
      if (st === 'dead' && this.state !== 'dead') this.deadK = 0;
      this.state = st; this.stateT = 0;
      if (st === 'rise') this.riseK = 0;
    }
    this.speed = s[5];
    this.crawler = !!s[6];
    this.attackT = s[7];
  }
  netSmooth(dt) {
    if (this.state === 'rise') { this.stateT += dt; this.riseK = Math.min(1, this.stateT / 1.6); }
    if (this.pos.distanceTo(this.netPos) > 4) this.pos.copy(this.netPos);
    this.pos.x = damp(this.pos.x, this.netPos.x, 10, dt);
    this.pos.z = damp(this.pos.z, this.netPos.z, 10, dt);
    this.yaw = dampAngle(this.yaw, this.netYaw, 10, dt);
  }
}

function raySphere(o, d, c, r) {
  _a.copy(o).sub(c);
  const b = _a.dot(d), cc = _a.dot(_a) - r * r;
  const h = b * b - cc;
  if (h < 0) return null;
  return -b - Math.sqrt(h);
}
function rayCapsule(ro, rd, pa, pb, r) {
  const ba = _a.copy(pb).sub(pa), oa = _b.copy(ro).sub(pa);
  const baba = ba.dot(ba), bard = ba.dot(rd), baoa = ba.dot(oa), rdoa = rd.dot(oa), oaoa = oa.dot(oa);
  const a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h >= 0) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
    const oc = y <= 0 ? oa : _c.copy(ro).sub(pb);
    const bb = rd.dot(oc), cc2 = oc.dot(oc) - r * r;
    const hh = bb * bb - cc2;
    if (hh > 0) return -bb - Math.sqrt(hh);
  }
  return null;
}

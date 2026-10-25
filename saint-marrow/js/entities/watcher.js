// The figure in the woods: a tall, pale shape that stands between the trees and watches. It does not attack.
// It keeps its distance — walk toward it, hold your gaze on it or put the torch on it and it slips behind a tree and is gone.
//
// Watcher is the visible body (on every machine). WatcherDirector runs on the host and decides when and where it shows
// itself; both go through game.netEvent ('wshow' / 'whide') so every player in co-op sees the same thing.
import * as THREE from '../../lib/three.module.js';
import { buildCreatureTemplate, instantiate, animate } from './creatures.js';
import { T } from '../world/grid.js';
import { clamp, damp, rand, wrapAngle } from '../util.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Watcher {
  constructor(game) {
    this.game = game;
    const tpl = buildCreatureTemplate('watcher', game.assets, game.skinDetail, game.renderer.qname);
    this.inst = instantiate(tpl, game.assets);
    this.root = this.inst.root;
    this.root.visible = false;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.state = 'gone';         // gone | watch | leave
    this.t = 0;
    this.leaveTo = new THREE.Vector3();
    this.head = { yaw: 0, pitch: 0 };
    game.scene.add(this.root);
  }

  dispose() { this.game.scene.remove(this.root); }
  visible() { return this.state !== 'gone'; }

  show(x, z, opts = {}) {
    this.pos.set(x, 0, z);
    const p = this.game.player.pos;
    this.yaw = Math.atan2(p.x - x, p.z - z);
    this.state = 'watch';
    this.t = 0;
    this.tilt = rand(-0.25, 0.25);
    this.peek = opts.peek ? 1 : 0;
    this.root.visible = true;
    this.place();
  }

  /** mode 'step': it steps sideways behind cover and is gone; 'instant': gone now (used when nobody is looking). */
  hide(mode = 'step', to) {
    if (this.state === 'gone') return;
    if (mode === 'instant') { this.state = 'gone'; this.root.visible = false; return; }
    this.state = 'leave';
    this.t = 0;
    if (to) this.leaveTo.set(to[0], 0, to[1]);
    else { const side = Math.random() < 0.5 ? 1 : -1; this.leaveTo.set(this.pos.x + Math.cos(this.yaw) * side * 1.6, 0, this.pos.z - Math.sin(this.yaw) * side * 1.6); }
    this.game.audio.play('branch', { pos: this.pos.clone().setY(0.3), vol: 0.5, ref: 3 });
  }

  place() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  update(dt, t) {
    if (this.state === 'gone') return;
    this.t += dt;
    const P = this.game.player;
    // look at the nearest player
    _v.copy(P.pos).sub(this.pos);
    const want = Math.atan2(_v.x, _v.z);
    let speed = 0;
    if (this.state === 'watch') {
      // the body barely turns; the head follows
      this.yaw = this.yaw + wrapAngle(want - this.yaw) * Math.min(1, dt * 0.25);
    } else if (this.state === 'leave') {
      _w.copy(this.leaveTo).sub(this.pos);
      const d = _w.length();
      if (d < 0.1 || this.t > 1.4) { this.state = 'gone'; this.root.visible = false; return; }
      this.yaw = this.yaw + wrapAngle(Math.atan2(_w.x, _w.z) - this.yaw) * Math.min(1, dt * 6);
      this.pos.addScaledVector(_w.normalize(), Math.min(d, dt * 1.9));
      speed = 1;
    }
    const rel = wrapAngle(want - this.yaw);
    this.head.yaw = damp(this.head.yaw, clamp(rel, -1.2, 1.2), 3, dt);
    const dy = (P.eye ?? 1.6) - 2.25;
    this.head.pitch = damp(this.head.pitch, clamp(-Math.atan2(dy, Math.max(1, _v.length())), -0.4, 0.3), 3, dt);
    this.place();
    animate(this.inst, {
      t, speed: speed * 0.9, phase: t * 5.5, twitch: this.state === 'watch' ? 0.08 + Math.max(0, Math.sin(t * 0.7)) * 0.05 : 0.02,
      yaw: this.head.yaw, pitch: this.head.pitch, tilt: this.tilt + Math.sin(t * 0.4) * 0.05, hunch: 0.15 + this.peek * 0.25, reach: 0,
    });
  }
}

/** Host-side: decides sightings. cfg: { gap: [min, max] seconds between sightings, dist: [min, max], near: vanish distance } */
export class WatcherDirector {
  constructor(game, cfg = {}) {
    this.game = game;
    this.cfg = Object.assign({ gap: [35, 70], dist: [18, 40], near: 13, stay: [12, 30], first: 25 }, cfg);
    this.timer = this.cfg.first;
    this.lookT = 0;
    this.lightT = 0;
    this.stayT = 0;
    this.enabled = cfg.enabled !== false;
  }

  /** a scripted sighting at a given place */
  showAt(x, z, opts = {}) {
    this.game.netEvent({ t: 'wshow', x, z, peek: !!opts.peek });
    this.stayT = opts.stay ?? rand(...this.cfg.stay);
    this.lookT = 0; this.lightT = 0;
    this.noVanish = !!opts.noVanish;
  }

  hide(mode = 'step') { this.game.netEvent({ t: 'whide', mode }); }

  update(dt) {
    const g = this.game, W = g.watcher;
    if (!W) return;
    const players = g.allPlayers().filter((x) => !x.p.dead);
    if (!players.length) return;
    if (W.visible()) {
      if (W.state !== 'watch') return;
      this.stayT -= dt;
      let nearest = Infinity, looked = false, lit = false, seen = false;
      for (const pl of players) {
        const p = pl.p, pos = pl.pos || p.pos;
        const d = Math.hypot(pos.x - W.pos.x, pos.z - W.pos.z);
        nearest = Math.min(nearest, d);
        // is it in this player's view, and can they see it?
        const yaw = pl.yaw ?? p.yaw, pitch = pl.pitch ?? p.pitch ?? 0;
        const fx = -Math.sin(yaw) * Math.cos(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
        const dx = (W.pos.x - pos.x) / d, dz = (W.pos.z - pos.z) / d;
        const dot = fx * dx + fz * dz;
        const los = g.level.grid.lineOfSight(pos.x, 1.6, pos.z, W.pos.x, 1.9, W.pos.z);
        if (los && dot > 0.55) seen = true;
        if (los && dot > 0.985 && d < 45) looked = true;
        if (los && (p.flashOn ?? pl.flashOn) && dot > 0.97 && d < 22) lit = true;
      }
      this.lookT = looked ? this.lookT + dt : Math.max(0, this.lookT - dt * 0.5);
      this.lightT = lit ? this.lightT + dt : 0;
      if (this.noVanish && this.stayT > 0) return;
      if (nearest < this.cfg.near || this.lookT > 2.2 || this.lightT > 0.7 || this.stayT <= 0) {
        this.hide(seen ? 'step' : 'instant');
        this.timer = rand(...this.cfg.gap);
      }
      return;
    }
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    const spot = this.findSpot(players);
    if (spot) this.showAt(spot[0], spot[1]);
    else this.timer = 4;
  }

  /** a tree-shadowed spot at the edge of somebody's view, in line of sight, not too close */
  findSpot(players) {
    const g = this.game, grid = g.level.grid;
    const pl = players[Math.floor(Math.random() * players.length)];
    const pos = pl.pos || pl.p.pos, yaw = pl.yaw ?? pl.p.yaw;
    const cells = g.level.treeCells;
    for (let tries = 0; tries < 60; tries++) {
      const dist = rand(...this.cfg.dist);
      // we want it ahead-ish: forward is -sin(yaw), -cos(yaw)
      const a = yaw + rand(-0.75, 0.75);
      const x = pos.x - Math.sin(a) * dist, z = pos.z - Math.cos(a) * dist;
      const cx = Math.floor(x), cz = Math.floor(z);
      const tt = grid.get(cx, cz);
      if (tt !== T.GROUND && tt !== T.GRASS && tt !== T.PATH) continue;
      if (grid.blocked(x, z, 0.35)) continue;
      // next to a tree, so it has somewhere to step behind
      let tree = null;
      for (const [tx, tz] of cells) if (Math.abs(tx + 0.5 - x) < 1.6 && Math.abs(tz + 0.5 - z) < 1.6) { tree = [tx, tz]; break; }
      if (!tree) continue;
      if (!grid.lineOfSight(pos.x, 1.6, pos.z, x, 1.9, z)) continue;
      if (players.some((p) => Math.hypot((p.pos || p.p.pos).x - x, (p.pos || p.p.pos).z - z) < this.cfg.dist[0])) continue;
      return [x, z, tree];
    }
    return null;
  }
}

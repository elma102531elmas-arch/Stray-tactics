// Playtest world: runs a map the way the game would — walking, doors and locks, pickups, interactions, trigger volumes, event graphs,
// checkpoints — WITHOUT modifying the scene model (all runtime state lives here). DOM-free so it is unit-tested; the UI adds rendering/input.
//
// Rules mirror saint-marrow/js/game.js interact(): locks "code:NNNN" (keypad), "item:<id>" (needs the item), "power", "chain", "jammed"
// (a message until an event unlocks the door), "script" (emits use:<doorId>). Everything else is an approximation and is documented in docs/KNOWN_LIMITATIONS.md.

import * as THREE from '../../lib/three.module.js';
import { propsOf, worldColliders, nodeWorldAABB } from './geometry.js';
import { CollisionWorld } from './collision.js';
import { EventRuntime } from './events.js';
import { PLAYER_REFERENCE } from './game-constants.js';
import { deepClone } from './util.js';
import { AISystem } from './aisystem.js';

const D2R = Math.PI / 180;
const REACH = PLAYER_REFERENCE.interactReach;
const MESSAGES = { chain: 'The door is chained shut.', jammed: 'The door is jammed.', power: 'There is no power.', needItem: (i) => `You need: ${i}.`, wrongCode: 'Wrong code.', locked: 'It is locked.' };

export class PlaytestWorld {
  constructor(project, { rng = Math.random, spawn = null, from = null } = {}) {
    this.project = project;
    this.scene = project.scene;
    this.geo = project.geoCtx;
    this.rng = rng;
    this.time = 0;
    this.colliders = worldColliders(this.scene, this.geo);
    this.world = new CollisionWorld(this.colliders);
    this.messages = [];           // {text, t}
    this.sequenceRequests = [];   // sequence ids to play
    this.noises = [];             // {pos, radius, kind, t}
    this.systems = [];            // extension points: {update(dt, world)}
    this.fired = [];              // every event that fired (for the debug view / tests)
    this.checkpointSnap = null;
    this.player = { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, crouch: 0, grounded: false, hp: 100 };
    this.inventory = {};
    this.used = new Set();        // node ids of used pickups / single-use interactions
    this.enabled = new Map();     // node id/name -> boolean override
    this.lights = {};             // power group -> 'on' | 'off' | 'flicker'
    this.objective = '';
    this._buildDoors();
    this._buildTriggers();
    const graphs = deepClone(project.data.events?.graphs || {});
    this.runtime = new EventRuntime(graphs, this._adapter(), { rng });
    this._spawnPlayer(spawn, from);
    this.dead = false;
    if (project.scene.find((n) => n.type === 'enemySpawn').length) { this.ai = new AISystem(this); this.systems.push(this.ai); }
    this.runtime.start();
  }

  // ------------------------------------------------------------------ setup
  _spawnPlayer(spawn, from) {
    let p;
    if (from) p = { x: from.x, y: from.y, z: from.z, yaw: from.yaw || 0 };
    else {
      const node = (spawn && (this.scene.get(spawn) || this.scene.byName(spawn))) || this.scene.find((n) => n.type === 'playerSpawn')[0];
      if (node) { const w = this.scene.worldPosition(node.id); const e = new THREE.Euler().setFromRotationMatrix(this.scene.worldMatrix(node.id), 'YXZ'); p = { x: w.x, y: w.y, z: w.z, yaw: e.y / D2R }; }
      else { const b = this.scene.all().find((n) => n.type === 'floor'); const w = b ? this.scene.worldPosition(b.id) : new THREE.Vector3(); p = { x: w.x, y: w.y, z: w.z, yaw: 0 }; this.message('No player spawn in this map — starting on the first floor.'); }
    }
    Object.assign(this.player, p, { vy: 0, pitch: 0 });
    // settle on the ground
    for (let i = 0; i < 20; i++) Object.assign(this.player, this.world.movePlayer(this.player, 0, 0, 1 / 60));
  }

  _buildDoors() {
    this.doors = new Map();
    for (const n of this.scene.find((x) => x.type === 'door')) {
      const p = propsOf(n), id = p.doorId || n.name;
      const open = p.state === 'open';
      this.doors.set(id, { id, node: n, locked: p.locked || '', open, amount: open ? 1 : 0, center: new THREE.Vector3(0, p.height / 2, 0).applyMatrix4(this.scene.worldMatrix(n.id)) });
      this.world.doorOpen.set(id, open);
    }
  }

  _buildTriggers() {
    this.volumes = [];
    for (const n of this.scene.find((x) => ['trigger', 'checkpoint', 'arena'].includes(x.type))) {
      const cols = this.colliders.filter((c) => c.nodeId === n.id);
      if (cols[0]) this.volumes.push({ node: n, c: cols[0], inside: false, fired: false, p: propsOf(n) });
    }
    this.interactions = [];
    for (const n of this.scene.find((x) => x.type === 'interaction' || x.type === 'itemSpawn' || (x.type === 'model' && x.props.interaction?.enabled))) {
      this.interactions.push({ node: n, c: this.colliders.find((c) => c.nodeId === n.id) || null });
    }
  }

  _adapter() {
    const w = this;
    return {
      door: (id, action) => w.setDoor(id, action),
      light: (group, action) => { w.lights[group] = action; },
      say: (text, seconds) => w.message(text, seconds),
      objective: (t) => { w.objective = t; },
      sequence: (id) => w.sequenceRequests.push(id),
      checkpoint: (id) => w.saveCheckpoint(id),
      enable: (target, on) => { const n = w.scene.get(target) || w.scene.byName(target); w.enabled.set(n ? n.id : target, on); },
      teleport: (spawn) => { const n = w.scene.get(spawn) || w.scene.byName(spawn); if (n) w._spawnPlayer(n.id); },
      item: (item, action, count) => { w.inventory[item] = Math.max(0, (w.inventory[item] || 0) + (action === 'take' ? -count : count)); },
      spawn: (id) => w.systems.forEach((s) => s.spawn?.(id, w)),
      sound: (o) => w.fired.push({ t: w.time, sound: o.asset }),
    };
  }

  /** An enemy (or hazard) hurt the player. */
  damagePlayer({ amount, from }) {
    if (this.dead) return;
    this.player.hp = Math.max(0, this.player.hp - amount);
    this.message(`You were hit (−${amount}).`, 1.5);
    this.runtime.emit('player:hit', { amount });
    if (this.player.hp <= 0) { this.dead = true; this.message('You died.', 8); this.runtime.emit('player:died'); }
  }

  message(text, seconds = 3) { this.messages.push({ text, t: this.time, until: this.time + seconds }); }
  isEnabled(node, def = true) { return this.enabled.has(node.id) ? this.enabled.get(node.id) : this.enabled.has(node.name) ? this.enabled.get(node.name) : def; }

  // ------------------------------------------------------------------ doors
  setDoor(id, action) {
    const d = this.doors.get(id); if (!d) { this.message(`(door “${id}” does not exist)`); return false; }
    if (action === 'lock') d.locked = d.locked || 'script';
    else if (action === 'unlock') d.locked = '';
    else {
      const open = action === 'toggle' ? !d.open : action === 'open';
      d.open = open; this.world.doorOpen.set(id, open);
      this.noises.push({ pos: d.center.clone(), radius: 6, kind: 'door', t: this.time });
      this.runtime.emit(`door:${open ? 'open' : 'close'}:${id}`);
    }
    return true;
  }

  /** Try to use a door the way the player would. Returns {ok, message?, needsCode?}. */
  useDoor(d, { code = null } = {}) {
    const L = d.locked;
    if (L) {
      if (L.startsWith('code:')) { if (code === null) return { ok: false, needsCode: true, door: d }; if (code !== L.slice(5)) { this.message(MESSAGES.wrongCode); return { ok: false, message: MESSAGES.wrongCode }; } d.locked = ''; }
      else if (L.startsWith('item:')) { const it = L.slice(5); if (!this.inventory[it]) { const m = MESSAGES.needItem(it); this.message(m); return { ok: false, message: m }; } d.locked = ''; this.runtime.emit(`unlock:${d.id}`); }
      else if (L === 'script') { this.runtime.emit(`use:${d.id}`); return { ok: false, message: null }; }
      else { const m = MESSAGES[L] || MESSAGES.jammed; this.message(m); this.runtime.emit(`locked:${d.id}`); return { ok: false, message: m }; }
    }
    this.setDoor(d.id, 'toggle');
    return { ok: true };
  }

  // ------------------------------------------------------------------ look / interaction
  eye() { const p = this.player; return new THREE.Vector3(p.x, p.y + PLAYER_REFERENCE.eyeHeight + (PLAYER_REFERENCE.crouchEyeHeight - PLAYER_REFERENCE.eyeHeight) * p.crouch, p.z); }
  lookDir() { const p = this.player; const cp = Math.cos(p.pitch * D2R); return new THREE.Vector3(-Math.sin(p.yaw * D2R) * cp, Math.sin(p.pitch * D2R), -Math.cos(p.yaw * D2R) * cp); }

  /** What would "use" do right now? Returns {kind, label, target, distance} or null. */
  focus() {
    const o = this.eye(), d = this.lookDir();
    const wall = this.world.raycast(o, d, REACH + 1, { doors: true });
    const limit = Math.min(REACH, wall ? wall.t : REACH);
    let best = null;
    const consider = (rec) => { if (rec.distance <= limit + 0.001 && (!best || rec.distance < best.distance)) best = rec; };
    for (const door of this.doors.values()) {
      const c = this.colliders.find((x) => x.nodeId === door.node.id && x.kind === 'door'); if (!c) continue;
      const h = this.world.rayBox(c, o, d, REACH); if (h) consider({ kind: 'door', label: door.open ? 'close' : door.locked ? 'locked' : 'open', target: door, distance: h.t });
    }
    for (const it of this.interactions) {
      const n = it.node, p = propsOf(n);
      if (this.used.has(n.id) || !this.isEnabled(n, p.enabled !== false)) continue;
      if (n.type === 'itemSpawn') { const pos = this.scene.worldPosition(n.id).add(new THREE.Vector3(0, 0.2, 0)); const t = raySphere(o, d, pos, 0.45); if (t !== null) consider({ kind: 'item', label: `${p.prompt || 'take'} ${p.item || 'item'}`, target: it, distance: t }); continue; }
      const c = it.c; if (!c) continue;
      const inside = c.invRT && pointInCollider(c, o);
      const h = inside ? { t: 0 } : this.world.rayBox(c, o, d, REACH);
      if (h) consider({ kind: 'interaction', label: n.type === 'interaction' ? p.prompt || 'use' : p.interaction?.prompt || 'use', target: it, distance: h.t });
    }
    return best;
  }

  /** Press "use". Returns a description of what happened (also logged to `messages`). */
  use({ code = null } = {}) {
    const f = this.focus();
    if (!f) return { kind: 'none' };
    if (f.kind === 'door') return { kind: 'door', ...this.useDoor(f.target, { code }) };
    const n = f.target.node, p = propsOf(n);
    if (f.kind === 'item') {
      this.used.add(n.id);
      this.inventory[p.item] = (this.inventory[p.item] || 0) + (p.count || 1);
      this.message(`Picked up ${p.item}${p.count > 1 ? ' ×' + p.count : ''}.`);
      this.runtime.emit(p.event || `pickup:${p.item}`);
      return { kind: 'item', item: p.item };
    }
    const cfg = n.type === 'interaction' ? p : p.interaction;
    if (cfg.requires && !this.inventory[cfg.requires]) { const m = MESSAGES.needItem(cfg.requires); this.message(m); return { kind: 'interaction', ok: false, message: m }; }
    if (cfg.once) this.used.add(n.id);
    if (cfg.event) this.runtime.emit(cfg.event);
    return { kind: 'interaction', ok: true, event: cfg.event || null };
  }

  // ------------------------------------------------------------------ update
  step(dt, input = {}) {
    const P = this.player;
    if (this.dead) { this.time += dt; this.messages = this.messages.filter((m) => m.until > this.time); return null; }
    this.time += dt;
    // look
    P.yaw = (P.yaw - (input.lookDX || 0) * (180 / Math.PI)) % 360;
    P.pitch = Math.max(-89, Math.min(89, P.pitch - (input.lookDY || 0) * (180 / Math.PI)));
    // crouch eases
    const wantCrouch = input.crouch ? 1 : 0;
    P.crouch += Math.sign(wantCrouch - P.crouch) * Math.min(Math.abs(wantCrouch - P.crouch), dt * 6);
    // move
    const speed = input.crouch ? PLAYER_REFERENCE.crouchSpeed : input.sprint ? PLAYER_REFERENCE.sprintSpeed : PLAYER_REFERENCE.walkSpeed;
    const fx = -Math.sin(P.yaw * D2R), fz = -Math.cos(P.yaw * D2R);       // forward
    const rx = Math.cos(P.yaw * D2R), rz = -Math.sin(P.yaw * D2R);        // right
    let mx = input.mx || 0, my = input.my || 0; const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
    const before = { x: P.x, z: P.z };
    const next = this.world.movePlayer(P, (fx * my + rx * mx) * speed * dt, (fz * my + rz * mx) * speed * dt, dt, { radius: PLAYER_REFERENCE.radius, height: 1.8 - 0.75 * P.crouch });
    Object.assign(P, next);
    const moved = Math.hypot(P.x - before.x, P.z - before.z);
    if (moved > 0.001) { this.stepNoise = (this.stepNoise || 0) + moved; if (this.stepNoise > 0.9) { this.stepNoise = 0; this.noises.push({ pos: new THREE.Vector3(P.x, P.y, P.z), radius: input.crouch ? 1.5 : input.sprint ? 11 : 4.5, kind: 'footstep', t: this.time }); } }
    // doors animate
    for (const d of this.doors.values()) d.amount += Math.sign((d.open ? 1 : 0) - d.amount) * Math.min(Math.abs((d.open ? 1 : 0) - d.amount), dt / 0.45);
    // volumes
    this._updateVolumes();
    // time-based systems
    this.runtime.advance(dt);
    for (const s of this.systems) s.update?.(dt, this);
    this.noises = this.noises.filter((n) => this.time - n.t < 0.5);
    this.messages = this.messages.filter((m) => m.until > this.time);
    if (input.use) return this.use({ code: input.code ?? null });
    return null;
  }

  _updateVolumes() {
    const P = this.player, feet = new THREE.Vector3(P.x, P.y + 0.9, P.z);
    for (const v of this.volumes) {
      const n = v.node, p = v.p;
      if (!this.isEnabled(n, p.enabled !== false)) { v.inside = false; continue; }
      const inside = pointInCollider(v.c, feet);
      if (inside && !v.inside) {
        v.inside = true;
        if (n.type === 'checkpoint') { if (!v.fired) { v.fired = true; this.saveCheckpoint(p.checkpointId || n.name); } }
        else if (n.type === 'arena') this.runtime.emit(`arena:enter:${n.name}`);
        else if (!(p.once && v.fired) && (p.filter === 'player' || p.filter === 'any')) { v.fired = true; this.fired.push({ t: this.time, trigger: n.name, event: p.onEnter }); if (p.onEnter) this.runtime.emit(p.onEnter); }
      } else if (!inside && v.inside) {
        v.inside = false;
        if (n.type === 'trigger' && p.onExit) this.runtime.emit(p.onExit);
        else if (n.type === 'arena') this.runtime.emit(`arena:exit:${n.name}`);
      }
    }
  }

  // ------------------------------------------------------------------ checkpoints
  saveCheckpoint(id) {
    this.checkpointSnap = { id, player: { ...this.player }, inventory: { ...this.inventory }, used: [...this.used], flags: { ...this.runtime.state.flags }, vars: { ...this.runtime.state.vars }, doors: [...this.doors].map(([k, d]) => [k, { open: d.open, locked: d.locked }]), enabled: [...this.enabled], lights: { ...this.lights }, objective: this.objective };
    this.message(`Checkpoint saved${id ? ` (${id})` : ''}.`, 2);
    this.fired.push({ t: this.time, checkpoint: id });
  }
  restoreCheckpoint() {
    const s = this.checkpointSnap; if (!s) return false;
    Object.assign(this.player, s.player); this.inventory = { ...s.inventory }; this.used = new Set(s.used);
    this.runtime.state.flags = { ...s.flags }; this.runtime.state.vars = { ...s.vars }; this.enabled = new Map(s.enabled); this.lights = { ...s.lights }; this.objective = s.objective;
    for (const [k, v] of s.doors) { const d = this.doors.get(k); if (d) { d.open = v.open; d.locked = v.locked; d.amount = v.open ? 1 : 0; this.world.doorOpen.set(k, v.open); } }
    this.message('Checkpoint restored.', 2);
    this.dead = false; this.player.hp = Math.max(this.player.hp, 100);
    return true;
  }
}

function pointInCollider(c, p) {
  const l = p.clone().applyMatrix4(c.invRT);
  if (c.shape === 'sphere') { const r = (c.max[0] - c.min[0]) / 2, cx = (c.min[0] + c.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2, cz = (c.min[2] + c.max[2]) / 2; return Math.hypot(l.x - cx, l.y - cy, l.z - cz) <= r; }
  return l.x >= c.min[0] && l.x <= c.max[0] && l.y >= c.min[1] && l.y <= c.max[1] && l.z >= c.min[2] && l.z <= c.max[2];
}
function raySphere(o, d, c, r) {
  const oc = o.clone().sub(c), b = oc.dot(d), cc = oc.dot(oc) - r * r;
  const disc = b * b - cc; if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc <= 0 ? 0 : null);
}
export { pointInCollider };

// Enemy / boss AI: archetype data model, a state-machine runtime with perception (sight cone + line of sight, hearing), navmesh movement,
// melee attacks, boss phases, and a debug snapshot. DOM-free; the same agent runs in the AI test arena and in playtest.
//
// archetype = { id, name, readOnly?, health, invulnerable, walkSpeed, runSpeed, radius, height,
//   vision:{range, halfAngleDeg, chaseHalfAngleDeg, closeAlwaysSeen}, hearing:{scale}, wakeRadius,
//   attack:{range, hitReach, damage, windup, duration, cooldown},
//   weakSpots:[{part, multiplier}], staggerSeconds,
//   graph:{ nodes:[{id,type:'state',x,y,data:{name,behavior,speed,onEnter,timeout}}], edges:[{id,from,to,data:{cond,value,...}}] }, start:'idle',
//   phases:[{id,name,hpBelow,overrides:{...}, event, say}] }

import * as THREE from '../../lib/three.module.js';
import { uid, deepClone } from './util.js';
import { HOLLOW_REFERENCE, WARDEN_REFERENCE } from './game-constants.js';

export const BEHAVIORS = {
  dormant: { label: 'Dormant (does nothing)', moves: false },
  idle: { label: 'Stand still', moves: false },
  wander: { label: 'Wander', moves: true, speed: 'walk' },
  patrol: { label: 'Patrol path', moves: true, speed: 'walk' },
  investigate: { label: 'Go to last noise', moves: true, speed: 'walk' },
  search: { label: 'Search near last seen position', moves: true, speed: 'walk' },
  chase: { label: 'Chase the player', moves: true, speed: 'run' },
  attack: { label: 'Melee attack', moves: false },
  stagger: { label: 'Stunned', moves: false },
  flee: { label: 'Run away', moves: true, speed: 'run' },
  dead: { label: 'Dead', moves: false },
  custom: { label: 'Custom (no built-in movement)', moves: false },
};

export const CONDITIONS = {
  sees: { label: 'Sees the player', fields: [] },
  lostSight: { label: 'Has not seen the player for N s', fields: [{ key: 'seconds', label: 'Seconds', type: 'number', default: 4 }] },
  hears: { label: 'Hears a noise', fields: [] },
  nearPlayer: { label: 'Player closer than N m', fields: [{ key: 'meters', label: 'Metres', type: 'number', default: 1.25 }] },
  farPlayer: { label: 'Player farther than N m', fields: [{ key: 'meters', label: 'Metres', type: 'number', default: 20 }] },
  timer: { label: 'State lasted N s', fields: [{ key: 'seconds', label: 'Seconds', type: 'number', default: 3 }] },
  hpBelow: { label: 'Health below N %', fields: [{ key: 'percent', label: 'Percent', type: 'number', default: 50 }] },
  reached: { label: 'Reached its destination', fields: [] },
  damaged: { label: 'Was hurt', fields: [] },
  heavyHit: { label: 'Took a heavy hit', fields: [] },
  event: { label: 'Event happens', fields: [{ key: 'name', label: 'Event name', type: 'string', default: '' }] },
  done: { label: 'Action finished', fields: [] },
  always: { label: 'Immediately', fields: [] },
};

const S = (id, name, behavior, x, y, data = {}) => ({ id, type: 'state', x, y, data: { name, behavior, speed: 1, timeout: 0, onEnter: '', ...data } });
const E = (from, to, cond, data = {}) => ({ id: uid('et'), from: { node: from, port: 'out' }, to: { node: to, port: 'in' }, data: { cond, priority: 0, ...data } });

/** A sensible default behaviour (same shape as the game's Hollow) the author can edit. */
export function defaultArchetype(name = 'New enemy') {
  const states = [S('dormant', 'Dormant', 'dormant', 40, 40), S('idle', 'Idle', 'idle', 340, 40), S('wander', 'Wander', 'wander', 640, 40), S('investigate', 'Investigate', 'investigate', 340, 230), S('chase', 'Chase', 'chase', 640, 230), S('search', 'Search', 'search', 940, 230), S('attack', 'Attack', 'attack', 640, 420), S('stagger', 'Stagger', 'stagger', 940, 420), S('dead', 'Dead', 'dead', 940, 40)];
  const edges = [
    E('dormant', 'idle', 'nearPlayer', { meters: 3.2 }), E('idle', 'wander', 'timer', { seconds: 4 }), E('wander', 'idle', 'timer', { seconds: 8 }),
    E('idle', 'chase', 'sees'), E('wander', 'chase', 'sees'), E('investigate', 'chase', 'sees'), E('search', 'chase', 'sees'),
    E('idle', 'investigate', 'hears'), E('wander', 'investigate', 'hears'), E('investigate', 'search', 'reached'), E('search', 'wander', 'timer', { seconds: 12 }),
    E('chase', 'attack', 'nearPlayer', { meters: 1.25 }), E('attack', 'chase', 'done'), E('chase', 'search', 'lostSight', { seconds: 4 }),
    E('chase', 'stagger', 'heavyHit'), E('stagger', 'chase', 'timer', { seconds: 0.9 }),
  ];
  return { id: uid('enemy'), name, health: 100, invulnerable: false, walkSpeed: 1.05, runSpeed: 3.4, radius: 0.32, height: 1.8,
    vision: { range: 15, halfAngleDeg: 71.6, chaseHalfAngleDeg: 180, closeAlwaysSeen: 2.2 }, hearing: { scale: 1 }, wakeRadius: 3.2,
    attack: { range: 1.25, hitReach: 1.7, damage: 15, windup: 0.45, duration: 0.85, cooldown: 1.1 },
    weakSpots: [{ part: 'head', multiplier: 2.6 }, { part: 'body', multiplier: 1 }, { part: 'arm', multiplier: 0.6 }, { part: 'leg', multiplier: 0.75 }], staggerSeconds: 0.9,
    graph: { id: uid('g'), name: 'States', nodes: states, edges }, start: 'idle', phases: [], model: '', notes: '' };
}

/** Archetype from the game's reference numbers (imported, read-only). Behaviour graph = default states with the game's speeds/ranges. */
export function referenceArchetype(ref, id) {
  const a = defaultArchetype(ref.name);
  Object.assign(a, { id, imported: true, readOnly: true, health: ref.health ?? 100, invulnerable: !!ref.invulnerable, walkSpeed: ref.walkSpeed, runSpeed: ref.runSpeed, vision: { ...ref.vision }, attack: { ...ref.attack }, wakeRadius: ref.wakeRadius ?? 3.2, weakSpots: ref.weakSpots ? deepClone(ref.weakSpots) : a.weakSpots, staggerSeconds: ref.staggerSeconds?.normal ?? 0.9 });
  a.notes = `Numbers copied from ${ref.source}. The state graph below is a generic starting point, NOT the game's code (the game's behaviour lives in JavaScript and cannot be imported).`;
  return a;
}
export const REFERENCE_ARCHETYPES = { ref_hollow: () => referenceArchetype(HOLLOW_REFERENCE, 'ref_hollow'), ref_warden: () => referenceArchetype(WARDEN_REFERENCE, 'ref_warden') };

export function allArchetypes(project) { const out = { ...Object.fromEntries(Object.entries(REFERENCE_ARCHETYPES).map(([k, f]) => [k, f()])) }; for (const [k, v] of Object.entries(project.data.enemies || {})) if (v && v.graph) out[k] = v; return out; }

/** Static checks of an archetype. */
export function validateArchetype(a) {
  const out = [];
  const add = (severity, message) => out.push({ severity, message });
  const states = new Map(a.graph.nodes.map((n) => [n.id, n]));
  if (!states.has(a.start)) add('error', `The start state “${a.start}” does not exist.`);
  if (!(a.walkSpeed > 0) && !(a.runSpeed > 0)) add('warn', 'Both speeds are zero: the enemy can never move.');
  for (const e of a.graph.edges) {
    if (!states.has(e.from.node) || !states.has(e.to.node)) add('error', 'A transition points at a state that no longer exists.');
    if (!CONDITIONS[e.data?.cond]) add('error', `Unknown transition condition “${e.data?.cond}”.`);
  }
  for (const n of a.graph.nodes) {
    if (!BEHAVIORS[n.data.behavior]) add('error', `State “${n.data.name}” has an unknown behaviour “${n.data.behavior}”.`);
    const outs = a.graph.edges.filter((e) => e.from.node === n.id);
    if (!outs.length && !['dead', 'custom'].includes(n.data.behavior)) add('warn', `State “${n.data.name}” has no way out — the enemy gets stuck there.`);
    if (n.data.behavior === 'chase' && !a.graph.edges.some((e) => e.from.node === n.id && ['nearPlayer', 'lostSight'].includes(e.data.cond))) add('warn', `“${n.data.name}” chases forever: add a transition to attack (player near) or give up (lost sight).`);
  }
  // reachability from the start state
  const seen = new Set(); const stack = [a.start];
  while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); for (const e of a.graph.edges) if (e.from.node === id) stack.push(e.to.node); }
  for (const n of a.graph.nodes) if (!seen.has(n.id) && n.id !== 'dead' && n.data.behavior !== 'dead' && n.id !== 'stagger') add('info', `State “${n.data.name}” can never be reached from “${a.start}”.`);
  const phases = a.phases || [];
  for (const p of phases) if (!(p.hpBelow > 0 && p.hpBelow < 100)) add('warn', `Phase “${p.name}” triggers at ${p.hpBelow}% health, which is out of range (1–99).`);
  if (a.invulnerable && phases.length) add('info', 'This enemy is invulnerable, so its health-based phases never trigger.');
  return out;
}

const D2R = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class EnemyAgent {
  /**
   * @param def    archetype
   * @param o      { pos:[x,y,z], yaw, collision:CollisionWorld, nav:NavMesh|null, rng, patrol:[Vector3], name, emit(event) }
   */
  constructor(def, o) {
    this.def = def;
    this.name = o.name || def.name;
    this.pos = V(...o.pos); this.yaw = o.yaw || 0;
    this.collision = o.collision; this.nav = o.nav || null; this.rng = o.rng || Math.random;
    this.patrol = o.patrol || []; this.patrolIndex = 0;
    this.emit = o.emit || (() => {});
    this.params = deepClone({ walkSpeed: def.walkSpeed, runSpeed: def.runSpeed, attack: def.attack, vision: def.vision, hearing: def.hearing || { scale: 1 }, staggerSeconds: def.staggerSeconds ?? 0.9 });
    this.hp = def.health ?? 100; this.maxHp = this.hp;
    this.states = new Map(def.graph.nodes.map((n) => [n.id, n]));
    this.time = 0; this.state = null; this.stateTime = 0; this.noiseSeen = -1;
    this.lastSeen = null; this.lastSeenAt = -1e9; this.lastHeard = null;
    this.path = null; this.pathIndex = 0; this.target = null; this.repath = 0;
    this.seesPlayer = false; this.heardNoise = false; this.damagedFlag = false; this.heavyFlag = false; this.reachedFlag = false; this.doneFlag = false;
    this.events = new Set(); this.phaseIndex = -1; this.attackT = 0; this.attackHit = false; this.cooldown = 0;
    this.history = [];
    this.setState(o.startState && this.states.has(o.startState) ? o.startState : def.start);
  }

  get behavior() { return this.states.get(this.state)?.data.behavior || 'idle'; }
  get alive() { return this.behavior !== 'dead'; }

  setState(id, why = '') {
    const n = this.states.get(id);
    if (!n) return false;
    const from = this.state;
    this.state = id; this.stateTime = 0; this.path = null; this.reachedFlag = false; this.doneFlag = false; this.heavyFlag = false;
    this.attackT = 0; this.attackHit = false;
    this.history.push({ t: +this.time.toFixed(2), from, to: id, why }); if (this.history.length > 40) this.history.shift();
    this.emit(`enemy:${this.name}:${n.data.name}`, { enemy: this });
    if (n.data.onEnter) this.emit(n.data.onEnter, { enemy: this });
    if (n.data.behavior === 'investigate' && this.lastHeard) this.goTo(this.lastHeard);
    if (n.data.behavior === 'search' && this.lastSeen) this.goTo(this.lastSeen);
    return true;
  }

  // ------------------------------------------------------------------ perception
  facing() { return V(-Math.sin(this.yaw * D2R), 0, -Math.cos(this.yaw * D2R)); }
  eyePos() { return this.pos.clone().add(V(0, this.def.height * 0.9, 0)); }
  canSee(playerPos) {
    const v = this.params.vision, to = playerPos.clone().sub(this.pos); to.y = 0;
    const dist = to.length();
    if (dist > v.range) return false;
    const chasing = this.behavior === 'chase' || this.behavior === 'attack';
    const half = (chasing ? v.chaseHalfAngleDeg : v.halfAngleDeg) * D2R;
    if (dist > (v.closeAlwaysSeen ?? 0) && half < Math.PI) { const ang = Math.acos(Math.max(-1, Math.min(1, this.facing().dot(to.normalize())))); if (ang > half) return false; }
    return this.collision ? this.collision.hasLineOfSight(this.eyePos(), playerPos.clone().add(V(0, 1.4, 0)), { doors: true }) : true;
  }

  perceive(ctx) {
    const P = ctx.player;
    this.seesPlayer = !!P && this.alive && this.canSee(P.pos);
    if (this.seesPlayer) { this.lastSeen = P.pos.clone(); this.lastSeenAt = this.time; }
    this.heardNoise = false;
    for (const n of ctx.noises || []) {
      if (n.t < this.noiseSeen) continue;
      const d = n.pos.distanceTo(this.pos);
      if (d <= n.radius * (this.params.hearing.scale ?? 1)) { this.heardNoise = true; this.lastHeard = n.pos.clone(); }
    }
    this.noiseSeen = ctx.time - 0.001;
  }

  // ------------------------------------------------------------------ movement
  goTo(p) {
    this.target = p.clone();
    if (!this.nav) { this.path = [p.clone()]; this.pathIndex = 0; return; }
    const path = this.nav.findPath(this.pos, p, { smooth: true });
    this.path = path && path.length ? path : null; this.pathIndex = 0;
    if (!this.path) this.noPath = true;
  }
  moveAlong(dt, speed) {
    if (!this.path || this.pathIndex >= this.path.length) { if (this.path) this.reachedFlag = true; return; }
    const tgt = this.path[this.pathIndex];
    const to = tgt.clone().sub(this.pos); to.y = 0;
    const d = to.length();
    if (d < 0.25) { this.pathIndex++; if (this.pathIndex >= this.path.length) this.reachedFlag = true; return; }
    to.normalize();
    this.yaw = Math.atan2(-to.x, -to.z) / D2R;
    const step = Math.min(d, speed * dt);
    const nx = this.pos.x + to.x * step, nz = this.pos.z + to.z * step;
    if (this.collision) {
      const r = this.collision.movePlayer({ x: this.pos.x, y: this.pos.y, z: this.pos.z, vy: 0 }, nx - this.pos.x, nz - this.pos.z, dt, { radius: this.def.radius, height: this.def.height, doors: true });
      this.pos.set(r.x, r.y, r.z);
    } else this.pos.set(nx, this.pos.y, nz);
  }
  face(p) { const to = p.clone().sub(this.pos); this.yaw = Math.atan2(-to.x, -to.z) / D2R; }

  // ------------------------------------------------------------------ behaviours
  runBehavior(dt, ctx) {
    const b = this.behavior, st = this.states.get(this.state).data, mult = st.speed ?? 1;
    const walk = this.params.walkSpeed * mult, run = this.params.runSpeed * mult;
    switch (b) {
      case 'wander': {
        if (!this.path || this.reachedFlag || this.noPath) {
          this.noPath = false; this.reachedFlag = false;
          for (let i = 0; i < 6 && !this.path; i++) { const a = this.rng() * Math.PI * 2, r = 3 + this.rng() * 6; this.goTo(this.pos.clone().add(V(Math.cos(a) * r, 0, Math.sin(a) * r))); }
        }
        this.moveAlong(dt, walk); break;
      }
      case 'patrol': {
        if (!this.patrol.length) break;
        if (!this.path || this.reachedFlag) { if (this.reachedFlag) this.patrolIndex = (this.patrolIndex + 1) % this.patrol.length; this.reachedFlag = false; this.goTo(this.patrol[this.patrolIndex]); }
        this.moveAlong(dt, walk); break;
      }
      case 'investigate': this.moveAlong(dt, walk); break;
      case 'search': {
        if (this.reachedFlag || !this.path) { this.reachedFlag = false; const c = this.lastSeen || this.pos; const a = this.rng() * Math.PI * 2; this.goTo(c.clone().add(V(Math.cos(a) * 3, 0, Math.sin(a) * 3))); }
        this.moveAlong(dt, walk); break;
      }
      case 'chase': {
        const P = ctx.player;
        if (P) { this.repath -= dt; if (this.repath <= 0 || !this.path) { this.goTo(this.seesPlayer ? P.pos : (this.lastSeen || P.pos)); this.repath = 0.4; } }
        this.moveAlong(dt, run); break;
      }
      case 'flee': {
        const P = ctx.player;
        if (P && (!this.path || this.reachedFlag)) { this.reachedFlag = false; const away = this.pos.clone().sub(P.pos).setY(0).normalize().multiplyScalar(8); this.goTo(this.pos.clone().add(away)); }
        this.moveAlong(dt, run); break;
      }
      case 'attack': {
        const P = ctx.player, a = this.params.attack;
        if (P) this.face(P.pos);
        this.attackT += dt;
        if (!this.attackHit && this.attackT >= a.windup) {
          this.attackHit = true;
          const reach = a.hitReach ?? a.range;
          if (P && P.pos.distanceTo(this.pos) <= reach + (P.radius ?? 0.3)) ctx.damagePlayer?.({ amount: a.damage, from: this, attack: a });
        }
        if (this.attackT >= a.duration) this.doneFlag = true;
        break;
      }
      case 'stagger': break;
      default: break;
    }
  }

  condMet(c, ctx) {
    const d = c.data || {}, P = ctx.player;
    const dist = P ? P.pos.distanceTo(this.pos) : Infinity;
    const one = (kind, o) => {
      switch (kind) {
        case 'sees': return this.seesPlayer;
        case 'lostSight': return this.time - this.lastSeenAt >= (+o.seconds || 4);
        case 'hears': return this.heardNoise;
        case 'nearPlayer': return dist <= (+o.meters || 1.25);
        case 'farPlayer': return dist >= (+o.meters || 20);
        case 'timer': return this.stateTime >= (+o.seconds || 0);
        case 'hpBelow': return (this.hp / this.maxHp) * 100 < (+o.percent || 0);
        case 'reached': return this.reachedFlag;
        case 'damaged': return this.damagedFlag;
        case 'heavyHit': return this.heavyFlag;
        case 'event': return this.events.has(o.name);
        case 'done': return this.doneFlag;
        case 'always': return true;
        default: return false;
      }
    };
    return one(d.cond, d);
  }

  // ------------------------------------------------------------------ main update
  update(dt, ctx) {
    this.time += dt; this.stateTime += dt; this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.alive) return;
    this.perceive({ ...ctx, time: this.time });
    this.runBehavior(dt, ctx);
    // transitions: highest priority first, then editor order
    const outs = this.def.graph.edges.filter((e) => e.from.node === this.state).sort((a, b) => (b.data.priority || 0) - (a.data.priority || 0));
    for (const e of outs) {
      if (this.condMet(e, ctx)) { if (this.states.has(e.to.node)) { this.setState(e.to.node, e.data.cond); break; } }
    }
    this.damagedFlag = false; this.events.clear();
    this.checkPhases();
  }

  /** Something outside happened (named event) — transitions on "event" conditions can use it on the next update. */
  signal(name) { this.events.add(name); }

  takeDamage(amount, part = 'body', { heavy = false } = {}) {
    if (!this.alive) return 0;
    if (this.def.invulnerable) { if (heavy || amount > 0) { this.heavyFlag = heavy; this.damagedFlag = true; } return 0; }
    const spot = (this.def.weakSpots || []).find((w) => w.part === part);
    const dmg = amount * (spot ? spot.multiplier : 1);
    this.hp = Math.max(0, this.hp - dmg);
    this.damagedFlag = true; this.heavyFlag = heavy || dmg >= this.maxHp * 0.25;
    if (this.hp <= 0) { const dead = [...this.states.values()].find((n) => n.data.behavior === 'dead'); if (dead) this.setState(dead.id, 'killed'); this.emit(`enemy:${this.name}:killed`, { enemy: this }); }
    return dmg;
  }

  checkPhases() {
    const ph = (this.def.phases || []).slice().sort((a, b) => b.hpBelow - a.hpBelow);
    const pct = (this.hp / this.maxHp) * 100;
    for (let i = 0; i < ph.length; i++) {
      if (i <= this.phaseIndex || pct >= ph[i].hpBelow) continue;
      this.phaseIndex = i;
      const p = ph[i], o = p.overrides || {};
      if (o.walkSpeed !== undefined) this.params.walkSpeed = o.walkSpeed;
      if (o.runSpeed !== undefined) this.params.runSpeed = o.runSpeed;
      if (o.attack) Object.assign(this.params.attack, o.attack);
      if (o.vision) Object.assign(this.params.vision, o.vision);
      this.history.push({ t: +this.time.toFixed(2), phase: p.name });
      this.emit(p.event || `enemy:${this.name}:phase:${p.name}`, { enemy: this, phase: p });
      if (p.state && this.states.has(p.state)) this.setState(p.state, 'phase');
    }
  }

  debug() {
    return { name: this.name, state: this.states.get(this.state)?.data.name, behavior: this.behavior, hp: Math.round(this.hp), sees: this.seesPlayer, heard: this.heardNoise, path: this.path ? this.path.map((p) => p.toArray()) : null, target: this.target && this.target.toArray(), pos: this.pos.toArray(), yaw: this.yaw, phase: this.phaseIndex, stateTime: +this.stateTime.toFixed(2), history: this.history.slice(-8) };
  }
}

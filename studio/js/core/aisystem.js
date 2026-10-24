// Connects enemySpawn objects to EnemyAgent instances inside a PlaytestWorld.
import * as THREE from '../../lib/three.module.js';
import { EnemyAgent, allArchetypes } from './ai.js';
import { buildNavMesh } from './navmesh.js';
import { sceneBounds, pathPoints } from './geometry.js';
import { propsOf } from './geometry.js';

/** Map a spawn's archetype string (an archetype id, a name, or the game's "hollow"/"warden") to an archetype. */
export function resolveArchetype(project, key) {
  const all = allArchetypes(project);
  if (!key) return null;
  if (all[key]) return all[key];
  const lower = String(key).toLowerCase();
  if (all['ref_' + lower]) return all['ref_' + lower];
  return Object.values(all).find((a) => a.name.toLowerCase() === lower || a.name.toLowerCase().startsWith(lower)) || null;
}

export class AISystem {
  constructor(world) {
    this.world = world;
    this.agents = [];
    this.problems = [];
    this.nav = null;
    const scene = world.scene, project = world.project;
    for (const n of scene.find((x) => x.type === 'enemySpawn')) {
      const p = propsOf(n);
      if (!world.isEnabled(n, true)) continue;
      const arch = resolveArchetype(project, p.archetype);
      if (!arch) { this.problems.push(`Enemy spawn “${n.name}” has no archetype (“${p.archetype || ''}”) — it was skipped.`); continue; }
      const pos = scene.worldPosition(n.id);
      const patrol = p.patrol ? (() => { const pn = scene.get(p.patrol) || scene.byName(p.patrol); return pn ? pathPoints(scene, pn.id) : []; })() : [];
      const startState = p.dormant ? (arch.graph.nodes.find((s) => s.data.behavior === 'dormant')?.id) : (arch.graph.nodes.find((s) => s.id === arch.start)?.id);
      const yawDeg = new THREE.Euler().setFromRotationMatrix(scene.worldMatrix(n.id), 'YXZ').y * 180 / Math.PI;
      const agent = new EnemyAgent(arch, { pos: pos.toArray(), yaw: yawDeg, collision: world.world, nav: null, rng: world.rng, name: n.name, patrol, startState: startState || arch.start,
        emit: (ev, payload) => world.runtime.emit(ev, payload) });
      const rec = { node: n, agent, active: !p.spawnOn && !(p.delay > 0), spawnOn: p.spawnOn || '', delay: p.delay || 0, waited: 0, arch };
      this.agents.push(rec);
    }
    for (const w of this.problems) world.message(w, 6);
    world.runtime.opts.onEmit = (name, payload) => this.onEvent(name, payload);
  }

  ensureNav() {
    if (this.nav) return this.nav;
    const w = this.world;
    const seeds = [new THREE.Vector3(w.player.x, w.player.y, w.player.z)];
    this.nav = buildNavMesh(w.world, sceneBounds(w.scene, w.geo), { cell: 0.25, seeds });
    for (const r of this.agents) r.agent.nav = this.nav;
    return this.nav;
  }

  onEvent(name, payload) {
    for (const r of this.agents) { r.agent.signal(name); if (r.spawnOn && r.spawnOn === name && !r.active) { r.active = true; r.agent.signal('spawned'); } }
  }
  /** act.spawn: activate a spawn by name or id. */
  spawn(id) { for (const r of this.agents) if (r.node.id === id || r.node.name === id) r.active = true; }

  update(dt, world) {
    this.ensureNav();
    const P = world.player;
    const ctx = { player: { pos: new THREE.Vector3(P.x, P.y, P.z), radius: 0.3, hp: P.hp }, noises: world.noises, damagePlayer: (d) => world.damagePlayer(d) };
    for (const r of this.agents) {
      if (!r.active) { if (r.delay > 0 && !r.spawnOn) { r.waited += dt; if (r.waited >= r.delay) r.active = true; } continue; }
      r.agent.update(dt, ctx);
    }
  }

  /** Hit-scan helper: damage the nearest agent whose body the ray crosses. Returns the agent hit (or null). */
  shoot(origin, dir, damage, { maxDist = 60, heavy = false, exclude = null } = {}) {
    let best = null;
    for (const r of this.agents) {
      if (!r.active || !r.agent.alive || exclude?.has(r.agent)) continue;
      const a = r.agent, rad = hitRadius(a.def);
      const t = rayCylinder(origin, dir, a.pos, rad, a.def.height);
      if (t === null || t > maxDist) continue;
      const hit = origin.clone().addScaledVector(dir, t), rel = (hit.y - a.pos.y) / a.def.height;
      if (this.world.world.raycast(origin, dir, Math.max(0, t - 0.05), { doors: true })) continue;      // wall in the way
      if (!best || t < best.t) best = { agent: a, t, part: hitPart(rel) };
    }
    if (best) best.agent.takeDamage(damage, best.part, { heavy });
    return best;
  }
}

/** The hit volume of an enemy is a vertical cylinder: at least the player's own radius (0.3 m) wide, as tall as the archetype. Shared with the hit-box overlay. */
export const HIT_ZONES = { head: 0.82, body: 0.35 };                      // fractions of the height: above 82 % = head, above 35 % = body, below = legs
export const hitRadius = (def) => Math.max(def.radius, 0.3);
export const hitPart = (rel) => (rel > HIT_ZONES.head ? 'head' : rel > HIT_ZONES.body ? 'body' : 'leg');

/** Ray vs a vertical cylinder (base centre `c`, radius r, height h). Returns the distance along the ray or null. */
export function rayCylinder(o, d, c, r, h) {
  const ox = o.x - c.x, oz = o.z - c.z;
  const a = d.x * d.x + d.z * d.z;
  let t = null;
  if (a < 1e-9) { if (ox * ox + oz * oz > r * r) return null; }
  else {
    const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - r * r, disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc), t0 = (-b - sq) / (2 * a), t1 = (-b + sq) / (2 * a);
    for (const tt of [t0, t1]) { if (tt >= 0) { const y = o.y + d.y * tt; if (y >= c.y && y <= c.y + h) { t = tt; break; } } }
  }
  // end caps
  for (const y of [c.y + h, c.y]) { if (Math.abs(d.y) < 1e-9) continue; const tt = (y - o.y) / d.y; if (tt < 0 || (t !== null && tt >= t)) continue; const x = o.x + d.x * tt - c.x, z = o.z + d.z * tt - c.z; if (x * x + z * z <= r * r) t = tt; }
  return t;
}

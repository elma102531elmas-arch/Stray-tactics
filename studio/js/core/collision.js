// CollisionWorld: queries against oriented boxes (+ terrain heightfields).
// Used by playtest movement, AI line-of-sight, navmesh generation and diagnostics.

import * as THREE from '../../lib/three.module.js';
import { terrainHeight } from './geometry.js';

const CELL = 4;
const key = (x, z) => `${x},${z}`;
const _v = new THREE.Vector3();

export class CollisionWorld {
  constructor(colliders) {
    this.list = colliders;
    this.grid = new Map();
    this.terrains = [];
    for (const c of colliders) {
      if (c.kind === 'terrain') this.terrains.push(c);
      const x0 = Math.floor(c.aabb.min.x / CELL), x1 = Math.floor(c.aabb.max.x / CELL);
      const z0 = Math.floor(c.aabb.min.z / CELL), z1 = Math.floor(c.aabb.max.z / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = key(x, z);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(c);
      }
    }
    this.doorOpen = new Map();   // doorId -> true when open (playtest state)
  }

  nearby(minX, minZ, maxX, maxZ) {
    const out = new Set();
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
        const l = this.grid.get(key(x, z));
        if (l) for (const c of l) out.add(c);
      }
    }
    return out;
  }

  blocks(c, { doors = true, volumes = false } = {}) {
    if (c.kind === 'solid') return true;
    if (c.kind === 'door') return doors && !this.doorOpen.get(c.doorId);
    return false;
  }

  /** Ray vs oriented box. Returns {t, normal(world Vector3)} or null. */
  rayBox(c, o, d, maxT) {
    const lo = o.clone().applyMatrix4(c.invRT);
    const ld = d.clone().transformDirection(c.invRT);   // rotation only (unit scale)
    let tmin = 0, tmax = maxT, axis = -1, sign = 0;
    const L = [lo.x, lo.y, lo.z], D = [ld.x, ld.y, ld.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(D[a]) < 1e-9) { if (L[a] < c.min[a] || L[a] > c.max[a]) return null; continue; }
      let t1 = (c.min[a] - L[a]) / D[a], t2 = (c.max[a] - L[a]) / D[a], s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (axis < 0) return { t: 0, normal: new THREE.Vector3(0, 1, 0), inside: true };
    const n = [0, 0, 0]; n[axis] = sign;
    const normal = new THREE.Vector3(n[0], n[1], n[2]).applyQuaternion(c.quat);
    return { t: tmin, normal };
  }

  rayTerrain(c, o, d, maxT) {
    const M = c.rt, inv = c.invRT;
    const lo = o.clone().applyMatrix4(inv), ld = d.clone().transformDirection(inv);
    const step = 0.25;
    let prevAbove = null;
    for (let t = 0; t <= maxT; t += step) {
      const p = lo.clone().addScaledVector(ld, t);
      const h = terrainHeight(c.terrain.props, p.x, p.z);
      if (h === null) { prevAbove = null; continue; }
      const above = p.y >= h;
      if (prevAbove === true && !above) {
        // refine by bisection
        let a = t - step, b = t;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) / 2, pm = lo.clone().addScaledVector(ld, m);
          const hm = terrainHeight(c.terrain.props, pm.x, pm.z);
          if (hm !== null && pm.y >= hm) a = m; else b = m;
        }
        const pt = lo.clone().addScaledVector(ld, b);
        const e = 0.2;
        const hx = (terrainHeight(c.terrain.props, pt.x + e, pt.z) ?? 0) - (terrainHeight(c.terrain.props, pt.x - e, pt.z) ?? 0);
        const hz = (terrainHeight(c.terrain.props, pt.x, pt.z + e) ?? 0) - (terrainHeight(c.terrain.props, pt.x, pt.z - e) ?? 0);
        const normal = new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize().applyQuaternion(c.quat);
        return { t: b, normal };
      }
      prevAbove = above;
    }
    return null;
  }

  /** Nearest hit along a ray. opts: {doors:true, maxDist, ignore:Set(nodeId), kinds:Set} */
  raycast(origin, dir, maxDist = 100, opts = {}) {
    const d = dir.clone().normalize();
    const end = origin.clone().addScaledVector(d, maxDist);
    const cand = this.nearby(Math.min(origin.x, end.x) - 0.1, Math.min(origin.z, end.z) - 0.1, Math.max(origin.x, end.x) + 0.1, Math.max(origin.z, end.z) + 0.1);
    let best = null;
    for (const c of cand) {
      if (opts.ignore?.has(c.nodeId)) continue;
      if (opts.kinds ? !opts.kinds.has(c.kind) : !this.blocks(c, opts)) continue;
      const h = c.kind === 'terrain' ? this.rayTerrain(c, origin, d, best ? best.t : maxDist) : this.rayBox(c, origin, d, best ? best.t : maxDist);
      if (h && (!best || h.t < best.t)) best = { ...h, collider: c };
    }
    if (best) best.point = origin.clone().addScaledVector(d, best.t);
    return best;
  }

  /** All hits along a ray, nearest first (used for navmesh column sampling). */
  raycastAll(origin, dir, maxDist, opts = {}) {
    const d = dir.clone().normalize();
    const end = origin.clone().addScaledVector(d, maxDist);
    const cand = this.nearby(Math.min(origin.x, end.x) - 0.1, Math.min(origin.z, end.z) - 0.1, Math.max(origin.x, end.x) + 0.1, Math.max(origin.z, end.z) + 0.1);
    const hits = [];
    for (const c of cand) {
      if (opts.kinds ? !opts.kinds.has(c.kind) : !this.blocks(c, opts)) continue;
      if (opts.filter && !opts.filter(c)) continue;
      const h = c.kind === 'terrain' ? this.rayTerrain(c, origin, d, maxDist) : this.rayBox(c, origin, d, maxDist);
      if (h && !h.inside) hits.push({ ...h, collider: c, point: origin.clone().addScaledVector(d, h.t) });
    }
    return hits.sort((a, b) => a.t - b.t);
  }

  hasLineOfSight(a, b, opts = {}) {
    const d = b.clone().sub(a);
    const dist = d.length();
    if (dist < 1e-6) return true;
    return !this.raycast(a, d, dist - 0.02, { doors: true, ...opts });
  }

  /** Sphere vs all blocking colliders. Returns the deepest penetration {push:Vector3, collider} or null. */
  sphereHit(center, r, opts = {}) {
    let best = null;
    const cand = this.nearby(center.x - r, center.z - r, center.x + r, center.z + r);
    for (const c of cand) {
      if (c.kind === 'terrain' || !this.blocks(c, opts)) continue;
      if (c.aabb.max.y < center.y - r || c.aabb.min.y > center.y + r) continue;
      const lc = center.clone().applyMatrix4(c.invRT);
      const cp = new THREE.Vector3(Math.max(c.min[0], Math.min(lc.x, c.max[0])), Math.max(c.min[1], Math.min(lc.y, c.max[1])), Math.max(c.min[2], Math.min(lc.z, c.max[2])));
      const diff = lc.clone().sub(cp);
      const dist = diff.length();
      if (dist >= r) continue;
      let push;
      if (dist < 1e-6) {
        // centre inside the box: leave through the nearest face
        const f = [lc.x - c.min[0], c.max[0] - lc.x, lc.y - c.min[1], c.max[1] - lc.y, lc.z - c.min[2], c.max[2] - lc.z];
        const i = f.indexOf(Math.min(...f));
        const nrm = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][i];
        push = new THREE.Vector3(...nrm).multiplyScalar(f[i] + r);
      } else push = diff.multiplyScalar((r - dist) / dist);
      push.applyQuaternion(c.quat);
      if (!best || push.length() > best.push.length()) best = { push, collider: c };
    }
    return best;
  }

  /** Highest walkable surface at (x,z) between minY and maxY. */
  groundAt(x, z, maxY, minY = -50, r = 0.2) {
    let best = null;
    const offs = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
    for (const [ox, oz] of offs) {
      const hit = this.raycast(new THREE.Vector3(x + ox, maxY, z + oz), new THREE.Vector3(0, -1, 0), maxY - minY, { doors: false, kinds: new Set(['solid', 'ground', 'terrain']) });
      if (hit && hit.normal.y > 0.5 && (best === null || hit.point.y > best)) best = hit.point.y;
    }
    return best;
  }

  /**
   * Move a player-sized body. state: {x,y,z,vy,grounded}. Returns the new state.
   * Horizontal resolution uses three stacked spheres; vertical uses a ground ray.
   */
  movePlayer(state, dx, dz, dt, { radius = 0.3, height = 1.8, step = 0.45, gravity = 18, doors = true } = {}) {
    let { x, y, z, vy = 0 } = state;
    x += dx; z += dz;
    const centers = [step + radius + 0.02, height * 0.62, height - radius - 0.05];
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const oy of centers) {
        const hit = this.sphereHit(_v.set(x, y + oy, z), radius, { doors });
        if (hit) { x += hit.push.x; z += hit.push.z; moved = true; }
      }
      if (!moved) break;
    }
    // ground
    const g = this.groundAt(x, z, y + step + 0.05, y - 50, radius * 0.7);
    let grounded = false;
    vy -= gravity * dt;
    let ny = y + vy * dt;
    if (g !== null && ny <= g + 1e-3) { ny = g; vy = 0; grounded = true; }
    else if (g !== null && y - g < step && vy <= 0 && Math.abs(vy) < 1) { ny = g; vy = 0; grounded = true; }
    // ceiling
    const ceil = this.raycast(new THREE.Vector3(x, ny + 0.1, z), new THREE.Vector3(0, 1, 0), height, { doors: false, kinds: new Set(['solid']) });
    if (ceil && ceil.point.y - ny < height) { if (vy > 0) vy = 0; }
    return { x, y: ny, z, vy, grounded };
  }
}

/** Is a world point inside a collider (box or sphere)? Used for trigger / audio / footstep volumes. */
export function pointInCollider(c, p) {
  const l = p.clone().applyMatrix4(c.invRT);
  if (c.shape === 'sphere') { const r = (c.max[0] - c.min[0]) / 2, cx = (c.min[0] + c.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2, cz = (c.min[2] + c.max[2]) / 2; return Math.hypot(l.x - cx, l.y - cy, l.z - cz) <= r; }
  return l.x >= c.min[0] && l.x <= c.max[0] && l.y >= c.min[1] && l.y <= c.max[1] && l.z >= c.min[2] && l.z <= c.max[2];
}

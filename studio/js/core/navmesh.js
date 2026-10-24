// Grid navmesh generated from the collision world. Multi-level (stairs, elevators, floors above floors).
// Used by enemy AI preview, validation (reachability) and the nav debug overlay.

import * as THREE from '../../lib/three.module.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const SURF = new Set(['solid', 'ground', 'terrain']);

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, p) { const a = this.a; a.push([p, k]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top[1];
  }
}

export class NavMesh {
  constructor(opts) {
    this.cell = opts.cell; this.step = opts.step;
    this.nodes = []; this.byCell = new Map(); this.bounds = opts.bounds;
    this.stats = {};
  }
  key(ix, iz) { return ix + ',' + iz; }
  cellOf(v) { return [Math.floor(v.x / this.cell), Math.floor(v.z / this.cell)]; }

  nearest(p, maxDist = 2, yTol = 1.5) {
    const [cx, cz] = this.cellOf(p);
    const R = Math.ceil(maxDist / this.cell);
    let best = null, bd = Infinity;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const list = this.byCell.get(this.key(cx + dx, cz + dz));
      if (!list) continue;
      for (const n of list) {
        if (Math.abs(n.y - p.y) > yTol) continue;
        const d = Math.hypot(n.x - p.x, n.z - p.z, (n.y - p.y) * 0.5);
        if (d < bd && d <= maxDist) { bd = d; best = n; }
      }
    }
    return best;
  }

  /** A* between two world points. Returns array of THREE.Vector3 or null. */
  findPath(from, to, { smooth = true, maxNodes = 40000 } = {}) {
    const a = this.nearest(from, 2.5, 3), b = this.nearest(to, 2.5, 3);
    if (!a || !b) return null;
    if (a === b) return [new THREE.Vector3(a.x, a.y, a.z)];
    const g = new Map([[a.id, 0]]), came = new Map(), closed = new Set();
    const open = new MinHeap();
    const h = (n) => Math.hypot(n.x - b.x, n.z - b.z, n.y - b.y);
    open.push(a, h(a));
    let visited = 0;
    while (open.size && visited++ < maxNodes) {
      const cur = open.pop();
      if (cur === b) break;
      if (closed.has(cur.id)) continue;
      closed.add(cur.id);
      for (const nb of cur.links) {
        if (closed.has(nb.id)) continue;
        const ng = g.get(cur.id) + Math.hypot(nb.x - cur.x, nb.z - cur.z, nb.y - cur.y);
        if (ng < (g.get(nb.id) ?? Infinity)) { g.set(nb.id, ng); came.set(nb.id, cur); open.push(nb, ng + h(nb)); }
      }
    }
    if (!came.has(b.id)) return null;
    const path = [];
    for (let c = b; c; c = came.get(c.id)) path.push(c);
    path.reverse();
    let pts = path.map((n) => new THREE.Vector3(n.x, n.y, n.z));
    if (smooth) pts = this.smoothPath(pts);
    return pts;
  }

  segmentWalkable(p, q) {
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const n = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    let prevY = p.y;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const s = new THREE.Vector3(p.x + (q.x - p.x) * t, prevY, p.z + (q.z - p.z) * t);
      const node = this.nearest(s, this.cell * 0.75, this.step + 0.05);
      if (!node || Math.hypot(node.x - s.x, node.z - s.z) > this.cell * 0.75) return false;
      if (Math.abs(node.y - prevY) > this.step) return false;
      prevY = node.y;
    }
    return true;
  }
  smoothPath(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.segmentWalkable(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  /** Mark connected components; flag the ones reachable from any seed point. */
  analyse(seeds = []) {
    const comp = new Map();
    let cid = 0;
    const sizes = [];
    for (const n of this.nodes) {
      if (comp.has(n.id)) continue;
      const stack = [n]; comp.set(n.id, cid); let size = 0;
      while (stack.length) { const c = stack.pop(); size++; for (const nb of c.links) if (!comp.has(nb.id)) { comp.set(nb.id, cid); stack.push(nb); } }
      sizes.push(size); cid++;
    }
    const seedComps = new Set();
    for (const s of seeds) { const n = this.nearest(s, 1.5, 2.5); if (n) seedComps.add(comp.get(n.id)); }
    for (const n of this.nodes) { n.comp = comp.get(n.id); n.reachable = seedComps.size === 0 ? true : seedComps.has(n.comp); }
    this.stats = { nodes: this.nodes.length, components: sizes.length, componentSizes: sizes, reachable: this.nodes.filter((n) => n.reachable).length, seeded: seedComps.size };
    return this.stats;
  }
  isReachable(p, maxDist = 2.5) { const n = this.nearest(p, maxDist, 3); return !!n && n.reachable; }
}

export function buildNavMesh(world, bounds, { cell = 0.25, agentRadius = 0.3, agentHeight = 1.8, step = 0.45, seeds = [] } = {}) {
  const nav = new NavMesh({ cell, step, bounds });
  const x0 = Math.floor(bounds.min.x / cell) - 1, x1 = Math.ceil(bounds.max.x / cell) + 1;
  const z0 = Math.floor(bounds.min.z / cell) - 1, z1 = Math.ceil(bounds.max.z / cell) + 1;
  const topY = bounds.max.y + 1, depth = bounds.max.y - bounds.min.y + 3;
  const centers = [step + agentRadius + 0.02, agentHeight * 0.62, agentHeight - agentRadius - 0.05];
  const blockers = world.list.filter((c) => c.kind === 'navBlock');
  const allowers = world.list.filter((c) => c.kind === 'navAllow');
  const inside = (c, p) => { const l = p.clone().applyMatrix4(c.invRT); return l.x >= c.min[0] && l.x <= c.max[0] && l.y >= c.min[1] && l.y <= c.max[1] && l.z >= c.min[2] && l.z <= c.max[2]; };
  let id = 0;
  const probe = new THREE.Vector3();
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const x = (ix + 0.5) * cell, z = (iz + 0.5) * cell;
      const hits = world.raycastAll(new THREE.Vector3(x, topY, z), DOWN, depth, { kinds: SURF, filter: (c) => c.walk });
      let lastY = Infinity;
      for (const h of hits) {
        if (h.normal.y < 0.7) continue;
        const y = h.point.y;
        if (Math.abs(y - lastY) < 0.05) continue;
        probe.set(x, y, z);
        if (blockers.some((c) => inside(c, probe.clone().setY(y + 0.5)))) continue;
        const forced = allowers.some((c) => inside(c, probe.clone().setY(y + 0.5)));
        let blocked = false;
        if (!forced) for (const oy of centers) { if (world.sphereHit(new THREE.Vector3(x, y + oy, z), agentRadius, { doors: false })) { blocked = true; break; } }
        if (blocked) continue;
        lastY = y;
        const node = { id: id++, x, y, z, ix, iz, links: [], comp: -1, reachable: true };
        nav.nodes.push(node);
        const k = nav.key(ix, iz);
        if (!nav.byCell.has(k)) nav.byCell.set(k, []);
        nav.byCell.get(k).push(node);
      }
    }
  }
  // links (8-neighbourhood, no corner cutting)
  const at = (ix, iz, y) => {
    const l = nav.byCell.get(nav.key(ix, iz));
    if (!l) return null;
    let best = null, bd = Infinity;
    for (const n of l) { const d = Math.abs(n.y - y); if (d <= step && d < bd) { bd = d; best = n; } }
    return best;
  };
  for (const n of nav.nodes) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const nb = at(n.ix + dx, n.iz + dz, n.y);
      if (!nb) continue;
      if (dx && dz && (!at(n.ix + dx, n.iz, n.y) || !at(n.ix, n.iz + dz, n.y))) continue;
      n.links.push(nb);
    }
  }
  nav.analyse(seeds);
  return nav;
}

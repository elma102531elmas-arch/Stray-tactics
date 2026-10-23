// Tile grid: parsing, collision, ray casting and path finding for a level.
export const T = {
  VOID: 0, WALL: 1, EXT: 2, FLOOR: 3, GROUND: 4, ROAD: 5, PATH: 6, DOOR: 7, WINDOW: 8, FENCE: 9, TREE: 10, WATER: 11, GRASS: 12,
};
const CHAR = {
  ' ': T.VOID, '#': T.WALL, 'B': T.EXT, '.': T.FLOOR, ',': T.GROUND, ';': T.GRASS, '=': T.ROAD, '_': T.PATH, 'D': T.DOOR, 'O': T.DOOR,
  'W': T.WINDOW, 'F': T.FENCE, 'T': T.TREE, '~': T.WATER,
};
export const OUTDOOR = new Set([T.GROUND, T.ROAD, T.PATH, T.TREE, T.FENCE, T.GRASS]);
const SOLID_MOVE = new Set([T.VOID, T.WALL, T.EXT, T.WINDOW, T.FENCE]);
const SOLID_RAY = new Set([T.VOID, T.WALL, T.EXT, T.WINDOW]);

export class Grid {
  constructor(def) {
    const rows = def.grid;
    this.h = rows.length;
    this.w = Math.max(...rows.map((r) => r.length));
    const n = this.w * this.h;
    this.type = new Uint8Array(n);
    this.theme = new Int8Array(n).fill(-1);
    this.mark = new Array(n).fill(null);     // special characters (lights, legend letters)
    this.navBlock = new Uint8Array(n);
    this.doors = new Map();                    // index -> door object (set by level)
    this.colliders = [];                       // {minX,minZ,maxX,maxZ, solidRay}
    this.colBuckets = new Map();
    const legend = def.legend || {};
    for (let z = 0; z < this.h; z++) {
      const row = rows[z];
      for (let x = 0; x < this.w; x++) {
        const ch = row[x] ?? ' ';
        const i = z * this.w + x;
        if (ch in CHAR) {
          this.type[i] = CHAR[ch];
          if (ch === 'O') this.mark[i] = 'O';
        } else if (ch >= '0' && ch <= '9') {
          this.type[i] = T.FLOOR; this.theme[i] = +ch;
        } else if ('*+^!L%x@'.includes(ch)) {
          this.type[i] = 255; this.mark[i] = ch;       // resolved below from neighbours
        } else if (legend[ch]) {
          const d = legend[ch];
          this.type[i] = d.door ? T.DOOR : (d.base !== undefined ? d.base : 255);
          this.mark[i] = ch;
        } else {
          this.type[i] = 255; this.mark[i] = null;
        }
      }
    }
    // Infer the floor type under marks from the most common walkable neighbour.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        if (this.type[i] !== 255) continue;
        const x = i % this.w, z = (i / this.w) | 0;
        const cnt = {};
        let best = -1, bc = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const t = this.get(x + dx, z + dz);
          if (t === 255 || t === T.VOID || t === T.WALL || t === T.EXT || t === T.WINDOW || t === T.DOOR || t === T.FENCE || t === T.TREE) continue;
          cnt[t] = (cnt[t] || 0) + 1;
          if (cnt[t] > bc) { bc = cnt[t]; best = t; }
        }
        if (best >= 0 || pass === 2) this.type[i] = best >= 0 ? best : T.FLOOR;
      }
    }
    this.floodThemes(def.defaultTheme ?? 0);
  }

  idx(x, z) { return z * this.w + x; }
  inb(x, z) { return x >= 0 && z >= 0 && x < this.w && z < this.h; }
  get(x, z) { return this.inb(x, z) ? this.type[z * this.w + x] : T.VOID; }
  isOutdoor(x, z) { return OUTDOOR.has(this.get(x, z)); }
  isWallLike(t) { return t === T.WALL || t === T.EXT || t === T.WINDOW || t === T.VOID; }

  floodThemes(def) {
    const { w, h } = this;
    const q = [];
    for (let i = 0; i < w * h; i++) if (this.theme[i] >= 0) q.push(i);
    // BFS from theme seeds; doors stop the fill so each room keeps its own look
    const passable = (i) => {
      const t = this.type[i];
      return t === T.FLOOR || t === T.WATER;
    };
    let head = 0;
    while (head < q.length) {
      const i = q[head++];
      const x = i % w, z = (i / w) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!this.inb(nx, nz)) continue;
        const j = nz * w + nx;
        if (this.theme[j] >= 0 || !passable(j)) continue;
        this.theme[j] = this.theme[i];
        q.push(j);
      }
    }
    for (let i = 0; i < w * h; i++) if (this.theme[i] < 0) this.theme[i] = def;
    // doors take the theme of one neighbour
    for (let i = 0; i < w * h; i++) {
      if (this.type[i] !== T.DOOR) continue;
      const x = i % w, z = (i / w) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = this.get(x + dx, z + dz);
        if (t === T.FLOOR) { this.theme[i] = this.theme[this.idx(x + dx, z + dz)]; break; }
      }
    }
  }

  // ---- colliders (props) ----
  addCollider(c) {
    this.colliders.push(c);
    for (let z = Math.floor(c.minZ); z <= Math.floor(c.maxZ); z++)
      for (let x = Math.floor(c.minX); x <= Math.floor(c.maxX); x++) {
        const k = x + ',' + z;
        if (!this.colBuckets.has(k)) this.colBuckets.set(k, []);
        this.colBuckets.get(k).push(c);
        // block navigation when a prop covers most of the cell
        if (this.inb(x, z)) {
          const ox = Math.min(c.maxX, x + 1) - Math.max(c.minX, x);
          const oz = Math.min(c.maxZ, z + 1) - Math.max(c.minZ, z);
          if (ox * oz > 0.35 && !c.noNav) this.navBlock[z * this.w + x] = 1;
        }
      }
    return c;
  }
  removeCollider(c) {
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
    for (const arr of this.colBuckets.values()) { const j = arr.indexOf(c); if (j >= 0) arr.splice(j, 1); }
  }

  doorAt(x, z) { return this.doors.get(z * this.w + x); }

  solidForMove(x, z) {
    const t = this.get(x, z);
    return SOLID_MOVE.has(t);
  }

  // Push a circle (x,z,r) out of walls, closed doors and prop boxes. Returns corrected [x,z].
  collide(px, pz, r, ignoreProps = false) {
    for (let it = 0; it < 3; it++) {
      const x0 = Math.floor(px - r), x1 = Math.floor(px + r), z0 = Math.floor(pz - r), z1 = Math.floor(pz + r);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        if (this.solidForMove(x, z)) [px, pz] = pushBox(px, pz, r, x, z, x + 1, z + 1);
        else if (this.get(x, z) === T.TREE) [px, pz] = pushCircle(px, pz, r, x + 0.5, z + 0.5, 0.22);
        else if (this.get(x, z) === T.DOOR) {
          const d = this.doorAt(x, z);
          if (d && d.blocking()) {
            if (d.axis === 'x') [px, pz] = pushBox(px, pz, r, x, z + 0.44, x + 1, z + 0.56);
            else [px, pz] = pushBox(px, pz, r, x + 0.44, z, x + 0.56, z + 1);
          }
        }
        if (!ignoreProps) {
          const b = this.colBuckets.get(x + ',' + z);
          if (b) for (const c of b) if (!c.disabled) [px, pz] = pushBox(px, pz, r, c.minX, c.minZ, c.maxX, c.maxZ);
        }
      }
    }
    return [px, pz];
  }

  // Grid ray march (Amanatides & Woo). Ray in XZ plane with height check against door tops etc.
  // Returns { t, x, z, nx, nz, kind } or null.
  raycast(ox, oy, oz, dx, dy, dz, maxT, opts = {}) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    let cx = Math.floor(ox), cz = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / dx), tDeltaZ = Math.abs(1 / dz);
    let tMaxX = dx > 0 ? (cx + 1 - ox) / dx : dx < 0 ? (cx - ox) / dx : Infinity;
    let tMaxZ = dz > 0 ? (cz + 1 - oz) / dz : dz < 0 ? (cz - oz) / dz : Infinity;
    let t = 0, nx = 0, nz = 0;
    let best = null;
    for (let i = 0; i < 400 && t <= maxT; i++) {
      const ty = this.get(cx, cz);
      if (SOLID_RAY.has(ty) && i > 0) {
        best = { t, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, nx, nz, ny: 0, kind: 'wall', cx, cz };
        break;
      }
      if (ty === T.DOOR && !opts.ignoreDoors) {
        const d = this.doorAt(cx, cz);
        if (d && d.blocking()) {
          // intersect with door mid-plane
          let tt;
          if (d.axis === 'x') tt = dz !== 0 ? (cz + 0.5 - oz) / dz : Infinity;
          else tt = dx !== 0 ? (cx + 0.5 - ox) / dx : Infinity;
          if (tt >= 0 && tt <= maxT) {
            const hx = ox + dx * tt, hz = oz + dz * tt, hy = oy + dy * tt;
            if (hx >= cx - 1e-3 && hx <= cx + 1.001 && hz >= cz - 1e-3 && hz <= cz + 1.001 && hy < 2.15) {
              const n = d.axis === 'x' ? [0, -Math.sign(dz)] : [-Math.sign(dx), 0];
              best = { t: tt, x: hx, y: hy, z: hz, nx: n[0], nz: n[1], ny: 0, kind: 'door', door: d, cx, cz };
              break;
            }
          }
        }
      }
      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; nx = -stepX; nz = 0; }
      else { t = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; nx = 0; nz = -stepZ; }
    }
    // floor / ceiling
    if (dy !== 0) {
      const ceilH = opts.ceil ?? 3.2;
      let tf = dy < 0 ? -oy / dy : (ceilH - oy) / dy;
      if (dy > 0 && this.isOutdoor(Math.floor(ox + dx * tf), Math.floor(oz + dz * tf))) tf = Infinity;
      if (tf >= 0 && tf <= maxT && (!best || tf < best.t)) {
        best = { t: tf, x: ox + dx * tf, y: oy + dy * tf, z: oz + dz * tf, nx: 0, ny: dy < 0 ? 1 : -1, nz: 0, kind: dy < 0 ? 'floor' : 'ceil' };
      }
    }
    if (opts.props) {
      for (const c of this.colliders) {
        if (c.disabled || !c.solidRay) continue;
        const h = rayBox(ox, oy, oz, dx, dy, dz, c, best ? best.t : maxT);
        if (h) best = h;
      }
    }
    if (best && best.t > maxT) return null;
    return best;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    const h = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, { ceil: 99 });
    return !h || h.t >= d - 0.05;
  }

  walkable(x, z, allowDoors = true) {
    if (!this.inb(x, z)) return false;
    const i = z * this.w + x;
    const t = this.type[i];
    if (this.navBlock[i]) return false;
    if (t === T.DOOR) {
      if (!allowDoors) { const d = this.doors.get(i); return !d || !d.blocking(); }
      const d = this.doors.get(i);
      return !d || !d.locked || allowDoors === 'force';
    }
    return t === T.FLOOR || t === T.GROUND || t === T.ROAD || t === T.PATH || t === T.WATER || t === T.GRASS;
  }

  // A* on the grid (8-connected, no corner cutting). Returns array of [x,z] cell centres.
  findPath(sx, sz, gx, gz, allowDoors = true, maxNodes = 4000) {
    sx = Math.floor(sx); sz = Math.floor(sz); gx = Math.floor(gx); gz = Math.floor(gz);
    if (!this.inb(gx, gz)) return null;
    const W = this.w;
    const start = sz * W + sx, goal = gz * W + gx;
    if (start === goal) return [[gx + 0.5, gz + 0.5]];
    const g = new Map(), came = new Map();
    const open = new MinHeap();
    const hfn = (i) => { const x = i % W, z = (i / W) | 0; const ax = Math.abs(x - gx), az = Math.abs(z - gz); return Math.max(ax, az) + 0.414 * Math.min(ax, az); };
    g.set(start, 0);
    open.push(start, hfn(start));
    let n = 0;
    const goalWalk = this.walkable(gx, gz, allowDoors);
    while (open.size && n++ < maxNodes) {
      const cur = open.pop();
      if (cur === goal) break;
      const x = cur % W, z = (cur / W) | 0;
      const gc = g.get(cur);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz;
        const ni = nz * W + nx;
        if (!(this.walkable(nx, nz, allowDoors) || (ni === goal && !goalWalk && this.inb(nx, nz)))) continue;
        if (dx && dz && (!this.walkable(x + dx, z, allowDoors) || !this.walkable(x, z + dz, allowDoors))) continue;
        // diagonal moves through door cells look wrong
        if (dx && dz && (this.type[ni] === T.DOOR || this.type[cur] === T.DOOR)) continue;
        const ng = gc + (dx && dz ? 1.414 : 1);
        if (ng < (g.get(ni) ?? Infinity)) {
          g.set(ni, ng); came.set(ni, cur);
          open.push(ni, ng + hfn(ni));
        }
      }
    }
    if (!came.has(goal)) return null;
    const path = [];
    let c = goal;
    while (c !== start) { path.push([(c % W) + 0.5, ((c / W) | 0) + 0.5]); c = came.get(c); }
    path.reverse();
    return path;
  }

  randomWalkable(rng, near, radius) {
    for (let i = 0; i < 200; i++) {
      let x, z;
      if (near) { x = Math.floor(near.x + (rng() * 2 - 1) * radius); z = Math.floor(near.z + (rng() * 2 - 1) * radius); }
      else { x = Math.floor(rng() * this.w); z = Math.floor(rng() * this.h); }
      if (this.walkable(x, z, false) && this.get(x, z) !== T.DOOR) return { x: x + 0.5, z: z + 0.5 };
    }
    return null;
  }
}

function pushBox(px, pz, r, minX, minZ, maxX, maxZ) {
  const cx = Math.max(minX, Math.min(px, maxX));
  const cz = Math.max(minZ, Math.min(pz, maxZ));
  let dx = px - cx, dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return [px, pz];
  if (d2 < 1e-9) {
    // centre inside box: push along smallest axis
    const l = px - minX, rr = maxX - px, t = pz - minZ, b = maxZ - pz;
    const m = Math.min(l, rr, t, b);
    if (m === l) return [minX - r, pz]; if (m === rr) return [maxX + r, pz];
    if (m === t) return [px, minZ - r]; return [px, maxZ + r];
  }
  const d = Math.sqrt(d2);
  return [cx + (dx / d) * r, cz + (dz / d) * r];
}
function pushCircle(px, pz, r, cx, cz, cr) {
  const dx = px - cx, dz = pz - cz, d = Math.hypot(dx, dz), m = r + cr;
  if (d >= m || d < 1e-6) return [px, pz];
  return [cx + (dx / d) * m, cz + (dz / d) * m];
}
function rayBox(ox, oy, oz, dx, dy, dz, c, maxT) {
  let tmin = 0, tmax = maxT, nAxis = -1, nSign = 0;
  const mins = [c.minX, c.minY ?? 0, c.minZ], maxs = [c.maxX, c.maxY ?? 1, c.maxZ], o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < mins[a] || o[a] > maxs[a]) return null; continue; }
    let t1 = (mins[a] - o[a]) / d[a], t2 = (maxs[a] - o[a]) / d[a];
    let s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (nAxis < 0) return null;
  const n = [0, 0, 0]; n[nAxis] = nSign;
  return { t: tmin, x: ox + dx * tmin, y: oy + dy * tmin, z: oz + dz * tmin, nx: n[0], ny: n[1], nz: n[2], kind: 'prop', collider: c };
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const a = this.k, b = this.p; a.push(k); b.push(p);
    let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (b[j] <= b[i]) break; [a[i], a[j]] = [a[j], a[i]]; [b[i], b[j]] = [b[j], b[i]]; i = j; }
  }
  pop() {
    const a = this.k, b = this.p; const top = a[0];
    const lk = a.pop(), lp = b.pop();
    if (a.length) {
      a[0] = lk; b[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; [b[i], b[m]] = [b[m], b[i]]; i = m;
      }
    }
    return top;
  }
}

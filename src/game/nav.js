// Navigation grid generated from the collision world (works for any map made
// in the editor), with A* + string-pulling for bots.
import * as THREE from 'three';

export class NavGrid {
  constructor(col, bounds, cell = 1) {
    this.col = col; this.cell = cell;
    this.minX = bounds.minX; this.minZ = bounds.minZ;
    this.w = Math.ceil((bounds.maxX - bounds.minX) / cell); this.h = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    const N = this.w * this.h;
    this.walk = new Uint8Array(N); this.height = new Float32Array(N);
    const q = [];
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const x = this.minX + (i + 0.5) * cell, z = this.minZ + (j + 0.5) * cell;
      col.query(x - 0.6, z - 0.6, x + 0.6, z + 0.6, q);
      const cands = [0];
      for (const c of q) if (c.solid && col.footprint(c, x, z, 0)) { const top = col.surfaceTop(c, x, z); if (top < 5) cands.push(top); }
      cands.sort((a, b) => a - b);
      let ok = false, hh = 0;
      for (const s of cands) {
        let blocked = false;
        for (const c of q) {
          if (!c.solid) continue;
          const top = c.type === 'ramp' ? col.surfaceTop(c, x, z) : c.maxY;
          if (c.minY >= s + 1.75 || top <= s + 0.45) continue;
          if (col.footprint(c, x, z, 0.38)) { blocked = true; break; }
        }
        if (!blocked) { ok = true; hh = s; break; }
      }
      const k = j * this.w + i; this.walk[k] = ok ? 1 : 0; this.height[k] = hh;
    }
    this.walkList = []; for (let k = 0; k < N; k++) if (this.walk[k]) this.walkList.push(k);
  }
  idx(x, z) { const i = Math.floor((x - this.minX) / this.cell), j = Math.floor((z - this.minZ) / this.cell); if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1; return j * this.w + i; }
  center(k, out = new THREE.Vector3()) { const i = k % this.w, j = (k / this.w) | 0; return out.set(this.minX + (i + 0.5) * this.cell, this.height[k], this.minZ + (j + 0.5) * this.cell); }
  nearest(x, z) {
    let k = this.idx(x, z); if (k >= 0 && this.walk[k]) return k;
    let best = -1, bd = 1e9;
    const ci = Math.floor((x - this.minX) / this.cell), cj = Math.floor((z - this.minZ) / this.cell);
    for (let r = 1; r < 8 && best < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const kk = j * this.w + i; if (!this.walk[kk]) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = kk; }
    }
    return best;
  }
  randomPoint(out = new THREE.Vector3()) { return this.center(this.walkList[(Math.random() * this.walkList.length) | 0], out); }

  _passable(a, b) { return this.walk[b] && Math.abs(this.height[a] - this.height[b]) < 0.55; }

  findPath(from, to) {
    const s = this.nearest(from.x, from.z), g = this.nearest(to.x, to.z);
    if (s < 0 || g < 0) return null;
    if (s === g) return [this.center(g)];
    const N = this.walk.length, W = this.w;
    const gs = this._gs || (this._gs = new Float32Array(N)); const came = this._came || (this._came = new Int32Array(N)); const stamp = this._st || (this._st = new Uint32Array(N));
    const closed = this._cl || (this._cl = new Uint32Array(N));
    const run = (this._run = (this._run || 0) + 1);
    const heap = []; // [f, k]
    const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const gx = g % W, gz = (g / W) | 0;
    const hfn = (k) => { const dx = Math.abs(k % W - gx), dz = Math.abs(((k / W) | 0) - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    stamp[s] = run; gs[s] = 0; came[s] = -1; push(hfn(s), s);
    let found = false, iter = 0;
    while (heap.length && iter++ < 20000) {
      const [, k] = pop();
      if (closed[k] === run) continue; closed[k] = run;
      if (k === g) { found = true; break; }
      const ki = k % W, kj = (k / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ki + di, nj = kj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const n = nj * W + ni;
        if (!this._passable(k, n)) continue;
        if (di && dj && (!this._passable(k, kj * W + ni) || !this._passable(k, nj * W + ki))) continue;
        const cost = gs[k] + (di && dj ? 1.414 : 1) + Math.abs(this.height[n] - this.height[k]) * 2;
        if (stamp[n] !== run || cost < gs[n]) { stamp[n] = run; gs[n] = cost; came[n] = k; push(cost + hfn(n), n); }
      }
    }
    if (!found) return null;
    const cells = []; for (let k = g; k !== -1; k = came[k]) cells.push(k); cells.reverse();
    // string pulling
    const out = [];
    let a = 0;
    while (a < cells.length - 1) {
      let b = cells.length - 1;
      while (b > a + 1 && !this._los(cells[a], cells[b])) b--;
      out.push(this.center(cells[b]));
      a = b;
    }
    return out;
  }
  _los(a, b) {
    const pa = this.center(a, _p1), pb = this.center(b, _p2);
    const d = pa.distanceTo(pb); const n = Math.ceil(d / (this.cell * 0.4));
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const t = i / n; const k = this.idx(pa.x + (pb.x - pa.x) * t, pa.z + (pb.z - pa.z) * t);
      if (k < 0 || !this._passable(prev, k)) return false; prev = k;
    }
    return true;
  }
}
const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();

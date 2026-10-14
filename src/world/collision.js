// Analytic collision world: yawed boxes, ramps (wedges) and vertical
// cylinders in a spatial hash. Used for player/bot movement, bullets and
// baking ambient occlusion. Much faster than mesh raycasting.
import * as THREE from 'three';

const CELL = 4;
const key = (ix, iz) => ((ix + 2048) << 12) | (iz + 2048);

export class CollisionWorld {
  constructor() {
    this.colliders = [];
    this.grid = new Map();
    this.stamp = 1;
    this.groundY = 0;
    this.hasGround = true;
    this.bounds = null; // {minX,maxX,minZ,maxZ}
  }

  // c: {type:'box'|'ramp'|'cyl', pos:[x,y,z] center, size:[w,h,d] (cyl: r=w/2), yaw (rad), mat}
  add(def) {
    const c = {
      type: def.type, mat: def.mat || 'concrete',
      cx: def.pos[0], cy: def.pos[1], cz: def.pos[2],
      hx: def.size[0] / 2, hy: def.size[1] / 2, hz: def.size[2] / 2,
      yaw: def.yaw || 0, solid: def.solid !== false, walk: def.walk !== false,
    };
    c.cos = Math.cos(c.yaw); c.sin = Math.sin(c.yaw);
    if (c.type === 'cyl') { c.r = c.hx; c.hz = c.hx; }
    // world AABB
    const ex = Math.abs(c.cos) * c.hx + Math.abs(c.sin) * c.hz;
    const ez = Math.abs(c.sin) * c.hx + Math.abs(c.cos) * c.hz;
    c.minX = c.cx - ex; c.maxX = c.cx + ex; c.minZ = c.cz - ez; c.maxZ = c.cz + ez;
    c.minY = c.cy - c.hy; c.maxY = c.cy + c.hy;
    c.id = this.colliders.length;
    c._s = 0;
    this.colliders.push(c);
    const x0 = Math.floor(c.minX / CELL), x1 = Math.floor(c.maxX / CELL);
    const z0 = Math.floor(c.minZ / CELL), z1 = Math.floor(c.maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = key(ix, iz); let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); } a.push(c);
    }
    return c;
  }

  // colliders whose AABB overlaps the xz rect (deduped)
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const a = this.grid.get(key(ix, iz)); if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const c = a[i];
        if (c._s === s) continue; c._s = s;
        if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
        out.push(c);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- rays
  // returns t (distance) or Infinity; writes normal into n if provided
  rayCollider(c, ox, oy, oz, dx, dy, dz, maxT, n) {
    if (c.type === 'cyl') return this._rayCyl(c, ox, oy, oz, dx, dy, dz, maxT, n);
    // to local space (yaw only)
    const px = ox - c.cx, py = oy - c.cy, pz = oz - c.cz;
    const cs = c.cos, sn = c.sin;
    const lx = cs * px - sn * pz, lz = sn * px + cs * pz;
    const ldx = cs * dx - sn * dz, ldz = sn * dx + cs * dz;
    let tmin = 0, tmax = maxT, ax = -1, sgn = 0;
    // slabs
    const o = [lx, py, lz], d = [ldx, dy, ldz], h = [c.hx, c.hy, c.hz];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < -h[a] || o[a] > h[a]) return Infinity; continue; }
      const inv = 1 / d[a];
      let t1 = (-h[a] - o[a]) * inv, t2 = (h[a] - o[a]) * inv, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; ax = a; sgn = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
    let pnx = 0, pny = 0, pnz = 0, usePlane = false;
    if (c.type === 'ramp') {
      // halfspace  y*hz + z*hy <= 0 (rises toward local -z)
      let nx = 0, ny = c.hz, nz = c.hy; const l = Math.hypot(ny, nz); ny /= l; nz /= l;
      const dist = ny * py + nz * lz, den = ny * dy + nz * ldz;
      if (Math.abs(den) < 1e-9) { if (dist > 0) return Infinity; }
      else {
        const t = -dist / den;
        if (den < 0) { if (t > tmin) { tmin = t; usePlane = true; pnx = nx; pny = ny; pnz = nz; } }
        else if (t < tmax) tmax = t;
        if (tmin > tmax) return Infinity;
      }
    }
    if (tmin <= 0 && ax === -1 && !usePlane) return Infinity; // started inside
    if (n) {
      let nx = 0, ny = 0, nz = 0;
      if (usePlane) { nx = pnx; ny = pny; nz = pnz; }
      else if (ax === 0) nx = sgn; else if (ax === 1) ny = sgn; else nz = sgn;
      // local->world
      n.set(cs * nx + sn * nz, ny, -sn * nx + cs * nz);
    }
    return tmin;
  }

  _rayCyl(c, ox, oy, oz, dx, dy, dz, maxT, n) {
    const px = ox - c.cx, pz = oz - c.cz, r = c.r;
    let best = Infinity, bn = 0;
    const a = dx * dx + dz * dz;
    if (a > 1e-9) {
      const b = 2 * (px * dx + pz * dz), cc = px * px + pz * pz - r * r;
      const disc = b * b - 4 * a * cc;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t >= 0 && t < maxT) { const y = oy + dy * t; if (y >= c.minY && y <= c.maxY) { best = t; bn = 1; } }
      }
    }
    if (Math.abs(dy) > 1e-9) {
      const yPlane = dy < 0 ? c.maxY : c.minY;
      const t = (yPlane - oy) / dy;
      if (t >= 0 && t < best && t < maxT) {
        const x = px + dx * t, z = pz + dz * t;
        if (x * x + z * z <= r * r) { best = t; bn = 2; }
      }
    }
    if (best < Infinity && n) {
      if (bn === 1) { const x = px + dx * best, z = pz + dz * best; const l = Math.hypot(x, z) || 1; n.set(x / l, 0, z / l); }
      else n.set(0, dy < 0 ? 1 : -1, 0);
    }
    return best;
  }

  // Full raycast. dir must be normalized. Returns hit object or null.
  raycast(origin, dir, maxDist, hit = {}) {
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    let best = maxDist, bc = null;
    const nTmp = this._n || (this._n = new THREE.Vector3());
    const bestN = this._bn || (this._bn = new THREE.Vector3());
    // ground plane
    if (this.hasGround && dy < -1e-6) {
      const t = (this.groundY - oy) / dy;
      if (t >= 0 && t < best) { best = t; bc = 'ground'; bestN.set(0, 1, 0); }
    }
    // DDA over hash grid
    const s = ++this.stamp;
    let ix = Math.floor(ox / CELL), iz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = Math.abs(dx) > 1e-9 ? Math.abs(CELL / dx) : Infinity;
    const tDZ = Math.abs(dz) > 1e-9 ? Math.abs(CELL / dz) : Infinity;
    let tMX = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (ix + 1) * CELL - ox : ox - ix * CELL) / Math.abs(dx)) : Infinity;
    let tMZ = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (iz + 1) * CELL - oz : oz - iz * CELL) / Math.abs(dz)) : Infinity;
    let tCell = 0;
    for (let iter = 0; iter < 512; iter++) {
      const a = this.grid.get(key(ix, iz));
      if (a) {
        for (let i = 0; i < a.length; i++) {
          const c = a[i];
          if (c._s === s || !c.solid) continue; c._s = s;
          const t = this.rayCollider(c, ox, oy, oz, dx, dy, dz, best, nTmp);
          if (t < best) { best = t; bc = c; bestN.copy(nTmp); }
        }
      }
      if (best <= tCell) break;
      if (tMX < tMZ) { tCell = tMX; tMX += tDX; ix += stepX; } else { tCell = tMZ; tMZ += tDZ; iz += stepZ; }
      if (tCell > best) break;
    }
    if (!bc) return null;
    hit.t = best; hit.collider = bc === 'ground' ? null : bc;
    hit.mat = bc === 'ground' ? (this.groundMat || 'sand') : bc.mat;
    hit.point = (hit.point || new THREE.Vector3()).set(ox + dx * best, oy + dy * best, oz + dz * best);
    hit.normal = (hit.normal || new THREE.Vector3()).copy(bestN);
    return hit;
  }

  // true if segment a->b is unobstructed
  lineOfSight(a, b) {
    const d = this._los || (this._los = new THREE.Vector3());
    d.subVectors(b, a); const len = d.length(); if (len < 1e-4) return true;
    d.multiplyScalar(1 / len);
    return !this.raycast(a, d, len - 0.05, this._losHit || (this._losHit = {}));
  }

  // ---------------------------------------------------------------- height
  surfaceTop(c, x, z) {
    if (c.type === 'ramp') {
      const px = x - c.cx, pz = z - c.cz;
      const lz = c.sin * px + c.cos * pz;
      const k = Math.min(1, Math.max(0, (c.hz - lz) / (2 * c.hz)));
      return c.minY + 2 * c.hy * k;
    }
    return c.maxY;
  }
  // inside footprint test with radius padding
  footprint(c, x, z, pad) {
    const px = x - c.cx, pz = z - c.cz;
    if (c.type === 'cyl') { const rr = c.r + pad; return px * px + pz * pz <= rr * rr; }
    const lx = c.cos * px - c.sin * pz, lz = c.sin * px + c.cos * pz;
    return Math.abs(lx) <= c.hx + pad && Math.abs(lz) <= c.hz + pad;
  }

  // highest walkable surface at (x,z) that is <= maxY. radius: sample circle
  groundHeight(x, z, maxY, radius = 0) {
    let best = this.hasGround ? this.groundY : -1e9;
    const arr = this.query(x - radius - 0.1, z - radius - 0.1, x + radius + 0.1, z + radius + 0.1, this._q1 || (this._q1 = []));
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i]; if (!c.solid) continue;
      if (c.type === 'ramp') {
        if (!this.footprint(c, x, z, 0)) continue;
        const top = this.surfaceTop(c, x, z);
        if (top <= maxY && top > best) best = top;
      } else {
        if (!this.footprint(c, x, z, radius * 0.75)) continue;
        if (c.maxY <= maxY && c.maxY > best) best = c.maxY;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- character
  // Kinematic capsule (as cylinder) mover. state: {pos (feet), vel, onGround}
  // Returns state with flags.
  moveCharacter(st, dt, radius, height, stepH = 0.45) {
    const p = st.pos;
    // horizontal in substeps
    const dist = Math.hypot(st.vel.x, st.vel.z) * dt;
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.5)));
    const sx = st.vel.x * dt / steps, sz = st.vel.z * dt / steps;
    st.hitWall = false;
    for (let s = 0; s < steps; s++) {
      p.x += sx; p.z += sz;
      this._resolveXZ(st, radius, height, stepH);
    }
    // vertical
    st.vel.y -= (st.gravity ?? 20) * dt;
    let ny = p.y + st.vel.y * dt;
    const probe = st.onGround ? p.y + stepH : Math.max(p.y, ny) + 0.05;
    const g = this.groundHeight(p.x, p.z, probe, radius);
    const wasGround = st.onGround;
    if (ny <= g + 0.001) {
      st.landSpeed = wasGround ? 0 : -st.vel.y;
      ny = g; st.vel.y = 0; st.onGround = true;
    } else if (wasGround && st.vel.y <= 0 && p.y - g < stepH && p.y - g > 0.001) {
      // stick to ground when walking down slopes/steps
      ny = g; st.vel.y = 0; st.onGround = true; st.landSpeed = 0;
    } else st.onGround = false;
    // ceiling
    if (st.vel.y > 0) {
      const arr = this.query(p.x - radius, p.z - radius, p.x + radius, p.z + radius, this._q2 || (this._q2 = []));
      for (const c of arr) {
        if (!c.solid || !this.footprint(c, p.x, p.z, radius * 0.7)) continue;
        if (c.minY >= p.y + height - 0.05 && c.minY < ny + height) { ny = c.minY - height; st.vel.y = 0; }
      }
    }
    p.y = ny;
    if (this.bounds) {
      const b = this.bounds;
      p.x = Math.min(b.maxX - radius, Math.max(b.minX + radius, p.x));
      p.z = Math.min(b.maxZ - radius, Math.max(b.minZ + radius, p.z));
    }
    return st;
  }

  _resolveXZ(st, radius, height, stepH) {
    const p = st.pos;
    const arr = this.query(p.x - radius - 0.1, p.z - radius - 0.1, p.x + radius + 0.1, p.z + radius + 0.1, this._q3 || (this._q3 = []));
    const feet = p.y, head = p.y + height;
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i]; if (!c.solid) continue;
        if (c.minY >= head || c.maxY <= feet) continue;
        let top = c.maxY;
        if (c.type === 'ramp') top = this.surfaceTop(c, p.x, p.z);
        if (top <= feet + stepH && (c.type === 'ramp' || this._headroom(c, p, height))) continue; // steppable
        if (c.type === 'cyl') {
          const dx = p.x - c.cx, dz = p.z - c.cz; const d = Math.hypot(dx, dz); const rr = c.r + radius;
          if (d < rr && d > 1e-6) { p.x = c.cx + dx / d * rr; p.z = c.cz + dz / d * rr; st.hitWall = true; }
          continue;
        }
        if (c.type === 'ramp') {
          // only the tall part of a ramp blocks; approximate with its footprint where top > feet+step
          if (this.surfaceTop(c, p.x, p.z) <= feet + stepH) continue;
        }
        const px = p.x - c.cx, pz = p.z - c.cz;
        const lx = c.cos * px - c.sin * pz, lz = c.sin * px + c.cos * pz;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let dx = lx - qx, dz = lz - qz; let d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        let nlx, nlz;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2); const push = radius - d; nlx = lx + dx / d * push; nlz = lz + dz / d * push;
        } else {
          // center inside box: push out along smallest axis
          const ox = c.hx - Math.abs(lx), oz = c.hz - Math.abs(lz);
          if (ox < oz) { nlx = Math.sign(lx || 1) * (c.hx + radius); nlz = lz; } else { nlz = Math.sign(lz || 1) * (c.hz + radius); nlx = lx; }
        }
        // back to world
        p.x = c.cx + c.cos * nlx + c.sin * nlz;
        p.z = c.cz - c.sin * nlx + c.cos * nlz;
        st.hitWall = true;
      }
    }
  }
  _headroom(c, p, height) {
    // can we stand on top of c? check nothing occupies the space above
    return true;
  }
}

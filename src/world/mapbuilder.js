// Map JSON -> merged, AO-baked render meshes + collision world.
//
// Every object type (box, ramp, stairs, arch, building, prop...) is emitted
// through a small "ctx" API in its own local space. Geometry is generated in
// world space with world-aligned UVs (constant texel density, textures line
// up across objects), then baked ambient occlusion is computed per vertex by
// ray casting against the analytic collision world, and finally everything is
// merged into one mesh per material (~15 draw calls for a whole map).
import * as THREE from 'three';
import { CollisionWorld } from './collision.js';
import { materials, patchBakedAO } from '../gfx/materials.js';
import { PREFABS } from './prefabs.js';
import { DEG } from '../core/util.js';
import { hasModel } from '../assets/loader.js';

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();
const _nm = new THREE.Matrix3();

function uniformLines(L, c) {
  const n = Math.max(1, Math.min(160, Math.ceil(L / c)));
  const out = new Array(n + 1); for (let i = 0; i <= n; i++) out[i] = (i / n) * L; return out;
}
const GRADE = [0, 0.5, 1.2, 2.4, 4.4];
function gradedLines(L, c) {
  if (L <= c * 6) return uniformLines(L, c);
  const set = [];
  for (const g of GRADE) { const e = g * c; if (e < L / 2) { set.push(e, L - e); } }
  const a = GRADE[GRADE.length - 1] * c, b = L - a;
  if (b > a) { const n = Math.ceil((b - a) / Math.max(2.5, c * 6)); for (let i = 1; i < n; i++) set.push(a + (b - a) * i / n); }
  set.sort((x, y) => x - y);
  const out = [];
  for (const v of set) if (!out.length || v - out[out.length - 1] > 1e-4) out.push(v);
  return out;
}

class Bucket {
  constructor(mat) { this.mat = mat; this.pos = []; this.nor = []; this.uv = []; this.idx = []; this.noAO = []; this.count = 0; }
}

export class GeoSink {
  constructor(opts = {}) {
    this.models = []; // {name, matrix} placements of glTF props (instanced later)
    this.buckets = new Map();
    this.caster = { pos: [], idx: [], count: 0 };
    this.cell = opts.cell || 0.5; // AO subdivision cell size
    this.collision = opts.collision;
    this.tileOf = opts.tileOf || ((m) => materials.tileOf(m));
  }
  bucket(mat) { let b = this.buckets.get(mat); if (!b) { b = new Bucket(mat); this.buckets.set(mat, b); } return b; }

  // A subdivided planar grid. o: corner origin (world), ua/va: unit axes (world), n: normal,
  // ul/vl: lengths. UVs from world position projected on ua/va.
  // flags.graded: dense vertex rows near the borders (where contact AO lives),
  // sparse in the middle -> ~10x fewer vertices on big walls.
  grid(mat, o, ua, va, n, ul, vl, cell = this.cell, flags = {}) {
    const b = this.bucket(mat);
    const tile = this.tileOf(mat);
    const us = flags.graded ? gradedLines(ul, cell) : uniformLines(ul, cell);
    const vs = flags.graded ? gradedLines(vl, cell) : uniformLines(vl, cell);
    const nu = us.length - 1, nv = vs.length - 1;
    const base = b.count;
    for (let j = 0; j <= nv; j++) {
      const fv = vs[j];
      for (let i = 0; i <= nu; i++) {
        const fu = us[i];
        const x = o.x + ua.x * fu + va.x * fv, y = o.y + ua.y * fu + va.y * fv, z = o.z + ua.z * fu + va.z * fv;
        b.pos.push(x, y, z); b.nor.push(n.x, n.y, n.z);
        b.uv.push((x * ua.x + y * ua.y + z * ua.z) / tile, (x * va.x + y * va.y + z * va.z) / tile);
        b.noAO.push(flags.noAO ? 1 : 0);
      }
    }
    const row = nu + 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * row + i, bb = a + 1, c = a + row + 1, d = a + row;
      b.idx.push(a, bb, c, a, c, d);
    }
    b.count += (nu + 1) * (nv + 1);
    if (!flags.noCast) {
      const cb = this.caster, cbase = cb.count;
      const p = [[0, 0], [ul, 0], [ul, vl], [0, vl]];
      for (const [fu, fv] of p) cb.pos.push(o.x + ua.x * fu + va.x * fv, o.y + ua.y * fu + va.y * fv, o.z + ua.z * fu + va.z * fv);
      cb.idx.push(cbase, cbase + 1, cbase + 2, cbase, cbase + 2, cbase + 3);
      cb.count += 4;
    }
  }

  // Vertical strip through a list of columns {x,z,nx,nz,u} (world), from y0 to y1.
  // Used for rounded walls: smooth normals, texture continuous around corners.
  strip(mat, cols, y0, y1, cell = this.cell, flags = {}) {
    const b = this.bucket(mat);
    const tile = this.tileOf(mat);
    const vs = gradedLines(y1 - y0, cell);
    const base = b.count, row = cols.length;
    for (let j = 0; j < vs.length; j++) {
      const y = y0 + vs[j];
      for (const c of cols) { b.pos.push(c.x, y, c.z); b.nor.push(c.nx, 0, c.nz); b.uv.push(c.u / tile, y / tile); b.noAO.push(flags.noAO ? 1 : 0); }
    }
    for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < row - 1; i++) {
      const a = base + j * row + i;
      if (flags.flip) b.idx.push(a, a + row + 1, a + 1, a, a + row, a + row + 1);
      else b.idx.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
    }
    b.count += vs.length * row;
    if (!flags.noCast) {
      const cb = this.caster;
      for (let i = 0; i < row - 1; i++) {
        const A = cols[i], B = cols[i + 1], cbase = cb.count;
        cb.pos.push(A.x, y0, A.z, B.x, y0, B.z, B.x, y1, B.z, A.x, y1, A.z);
        cb.idx.push(cbase, cbase + 1, cbase + 2, cbase, cbase + 2, cbase + 3);
        cb.count += 4;
      }
    }
  }

  // Generic BufferGeometry (any shape) transformed by matrix, with box-projected UVs.
  geometry(mat, geo, matrix, flags = {}) {
    const b = this.bucket(mat);
    const tile = flags.tile || this.tileOf(mat);
    const g = geo.index ? geo : geo; // indexed or not both handled
    const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
    _nm.getNormalMatrix(matrix);
    const base = b.count;
    for (let i = 0; i < pa.count; i++) {
      _v.fromBufferAttribute(pa, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize();
      b.pos.push(_v.x, _v.y, _v.z); b.nor.push(_n.x, _n.y, _n.z);
      if (flags.keepUV && ua) { b.uv.push(ua.getX(i) * (flags.uvScale || 1), ua.getY(i) * (flags.uvScale || 1)); }
      else {
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) b.uv.push(_v.x / tile, -_v.z * Math.sign(_n.y || 1) / tile);
        else if (ax >= az) b.uv.push(-_v.z * Math.sign(_n.x) / tile, _v.y / tile);
        else b.uv.push(_v.x * Math.sign(_n.z) / tile, _v.y / tile);
      }
      b.noAO.push(flags.noAO ? 1 : 0);
    }
    if (g.index) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) b.idx.push(base + ia[i]); }
    else for (let i = 0; i < pa.count; i++) b.idx.push(base + i);
    b.count += pa.count;
    if (!flags.noCast) {
      const cb = this.caster, cbase = cb.count;
      for (let i = 0; i < pa.count; i++) { _v.fromBufferAttribute(pa, i).applyMatrix4(matrix); cb.pos.push(_v.x, _v.y, _v.z); }
      if (g.index) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) cb.idx.push(cbase + ia[i]); }
      else for (let i = 0; i < pa.count; i++) cb.idx.push(cbase + i);
      cb.count += pa.count;
    }
  }
}

// --------------------------------------------------------------------------
// Local-space emitter handed to object/prefab generators.
// --------------------------------------------------------------------------
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
];

export class Emitter {
  constructor(sink, collision) { this.sink = sink; this.col = collision; this.matrix = new THREE.Matrix4(); this.yaw = 0; this.scale = 1; this.pos = new THREE.Vector3(); }
  setTransform(pos, yawDeg, scale = 1) {
    this.pos.set(pos[0], pos[1], pos[2]); this.yaw = (yawDeg || 0) * DEG; this.scale = scale;
    this.matrix.compose(this.pos, _q.setFromAxisAngle(_v.set(0, 1, 0), this.yaw), _s.set(scale, scale, scale));
    return this;
  }
  _toWorld(x, y, z, out) { return out.set(x, y, z).applyMatrix4(this.matrix); }
  _dirToWorld(x, y, z, out) { const c = Math.cos(this.yaw), s = Math.sin(this.yaw); return out.set(c * x + s * z, y, -s * x + c * z); }

  // Axis-aligned (in local space, + optional extra yaw) subdivided box. center local, size [w,h,d]
  box(mat, center, size, opts = {}) {
    const hx = size[0] / 2 * this.scale, hy = size[1] / 2 * this.scale, hz = size[2] / 2 * this.scale;
    const extraYaw = (opts.yaw || 0) * DEG;
    const wc = this._toWorld(center[0], center[1], center[2], new THREE.Vector3());
    const yaw = this.yaw + extraYaw;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rot = (v) => new THREE.Vector3(c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]);
    const h = [hx, hy, hz];
    const bottomY = wc.y - hy;
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      if (f === 5 && (opts.skipBottom !== false) && bottomY <= 0.02) continue;
      if (opts.skipFaces && opts.skipFaces.includes(f)) continue;
      const nAxis = F.n.findIndex((v) => v !== 0), uAxis = F.u.findIndex((v) => v !== 0), vAxis = F.v.findIndex((v) => v !== 0);
      const n = rot(F.n), ua = rot(F.u), va = rot(F.v);
      const ul = h[uAxis] * 2, vl = h[vAxis] * 2;
      const o = wc.clone().addScaledVector(n, h[nAxis]).addScaledVector(ua, -h[uAxis]).addScaledVector(va, -h[vAxis]);
      const isFloor = f === 4 && wc.y + hy <= 0.6;
      this.sink.grid(mat, o, ua, va, n, ul, vl, opts.cell || this.sink.cell, { ...opts, graded: !isFloor });
    }
    if (opts.collide) this.col && this.col.add({ type: 'box', pos: [wc.x, wc.y, wc.z], size: [hx * 2, hy * 2, hz * 2], yaw, mat, solid: true });
  }

  // place a glTF prop (rendered instanced) at a local transform
  model(name, localMatrix) {
    this.sink.models.push({ name, matrix: new THREE.Matrix4().multiplyMatrices(this.matrix, localMatrix || new THREE.Matrix4()) });
  }

  // perimeter of a rounded rectangle (local half sizes hx,hz, radius r), world-space columns
  _roundPerimeter(center, hx, hz, r, yaw, cell, inward = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const pts = [];
    const push = (lx, lz, nx, nz) => pts.push({ x: center.x + c * lx + s * lz, z: center.z - s * lx + c * lz, nx: c * nx + s * nz, nz: -s * nx + c * nz });
    const seg = 5;
    // traversal: +X face going -Z, corner, -Z face going -X, corner, -X face going +Z, corner, +Z face going +X, corner
    const faces = [
      { sx: hx, z0: hz - r, z1: -(hz - r), axis: 'z', n: [1, 0], corner: [hx - r, -(hz - r), 0] },
      { sz: -hz, x0: hx - r, x1: -(hx - r), axis: 'x', n: [0, -1], corner: [-(hx - r), -(hz - r), -Math.PI / 2] },
      { sx: -hx, z0: -(hz - r), z1: hz - r, axis: 'z', n: [-1, 0], corner: [-(hx - r), hz - r, Math.PI] },
      { sz: hz, x0: -(hx - r), x1: hx - r, axis: 'x', n: [0, 1], corner: [hx - r, hz - r, Math.PI / 2] },
    ];
    for (const f of faces) {
      const a = f.axis === 'z' ? f.z0 : f.x0, b = f.axis === 'z' ? f.z1 : f.x1;
      const L = Math.abs(b - a), lines = gradedLines(Math.max(L, 1e-3), cell);
      for (let i = 0; i < lines.length - (r > 0.001 ? 1 : 0); i++) {
        const t = a + Math.sign(b - a) * lines[i];
        if (f.axis === 'z') push(f.sx, t, f.n[0], f.n[1]); else push(t, f.sz, f.n[0], f.n[1]);
      }
      if (r > 0.001) {
        // quarter arc from this face's normal to the next face's normal
        const [cx, cz, a0] = f.corner;
        for (let k = 0; k < seg; k++) {
          const ang = a0 - (k / seg) * (Math.PI / 2);
          const nx = Math.cos(ang), nz = Math.sin(ang);
          push(cx + nx * r, cz + nz * r, nx, nz);
        }
      }
    }
    pts.push({ ...pts[0] }); // close loop
    let u = 0;
    for (let i = 0; i < pts.length; i++) { if (i) u += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); pts[i].u = u; }
    if (inward) for (const p of pts) { p.nx = -p.nx; p.nz = -p.nz; }
    return pts;
  }

  // box with rounded vertical edges. center/size local; radius in meters
  roundBox(mat, center, size, radius, opts = {}) {
    const hx = size[0] / 2 * this.scale, hy = size[1] / 2 * this.scale, hz = size[2] / 2 * this.scale;
    const r = Math.min(radius * this.scale, hx * 0.45, hz * 0.45);
    const wc = this._toWorld(center[0], center[1], center[2], new THREE.Vector3());
    const yaw = this.yaw + (opts.yaw || 0) * DEG;
    const cell = opts.cell || this.sink.cell;
    const cols = this._roundPerimeter(wc, hx, hz, r, yaw, cell);
    this.sink.strip(mat, cols, wc.y - hy, wc.y + hy, cell, opts);
    if (opts.top !== false) {
      const sh = roundedRectShape(hx, hz, r);
      const g = new THREE.ShapeGeometry(sh, 4); g.rotateX(-Math.PI / 2);
      this.sink.geometry(opts.topMat || mat, g, new THREE.Matrix4().compose(new THREE.Vector3(wc.x, wc.y + hy, wc.z), new THREE.Quaternion().setFromAxisAngle(_Y, yaw), new THREE.Vector3(1, 1, 1)), opts);
      g.dispose();
    }
    if (opts.collide) this.col && this.col.add({ type: 'box', pos: [wc.x, wc.y, wc.z], size: [hx * 2, hy * 2, hz * 2], yaw, mat, solid: true });
  }

  // hollow rounded ring wall (parapets): outer + inner faces + top cap
  roundRing(mat, center, size, radius, thick, opts = {}) {
    const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
    const wc = this._toWorld(center[0], center[1], center[2], new THREE.Vector3());
    const yaw = this.yaw;
    const r = Math.min(radius, hx * 0.45, hz * 0.45), ri = Math.max(0.01, r - thick);
    const cell = 1.0;
    this.sink.strip(mat, this._roundPerimeter(wc, hx, hz, r, yaw, cell), wc.y - hy, wc.y + hy, cell, opts);
    this.sink.strip(mat, this._roundPerimeter(wc, hx - thick, hz - thick, ri, yaw, cell, 1), wc.y - hy, wc.y + hy, cell, { ...opts, flip: true, noCast: true });
    const sh = roundedRectShape(hx, hz, r); sh.holes.push(roundedRectShape(hx - thick, hz - thick, ri));
    const g = new THREE.ShapeGeometry(sh, 4); g.rotateX(-Math.PI / 2);
    this.sink.geometry(mat, g, new THREE.Matrix4().compose(new THREE.Vector3(wc.x, wc.y + hy, wc.z), new THREE.Quaternion().setFromAxisAngle(_Y, yaw), new THREE.Vector3(1, 1, 1)), opts);
    g.dispose();
  }

  // generic geometry in local space; m4 local matrix
  geo(mat, geometry, localMatrix, flags) {
    const m = new THREE.Matrix4().multiplyMatrices(this.matrix, localMatrix || new THREE.Matrix4());
    this.sink.geometry(mat, geometry, m, flags);
  }

  // helper to make a local matrix
  // rotation order YXZ: yaw first, then pitch, then roll (intuitive for props)
  static mat(pos = [0, 0, 0], rotDeg = [0, 0, 0], scale = [1, 1, 1]) {
    return new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotDeg[0] * DEG, rotDeg[1] * DEG, rotDeg[2] * DEG, 'YXZ')), new THREE.Vector3(...scale));
  }

  cyl(mat, center, r, h, opts = {}) {
    const seg = opts.seg || 18;
    const g = new THREE.CylinderGeometry(opts.rTop ?? r, r, h, seg, Math.max(1, Math.ceil(h / 0.8)), !!opts.open);
    this.geo(mat, g, Emitter.mat(center, opts.rot || [0, 0, 0]), opts);
    g.dispose();
    if (opts.collide) {
      const wc = this._toWorld(center[0], center[1], center[2], new THREE.Vector3());
      this.col && this.col.add({ type: 'cyl', pos: [wc.x, wc.y, wc.z], size: [r * 2 * this.scale, h * this.scale, r * 2 * this.scale], mat });
    }
  }

  // collision only (local center/size, extra yaw deg)
  collider(type, center, size, yawDeg = 0, mat = 'concrete') {
    const wc = this._toWorld(center[0], center[1], center[2], new THREE.Vector3());
    this.col && this.col.add({ type, pos: [wc.x, wc.y, wc.z], size: size.map((v) => v * this.scale), yaw: this.yaw + yawDeg * DEG, mat });
  }

  // ramp wedge rising toward local -Z. center/size local.
  ramp(mat, center, size, opts = {}) {
    const [w, h, d] = size.map((v) => v * this.scale);
    const wc = this._toWorld(center[0], center[1], center[2], new THREE.Vector3());
    const yaw = this.yaw + (opts.yaw || 0) * DEG;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const L = (x, y, z) => new THREE.Vector3(wc.x + c * x + s * z, wc.y + y, wc.z - s * x + c * z);
    const R = (x, y, z) => new THREE.Vector3(c * x + s * z, y, -s * x + c * z);
    const hx = w / 2, hy = h / 2, hz = d / 2;
    // slope
    const slopeLen = Math.hypot(h, d);
    const va = R(0, h / slopeLen, -d / slopeLen), ua = R(1, 0, 0);
    const n = new THREE.Vector3().crossVectors(ua, va).normalize();
    this.sink.grid(mat, L(-hx, -hy, hz), ua, va, n, w, slopeLen, undefined, opts);
    // back face (at -z), facing -z
    this.sink.grid(mat, L(hx, -hy, -hz), R(-1, 0, 0), R(0, 1, 0), R(0, 0, -1), w, h, undefined, { ...opts, graded: true });
    // side triangles
    for (const sx of [-1, 1]) {
      const g = new THREE.BufferGeometry();
      const a = [sx * hx, -hy, hz], b = [sx * hx, -hy, -hz], cc = [sx * hx, hy, -hz];
      const pts = sx > 0 ? [a, b, cc] : [a, cc, b];
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      g.computeVertexNormals();
      const m = new THREE.Matrix4().compose(wc, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
      this.sink.geometry(mat, g, m, opts);
    }
    if (opts.collide !== false && this.col) this.col.add({ type: 'ramp', pos: [wc.x, wc.y, wc.z], size: [w, h, d], yaw, mat });
  }
}

const _Y = new THREE.Vector3(0, 1, 0);
function roundedRectShape(hx, hz, r) {
  // shape in XY (y -> -z after rotateX(-90deg))
  const s = new THREE.Shape();
  if (r <= 0.001) { s.moveTo(-hx, -hz); s.lineTo(hx, -hz); s.lineTo(hx, hz); s.lineTo(-hx, hz); s.closePath(); return s; }
  s.moveTo(-hx + r, -hz); s.lineTo(hx - r, -hz); s.quadraticCurveTo(hx, -hz, hx, -hz + r);
  s.lineTo(hx, hz - r); s.quadraticCurveTo(hx, hz, hx - r, hz);
  s.lineTo(-hx + r, hz); s.quadraticCurveTo(-hx, hz, -hx, hz - r);
  s.lineTo(-hx, -hz + r); s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
  return s;
}

// --------------------------------------------------------------------------
// Object types
// --------------------------------------------------------------------------
export const OBJECT_TYPES = {
  box: { label: 'Box / Wall', defaults: { size: [4, 3, 1], mat: 'sandstone' } },
  ramp: { label: 'Ramp', defaults: { size: [3, 1.5, 5], mat: 'concrete' } },
  stairs: { label: 'Stairs', defaults: { size: [2.5, 2.4, 4], mat: 'sandstone', steps: 8 } },
  cyl: { label: 'Pillar', defaults: { size: [0.8, 4, 0.8], mat: 'sandstone' } },
  arch: { label: 'Arch Wall', defaults: { size: [8, 5, 1], mat: 'sandstone', open: [3, 3.6] } },
  building: { label: 'Building', defaults: { size: [10, 7, 8], mat: 'plaster', trim: 'sandstone', seed: 1, windows: 0.6, beams: true, door: true } },
  prop: { label: 'Prop', defaults: { prop: 'crate', scale: 1 } },
  spawn: { label: 'Spawn Point', defaults: { team: 0 } },
};

function emitObject(o, em, rng) {
  const p = o.pos || [0, 0, 0];
  const size = o.size || OBJECT_TYPES[o.type]?.defaults.size || [1, 1, 1];
  em.setTransform(p, o.rot || 0, o.type === 'prop' ? (o.scale || 1) : 1);
  const mat = o.mat || 'concrete';
  switch (o.type) {
    case 'box':
      em.box(mat, [0, size[1] / 2, 0], size, { collide: o.solid !== false });
      break;
    case 'ramp':
      em.ramp(mat, [0, size[1] / 2, 0], size);
      break;
    case 'stairs': {
      const n = Math.max(2, Math.round(o.steps || 8));
      for (let i = 0; i < n; i++) {
        const sh = size[1] * (i + 1) / n, sd = size[2] / n;
        em.box(mat, [0, sh / 2, size[2] / 2 - sd * (i + 0.5)], [size[0], sh, sd], {});
      }
      em.collider('ramp', [0, size[1] / 2, 0], size, 0, mat);
      break;
    }
    case 'cyl':
      em.cyl(mat, [0, size[1] / 2, 0], size[0] / 2, size[1], { collide: true, seg: 20 });
      break;
    case 'arch':
      emitArch(o, em, size, mat);
      break;
    case 'building':
      emitBuilding(o, em, size, mat, rng);
      break;
    case 'prop': {
      const pf = PREFABS[o.prop];
      if (pf) pf.build(em, o, rng);
      break;
    }
    default: break;
  }
}

function emitArch(o, em, size, mat) {
  const [W, H, T] = size;
  const ow = Math.min(W - 0.4, (o.open && o.open[0]) || 3), oh = Math.min(H - 0.3, (o.open && o.open[1]) || 3.4);
  const r = ow / 2, spring = oh - r;
  const side = (W - ow) / 2;
  // pillars
  em.box(mat, [-(ow / 2 + side / 2), H / 2, 0], [side, H, T], { collide: true });
  em.box(mat, [(ow / 2 + side / 2), H / 2, 0], [side, H, T], { collide: true });
  // lintel above apex
  const lintel0 = oh + 0.25;
  if (H > lintel0) em.box(mat, [0, (lintel0 + H) / 2, 0], [ow, H - lintel0, T], { collide: true });
  // spandrels (curved part) via extrude
  const shape = new THREE.Shape();
  shape.moveTo(-r, spring);
  shape.lineTo(-r, lintel0);
  shape.lineTo(r, lintel0);
  shape.lineTo(r, spring);
  shape.absarc(0, spring, r, 0, Math.PI, false);
  const g = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 20 });
  g.translate(0, 0, -T / 2);
  em.geo(mat, g, new THREE.Matrix4());
  g.dispose();
  // stepped colliders approximating the arch curve
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const y0 = spring + (r * i) / steps, y1 = lintel0;
    const halfOpen = Math.sqrt(Math.max(0, r * r - (y0 + r / steps - spring) ** 2));
    const wSide = r - halfOpen;
    if (wSide < 0.02) continue;
    em.collider('box', [-(r - wSide / 2), (y0 + y1) / 2, 0], [wSide, y1 - y0, T], 0, mat);
    em.collider('box', [(r - wSide / 2), (y0 + y1) / 2, 0], [wSide, y1 - y0, T], 0, mat);
  }
  // keystone/trim strip
  if (o.trim) em.box(o.trim, [0, H + 0.12, 0], [W + 0.2, 0.24, T + 0.2], {});
}

function emitBuilding(o, em, size, mat, rngBase) {
  const [W, H, D] = size;
  const trim = o.trim || 'sandstone';
  const rng = mulberry(o.seed || 1);
  // adobe/plaster buildings get soft rounded corners, stone ones sharp corners with quoins
  const isStone = mat.startsWith('sandstone');
  const round = o.round ?? (isStone ? 0 : 0.35);
  if (round > 0) {
    em.roundBox(mat, [0, H / 2, 0], [W, H, D], round, { collide: true, top: false });
    em.roundBox(trim, [0, 0.35, 0], [W + 0.12, 0.7, D + 0.12], round + 0.06, { top: true });
  } else {
    em.box(mat, [0, H / 2, 0], [W, H, D], { collide: true });
    em.box(trim, [0, 0.35, 0], [W + 0.12, 0.7, D + 0.12], {});
  }
  // string course between floors
  const floors = Math.max(1, Math.floor((H - 0.5) / 3.1));
  if (floors > 1 && rng() < 0.8) {
    for (let f = 1; f < floors; f++) {
      if (round > 0) em.roundBox(trim, [0, f * 3.1, 0], [W + 0.1, 0.16, D + 0.1], round + 0.05, { top: true });
      else em.box(trim, [0, f * 3.1, 0], [W + 0.1, 0.16, D + 0.1], {});
    }
  }
  // corner quoins on sharp-cornered buildings
  if (round <= 0 && (o.quoins ?? rng() < 0.7)) {
    const qm = mat === 'sandstone' ? 'sandstone_white' : 'sandstone';
    for (let y = 0.7, k = 0; y < H - 0.3; y += 0.36, k++) {
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const long = (k + (sx * sz > 0 ? 0 : 1)) % 2 === 0;
        const wx = long ? 0.62 : 0.34, wz = long ? 0.34 : 0.62;
        em.box(qm, [sx * (W / 2 - wx / 2 + 0.03), y + 0.17, sz * (D / 2 - wz / 2 + 0.03)], [wx, 0.33, wz], { cell: 1 });
      }
    }
  }
  // parapet
  if (o.parapet !== false) {
    const t = 0.3, ph = 0.6;
    if (round > 0) em.roundRing(trim, [0, H + ph / 2, 0], [W + 0.12, ph, D + 0.12], round + 0.06, t, {});
    else {
      em.box(trim, [0, H + ph / 2, D / 2 - t / 2 + 0.06], [W + 0.12, ph, t], {});
      em.box(trim, [0, H + ph / 2, -D / 2 + t / 2 - 0.06], [W + 0.12, ph, t], {});
      em.box(trim, [W / 2 - t / 2 + 0.06, H + ph / 2, 0], [t, ph, D - 2 * t + 0.12], {});
      em.box(trim, [-W / 2 + t / 2 - 0.06, H + ph / 2, 0], [t, ph, D - 2 * t + 0.12], {});
    }
    em.box('concrete', [0, H + 0.03, 0], [W - 0.3, 0.06, D - 0.3], {});
    // kasbah-style merlons
    if (o.merlons ?? rng() < 0.55) {
      const step = 1.1, mh = 0.42;
      for (const [len, along, fixed] of [[W, 'x', D / 2], [W, 'x', -D / 2], [D, 'z', W / 2], [D, 'z', -W / 2]]) {
        const n = Math.floor((len - 2 * Math.max(round, 0.4)) / step);
        for (let i = 0; i < n; i++) {
          const a = -((n - 1) * step) / 2 + i * step;
          const pos = along === 'x' ? [a, H + ph + mh / 2, fixed + Math.sign(fixed) * (0.06 - t / 2)] : [fixed + Math.sign(fixed) * (0.06 - t / 2), H + ph + mh / 2, a];
          const sz = along === 'x' ? [0.5, mh, t] : [t, mh, 0.5];
          em.box(trim, pos, sz, { cell: 1 });
        }
      }
    }
  }
  // faces: decorate along each side
  const sides = [
    { n: [0, 0, 1], len: W, off: D / 2 }, { n: [0, 0, -1], len: W, off: D / 2 },
    { n: [1, 0, 0], len: D, off: W / 2 }, { n: [-1, 0, 0], len: D, off: W / 2 },
  ];
  let doorPlaced = !o.door;
  sides.forEach((sd, si) => {
    const yawFace = Math.atan2(sd.n[0], sd.n[2]) / DEG; // local yaw so +z faces outward
    const usable = sd.len - 2 * Math.max(round, 0.5);
    const count = Math.floor(usable / 3.2);
    if (count < 1) return;
    const spacing = usable / count;
    for (let f = 0; f < floors; f++) {
      for (let k = 0; k < count; k++) {
        const along = -usable / 2 + spacing * (k + 0.5);
        const y = f * 3.1 + (f === 0 ? 1.5 : 1.7);
        const r = rng();
        const local = sideToLocal(sd, along, sd.off);
        if (!doorPlaced && f === 0 && si === (o.doorSide ?? 0) && k === Math.floor(count / 2)) {
          PREFABS.door.buildAt(em, local, yawFace, rng);
          doorPlaced = true; continue;
        }
        if (r < (o.windows ?? 0.6) && y + 1.2 < H) PREFABS.window.buildAt(em, [local[0], y, local[2]], yawFace, rng, f === 0);
      }
    }
    // wooden roof beams (vigas)
    if (o.beams !== false && (si === 0 || si === 2 || rng() < 0.4)) {
      const nb = Math.floor(usable / 1.1);
      for (let k = 0; k < nb; k++) {
        const along = -usable / 2 + (usable / nb) * (k + 0.5);
        const local = sideToLocal(sd, along, sd.off + 0.3);
        em.geo('wood', BEAM_GEO, Emitter.mat([local[0], H - 0.45, local[2]], [90, yawFace, 0]), { noCast: false });
      }
    }
    // wall clutter: electric box between two window bays
    if (rng() < 0.3 && count >= 2 && hasModel('utility_box')) {
      const k = Math.floor(rng() * (count - 1));
      const local = sideToLocal(sd, -usable / 2 + spacing * (k + 1), sd.off + 0.22);
      em.model('utility_box', Emitter.mat([local[0], 0.0, local[2]], [0, yawFace, 0]));
      em.collider('box', [local[0], 0.56, local[2]], [0.52, 1.12, 0.43], yawFace, 'metal');
    }
  });
}
const BEAM_GEO = new THREE.CylinderGeometry(0.085, 0.095, 0.6, 7, 1);

function sideToLocal(sd, along, off) {
  // returns local xz position on the face of a building
  if (sd.n[2] !== 0) return [along * sd.n[2], 0, sd.n[2] * off];
  return [sd.n[0] * off, 0, -along * sd.n[0]];
}

export function mulberry(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// --------------------------------------------------------------------------
// AO baking
// --------------------------------------------------------------------------
function hemisphereDirs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, phi = i * 2.399963229728653;
    const r = Math.sqrt(u), z = Math.sqrt(1 - u);
    out.push([r * Math.cos(phi), r * Math.sin(phi), z]);
  }
  return out;
}

const SKY_R = 9;
async function bakeAO(sink, col, opts, onProgress) {
  const R = opts.radius || 2.4;
  const dirs = hemisphereDirs(opts.rays || 16);
  const listCache = new Map();
  const getList = (x, z) => {
    const k = (Math.floor(x) + 4096) * 8192 + (Math.floor(z) + 4096);
    let l = listCache.get(k);
    if (!l) { const fx = Math.floor(x), fz = Math.floor(z); l = col.query(fx - R, fz - R, fx + 1 + R, fz + 1 + R, []).filter((c) => c.solid); listCache.set(k, l); }
    return l;
  };
  let total = 0; for (const b of sink.buckets.values()) total += b.count;
  let done = 0, lastYield = performance.now();
  const t = new THREE.Vector3(), bt = new THREE.Vector3(), n = new THREE.Vector3();
  for (const b of sink.buckets.values()) {
    const ao = new Float32Array(b.count * 2);
    b.ao = ao;
    for (let i = 0; i < b.count; i++) {
      if (b.noAO[i]) { ao[i * 2] = 1; ao[i * 2 + 1] = 1; continue; }
      const px = b.pos[i * 3], py = b.pos[i * 3 + 1], pz = b.pos[i * 3 + 2];
      n.set(b.nor[i * 3], b.nor[i * 3 + 1], b.nor[i * 3 + 2]);
      if (Math.abs(n.y) < 0.9) t.set(0, 1, 0).cross(n).normalize(); else t.set(1, 0, 0).cross(n).normalize();
      bt.crossVectors(n, t);
      const ox = px + n.x * 0.04, oy = py + n.y * 0.04, oz = pz + n.z * 0.04;
      const list = getList(px, pz);
      let occ = 0, skyRays = 0, skyHit = 0;
      for (let d = 0; d < dirs.length; d++) {
        const D = dirs[d];
        const dx = t.x * D[0] + bt.x * D[1] + n.x * D[2];
        const dy = t.y * D[0] + bt.y * D[1] + n.y * D[2];
        const dz = t.z * D[0] + bt.z * D[1] + n.z * D[2];
        // contact occlusion (short rays) + sky occlusion (long upward rays, catches roofs/overhangs)
        const longRay = dy > 0.3;
        let tm = longRay ? SKY_R : R;
        if (dy < -1e-4 && oy > 0.001) { const tg = -oy / dy; if (tg < tm) tm = tg; }
        for (let c = 0; c < list.length; c++) {
          const tt = col.rayCollider(list[c], ox, oy, oz, dx, dy, dz, tm, null);
          if (tt < tm) tm = tt;
        }
        if (tm < R) { const k = 1 - tm / R; occ += k * k * 0.6 + k * 0.4; }
        if (longRay) { skyRays++; if (tm < SKY_R) skyHit++; }
      }
      const a = 1 - (occ / dirs.length) * 1.35;
      ao[i * 2] = Math.max(0.12, Math.min(1, a));
      ao[i * 2 + 1] = skyRays ? 1 - skyHit / skyRays : (n.y < -0.5 ? 0.2 : 1);
      done++;
      if ((done & 1023) === 0 && performance.now() - lastYield > 40) {
        onProgress && onProgress(done / total);
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
  }
}

// --------------------------------------------------------------------------
// Ground + distant scenery
// --------------------------------------------------------------------------
function emitGround(sink, map, cell) {
  const [minX, minZ, maxX, maxZ] = map.bounds;
  const pad = 6;
  const x0 = minX - pad, z0 = minZ - pad, x1 = maxX + pad, z1 = maxZ + pad;
  const gm = map.ground || 'sand';
  // inner subdivided ground (receives AO), in 16m tiles
  const TS = 16, gc = Math.max(cell, 0.5);
  for (let tx = x0; tx < x1 - 1e-3; tx += TS) {
    for (let tz = z0; tz < z1 - 1e-3; tz += TS) {
      const w = Math.min(TS, x1 - tx), d = Math.min(TS, z1 - tz);
      sink.grid(gm, new THREE.Vector3(tx, 0, tz + d), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), w, d, gc, { noCast: true });
    }
  }
  // far ground ring (4 big quads around): [x, z, w, d]
  const F = 600;
  const qs = [[-F, z1, 2 * F, F - z1], [-F, -F, 2 * F, z0 + F], [-F, z0, x0 + F, z1 - z0], [x1, z0, F - x1, z1 - z0]];
  for (const [qx, qz, w, d] of qs) {
    sink.grid(gm, new THREE.Vector3(qx, 0, qz + d), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), w, d, 200, { noAO: true, noCast: true });
  }
}

function emitDunes(sink, map) {
  const [minX, minZ, maxX, maxZ] = map.bounds;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const r0 = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 6, r1 = 380;
  const segA = 96, segR = 20;
  const rng = mulberry(77);
  const geo = new THREE.BufferGeometry();
  const pos = [], idx = [];
  const ph = [rng() * 6, rng() * 6, rng() * 6];
  for (let j = 0; j <= segR; j++) {
    const tr = j / segR;
    const r = r0 + (r1 - r0) * Math.pow(tr, 1.6);
    for (let i = 0; i <= segA; i++) {
      const a = (i / segA) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const ridge = Math.sin(a * 5 + ph[0]) * 0.5 + Math.sin(a * 11 + ph[1]) * 0.3 + Math.sin(a * 23 + ph[2] + tr * 4) * 0.2;
      let h = Math.pow(Math.sin(Math.min(1, tr * 1.6) * Math.PI * 0.5), 1.5) * (14 + ridge * 10) * (tr > 0.75 ? 1 - (tr - 0.75) * 2.2 : 1);
      if (tr < 0.06) h *= tr / 0.06;
      pos.push(x, Math.max(0, h) - 0.05, z);
    }
  }
  for (let j = 0; j < segR; j++) for (let i = 0; i < segA; i++) {
    const a = j * (segA + 1) + i, b = a + 1, c = a + segA + 2, d = a + segA + 1;
    idx.push(a, c, b, a, d, c);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  sink.geometry(map.ground || 'sand', geo, new THREE.Matrix4(), { noAO: true, noCast: true, tile: 8 });
  geo.dispose();
}

// --------------------------------------------------------------------------
// Public: build
// --------------------------------------------------------------------------
export async function buildMap(map, opts = {}) {
  const t0 = performance.now();
  const progress = opts.onProgress || (() => {});
  const col = new CollisionWorld();
  const [minX, minZ, maxX, maxZ] = map.bounds;
  col.bounds = { minX, minZ, maxX, maxZ };
  col.groundMat = map.ground || 'sand';
  const cell = opts.fast ? 50 : (opts.aoCell || 0.5);
  const sink = new GeoSink({ cell, collision: col });
  const em = new Emitter(sink, col);
  const rng = mulberry(map.seed || 1);
  const spawns = [];

  for (const o of map.objects) {
    if (o.type === 'spawn') { spawns.push({ team: o.team || 0, pos: new THREE.Vector3(...o.pos), yaw: (o.rot || 0) * DEG }); continue; }
    try { emitObject(o, em, rng); } catch (e) { console.warn('bad object', o, e); }
  }
  // invisible boundary walls
  const bh = 30;
  col.add({ type: 'box', pos: [(minX + maxX) / 2, bh / 2, minZ - 0.5], size: [maxX - minX + 2, bh, 1] });
  col.add({ type: 'box', pos: [(minX + maxX) / 2, bh / 2, maxZ + 0.5], size: [maxX - minX + 2, bh, 1] });
  col.add({ type: 'box', pos: [minX - 0.5, bh / 2, (minZ + maxZ) / 2], size: [1, bh, maxZ - minZ + 2] });
  col.add({ type: 'box', pos: [maxX + 0.5, bh / 2, (minZ + maxZ) / 2], size: [1, bh, maxZ - minZ + 2] });

  emitGround(sink, map, opts.fast ? 50 : cell);
  if (!opts.noDunes) emitDunes(sink, map);
  progress(0.15, 'Geometry');

  if (!opts.fast) {
    await bakeAO(sink, col, { rays: opts.aoRays || 16, radius: 2.4 }, (f) => progress(0.15 + f * 0.7, 'Baking light'));
  } else {
    for (const b of sink.buckets.values()) b.ao = new Float32Array(b.count * 2).fill(1);
  }
  progress(0.85, 'Materials');

  // merge into meshes
  const group = new THREE.Group(); group.name = 'map';
  const meshes = [];
  for (const b of sink.buckets.values()) {
    if (!b.count) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('ao', new THREE.Float32BufferAttribute(b.ao, 2));
    g.setIndex(b.count > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = await getMaterial(b.mat);
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.userData.mat = b.mat;
    group.add(mesh); meshes.push(mesh);
  }
  // shadow caster proxy: low poly, writes nothing in the main pass (colorWrite
  // and depthWrite off) but is what the shadow map renders.
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(sink.caster.pos, 3));
  cg.setIndex(sink.caster.count > 65535 ? new THREE.Uint32BufferAttribute(sink.caster.idx, 1) : new THREE.Uint16BufferAttribute(sink.caster.idx, 1));
  cg.computeBoundingSphere();
  const caster = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false }));
  caster.castShadow = true; caster.receiveShadow = false; caster.matrixAutoUpdate = false; caster.renderOrder = 999;
  // skip the draw in the main pass (onBeforeRender is not called for shadow passes)
  caster.onBeforeRender = () => { cg.drawRange.count = 0; };
  caster.onAfterRender = () => { cg.drawRange.count = Infinity; };
  group.add(caster);

  let tris = 0; meshes.forEach((m) => { tris += m.geometry.index.count / 3; });
  progress(1, 'Done');
  return {
    group, collision: col, spawns, meshes, caster, models: sink.models,
    stats: { ms: Math.round(performance.now() - t0), tris, meshes: meshes.length, colliders: col.colliders.length },
    dispose() { meshes.forEach((m) => m.geometry.dispose()); cg.dispose(); caster.material.dispose(); },
  };
}

// special non-library materials used by prefabs
const special = new Map();
async function getMaterial(id) {
  if (!id.startsWith('fx:')) return materials.mapMaterial(id);
  if (special.has(id)) return special.get(id);
  let m;
  if (id === 'fx:leaf') {
    m = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
    m.map.colorSpace = THREE.SRGBColorSpace;
  } else if (id === 'fx:glow') {
    m = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 3.5, roughness: 0.4 });
  } else if (id === 'fx:glass') {
    m = new THREE.MeshStandardMaterial({ color: 0x1b2730, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.4 });
  } else if (id === 'fx:wire') {
    m = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  } else {
    m = new THREE.MeshStandardMaterial({ color: 0xff00ff });
  }
  // fx materials still receive the ao attribute
  patchBakedAO(m);
  special.set(id, m);
  return m;
}

function leafTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 128, 512);
  const rng = mulberry(5);
  // rachis
  x.strokeStyle = '#6d6a2c'; x.lineWidth = 5; x.beginPath(); x.moveTo(64, 512); x.lineTo(64, 0); x.stroke();
  for (let y = 500; y > 6; y -= 7) {
    const t = 1 - y / 512;
    const len = 58 * Math.sin(Math.min(1, (1 - t) * 1.25) * Math.PI * 0.95) + 4;
    for (const s of [-1, 1]) {
      const g = 90 + rng() * 50, r = 40 + rng() * 30;
      x.strokeStyle = `rgb(${r},${g},${30 + rng() * 20})`;
      x.lineWidth = 3.2;
      x.beginPath(); x.moveTo(64, y);
      x.quadraticCurveTo(64 + s * len * 0.5, y - 8, 64 + s * len, y - 22 - rng() * 6);
      x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

// Turns a parsed Grid into merged, chunked meshes: floors, walls with tile/paint split, trims,
// door lintels, windows, exterior facades, blended terrain, fences, trees and sky.
import * as THREE from '../../lib/three.module.js';
import { mergeGeometries } from '../../lib/BufferGeometryUtils.js';
import { T, OUTDOOR } from './grid.js';
import { THEMES } from './themes.js';
import { noise2, fbm3, mulberry32, clamp } from '../util.js';

const CHUNK = 16;
const DOOR_H = 2.15;

class Acc {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.w = null; }
  quad(a, b, c, d, n, ua, ub, uc, ud, ca = 1, cb = 1, cc = 1, cd = 1, w) {
    const base = this.p.length / 3;
    this.p.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) this.n.push(n[0], n[1], n[2]);
    this.u.push(...ua, ...ub, ...uc, ...ud);
    for (const v of [ca, cb, cc, cd]) this.c.push(v, v, v);
    if (w) { if (!this.w) this.w = []; this.w.push(...w); }
    // orientation check: (b-a)x(c-a) should point along n
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  geometry() {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.w) g.setAttribute('aW', new THREE.Float32BufferAttribute(this.w, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Box helper writing 5 visible faces (no bottom) into an accumulator.
function accBox(acc, x0, y0, z0, x1, y1, z1, tile = 1, shade = 1) {
  const u = (a, b) => [a / tile, b / tile];
  acc.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], u(x0, z0), u(x1, z0), u(x1, z1), u(x0, z1), shade, shade, shade, shade);
  acc.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], u(x0, y0), u(x1, y0), u(x1, y1), u(x0, y1), shade, shade, shade, shade);
  acc.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], u(x1, y0), u(x0, y0), u(x0, y1), u(x1, y1), shade, shade, shade, shade);
  acc.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], u(z1, y0), u(z0, y0), u(z0, y1), u(z1, y1), shade, shade, shade, shade);
  acc.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], u(z0, y0), u(z1, y0), u(z1, y1), u(z0, y1), shade, shade, shade, shade);
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class LevelBuilder {
  constructor(level, assets) {
    this.level = level;
    this.grid = level.grid;
    this.def = level.def;
    this.assets = assets;
    this.buckets = new Map(); // chunkKey|matKey -> {acc, matKey}
    this.matDefs = new Map();
    this.rng = mulberry32(level.seed || 1);
  }

  themeAt(x, z) {
    const g = this.grid;
    const idx = g.theme[g.idx(x, z)];
    const name = (this.def.themes || ['corridor'])[idx] || this.def.themes?.[0] || 'corridor';
    return THEMES[name] || THEMES.corridor;
  }

  acc(cx, cz, spec, layer = 'wall') {
    // spec: [texSet, tile, tint] or {key, make}
    const matKey = Array.isArray(spec) ? spec.join('|') : spec.key;
    const ck = Math.floor(cx / CHUNK) + ',' + Math.floor(cz / CHUNK);
    const k = ck + '#' + matKey + '#' + layer;
    if (!this.buckets.has(k)) {
      this.buckets.set(k, { acc: new Acc(), matKey, layer });
      if (!this.matDefs.has(matKey)) this.matDefs.set(matKey, spec);
    }
    return this.buckets.get(k).acc;
  }

  material(spec) {
    if (!Array.isArray(spec)) return spec.make();
    const [set, , tint, extra] = spec;
    return this.assets.mat(set, Object.assign({ color: tint ?? 0xffffff, vertexColors: true }, extra || {}));
  }

  build() {
    const g = this.grid;
    const root = new THREE.Group();
    root.name = 'levelGeometry';
    this.root = root;
    const hasOutdoor = this.def.env === 'outdoor';
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) {
      const t = g.get(x, z);
      if (t === T.FLOOR || t === T.WATER || t === T.DOOR) this.floorCell(x, z, t);
      if (OUTDOOR.has(t)) this.groundCell(x, z, t);
      if (t === T.WALL || t === T.EXT || t === T.WINDOW) this.wallCell(x, z, t);
      if (t === T.DOOR) this.doorCell(x, z);
    }
    if (hasOutdoor) this.addOutdoorExtras();
    this.addWater();
    // finalize buckets into meshes
    for (const { acc, matKey, layer } of this.buckets.values()) {
      const geo = acc.geometry();
      if (!geo) continue;
      const mat = this.material(this.matDefs.get(matKey));
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.castShadow = layer === 'wall';
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      root.add(m);
    }
    return root;
  }

  // ---------- floors & ceilings ----------
  floorAO(gx, gz) {
    // grid point shared by 4 cells
    const g = this.grid;
    let walls = 0;
    for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const t = g.get(gx + dx, gz + dz);
      if (t === T.WALL || t === T.EXT || t === T.WINDOW || t === T.VOID) walls++;
    }
    const n = 0.86 + 0.14 * noise2(gx * 0.31, gz * 0.31);
    return (walls ? 0.58 : 1) * n;
  }

  floorCell(x, z, t) {
    const th = this.themeAt(x, z);
    const [set, tile, tint] = th.floor;
    const a = this.acc(x, z, [set, tile, tint, { normalScale: 1 }], 'flat');
    const uv = (px, pz) => [px / tile, -pz / tile];
    const c = (gx, gz) => this.floorAO(gx, gz);
    a.quad([x, 0, z], [x, 0, z + 1], [x + 1, 0, z + 1], [x + 1, 0, z], [0, 1, 0], uv(x, z), uv(x, z + 1), uv(x + 1, z + 1), uv(x + 1, z), c(x, z), c(x, z + 1), c(x + 1, z + 1), c(x + 1, z));
    // ceiling
    const [cs, ct, ctint] = th.ceil;
    const h = th.h;
    const ca = this.acc(x, z, [cs, ct, ctint], 'flat');
    const cu = (px, pz) => [px / ct, pz / ct];
    const cc = (gx, gz) => this.floorAO(gx, gz) * 0.85;
    ca.quad([x, h, z], [x + 1, h, z], [x + 1, h, z + 1], [x, h, z + 1], [0, -1, 0], cu(x, z), cu(x + 1, z), cu(x + 1, z + 1), cu(x, z + 1), cc(x, z), cc(x + 1, z), cc(x + 1, z + 1), cc(x, z + 1));
    // missing ceiling tiles & hanging debris in old corridors
    if (th.ceil[0] === 'polystyrene' && this.rng() < 0.06) {
      const hole = this.acc(x, z, ['concrete_wall_006', 2, 0x111111], 'flat');
      const x0 = x + 0.2, x1 = x + 0.8, z0 = z + 0.2, z1 = z + 0.8;
      hole.quad([x0, h - 0.004, z0], [x1, h - 0.004, z0], [x1, h - 0.004, z1], [x0, h - 0.004, z1], [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1], 0.1, 0.1, 0.1, 0.1);
    }
  }

  // ---------- walls ----------
  wallCell(x, z, t) {
    const g = this.grid;
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d];
      const nt = g.get(x + dx, z + dz);
      if (nt === T.WALL || nt === T.EXT || nt === T.WINDOW || nt === T.VOID) continue;
      const outdoor = OUTDOOR.has(nt);
      if (outdoor) this.facadeFace(x, z, dx, dz, t);
      else this.interiorFace(x, z, dx, dz, t, nt);
    }
  }

  // Face geometry helper: returns the four corners for a face of cell (x,z) toward (dx,dz) between y0..y1.
  facePts(x, z, dx, dz, y0, y1, inset = 0) {
    // plane position
    let a, b;
    if (dx === 1) { const px = x + 1 + inset; a = [px, z + 1]; b = [px, z]; }
    else if (dx === -1) { const px = x - inset; a = [px, z]; b = [px, z + 1]; }
    else if (dz === 1) { const pz = z + 1 + inset; a = [x, pz]; b = [x + 1, pz]; }
    else { const pz = z - inset; a = [x + 1, pz]; b = [x, pz]; }
    return [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]];
  }

  cornerShade(x, z, dx, dz) {
    // inner-corner darkening at both ends of the face
    const g = this.grid;
    const isW = (t) => t === T.WALL || t === T.EXT || t === T.WINDOW || t === T.VOID;
    // tangent directions
    const tx = dz, tz = -dx; // perpendicular
    const endA = isW(g.get(x + dx + tx, z + dz + tz)) ? 0.62 : 1;
    const endB = isW(g.get(x + dx - tx, z + dz - tz)) ? 0.62 : 1;
    return [endA, endB];
  }

  interiorFace(x, z, dx, dz, t, nt) {
    const fx = x + dx, fz = z + dz;
    const th = this.themeAt(fx, fz);
    const H = th.h;
    const split = th.split;
    const [lowSet, lowTile, lowTint] = th.low;
    const [hiSet, hiTile, hiTint] = th.high;
    const n = [dx, 0, dz];
    const pts = this.facePts(x, z, dx, dz, 0, split);
    const along = (p) => (dx !== 0 ? p[2] : p[0]);
    let [ea, eb] = this.cornerShade(x, z, dx, dz);
    // which end is which: facePts a/b ordering vs tangent; just compute per vertex via neighbour test
    const shadeAt = (p) => {
      const g = this.grid;
      const isW = (tt) => tt === T.WALL || tt === T.EXT || tt === T.WINDOW || tt === T.VOID;
      const px = p[0], pz = p[2];
      // the floor cell side neighbours
      let s = 1;
      if (dx !== 0) { const zz = Math.round(pz) === fz ? fz - 1 : fz + 1; if (isW(g.get(fx, zz))) s = 0.62; }
      else { const xx = Math.round(px) === fx ? fx - 1 : fx + 1; if (isW(g.get(xx, fz))) s = 0.62; }
      return s * (0.88 + 0.12 * noise2(px * 0.4, pz * 0.4));
    };
    const s0 = shadeAt(pts[0]), s1 = shadeAt(pts[1]);
    const uvL = (p) => [along(p) / lowTile * (dx + dz > 0 ? 1 : -1), p[1] / lowTile];
    const low = this.acc(x, z, [lowSet, lowTile, lowTint]);
    low.quad(pts[0], pts[1], pts[2], pts[3], n, uvL(pts[0]), uvL(pts[1]), uvL(pts[2]), uvL(pts[3]), s0 * 0.5, s1 * 0.5, s1, s0);
    const p2 = this.facePts(x, z, dx, dz, split, H);
    const uvH = (p) => [along(p) / hiTile * (dx + dz > 0 ? 1 : -1), p[1] / hiTile];
    const hi = this.acc(x, z, [hiSet, hiTile, hiTint]);
    hi.quad(p2[0], p2[1], p2[2], p2[3], n, uvH(p2[0]), uvH(p2[1]), uvH(p2[2]), uvH(p2[3]), s0, s1, s1 * 0.72, s0 * 0.72);
    if (t === T.WINDOW) this.windowOverlay(x, z, dx, dz, th, false);
    // trims
    if (th.trim && nt !== T.DOOR) {
      const tr = this.acc(x, z, [th.trim[0], th.trim[1], th.trim[2]]);
      this.strip(tr, x, z, dx, dz, 0, 0.13, 0.018, s0, s1);
      this.strip(tr, x, z, dx, dz, split - 0.035, split + 0.035, 0.022, s0, s1);
    }
  }

  strip(acc, x, z, dx, dz, y0, y1, depth, s0 = 1, s1 = 1) {
    const f = this.facePts(x, z, dx, dz, y0, y1, depth);
    const n = [dx, 0, dz];
    const along = (p) => (dx !== 0 ? p[2] : p[0]);
    acc.quad(f[0], f[1], f[2], f[3], n, [along(f[0]), y0 * 4], [along(f[1]), y0 * 4], [along(f[2]), y1 * 4], [along(f[3]), y1 * 4], s0 * 0.8, s1 * 0.8, s1, s0);
    const b = this.facePts(x, z, dx, dz, y1, y1, 0);
    acc.quad(b[0], b[1], f[2], f[3], [0, 1, 0], [along(b[0]), 0], [along(b[1]), 0], [along(f[2]), depth * 4], [along(f[3]), depth * 4], s0, s1, s1, s0);
    if (y0 > 0.01) {
      const bb = this.facePts(x, z, dx, dz, y0, y0, 0);
      acc.quad(f[0], f[1], bb[1], bb[0], [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1], s0 * 0.6, s1 * 0.6, s1 * 0.6, s0 * 0.6);
    }
  }

  windowOverlay(x, z, dx, dz, th, exterior, level = 0) {
    // boarded window: dark recess quad + frame + planks
    const y0 = exterior ? 1.1 + level * 3 : 1.0, y1 = exterior ? 2.6 + level * 3 : 2.35;
    const n = [dx, 0, dz];
    const inset = 0.004;
    const along0 = 0.18, along1 = 0.82;
    const sub = (pts, a0, a1) => {
      // shrink face horizontally to [a0,a1]
      const L = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1], p[2] + (q[2] - p[2]) * t];
      return [L(pts[0], pts[1], a0), L(pts[0], pts[1], a1), L(pts[3], pts[2], a1), L(pts[3], pts[2], a0)];
    };
    const glass = this.acc(x, z, { key: exterior ? 'glassExt' : 'glassInt', make: () => this.glassMat(exterior) }, 'flat');
    const q = sub(this.facePts(x, z, dx, dz, y0, y1, inset), along0, along1);
    const lit = exterior && level > 0 && this.rng() < 0.08;
    const v = lit ? 2.0 : 0.35 + this.rng() * 0.3;
    glass.quad(q[0], q[1], q[2], q[3], n, [0, 0], [1, 0], [1, 1], [0, 1], v, v, v, v);
    // frame
    const fr = this.acc(x, z, ['wood_peeling_paint_weathered', 0.8, exterior ? 0x8a8a80 : 0x5a5f58]);
    const fp = (a0, a1, yy0, yy1, d) => sub(this.facePts(x, z, dx, dz, yy0, yy1, d), a0, a1);
    const frameQuad = (a0, a1, yy0, yy1) => { const f = fp(a0, a1, yy0, yy1, 0.035); fr.quad(f[0], f[1], f[2], f[3], n, [a0, yy0], [a1, yy0], [a1, yy1], [a0, yy1]); };
    frameQuad(along0 - 0.05, along0, y0 - 0.05, y1 + 0.05);
    frameQuad(along1, along1 + 0.05, y0 - 0.05, y1 + 0.05);
    frameQuad(along0, along1, y1, y1 + 0.05);
    frameQuad(along0 - 0.08, along1 + 0.08, y0 - 0.07, y0);
    frameQuad(along0, along1, (y0 + y1) / 2 - 0.02, (y0 + y1) / 2 + 0.02);
    frameQuad(0.49, 0.51, y0, y1);
    // planks nailed across (ground floor / interior)
    if (!exterior || level === 0) {
      const pl = this.acc(x, z, ['wood_peeling_paint_weathered', 1.2, 0x8b7a66]);
      const nP = 3 + ((this.rng() * 2) | 0);
      for (let i = 0; i < nP; i++) {
        const yc = y0 + (i + 0.5) * (y1 - y0) / nP + (this.rng() - 0.5) * 0.1;
        const tilt = (this.rng() - 0.5) * 0.18;
        const f = sub(this.facePts(x, z, dx, dz, yc - 0.08, yc + 0.08, 0.06 + i * 0.004), along0 - 0.1, along1 + 0.1);
        f[0][1] -= tilt; f[3][1] -= tilt; f[1][1] += tilt; f[2][1] += tilt;
        pl.quad(f[0], f[1], f[2], f[3], n, [0, i * 0.3], [1.2, i * 0.3], [1.2, i * 0.3 + 0.13], [0, i * 0.3 + 0.13], 0.9, 0.9, 1, 1);
      }
    }
  }

  glassMat(exterior) {
    if (exterior) {
      return new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.08, metalness: 0.0, envMapIntensity: 1.2, vertexColors: true, emissive: 0x2a1c0c, emissiveIntensity: 0.0,
        onBeforeCompile: undefined });
    }
    return new THREE.MeshStandardMaterial({ color: 0x0b0f16, roughness: 0.3, emissive: 0x1a2a40, emissiveIntensity: 0.35, vertexColors: true });
  }

  facadeFace(x, z, dx, dz, t) {
    const H = this.def.extH ?? 9;
    const n = [dx, 0, dz];
    const pts = this.facePts(x, z, dx, dz, 0, H);
    const along = (p) => (dx !== 0 ? p[2] : p[0]);
    const tile = 2.2;
    const uv = (p) => [along(p) / tile * (dx + dz > 0 ? 1 : -1), p[1] / tile];
    const shade = 0.85 + 0.15 * noise2(x * 0.3, z * 0.3);
    const br = this.acc(x, z, ['red_bricks_04', tile, 0xa08a80]);
    br.quad(pts[0], pts[1], pts[2], pts[3], n, uv(pts[0]), uv(pts[1]), uv(pts[2]), uv(pts[3]), shade * 0.45, shade * 0.45, shade, shade);
    // concrete plinth, string courses and cornice
    const cc = this.acc(x, z, ['concrete_wall_006', 2.0, 0x8c8a84]);
    this.strip(cc, x, z, dx, dz, 0, 0.7, 0.06, 0.6, 0.6);
    for (let lv = 1; lv < Math.floor(H / 3); lv++) this.strip(cc, x, z, dx, dz, lv * 3 - 0.12, lv * 3 + 0.12, 0.08);
    this.strip(cc, x, z, dx, dz, H - 0.45, H, 0.22);
    // window pattern along the run
    const k = dx !== 0 ? z : x;
    if (t === T.WINDOW || (k % 3 === 1 && this.def.facadeWindows !== false)) {
      for (let lv = 0; lv < Math.floor(H / 3); lv++) {
        if (lv === 0 && t !== T.WINDOW && this.rng() < 0.3) continue;
        this.windowOverlay(x, z, dx, dz, null, true, lv);
      }
    }
  }

  // ---------- doors ----------
  doorCell(x, z) {
    const g = this.grid;
    const sideX = (xx) => g.solidForMove(xx, z) || g.get(xx, z) === T.DOOR;
    const axis = sideX(x - 1) && sideX(x + 1) ? 'x' : 'z';
    const th = this.themeAt(x, z);
    const H = th.h;
    // lintel faces on both sides + soffit
    const sides = axis === 'x' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
    for (const [dx, dz] of sides) {
      const fx = x + dx, fz = z + dz;
      const ft = g.get(fx, fz);
      const outdoor = OUTDOOR.has(ft);
      const thS = outdoor ? null : this.themeAt(fx, fz);
      const Hs = outdoor ? (this.def.extH ?? 9) : thS.h;
      // face on the boundary between door cell and neighbour, facing the neighbour
      const pts = this.facePts(x, z, dx, dz, DOOR_H, Hs);
      const along = (p) => (dx !== 0 ? p[2] : p[0]);
      const spec = outdoor ? ['red_bricks_04', 2.2, 0xa08a80] : [thS.high[0], thS.high[1], thS.high[2]];
      const a = this.acc(x, z, spec);
      const tl = spec[1];
      const uv = (p) => [along(p) / tl, p[1] / tl];
      a.quad(pts[0], pts[1], pts[2], pts[3], [dx, 0, dz], uv(pts[0]), uv(pts[1]), uv(pts[2]), uv(pts[3]), 0.8, 0.8, 0.75, 0.75);
      // casing
      const cas = this.acc(x, z, ['wood_peeling_paint_weathered', 1, outdoor ? 0x4a4038 : 0x55605a]);
      const cp = (a0, a1, y0, y1) => {
        const f = this.facePts(x, z, dx, dz, y0, y1, 0.03);
        const L = (p, q, tt) => [p[0] + (q[0] - p[0]) * tt, p[1], p[2] + (q[2] - p[2]) * tt];
        const s = [L(f[0], f[1], a0), L(f[0], f[1], a1), L(f[3], f[2], a1), L(f[3], f[2], a0)];
        cas.quad(s[0], s[1], s[2], s[3], [dx, 0, dz], [a0, y0], [a1, y0], [a1, y1], [a0, y1], 0.8, 0.8, 0.9, 0.9);
      };
      cp(-0.06, 0.05, 0, DOOR_H + 0.08);
      cp(0.95, 1.06, 0, DOOR_H + 0.08);
      cp(-0.06, 1.06, DOOR_H - 0.02, DOOR_H + 0.1);
    }
    const so = this.acc(x, z, [th.high[0], th.high[1], th.high[2]]);
    so.quad([x, DOOR_H, z], [x + 1, DOOR_H, z], [x + 1, DOOR_H, z + 1], [x, DOOR_H, z + 1], [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1], 0.5, 0.5, 0.5, 0.5);
    this.level.doorAxis.set(g.idx(x, z), axis);
  }

  // ---------- outdoor ----------
  groundCell(x, z, t) {
    if (t === T.FENCE) { this.level.fenceCells.push([x, z]); }
    if (t === T.TREE) { this.level.treeCells.push([x, z]); }
    const a = this.acc(x, z, { key: 'terrain', make: () => this.terrainMat() }, 'flat');
    const S = 2;
    for (let iz = 0; iz < S; iz++) for (let ix = 0; ix < S; ix++) {
      const x0 = x + ix / S, x1 = x + (ix + 1) / S, z0 = z + iz / S, z1 = z + (iz + 1) / S;
      const P = (px, pz) => [px, this.groundH(px, pz), pz];
      const W = (px, pz) => this.groundW(px, pz);
      const uv = (px, pz) => [px, -pz];
      const w = [...W(x0, z0), ...W(x0, z1), ...W(x1, z1), ...W(x1, z0)];
      const sh = (px, pz) => 0.8 + 0.2 * noise2(px * 0.5, pz * 0.5);
      a.quad(P(x0, z0), P(x0, z1), P(x1, z1), P(x1, z0), [0, 1, 0], uv(x0, z0), uv(x0, z1), uv(x1, z1), uv(x1, z0), sh(x0, z0), sh(x0, z1), sh(x1, z1), sh(x1, z0), w);
    }
  }

  groundH(px, pz) {
    const g = this.grid;
    const t = g.get(Math.floor(px), Math.floor(pz));
    if (t === T.ROAD || t === T.PATH) return 0.0;
    return 0.035 * (noise2(px * 0.9, pz * 0.9) + 0.8);
  }

  groundW(px, pz) {
    const g = this.grid;
    let r = 0, gg = 0, b = 0, n = 0;
    // sample nearby cells with a little jitter so boundaries are organic
    for (let k = 0; k < 4; k++) {
      const jx = px + (k & 1 ? 0.45 : -0.45) + noise2(px * 1.3, pz * 1.3 + k) * 0.5;
      const jz = pz + (k & 2 ? 0.45 : -0.45) + noise2(px * 1.3 + 9, pz * 1.3 + k) * 0.5;
      const t = g.get(Math.floor(jx), Math.floor(jz));
      if (t === T.ROAD) b += 1;
      else if (t === T.PATH) { b += 0.55; gg += 0.45; }
      else if (t === T.GRASS || t === T.TREE) gg += 1;
      else r += 1;
      n++;
    }
    const mudNoise = clamp(noise2(px * 0.25, pz * 0.25) * 0.6, 0, 1);
    r = r / n; gg = gg / n; b = b / n;
    r += gg * mudNoise * 0.5; gg *= 1 - mudNoise * 0.5;
    const s = r + gg + b || 1;
    return [r / s, gg / s, b / s];
  }

  terrainMat() {
    const A = this.assets.tex;
    const mud = A.mud_forest || {}, grass = A.forest_ground_06 || {}, road = A.road_damaged || {};
    const m = new THREE.MeshStandardMaterial({ map: mud.map, normalMap: mud.nor, roughnessMap: mud.arm, aoMap: mud.arm, roughness: 1, vertexColors: true, envMapIntensity: 0.25 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tB = { value: grass.map }; sh.uniforms.tBn = { value: grass.nor }; sh.uniforms.tBr = { value: grass.arm };
      sh.uniforms.tC = { value: road.map }; sh.uniforms.tCn = { value: road.nor }; sh.uniforms.tCr = { value: road.arm };
      sh.uniforms.uWet = { value: this.def.rain ? 1 : 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aW; varying vec3 vW; varying vec2 vTUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvW = aW; vTUv = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform sampler2D tB, tBn, tBr, tC, tCn, tCr; uniform float uWet; varying vec3 vW; varying vec2 vTUv;
        vec3 blendW(float ha, float hb, float hc){
          vec3 w = vW + vec3(ha, hb, hc) * 0.35; float m = max(w.x, max(w.y, w.z)) - 0.18;
          w = max(w - m, 0.0); return w / (w.x + w.y + w.z + 1e-4); }`)
        .replace('#include <map_fragment>', `
          vec2 uvA = vTUv / 2.6, uvB = vTUv / 2.2, uvC = vTUv / 3.5;
          vec4 cA = texture2D(map, uvA), cB = texture2D(tB, uvB), cC = texture2D(tC, uvC);
          vec3 bw = blendW(dot(cA.rgb, vec3(0.33)), dot(cB.rgb, vec3(0.33)), dot(cC.rgb, vec3(0.33)));
          diffuseColor.rgb *= cA.rgb * bw.x + cB.rgb * bw.y + cC.rgb * bw.z;
          diffuseColor.rgb *= mix(1.0, 0.62, uWet * (bw.x + bw.z * 0.6));`)
        .replace('#include <roughnessmap_fragment>', `
          float rA = texture2D(roughnessMap, uvA).g, rB = texture2D(tBr, uvB).g, rC = texture2D(tCr, uvC).g;
          float roughnessFactor = roughness * (rA * bw.x + rB * bw.y + rC * bw.z);
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, uWet * (bw.z * 0.9 + bw.x * 0.6));`)
        .replace('#include <normal_fragment_maps>', `
          vec3 nA = texture2D(normalMap, uvA).xyz * 2.0 - 1.0, nB = texture2D(tBn, uvB).xyz * 2.0 - 1.0, nC = texture2D(tCn, uvC).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(nA * bw.x + nB * bw.y + nC * bw.z);
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );`)
        .replace('#include <aomap_fragment>', '');
    };
    m.customProgramCacheKey = () => 'terrainBlend';
    return m;
  }

  addOutdoorExtras() {
    const lvl = this.level;
    // iron fence (instanced bars)
    if (lvl.fenceCells.length) {
      const bars = [];
      const g = this.grid;
      for (const [x, z] of lvl.fenceCells) {
        const ew = g.get(x - 1, z) === T.FENCE || g.get(x + 1, z) === T.FENCE || g.get(x - 1, z) === T.EXT || g.get(x + 1, z) === T.EXT;
        for (let i = 0; i < 8; i++) {
          const t = (i + 0.5) / 8;
          bars.push(ew ? [x + t, z + 0.5] : [x + 0.5, z + t]);
        }
        bars.push(ew ? ['rail', x, z + 0.5, 'x'] : ['rail', x + 0.5, z, 'z']);
      }
      const metal = this.assets.mat('rusty_metal_02', { metal: true, color: 0x6a5a50, env: 0.3 });
      const barGeo = new THREE.CylinderGeometry(0.012, 0.012, 2.3, 6); barGeo.translate(0, 1.15, 0);
      const spike = new THREE.ConeGeometry(0.025, 0.12, 6); spike.translate(0, 2.36, 0);
      const bg = mergeGeometries([barGeo, spike]);
      const vb = bars.filter((b) => b[0] !== 'rail');
      const im = new THREE.InstancedMesh(bg, metal, vb.length);
      const m4 = new THREE.Matrix4();
      vb.forEach((b, i) => { m4.makeTranslation(b[0], 0, b[1]); im.setMatrixAt(i, m4); });
      im.castShadow = true; im.receiveShadow = true;
      this.root.add(im);
      const rails = bars.filter((b) => b[0] === 'rail');
      const railGeo = new THREE.BoxGeometry(1, 0.04, 0.03);
      const rm = new THREE.InstancedMesh(railGeo, metal, rails.length * 2);
      let k = 0;
      for (const r of rails) {
        for (const y of [0.25, 2.05]) {
          m4.makeRotationY(r[3] === 'x' ? 0 : Math.PI / 2);
          m4.setPosition(r[3] === 'x' ? r[1] + 0.5 : r[1], y, r[3] === 'x' ? r[2] : r[2] + 0.5);
          rm.setMatrixAt(k++, m4);
        }
      }
      rm.castShadow = true;
      this.root.add(rm);
    }
    // dead trees: a few variants drawn with instancing
    if (lvl.treeCells.length) {
      const variants = [0, 1, 2, 3].map((v) => makeDeadTree(this.assets, 1000 + v * 77));
      const mat = this.assets.mat('pine_bark', { color: 0x6e655c });
      const buckets = variants.map(() => []);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      for (const [x, z] of lvl.treeCells) {
        const v = (this.rng() * variants.length) | 0;
        const s = 0.8 + this.rng() * 0.5;
        q.setFromAxisAngle(up, this.rng() * Math.PI * 2);
        sc.set(s, s * (0.9 + this.rng() * 0.3), s);
        pos.set(x + 0.5 + (this.rng() - 0.5) * 0.3, -0.1, z + 0.5 + (this.rng() - 0.5) * 0.3);
        buckets[v].push(m4.compose(pos, q, sc).clone());
      }
      variants.forEach((geo, i) => {
        if (!buckets[i].length) return;
        const im = new THREE.InstancedMesh(geo, mat, buckets[i].length);
        buckets[i].forEach((m, k) => im.setMatrixAt(k, m));
        im.castShadow = true; im.receiveShadow = true;
        im.computeBoundingSphere();
        this.root.add(im);
      });
    }
  }

  addWater() {
    const g = this.grid;
    const cells = [];
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) if (g.get(x, z) === T.WATER) cells.push([x, z]);
    if (!cells.length) return;
    const geos = cells.map(([x, z]) => { const p = new THREE.PlaneGeometry(1, 1); p.rotateX(-Math.PI / 2); p.translate(x + 0.5, 0.1, z + 0.5); return p; });
    const geo = mergeGeometries(geos);
    const nor = this.assets.tex.concrete_floor_worn_001?.nor;
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1f1a, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.82, normalMap: nor, envMapIntensity: 1.2 });
    mat.normalScale.set(0.15, 0.15);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.renderOrder = 2;
    this.level.water = m;
    this.root.add(m);
  }
}

// Branching dead tree made of bent tapered tubes.
export function makeDeadTree(assets, seed) {
  const rng = mulberry32(seed);
  const parts = [];
  const branch = (start, dir, len, r0, depth) => {
    const segs = depth >= 2 ? 6 : 4;
    const pts = [];
    let p = start.clone();
    let d = dir.clone();
    for (let i = 0; i <= segs; i++) {
      pts.push(p.clone());
      d.x += (rng() - 0.5) * 0.35; d.z += (rng() - 0.5) * 0.35; d.y += 0.02;
      d.normalize();
      p = p.clone().addScaledVector(d, len / segs);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, segs, 1, depth >= 2 ? 6 : 4, false);
    // taper radius along the tube
    const pos = tube.attributes.position;
    const tmp = new THREE.Vector3();
    const ring = (depth >= 2 ? 6 : 4) + 1;
    for (let i = 0; i < pos.count; i++) {
      const seg = Math.floor(i / ring) / segs;
      const c = curve.getPointAt(Math.min(1, seg));
      tmp.fromBufferAttribute(pos, i).sub(c);
      const r = r0 * (1 - seg * 0.82) * (1 + (rng() - 0.5) * 0.15);
      tmp.multiplyScalar(r).add(c);
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    const uv = tube.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 1.2, uv.getY(i) * Math.max(0.5, r0 * 6));
    tube.computeVertexNormals();
    parts.push(tube);
    if (depth > 0) {
      const n = 2 + ((rng() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const t = 0.35 + rng() * 0.55;
        const sp = curve.getPoint(t);
        const nd = d.clone();
        nd.x += (rng() - 0.5) * 2.2; nd.z += (rng() - 0.5) * 2.2; nd.y = 0.35 + rng() * 0.6;
        nd.normalize();
        branch(sp, nd, len * (0.45 + rng() * 0.25), r0 * (1 - t * 0.8) * 0.75, depth - 1);
      }
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 5 + rng() * 3, 0.24 + rng() * 0.08, 2);
  // flare the root
  const roots = new THREE.CylinderGeometry(0.3, 0.55, 0.5, 9, 1, true);
  roots.translate(0, 0.15, 0);
  parts.push(roots);
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

// Night sky dome: gradient, clouds and a hazy moon.
export function makeSky() {
  const geo = new THREE.SphereGeometry(450, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uMoon: { value: new THREE.Vector3(-0.4, 0.45, -0.8).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform float uTime, uFlash; uniform vec3 uMoon; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 col = mix(vec3(0.020,0.024,0.032), vec3(0.004,0.005,0.009), pow(y, 0.5));
        float md = max(dot(d, uMoon), 0.0);
        col += vec3(0.30,0.33,0.38) * pow(md, 2200.0) * 3.0;
        col += vec3(0.05,0.06,0.075) * pow(md, 18.0);
        vec2 cp = d.xz / (d.y + 0.25) * 1.4 + vec2(uTime * 0.006, 0.0);
        float c = smoothstep(0.35, 0.8, fbm(cp));
        vec3 cloudCol = vec3(0.028,0.03,0.036) + vec3(0.08,0.085,0.095) * pow(md, 8.0);
        col = mix(col, cloudCol, c * smoothstep(0.0, 0.15, d.y));
        col += vec3(0.45,0.5,0.6) * uFlash * (0.4 + c);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

export { DOOR_H, accBox, Acc };

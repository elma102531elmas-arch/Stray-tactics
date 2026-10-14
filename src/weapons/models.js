// Procedural, detailed weapon models built from extruded side-profiles with
// bevels (so edges catch light), cylinders and small details. Static parts are
// merged per material; moving parts (mag, bolt/slide, trigger) are separate
// nodes that animation tracks drive.
//
// Gun space: origin at the top of the pistol grip (web of the right hand),
// -Z forward (muzzle), +Y up, +X right. Profiles are written as [f, y] where
// f = forward distance (so z = -f).
import * as THREE from 'three';
import { toCreasedNormals, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { materials } from '../gfx/materials.js';
import { DEG } from '../core/util.js';
import { hasModel, loadGLTF } from '../assets/loader.js';
import { clsOf } from './weapons.js';

// procedural fallback model for kinds without their own (e.g. knife variants)
const procDef = (kind) => DEFS[kind] || DEFS[clsOf(kind)] || DEFS.knife;

// ------------------------------------------------------------ geometry helpers
function roundedShape(pts, r = 0) {
  const s = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const rr = Array.isArray(r) ? r[i] : (p1[2] !== undefined ? p1[2] : r);
    if (!rr) { if (i === 0) s.moveTo(p1[0], p1[1]); else s.lineTo(p1[0], p1[1]); continue; }
    const d1 = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k1 = Math.min(rr, d1 / 2) / d1, k2 = Math.min(rr, d2 / 2) / d2;
    const ax = p1[0] + (p0[0] - p1[0]) * k1, ay = p1[1] + (p0[1] - p1[1]) * k1;
    const bx = p1[0] + (p2[0] - p1[0]) * k2, by = p1[1] + (p2[1] - p1[1]) * k2;
    if (i === 0) s.moveTo(ax, ay); else s.lineTo(ax, ay);
    s.quadraticCurveTo(p1[0], p1[1], bx, by);
  }
  s.closePath();
  return s;
}
function holePath(pts, r = 0) { return roundedShape(pts, r); }

// LOD 1 = first person detail, 0 = third-person (no bevels, fewer segments)
let LOD = 1;
// extrude a side profile (shape in f/y) to a given width, centered on x = xOff
function extrudeProfile(shape, width, bevel, xOff = 0, curveSeg = 8) {
  if (!LOD) { bevel = 0; curveSeg = Math.min(curveSeg, 2); }
  const b = Math.min(bevel ?? 0.002, width * 0.45);
  const depth = Math.max(0.0004, width - 2 * b);
  let g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.9, bevelOffset: -b * 0.9, bevelSegments: b > 0 ? 2 : 0, curveSegments: curveSeg,
  });
  g.rotateY(Math.PI / 2); // (sx,sy,sz) -> (sz, sy, -sx)
  g.translate(-depth / 2 + xOff, 0, 0);
  g = toCreasedNormals(g, 40 * DEG);
  return g;
}
// box with slightly rounded look via tiny bevel (uses extrude of a rect)
function bevBox(size, bevel = 0.0015) {
  const [w, h, d] = size;
  const sh = roundedShape([[-d / 2, -h / 2], [d / 2, -h / 2], [d / 2, h / 2], [-d / 2, h / 2]], 0);
  return extrudeProfile(sh, w, bevel, 0, 1);
}
// cylinder from point a to point b (gun-space [x,y,z]); r0 at a, r1 at b
function cylAB(a, b, r0, r1 = r0, seg = 16, capped = true) {
  if (!LOD) seg = Math.min(seg, 7);
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, !capped);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  const mid = va.add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}
// helper: [f,y,x] -> gun space [x,y,z]
const P = (f, y, x = 0) => [x, y, -f];

class ModelBuilder {
  constructor() { this.parts = new Map(); this.origins = {}; }
  // add geometry to part (default 'static') for material key
  add(geo, mat, part = 'static', m4) {
    if (m4) geo.applyMatrix4(m4);
    if (!geo.attributes.uv) {
      const n = geo.attributes.position.count; geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    }
    let p = this.parts.get(part); if (!p) { p = new Map(); this.parts.set(part, p); }
    let arr = p.get(mat); if (!arr) { arr = []; p.set(mat, arr); }
    arr.push(geo.index ? geo.toNonIndexed() : geo);
    return geo;
  }
  profile(pts, width, mat, opts = {}) {
    const sh = roundedShape(pts, opts.r ?? 0.002);
    if (opts.holes) opts.holes.forEach((h) => sh.holes.push(holePath(h, opts.hr ?? 0.002)));
    return this.add(extrudeProfile(sh, width, opts.bevel ?? 0.0018, opts.x ?? 0, opts.seg ?? 8), mat, opts.part, opts.m4);
  }
  box(center, size, mat, opts = {}) {
    const g = opts.sharp ? new THREE.BoxGeometry(size[0], size[1], size[2]) : bevBox(size, opts.bevel ?? 0.0012);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...center), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(opts.rot || [0, 0, 0]).map((v) => v * DEG))), new THREE.Vector3(1, 1, 1));
    return this.add(g, mat, opts.part, m);
  }
  cyl(a, b, r0, r1, mat, opts = {}) { return this.add(cylAB(a, b, r0, r1 ?? r0, opts.seg ?? 18, opts.capped !== false), mat, opts.part); }
  sphere(c, r, mat, opts = {}) { const g = LOD ? new THREE.SphereGeometry(r, 12, 8) : new THREE.SphereGeometry(r, 6, 4); g.scale(...(opts.scale || [1, 1, 1])); g.translate(...c); return this.add(g, mat, opts.part); }

  async build(matDefs) {
    const root = new THREE.Group();
    const nodes = {};
    const mats = {};
    for (const k in matDefs) mats[k] = await matDefs[k]();
    for (const [part, byMat] of this.parts) {
      const node = new THREE.Group(); node.name = part;
      const o = this.origins[part] || [0, 0, 0];
      node.position.set(o[0], o[1], o[2]);
      for (const [mat, geos] of byMat) {
        const merged = mergeGeometries(geos.map((g) => { const c = g.clone(); if (!c.attributes.normal) c.computeVertexNormals(); return c; }), false);
        if (o[0] || o[1] || o[2]) merged.translate(-o[0], -o[1], -o[2]);
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mats[mat] || mats.steel);
        mesh.castShadow = false; mesh.receiveShadow = false;
        if (mat === 'grip' || mat === 'dark') mesh.userData.noSkin = true;
        node.add(mesh);
      }
      nodes[part] = node;
      root.add(node);
    }
    return { root, nodes, mats };
  }
}

// shared material set
const MATS = {
  steel: () => materials.gearMaterial('gunmetal', { env: 1.2 }),
  dark: () => materials.gearMaterial('gunmetal', { color: '#6d6f73', env: 1.0 }),
  polymer: () => materials.gearMaterial('polymer'),
  olive: () => materials.gearMaterial('polymer_olive'),
  tan: () => materials.gearMaterial('polymer_tan'),
  wood: () => materials.gearMaterial('gunwood', { clearcoat: 0.55, clearcoatRoughness: 0.32 }),
  bakelite: () => materials.gearMaterial('bakelite', { clearcoat: 0.3, clearcoatRoughness: 0.4 }),
  grip: () => materials.gearMaterial('grip'),
  blade: () => materials.gearMaterial('blade', { env: 1.6 }),
  brass: async () => new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.28 }),
  glass: async () => new THREE.MeshPhysicalMaterial({ color: 0x0b1620, metalness: 0.1, roughness: 0.04, clearcoat: 1, envMapIntensity: 2.2, iridescence: 0.6, iridescenceIOR: 1.6 }),
  sight: async () => new THREE.MeshStandardMaterial({ color: 0x9cff5a, emissive: 0x6dff3a, emissiveIntensity: 2.2 }),
};

// =========================================================== RIFLE (AK style)
function rifleGeometry(mb) {
  const W = 0.044;
  // receiver
  mb.profile([[-0.16, 0.028], [0.19, 0.028], [0.205, 0.016], [0.205, -0.03], [0.12, -0.036], [0.04, -0.036], [-0.05, -0.03], [-0.16, -0.026]], W, 'steel', { r: 0.003, bevel: 0.0025 });
  // dust cover with ribs
  mb.profile([[-0.152, 0.026], [0.172, 0.026], [0.172, 0.044], [0.13, 0.05], [-0.12, 0.05, 0.008], [-0.152, 0.038]], 0.041, 'steel', { r: 0.004, bevel: 0.004 });
  for (let i = 0; i < 3; i++) mb.box(P(-0.1 + i * 0.024, 0.05, 0), [0.03, 0.004, 0.008], 'steel', { rot: [0, 0, 0] });
  // rear sight block + leaf
  mb.profile([[0.17, 0.028], [0.245, 0.028], [0.245, 0.05], [0.225, 0.062], [0.18, 0.062], [0.17, 0.05]], 0.032, 'steel', { r: 0.003 });
  mb.profile([[0.18, 0.06], [0.236, 0.062], [0.236, 0.068], [0.182, 0.066]], 0.016, 'dark', { r: 0.001, bevel: 0.001 });
  // trunnion band
  mb.profile([[0.203, -0.031], [0.226, -0.031], [0.226, 0.03], [0.203, 0.03]], 0.048, 'steel', { r: 0.002 });
  // lower handguard (wood)
  mb.profile([[0.224, 0.022], [0.43, 0.022], [0.43, -0.01, 0.012], [0.405, -0.031, 0.01], [0.26, -0.033, 0.02], [0.224, -0.018, 0.01]], 0.052, 'wood', { r: 0.004, bevel: 0.007 });
  // finger grooves on lower handguard (dark strips)
  for (const x of [-0.0262, 0.0262]) mb.box(P(0.33, -0.008, x), [0.002, 0.006, 0.14], 'wood');
  // upper handguard
  mb.profile([[0.245, 0.03], [0.41, 0.03], [0.41, 0.049, 0.006], [0.39, 0.058, 0.01], [0.27, 0.058, 0.01], [0.245, 0.046, 0.006]], 0.038, 'wood', { r: 0.003, bevel: 0.007 });
  // gas tube + gas block
  mb.cyl(P(0.24, 0.045), P(0.44, 0.045), 0.011, 0.011, 'steel');
  mb.profile([[0.43, -0.012], [0.462, -0.012], [0.462, 0.058, 0.004], [0.43, 0.058, 0.004]], 0.03, 'steel', { r: 0.003 });
  // barrel, front sight, muzzle
  mb.cyl(P(0.42, 0.006), P(0.63, 0.006), 0.0108, 0.0102, 'steel');
  mb.profile([[0.585, -0.008], [0.607, -0.008], [0.607, 0.03], [0.6, 0.064], [0.592, 0.064], [0.585, 0.03]], 0.02, 'steel', { r: 0.002 });
  mb.box(P(0.596, 0.053, 0), [0.0035, 0.018, 0.004], 'dark', { sharp: true });
  mb.cyl(P(0.62, 0.006), P(0.668, 0.006), 0.0142, 0.0136, 'steel', { seg: 20 });
  mb.box(P(0.655, 0.0185, 0), [0.012, 0.004, 0.016], 'dark', { sharp: true });
  mb.cyl(P(0.666, 0.006), P(0.669, 0.006), 0.0085, 0.0085, 'dark', { seg: 16 });
  // cleaning rod
  mb.cyl(P(0.29, -0.016), P(0.6, -0.013), 0.0032, 0.0032, 'steel', { seg: 8 });
  // pistol grip (bakelite)
  mb.profile([[0.02, -0.026], [-0.03, -0.026], [-0.062, -0.128, 0.008], [-0.054, -0.142, 0.01], [-0.02, -0.144, 0.01], [-0.002, -0.134, 0.006], [0.016, -0.06, 0.01]], 0.031, 'bakelite', { r: 0.004, bevel: 0.006 });
  // trigger guard
  mb.profile([[0.088, -0.03], [0.088, -0.042], [0.066, -0.078], [0.002, -0.078], [-0.012, -0.05], [-0.012, -0.03]], 0.012, 'steel',
    { r: 0.004, bevel: 0.0015, holes: [[[0.078, -0.036], [0.06, -0.071], [0.006, -0.071], [-0.004, -0.05], [-0.004, -0.036]]] });
  // trigger
  mb.profile([[0.046, -0.034], [0.054, -0.034], [0.05, -0.05], [0.04, -0.066], [0.036, -0.062], [0.044, -0.048]], 0.007, 'dark', { r: 0.002, bevel: 0.001, part: 'trigger' });
  mb.origins.trigger = P(0.05, -0.034);
  // stock (wood) + butt plate
  mb.profile([[-0.15, 0.024], [-0.39, -0.002, 0.004], [-0.396, -0.098, 0.006], [-0.372, -0.108, 0.01], [-0.21, -0.058, 0.03], [-0.15, -0.032]], 0.04, 'wood', { r: 0.004, bevel: 0.007 });
  mb.profile([[-0.392, 0.0], [-0.404, 0.0], [-0.408, -0.1], [-0.396, -0.104]], 0.042, 'steel', { r: 0.002 });
  // selector lever (right side)
  mb.box(P(0.0, 0.006, 0.0235), [0.003, 0.012, 0.16], 'steel', { rot: [-4, 0, 0] });
  mb.box(P(-0.076, -0.004, 0.026), [0.004, 0.014, 0.012], 'steel');
  // rivets
  for (const [f, y] of [[-0.12, -0.012], [-0.04, -0.016], [0.06, 0.004], [0.16, -0.018], [0.185, 0.012]]) for (const x of [-0.0225, 0.0225]) mb.cyl(P(f, y, x - Math.sign(x) * 0.001), P(f, y, x + Math.sign(x) * 0.0015), 0.0028, 0.0028, 'steel', { seg: 10 });
  // bolt carrier + charging handle (moving part 'bolt', travels along +Z)
  mb.box(P(0.07, 0.03, 0.0226), [0.004, 0.012, 0.12], 'steel', { part: 'bolt' });
  mb.cyl(P(0.122, 0.031, 0.022), P(0.122, 0.031, 0.042), 0.0042, 0.0042, 'steel', { part: 'bolt', seg: 12 });
  mb.sphere(P(0.122, 0.031, 0.043), 0.0058, 'steel', { part: 'bolt', scale: [1, 1, 0.8] });
  // ejection port (dark recess)
  mb.box(P(0.05, 0.017, 0.0222), [0.0012, 0.012, 0.06], 'dark', { sharp: true });

  // magazine (built in mag space: origin = top center of mag at the socket)
  const magPts = [];
  const front = new THREE.QuadraticBezierCurve(new THREE.Vector2(0.038, 0), new THREE.Vector2(0.05, -0.12), new THREE.Vector2(0.108, -0.212));
  const rear = new THREE.QuadraticBezierCurve(new THREE.Vector2(0.034, -0.222), new THREE.Vector2(-0.025, -0.115), new THREE.Vector2(-0.038, 0));
  front.getPoints(10).forEach((p) => magPts.push([p.x, p.y]));
  magPts.push([0.1, -0.226]); magPts.push([0.05, -0.234]);
  rear.getPoints(10).forEach((p) => magPts.push([p.x, p.y]));
  mb.profile(magPts.map((p) => [p[0], p[1]]), 0.031, 'bakelite', { r: 0.0, bevel: 0.004, part: 'mag', seg: 2 });
  // mag ribs + floor plate + feed lips
  for (let i = 0; i < 3; i++) {
    const t = 0.3 + i * 0.22;
    const pf = front.getPoint(t), pr = rear.getPoint(1 - t);
    const cx = (pf.x + pr.x) / 2, cy = (pf.y + pr.y) / 2;
    const ang = Math.atan2(pf.y - pr.y, pf.x - pr.x);
    for (const x of [-0.0158, 0.0158]) mb.box([x, cy, -cx], [0.002, 0.004, Math.hypot(pf.x - pr.x, pf.y - pr.y) * 0.8], 'bakelite', { part: 'mag', rot: [ang / DEG, 0, 0] });
  }
  mb.box([0, -0.229, -0.075], [0.034, 0.008, 0.07], 'steel', { part: 'mag', rot: [-14, 0, 0] });
  mb.box([0, 0.004, 0.0], [0.024, 0.008, 0.07], 'steel', { part: 'mag' });
  mb.cyl([0, 0.008, -0.012], [0, 0.008, 0.02], 0.0045, 0.0045, 'brass', { part: 'mag', seg: 8 });
}

// =========================================================== PISTOL
function pistolGeometry(mb) {
  // slide (moving part 'slide', travels along +Z)
  mb.profile([[-0.04, 0.012], [0.166, 0.012], [0.166, 0.039, 0.005], [0.158, 0.046, 0.004], [-0.034, 0.046, 0.003], [-0.04, 0.038]], 0.026, 'steel', { r: 0.003, bevel: 0.003, part: 'slide' });
  for (let i = 0; i < 7; i++) for (const x of [-0.0132, 0.0132]) mb.box(P(-0.03 + i * 0.0045, 0.029, x), [0.0012, 0.026, 0.0016], 'dark', { part: 'slide', sharp: true });
  for (let i = 0; i < 4; i++) for (const x of [-0.0132, 0.0132]) mb.box(P(0.13 + i * 0.0045, 0.029, x), [0.0012, 0.022, 0.0016], 'dark', { part: 'slide', sharp: true });
  mb.box(P(0.045, 0.04, 0.0105), [0.007, 0.012, 0.04], 'dark', { part: 'slide', sharp: true });
  mb.box(P(0.045, 0.036, 0.004), [0.01, 0.01, 0.034], 'brass', { part: 'slide', sharp: true });
  mb.profile([[-0.034, 0.045], [-0.022, 0.045], [-0.022, 0.054], [-0.034, 0.054]], 0.02, 'dark', { r: 0.001, bevel: 0.001, part: 'slide' });
  mb.profile([[0.148, 0.045], [0.158, 0.045], [0.156, 0.053], [0.15, 0.053]], 0.005, 'dark', { r: 0.0005, bevel: 0.0008, part: 'slide' });
  mb.sphere(P(0.153, 0.051, 0), 0.0016, 'sight', { part: 'slide' });
  for (const x of [-0.006, 0.006]) mb.sphere(P(-0.03, 0.051, x), 0.0014, 'sight', { part: 'slide' });
  // barrel crown
  mb.cyl(P(0.16, 0.026), P(0.168, 0.026), 0.0072, 0.0072, 'steel', { part: 'slide' });
  mb.cyl(P(0.165, 0.026), P(0.1685, 0.026), 0.0045, 0.0045, 'dark', { part: 'slide' });
  // frame + dust cover rail
  mb.profile([[-0.036, 0.0], [0.165, 0.0], [0.165, 0.013], [-0.036, 0.013]], 0.024, 'polymer', { r: 0.002, bevel: 0.002 });
  mb.profile([[0.06, -0.012], [0.165, -0.012, 0.003], [0.165, 0.002], [0.06, 0.002]], 0.024, 'polymer', { r: 0.002, bevel: 0.002 });
  for (let i = 0; i < 3; i++) mb.box(P(0.11 + i * 0.016, -0.0125, 0), [0.024, 0.003, 0.008], 'polymer', { sharp: true });
  // grip (stippled)
  mb.profile([[0.022, 0.002], [-0.036, 0.002], [-0.052, -0.008, 0.006], [-0.046, -0.02], [-0.063, -0.116, 0.008], [-0.054, -0.125, 0.006], [-0.016, -0.125, 0.006], [0.0, -0.114, 0.006], [0.018, -0.032, 0.012], [0.024, -0.01]], 0.03, 'grip', { r: 0.003, bevel: 0.0055 });
  // trigger guard
  mb.profile([[0.08, 0.0], [0.078, -0.03, 0.006], [0.058, -0.046, 0.006], [0.018, -0.046, 0.004], [0.012, -0.03], [0.012, 0.0]], 0.012, 'polymer',
    { r: 0.003, bevel: 0.0015, holes: [[[0.071, -0.006], [0.07, -0.028, 0.004], [0.054, -0.039, 0.004], [0.022, -0.039], [0.02, -0.006]]] });
  // trigger
  mb.profile([[0.045, -0.006], [0.052, -0.006], [0.05, -0.022], [0.04, -0.036], [0.036, -0.033], [0.043, -0.02]], 0.0065, 'polymer', { r: 0.0015, bevel: 0.0008, part: 'trigger' });
  mb.origins.trigger = P(0.048, -0.006);
  // slide stop + takedown
  mb.box(P(0.03, 0.006, -0.013), [0.002, 0.005, 0.03], 'dark');
  // magazine (mag space, slanted with grip; origin at top)
  mb.profile([[-0.016, 0.0], [0.016, 0.0], [0.016, -0.112], [-0.016, -0.112]], 0.022, 'steel', { r: 0.002, bevel: 0.0015, part: 'mag' });
  mb.profile([[-0.022, -0.106], [0.02, -0.106, 0.002], [0.022, -0.122, 0.003], [-0.024, -0.122, 0.003]], 0.028, 'polymer', { r: 0.002, bevel: 0.0025, part: 'mag' });
  mb.cyl([0, 0.003, -0.004], [0, 0.003, 0.012], 0.0045, 0.0045, 'brass', { part: 'mag', seg: 8 });
}

// =========================================================== SNIPER (bolt action)
function sniperGeometry(mb) {
  // receiver
  mb.cyl(P(-0.07, 0.03), P(0.18, 0.03), 0.0195, 0.0195, 'steel', { seg: 22 });
  mb.box(P(0.05, 0.012, 0), [0.036, 0.02, 0.2], 'steel');
  // barrel (fluted look via dark strips)
  mb.cyl(P(0.17, 0.03), P(0.72, 0.03), 0.0145, 0.011, 'steel', { seg: 20 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    mb.box(P(0.45, 0.03 + Math.sin(a) * 0.0125, Math.cos(a) * 0.0125), [0.004, 0.004, 0.36], 'dark', { rot: [0, 0, 0], sharp: true });
  }
  // muzzle brake
  mb.profile([[0.715, 0.014], [0.775, 0.014], [0.775, 0.046], [0.715, 0.046]], 0.032, 'steel', { r: 0.004, bevel: 0.003 });
  for (let i = 0; i < 3; i++) for (const x of [-0.0162, 0.0162]) mb.box(P(0.728 + i * 0.016, 0.03, x), [0.002, 0.018, 0.008], 'dark', { sharp: true });
  // chassis (olive): forend
  mb.profile([[0.02, 0.012], [0.33, 0.012], [0.33, -0.016, 0.008], [0.3, -0.032, 0.012], [0.06, -0.034], [0.02, -0.03]], 0.05, 'olive', { r: 0.004, bevel: 0.006 });
  // rail slots on forend sides
  for (let i = 0; i < 5; i++) for (const x of [-0.0252, 0.0252]) mb.box(P(0.12 + i * 0.04, -0.01, x), [0.002, 0.012, 0.022], 'polymer', { sharp: true });
  // rear stock with thumbhole
  mb.profile([[-0.06, 0.022], [-0.3, 0.03], [-0.4, 0.05, 0.01], [-0.43, 0.05, 0.006], [-0.432, -0.115, 0.008], [-0.39, -0.12, 0.01], [-0.22, -0.068, 0.02], [-0.09, -0.052, 0.01], [-0.06, -0.03]], 0.044, 'olive',
    { r: 0.004, bevel: 0.006, holes: [[[-0.17, -0.004], [-0.31, 0.014, 0.01], [-0.37, -0.03, 0.012], [-0.35, -0.08, 0.01], [-0.23, -0.05, 0.012]]], hr: 0.008 });
  mb.profile([[-0.43, 0.052], [-0.442, 0.052], [-0.444, -0.118], [-0.432, -0.12]], 0.046, 'polymer', { r: 0.003, bevel: 0.003 });
  // grip
  mb.profile([[0.016, -0.03], [-0.03, -0.03], [-0.064, -0.128, 0.008], [-0.056, -0.142, 0.01], [-0.02, -0.144, 0.01], [-0.002, -0.134, 0.006], [0.012, -0.06, 0.01]], 0.031, 'grip', { r: 0.004, bevel: 0.006 });
  // trigger guard + trigger
  mb.profile([[0.08, -0.03], [0.08, -0.042], [0.062, -0.074], [0.004, -0.074], [-0.01, -0.05], [-0.01, -0.03]], 0.012, 'steel',
    { r: 0.004, bevel: 0.0015, holes: [[[0.07, -0.036], [0.056, -0.067], [0.008, -0.067], [-0.002, -0.05], [-0.002, -0.036]]] });
  mb.profile([[0.042, -0.032], [0.05, -0.032], [0.047, -0.048], [0.038, -0.062], [0.034, -0.058], [0.041, -0.046]], 0.007, 'dark', { r: 0.002, bevel: 0.001, part: 'trigger' });
  mb.origins.trigger = P(0.046, -0.032);
  // scope mounts + rings
  for (const f of [0.0, 0.14]) {
    mb.box(P(f, 0.058, 0), [0.03, 0.03, 0.022], 'steel');
    mb.cyl(P(f - 0.011, 0.088), P(f + 0.011, 0.088), 0.0175, 0.0175, 'steel', { seg: 22 });
  }
  // scope tube, objective bell, eyepiece, turrets
  mb.cyl(P(-0.045, 0.088), P(0.2, 0.088), 0.0138, 0.0138, 'dark', { seg: 24 });
  mb.cyl(P(0.2, 0.088), P(0.25, 0.088), 0.0138, 0.0245, 'dark', { seg: 24 });
  mb.cyl(P(0.25, 0.088), P(0.285, 0.088), 0.0245, 0.0245, 'dark', { seg: 24 });
  mb.cyl(P(-0.045, 0.088), P(-0.07, 0.088), 0.0138, 0.0185, 'dark', { seg: 24 });
  mb.cyl(P(-0.07, 0.088), P(-0.11, 0.088), 0.0185, 0.0185, 'dark', { seg: 24 });
  mb.cyl(P(0.283, 0.088), P(0.2852, 0.088), 0.021, 0.021, 'glass', { seg: 24 });
  mb.cyl(P(-0.1082, 0.088), P(-0.1105, 0.088), 0.0155, 0.0155, 'glass', { seg: 24 });
  mb.cyl(P(0.075, 0.1), P(0.075, 0.122), 0.011, 0.011, 'dark', { seg: 16 });
  mb.cyl(P(0.075, 0.088, 0.012), P(0.075, 0.088, 0.032), 0.01, 0.01, 'dark', { seg: 16 });
  // magazine
  mb.profile([[-0.034, 0.0], [0.034, 0.0], [0.034, -0.062], [-0.034, -0.062]], 0.026, 'steel', { r: 0.003, bevel: 0.002, part: 'mag' });
  mb.profile([[-0.036, -0.058], [0.036, -0.058], [0.036, -0.07, 0.003], [-0.036, -0.07, 0.003]], 0.03, 'polymer', { r: 0.002, bevel: 0.002, part: 'mag' });
  mb.cyl([0, 0.004, 0.025], [0, 0.004, -0.03], 0.0055, 0.0055, 'brass', { part: 'mag', seg: 8 });
  // bolt (moving: 'bolt' translates +Z, rotates about the bore axis through y=0.03)
  mb.cyl(P(-0.075, 0.03), P(-0.06, 0.03), 0.0185, 0.0185, 'steel', { part: 'bolt', seg: 18 });
  mb.cyl(P(-0.06, 0.03, 0.0), P(-0.05, 0.022, 0.05), 0.0045, 0.0045, 'steel', { part: 'bolt', seg: 10 });
  mb.sphere(P(-0.05, 0.022, 0.054), 0.0105, 'polymer', { part: 'bolt' });
  mb.origins.bolt = P(0, 0.03, 0);
}

// =========================================================== KNIFE
function knifeGeometry(mb) {
  // blade (clip point), thin with wide bevel -> ground edge highlights
  const blade = [[0.0, 0.012], [0.15, 0.012], [0.175, 0.004], [0.212, -0.006], [0.19, -0.016], [0.12, -0.026], [0.02, -0.028], [0.0, -0.024]];
  mb.profile(blade, 0.006, 'blade', { r: 0.002, bevel: 0.0026, seg: 4 });
  mb.box(P(0.09, 0.004, 0), [0.0064, 0.0045, 0.11], 'dark', { sharp: true });
  // spine serration
  for (let i = 0; i < 7; i++) mb.box(P(0.03 + i * 0.009, 0.0125, 0), [0.004, 0.003, 0.004], 'blade', { rot: [45, 0, 0], sharp: true });
  // guard
  mb.profile([[-0.006, 0.02], [0.004, 0.02], [0.004, -0.038, 0.004], [-0.006, -0.038, 0.004]], 0.02, 'steel', { r: 0.003, bevel: 0.002 });
  // handle with finger grooves
  mb.profile([[-0.006, 0.012], [-0.115, 0.012, 0.006], [-0.122, -0.002, 0.006], [-0.118, -0.03, 0.006], [-0.095, -0.032], [-0.084, -0.026], [-0.072, -0.033], [-0.058, -0.026], [-0.044, -0.033], [-0.03, -0.026], [-0.016, -0.031], [-0.006, -0.026]], 0.024, 'grip', { r: 0.002, bevel: 0.005 });
  // pommel
  mb.profile([[-0.12, 0.014], [-0.134, 0.012, 0.004], [-0.136, -0.024, 0.004], [-0.12, -0.03]], 0.026, 'steel', { r: 0.003, bevel: 0.003 });
}

// =========================================================== KARAMBIT
// Held like a pistol grip with the index finger through the ring; the ring
// centre (K_RING, gun space) is the spin pivot for finger twirls.
const K_RING = [0, -0.012, -0.03];
const spline = (ctrl, n) => new THREE.SplineCurve(ctrl.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(n).map((v) => [v.x, v.y]);
function karambitGeometry(mb) {
  const T = ([f, y]) => [f - K_RING[2], y + K_RING[1]]; // ring-local (f forward, y up) -> profile coords
  const Ro = 0.0205, Ri = 0.0128;
  const pts = [];
  const a1 = Math.atan2(-0.0166, 0.012), a2 = Math.atan2(-0.0166, -0.012) + Math.PI * 2;
  for (let i = 0; i <= 30; i++) { const a = a1 + (a2 - a1) * i / 30; pts.push([Math.cos(a) * Ro, Math.sin(a) * Ro]); }
  // spine down the back of the handle into the claw's outer curve, to the tip
  pts.push(...spline([[-0.012, -0.0166], [-0.0128, -0.045], [-0.0115, -0.075], [-0.007, -0.1], [0.002, -0.118], [0.016, -0.132], [0.034, -0.14], [0.052, -0.14], [0.068, -0.132], [0.08, -0.119], [0.09, -0.103]], 44).slice(1));
  // edge (inner curve) back from the tip, then the front of the handle with finger grooves
  pts.push(...spline([[0.09, -0.103], [0.078, -0.111], [0.063, -0.118], [0.047, -0.12], [0.033, -0.117], [0.022, -0.109], [0.016, -0.098], [0.0145, -0.086]], 26).slice(1));
  pts.push(...spline([[0.0145, -0.086], [0.0165, -0.074], [0.0128, -0.064], [0.0165, -0.052], [0.0128, -0.041], [0.0152, -0.029], [0.012, -0.0166]], 26).slice(1, -1));
  const hole = []; for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; hole.push([Math.cos(a) * Ri, Math.sin(a) * Ri]); }
  mb.profile(pts.map(T), 0.0045, 'blade', { r: 0, bevel: 0.0013, seg: 1, holes: [hole.map(T)], hr: 0 });
  // G10 handle scales + pins
  const sc = spline([[0.0, -0.0215], [-0.0105, -0.025], [-0.011, -0.05], [-0.0098, -0.08], [-0.005, -0.097], [0.006, -0.1], [0.0125, -0.09], [0.0145, -0.074], [0.0115, -0.064], [0.0145, -0.052], [0.0115, -0.041], [0.0132, -0.03], [0.008, -0.022]], 40);
  for (const sx of [-1, 1]) mb.profile(sc.map(T), 0.0032, 'grip', { r: 0, bevel: 0.001, seg: 1, x: sx * 0.0038 });
  for (const [f, y] of [[0.0005, -0.04], [0.003, -0.08]]) { const q = T([f, y]); mb.cyl([-0.0058, q[1], -q[0]], [0.0058, q[1], -q[0]], 0.0021, 0.0021, 'steel', { seg: 12 }); }
  // thumb jimping on the spine where the blade starts
  for (let i = 0; i < 6; i++) { const q = T([-0.0118 + i * 0.0006, -0.088 - i * 0.004]); mb.box([0, q[1], -q[0]], [0.0046, 0.0016, 0.0024], 'blade', { sharp: true, rot: [20, 0, 0] }); }
}

// =========================================================== BUTTERFLY (balisong)
// origin between the two pivot pins; blade -Z, edge -Y. Handle A (safe, edge
// side) pivots on pin A, handle B (bite, spine side) on pin B; open = both
// handles behind the blade. Tracks hA / hB rotate them (0 open, 180 closed).
const B_PIN_A = [0, -0.0068, 0.0035], B_PIN_B = [0, 0.0068, 0.0035];
function butterflyGeometry(mb) {
  const blade = [
    ...spline([[-0.004, 0.0105], [0.02, 0.011], [0.06, 0.0108], [0.077, 0.0094], [0.094, 0.0042], [0.104, 0.0]], 30),
    ...spline([[0.104, 0.0], [0.096, -0.006], [0.084, -0.0098], [0.06, -0.011], [0.02, -0.011], [0.004, -0.0112]], 24).slice(1),
    [0.0, -0.0136], [-0.007, -0.0128], [-0.0105, -0.006], [-0.0105, 0.006], [-0.007, 0.0105],
  ];
  mb.profile(blade, 0.003, 'blade', { r: 0, bevel: 0.0011, seg: 1 });
  // false edge grind line on the spine near the tip
  mb.profile([[0.07, 0.0098], [0.094, 0.0042], [0.09, 0.0042], [0.07, 0.0088]], 0.0034, 'steel', { r: 0, bevel: 0.0002, seg: 1 });
  for (const [part, pin, sgn] of [['handleA', B_PIN_A, -1], ['handleB', B_PIN_B, 1]]) {
    mb.origins[part] = pin;
    // each side plate covers its pin's half of the closed grip
    const yLo = sgn < 0 ? -0.0125 : 0.0, yHi = sgn < 0 ? 0.0 : 0.0125;
    const plate = [[0.0078, yLo], [0.0078, yHi], [-0.124, yHi], [-0.124, yLo]];
    const ym = (yLo + yHi) / 2;
    const holes = [[-0.014, -0.04], [-0.046, -0.076], [-0.082, -0.11]].map(([f0, f1]) => [[f0, ym - 0.0022], [f0, ym + 0.0022], [f1, ym + 0.0022], [f1, ym - 0.0022]]);
    for (const sx of [-1, 1]) mb.profile(plate, 0.0018, 'steel', { r: 0.0035, bevel: 0.0005, seg: 4, x: sx * 0.0046, holes, hr: 0.0018, part });
    // outer strip closing the channel + pivot pin
    mb.box(P(-0.058, sgn * 0.0118, 0), [0.0092, 0.0014, 0.124], 'steel', { part, bevel: 0.0004 });
    mb.cyl([-0.0062, pin[1], pin[2]], [0.0062, pin[1], pin[2]], 0.0019, 0.0019, 'dark', { seg: 12, part });
  }
  // latch on the bite handle's tail
  mb.box(P(-0.121, 0.0128, 0), [0.004, 0.0028, 0.012], 'dark', { part: 'handleB', bevel: 0.0005 });
}

// =========================================================== definitions
// sockets: positions are gun-space [x,y,z].  Rotations are given either as
// euler degrees `r` or as a basis for hands: y = finger direction (wrist ->
// knuckles), z = back-of-hand direction. Hand sockets mark the WRIST.
const KNIFE_FORE = { p: [-0.2, -0.42, -0.25], y: [0.3, 0.6, -0.75], z: [-0.95, 0, -0.3] };
// hammer grip on a handle along +Z: wrist below-right, back of the hand toward the camera
export const KNIFE_GRIP = { p: [0.03, -0.05, 0.08], y: [-0.5, 0.8, -0.33], z: [-0.8, -0.5, 0] };
const DEFS = {
  karambit: {
    geometry: karambitGeometry,
    sockets: {
      muzzle: [0, -0.14, -0.1], eject: [0, 0, 0], spin: K_RING,
      grip: { p: [0.028, -0.075, 0.05], y: [0, -0.12, -0.99], z: [1, 0, 0] },
      fore: KNIFE_FORE,
    },
  },
  butterfly: {
    geometry: butterflyGeometry,
    sockets: {
      muzzle: [0, 0, -0.105], eject: [0, 0, 0], spin: B_PIN_A,
      grip: { ...KNIFE_GRIP, p: [0.03, -0.04, 0.085] },
      fore: KNIFE_FORE,
    },
  },
  rifle: {
    geometry: rifleGeometry,
    sockets: {
      mag: { p: P(0.082, -0.032), r: [0, 0, 0] },
      muzzle: P(0.67, 0.006), eject: P(0.05, 0.02, 0.024),
      grip: { p: [0.03, -0.075, 0.075], y: [0, -0.2, -0.98], z: [1, 0, 0] },
      fore: { p: [-0.054, -0.067, -0.33], y: [0.92, 0.38, 0], z: [0.38, -0.92, 0] },
      magHold: { p: [0.0, 0.048, -0.03], r: [0, 0, 90] },
    },
  },
  pistol: {
    geometry: pistolGeometry,
    sockets: {
      mag: { p: P(-0.02, 0.0), r: [-17, 0, 0] },
      muzzle: P(0.17, 0.026), eject: P(0.045, 0.045, 0.012),
      grip: { p: [0.028, -0.07, 0.072], y: [0, -0.2, -0.98], z: [1, 0, 0] },
      fore: { p: [-0.051, -0.07, 0.041], y: [0.45, -0.1, -0.89], z: [-0.89, 0, -0.45] },
      magHold: { p: [0, 0.097, -0.101], r: [124.5, 0, -180] },
    },
  },
  sniper: {
    geometry: sniperGeometry,
    sockets: {
      mag: { p: P(0.08, -0.03), r: [0, 0, 0] },
      muzzle: P(0.78, 0.03), eject: P(0.05, 0.045, 0.02),
      grip: { p: [0.03, -0.077, 0.075], y: [0, -0.2, -0.98], z: [1, 0, 0] },
      fore: { p: [-0.054, -0.067, -0.24], y: [0.92, 0.38, 0], z: [0.38, -0.92, 0] },
      magHold: { p: [0.0, 0.048, -0.03], r: [0, 0, 90] },
    },
  },
  knife: {
    geometry: knifeGeometry,
    sockets: {
      muzzle: P(0.2, 0), eject: P(0, 0, 0),
      grip: { p: [0.03, 0.03, 0.06], y: [0, -1, 0], z: [1, 0, 0] },
      // knife: left hand is in camera space (lhandFree), resting low-left out of view
      fore: { p: [-0.2, -0.42, -0.25], y: [0.3, 0.6, -0.75], z: [-0.95, 0, -0.3] },
    },
  },
};

// =========================================================== glTF weapons
// Real weapon models (assets/models/gun_*.glb, CC0 - see assets/CREDITS.md).
// origin: model-space point that becomes the gun-space origin (top of the
//   pistol grip where the web of the right hand sits; model axes already
//   match gun space: -Z muzzle, +Y up, +X right).
// parts: model node name -> role. Each role gets a pivot group (pivots, in
//   model space) so animation tracks can move it: mag, bolt (travels +Z,
//   rolls about Z for bolt actions), trigger (rotates about X).
// move: rest-pose correction for a part (model-space delta).
// sockets: gun space, same meaning as the procedural DEFS; extra anchor
//   points (charge = charging handle / bolt knob, port = shell loading port)
//   let clips authored for one gun be retargeted to another.
const PISTOL_HANDS = {
  grip: { p: [0.028, -0.07, 0.072], y: [0, -0.2, -0.98], z: [1, 0, 0] },
  fore: { p: [-0.051, -0.07, 0.041], y: [0.45, -0.1, -0.89], z: [-0.89, 0, -0.45] },
};
const RIFLE_GRIP = { p: [0.03, -0.075, 0.075], y: [0, -0.2, -0.98], z: [1, 0, 0] };
const RIFLE_FORE = (p) => ({ p, y: [0.92, 0.38, 0], z: [0.38, -0.92, 0] });
export const GLTF_DEFS = {
  rifle: {
    model: 'gun_ak', origin: [0, -0.04, 0.315],
    parts: { Magazine: 'mag', Ejection_Port: 'bolt', Trigger: 'trigger' },
    pivots: { mag: [0, -0.03, 0.125], bolt: [0, 0.008, 0.13], trigger: [0, -0.043, 0.245] },
    sockets: {
      muzzle: [0, 0.043, -0.631], eject: [0.022, 0.048, -0.185], charge: [0.025, 0.05, -0.22],
      grip: RIFLE_GRIP, fore: RIFLE_FORE([-0.054, -0.032, -0.375]),
      magHold: { p: [0.0, 0.048, -0.03], r: [0, 0, 90] },
    },
  },
  m4: {
    model: 'gun_m4', origin: [0, -0.02, 0.1],
    parts: { Magazine: 'mag', Charging_Handle: 'bolt', Trigger: 'trigger' },
    pivots: { mag: [0, 0.0, -0.06], bolt: [0, 0.042, 0.1], trigger: [0, -0.025, 0.03] },
    sockets: {
      muzzle: [0, 0.05, -0.636], eject: [0.025, 0.04, -0.14], charge: [0, 0.062, 0.005],
      grip: RIFLE_GRIP, fore: RIFLE_FORE([-0.054, -0.022, -0.33]),
      magHold: { p: [0.0, 0.048, -0.03], r: [0, 0, 90] },
    },
  },
  smg: {
    model: 'gun_smg', origin: [0, -0.05, 0.195],
    parts: { Magazine: 'mag', Bolt: 'bolt', Trigger: 'trigger' },
    pivots: { mag: [0, 0.0, -0.09], bolt: [0, 0.006, 0.0], trigger: [0, -0.056, 0.12] },
    sockets: {
      muzzle: [0, 0.05, -0.533], eject: [0.03, 0.06, -0.245], charge: [0.03, 0.07, -0.245],
      grip: RIFLE_GRIP, fore: { p: [-0.04, -0.12, -0.24], y: [0.35, 0.25, -0.9], z: [-0.9, 0, -0.35] },
      magHold: { p: [0.0, 0.048, -0.03], r: [0, 0, 90] },
    },
  },
  shotgun: {
    model: 'gun_shotgun', origin: [0, 0.0, 0.47],
    parts: { Fore_Stock: 'bolt', Ejection_Port: 'bolt', Trigger: 'trigger' },
    pivots: { bolt: [0, -0.012, -0.056], trigger: [0, -0.03, 0.385] },
    sockets: {
      muzzle: [0, 0.03, -0.875], eject: [0.015, 0.026, -0.21], port: [0, -0.04, -0.17], charge: [0, -0.012, -0.526],
      grip: RIFLE_GRIP, fore: RIFLE_FORE([-0.05, -0.075, -0.52]),
    },
  },
  sniper: {
    model: 'gun_sniper', origin: [0, -0.005, 0.33],
    parts: { Magazine: 'mag', Bolt: 'bolt', Trigger: 'trigger' },
    pivots: { mag: [0, -0.045, 0.12], bolt: [0, 0.025, 0.2], trigger: [0, -0.016, 0.243] },
    sockets: {
      muzzle: [0, 0.035, -0.853], eject: [0.02, 0.035, -0.13], charge: [0.03, -0.01, -0.085],
      grip: RIFLE_GRIP, fore: RIFLE_FORE([-0.054, -0.085, -0.41]),
      magHold: { p: [0.0, 0.048, -0.03], r: [0, 0, 90] },
    },
  },
  pistol: {
    model: 'gun_pistol', origin: [0, 0.018, 0.028],
    parts: { Magazine: 'mag', Slide: 'slide', Trigger: 'trigger' },
    move: { Magazine: [0, 0.001, -0.091] },
    pivots: { mag: [0, 0.034, 0.002], slide: [0, 0.045, 0.0], trigger: [0, 0.025, -0.045] },
    sockets: {
      muzzle: [0, 0.029, -0.158], eject: [0.017, 0.032, -0.068], charge: [0, 0.035, 0.0],
      ...PISTOL_HANDS, magHold: { p: [0, 0.097, -0.101], r: [124.5, 0, -180] },
    },
  },
  knife: {
    model: 'knife_combat', origin: [0, 0.01, 0], parts: {}, pivots: {},
    sockets: { muzzle: [0, -0.01, -0.165], eject: [0, 0, 0], grip: { p: [0.03, -0.05, 0.08], y: [-0.5, 0.8, -0.33], z: [-0.8, -0.5, 0] }, fore: { p: [-0.2, -0.42, -0.25], y: [0.3, 0.6, -0.75], z: [-0.95, 0, -0.3] } },
  },
  m9: {
    model: 'knife_m9', origin: [0, 0.015, 0.02], parts: {}, pivots: {}, noSkin: /handle/i,
    sockets: { muzzle: [0, -0.01, -0.18], eject: [0, 0, 0], grip: { p: [0.03, -0.05, 0.08], y: [-0.5, 0.8, -0.33], z: [-0.8, -0.5, 0] }, fore: { p: [-0.2, -0.42, -0.25], y: [0.3, 0.6, -0.75], z: [-0.95, 0, -0.3] } },
  },
  deagle: {
    model: 'gun_deagle', origin: [0, -0.02, 0.118],
    parts: { Magazine: 'mag', Slide: 'slide', Bolt: 'slide', Trigger: 'trigger' },
    pivots: { mag: [0, 0.0, 0.06], slide: [0, 0.01, 0.0], trigger: [0, -0.022, 0.04] },
    sockets: {
      muzzle: [0, 0.023, -0.252], eject: [0.02, 0.035, -0.078], charge: [0, 0.035, 0.0],
      ...PISTOL_HANDS, magHold: { p: [0, 0.097, -0.101], r: [124.5, 0, -180] },
    },
  },
};
// anchor points of the procedural reference guns the built-in clips were authored on
export const REF_ANCHORS = {
  rifle: { mag: [0, -0.032, -0.082], charge: [0.043, 0.031, -0.122] },
  pistol: { mag: [0, 0, 0.02], charge: [0, 0.035, 0.03] },
  sniper: { mag: [0, -0.03, -0.08], charge: [0.054, 0.022, 0.05] },
};
for (const k in GLTF_DEFS) { const d = GLTF_DEFS[k]; if (d.pivots.mag) d.sockets.mag = { p: d.pivots.mag.map((v, i) => +(v - d.origin[i]).toFixed(4)), r: [0, 0, 0] }; }

const useGLTF = (kind) => !!GLTF_DEFS[kind] && hasModel(GLTF_DEFS[kind].model);
export function weaponSockets(kind) { return useGLTF(kind) ? GLTF_DEFS[kind].sockets : procDef(kind).sockets; }
// gun-space anchor points used to retarget clips (fore/grip/mag/charge/port)
export function weaponAnchors(kind, reference = false) {
  const s = reference || !useGLTF(kind) ? DEFS[kind]?.sockets : GLTF_DEFS[kind].sockets;
  if (!s) return null;
  const ref = reference || !useGLTF(kind) ? REF_ANCHORS[kind] || {} : {};
  return { fore: s.fore?.p, grip: s.grip?.p, foreQ: s.fore && socketQuat(s.fore), gripQ: s.grip && socketQuat(s.grip), mag: s.mag?.p || ref.mag, charge: s.charge || ref.charge, port: s.port || s.mag?.p || ref.mag };
}

async function buildGLTFWeapon(kind) {
  const def = GLTF_DEFS[kind];
  const g = await loadGLTF(def.model);
  const root = new THREE.Group(); root.name = kind;
  const model = g.scene.clone(true);
  model.position.set(-def.origin[0], -def.origin[1], -def.origin[2]);
  root.add(model);
  root.updateMatrixWorld(true);
  const nodes = {};
  const v = new THREE.Vector3();
  for (const [name, role] of Object.entries(def.parts)) {
    const node = model.getObjectByName(name);
    if (!node) { console.warn('weapon part missing', kind, name); continue; }
    if (def.move && def.move[name]) {
      node.getWorldPosition(v).add(new THREE.Vector3(...def.move[name]));
      node.parent.worldToLocal(v); node.position.copy(v); node.updateMatrixWorld(true);
    }
    let grp = nodes[role];
    if (!grp) {
      grp = new THREE.Group(); grp.name = role;
      const pv = def.pivots[role] || [0, 0, 0];
      grp.position.set(pv[0] - def.origin[0], pv[1] - def.origin[1], pv[2] - def.origin[2]);
      root.add(grp); grp.updateMatrixWorld(true);
      nodes[role] = grp;
    }
    grp.attach(node);
  }
  root.traverse((o) => {
    o.frustumCulled = false;
    if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; if (def.noSkin && def.noSkin.test(o.material.name || '')) o.userData.noSkin = true; }
  });
  return { root, nodes, sockets: def.sockets, kind, gltf: true };
}

// quaternion for a socket given as euler `r` (deg) or basis {y,z}
export function socketQuat(s, out = new THREE.Quaternion()) {
  if (s.y && s.z) {
    const y = new THREE.Vector3(...s.y).normalize();
    let z = new THREE.Vector3(...s.z);
    z.addScaledVector(y, -z.dot(y)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }
  const r = s.r || [0, 0, 0];
  return out.setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG));
}

const cache = new Map();
export async function buildWeaponModel(kind) {
  if (useGLTF(kind)) return buildGLTFWeapon(kind);
  const def = procDef(kind);
  const mb = new ModelBuilder();
  def.geometry(mb);
  const { root, nodes } = await mb.build(MATS);
  const s = def.sockets;
  // attach mag node at its socket
  if (nodes.mag) {
    nodes.mag.position.set(...s.mag.p);
    nodes.mag.rotation.set(...s.mag.r.map((v) => v * DEG));
  }
  root.traverse((o) => { o.frustumCulled = false; });
  return { root, nodes, sockets: s, kind };
}

// Low-detail merged copy (single draw call, vertex colors) for third-person.
export async function buildWorldWeapon(kind) {
  if (cache.has(kind)) return cache.get(kind).clone();
  if (useGLTF(kind)) {
    // merge every part into one mesh (one draw call per bot weapon)
    const m = await buildGLTFWeapon(kind);
    m.root.updateMatrixWorld(true);
    const byMat = new Map();
    m.root.traverse((o) => {
      if (!o.isMesh) return;
      // de-quantize to float before transforming/merging
      const src = o.geometry, g = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) {
        const a = src.attributes[k]; if (!a) continue;
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
      if (src.index) g.setIndex(src.index.clone());
      g.applyMatrix4(o.matrixWorld);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
    });
    const mats = [...byMat.keys()];
    const parts = mats.map((mt) => mergeGeometries(byMat.get(mt).map((g) => (g.index ? g.toNonIndexed() : g)), false));
    const merged = parts.length > 1 ? mergeGeometries(parts, true) : parts[0];
    const mesh = new THREE.Mesh(merged, mats.length > 1 ? mats : mats[0]);
    mesh.castShadow = true;
    cache.set(kind, mesh);
    return mesh.clone();
  }
  const def = procDef(kind);
  const mb = new ModelBuilder();
  LOD = 0;
  try { def.geometry(mb); } finally { LOD = 1; }
  const colors = { steel: 0x3a3c40, dark: 0x2a2b2e, polymer: 0x242629, olive: 0x4c5240, tan: 0x9a8566, wood: 0x6b3a1e, bakelite: 0x5e2816, grip: 0x26282b, blade: 0xb5b9bf, brass: 0xb08a40, glass: 0x10202a, sight: 0x80ff50 };
  const geos = [];
  for (const [part, byMat] of mb.parts) {
    const off = mb.origins[part];
    for (const [mat, list] of byMat) {
      for (const g of list) {
        const c = g.clone();
        if (part === 'mag') {
          const so = def.sockets.mag;
          c.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...so.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...so.r.map((v) => v * DEG))), new THREE.Vector3(1, 1, 1)));
        }
        void off;
        const col = new THREE.Color(colors[mat] ?? 0x333333);
        const n = c.attributes.position.count; const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
        c.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        geos.push(c);
      }
    }
  }
  const merged = mergeGeometries(geos, false);
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 }));
  mesh.castShadow = true;
  cache.set(kind, mesh);
  return mesh.clone();
}

// sockets per kind (glTF when embedded, else procedural)
export const WEAPON_MODEL_DEFS = new Proxy({}, { get: (t, kind) => ({ sockets: weaponSockets(kind) }) });

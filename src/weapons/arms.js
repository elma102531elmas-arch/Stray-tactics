// First-person arms, driven by 2-bone IK toward hand targets.
// - sleeves: procedural cloth tubes with folds (rigid-skinned to upper/fore/hand)
// - hands: photo-real rigged hand (WebXR generic hand, MIT) worn as a glove,
//   25 joints, fingers curled by hand poses. Falls back to procedural fingers
//   when the model is not embedded.
import * as THREE from 'three';
import { materials } from '../gfx/materials.js';
import { DEG } from '../core/util.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hasModel, instanceModel } from '../assets/loader.js';

const L1 = 0.31, L2 = 0.29; // upper arm / forearm

// finger layout for a RIGHT hand; x is mirrored for the left hand (side=-1)
const FINGERS = [
  { name: 'index', x: -0.026, lens: [0.044, 0.026, 0.021], r: 0.0102, splay: -4 },
  { name: 'middle', x: -0.009, lens: [0.048, 0.029, 0.022], r: 0.0104, splay: 0 },
  { name: 'ring', x: 0.009, lens: [0.045, 0.027, 0.021], r: 0.0099, splay: 3 },
  { name: 'pinky', x: 0.025, lens: [0.036, 0.021, 0.018], r: 0.0088, splay: 7 },
];
const THUMB = { lens: [0.036, 0.03, 0.024], r: 0.0118 };
const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'];

// curl poses: degrees per joint [prox, mid, dist] ; thumb [base, mid, dist]
// (thumbSpread: extra rotation of the thumb base across the palm)
export const HAND_POSES = {
  open: { index: [4, 6, 4], middle: [4, 6, 4], ring: [5, 7, 4], pinky: [6, 8, 5], thumb: [0, 4, 4], thumbSpread: 0 },
  grip: { index: [58, 70, 40], middle: [62, 74, 42], ring: [64, 76, 42], pinky: [66, 76, 40], thumb: [26, 30, 20], thumbSpread: 22 },
  trigger: { index: [22, 38, 20], middle: [62, 74, 42], ring: [66, 78, 42], pinky: [70, 78, 40], thumb: [28, 26, 16], thumbSpread: 24 },
  fist: { index: [86, 96, 60], middle: [88, 98, 60], ring: [88, 98, 60], pinky: [88, 96, 58], thumb: [40, 45, 40], thumbSpread: 30 },
  mag: { index: [40, 50, 30], middle: [46, 55, 34], ring: [50, 58, 34], pinky: [52, 58, 34], thumb: [24, 22, 14], thumbSpread: 18 },
  knife: { index: [70, 85, 50], middle: [76, 90, 52], ring: [78, 90, 52], pinky: [80, 88, 50], thumb: [40, 40, 30], thumbSpread: 26 },
  point: { index: [2, 4, 2], middle: [80, 92, 56], ring: [84, 94, 56], pinky: [86, 92, 54], thumb: [34, 36, 30], thumbSpread: 26 },
  flat: { index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], pinky: [0, 0, 0], thumb: [-6, 0, 0], thumbSpread: -8 },
};

function capsule(r, len, seg = 8) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.0001, len), 3, seg);
  g.translate(0, len / 2, 0);
  return g;
}
function roundBox(w, h, d, r = 0.008) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 4, 3);
  const p = g.attributes.position, v = new THREE.Vector3();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = new THREE.Vector3(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
    const dlt = v.clone().sub(c); if (dlt.lengthSq() > 1e-12) dlt.setLength(r);
    p.setXYZ(i, c.x + dlt.x, c.y + dlt.y, c.z + dlt.z);
  }
  g.computeVertexNormals();
  return g;
}

// Cloth tube along +Y (0..len): elliptic section, radius r0 -> r1 with a
// muscle bulge, plus fabric folds (strongest near the ends where cloth bunches).
// UVs in meters (gear materials repeat 1/tile).
function clothTube(r0, r1, len, opts = {}) {
  const seg = opts.seg || 20, rows = opts.rows || 14;
  const flat = opts.flat ?? 0.86, bulge = opts.bulge ?? 0.006, fold = opts.fold ?? 0.0045, seed = opts.seed || 1;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, y = t * len;
    const base = r0 + (r1 - r0) * t + bulge * Math.sin(Math.PI * Math.min(1, t * 1.15));
    const endMask = 0.35 + 0.65 * Math.max(Math.pow(1 - t, 3), Math.pow(t, 3) * (opts.cuffFolds ?? 1));
    let arc = 0, px = 0, pz = 0;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const w = Math.sin(a * 3 + y * 38 + seed) * 0.55 + Math.sin(a * 5 - y * 61 + seed * 2.3) * 0.3 + Math.sin(a * 2 + y * 23 + seed * 0.7) * 0.4;
      const ring = Math.pow(Math.max(0, Math.sin(y * 140 + Math.sin(a * 2 + seed) * 1.5)), 6) * (opts.rings ?? 0.6);
      const r = base + fold * endMask * w + fold * 0.8 * ring * endMask;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * flat;
      if (i) arc += Math.hypot(x - px, z - pz);
      px = x; pz = z;
      pos.push(x, y, z); uv.push(arc, y);
    }
  }
  const row = seg + 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
    const a = j * row + i, b = a + 1, c = a + row + 1, d = a + row;
    idx.push(a, d, c, a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // seam: average normals of the duplicated first/last column
  const n = g.attributes.normal;
  for (let j = 0; j <= rows; j++) {
    const a = j * row, b = a + seg;
    const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b), l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

const _ma = new THREE.Matrix4(), _mb = new THREE.Matrix4();

export class Arm {
  constructor(side) {
    this.side = side; // +1 right, -1 left
    this.bones = {};
    this.rest = new Map();
    this.pose = { ...HAND_POSES.open };
    this.real = null; // photo-real hand rig
  }

  async build(opts = {}) {
    const side = this.side;
    const sleeveMat = await materials.gearMaterial('sleeve', { color: opts.sleeveColor || '#8d96a3', roughness: 1 });
    const gloveMat = await materials.gearMaterial('neoprene', { color: opts.gloveColor || '#4a4a4a', roughness: 1, normalScale: 1.3, gray: 1 });
    const padMat = await materials.gearMaterial('leather', { color: '#2e2e2e', roughness: 1.6, normalScale: 1.2, gray: 1 });
    this.materials = { sleeveMat, gloveMat, padMat };
    // bones
    const mk = (name, parent, pos) => { const b = new THREE.Bone(); b.name = name; b.position.set(...pos); if (parent) parent.add(b); this.bones[name] = b; return b; };
    const upper = mk('upper', null, [0, 0, 0]);
    const fore = mk('fore', upper, [0, L1, 0]);
    const hand = mk('hand', fore, [0, L2, 0]);
    const realName = side > 0 ? 'hand_r' : 'hand_l';
    const real = !opts.procedural && hasModel(realName);
    if (!real) {
      for (const f of FINGERS) {
        const b0 = mk(f.name + '0', hand, [f.x * side, 0.086, -0.002]);
        b0.rotation.z = -f.splay * DEG * side;
        const b1 = mk(f.name + '1', b0, [0, f.lens[0], 0]);
        mk(f.name + '2', b1, [0, f.lens[1], 0]);
      }
      const t0 = mk('thumb0', hand, [-0.024 * side, 0.02, -0.012]);
      // thumb rest: points out to the thumb side, forward and toward the palm
      const tdir = new THREE.Vector3(-0.62 * side, 0.72, -0.3).normalize();
      const tz = new THREE.Vector3(0.35 * side, 0.15, 0.92); tz.addScaledVector(tdir, -tz.dot(tdir)).normalize();
      t0.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(tdir, tz), tdir, tz));
      const t1 = mk('thumb1', t0, [0, THUMB.lens[0], 0]);
      mk('thumb2', t1, [0, THUMB.lens[1], 0]);
    }
    for (const k in this.bones) this.rest.set(k, this.bones[k].quaternion.clone());

    upper.updateMatrixWorld(true);
    const boneList = Object.values(this.bones);
    const idxOf = (b) => boneList.indexOf(b);
    // geometry pieces per bone (local space) -> bind pose
    const pieces = []; // {geo, bone, group}
    const add = (geo, bone, group, m4) => { if (m4) geo.applyMatrix4(m4); pieces.push({ geo, bone, group }); };
    const M = (pos = [0, 0, 0], rot = [0, 0, 0], sc = [1, 1, 1]) => new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG)), new THREE.Vector3(...sc));

    // ---- sleeves (cloth with folds)
    add(clothTube(0.058, 0.054, L1 + 0.05, { bulge: 0.004, fold: 0.004, seed: 3 * side }), upper, 0, M([0, -0.02, 0]));
    add(new THREE.SphereGeometry(0.054, 16, 10), fore, 0, M([0, 0.0, 0], [0, 0, 0], [1, 0.82, 0.88]));
    add(clothTube(0.052, 0.046, L2 - 0.045, { bulge: 0.006, fold: 0.0042, seed: 5 * side }), fore, 0, M([0, -0.01, 0]));
    // jacket cuff: band + velcro tab
    add(clothTube(0.047, 0.047, 0.035, { bulge: 0, fold: 0.0015, rings: 0, rows: 3, seed: 7 }), fore, 0, M([0, L2 - 0.085, 0]));
    add(new THREE.TorusGeometry(0.0472, 0.004, 6, 24), fore, 0, M([0, L2 - 0.05, 0], [90, 0, 0], [1, 0.86, 1]));
    add(roundBox(0.032, 0.03, 0.006, 0.0025), fore, 0, M([0.012 * side, L2 - 0.068, 0.041], [0, 0, 6 * side]));
    // glove cuff (neoprene) disappears into the jacket cuff
    add(clothTube(0.04, 0.034, 0.07, { bulge: 0.0, fold: 0.0012, rings: 0.2, rows: 4, seed: 9 }), hand, 1, M([0, -0.062, 0]));
    if (side < 0) {
      // wrist watch on the left arm
      add(new THREE.CylinderGeometry(0.0475, 0.0475, 0.018, 20, 1, true), fore, 2, M([0, L2 - 0.108, 0], [0, 0, 0], [1, 1, 0.88]));
      add(new THREE.CylinderGeometry(0.019, 0.019, 0.012, 20, 1, false), fore, 2, M([0, L2 - 0.108, 0.045], [90, 0, 0]));
    }
    if (!real) {
      // procedural palm + fingers (fallback)
      add(roundBox(0.082, 0.09, 0.032, 0.011), hand, 1, M([0, 0.046, 0.0]));
      add(roundBox(0.074, 0.024, 0.012, 0.005), hand, 2, M([0, 0.077, 0.018]));
      add(roundBox(0.03, 0.04, 0.018, 0.007), hand, 1, M([-0.024 * side, 0.03, -0.012], [0, 0, 18 * side]));
      for (const f of FINGERS) {
        for (let j = 0; j < 3; j++) {
          const r = f.r * (j === 2 ? 0.92 : 1);
          add(capsule(r, f.lens[j] - r * 0.6, 8), this.bones[f.name + j], 1, M([0, r * 0.3, 0]));
        }
      }
      for (let j = 0; j < 3; j++) add(capsule(THUMB.r * (j === 2 ? 0.92 : 1), THUMB.lens[j] - THUMB.r * 0.6, 8), this.bones['thumb' + j], 1, M([0, THUMB.r * 0.3, 0]));
    }

    // merge into one skinned geometry with 3 groups (sleeve, glove, pads)
    const groups = [[], [], []];
    for (const pc of pieces) {
      let g = pc.geo.index ? pc.geo.toNonIndexed() : pc.geo;
      g.applyMatrix4(pc.bone.matrixWorld);
      const n = g.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      const bi = idxOf(pc.bone);
      for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
      groups[pc.group].push(g);
    }
    const parts = groups.map((gs) => (gs.length ? mergeGeometries(gs) : null));
    const used = [], mats = [];
    [sleeveMat, gloveMat, padMat].forEach((m, i) => { if (parts[i]) { used.push(parts[i]); mats.push(m); } });
    const geo = mergeGeometries(used, true);
    const mesh = new THREE.SkinnedMesh(geo, mats);
    mesh.add(upper);
    mesh.bind(new THREE.Skeleton(boneList));
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    this.mesh = mesh;
    if (real) await this._buildRealHand(realName, opts);
    return this;
  }

  // Photo-real hand: re-parent the 25 WebXR joints into finger chains under
  // our 'hand' bone. Calibration frame H (built from the bind pose): Y toward
  // the middle knuckle, X toward the pinky (right hand) / thumb (left hand),
  // Z out of the back of the hand -- the same frame the IK hand bone uses.
  async _buildRealHand(name, opts) {
    const side = this.side;
    const { scene } = await instanceModel(name);
    let skinned = null;
    scene.traverse((o) => { if (o.isSkinnedMesh) skinned = o; });
    const sk = skinned.skeleton;
    const B = new Map(), byName = {};
    sk.bones.forEach((b, i) => { B.set(b.name, sk.boneInverses[i].clone().invert()); byName[b.name] = b; });
    const P = (n) => new THREE.Vector3().setFromMatrixPosition(B.get(n));
    const Pw = P('wrist');
    const Y = P('middle-finger-phalanx-proximal').sub(Pw).normalize();
    const X = side > 0 ? P('pinky-finger-phalanx-proximal').sub(P('index-finger-phalanx-proximal')) : P('index-finger-phalanx-proximal').sub(P('pinky-finger-phalanx-proximal'));
    X.addScaledVector(Y, -X.dot(Y)).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const MH = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(Pw);
    const q = new THREE.Vector3().setFromMatrixScale(B.get('wrist')).x; // quantization scale
    const size = opts.handScale || 1.0;
    // hierarchy
    const parent = { wrist: null };
    const chain = (names) => { for (let i = 0; i < names.length; i++) parent[names[i]] = i ? names[i - 1] : 'wrist'; };
    chain(['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']);
    for (const f of FINGER_NAMES) chain([`${f}-finger-metacarpal`, `${f}-finger-phalanx-proximal`, `${f}-finger-phalanx-intermediate`, `${f}-finger-phalanx-distal`, `${f}-finger-tip`]);
    for (const b of sk.bones) b.removeFromParent();
    const root = new THREE.Object3D(); root.name = 'handRoot';
    _ma.copy(MH).invert().premultiply(_mb.makeScale(size / q, size / q, size / q));
    _ma.decompose(root.position, root.quaternion, root.scale);
    for (const b of sk.bones) {
      const pn = parent[b.name];
      if (pn === undefined) continue;
      const local = pn ? _ma.copy(B.get(pn)).invert().multiply(B.get(b.name)) : _ma.copy(B.get(b.name));
      local.decompose(b.position, b.quaternion, b.scale);
      (pn ? byName[pn] : root).add(b);
    }
    this.bones.hand.add(root);
    // finger joints posed by setHandPose (flexion = rotation about joint X)
    const J = {};
    for (const f of FINGER_NAMES) J[f] = [`${f}-finger-phalanx-proximal`, `${f}-finger-phalanx-intermediate`, `${f}-finger-phalanx-distal`].map((n) => byName[n]);
    J.thumb = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal'].map((n) => byName[n]);
    const rest = new Map(); for (const b of sk.bones) rest.set(b, b.quaternion.clone());
    // thumb opposition axis (in the metacarpal's local frame): the palm's long axis
    const tm = J.thumb[0];
    const tmRot = new THREE.Quaternion(); B.get('thumb-metacarpal').decompose(new THREE.Vector3(), tmRot, new THREE.Vector3());
    const oppAxis = Y.clone().applyQuaternion(tmRot.invert()).normalize();
    skinned.material = this.materials.gloveMat;
    skinned.frustumCulled = false; skinned.castShadow = false; skinned.receiveShadow = false;
    skinned.removeFromParent();
    this.mesh.add(skinned);
    // knuckle guard (rigid on the hand bone, H frame in meters): curved shell over the metacarpals
    const pad = new THREE.CylinderGeometry(0.046, 0.046, 0.02, 18, 1, false, -0.62, 1.24);
    // (cylinder axis = Y: the arc spans the knuckles and bulges out of the back of the hand)
    const padMesh = new THREE.Mesh(pad, this.materials.padMat);
    padMesh.position.set(0.004 * side, 0.079 * size, -0.032 * size);
    padMesh.scale.set(1, 1, 1);
    this.bones.hand.add(padMesh);
    this.real = { skinned, J, rest, root, oppAxis, tm };
  }

  // apply finger pose (blend between open and target pose by w)
  setHandPose(poseName, w = 1, override) {
    const a = HAND_POSES.open, b = HAND_POSES[poseName] || HAND_POSES.grip;
    const tmpQ = this._tq || (this._tq = new THREE.Quaternion()), e = this._te || (this._te = new THREE.Euler());
    const R = this.real;
    for (const f of [...FINGER_NAMES, 'thumb']) {
      for (let j = 0; j < 3; j++) {
        let ang = a[f][j] + (b[f][j] - a[f][j]) * w;
        if (override && override[f]) ang = override[f][j];
        e.set(-ang * DEG, 0, 0);
        if (R) {
          const bone = R.J[f][j];
          bone.quaternion.copy(R.rest.get(bone)).multiply(tmpQ.setFromEuler(e));
        } else {
          const bone = this.bones[f + j];
          bone.quaternion.copy(this.rest.get(f + j)).multiply(tmpQ.setFromEuler(e));
        }
      }
    }
    if (R) {
      // thumb swings across the palm when gripping
      const spread = ((a.thumbSpread || 0) + ((b.thumbSpread || 0) - (a.thumbSpread || 0)) * w) * DEG;
      R.tm.quaternion.multiply(tmpQ.setFromAxisAngle(R.oppAxis, -spread * this.side));
    }
  }

  // 2-bone IK. shoulder (Vector3), wristTarget (Vector3), handQuat (Quaternion), pole (Vector3 dir), all in mesh parent space
  solve(shoulder, target, handQ, pole) {
    const upper = this.bones.upper, fore = this.bones.fore, hand = this.bones.hand;
    const dir = _v1.subVectors(target, shoulder);
    let d = dir.length();
    const maxR = (L1 + L2) * 0.985;
    const sh = _v2.copy(shoulder);
    if (d > maxR) { sh.addScaledVector(dir, (d - maxR) / d); d = maxR; } // stretch: slide shoulder forward
    if (d < 0.08) d = 0.08;
    dir.subVectors(target, sh).normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const bend = _v3.copy(pole); bend.addScaledVector(dir, -bend.dot(dir));
    if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0); bend.normalize();
    const elbow = _v4.copy(sh).addScaledVector(dir, a).addScaledVector(bend, h);
    // upper orientation: Y toward elbow, Z = bend normal
    const yU = _v5.subVectors(elbow, sh).normalize();
    const xU = _v6.crossVectors(yU, bend).normalize();
    const zU = _v7.crossVectors(xU, yU);
    const qU = _q1.setFromRotationMatrix(_m.makeBasis(xU, yU, zU));
    // forearm: Y toward wrist; twist follows 70% of the hand's roll (angle based, never degenerate)
    const yF = _v8.subVectors(target, elbow).normalize();
    const za = _v9.copy(zU).addScaledVector(yF, -zU.dot(yF));
    if (za.lengthSq() < 1e-8) za.copy(xU).addScaledVector(yF, -xU.dot(yF));
    za.normalize();
    const zb = _v10.set(0, 0, 1).applyQuaternion(handQ); zb.addScaledVector(yF, -zb.dot(yF));
    let twist = 0;
    if (zb.lengthSq() > 1e-8) { zb.normalize(); twist = Math.atan2(_v11.crossVectors(za, zb).dot(yF), za.dot(zb)); }
    const zF = za.applyAxisAngle(yF, twist * 0.7).normalize();
    const xF = _v11.crossVectors(yF, zF).normalize();
    const qF = _q2.setFromRotationMatrix(_m.makeBasis(xF, yF, zF)).normalize();
    qU.normalize();
    upper.position.copy(sh);
    upper.quaternion.copy(qU);
    fore.position.set(0, L1, 0);
    fore.quaternion.copy(_q3.copy(qU).invert().multiply(qF));
    hand.position.set(0, L2, 0);
    hand.quaternion.copy(_q3.copy(qF).invert().multiply(handQ));
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3(), _v8 = new THREE.Vector3(), _v9 = new THREE.Vector3(), _v10 = new THREE.Vector3(), _v11 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export async function buildArms(opts) {
  const r = await new Arm(1).build(opts);
  const l = await new Arm(-1).build(opts);
  return { right: r, left: l };
}

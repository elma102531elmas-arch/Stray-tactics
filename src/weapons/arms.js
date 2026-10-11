// First-person arms: one SkinnedMesh per arm (rigid skinning, 2 draw calls:
// sleeve + glove) with a full finger rig, driven by 2-bone IK toward hand
// targets. Built procedurally, no external assets.
import * as THREE from 'three';
import { materials } from '../gfx/materials.js';
import { DEG } from '../core/util.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const L1 = 0.31, L2 = 0.29; // upper arm / forearm

// finger layout for a RIGHT hand; x is mirrored for the left hand (side=-1)
const FINGERS = [
  { name: 'index', x: -0.026, lens: [0.044, 0.026, 0.021], r: 0.0102, splay: -4 },
  { name: 'middle', x: -0.009, lens: [0.048, 0.029, 0.022], r: 0.0104, splay: 0 },
  { name: 'ring', x: 0.009, lens: [0.045, 0.027, 0.021], r: 0.0099, splay: 3 },
  { name: 'pinky', x: 0.025, lens: [0.036, 0.021, 0.018], r: 0.0088, splay: 7 },
];
const THUMB = { lens: [0.036, 0.03, 0.024], r: 0.0118 };

// curl poses: degrees per joint [prox, mid, dist] ; thumb [base, mid, dist]
export const HAND_POSES = {
  open: { index: [6, 8, 6], middle: [6, 8, 6], ring: [7, 9, 6], pinky: [8, 10, 7], thumb: [0, 5, 5] },
  grip: { index: [58, 72, 42], middle: [62, 76, 44], ring: [64, 78, 44], pinky: [66, 78, 42], thumb: [28, 30, 22] },
  trigger: { index: [24, 42, 22], middle: [62, 76, 44], ring: [66, 80, 44], pinky: [70, 80, 42], thumb: [30, 28, 18] },
  fist: { index: [86, 96, 60], middle: [88, 98, 60], ring: [88, 98, 60], pinky: [88, 96, 58], thumb: [40, 45, 40] },
  mag: { index: [40, 50, 30], middle: [46, 55, 34], ring: [50, 58, 34], pinky: [52, 58, 34], thumb: [24, 22, 14] },
  knife: { index: [70, 85, 50], middle: [76, 90, 52], ring: [78, 90, 52], pinky: [80, 88, 50], thumb: [40, 40, 30] },
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

export class Arm {
  constructor(side) {
    this.side = side; // +1 right, -1 left
    this.bones = {};
    this.rest = new Map();
    this.pose = { ...HAND_POSES.open };
  }

  async build(opts = {}) {
    const side = this.side;
    const sleeveMat = await materials.gearMaterial('fabric', { color: opts.sleeveColor || '#ffffff' });
    const gloveMat = await materials.gearMaterial('glove');
    // bones
    const mk = (name, parent, pos) => { const b = new THREE.Bone(); b.name = name; b.position.set(...pos); if (parent) parent.add(b); this.bones[name] = b; return b; };
    const upper = mk('upper', null, [0, 0, 0]);
    const fore = mk('fore', upper, [0, L1, 0]);
    const hand = mk('hand', fore, [0, L2, 0]);
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
    for (const k in this.bones) this.rest.set(k, this.bones[k].quaternion.clone());

    upper.updateMatrixWorld(true);
    const boneList = Object.values(this.bones);
    const idxOf = (b) => boneList.indexOf(b);
    // geometry pieces per bone (local space) -> bind pose
    const pieces = []; // {geo, bone, group}
    const add = (geo, bone, group, m4) => { if (m4) geo.applyMatrix4(m4); pieces.push({ geo, bone, group }); };
    const M = (pos = [0, 0, 0], rot = [0, 0, 0], sc = [1, 1, 1]) => new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG)), new THREE.Vector3(...sc));

    // sleeves
    add(new THREE.CylinderGeometry(0.052, 0.06, L1 + 0.04, 14, 4, true), upper, 0, M([0, L1 / 2, 0]));
    add(new THREE.CylinderGeometry(0.041, 0.052, L2 - 0.03, 14, 5, true), fore, 0, M([0, (L2 - 0.03) / 2, 0]));
    add(new THREE.SphereGeometry(0.052, 14, 8), fore, 0, M([0, 0, 0], [0, 0, 0], [1, 0.8, 1]));
    // rolled cuff
    add(new THREE.TorusGeometry(0.043, 0.0085, 8, 18), fore, 0, M([0, L2 - 0.075, 0], [90, 0, 0]));
    add(new THREE.CylinderGeometry(0.043, 0.045, 0.03, 14, 1, true), fore, 0, M([0, L2 - 0.06, 0]));
    // glove cuff + wrist strap
    add(new THREE.CylinderGeometry(0.036, 0.04, 0.07, 14, 2, false), fore, 1, M([0, L2 - 0.03, 0]));
    add(roundBox(0.074, 0.02, 0.05, 0.008), hand, 1, M([0, 0.006, 0.002]));
    if (side < 0) {
      // wrist watch on the left arm
      add(new THREE.CylinderGeometry(0.0435, 0.0435, 0.018, 16, 1, true), fore, 1, M([0, L2 - 0.105, 0]));
      add(roundBox(0.03, 0.03, 0.012, 0.004), fore, 1, M([0, L2 - 0.105, 0.046]));
    }
    // palm + knuckle guard
    add(roundBox(0.082, 0.09, 0.032, 0.011), hand, 1, M([0, 0.046, 0.0]));
    add(roundBox(0.074, 0.024, 0.012, 0.005), hand, 1, M([0, 0.077, 0.018]));
    add(roundBox(0.03, 0.04, 0.018, 0.007), hand, 1, M([-0.024 * side, 0.03, -0.012], [0, 0, 18 * side]));
    // fingers
    for (const f of FINGERS) {
      for (let j = 0; j < 3; j++) {
        const r = f.r * (j === 2 ? 0.92 : 1);
        add(capsule(r, f.lens[j] - r * 0.6, 8), this.bones[f.name + j], 1, M([0, r * 0.3, 0]));
      }
    }
    for (let j = 0; j < 3; j++) add(capsule(THUMB.r * (j === 2 ? 0.92 : 1), THUMB.lens[j] - THUMB.r * 0.6, 8), this.bones['thumb' + j], 1, M([0, THUMB.r * 0.3, 0]));

    // merge into one skinned geometry with 2 groups
    const groups = [[], []];
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
      groups[pc.group].push(g);
    }
    const g0 = mergeGeometries(groups[0]), g1 = mergeGeometries(groups[1]);
    const geo = mergeGeometries([g0, g1], true);
    const mesh = new THREE.SkinnedMesh(geo, [sleeveMat, gloveMat]);
    mesh.add(upper);
    mesh.bind(new THREE.Skeleton(boneList));
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    this.mesh = mesh;
    return this;
  }

  // apply finger pose (blend between open and target pose by w)
  setHandPose(poseName, w = 1, override) {
    const a = HAND_POSES.open, b = HAND_POSES[poseName] || HAND_POSES.grip;
    const tmpQ = new THREE.Quaternion(), e = new THREE.Euler();
    for (const f of [...FINGERS.map((x) => x.name), 'thumb']) {
      for (let j = 0; j < 3; j++) {
        let ang = a[f][j] + (b[f][j] - a[f][j]) * w;
        if (override && override[f]) ang = override[f][j];
        const bone = this.bones[f + j];
        e.set(-ang * DEG, 0, 0);
        bone.quaternion.copy(this.rest.get(f + j)).multiply(tmpQ.setFromEuler(e));
      }
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

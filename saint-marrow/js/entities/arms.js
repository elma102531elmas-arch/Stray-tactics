// First-person arms: gloved hands with posable finger joints and jacket sleeves, solved with two-bone IK so the
// hands always stay on whatever they hold. Everything lives in viewmodel (camera) space: -Z forward, +X right, +Y up.
//
// Hand frame (right hand): origin at the wrist, fingers extend toward -Z, the palm faces -Y, the thumb is on the -X side.
// The left hand is the same hand mirrored in X.
import * as THREE from '../../lib/three.module.js';
import { RoundedBoxGeometry } from '../../lib/RoundedBoxGeometry.js';
import { applyTriplanar } from './sdf.js';

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);

// A capsule from the origin along -Z, `len` long between the joint centres, radius r0 at the root tapering to r1.
function segment(len, r0, r1 = r0, radial = 10) {
  const pts = [];
  const n = 6;
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * r1, -len + Math.sin(a) * r1 - 0)); }
  for (let i = 0; i <= n; i++) { const a = (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0)); }
  // lathe around Y, then lay along -Z: the profile above runs from the tip (y=-len-r1) to the root cap (y=+r0)
  const prof = pts.map((p) => new THREE.Vector2(Math.max(0.0001, p.x), p.y));
  const g = new THREE.LatheGeometry(prof, radial);
  g.rotateX(Math.PI / 2);          // +Y → +Z, so the tip (negative y) ends up at -Z
  g.computeVertexNormals();
  return g;
}

// finger layout for the right hand: MCP knuckle positions and phalanx lengths
const FINGERS = [
  { x: -0.027, z: -0.094, y: 0.002, len: [0.046, 0.027, 0.022], r: 0.0098, spread: -0.06 },  // index
  { x: -0.008, z: -0.098, y: 0.003, len: [0.050, 0.031, 0.024], r: 0.0102, spread: -0.01 },  // middle
  { x: 0.011, z: -0.094, y: 0.002, len: [0.047, 0.029, 0.022], r: 0.0097, spread: 0.04 },    // ring
  { x: 0.028, z: -0.086, y: 0.0, len: [0.037, 0.022, 0.019], r: 0.0088, spread: 0.10 },      // pinky
];
const THUMB = { pos: [-0.03, -0.012, -0.03], len: [0.04, 0.031, 0.026], r: 0.0112 };

// Poses: finger curls [mcp, pip, dip] in radians (toward the palm); thumb { yaw, roll, curl:[cmc, mcp, ip] }
// Thumb: `d` = direction of the thumb from its base (hand frame), `c` = where the tip curls toward, `curl` per joint.
export const POSES = {
  relaxed: { f: [[0.35, 0.45, 0.25], [0.4, 0.5, 0.3], [0.45, 0.55, 0.3], [0.5, 0.6, 0.35]], t: { d: [-0.6, -0.3, -0.75], c: [0.5, -0.4, -0.3], curl: [0.1, 0.2, 0.2] } },
  open: { f: [[0.12, 0.18, 0.1], [0.12, 0.16, 0.1], [0.15, 0.18, 0.1], [0.2, 0.22, 0.12]], t: { d: [-0.8, -0.15, -0.6], c: [0.5, -0.5, -0.2], curl: [0.05, 0.1, 0.1] } },
  grip: { f: [[1.0, 1.2, 0.75], [1.05, 1.25, 0.8], [1.1, 1.25, 0.8], [1.15, 1.2, 0.75]], t: { d: [-0.25, -0.8, -0.55], c: [0.7, -0.3, -0.2], curl: [0.15, 0.45, 0.35] } },
  trigger: { f: [[0.18, 0.4, 0.3], [1.05, 1.25, 0.8], [1.1, 1.25, 0.8], [1.15, 1.2, 0.75]], t: { d: [-0.3, -0.75, -0.6], c: [0.3, -0.6, -0.2], curl: [0.05, 0.12, 0.1] } },
  torch: { f: [[0.9, 1.15, 0.7], [0.95, 1.15, 0.7], [1.0, 1.15, 0.7], [1.05, 1.1, 0.7]], t: { d: [-0.45, -0.55, -0.7], c: [0.5, -0.6, 0.0], curl: [0.1, 0.25, 0.2] } },
  support: { f: [[0.7, 0.85, 0.5], [0.75, 0.9, 0.5], [0.8, 0.9, 0.55], [0.85, 0.9, 0.55]], t: { d: [-0.55, -0.5, -0.65], c: [0.4, -0.6, -0.1], curl: [0.1, 0.2, 0.15] } },
  pinch: { f: [[0.55, 0.65, 0.4], [1.15, 1.35, 0.85], [1.25, 1.4, 0.85], [1.3, 1.4, 0.85]], t: { d: [-0.35, -0.6, -0.7], c: [0.6, -0.5, -0.2], curl: [0.2, 0.35, 0.3] } },
  mag: { f: [[0.9, 1.0, 0.6], [0.95, 1.05, 0.6], [1.0, 1.1, 0.65], [1.1, 1.15, 0.7]], t: { d: [-0.35, -0.65, -0.65], c: [0.6, -0.5, -0.1], curl: [0.1, 0.25, 0.2] } },
  overhand: { f: [[0.7, 0.95, 0.55], [0.75, 1.0, 0.55], [0.8, 1.0, 0.55], [0.85, 1.0, 0.55]], t: { d: [-0.45, -0.6, -0.65], c: [0.6, -0.5, -0.1], curl: [0.15, 0.3, 0.25] } },
  fist: { f: [[1.2, 1.35, 0.85], [1.25, 1.35, 0.85], [1.3, 1.35, 0.85], [1.3, 1.3, 0.85]], t: { d: [-0.15, -0.85, -0.5], c: [0.8, -0.2, -0.2], curl: [0.2, 0.55, 0.45] } },
};

export function makeArmMaterials(detail) {
  const glove = new THREE.MeshStandardMaterial({ color: 0x3a312a, roughness: 0.55, metalness: 0, envMapIntensity: 0.5 });
  const knit = new THREE.MeshStandardMaterial({ color: 0x1a1918, roughness: 0.95, envMapIntensity: 0.2 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x353a2c, roughness: 0.92, envMapIntensity: 0.25 });
  if (detail?.map) {
    applyTriplanar(glove, detail.map, { scale: 55, bump: 0.006 });
    applyTriplanar(jacket, detail.map, { scale: 18, bump: 0.015 });
  }
  return { glove, knit, jacket };
}

export class Hand {
  constructor(mats, side = 1) {
    this.side = side;
    this.group = new THREE.Group();          // wrist frame
    const inner = new THREE.Group();          // mirrored for the left hand
    if (side < 0) inner.scale.x = -1;
    this.group.add(inner);
    this.inner = inner;
    const glove = mats.glove;
    // palm and back of the hand
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.03, 0.094, 3, 0.012), glove);
    palm.position.set(0.001, -0.002, -0.05);
    inner.add(palm);
    const heel = new THREE.Mesh(new RoundedBoxGeometry(0.066, 0.034, 0.04, 3, 0.014), glove);
    heel.position.set(-0.003, -0.004, -0.012);
    inner.add(heel);
    // knit cuff of the glove, tucked into the sleeve
    const cuff = new THREE.Mesh(segment(0.022, 0.031, 0.03, 14), mats.knit);
    cuff.position.set(0, -0.002, 0.012);
    cuff.scale.set(1, 0.82, 1);
    inner.add(cuff);
    this.fingers = FINGERS.map((F) => {
      const joints = [];
      let parent = inner;
      F.len.forEach((L, i) => {
        const j = new THREE.Group();
        if (i === 0) { j.position.set(F.x, F.y, F.z); j.rotation.order = 'YXZ'; j.rotation.y = -F.spread * 0.6; }
        else j.position.set(0, 0, -F.len[i - 1]);
        const r0 = F.r * (1 - i * 0.07), r1 = F.r * (1 - (i + 1) * 0.07);
        const m = new THREE.Mesh(segment(L, r0, r1), glove);
        j.add(m);
        parent.add(j);
        joints.push(j);
        parent = j;
      });
      return joints;
    });
    // thumb: base joint with yaw/roll, then three curling segments
    this.thumbBase = new THREE.Group();
    this.thumbBase.position.set(...THUMB.pos);
        inner.add(this.thumbBase);
    this.thumb = [];
    let parent = this.thumbBase;
    THUMB.len.forEach((L, i) => {
      const j = new THREE.Group();
      if (i > 0) j.position.set(0, 0, -THUMB.len[i - 1]);
      const m = new THREE.Mesh(segment(L, THUMB.r * (1 - i * 0.1), THUMB.r * (1 - (i + 1) * 0.1)), glove);
      j.add(m);
      parent.add(j);
      this.thumb.push(j);
      parent = j;
    });
    this.pose = clonePose(POSES.relaxed);
    this.target = clonePose(POSES.relaxed);
    this.apply();
  }

  /** Blend toward a named pose (or pose object). k = 1 snaps. */
  setPose(p, k = 1) { const P = typeof p === 'string' ? POSES[p] : p; copyPose(this.target, P); if (k >= 1) { copyPose(this.pose, P); this.apply(); } }

  update(dt, speed = 18) {
    const a = 1 - Math.exp(-speed * dt);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) this.pose.f[i][j] += (this.target.f[i][j] - this.pose.f[i][j]) * a;
    for (let j = 0; j < 3; j++) { this.pose.t.d[j] += (this.target.t.d[j] - this.pose.t.d[j]) * a; this.pose.t.c[j] += (this.target.t.c[j] - this.pose.t.c[j]) * a; this.pose.t.curl[j] += (this.target.t.curl[j] - this.pose.t.curl[j]) * a; }
    this.apply();
  }

  apply() {
    const P = this.pose;
    this.fingers.forEach((joints, i) => joints.forEach((j, k) => { j.rotation.x = -P.f[i][k]; }));
    const T = P.t;
    // thumb frame: -Z along d, -Y toward the curl target c (segments curl toward -Y)
    const Z = _ta.set(-T.d[0], -T.d[1], -T.d[2]).normalize();
    const Y = _tb.set(-T.c[0], -T.c[1], -T.c[2]);
    Y.addScaledVector(Z, -Y.dot(Z)).normalize();
    const X = _tc.crossVectors(Y, Z);
    _tm.makeBasis(X, Y, Z);
    this.thumbBase.quaternion.setFromRotationMatrix(_tm);
    this.thumb.forEach((j, k) => { j.rotation.x = -T.curl[k]; });
  }
}

function clonePose(p) { return { f: p.f.map((a) => a.slice()), t: { d: p.t.d.slice(), c: p.t.c.slice(), curl: p.t.curl.slice() } }; }
function copyPose(dst, src) { for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) dst.f[i][j] = src.f[i][j]; for (let j = 0; j < 3; j++) { dst.t.d[j] = src.t.d[j]; dst.t.c[j] = src.t.c[j]; dst.t.curl[j] = src.t.curl[j]; } }
const _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _tc = new THREE.Vector3(), _tm = new THREE.Matrix4();

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

/** Shoulder → elbow → wrist chain. solve() places everything from a shoulder point and a wrist transform. */
export class Arm {
  constructor(mats, side = 1, { upper = 0.31, fore = 0.30 } = {}) {
    this.side = side;
    this.upperLen = upper; this.foreLen = fore;
    this.group = new THREE.Group();
    this.upper = new THREE.Mesh(segment(upper, 0.058, 0.05, 14), mats.jacket);
    this.fore = new THREE.Group();
    const sleeve = new THREE.Mesh(segment(fore - 0.035, 0.05, 0.043, 14), mats.jacket);
    this.fore.add(sleeve);
    // rolled cuff at the end of the sleeve
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.009, 8, 18), mats.jacket);
    cuff.position.z = -(fore - 0.04);
    this.fore.add(cuff);
    // a couple of creases so the sleeve reads as cloth
    for (const t of [0.35, 0.6]) { const c = new THREE.Mesh(new THREE.TorusGeometry(0.047 - t * 0.006, 0.006, 6, 16), mats.jacket); c.position.z = -fore * t; c.rotation.x = 0.15 * (t - 0.4); this.fore.add(c); }
    this.hand = new Hand(mats, side);
    this.group.add(this.upper, this.fore, this.hand.group);
    this.elbow = new THREE.Vector3();
    this.wrist = new THREE.Vector3();
  }

  /**
   * shoulder: Vector3; wristPos/wristQuat: hand frame; pole: direction the elbow should bend toward.
   * If the wrist is out of reach the shoulder slides toward it (it is off-screen, so a shrug is invisible).
   */
  solve(shoulder, wristPos, wristQuat, pole) {
    const a = this.upperLen, b = this.foreLen;
    const S = _a.copy(shoulder);
    const W = this.wrist.copy(wristPos);
    const dir = _b.subVectors(W, S);
    let d = dir.length();
    const maxD = a + b - 0.002, minD = Math.abs(a - b) + 0.02;
    if (d > maxD) { dir.normalize(); S.copy(W).addScaledVector(dir, -maxD); d = maxD; }
    else if (d < minD) { dir.normalize(); S.copy(W).addScaledVector(dir, -minD); d = minD; }
    else dir.divideScalar(d);
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    // bend direction: the pole with its component along the arm removed
    const bend = _c.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0);
    bend.normalize();
    this.elbow.copy(S).addScaledVector(dir, a * cosA).addScaledVector(bend, a * sinA);
    place(this.upper, S, this.elbow, bend);
    place(this.fore, this.elbow, W, bend);
    this.hand.group.position.copy(W);
    this.hand.group.quaternion.copy(wristQuat);
  }
}

// orient an object whose geometry runs along -Z from `from` to `to`, with +Y roughly toward `up`
function place(obj, from, to, up) {
  obj.position.copy(from);
  _m.lookAt(from, to, up);           // lookAt makes -Z point at `to`... for objects that look along +Z it is reversed, so build directly
  const z = _q.setFromRotationMatrix(_m);
  obj.quaternion.copy(z);
}

/** Build a quaternion from basis vectors given in the parent frame (x, y, z need not be exactly orthogonal). */
export function basisQuat(x, y, out = new THREE.Quaternion()) {
  const X = new THREE.Vector3().copy(x).normalize();
  const Z = new THREE.Vector3().crossVectors(X, y).normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X);
  _m.makeBasis(X, Y, Z);
  return out.setFromRotationMatrix(_m);
}

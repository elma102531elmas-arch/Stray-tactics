// Hit boxes fitted to the creature's own mesh: one capsule per bone, measured from the vertices that bone moves.
// Built once per creature template (bind pose), then carried by the bones, so they bend at elbows and knees and
// follow every animation exactly like the visible body.
import * as THREE from '../../lib/three.module.js';

export const PART_OF = {
  head: 'head', neck: 'body', hips: 'body', spine: 'body', chest: 'body', clavL: 'body', clavR: 'body',
  armL: 'arm', foreL: 'arm', handL: 'arm', armR: 'arm', foreR: 'arm', handR: 'arm',
  thighL: 'leg', shinL: 'leg', footL: 'leg', thighR: 'leg', shinR: 'leg', footR: 'leg',
};
// the next joint down each chain gives a bone its long axis
const CHILD = { hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', armL: 'foreL', foreL: 'handL', armR: 'foreR', foreR: 'handR', thighL: 'shinL', shinL: 'footL', thighR: 'shinR', shinR: 'footR', clavL: 'armL', clavR: 'armR' };

const quantile = (arr, q) => { if (!arr.length) return 0; const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };

/**
 * geos: skinned BufferGeometries in bind space (skinIndex/skinWeight attributes), boneOrder: names by index,
 * bonePos: name -> Vector3 bind-space position of each bone (bones carry no rotation at bind time).
 * Returns [{ bone, part, a: Vector3, b: Vector3, r }] with a/b in the bone's local space.
 */
export function fitHitboxes(geos, boneOrder, bonePos) {
  const pts = {};
  for (const name of boneOrder) pts[name] = [];
  for (const geo of geos) {
    const P = geo.attributes.position, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
    if (!SI || !SW) continue;
    for (let i = 0; i < P.count; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
      if (bw < 0.45) continue;          // blended skin between two bones belongs to neither capsule on its own
      const name = boneOrder[best];
      if (name) pts[name].push(new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)));
    }
  }
  const out = [];
  for (const name of boneOrder) {
    const list = pts[name];
    if (list.length < 24 || !PART_OF[name]) continue;
    const origin = bonePos[name];
    const local = list.map((p) => p.clone().sub(origin));
    // axis: toward the child joint, else the principal direction of the points
    let axis;
    if (CHILD[name] && bonePos[CHILD[name]]) axis = bonePos[CHILD[name]].clone().sub(origin).normalize();
    else axis = principal(local);
    const c = new THREE.Vector3();
    for (const p of local) c.add(p);
    c.divideScalar(local.length);
    const proj = local.map((p) => p.clone().sub(c).dot(axis));
    const t0 = quantile(proj, 0.02), t1 = quantile(proj, 0.98);
    const dist = local.map((p, i) => p.clone().sub(c).addScaledVector(axis, -proj[i]).length());
    const r = quantile(dist, 0.85);
    // capsule caps add r at each end
    const half = Math.max(0, (t1 - t0) / 2 - r * 0.5);
    const mid = c.clone().addScaledVector(axis, (t0 + t1) / 2);
    out.push({ bone: name, part: PART_OF[name], a: mid.clone().addScaledVector(axis, -half), b: mid.clone().addScaledVector(axis, half), r });
  }
  return out;
}

function principal(pts) {
  // power iteration on the covariance matrix
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.divideScalar(pts.length);
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z;
    m[0] += x * x; m[1] += x * y; m[2] += x * z; m[4] += y * y; m[5] += y * z; m[8] += z * z;
  }
  m[3] = m[1]; m[6] = m[2]; m[7] = m[5];
  let v = new THREE.Vector3(0.3, 1, 0.2).normalize();
  for (let i = 0; i < 30; i++) v = new THREE.Vector3(m[0] * v.x + m[1] * v.y + m[2] * v.z, m[3] * v.x + m[4] * v.y + m[5] * v.z, m[6] * v.x + m[7] * v.y + m[8] * v.z).normalize();
  return v;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _s = new THREE.Vector3();

/** Ray (origin o, unit direction d) against the fitted capsules of one creature instance. */
export function raycastHitboxes(boxes, bones, o, d, maxT) {
  let best = null;
  for (const h of boxes) {
    const bone = bones[h.bone];
    if (!bone) continue;
    const M = bone.matrixWorld;
    _a.copy(h.a).applyMatrix4(M);
    _b.copy(h.b).applyMatrix4(M);
    _s.setFromMatrixScale(M);
    const r = h.r * Math.max(_s.x, _s.y, _s.z);
    const t = rayCapsule(o, d, _a, _b, r);
    if (t !== null && t > 0 && t < maxT && (!best || t < best.t)) best = { t, part: h.part, bone: h.bone };
  }
  if (best) best.point = o.clone().addScaledVector(d, best.t);
  return best;
}

export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return null;
  const s = Math.sqrt(h);
  const t = -b - s;
  return t > 0 ? t : (-b + s > 0 ? 0 : null);
}

// capsule a-b radius r (Inigo Quilez' formulation)
export function rayCapsule(o, d, a, b, r) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const oax = o.x - a.x, oay = o.y - a.y, oaz = o.z - a.z;
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-10) return raySphere(o, d, a, r);
  const bard = bax * d.x + bay * d.y + baz * d.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const A = baba - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - r * r * baba;
  const h = B * B - A * C;
  if (h >= 0 && A > 1e-12) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t > 0 ? t : null;
    // caps
    const ox = y <= 0 ? oax : o.x - b.x, oy = y <= 0 ? oay : o.y - b.y, oz = y <= 0 ? oaz : o.z - b.z;
    const bb = d.x * ox + d.y * oy + d.z * oz;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const hh = bb * bb - cc;
    if (hh > 0) { const tt = -bb - Math.sqrt(hh); return tt > 0 ? tt : null; }
    return null;
  }
  // ray parallel to the axis: test both end spheres
  const t1 = raySphere(o, d, a, r), t2 = raySphere(o, d, b, r);
  if (t1 === null) return t2; if (t2 === null) return t1; return Math.min(t1, t2);
}

/** Wireframe capsules for the debug overlay (one LineSegments per box, parented to its bone). */
export function hitboxHelpers(boxes, bones) {
  const colors = { head: 0xff3030, body: 0xffc040, arm: 0x40c0ff, leg: 0x60ff60 };
  const list = [];
  for (const h of boxes) {
    const bone = bones[h.bone];
    if (!bone) continue;
    const len = h.a.distanceTo(h.b);
    const g = new THREE.CapsuleGeometry(h.r, len, 3, 8);
    const m = new THREE.LineSegments(new THREE.WireframeGeometry(g), new THREE.LineBasicMaterial({ color: colors[h.part], depthTest: false, transparent: true, opacity: 0.8 }));
    m.position.copy(h.a).add(h.b).multiplyScalar(0.5);
    const dir = h.b.clone().sub(h.a);
    if (dir.lengthSq() > 1e-8) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.renderOrder = 999;
    m.frustumCulled = false;
    bone.add(m);
    list.push(m);
  }
  return list;
}

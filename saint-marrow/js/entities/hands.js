// First-person gloved hands sculpted with the SDF tool (static grip poses, high resolution).
import * as THREE from '../../lib/three.module.js';
import { buildSurface, applyTriplanar } from './sdf.js';
import { fbm3 } from '../util.js';

const cone = (a, b, r1, r2, k = 0.006) => ({ type: 'cone', a, b, r1, r2, k });
const ell = (c, r, k = 0.008) => ({ type: 'ell', c, r, k });

// Right hand wrapped around a vertical cylinder of radius R centred on the Y axis.
// Fingers wrap from +X around the front (-Z) toward -X. Wrist/forearm leave toward +Z/-Y.
function gripPrims(R, opts = {}) {
  const P = [];
  const fr = 0.0095;                 // finger radius
  const ring = R + fr * 0.9;
  const at = (ang, y, rr = ring) => [Math.cos(ang) * rr, y, Math.sin(ang) * rr];
  const fingerYs = opts.trigger ? [0.0, -0.022, -0.043] : [0.032, 0.011, -0.011, -0.033];
  const lens = opts.trigger ? [1, 0.95, 0.78] : [1.0, 1.05, 0.98, 0.82];
  fingerYs.forEach((y, i) => {
    const L = lens[i];
    const k0 = at(0.55, y, ring + 0.013);
    const k1 = at(-0.35 * L, y, ring + 0.004);
    const k2 = at(-1.35 * L, y - 0.002, ring);
    const k3 = at(-2.15 * L, y - 0.004, ring - 0.002);
    P.push(cone(k0, k1, fr * 1.12, fr * 1.02, 0.004));
    P.push(cone(k1, k2, fr * 1.02, fr * 0.95, 0.003));
    P.push(cone(k2, k3, fr * 0.95, fr * 0.8, 0.003));
  });
  if (opts.trigger) {
    // index finger reaching forward to the trigger
    const y = opts.triggerY ?? 0.04;
    const k0 = at(0.4, y - 0.01, ring + 0.012);
    const k1 = [R * 0.4 + 0.004, y, -R - 0.026];
    const k2 = [-0.004, y - 0.004, -R - 0.034];
    const k3 = [-0.006, y - 0.014, -R - 0.026];
    P.push(cone(k0, k1, fr * 1.1, fr, 0.004));
    P.push(cone(k1, k2, fr, fr * 0.92, 0.003));
    P.push(cone(k2, k3, fr * 0.92, fr * 0.78, 0.003));
  }
  const yTop = Math.max(...fingerYs) + (opts.trigger ? 0.045 : 0.012);
  const yBot = Math.min(...fingerYs);
  // palm and back of the hand sit on the +X/+Z side of the cylinder
  P.push(ell([R + 0.016, (yTop + yBot) / 2 - 0.004, 0.012], [0.02, (yTop - yBot) / 2 + 0.022, 0.034], 0.012));
  P.push(ell([R * 0.3 + 0.006, (yTop + yBot) / 2 - 0.01, R + 0.012], [0.024, (yTop - yBot) / 2 + 0.02, 0.016], 0.014));
  // thumb along the far side
  const t0 = [R * 0.2, yTop - 0.012, R + 0.016];
  const t1 = [-R * 0.55, yTop - 0.002, R * 0.6];
  const t2 = [-R - 0.006, yTop + 0.004, -R * 0.15];
  const t3 = [-R - 0.008, yTop + 0.005, -R * 0.75];
  P.push(cone(t0, t1, 0.013, 0.011, 0.008));
  P.push(cone(t1, t2, 0.011, 0.0095, 0.004));
  P.push(cone(t2, t3, 0.0095, 0.008, 0.003));
  // wrist + forearm
  const wrist = [R + 0.014, yBot - 0.028, 0.03];
  const elbow = [R + 0.07, yBot - 0.16, 0.36];
  P.push(cone(wrist, elbow, 0.03, 0.04, 0.025));
  P.push(ell([R + 0.012, yBot - 0.01, 0.024], [0.026, 0.03, 0.03], 0.02));
  return { prims: P, wrist, elbow };
}

function sleevePrims(wrist, elbow) {
  const d = [elbow[0] - wrist[0], elbow[1] - wrist[1], elbow[2] - wrist[2]];
  const a = [wrist[0] + d[0] * 0.18, wrist[1] + d[1] * 0.18, wrist[2] + d[2] * 0.18];
  const b = [elbow[0] + d[0] * 0.4, elbow[1] + d[1] * 0.4, elbow[2] + d[2] * 0.4];
  const P = [cone(a, b, 0.043, 0.058, 0.02)];
  // cuff ridge
  P.push(cone(a, [a[0] + d[0] * 0.08, a[1] + d[1] * 0.08, a[2] + d[2] * 0.08], 0.046, 0.046, 0.01));
  // folds
  for (let i = 0; i < 4; i++) {
    const t = 0.25 + i * 0.17;
    const c = [wrist[0] + d[0] * t, wrist[1] + d[1] * t, wrist[2] + d[2] * t];
    P.push(ell(c, [0.05 + i * 0.003, 0.012, 0.05 + i * 0.003], 0.02));
  }
  return P;
}

function colorize(geo, fn) {
  const p = geo.attributes.position;
  const c = new Float32Array(p.count * 3), w = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) { const v = fn(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = v[0]; c[i * 3 + 1] = v[1]; c[i * 3 + 2] = v[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.setAttribute('aWet', new THREE.BufferAttribute(w, 1));
}

let detailTex = null;
export function makeHand(kind, assets, detail, quality = 'medium') {
  detailTex = detail.map;
  const voxel = quality === 'low' ? 0.0042 : 0.0032;
  const R = kind === 'flash' ? 0.019 : kind === 'rifle' ? 0.02 : kind === 'crowbar' ? 0.014 : 0.0155;
  const g = gripPrims(R, { trigger: kind === 'pistol' || kind === 'rifleGrip', triggerY: 0.045 });
  const hand = buildSurface(g.prims, voxel, { smooth: 2 });
  colorize(hand, (x, y, z) => {
    const n = fbm3(x * 90, y * 90, z * 90, 2);
    const knuckle = n > 0.25 ? 0.02 : 0;
    return [0.03 + n * 0.008 + knuckle, 0.03 + n * 0.008 + knuckle, 0.032 + n * 0.008 + knuckle];
  });
  const sleeve = buildSurface(sleevePrims(g.wrist, g.elbow), voxel * 1.6, { smooth: 2 });
  colorize(sleeve, (x, y, z) => { const n = fbm3(x * 30, y * 30, z * 30, 2) * 0.02; return [0.045 + n, 0.055 + n, 0.04 + n]; });
  const gloveMat = applyTriplanar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, envMapIntensity: 0.6 }), detail.map, { scale: 40, bump: 0.01 });
  const sleeveMat = applyTriplanar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.3 }), detail.map, { scale: 14, bump: 0.02 });
  const grp = new THREE.Group();
  const m1 = new THREE.Mesh(hand, gloveMat), m2 = new THREE.Mesh(sleeve, sleeveMat);
  grp.add(m1, m2);
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  return grp;
}

export function mirrorX(obj) {
  // a negative scale flips the winding; three.js compensates automatically
  obj.scale.x *= -1;
  return obj;
}

// Creature & human body definitions built with the SDF sculptor, plus procedural animation.
import * as THREE from '../../lib/three.module.js';
import { buildSurface, skinGeometry, applyTriplanar, evalPrim } from './sdf.js';
import { fbm3, noise3, clamp, lerp } from '../util.js';

const BONE_ORDER = ['hips', 'spine', 'chest', 'neck', 'head', 'clavL', 'armL', 'foreL', 'handL', 'clavR', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const PARENT = { hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', clavL: 'chest', armL: 'clavL', foreL: 'armL', handL: 'foreL', clavR: 'chest', armR: 'clavR', foreR: 'armR', handR: 'foreR', thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR' };

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Joint positions for a standing figure facing +Z (character's left = +X).
export function joints(P) {
  const leg = P.leg ?? 1, arm = P.arm ?? 1, hu = P.hunch ?? 0, sh = P.sh ?? 0.19;
  const J = {};
  J.hips = [0, 0.95 * leg, 0];
  J.spine = addv(J.hips, [0, 0.13, hu * 0.05]);
  J.chest = addv(J.spine, [0, 0.2 * (P.torso ?? 1), hu * 0.35]);
  J.neck = addv(J.chest, [0, 0.22 * (P.torso ?? 1), hu * 0.55]);
  J.head = addv(J.neck, [0, 0.09 * (P.neckLen ?? 1), hu * 0.35]);
  J.headTop = addv(J.head, [0, 0.22, 0.01]);
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    J['clav' + S] = addv(J.chest, [s * 0.035, 0.15 * (P.torso ?? 1), hu * 0.3]);
    J['arm' + S] = addv(J.chest, [s * sh, 0.15 * (P.torso ?? 1), hu * 0.3]);
    J['fore' + S] = addv(J['arm' + S], [s * 0.05, -0.28 * arm, -0.01]);
    J['hand' + S] = addv(J['fore' + S], [s * 0.025, -0.255 * arm, 0.035]);
    J['tip' + S] = addv(J['hand' + S], [s * 0.008, -0.17 * (P.hand ?? 1), 0.02]);
    J['thigh' + S] = addv(J.hips, [s * 0.095, -0.03, 0]);
    J['shin' + S] = addv(J['thigh' + S], [s * 0.012, -0.43 * leg, 0.02]);
    J['foot' + S] = addv(J['shin' + S], [0, -0.42 * leg + 0.03, -0.025]);
    J['toe' + S] = addv(J['foot' + S], [s * 0.012, -0.05, 0.16 * (P.foot ?? 1)]);
  }
  return J;
}

function cone(bone, a, b, r1, r2, k = 0.03, extra = {}) { return Object.assign({ type: 'cone', bone, a, b, r1, r2, k }, extra); }
function ell(bone, c, r, k = 0.03, extra = {}) { return Object.assign({ type: 'ell', bone, c, r, k }, extra); }

function handPrims(J, S, s, fingerLen, thick, claw) {
  const P = [];
  const w = J['hand' + S], tip = J['tip' + S];
  const dir = [tip[0] - w[0], tip[1] - w[1], tip[2] - w[2]];
  const L = Math.hypot(...dir);
  const d = dir.map((v) => v / L);
  const palmC = addv(w, d.map((v) => v * 0.045));
  P.push(ell('hand' + S, palmC, [0.018 * thick, 0.05, 0.042 * thick], 0.025));
  const knuck = addv(w, d.map((v) => v * 0.09));
  for (let f = 0; f < 4; f++) {
    const off = [0, 0, (f - 1.5) * 0.019];
    const len = fingerLen * [0.85, 1, 0.95, 0.75][f];
    const a = addv(knuck, off);
    const curl = claw ? 0.035 : 0.015;
    const m = addv(a, [d[0] * len * 0.55 + s * 0.004, d[1] * len * 0.55, d[2] * len * 0.55 + curl * 0.3]);
    const b = addv(m, [d[0] * len * 0.45 + s * 0.008, d[1] * len * 0.45, d[2] * len * 0.45 + curl]);
    P.push(cone('hand' + S, a, m, 0.0105 * thick, 0.0095 * thick, 0.008));
    P.push(cone('hand' + S, m, b, 0.0095 * thick, claw ? 0.004 : 0.0075 * thick, 0.006));
  }
  const ta = addv(w, [s * 0.006, d[1] * 0.03, 0.035]);
  const tb = addv(ta, [s * 0.012, -0.045, 0.03]);
  const tc = addv(tb, [s * 0.006, -0.03, 0.012]);
  P.push(cone('hand' + S, ta, tb, 0.013 * thick, 0.011 * thick, 0.012));
  P.push(cone('hand' + S, tb, tc, 0.011 * thick, 0.008 * thick, 0.006));
  return P;
}

// ------------------------------------------------------------------ body recipes
function bodyPrims(kind, J, P) {
  const L = [];
  const thin = P.thin ?? 1;          // 1 = normal, <1 = emaciated
  const bulk = P.bulk ?? 1;          // clothing bulk
  // torso
  L.push(ell('hips', addv(J.hips, [0, 0.0, -0.005]), [0.15 * bulk, 0.11, 0.1 * bulk], 0.06));
  L.push(cone('spine', J.hips, J.chest, 0.11 * thin * bulk, 0.13 * thin * bulk, 0.06, kind === 'hollow' ? { r: 1 } : {}));
  const ribs = ell('chest', addv(J.chest, [0, 0.06, 0.005]), [0.165 * bulk * (0.8 + thin * 0.2), 0.17, 0.115 * bulk * (0.85 + thin * 0.15)], 0.07);
  if (kind === 'hollow' || kind === 'warden') {
    // visible ribs and a sunken belly on the emaciated ones
    const c = ribs.c;
    ribs.noise = (x, y, z) => {
      const dy = y - c[1];
      if (dy > 0.12 || dy < -0.16) return 0;
      const side = Math.abs(x - c[0]) / 0.17;
      return -0.0045 * Math.max(0, Math.sin((dy + 0.4) * 75)) * clamp(side * 1.6, 0, 1) - (z > c[2] + 0.06 && dy < -0.08 ? 0.01 : 0);
    };
    L.push(ell('spine', addv(J.spine, [0, 0.02, 0.03]), [0.09 * thin, 0.07, 0.045], 0.03, { sub: true, k: 0.05 }));
  }
  L.push(ribs);
  // shoulders / collar
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    L.push(cone('clav' + S, J['clav' + S], J['arm' + S], 0.045 * bulk, 0.05 * bulk, 0.04));
    L.push(ell('arm' + S, addv(J['arm' + S], [s * 0.005, -0.02, 0]), [0.055 * bulk, 0.06, 0.055 * bulk], 0.035));
  }
  // neck & head
  L.push(cone('neck', addv(J.neck, [0, -0.03, -0.01]), J.head, 0.05 * (thin * 0.6 + 0.4) * (P.neckW ?? 1), 0.045 * (P.neckW ?? 1), 0.04));
  const hc = addv(J.head, [0, 0.105, 0.01]);
  if (P.sackHead) {
    const sack = ell('head', addv(hc, [0, 0.01, 0]), [0.11, 0.14, 0.12], 0.03);
    sack.noise = (x, y, z) => fbm3(x * 14, y * 14, z * 14, 3) * 0.012 + Math.max(0, hc[1] + 0.12 - y) * 0;
    L.push(sack);
    // sack gathered and tied below the jaw
    L.push(cone('head', addv(J.head, [0, 0.02, 0]), addv(J.head, [0, -0.02, 0]), 0.06, 0.055, 0.02));
    L.push(ell('head', addv(hc, [0, 0.16, -0.01]), [0.05, 0.05, 0.05], 0.05));
    // stitched eye holes
    for (const s of [1, -1]) L.push(ell('head', addv(hc, [s * 0.04, 0.025, 0.115]), [0.017, 0.012, 0.03], 0.01, { sub: true, k: 0.01 }));
  } else if (P.hood) {
    L.push(ell('head', hc, [0.105, 0.125, 0.115], 0.04));
  } else {
    // skull
    L.push(ell('head', hc, [0.085 * (P.headW ?? 1), 0.11, 0.1], 0.03));
    // cheekbones + jaw
    L.push(ell('head', addv(hc, [0, -0.06, 0.035]), [0.07 * thin + 0.01, 0.055, 0.07], 0.035));
    for (const s of [1, -1]) L.push(ell('head', addv(hc, [s * 0.05, -0.015, 0.065]), [0.025, 0.02, 0.025], 0.02));
    // brow ridge
    L.push(cone('head', addv(hc, [-0.045, 0.03, 0.082]), addv(hc, [0.045, 0.03, 0.082]), 0.017, 0.017, 0.02));
    // nose
    L.push(cone('head', addv(hc, [0, 0.015, 0.098]), addv(hc, [0, -0.025, 0.11]), 0.008, 0.012, 0.01));
    // eye sockets
    for (const s of [1, -1]) L.push(ell('head', addv(hc, [s * 0.033, 0.006, 0.09]), [0.021, 0.016, 0.02], 0.012, { sub: true, k: 0.012 }));
    if (P.openJaw) {
      L.push(ell('head', addv(hc, [0, -0.085, 0.07]), [0.03, 0.035 * P.openJaw, 0.04], 0.012, { sub: true, k: 0.015 }));
      L.push(ell('head', addv(hc, [0, -0.13, 0.04]), [0.05, 0.03, 0.055], 0.03));
    }
  }
  // arms
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    L.push(cone('arm' + S, J['arm' + S], J['fore' + S], 0.046 * thin * bulk, 0.036 * thin * bulk, 0.025));
    L.push(ell('arm' + S, mix3(J['arm' + S], J['fore' + S], 0.4), [0.042 * thin * bulk, 0.08, 0.045 * thin * bulk], 0.03));
    L.push(cone('fore' + S, J['fore' + S], J['hand' + S], 0.037 * thin * bulk, 0.026 * (0.6 + thin * 0.4) * bulk, 0.02));
    L.push(...handPrims(J, S, s, P.finger ?? 0.085, P.handThick ?? 1, !!P.claw));
    // legs
    L.push(cone('thigh' + S, J['thigh' + S], J['shin' + S], 0.078 * thin * bulk, 0.048 * thin * bulk, 0.04));
    L.push(ell('thigh' + S, mix3(J['thigh' + S], J['shin' + S], 0.35), [0.07 * thin * bulk, 0.13, 0.072 * thin * bulk], 0.04));
    L.push(ell('shin' + S, addv(J['shin' + S], [0, 0.0, 0.01]), [0.042 * bulk, 0.045, 0.045 * bulk], 0.02));
    L.push(cone('shin' + S, J['shin' + S], J['foot' + S], 0.046 * thin * bulk, 0.033 * bulk, 0.025));
    L.push(ell('shin' + S, mix3(J['shin' + S], J['foot' + S], 0.3).map((v, i) => (i === 2 ? v - 0.02 : v)), [0.045 * thin * bulk, 0.1, 0.048 * thin * bulk], 0.03));
    if (P.boots) {
      L.push(ell('foot' + S, mix3(J['foot' + S], J['toe' + S], 0.5).map((v, i) => (i === 1 ? 0.045 : v)), [0.052, 0.05, 0.14], 0.03));
      L.push(cone('shin' + S, addv(J['foot' + S], [0, 0.14, 0]), J['foot' + S], 0.055, 0.055, 0.02));
    } else {
      L.push(cone('foot' + S, J['foot' + S], J['toe' + S], 0.036, 0.024, 0.03));
      L.push(ell('foot' + S, mix3(J['foot' + S], J['toe' + S], 0.55).map((v, i) => (i === 1 ? 0.025 : v)), [0.04, 0.022, 0.09], 0.025));
    }
  }
  if (P.pack) L.push(ell('chest', addv(J.chest, [0, 0.02, -0.17]), [0.15, 0.2, 0.08], 0.03));
  return L;
}

// Colour functions (linear RGB) per vertex.
function hollowColor(x, y, z, J, rng) {
  const n = fbm3(x * 6, y * 6, z * 6, 3);
  let c = [0.25 + n * 0.06, 0.235 + n * 0.05, 0.205 + n * 0.04];
  // bruising and grime
  const b = fbm3(x * 3 + 4, y * 3, z * 3, 3);
  if (b > 0.15) { const k = Math.min(1, (b - 0.15) * 4); c = mix3(c, [0.22, 0.2, 0.24], k * 0.6); }
  const hc = addv(J.head, [0, 0.105, 0.01]);
  // dark around the eyes and mouth
  const de = Math.hypot(x - hc[0], (y - hc[1]) * 1.4, z - (hc[2] + 0.09));
  if (de < 0.07) c = mix3(c, [0.06, 0.03, 0.03], (1 - de / 0.07) * 0.9);
  let wet = 0;
  // blood around the mouth running down the chin and chest
  const mx = x - hc[0], my = y - (hc[1] - 0.09), mz = z - (hc[2] + 0.07);
  const mouth = Math.hypot(mx * 1.5, my, mz);
  const drip = Math.abs(mx) < 0.05 + noise3(x * 30, 0, z * 30) * 0.02 && y < hc[1] - 0.05 && y > J.chest[1] - 0.05 && z > J.chest[2] + 0.05;
  if (mouth < 0.07 || (drip && noise3(x * 20, y * 4, 1) > -0.2)) { c = mix3(c, [0.16, 0.008, 0.008], 0.9); wet = 0.8; }
  // hands caked in blood
  for (const S of ['L', 'R']) { const h = J['hand' + S]; if (y < h[1] + 0.06 && Math.abs(x - h[0]) < 0.12 && noise3(x * 25, y * 25, z * 25) > -0.3) { c = mix3(c, [0.12, 0.01, 0.01], 0.85); wet = Math.max(wet, 0.6); } }
  // stitched surgical scar on the chest
  if (Math.abs(x) < 0.006 && y > J.spine[1] && y < J.chest[1] + 0.15 && z > 0.06) { c = [0.05, 0.01, 0.01]; wet = 0.4; }
  // fresh gashes
  const g = Math.abs(noise3(x * 9, y * 9, z * 9));
  if (g < 0.02 && fbm3(x * 2, y * 2, z * 2, 2) > 0.12) { c = [0.2, 0.01, 0.01]; wet = 1; }
  return [c, wet];
}

function wardenColor(x, y, z, J) {
  const n = fbm3(x * 5, y * 5, z * 5, 3);
  let c = [0.2 + n * 0.05, 0.175 + n * 0.04, 0.16 + n * 0.04];
  let wet = 0;
  const hc = addv(J.head, [0, 0.105, 0.01]);
  if (y > J.neck[1] + 0.03) {
    // burlap sack: brown, stained
    const s = fbm3(x * 12, y * 12, z * 12, 3);
    c = [0.24 + s * 0.05, 0.18 + s * 0.04, 0.11 + s * 0.03];
    if (fbm3(x * 4, y * 4, z * 4, 3) > 0.1 && z > hc[2]) { c = mix3(c, [0.1, 0.01, 0.01], 0.8); wet = 0.3; }
    // rope at the neck
    if (Math.abs(y - (J.head[1] + 0.0)) < 0.018) c = [0.2, 0.17, 0.11];
  }
  for (const S of ['L', 'R']) { const h = J['hand' + S]; if (y < h[1] + 0.12 && Math.abs(x - h[0]) < 0.15) { c = mix3(c, [0.09, 0.01, 0.01], 0.75); wet = 0.5; } }
  const b = fbm3(x * 3, y * 3 + 7, z * 3, 3);
  if (b > 0.2) c = mix3(c, [0.12, 0.02, 0.02], 0.5);
  return [c, wet];
}

function humanColor(x, y, z, J, P) {
  const n = fbm3(x * 8, y * 8, z * 8, 2) * 0.03;
  const suit = (P.suit || [0.08, 0.1, 0.08]).map((v) => v * 1.4 + 0.02);
  let c = suit.map((v) => v + n);
  if (y < J.hips[1] + 0.02) c = (P.pants || [0.05, 0.05, 0.06]).map((v) => v + n);
  if (y < J.footL[1] + 0.14) c = [0.025, 0.022, 0.02];
  for (const S of ['L', 'R']) { const h = J['hand' + S]; if (y < h[1] + 0.03 && Math.abs(x - h[0]) < 0.1) c = [0.03, 0.03, 0.03]; }
  if (y > J.neck[1]) c = [0.04, 0.04, 0.045];
  // reflective strip on the jacket
  if (Math.abs(y - (J.chest[1] - 0.05)) < 0.018 && y > J.hips[1]) c = [0.55, 0.5, 0.25];
  if (P.pack && z < J.chest[2] - 0.09 && y > J.spine[1] && y < J.neck[1]) c = [0.09, 0.07, 0.05];
  return [c, 0];
}

function gownPrims(J) {
  const L = [];
  L.push(ell('chest', addv(J.chest, [0, 0.05, 0.005]), [0.19, 0.19, 0.135], 0.06));
  L.push(cone('spine', J.hips, J.chest, 0.145, 0.155, 0.06));
  L.push(ell('hips', J.hips, [0.16, 0.12, 0.115], 0.05));
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    L.push(cone('thigh' + S, J['thigh' + S], mix3(J['thigh' + S], J['shin' + S], 0.7), 0.075, 0.062, 0.05));
    L.push(cone('arm' + S, addv(J['arm' + S], [-s * 0.02, 0, 0]), mix3(J['arm' + S], J['fore' + S], 0.45), 0.065, 0.058, 0.04));
  }
  // ragged hem
  L.push({ type: 'plane', o: [0, J.shinL[1] + 0.2, 0], n: [0, -1, 0], inter: true, k: 0.01, noise: (x, y, z) => fbm3(x * 10, 0, z * 10, 3) * 0.08 });
  // neckline
  L.push({ type: 'plane', o: [0, J.neck[1] - 0.01, 0], n: [0, 1, 0], inter: true, k: 0.01 });
  return L;
}

function apronPrims(J) {
  const L = [];
  L.push(ell('chest', addv(J.chest, [0, 0.02, 0.03]), [0.2, 0.2, 0.14], 0.08));
  L.push(cone('spine', J.hips, J.chest, 0.15, 0.16, 0.06));
  L.push(ell('hips', J.hips, [0.19, 0.14, 0.13], 0.08));
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    L.push(cone('thigh' + S, J['thigh' + S], mix3(J['shin' + S], J['foot' + S], 0.4), 0.105, 0.08, 0.12));
  }
  L.push({ type: 'plane', o: [0, 0, 0.02], n: [0, 0, -1], inter: true, k: 0.02 });
  L.push({ type: 'plane', o: [0, J.chest[1] + 0.12, 0], n: [0, 1, 0], inter: true, k: 0.02 });
  L.push({ type: 'plane', o: [0, J.shinL[1] - 0.18, 0], n: [0, -1, 0], inter: true, k: 0.01, noise: (x, y, z) => fbm3(x * 6, 1, z * 6, 2) * 0.05 });
  return L;
}

// ------------------------------------------------------------------ build
const cache = {};

export function makeSkeleton(J, scale) {
  const bones = {};
  const list = [];
  for (const name of BONE_ORDER) {
    const b = new THREE.Bone();
    b.name = name;
    const p = J[name];
    const pp = PARENT[name] ? J[PARENT[name]] : [0, 0, 0];
    b.position.set((p[0] - pp[0]) * scale, (p[1] - pp[1]) * scale, (p[2] - pp[2]) * scale);
    bones[name] = b;
    list.push(b);
    if (PARENT[name]) bones[PARENT[name]].add(b);
  }
  return { bones, list };
}

function colorize(geo, fn) {
  const P = geo.attributes.position;
  const col = new Float32Array(P.count * 3), wet = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) {
    const [c, w] = fn(P.getX(i), P.getY(i), P.getZ(i));
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    wet[i] = w;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
}

function scaleGeo(geo, s) { geo.scale(s, s, s); geo.computeBoundingSphere(); }

export const CREATURE_DEFS = {
  hollow: { P: { thin: 0.62, arm: 1.08, finger: 0.1, claw: true, openJaw: 1, neckLen: 1.25, hunch: 0.06, headW: 0.95 }, scale: 1.0, color: hollowColor, gown: true, rough: 0.55 },
  warden: { P: { thin: 0.55, arm: 1.45, leg: 1.12, sh: 0.25, finger: 0.14, claw: true, hand: 1.35, hunch: 0.2, sackHead: true, torso: 1.12, handThick: 1.2, neckLen: 1.4 }, scale: 1.18, color: wardenColor, apron: true, rough: 0.6 },
  human: { P: { thin: 1.0, bulk: 1.18, boots: true, hood: true, pack: true, finger: 0.08, handThick: 1.25 }, scale: 1.0, color: humanColor, rough: 0.8 },
};

export function buildCreatureTemplate(kind, assets, detail, quality = 'medium', variant = {}) {
  const key = kind + JSON.stringify(variant) + quality;
  if (cache[key]) return cache[key];
  const D = CREATURE_DEFS[kind];
  const P = Object.assign({}, D.P, variant);
  const J = joints(P);
  const voxel = quality === 'low' ? 0.026 : quality === 'medium' ? 0.02 : 0.016;
  const prims = bodyPrims(kind, J, P);
  const geo = buildSurface(prims, voxel, { smooth: 2 });
  const boneIndex = {};
  BONE_ORDER.forEach((b, i) => { boneIndex[b] = i; });
  skinGeometry(geo, prims, boneIndex, 0.022);
  colorize(geo, (x, y, z) => (kind === 'human' ? D.color(x, y, z, J, P) : D.color(x, y, z, J)));
  scaleGeo(geo, D.scale);
  const parts = [{ geo, mat: 'skin' }];
  if (D.gown) {
    const g2 = buildSurface(gownPrims(J), voxel * 1.1, { smooth: 2 });
    skinGeometry(g2, prims, boneIndex, 0.03);
    colorize(g2, (x, y, z) => {
      const n = fbm3(x * 8, y * 8, z * 8, 3);
      let c = [0.16 + n * 0.04, 0.18 + n * 0.04, 0.165 + n * 0.035];
      let w = 0;
      const st = fbm3(x * 4, y * 4 + 3, z * 4, 3);
      if (st > 0.12) { c = mix3(c, [0.17, 0.02, 0.02], Math.min(1, (st - 0.12) * 5)); w = 0.4; }
      else if (st > 0.0) c = mix3(c, [0.3, 0.27, 0.16], 0.6);
      return [c, w];
    });
    scaleGeo(g2, D.scale);
    parts.push({ geo: g2, mat: 'cloth' });
  }
  if (D.apron) {
    const g2 = buildSurface(apronPrims(J), voxel * 1.1, { smooth: 2 });
    skinGeometry(g2, prims, boneIndex, 0.04);
    colorize(g2, (x, y, z) => {
      const n = fbm3(x * 6, y * 6, z * 6, 3);
      let c = [0.12 + n * 0.03, 0.08 + n * 0.02, 0.05 + n * 0.02];
      let w = 0.2;
      if (fbm3(x * 3, y * 3, z * 3 + 9, 3) > 0.05) { c = mix3(c, [0.11, 0.01, 0.01], 0.85); w = 0.75; }
      return [c, w];
    });
    scaleGeo(g2, D.scale);
    parts.push({ geo: g2, mat: 'leather' });
  }
  const mats = {
    skin: applyTriplanar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: D.rough, metalness: 0, envMapIntensity: 0.3 }), detail.map, { scale: 7, bump: 0.02 }),
    cloth: applyTriplanar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.2 }), detail.map, { scale: 3, bump: 0.03 }),
    leather: applyTriplanar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide, envMapIntensity: 0.3 }), detail.map, { scale: 4, bump: 0.025 }),
  };
  const tpl = { kind, J, P, scale: D.scale, parts, mats, prims };
  cache[key] = tpl;
  return tpl;
}

// Instance: skeleton + skinned meshes sharing template geometry.
export function instantiate(tpl, assets) {
  const root = new THREE.Group();
  const { bones, list } = makeSkeleton(tpl.J, tpl.scale);
  root.add(bones.hips);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  const meshes = [];
  for (const p of tpl.parts) {
    const m = new THREE.SkinnedMesh(p.geo, tpl.mats[p.mat]);
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;
    root.add(m);
    m.bind(skeleton, new THREE.Matrix4());
    meshes.push(m);
  }
  // attachments
  const s = tpl.scale;
  if (tpl.kind === 'human' && assets) {
    const mask = assets.model('old_gas_mask');
    mask.scale.setScalar(0.95);
    mask.position.set(0, 0.075, 0.075);
    bones.head.add(mask);
  }
  if (tpl.kind === 'warden') {
    const hook = makeHook(assets);
    hook.position.set(0, -0.12, 0.02);
    bones.handR.add(hook);
  }
  return { root, bones, skeleton, meshes, rest: captureRest(bones), J: tpl.J, scale: s, kind: tpl.kind };
}

function makeHook(assets) {
  const g = new THREE.Group();
  const rust = assets ? assets.mat('rusty_metal_02', { metal: true, color: 0x8a6a5a, env: 0.4 }) : new THREE.MeshStandardMaterial({ color: 0x553322 });
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    if (t < 0.45) pts.push(new THREE.Vector3(0, -t * 0.7, 0));
    else { const a = (t - 0.45) / 0.55 * Math.PI * 1.2; pts.push(new THREE.Vector3(Math.sin(a) * 0.12, -0.315 - (1 - Math.cos(a)) * 0.0 - Math.sin(a) * 0.12 * 0.9 + (1 - Math.cos(a)) * -0.05, (1 - Math.cos(a)) * 0.12)); }
  }
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.014, 8);
  const m = new THREE.Mesh(tube, rust);
  m.castShadow = true;
  g.add(m);
  // chain links up the forearm
  const link = new THREE.TorusGeometry(0.022, 0.006, 6, 12);
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(link, rust);
    l.position.set(0, 0.03 + i * 0.035, 0);
    l.rotation.y = i % 2 ? Math.PI / 2 : 0;
    g.add(l);
  }
  return g;
}

function captureRest(bones) {
  const r = {};
  for (const k in bones) r[k] = bones[k].position.clone();
  return r;
}

// ------------------------------------------------------------------ animation
const E = new THREE.Euler();
function rot(b, x, y, z) { b.rotation.set(x, y, z); }

// st: {phase, speed, crouch, yaw, pitch, reach, attack, flinch, twitch, t, crawl, dead, hunch}
export function animate(inst, st) {
  const B = inst.bones;
  const t = st.t || 0;
  const sp = clamp(st.speed || 0, 0, 2.5);
  const ph = st.phase || 0;
  const s1 = Math.sin(ph), c1 = Math.cos(ph);
  const walkAmt = clamp(sp, 0, 1), runAmt = clamp(sp - 1, 0, 1);
  const tw = st.twitch || 0;
  const n = (k) => noise3(t * 7 + k * 13.1, k, 0) * tw;
  // legs
  const stride = 0.42 * walkAmt + 0.35 * runAmt;
  rot(B.thighL, -s1 * stride - (st.crouch || 0) * 0.9 + n(1) * 0.2, 0, 0.02);
  rot(B.thighR, s1 * stride - (st.crouch || 0) * 0.9 + n(2) * 0.2, 0, -0.02);
  const kneeL = Math.max(0, -c1) * (0.6 * walkAmt + 0.7 * runAmt) + 0.05 + (st.crouch || 0) * 1.6;
  const kneeR = Math.max(0, c1) * (0.6 * walkAmt + 0.7 * runAmt) + 0.05 + (st.crouch || 0) * 1.6;
  rot(B.shinL, kneeL, 0, 0);
  rot(B.shinR, kneeR, 0, 0);
  rot(B.footL, -kneeL * 0.3 + s1 * 0.15 * walkAmt - (st.crouch || 0) * 0.6, 0, 0);
  rot(B.footR, -kneeR * 0.3 - s1 * 0.15 * walkAmt - (st.crouch || 0) * 0.6, 0, 0);
  // hips bob
  const bob = Math.abs(Math.cos(ph)) * 0.03 * walkAmt * inst.scale;
  B.hips.position.copy(inst.rest.hips);
  B.hips.position.y += bob - (st.crouch || 0) * 0.42 * inst.scale - (st.drop || 0);
  B.hips.rotation.set(0, s1 * 0.12 * walkAmt, c1 * 0.04 * walkAmt);
  // spine
  const hunch = st.hunch || 0;
  rot(B.spine, 0.06 * runAmt + hunch * 0.5 + (st.crouch || 0) * 0.35 + n(3) * 0.15, -s1 * 0.1 * walkAmt, 0);
  rot(B.chest, 0.04 * runAmt + hunch * 0.4 + (st.flinch || 0) * -0.4 + n(4) * 0.15, -s1 * 0.12 * walkAmt + (st.attack || 0) * 0.4 * (st.attackSide || 1), 0);
  // head look
  rot(B.neck, (st.pitch || 0) * 0.4 - hunch * 0.6 + n(5) * 0.6, (st.yaw || 0) * 0.5, n(6) * 0.5);
  rot(B.head, (st.pitch || 0) * 0.6 - hunch * 0.3 + (st.flinch || 0) * -0.3, (st.yaw || 0) * 0.5, n(7) * 0.4 + (st.tilt || 0));
  // arms
  const reach = st.reach || 0;
  const armSwing = 0.38 * walkAmt + 0.5 * runAmt;
  for (const [S, sg, ph2] of [['L', 1, Math.PI], ['R', -1, 0]]) {
    const sw = Math.sin(ph + ph2) * armSwing;
    let ax = sw - reach * 1.35 + n(8 + sg) * 0.3;
    let az = sg * (0.08 + reach * 0.15);
    let fx = -0.25 - runAmt * 0.9 - reach * 0.2 + n(10 + sg) * 0.3;
    // attack: swing the right arm (or both for grabs)
    if (st.attack && (S === 'R' || st.grab)) {
      const a = st.attack;
      const up = a < 0.4 ? a / 0.4 : 1 - (a - 0.4) / 0.6;
      ax = lerp(ax, -2.6, up) + (a > 0.4 ? (a - 0.4) * 2.5 : 0);
      az = lerp(az, sg * -0.2, up);
      fx = lerp(fx, -0.6, up);
    }
    rot(B['clav' + S], 0, 0, sg * (reach * 0.15 + (st.shrug || 0)));
    rot(B['arm' + S], ax, 0, az);
    rot(B['fore' + S], fx, 0, 0);
    rot(B['hand' + S], -0.2 + n(12 + sg) * 0.5, 0, 0);
  }
  if (st.armsDown) { rot(B.armL, 0, 0, 0.1); rot(B.armR, 0, 0, -0.1); }
}

// Pose for a body lying dead on the floor (blend 0..1)
export function deadPose(inst, k, side = 1) {
  const B = inst.bones;
  B.hips.position.copy(inst.rest.hips);
  B.hips.position.y = lerp(inst.rest.hips.y, 0.13 * inst.scale, k);
  B.hips.rotation.x = lerp(0, -Math.PI / 2 * side, k);
  rot(B.spine, -0.05 * k, 0, 0.1 * k);
  rot(B.chest, -0.05 * k, 0, 0);
  rot(B.neck, 0.3 * k * side, 0.5 * k, 0);
  rot(B.head, 0.2 * k * side, 0.6 * k, 0.2 * k);
  rot(B.armL, -0.3 * k, 0, 0.9 * k); rot(B.foreL, -0.6 * k, 0, 0);
  rot(B.armR, -0.1 * k, 0, -1.2 * k); rot(B.foreR, -0.2 * k, 0, 0);
  rot(B.thighL, 0.1 * k, 0, 0.12 * k); rot(B.shinL, 0.25 * k, 0, 0);
  rot(B.thighR, -0.3 * k, 0, -0.08 * k); rot(B.shinR, 0.7 * k, 0, 0);
}

// Crawling on all fours (blend k)
export function crawlPose(inst, ph, k, t) {
  const B = inst.bones;
  const s = Math.sin(ph), c = Math.cos(ph);
  B.hips.position.copy(inst.rest.hips);
  B.hips.position.y = lerp(inst.rest.hips.y, 0.42 * inst.scale, k);
  B.hips.rotation.x = 1.25 * k;
  rot(B.spine, 0.1 * k, s * 0.15, 0);
  rot(B.chest, 0.05 * k, s * 0.1, 0);
  rot(B.neck, -1.0 * k, 0, 0);
  rot(B.head, -0.4 * k, Math.sin(t * 1.3) * 0.3, Math.sin(t * 0.7) * 0.4);
  rot(B.armL, -1.3 * k + s * 0.35, 0, 0.15); rot(B.foreL, -0.15 + Math.max(0, c) * -0.5, 0, 0);
  rot(B.armR, -1.3 * k - s * 0.35, 0, -0.15); rot(B.foreR, -0.15 + Math.max(0, -c) * -0.5, 0, 0);
  rot(B.thighL, -1.1 * k - s * 0.3, 0, 0.1); rot(B.shinL, 1.6 * k, 0, 0);
  rot(B.thighR, -1.1 * k + s * 0.3, 0, -0.1); rot(B.shinR, 1.6 * k, 0, 0);
  rot(B.footL, 0.5, 0, 0); rot(B.footR, 0.5, 0, 0);
}

export { BONE_ORDER };

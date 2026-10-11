// Prefab props. Each prefab emits detailed geometry through the Emitter in
// its own local space, plus simple colliders. Map JSON only stores
// {type:'prop', prop:'<id>', pos, rot, scale} so maps stay tiny.
import * as THREE from 'three';
import { DEG } from '../core/util.js';
import { Emitter } from './mapbuilder.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

function rotXZ(x, z, yawDeg) { const a = yawDeg * DEG, c = Math.cos(a), s = Math.sin(a); return [c * x + s * z, -s * x + c * z]; }
function L(base, yaw, off) { const [x, z] = rotXZ(off[0], off[2], yaw); return [base[0] + x, base[1] + off[1], base[2] + z]; }

// helper bound to a base position + yaw inside the emitter's local space
function at(em, base = [0, 0, 0], yaw = 0) {
  return {
    box: (mat, off, size, opts = {}) => em.box(mat, L(base, yaw, off), size, { ...opts, yaw: yaw + (opts.yaw || 0) }),
    geo: (mat, g, off, rot = [0, 0, 0], scale = [1, 1, 1], flags) => em.geo(mat, g, Emitter.mat(L(base, yaw, off), [rot[0], rot[1] + yaw, rot[2]], scale), flags),
    cyl: (mat, off, r, h, opts = {}) => em.cyl(mat, L(base, yaw, off), r, h, { ...opts, rot: opts.rot ? [opts.rot[0], opts.rot[1] + yaw, opts.rot[2]] : undefined }),
    col: (type, off, size, extraYaw = 0, mat) => em.collider(type, L(base, yaw, off), size, yaw + extraYaw, mat),
  };
}

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
  sphere: new THREE.SphereGeometry(1, 14, 10),
};

function crate(em, s, rng) {
  const a = at(em);
  const t = 0.07 * s / 1.2;
  a.box('crate', [0, s / 2, 0], [s - 0.02, s - 0.02, s - 0.02], { cell: 0.4 });
  // frame edges
  const e = s / 2 - t / 2 + 0.01;
  for (const x of [-e, e]) for (const z of [-e, e]) a.box('wood', [x, s / 2, z], [t + 0.02, s + 0.02, t + 0.02], { cell: 0.6 });
  for (const y of [t / 2, s - t / 2]) {
    for (const z of [-e, e]) a.box('wood', [0, y, z], [s - 2 * t, t, t + 0.02], { cell: 0.6 });
    for (const x of [-e, e]) a.box('wood', [x, y, 0], [t + 0.02, t, s - 2 * t], { cell: 0.6 });
  }
  // diagonal braces on two faces
  const dl = Math.SQRT2 * (s - 2 * t);
  a.geo('wood', G.box, [0, s / 2, e + 0.005], [0, 0, 45], [t, dl, t * 0.6]);
  a.geo('wood', G.box, [0, s / 2, -e - 0.005], [0, 0, -45], [t, dl, t * 0.6]);
  a.geo('wood', G.box, [e + 0.005, s / 2, 0], [0, 90, 45], [t, dl, t * 0.6]);
  a.geo('wood', G.box, [-e - 0.005, s / 2, 0], [0, 90, -45], [t, dl, t * 0.6]);
  a.col('box', [0, s / 2, 0], [s, s, s], 0, 'crate');
}

function barrel(em, o, rng) {
  const a = at(em);
  const mat = o.variant === 'rust' ? 'rust' : 'metal';
  a.cyl(mat, [0, 0.46, 0], 0.3, 0.92, { seg: 20 });
  for (const y of [0.04, 0.31, 0.62, 0.9]) a.geo(mat, G.cyl, [0, y, 0], [0, 0, 0], [0.315, 0.035, 0.315]);
  a.geo('dark', G.cyl, [0, 0.925, 0], [0, 0, 0], [0.27, 0.01, 0.27]);
  a.geo('metal', G.cyl8, [0.15, 0.93, 0.05], [0, 0, 0], [0.035, 0.02, 0.035]);
  a.col('cyl', [0, 0.46, 0], [0.62, 0.92, 0.62], 0, 'metal');
}

const BAG_GEO = (() => {
  // soft pillow-shaped bag: rounded box pinched at the ends
  const g = new RoundedBoxGeometry(0.62, 0.22, 0.36, 2, 0.09);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const end = Math.pow(Math.abs(x) / 0.31, 4);
    p.setXYZ(i, x, y * (1 - end * 0.45) + Math.sin(x * 9) * 0.006, z * (1 - end * 0.25));
  }
  g.computeVertexNormals();
  return g;
})();
function sandbags(em, o, rng) {
  const a = at(em);
  const len = 2.4, rows = 3;
  for (let r = 0; r < rows; r++) {
    const off = (r & 1) ? 0.31 : 0;
    for (let i = 0; i < 4; i++) {
      const x = -len / 2 + 0.31 + i * 0.6 + off - (r & 1 ? 0.15 : 0);
      if (x > len / 2 - 0.15) continue;
      a.geo('sandbag', BAG_GEO, [x, 0.1 + r * 0.2, (rng() - 0.5) * 0.04], [(rng() - 0.5) * 4, (rng() - 0.5) * 10, (rng() - 0.5) * 5], [1, 1, 1]);
    }
  }
  a.col('box', [0, 0.32, 0], [len, 0.66, 0.5], 0, 'sandbag');
}

const POT_GEO = (() => {
  const pts = [[0, 0], [0.16, 0], [0.24, 0.08], [0.29, 0.25], [0.29, 0.42], [0.22, 0.6], [0.12, 0.7], [0.1, 0.78], [0.14, 0.82], [0.12, 0.84], [0.08, 0.8]];
  return new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), 18);
})();
function pot(em, o, rng) {
  const a = at(em);
  a.geo('clay', POT_GEO, [0, 0, 0], [0, rng() * 360, 0], [1, 1, 1]);
  a.col('cyl', [0, 0.42, 0], [0.56, 0.84, 0.56], 0, 'clay');
}

function frondGeo(len, width, droop, twist) {
  const segs = 10;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = t * len;
    const y = Math.sin(t * Math.PI * 0.55) * len * 0.28 - t * t * droop;
    const w = width * Math.sin(Math.min(1, t * 1.15 + 0.05) * Math.PI * 0.92) * 0.5 + 0.03;
    const tw = twist * t;
    for (const s of [-1, 1]) {
      pos.push(s * w * Math.cos(tw), y + s * w * Math.sin(tw) * 0.5 - Math.abs(s * w) * 0.25, z);
      uv.push(s < 0 ? 0 : 1, t);
    }
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function palm(em, o, rng) {
  const a = at(em);
  const H = 5.5 + rng() * 2.5;
  const bendDir = rng() * Math.PI * 2, bend = 0.6 + rng() * 0.9;
  const N = 9;
  let prev = [0, 0, 0];
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const off = Math.pow(t, 2) * bend;
    const cur = [Math.cos(bendDir) * off, t * H, Math.sin(bendDir) * off];
    const mid = [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2, (prev[2] + cur[2]) / 2];
    const dx = cur[0] - prev[0], dy = cur[1] - prev[1], dz = cur[2] - prev[2];
    const len = Math.hypot(dx, dy, dz);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    const r = 0.21 - t * 0.07;
    const g = new THREE.CylinderGeometry(r * 0.97, r, len * 1.04, 12, 1, true);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...mid), q, new THREE.Vector3(1, 1, 1));
    em.geo('bark', g, m);
    g.dispose();
    prev = cur;
  }
  const top = prev;
  a.geo('bark', G.sphere, top, [0, 0, 0], [0.26, 0.32, 0.26]);
  const nf = 10;
  for (let i = 0; i < nf; i++) {
    const yaw = (i / nf) * 360 + rng() * 20;
    const up = i % 2 ? 10 + rng() * 15 : -5 + rng() * 15;
    const g = frondGeo(2.8 + rng() * 0.9, 0.95, 1.3 + rng() * 0.6, (rng() - 0.5) * 0.8);
    em.geo('fx:leaf', g, Emitter.mat([top[0], top[1] + 0.1, top[2]], [-up, yaw, 0]), { keepUV: true, noCast: true, noAO: true });
    g.dispose();
  }
  // dead hanging fronds
  for (let i = 0; i < 4; i++) {
    const g = frondGeo(1.8, 0.6, 2.4, 0.4);
    em.geo('fx:leaf', g, Emitter.mat([top[0], top[1] - 0.2, top[2]], [40 + rng() * 20, rng() * 360, 0]), { keepUV: true, noCast: true, noAO: true });
    g.dispose();
  }
  a.col('cyl', [0, 3, 0], [0.4, 6, 0.4], 0, 'wood');
}

function awning(em, o, rng) {
  const a = at(em);
  const w = 3.2, d = 1.8, hb = 2.7, hf = 2.2;
  const mat = o.variant === 'blue' ? 'cloth_blue' : 'cloth_red';
  const slope = Math.atan2(hb - hf, d) / DEG;
  const len = Math.hypot(d, hb - hf);
  a.geo(mat, G.box, [0, (hb + hf) / 2, d / 2], [slope, 0, 0], [w, 0.02, len], { tile: 2 });
  // valance flap
  a.geo(mat, G.box, [0, hf - 0.15, d + 0.01], [0, 0, 0], [w, 0.3, 0.015]);
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) {
    a.geo('wood', G.cyl8, [x, hf / 2, d], [0, 0, 0], [0.04, hf, 0.04]);
    a.col('cyl', [x, hf / 2, d], [0.12, hf, 0.12], 0, 'wood');
  }
}

function stall(em, o, rng) {
  const a = at(em);
  a.box('wood', [0, 0.85, 0], [2.4, 0.08, 1.1], {});
  for (const x of [-1.1, 1.1]) for (const z of [-0.45, 0.45]) a.box('wood', [x, 0.42, z], [0.08, 0.84, 0.08], {});
  a.box('crate', [0, 0.25, 0], [2.2, 0.5, 0.9], {});
  a.col('box', [0, 0.45, 0], [2.4, 0.9, 1.1], 0, 'wood');
  awning(em, { variant: rng() < 0.5 ? 'blue' : 'red' }, rng);
  // goods
  for (let i = 0; i < 4; i++) a.geo('clay', POT_GEO, [-0.8 + i * 0.5, 0.89, (rng() - 0.5) * 0.4], [0, rng() * 360, 0], [0.5, 0.5, 0.5]);
}

function car(em, o, rng) {
  const a = at(em);
  const paint = o.variant || 'rust';
  a.box(paint, [0, 0.72, 0], [1.8, 0.62, 4.3], { cell: 0.5 });
  a.box(paint, [0, 1.28, 0.25], [1.62, 0.5, 2.1], { cell: 0.5 });
  a.box('fx:glass', [0, 1.3, 0.25], [1.64, 0.36, 1.9], { cell: 2 });
  a.box('fx:glass', [0, 1.3, 0.25], [1.5, 0.36, 2.12], { cell: 2 });
  a.box('metal', [0, 0.55, 2.17], [1.84, 0.22, 0.12], {});
  a.box('metal', [0, 0.55, -2.17], [1.84, 0.22, 0.12], {});
  for (const x of [-0.82, 0.82]) for (const z of [-1.35, 1.4]) {
    a.geo('dark', G.cyl, [x, 0.38, z], [0, 0, 90], [0.37, 0.26, 0.37]);
    a.geo('metal', G.cyl8, [x * 1.02, 0.38, z], [0, 0, 90], [0.18, 0.27, 0.18]);
  }
  a.box('fx:glow', [0.65, 0.78, 2.16], [0.28, 0.14, 0.03], {});
  a.box('fx:glow', [-0.65, 0.78, 2.16], [0.28, 0.14, 0.03], {});
  a.col('box', [0, 0.72, 0], [1.85, 1.0, 4.4], 0, 'metal');
  a.col('box', [0, 1.3, 0.25], [1.62, 0.55, 2.1], 0, 'metal');
}

function pallet(em, o, rng) {
  const a = at(em);
  for (let i = 0; i < 5; i++) a.box('crate', [-0.5 + i * 0.25, 0.13, 0], [0.18, 0.025, 1.2], {});
  for (const z of [-0.5, 0, 0.5]) a.box('wood', [0, 0.06, z], [1.2, 0.1, 0.12], {});
  a.col('box', [0, 0.08, 0], [1.2, 0.16, 1.2], 0, 'wood');
}

const TIRE_GEO = new THREE.TorusGeometry(0.3, 0.12, 8, 16);
function tires(em, o, rng) {
  const a = at(em);
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) a.geo('dark', TIRE_GEO, [(rng() - 0.5) * 0.06, 0.12 + i * 0.24, (rng() - 0.5) * 0.06], [90, rng() * 360, 0]);
  a.col('cyl', [0, n * 0.12, 0], [0.84, n * 0.24, 0.84], 0, 'dark');
}

function well(em, o, rng) {
  const a = at(em);
  a.cyl('sandstone', [0, 0.45, 0], 0.95, 0.9, { seg: 24, open: false });
  a.geo('dark', G.cyl, [0, 0.905, 0], [0, 0, 0], [0.75, 0.01, 0.75]);
  for (const x of [-0.85, 0.85]) a.box('wood', [x, 1.4, 0], [0.12, 1.9, 0.12], {});
  a.box('wood', [0, 2.3, 0], [1.9, 0.12, 0.12], {});
  a.geo('roof', G.box, [0, 2.55, -0.45], [-28, 0, 0], [2.2, 0.06, 1.1]);
  a.geo('roof', G.box, [0, 2.55, 0.45], [28, 0, 0], [2.2, 0.06, 1.1]);
  a.geo('metal', G.cyl8, [0.3, 1.6, 0], [0, 0, 0], [0.14, 0.24, 0.14]);
  a.col('cyl', [0, 0.45, 0], [1.9, 0.9, 1.9], 0, 'sandstone');
}

function rock(em, o, rng) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = 0.75 + rng() * 0.45;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.7, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  const a = at(em);
  a.geo('sandstone', g, [0, 0.35, 0], [rng() * 20, rng() * 360, rng() * 20], [1, 1, 1]);
  a.col('box', [0, 0.45, 0], [1.4, 0.9, 1.4], 0, 'sandstone');
  g.dispose();
}

function lamp(em, o, rng) {
  const a = at(em);
  a.geo('metal', G.cyl8, [0, 1.6, 0], [0, 0, 0], [0.05, 3.2, 0.05]);
  a.geo('metal', G.box, [0, 3.15, 0.25], [0, 0, 0], [0.04, 0.04, 0.5]);
  a.box('metal', [0, 2.95, 0.5], [0.22, 0.04, 0.22], {});
  a.box('fx:glow', [0, 2.8, 0.5], [0.16, 0.26, 0.16], {});
  a.col('cyl', [0, 1.6, 0], [0.12, 3.2, 0.12], 0, 'metal');
}

function rubble(em, o, rng) {
  const a = at(em);
  for (let i = 0; i < 9; i++) {
    const s = 0.12 + rng() * 0.3;
    a.geo(rng() < 0.7 ? 'sandstone' : 'plaster', G.box, [(rng() - 0.5) * 1.6, s * 0.35, (rng() - 0.5) * 1.6], [rng() * 40, rng() * 360, rng() * 40], [s * 1.4, s, s * 1.1]);
  }
}

// ---- building details (used by building generator) ----
function window_(em, local, yaw, rng, ground) {
  const a = at(em, local, yaw);
  const w = 1.0, h = 1.3;
  a.box('dark', [0, 0, 0.02], [w, h, 0.06], {});
  a.box('sandstone', [0, -h / 2 - 0.07, 0.09], [w + 0.3, 0.12, 0.2], {});
  a.box('sandstone', [0, h / 2 + 0.06, 0.06], [w + 0.24, 0.12, 0.14], {});
  a.box('sandstone', [-w / 2 - 0.06, 0, 0.06], [0.12, h + 0.12, 0.13], {});
  a.box('sandstone', [w / 2 + 0.06, 0, 0.06], [0.12, h + 0.12, 0.13], {});
  const kind = rng();
  if (ground && kind < 0.6) {
    for (let i = 1; i < 6; i++) a.geo('metal', G.cyl8, [-w / 2 + i * w / 6, 0, 0.1], [0, 0, 0], [0.012, h, 0.012]);
  } else if (kind < 0.55) {
    // open shutters
    const ang = 60 + rng() * 50;
    a.geo('door', G.box, [-w / 2 - 0.12 - Math.cos(ang * DEG) * 0.0, 0, 0.14 + Math.sin(ang * DEG) * 0.25], [0, -ang, 0], [0.5, h, 0.04], { tile: 1.5 });
    a.geo('door', G.box, [w / 2 + 0.12, 0, 0.14 + Math.sin(ang * DEG) * 0.25], [0, ang, 0], [0.5, h, 0.04], { tile: 1.5 });
  } else if (kind < 0.8) {
    a.box('door', [0, 0, 0.06], [w - 0.04, h - 0.04, 0.05], {});
  }
}

function door_(em, local, yaw, rng) {
  const a = at(em, local, yaw);
  const w = 1.4, h = 2.4;
  a.box('dark', [0, h / 2, 0.02], [w, h, 0.06], {});
  a.box('door', [0, h / 2, 0.07], [w - 0.06, h - 0.06, 0.08], {});
  a.box('sandstone', [-w / 2 - 0.1, h / 2 + 0.05, 0.07], [0.2, h + 0.1, 0.16], {});
  a.box('sandstone', [w / 2 + 0.1, h / 2 + 0.05, 0.07], [0.2, h + 0.1, 0.16], {});
  a.box('sandstone', [0, h + 0.15, 0.08], [w + 0.6, 0.22, 0.2], {});
  a.box('sandstone', [0, 0.06, 0.3], [w + 0.4, 0.12, 0.6], {});
  a.geo('metal', G.cyl8, [0.5, 1.15, 0.13], [90, 0, 0], [0.025, 0.06, 0.025]);
}

export const PREFABS = {
  crate: { label: 'Crate', build: (em, o, rng) => crate(em, 1.2, rng) },
  crate_small: { label: 'Small Crate', build: (em, o, rng) => crate(em, 0.75, rng) },
  crate_stack: {
    label: 'Crate Stack', build: (em, o, rng) => {
      crate(em, 1.2, rng);
      const sub = { box: em.box.bind(em) };
      void sub;
      // second crate on top, rotated
      const save = em.matrix.clone(), yaw = em.yaw, pos = em.pos.clone(), sc = em.scale;
      em.setTransform([pos.x + 0.1, pos.y + 1.2 * sc, pos.z - 0.05], yaw / DEG + 12, sc);
      crate(em, 1.2, rng);
      em.setTransform([pos.x + 1.2 * sc * Math.cos(yaw), pos.y, pos.z - 1.2 * sc * Math.sin(yaw)], yaw / DEG, sc);
      crate(em, 0.75, rng);
      em.matrix.copy(save); em.yaw = yaw; em.pos.copy(pos); em.scale = sc;
    },
  },
  barrel: { label: 'Barrel', build: barrel },
  sandbags: { label: 'Sandbags', build: sandbags },
  pot: { label: 'Clay Pot', build: pot },
  palm: { label: 'Palm Tree', build: palm },
  awning: { label: 'Awning', build: awning },
  stall: { label: 'Market Stall', build: stall },
  car: { label: 'Car Wreck', build: car },
  pallet: { label: 'Pallet', build: pallet },
  tires: { label: 'Tire Stack', build: tires },
  well: { label: 'Well', build: well },
  rock: { label: 'Rock', build: rock },
  lamp: { label: 'Lamp Post', build: lamp },
  rubble: { label: 'Rubble', build: rubble },
  window: { label: 'Window', build: (em, o, rng) => window_(em, [0, 1.6, 0], 0, rng, false), buildAt: window_ },
  door: { label: 'Door', build: (em, o, rng) => door_(em, [0, 0, 0], 0, rng), buildAt: door_ },
};

// approximate local bounding boxes for editor picking: [w,h,d]
export const PREFAB_BOUNDS = {
  crate: [1.2, 1.2, 1.2], crate_small: [0.75, 0.75, 0.75], crate_stack: [2.4, 2.4, 1.3], barrel: [0.64, 0.95, 0.64], sandbags: [2.4, 0.8, 0.6],
  pot: [0.6, 0.85, 0.6], palm: [1, 7, 1], awning: [3.2, 2.7, 1.9], stall: [3.2, 2.7, 2.2], car: [1.9, 1.6, 4.4], pallet: [1.2, 0.16, 1.2],
  tires: [0.9, 0.8, 0.9], well: [2, 2.6, 2], rock: [1.6, 1, 1.6], lamp: [0.4, 3.2, 1], rubble: [1.8, 0.4, 1.8], window: [1.4, 1.6, 0.3], door: [2, 2.6, 0.6],
};

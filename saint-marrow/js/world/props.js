// Prop presets (Poly Haven models + a few procedural ones) and item pickups.
import * as THREE from '../../lib/three.module.js';
import { RoundedBoxGeometry } from '../../lib/RoundedBoxGeometry.js';
import { mergeGeometries } from '../../lib/BufferGeometryUtils.js';
import { makeCanvas, mulberry32, noise2, fbm3 } from '../util.js';

// All Poly Haven models face +Z, so "back" is local -Z.
export const PRESETS = {
  bed: { model: 'old_bed_frame', col: true, extra: 'mattress', wall: true },
  daybed: { model: 'vintage_day_bed', col: true, wall: true },
  wheelchair: { model: 'wheelchair_01', col: true, free: true },
  desk: { model: 'metal_office_desk', col: true, wall: true },
  chair: { model: 'painted_wooden_chair_01', col: false, free: true },
  plasticchair: { model: 'plastic_monobloc_chair_01', col: false, free: true },
  stool: { model: 'metal_stool_01', col: false, free: true },
  stool2: { model: 'metal_stool_02', col: false, free: true },
  cabinet: { model: 'painted_wooden_cabinet', col: true, wall: true },
  drawers: { model: 'drawer_cabinet', col: true, wall: true },
  nightstand: { model: 'painted_wooden_nightstand', col: true, wall: true },
  table: { model: 'painted_wooden_table', col: true },
  bench: { model: 'painted_wooden_bench', col: true, wall: true },
  shelf: { model: 'steel_frame_shelves_02', col: true, wall: true },
  rack: { model: 'worn_metal_rack', col: true, wall: true },
  crate: { model: 'wooden_crate_01', col: true, free: true },
  milcrate: { model: 'old_military_crate', col: true, free: true },
  box: { model: 'cardboard_box_01', col: false, free: true },
  barrel: { model: 'Barrel_01', col: true, free: true },
  trashcan: { model: 'metal_trash_can', col: true, free: true, node: 'metal_trash_can_rust' },
  bag: { model: 'trashbag', col: false, free: true },
  sign: { model: 'WetFloorSign_01', col: false, free: true },
  extinguisher: { model: 'korean_fire_extinguisher_01', col: false, wall: true },
  tv: { model: 'Television_01', col: true, wall: true },
  toolchest: { model: 'metal_tool_chest', col: true, wall: true },
  handtruck: { model: 'hand_truck', col: false, free: true },
  crutches: { model: 'vintage_crutches_01', col: false, wall: true },
  suitcase: { model: 'vintage_suitcase', col: false, free: true },
  tyre: { model: 'old_tyre', col: false, free: true, lay: true },
  utilitybox: { model: 'utility_box_01', col: true, wall: true },
  propane: { model: 'propane_tank', col: false, free: true },
  generator: { model: 'portable_generator', col: true, wall: true },
  radio: { model: 'vintage_radio_transceiver', col: false, wall: true },
  car: { model: 'covered_car', col: true },
  log: { model: 'dead_tree_trunk', col: true, free: true },
  gate: { model: 'large_iron_gate', col: false },
  clock: { model: 'wall_clock', mount: 2.3 },
  camera: { model: 'security_camera_01', mount: 2.7 },
  fusebox: { model: 'power_box_01', mount: 1.45 },
  locker: { proc: 'locker', col: true, wall: true },
  gurney: { proc: 'gurney', col: true, free: true },
  body: { proc: 'body', col: false, free: true },
  bodybed: { model: 'old_bed_frame', col: true, extra: 'bodybed', wall: true },
  optable: { proc: 'optable', col: true },
  surglamp: { proc: 'surglamp', ceiling: true },
  morgue: { proc: 'morgue', wall: true, col: true },
  fountain: { proc: 'fountain', col: true },
  sleepbag: { proc: 'sleepbag', free: true },
  papers: { proc: 'papers', free: true },
  sink: { proc: 'sink', mount: 0.85 },
  bloodbucket: { proc: 'bucket', free: true },
  cell: { proc: 'padding', wall: true },
};

// Item pickups: model + scale + rest pose.
export const ITEMS = {
  battery: { proc: 'battery', glint: true },
  bandage: { model: 'medical_tape', scale: 1.6, glint: true },
  medkit: { model: 'medical_box', scale: 0.7, glint: true },
  painkillers: { proc: 'pills', glint: true },
  ammo9: { model: 'ammo_box', scale: 0.55, rotZ: Math.PI / 2, glint: true },
  ammo762: { model: 'ammo_box', scale: 0.7, rotZ: Math.PI / 2, glint: true },
  pistol: { model: 'service_pistol', nodes: ['service_pistol_pistol_a', 'service_pistol_slide_a', 'service_pistol_hammer_a', 'service_pistol_trigger_a'], scale: 1, rotX: -Math.PI / 2, glint: true },
  rifle: { model: 'bolt_action_rifle_7_62', hide: ['bolt_action_rifle_7_62_bolt_b', 'bolt_action_rifle_7_62_bullet_54mm'], rotX: -Math.PI / 2, glint: true },
  crowbar: { model: 'crowbar_01', rotX: Math.PI / 2, glint: true },
  boltcutters: { model: 'bolt_cutters_01', rotX: Math.PI / 2, glint: true },
  fuse: { proc: 'fuse', glint: true },
  keycard: { proc: 'keycard', glint: true },
  key: { proc: 'key', glint: true },
  fuel: { model: 'metal_jerrycan', glint: true },
  note: { proc: 'note', glint: true },
  tape: { model: 'portable_cassette_player', scale: 1, glint: true },
};

let cache = {};

// Bake all static meshes of a procedural prop into one mesh per material (fewer draw calls).
export function mergeStatic(group, keep = []) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map();
  const remove = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p && p !== group; p = p.parent) if (keep.includes(p)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, { geos: [], cast: false });
    const e = byMat.get(o.material);
    e.geos.push(g);
    e.cast = e.cast || o.castShadow;
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const [mat, e] of byMat) {
    const m = new THREE.Mesh(mergeGeometries(e.geos), mat);
    m.castShadow = e.cast; m.receiveShadow = true;
    group.add(m);
  }
  return group;
}
const rng = mulberry32(99);

function sheetTexture(bloody) {
  const k = 'sheet' + bloody;
  if (cache[k]) return cache[k];
  const S = 256, cv = makeCanvas(S, S), ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm3(x / 40, y / 40, 1.3, 4);
    const i = (y * S + x) * 4;
    const v = 200 + n * 40;
    img.data[i] = v; img.data[i + 1] = v * 0.97; img.data[i + 2] = v * 0.86; img.data[i + 3] = 255;
    // yellowed stains
    const st = fbm3(x / 25, y / 25, 7.7, 3);
    if (st > 0.18) { img.data[i] *= 0.88; img.data[i + 1] *= 0.84; img.data[i + 2] *= 0.7; }
    if (bloody) {
      const b = fbm3(x / 30, y / 22, 3.3 + bloody, 4) + (1 - Math.abs(y / S - 0.42) * 3) * 0.25;
      if (b > 0.32) { const k2 = Math.min(1, (b - 0.32) * 6); img.data[i] = img.data[i] * (1 - k2) + 95 * k2; img.data[i + 1] *= 1 - k2 * 0.97; img.data[i + 2] *= 1 - k2 * 0.95; }
      else if (b > 0.27) { img.data[i] *= 0.75; img.data[i + 1] *= 0.55; img.data[i + 2] *= 0.5; }
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache[k] = t;
  return t;
}

// Height field of a body lying on its back under a sheet (length along Z, head at -Z).
function bodyHeight(x, z) {
  const g = (dx, dz, sx, sz, h) => h * Math.exp(-((dx * dx) / (sx * sx) + (dz * dz) / (sz * sz)));
  let h = 0;
  h = Math.max(h, g(x, z + 0.78, 0.1, 0.11, 0.2));       // head
  h = Math.max(h, g(x, z + 0.38, 0.21, 0.24, 0.22));     // chest
  h = Math.max(h, g(x, z + 0.05, 0.19, 0.2, 0.17));      // belly/hips
  h = Math.max(h, g(x - 0.1, z - 0.42, 0.075, 0.33, 0.13)); // legs
  h = Math.max(h, g(x + 0.1, z - 0.42, 0.075, 0.33, 0.13));
  h = Math.max(h, g(x - 0.12, z - 0.86, 0.06, 0.06, 0.16)); // feet
  h = Math.max(h, g(x + 0.12, z - 0.86, 0.06, 0.06, 0.16));
  h = Math.max(h, g(x - 0.27, z + 0.2, 0.06, 0.32, 0.09)); // arms
  h = Math.max(h, g(x + 0.27, z + 0.2, 0.06, 0.32, 0.09));
  return h;
}

export function makeCoveredBody(assets, seed = 1, w = 0.9, l = 2.05) {
  const geo = new THREE.PlaneGeometry(w, l, 30, 60);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let h = bodyHeight(x * 1.05, z) * 1.15;
    // sheet drapes down at the edges
    const ex = Math.max(0, Math.abs(x) - w * 0.36) / (w * 0.14);
    const ez = Math.max(0, Math.abs(z) - l * 0.44) / (l * 0.06);
    h = h + 0.02 - Math.min(1, ex) * 0.16 - Math.min(1, ez) * 0.12;
    h += noise2(x * 9 + seed, z * 9) * 0.012 + noise2(x * 3, z * 3 + seed) * 0.02;
    p.setY(i, h);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: sheetTexture(seed % 3 + 1), roughness: 0.92, side: THREE.DoubleSide, normalMap: assets.tex.waffle_pique_cotton?.nor || null });
  if (mat.normalMap) mat.normalScale.set(0.4, 0.4);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function mattress(assets, bloody) {
  const g = new RoundedBoxGeometry(0.82, 0.14, 1.86, 3, 0.05);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) - Math.exp(-Math.pow(p.getZ(i) / 0.5, 2)) * 0.035 + noise2(p.getX(i) * 6, p.getZ(i) * 6) * 0.008);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: sheetTexture(bloody ? 4 : 0), roughness: 0.95, normalMap: assets.tex.waffle_pique_cotton?.nor || null }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function locker(assets) {
  const grp = new THREE.Group();
  const mat = assets.mat('green_metal_rust', { color: 0x7d8f84, env: 0.35 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.62, 1.95, 0.52, 2, 0.015), mat);
  body.position.y = 0.975;
  grp.add(body);
  const doorG = new THREE.Group();
  const door = new THREE.Mesh(new RoundedBoxGeometry(0.56, 1.8, 0.025, 2, 0.008), assets.mat('green_metal_rust', { color: 0x8a9d90, env: 0.35 }));
  door.position.set(0.28, 0.0, 0);
  doorG.add(door);
  // vent slats
  const slat = new THREE.BoxGeometry(0.3, 0.012, 0.01);
  const dark = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(slat, dark); s.position.set(0.28, 0.65 - i * 0.03, 0.014); doorG.add(s); }
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.03), assets.mat('rusty_metal_02', { metal: true, color: 0xaaaaaa, env: 0.5 }));
  handle.position.set(0.5, 0.0, 0.025);
  doorG.add(handle);
  doorG.position.set(-0.28, 0.99, 0.27);
  grp.add(doorG);
  grp.userData.door = doorG;
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  mergeStatic(doorG);
  return mergeStatic(grp, [doorG]);
}

function gurney(assets, bloody) {
  const grp = new THREE.Group();
  const steel = assets.mat('rusty_metal_02', { metal: true, color: 0xb0b0aa, env: 0.5 });
  const frame = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.05, 1.95, 2, 0.02), steel);
  frame.position.y = 0.78;
  grp.add(frame);
  const legG = new THREE.CylinderGeometry(0.018, 0.018, 0.74, 8);
  for (const [x, z] of [[-0.28, -0.85], [0.28, -0.85], [-0.28, 0.85], [0.28, 0.85]]) {
    const l = new THREE.Mesh(legG, steel); l.position.set(x, 0.41, z); grp.add(l);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 }));
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.045, z); grp.add(w);
  }
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.07, 1.86, 2, 0.03), new THREE.MeshStandardMaterial({ map: sheetTexture(bloody ? 5 : 0), roughness: 0.9 }));
  pad.position.y = 0.84;
  grp.add(pad);
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return mergeStatic(grp);
}

function opTable(assets) {
  const grp = new THREE.Group();
  const steel = assets.mat('rusty_metal_02', { metal: true, color: 0xc4c4be, env: 0.6 });
  const top = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.1, 2.0, 2, 0.03), steel); top.position.y = 0.9; grp.add(top);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.85, 14), steel); ped.position.y = 0.43; grp.add(ped);
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.06, 0.9, 2, 0.02), steel); base.position.y = 0.03; grp.add(base);
  // restraint straps
  const strap = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 });
  for (const z of [-0.6, 0.1, 0.7]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.012, 0.07), strap); s.position.set(0, 0.957, z); grp.add(s); }
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return mergeStatic(grp);
}

function surgLamp(assets) {
  const grp = new THREE.Group();
  const steel = assets.mat('rusty_metal_02', { metal: true, color: 0xcfcfc8, env: 0.6 });
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 8), steel); arm.position.y = -0.45; grp.add(arm);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), assets.mat('rusty_metal_02', { metal: true, color: 0xe0e0da, env: 0.6, side: THREE.DoubleSide }));
  head.position.y = -0.95; grp.add(head);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.33, 24), new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xfff4e0, emissiveIntensity: 0, roughness: 0.2 }));
  lens.rotation.x = Math.PI / 2; lens.position.y = -1.0 + 0.27; lens.position.y = -0.95 + 0.0; grp.add(lens);
  grp.userData.lens = lens;
  grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return mergeStatic(grp, [lens]);
}

function morgueWall(assets) {
  const grp = new THREE.Group();
  const steel = assets.mat('rusty_metal_02', { metal: true, color: 0xb9bdb8, env: 0.55 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.2, 0.75), assets.mat('rusty_metal_02', { metal: true, color: 0x8a8e88, env: 0.4 }));
  frame.position.set(0, 1.1, -0.0); grp.add(frame);
  const doors = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const pg = new THREE.Group();
    const d = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.6, 0.04, 2, 0.01), steel);
    d.position.set(0.29, 0, 0);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.04), steel); h.position.set(0.48, 0, 0.04);
    pg.add(d, h);
    pg.position.set(-0.93 + c * 0.64, 0.4 + r * 0.7, 0.4);
    grp.add(pg);
    doors.push(pg);
  }
  grp.userData.doors = doors;
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  for (const d of doors) mergeStatic(d);
  return mergeStatic(grp, doors);
}

function fountain(assets) {
  const grp = new THREE.Group();
  const stone = assets.mat('concrete_wall_006', { color: 0x9a978f });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.22, 10, 48), stone); ring.rotation.x = Math.PI / 2; ring.position.y = 0.5; ring.scale.z = 2.2; grp.add(ring);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.25, 0.5, 48, 1, true), stone); wall.position.y = 0.25; grp.add(wall);
  const basin = new THREE.Mesh(new THREE.CircleGeometry(2.1, 48), new THREE.MeshStandardMaterial({ color: 0x0b0d0b, roughness: 0.05, metalness: 0.1, envMapIntensity: 1.5 }));
  basin.rotation.x = -Math.PI / 2; basin.position.y = 0.35; grp.add(basin);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 1.6, 16), stone); ped.position.y = 0.8; grp.add(ped);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), assets.mat('concrete_wall_006', { color: 0x8a877f, side: THREE.DoubleSide }));
  bowl.position.y = 1.85; grp.add(bowl);
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return mergeStatic(grp);
}

function sleepbag(assets) {
  const g = new RoundedBoxGeometry(0.75, 0.12, 1.9, 3, 0.06);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + noise2(p.getX(i) * 4, p.getZ(i) * 4) * 0.03);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x1f3a52, roughness: 0.65, normalMap: assets.tex.waffle_pique_cotton?.nor || null }));
  m.position.y = 0.06;
  m.receiveShadow = true;
  return m;
}

let paperTex = null;
function papers() {
  if (!paperTex) {
    const cv = makeCanvas(128, 160), ctx = cv.getContext('2d');
    ctx.fillStyle = '#cfc8b4'; ctx.fillRect(0, 0, 128, 160);
    ctx.fillStyle = 'rgba(40,40,40,0.55)';
    for (let i = 0; i < 18; i++) ctx.fillRect(12, 16 + i * 7.5, 30 + Math.random() * 74, 2);
    paperTex = new THREE.CanvasTexture(cv); paperTex.colorSpace = THREE.SRGBColorSpace;
  }
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.9, side: THREE.DoubleSide });
  const n = 3 + ((rng() * 5) | 0);
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(0.21, 0.29, 2, 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, (rng() - 0.5) * 0.02);
    const m = new THREE.Mesh(g, mat);
    m.rotation.x = -Math.PI / 2; m.rotation.z = rng() * Math.PI * 2;
    m.position.set((rng() - 0.5) * 0.9, 0.003 + i * 0.001, (rng() - 0.5) * 0.9);
    m.receiveShadow = true;
    grp.add(m);
  }
  return mergeStatic(grp);
}

function sink(assets) {
  const grp = new THREE.Group();
  const cer = new THREE.MeshStandardMaterial({ color: 0xcfcbbf, roughness: 0.25, envMapIntensity: 0.5 });
  const b = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.2, 0.42, 3, 0.05), cer); b.position.z = 0.21; grp.add(b);
  const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 6), assets.mat('rusty_metal_02', { metal: true, env: 0.6 }));
  tap.position.set(0, 0.15, 0.05); grp.add(tap);
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.65), new THREE.MeshStandardMaterial({ color: 0x8a9090, metalness: 1, roughness: 0.18, envMapIntensity: 1 }));
  mirror.position.set(0, 0.75, 0.005); grp.add(mirror);
  grp.userData.mirror = mirror;
  return grp;
}

function bucket(assets) {
  const grp = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.3, 16, 1, true), assets.mat('rusty_metal_02', { metal: true, color: 0x999999, side: THREE.DoubleSide }));
  m.position.y = 0.15; grp.add(m);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), new THREE.MeshStandardMaterial({ color: 0x2a0101, roughness: 0.15 }));
  fill.rotation.x = -Math.PI / 2; fill.position.y = 0.24; grp.add(fill);
  return mergeStatic(grp);
}

function padding(assets) {
  // padded cell wall cushion panel
  const g = new RoundedBoxGeometry(0.96, 2.4, 0.12, 3, 0.05);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0.03) p.setZ(i, p.getZ(i) + Math.abs(Math.sin(p.getY(i) * 6)) * 0.02);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: sheetTexture(0), color: 0xd8d0b8, roughness: 0.95 }));
  m.position.set(0, 1.2, 0.06);
  m.receiveShadow = true;
  const grp = new THREE.Group(); grp.add(m);
  return grp;
}

// ---- small item meshes ----
function itemProc(kind, assets) {
  const grp = new THREE.Group();
  if (kind === 'battery') {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.06, 14), new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.3 }));
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.0172, 0.0172, 0.02, 14), new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.35, metalness: 0.9 }));
    c.position.y = 0.022;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 8), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.3 }));
    t.position.y = 0.033;
    grp.add(b, c, t);
    grp.rotation.z = Math.PI / 2; grp.position.y = 0.017;
    const g2 = grp.clone(); g2.position.set(0, 0.017, 0.04);
    const out = new THREE.Group(); out.add(grp, g2);
    return out;
  }
  if (kind === 'fuse') {
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xe0d6c0, roughness: 0.5 }));
    const capM = new THREE.MeshStandardMaterial({ color: 0xc0c0b8, metalness: 1, roughness: 0.3 });
    const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.014, 12), capM); c1.position.y = 0.03;
    const c2 = c1.clone(); c2.position.y = -0.03;
    grp.add(glass, c1, c2);
    grp.scale.setScalar(1.6);
    grp.rotation.z = Math.PI / 2; grp.position.y = 0.022;
    const out = new THREE.Group(); out.add(grp); return out;
  }
  if (kind === 'keycard') {
    const cv = makeCanvas(256, 160), ctx = cv.getContext('2d');
    ctx.fillStyle = '#e9e6dc'; ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = '#7a1414'; ctx.fillRect(0, 0, 256, 38);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px Arial'; ctx.fillText('ST. MARROW', 14, 28);
    ctx.fillStyle = '#222'; ctx.font = 'bold 30px Arial'; ctx.fillText('WARD 9', 14, 80);
    ctx.font = '18px Arial'; ctx.fillText('DR. E. HALE - ACCESS', 14, 110);
    ctx.fillStyle = '#333'; ctx.fillRect(14, 125, 228, 18);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new RoundedBoxGeometry(0.086, 0.002, 0.054, 1, 0.0008), new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 }));
    m.position.y = 0.002;
    grp.add(m);
    grp.scale.setScalar(1.5);
    return grp;
  }
  if (kind === 'key') {
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.35 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 8, 16), brass); ring.rotation.x = Math.PI / 2;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.008), brass); shaft.position.x = 0.038;
    const bit = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.016), brass); bit.position.set(0.055, 0, 0.01);
    grp.add(ring, shaft, bit); grp.position.y = 0.004; grp.scale.setScalar(1.6);
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.002, 0.045), new THREE.MeshStandardMaterial({ color: 0xc8b88a })); tag.position.set(-0.03, 0, 0); grp.add(tag);
    return grp;
  }
  if (kind === 'pills') {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 14), new THREE.MeshStandardMaterial({ color: 0xc8611a, roughness: 0.2, transparent: true, opacity: 0.85 }));
    b.position.y = 0.03;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 14), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }));
    c.position.y = 0.068;
    grp.add(b, c);
    return grp;
  }
  if (kind === 'note') {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.28), new THREE.MeshStandardMaterial({ map: papers().children[0].material.map, roughness: 0.9, side: THREE.DoubleSide, color: 0xf2ecd8 }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.004;
    grp.add(m);
    return grp;
  }
  return grp;
}

export function makeItemMesh(assets, kind) {
  const def = ITEMS[kind];
  if (!def) return new THREE.Group();
  let obj;
  if (def.proc) obj = itemProc(def.proc, assets);
  else {
    obj = assets.model(def.model);
    if (def.nodes) obj.traverse((o) => { if (o.isMesh && !def.nodes.some((n) => o.name.startsWith(n) || o.parent?.name?.startsWith(n))) o.visible = false; });
    if (def.hide) obj.traverse((o) => { if (def.hide.some((n) => o.name.startsWith(n))) o.visible = false; });
    const inner = obj;
    obj = new THREE.Group();
    if (def.rotX) inner.rotation.x = def.rotX;
    if (def.rotZ) inner.rotation.z = def.rotZ;
    if (def.scale) inner.scale.setScalar(def.scale);
    obj.add(inner);
    // rest on the surface
    inner.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(inner, true);
    inner.position.y -= b.min.y;
    inner.position.x -= (b.min.x + b.max.x) / 2;
    inner.position.z -= (b.min.z + b.max.z) / 2;
  }
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return obj;
}

export function makePropMesh(assets, name, seed = 1) {
  const p = PRESETS[name];
  if (!p) return null;
  let obj;
  if (p.proc) {
    switch (p.proc) {
      case 'locker': obj = locker(assets); break;
      case 'gurney': obj = gurney(assets, seed % 2); break;
      case 'body': obj = new THREE.Group(); obj.add(makeCoveredBody(assets, seed)); break;
      case 'optable': obj = opTable(assets); break;
      case 'surglamp': obj = surgLamp(assets); break;
      case 'morgue': obj = morgueWall(assets); break;
      case 'fountain': obj = fountain(assets); break;
      case 'sleepbag': obj = sleepbag(assets); break;
      case 'papers': obj = papers(); break;
      case 'sink': obj = sink(assets); break;
      case 'bucket': obj = bucket(assets); break;
      case 'padding': obj = padding(assets); break;
      default: obj = new THREE.Group();
    }
  } else {
    obj = assets.model(p.model);
    if (p.node) obj.traverse((o) => { if (o.isMesh && !(o.name.startsWith(p.node) || o.parent?.name?.startsWith(p.node))) o.visible = false; });
    if (p.node) {
      // recentre the chosen node
      obj.updateMatrixWorld(true);
      const b = new THREE.Box3();
      obj.traverse((o) => { if (o.isMesh && o.visible) b.expandByObject(o); });
      const c = b.getCenter(new THREE.Vector3());
      obj.position.x -= c.x; obj.position.z -= c.z;
      const g = new THREE.Group(); g.add(obj); obj = g;
    }
    if (p.lay) obj.rotation.x = Math.PI / 2;
  }
  if (p.extra === 'mattress') {
    const mt = mattress(assets, seed % 3 === 0);
    mt.position.set(0, 0.5, 0.0);
    obj.add(mt);
  }
  if (p.extra === 'bodybed') {
    const mt = mattress(assets, true);
    mt.position.set(0, 0.5, 0);
    obj.add(mt);
    const b = makeCoveredBody(assets, seed, 0.85, 1.95);
    b.position.set(0, 0.57, 0);
    b.rotation.y = Math.PI;
    obj.add(b);
  }
  return obj;
}

export function propCollider(obj, pad = 0.02) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3();
  obj.traverse((o) => { if (o.isMesh && o.visible) b.expandByObject(o, false); });
  if (b.isEmpty()) return null;
  return { minX: b.min.x - pad, maxX: b.max.x + pad, minZ: b.min.z - pad, maxZ: b.max.z + pad, minY: b.min.y, maxY: b.max.y, solidRay: true };
}

export { sheetTexture, mergeGeometries };

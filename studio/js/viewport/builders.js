// Node -> THREE objects. Pure view code: reads the scene model, never writes to it.
// Each builder returns an Entry:
//   root     Group   real geometry (layer 0, always visible)
//   helpers  Group   editor-only visuals (layer 1: volumes, icons, arrows) — hidden with the "Helpers" toggle
//   extras   Group   shown only while the node is selected (light ranges, audio radii ...)
//   tick(dt) optional per-frame update (animation mixers)
//   dispose() frees everything this entry created (shared library resources are NOT disposed)

import * as THREE from '../../lib/three.module.js';
import { TYPES } from '../core/schema.js';
import { propsOf, wallPieces, localColliders } from '../core/geometry.js';
import { localBox } from '../core/schema.js';
import { boxMinMax, mergeBoxes, terrainGeometry, wireBox } from './geocache.js';
import { decalTexture } from './decals.js';

export const HELPER_LAYER = 1;
const D2R = Math.PI / 180;

const basicCache = new Map();
function basic(color, opacity = 1, extra = {}) {
  const k = `${color}|${opacity}|${JSON.stringify(extra)}`;
  if (!basicCache.has(k)) basicCache.set(k, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, ...extra }));
  return basicCache.get(k);
}
const lineCache = new Map();
function lineMat(color, opacity = 1) {
  const k = `${color}|${opacity}`;
  if (!lineCache.has(k)) lineCache.set(k, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  return lineCache.get(k);
}
const iconCache = new Map();
function iconTexture(type) {
  if (iconCache.has(type)) return iconCache.get(type);
  const def = TYPES[type];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const col = '#' + (def.color ?? 0xffffff).toString(16).padStart(6, '0');
  x.fillStyle = 'rgba(12,14,18,0.82)'; x.beginPath(); x.arc(32, 32, 29, 0, Math.PI * 2); x.fill();
  x.lineWidth = 4; x.strokeStyle = col; x.stroke();
  x.fillStyle = col; x.font = 'bold 34px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(def.icon || '?', 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  iconCache.set(type, t);
  return t;
}

function markHelper(obj) { obj.traverse((o) => { o.layers.set(HELPER_LAYER); }); return obj; }

class Entry {
  constructor(node) {
    this.nodeId = node.id;
    this.root = new THREE.Group();
    this.helpers = new THREE.Group();
    this.extras = new THREE.Group();
    this.helpers.name = 'helpers'; this.extras.name = 'extras';
    this.disposables = [];
    this.tick = null;
    this.problems = [];
    this.disposed = false;
    this.gen = 0;
  }
  mesh(geo, mat, node, { cast = true, receive = true, helper = false } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = receive;
    m.userData.nodeId = node.id;
    if (helper) markHelper(m);
    this.disposables.push(geo);
    return m;
  }
  dispose() {
    this.disposed = true;
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
  }
}

const BUILD = {};

// ---------------------------------------------------------------- architecture
BUILD.wall = (node, e, bx) => {
  const p = propsOf(node);
  const pieces = wallPieces(bx.scene, node, bx.geo);
  if (!pieces.length) return;
  e.root.add(e.mesh(mergeBoxes(pieces), bx.mat(p.material), node));
  if (p.collide === 'none') e.problems.push('collision disabled');
};
const slab = (node, e, bx) => { e.root.add(e.mesh(boxMinMax(...boxPair(localBox(node, bx.geo))), bx.mat(propsOf(node).material), node)); };
const boxPair = (b) => [[b[0], b[1], b[2]], [b[3], b[4], b[5]]];
BUILD.floor = slab; BUILD.ceiling = slab;
BUILD.box = (node, e, bx) => {
  const p = propsOf(node);
  const m = e.mesh(boxMinMax(...boxPair(localBox(node, bx.geo))), bx.mat(p.material), node);
  e.root.add(m);
};
BUILD.stairs = (node, e, bx) => {
  const p = propsOf(node);
  const boxes = [];
  for (let i = 0; i < p.steps; i++) boxes.push({ min: [-p.width / 2, 0, i * p.stepD], max: [p.width / 2, (i + 1) * p.stepH, (i + 1) * p.stepD] });
  e.root.add(e.mesh(mergeBoxes(boxes), bx.mat(p.material), node));
};
BUILD.door = (node, e, bx) => {
  const p = propsOf(node);
  const w = p.width, h = p.height, t = Math.min(p.thick, 0.14), f = 0.06;
  const mat = bx.mat(p.metal ? 'mat_metal' : p.material || 'mat_wood');
  e.root.add(e.mesh(mergeBoxes([
    { min: [-w / 2 - f, 0, -t / 2], max: [-w / 2, h + f, t / 2] }, { min: [w / 2, 0, -t / 2], max: [w / 2 + f, h + f, t / 2] },
    { min: [-w / 2, h, -t / 2], max: [w / 2, h + f, t / 2] },
  ]), mat, node));
  const leaves = p.doubleDoor ? [[-1, w / 2], [1, w / 2]] : [[p.hinge === 'right' ? 1 : -1, w]];
  e.leafGroups = [];
  for (const [side, lw] of leaves) {
    const g = new THREE.Group();
    const hingeX = side * (w / 2) * (p.doubleDoor ? 1 : 1);
    g.position.set(hingeX, 0, 0);
    const extent = -side;                       // leaf extends away from the hinge
    const leaf = e.mesh(boxMinMax([extent > 0 ? 0 : -lw, 0, -0.022], [extent > 0 ? lw : 0, h - 0.01, 0.022]), mat, node);
    g.add(leaf);
    const angle = extent * (p.openAngle || 100) * D2R;
    if (p.state === 'open') g.rotation.y = angle;
    e.leafGroups.push({ g, angle });
    e.root.add(g);
  }
  /** Playtest animates doors without touching the scene model: amount 0 (closed) .. 1 (fully open). */
  e.setOpen = (amount) => { for (const l of e.leafGroups) l.g.rotation.y = l.angle * amount; };
};
BUILD.window = (node, e, bx) => {
  const p = propsOf(node);
  const w = p.width, h = p.height, t = Math.min(p.thick, 0.1), f = 0.05;
  const mat = bx.mat(p.material);
  e.root.add(e.mesh(mergeBoxes([
    { min: [-w / 2 - f, -f, -t / 2], max: [w / 2 + f, 0, t / 2] }, { min: [-w / 2 - f, h, -t / 2], max: [w / 2 + f, h + f, t / 2] },
    { min: [-w / 2 - f, 0, -t / 2], max: [-w / 2, h, t / 2] }, { min: [w / 2, 0, -t / 2], max: [w / 2 + f, h, t / 2] },
  ]), mat, node));
  if (!p.broken) {
    const gm = new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.05, transparent: true, opacity: p.opacity, depthWrite: false });
    e.disposables.push(gm);
    e.root.add(e.mesh(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), gm, node, { cast: false }));
  }
  if (p.boarded) {
    const boards = [];
    for (let i = 0; i < 3; i++) boards.push({ min: [-w / 2 - 0.02, h * (0.12 + i * 0.3), t / 2], max: [w / 2 + 0.02, h * (0.12 + i * 0.3) + 0.13, t / 2 + 0.03] });
    e.root.add(e.mesh(mergeBoxes(boards), bx.mat('mat_wood'), node));
  }
  if (p.bars) {
    const bars = [];
    const n = Math.max(2, Math.round(w / 0.14));
    for (let i = 0; i <= n; i++) { const x = -w / 2 + (w * i) / n; bars.push({ min: [x - 0.01, 0, -0.01], max: [x + 0.01, h, 0.01] }); }
    e.root.add(e.mesh(mergeBoxes(bars), bx.mat('mat_metal'), node));
  }
};
const fromColliders = (node, e, bx) => {
  const lcs = localColliders(bx.scene, node, bx.geo);
  if (lcs.length) e.root.add(e.mesh(mergeBoxes(lcs), bx.mat(propsOf(node).material), node));
};
BUILD.elevator = fromColliders; BUILD.vent = fromColliders;
BUILD.terrain = (node, e, bx) => {
  const p = propsOf(node);
  e.root.add(e.mesh(terrainGeometry(p), bx.mat(p.material), node));
};

// ---------------------------------------------------------------- props
BUILD.model = (node, e, bx) => {
  const p = propsOf(node);
  const b = localBox(node, bx.geo);
  const meta = p.asset ? bx.assets.meta(p.asset) : null;
  const ph = wireBox([b[0], b[1], b[2]], [b[3], b[4], b[5]], meta ? 0x8a8f96 : 0xff5555, 0.9);
  ph.userData.nodeId = node.id;
  e.disposables.push(ph.geometry);
  e.root.add(ph);
  // invisible pick volume for placeholder
  const pickBox = e.mesh(boxMinMax([b[0], b[1], b[2]], [b[3], b[4], b[5]]), basic(0xffffff, 0.001), node, { cast: false, receive: false });
  pickBox.material = basic(0xffffff, 0.02);
  e.root.add(pickBox);
  if (!p.asset) { e.problems.push('no asset assigned'); return; }
  if (!meta) { e.problems.push(`asset "${p.asset}" is not in this project`); return; }
  const gen = ++e.gen;
  bx.assets.instantiate(p.asset).then(({ object, animations }) => {
    if (e.disposed || e.gen !== gen) return;
    e.root.remove(ph, pickBox);
    const holder = new THREE.Group();
    object.scale.multiplyScalar(meta.scale || 1);
    const mp = meta.pivot || [0, 0, 0], np = p.pivot || [0, 0, 0];
    holder.position.set(mp[0] + np[0], mp[1] + np[1], mp[2] + np[2]);
    holder.add(object);
    const overrides = p.materialOverrides || {};
    object.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.nodeId = node.id;
      o.castShadow = !!p.castShadow;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const mapped = list.map((m) => { const id = overrides[m.name] || overrides[o.name]; return id ? bx.mat(id) : m; });
      o.material = Array.isArray(o.material) ? mapped : mapped[0];
    });
    e.root.add(holder);
    if (animations.length) {
      const mixer = new THREE.AnimationMixer(object);
      e.mixer = mixer; e.clips = animations;
      const clip = animations.find((c) => c.name === p.clip);
      if (clip && p.autoplay) { const a = mixer.clipAction(clip); a.timeScale = p.speed; if (!p.loop) a.setLoop(THREE.LoopOnce); a.play(); }
      e.tick = (dt) => { if (bx.animate()) mixer.update(dt); };
    }
    if (meta.missingTextures?.length) e.problems.push('missing textures: ' + meta.missingTextures.join(', '));
    bx.requestRender();
  }).catch((err) => {
    if (e.disposed) return;
    e.problems.push(err.message);
    ph.material = lineMat(0xff3333);
    bx.requestRender();
  });
};
BUILD.decal = (node, e, bx) => {
  const p = propsOf(node);
  let tex;
  if (p.texture.startsWith('builtin:decal/')) tex = decalTexture(p.texture, { baseUrl: bx.baseUrl, log: bx.log, onReady: bx.requestRender, text: node.meta?.text });
  else { tex = null; bx.assets.loadTexture(p.texture).then((t) => { if (e.disposed) return; m.map = t; m.needsUpdate = true; bx.requestRender(); }).catch((err) => e.problems.push(err.message)); }
  const m = new THREE.MeshStandardMaterial({ map: tex, color: p.color, transparent: true, opacity: p.opacity, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  e.disposables.push(m);
  const geo = new THREE.PlaneGeometry(p.w, p.h);
  geo.translate(0, 0, 0.004);
  e.root.add(e.mesh(geo, m, node, { cast: false }));
};

// ---------------------------------------------------------------- helpers (editor-only visuals)
const icon = (node, e, size = 0.4, y = 0) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(node.type), depthTest: false, transparent: true }));
  s.scale.setScalar(size); s.position.y = y;
  s.renderOrder = 10;
  s.userData.nodeId = node.id;
  e.disposables.push(s.material);
  e.helpers.add(markHelper(s));
};
function volume(node, e) {
  const p = propsOf(node);
  const color = TYPES[node.type].color;
  const s = p.size || [1, 1, 1];
  const geo = p.shape === 'sphere' ? new THREE.SphereGeometry(s[0] / 2, 20, 14) : new THREE.BoxGeometry(s[0], s[1], s[2]);
  const fill = new THREE.Mesh(geo, basic(color, 0.1));
  fill.userData.nodeId = node.id; fill.userData.volume = true;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat(color, 0.95));
  e.disposables.push(geo, edges.geometry);
  e.helpers.add(markHelper(fill), markHelper(edges));
  icon(node, e, 0.35);
}
for (const t of ['trigger', 'interaction', 'checkpoint', 'navBlocker', 'arena', 'audioZone', 'footstepZone']) BUILD[t] = (node, e) => volume(node, e);

BUILD.light = (node, e) => {
  const p = propsOf(node);
  icon(node, e, 0.4);
  const col = new THREE.Color(p.color);
  let ex;
  if (p.kind === 'spot') {
    const r = Math.tan((p.angle * D2R) / 2) * p.range;
    const geo = new THREE.ConeGeometry(r, p.range, 24, 1, true); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -p.range / 2);
    ex = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat(col.getHex(), 0.8)); e.disposables.push(geo, ex.geometry);
  } else if (p.kind === 'directional') {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3), new THREE.Vector3(0.2, 0, -2.6), new THREE.Vector3(0, 0, -3), new THREE.Vector3(-0.2, 0, -2.6), new THREE.Vector3(0, 0, -3)]);
    ex = new THREE.Line(g, lineMat(col.getHex())); e.disposables.push(g);
  } else {
    const geo = new THREE.SphereGeometry(p.range, 20, 12);
    ex = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat(col.getHex(), 0.5)); e.disposables.push(geo, ex.geometry);
  }
  e.extras.add(markHelper(ex));
};
const capsuleLines = (h, r, color) => {
  const geo = new THREE.CylinderGeometry(r, r, h, 12, 1, true); geo.translate(0, h / 2, 0);
  const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat(color)); l.geometry.userData.src = geo;
  return { l, geo };
};
const arrow = (color, len = 0.7) => {
  const g = new THREE.BufferGeometry().setFromPoints([[0, 0.9, 0], [0, 0.9, -len], [0.12, 0.9, -len + 0.2], [0, 0.9, -len], [-0.12, 0.9, -len + 0.2], [0, 0.9, -len]].map((a) => new THREE.Vector3(...a)));
  return new THREE.Line(g, lineMat(color));
};
for (const t of ['playerSpawn', 'enemySpawn']) {
  BUILD[t] = (node, e) => {
    const { l, geo } = capsuleLines(t === 'playerSpawn' ? 1.8 : 1.9, t === 'playerSpawn' ? 0.3 : 0.35, TYPES[t].color);
    const a = arrow(TYPES[t].color);
    e.disposables.push(l.geometry, geo, a.geometry);
    const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.8, 8).translate(0, 0.9, 0), basic(0xffffff, 0.02));
    pick.userData.nodeId = node.id; e.disposables.push(pick.geometry);
    e.helpers.add(markHelper(l), markHelper(a), markHelper(pick));
    icon(node, e, 0.4, 2.1);
  };
}
BUILD.itemSpawn = (node, e) => {
  const geo = new THREE.OctahedronGeometry(0.15); geo.translate(0, 0.15, 0);
  const m = new THREE.Mesh(geo, basic(TYPES.itemSpawn.color, 0.85)); m.userData.nodeId = node.id;
  e.disposables.push(geo); e.helpers.add(markHelper(m));
  icon(node, e, 0.3, 0.5);
  const p = propsOf(node);
  if (p.model) BUILD._modelPreview?.(node, e, p.model);
};
BUILD.audioSource = (node, e) => {
  const p = propsOf(node);
  icon(node, e, 0.4);
  for (const [r, op] of [[p.refDistance, 0.8], [p.maxDistance, 0.4]]) {
    const geo = new THREE.SphereGeometry(r, 18, 10);
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat(TYPES.audioSource.color, op)); e.disposables.push(geo, l.geometry);
    e.extras.add(markHelper(l));
  }
};
BUILD.particleEmitter = (node, e) => { icon(node, e, 0.35); };
BUILD.cameraShot = (node, e) => {
  const p = propsOf(node);
  const h = Math.tan((p.fov * D2R) / 2) * 1.2, w = h * 16 / 9;
  const pts = [[0, 0, 0], [-w, -h, -1.2], [0, 0, 0], [w, -h, -1.2], [0, 0, 0], [w, h, -1.2], [0, 0, 0], [-w, h, -1.2], [-w, -h, -1.2], [w, -h, -1.2], [w, h, -1.2], [-w, h, -1.2], [-w, -h, -1.2]];
  const g = new THREE.BufferGeometry().setFromPoints(pts.map((a) => new THREE.Vector3(...a)));
  const l = new THREE.Line(g, lineMat(0xffffff, 0.9)); l.userData.nodeId = node.id;
  e.disposables.push(g); e.helpers.add(markHelper(l)); icon(node, e, 0.3);
};
BUILD.marker = (node, e) => {
  const geo = new THREE.OctahedronGeometry(0.2); geo.translate(0, 0.2, 0);
  const m = new THREE.Mesh(geo, basic(0xffffff, 0.6)); m.userData.nodeId = node.id;
  e.disposables.push(geo); e.helpers.add(markHelper(m));
};
BUILD.waypoint = (node, e) => {
  const geo = new THREE.ConeGeometry(0.15, 0.4, 8); geo.translate(0, 0.2, 0);
  const m = new THREE.Mesh(geo, basic(TYPES.waypoint.color, 0.9)); m.userData.nodeId = node.id;
  e.disposables.push(geo); e.helpers.add(markHelper(m));
};
BUILD.path = (node, e, bx) => {
  const pts = bx.scene.children(node.id).filter((c) => c.type === 'waypoint').map((c) => new THREE.Vector3(...c.t.p).add(new THREE.Vector3(0, 0.15, 0)));
  const p = propsOf(node);
  const geo = new THREE.BufferGeometry().setFromPoints(p.closed && pts.length > 2 ? [...pts, pts[0]] : pts);
  const l = new THREE.Line(geo, lineMat(TYPES.path.color)); l.userData.nodeId = node.id;
  e.disposables.push(geo); e.helpers.add(markHelper(l));
  icon(node, e, 0.3, 0.6);
};
BUILD.group = () => {};

/**
 * @param bx  { scene, geo, assets, mat(id), baseUrl, log, animate(), requestRender() }
 */
export function buildEntry(node, bx) {
  const e = new Entry(node);
  try { (BUILD[node.type] || (() => {}))(node, e, bx); }
  catch (err) { e.problems.push(`${node.type} failed to build: ${err.message}`); bx.log?.('error', `Viewport: "${node.name}" (${node.type}) failed to build: ${err.message}`); }
  e.root.add(e.helpers, e.extras);
  e.extras.visible = false;
  return e;
}

/** OBB outline for selection (child of the node group so it follows transforms). */
export function selectionOutline(node, geo, color) {
  const b = localBox(node, geo);
  const pad = 0.015;
  const w = wireBox([b[0] - pad, b[1] - pad, b[2] - pad], [b[3] + pad, b[4] + pad, b[5] + pad], color, 1);
  w.material = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  w.renderOrder = 20;
  w.raycast = () => {};
  w.name = '__outline';
  markHelper(w);
  return w;
}
export { iconTexture };

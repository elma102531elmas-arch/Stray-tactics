// Map-building tools. Each tool previews with lightweight lines in vp.toolGroup and commits ONE undoable step.
//   PlaceTool    click to place a node type or a model asset (stays active for repeated placing)
//   WallTool     click points to draw connected walls
//   RoomTool     drag a rectangle -> floor + ceiling + four walls (+ optional door)
//   CorridorTool click start and end -> floor, ceiling and two side walls
//   MeasureTool  click two points to read a distance

import * as THREE from '../../lib/three.module.js';
import { makeNode } from '../core/scene.js';
import * as C from '../core/commands.js';
import { TYPES } from '../core/schema.js';
import { localBox } from '../core/schema.js';
import { wireBox } from '../viewport/geocache.js';
import { HELPER_LAYER } from '../viewport/builders.js';
import { placementProps } from '../assets/meta.js';

const D2R = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const lineMat = (c, o = 1) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false });
function helperLine(points, color = 0xffb35a, loop = false) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const l = loop ? new THREE.LineLoop(g, lineMat(color)) : new THREE.Line(g, lineMat(color));
  l.renderOrder = 40; l.layers.set(HELPER_LAYER); l.raycast = () => {};
  return l;
}
function clearGroup(g) { g.children.slice().forEach((c) => { g.remove(c); c.geometry?.dispose(); c.material?.dispose?.(); }); }

/** Default options shared by the drawing tools; stored per project session in app prefs. */
export const BUILD_DEFAULTS = {
  wallHeight: 2.8, wallThick: 0.2, wallMaterial: 'mat_plaster', floorMaterial: 'mat_tile', ceilingMaterial: 'mat_plaster',
  ceiling: true, floor: true, doorSide: 'none', corridorWidth: 2, overlapJoints: true,
};

const snapAngle = (from, to, step = 15) => {
  const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz);
  if (len < 1e-6) return to.clone();
  const a = Math.round((Math.atan2(dz, dx) * RAD2DEG) / step) * step * D2R;
  return new THREE.Vector3(from.x + Math.cos(a) * len, to.y, from.z + Math.sin(a) * len);
};

/** Create the nodes for a wall between two world points, relative to a parent group centre. */
export function wallBetween(a, b, o, extraStart = 0, extraEnd = 0) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const L = len + extraStart + extraEnd;
  // centre shifts when ends are extended
  const dir = len < 1e-9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(dx / len, 0, dz / len);
  const centre = new THREE.Vector3((a.x + b.x) / 2, a.y, (a.z + b.z) / 2).addScaledVector(dir, (extraEnd - extraStart) / 2);
  const yaw = Math.atan2(-dz, dx) * RAD2DEG;
  return { L, centre, yaw };
}

class BaseTool {
  constructor(id, cursor = 'crosshair') { this.id = id; this.cursor = cursor; }
  opt(k) { return this.app.pref('build.' + k, BUILD_DEFAULTS[k]); }
  clear() { clearGroup(this.vp.toolGroup); this.vp.requestRender(); }
  deactivate() { this.clear(); this.vp.hud(''); this.state = null; }
  cancel() { this.state = null; this.clear(); this.vp.hud(''); }
  point(info) {
    if (!info.snapped) return null;
    const p = info.snapped.clone(); p.y = this.vp.workY; return p;
  }
}

// ------------------------------------------------------------------ place
export class PlaceTool extends BaseTool {
  constructor() { super('place'); this.spec = null; this.rotY = 0; this.ghost = null; }
  setSpec(spec) { this.spec = spec; this.rotY = 0; this._rebuildGhost(); }
  activate() {
    this.vp.hud(this.spec ? `Placing ${this.spec.label || this.spec.type || 'object'} — click to place · R rotate · Esc finish` : 'Choose something to place');
    this._rebuildGhost();
  }
  _rebuildGhost() {
    if (!this.vp?.toolGroup) return;
    this.clear();
    this.ghost = null;
    const spec = this.spec;
    if (!spec) return;
    const g = new THREE.Group();
    if (spec.assetId) {
      g.userData.pending = true;
      this.app.assets.instantiate(spec.assetId).then(({ object }) => {
        if (this.spec !== spec) return;
        const m = new THREE.MeshBasicMaterial({ color: 0xffb35a, transparent: true, opacity: 0.45, depthWrite: false });
        object.traverse((o) => { if (o.isMesh) { o.material = m; o.castShadow = false; o.layers.set(HELPER_LAYER); } });
        g.add(object); this.vp.requestRender();
      }).catch((e) => this.app.log('error', 'Cannot preview asset: ' + e.message));
    } else {
      const node = makeNode(spec.type, { props: spec.props || {} });
      const b = localBox(node, this.app.project.geoCtx);
      const w = wireBox([b[0], b[1], b[2]], [b[3], b[4], b[5]], 0xffb35a);
      w.material.depthTest = false; w.layers.set(HELPER_LAYER); w.renderOrder = 40;
      g.add(w);
    }
    g.visible = false;
    this.ghost = g;
    this.vp.toolGroup.add(g);
  }
  rotate(step = 90) { this.rotY = (this.rotY + step) % 360; if (this.ghost) this.ghost.rotation.y = this.rotY * D2R; this.vp.requestRender(); }
  _target(info) {
    const spec = this.spec;
    const useSurface = spec?.surface || spec?.assetId || this.app.project.data.settings.surfaceSnap;
    let p = info.snapped?.clone() || null, normal = null;
    if (useSurface) {
      const hit = this.vp.pick(info.ev.clientX, info.ev.clientY, { includeLocked: true });
      if (hit && hit.point) {
        normal = hit.normal || null;
        if (spec?.orient === 'surface' || (normal && normal.y > 0.6)) {
          p = hit.point.clone();
          if (spec?.orient !== 'surface') { const s = this.vp.snap(p, info.ctrl); p.x = s.x; p.z = s.z; }
        }
      }
    }
    return { p, normal };
  }
  hover(info) {
    if (!this.ghost) return;
    const { p, normal } = this._target(info);
    if (!p) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    this.ghost.position.copy(p);
    if (this.spec.orient === 'surface' && normal) this.ghost.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    else this.ghost.rotation.set(0, this.rotY * D2R, 0);
    this.vp.requestRender();
  }
  pointerDown(info) { this.down = { x: info.ev.clientX, y: info.ev.clientY }; }
  pointerUp(info) {
    if (!this.spec || !this.down || Math.hypot(info.ev.clientX - this.down.x, info.ev.clientY - this.down.y) > 5) return;
    const { p, normal } = this._target(info);
    if (!p) return;
    const spec = this.spec;
    const opts = { p: [p.x, p.y, p.z], r: [0, this.rotY, 0], props: { ...(spec.props || {}) }, name: spec.name, tags: spec.tags };
    if (spec.orient === 'surface' && normal) {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
      opts.r = [e.x * RAD2DEG, e.y * RAD2DEG, e.z * RAD2DEG];
      opts.p = [p.x + normal.x * 0.004, p.y + normal.y * 0.004, p.z + normal.z * 0.004];
    }
    if (spec.assetId) { const meta = this.app.assets.meta(spec.assetId); opts.props = { ...(meta ? placementProps(meta) : { asset: spec.assetId }), ...opts.props }; opts.name = opts.name || meta?.name; }
    if (spec.lift) opts.p[1] += spec.lift;
    const node = this.app.createNode(spec.type || 'model', opts);
    this.app.log('info', `Placed ${node.name}`);
  }
}

// ------------------------------------------------------------------ walls
export class WallTool extends BaseTool {
  constructor() { super('wall'); this.pts = []; }
  activate() { this.pts = []; this.vp.hud('Wall tool — click to set the first point · Shift = 15° steps · Enter/double-click/RMB to finish · Esc cancel'); }
  deactivate() { this.pts = []; super.deactivate(); }
  hover(info) { this._preview(info); }
  pointerMove(info) { this._preview(info); }
  _cur(info) {
    let p = this.point(info);
    if (!p) return null;
    const last = this.pts.at(-1);
    if (last && info.shift) { p = snapAngle(last, p); p = this.vp.snap(p, info.ctrl); p.y = this.vp.workY; }
    return p;
  }
  _preview(info) {
    this.clear();
    const cur = this._cur(info);
    const last = this.pts.at(-1);
    if (!cur) return;
    const pts = [...this.pts];
    if (pts.length) {
      pts.push(cur);
      const len = last.distanceTo(cur);
      const ang = (Math.atan2(-(cur.z - last.z), cur.x - last.x) * RAD2DEG).toFixed(0);
      this.vp.hud(`Length ${len.toFixed(2)} m · angle ${ang}° · ${this.pts.length} point(s)`);
    }
    if (pts.length > 1) this.vp.toolGroup.add(helperLine(pts.map((p) => p.clone().setY(p.y + 0.05)), 0xffb35a));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd36a, depthTest: false }));
    dot.position.copy(cur).setY(cur.y + 0.05); dot.layers.set(HELPER_LAYER); dot.raycast = () => {}; dot.renderOrder = 41;
    this.vp.toolGroup.add(dot);
    this.vp.requestRender();
  }
  pointerDown(info) { this.down = { x: info.ev.clientX, y: info.ev.clientY, t: performance.now() }; }
  pointerUp(info) {
    if (!this.down || Math.hypot(info.ev.clientX - this.down.x, info.ev.clientY - this.down.y) > 5) return;
    const p = this._cur(info);
    if (!p) return;
    const first = this.pts[0];
    if (this.pts.length >= 3 && first.distanceTo(p) < 0.01) { this.pts.push(first.clone()); this.finish(true); return; }
    if (this.pts.length && this.pts.at(-1).distanceTo(p) < 0.01) { this.finish(); return; }  // double-click on the same point
    this.pts.push(p);
    this._preview(info);
  }
  contextMenu() { if (this.pts.length) { this.finish(); return true; } return false; }
  cancel() { this.pts = []; super.cancel(); }
  finish(closed = false) {
    const pts = this.pts; this.pts = [];
    this.clear(); this.vp.hud('Wall tool — click to set the first point');
    if (pts.length < 2) return;
    const h = this.opt('wallHeight'), t = this.opt('wallThick'), mat = this.opt('wallMaterial'), over = this.opt('overlapJoints');
    const app = this.app;
    const created = [];
    app.tx(`Draw ${pts.length - 1} wall(s)`, () => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const joinStart = over && (i > 0 || closed), joinEnd = over && (i < pts.length - 2 || closed);
        const w = wallBetween(a, b, null, joinStart ? t / 2 : 0, joinEnd ? t / 2 : 0);
        if (w.L < 0.05) continue;
        const n = app.createNode('wall', { name: 'Wall', p: [w.centre.x, w.centre.y, w.centre.z], r: [0, w.yaw, 0], props: { length: Math.round(w.L * 1000) / 1000, height: h, thick: t, material: mat } }, { select: false });
        created.push(n.id);
      }
    });
    app.select(created);
    app.log('info', `Drew ${created.length} wall(s)`);
  }
}

// ------------------------------------------------------------------ room
export class RoomTool extends BaseTool {
  constructor() { super('room'); this.a = null; }
  activate() { this.vp.hud('Room tool — drag a rectangle on the work plane (floor, ceiling, 4 walls) · Ctrl = no snap'); }
  pointerDown(info) { const p = this.point(info); if (p) this.a = p; }
  pointerMove(info) { if (!this.a) return; this._preview(this.point(info)); }
  hover() {}
  _rect(b, a = this.a) {
    return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
  }
  _preview(b) {
    this.clear();
    if (!b || !this.a) return;
    const r = this._rect(b), y = this.vp.workY + 0.05;
    this.vp.toolGroup.add(helperLine([new THREE.Vector3(r.x0, y, r.z0), new THREE.Vector3(r.x1, y, r.z0), new THREE.Vector3(r.x1, y, r.z1), new THREE.Vector3(r.x0, y, r.z1)], 0xffb35a, true));
    this.vp.hud(`Room ${(r.x1 - r.x0).toFixed(2)} × ${(r.z1 - r.z0).toFixed(2)} m  (${((r.x1 - r.x0) * (r.z1 - r.z0)).toFixed(1)} m²)`);
    this.vp.requestRender();
  }
  pointerUp(info) {
    const a = this.a; this.a = null; this.clear();
    const b = this.point(info);
    if (!a || !b) return;
    const r = this._rect(b, a);
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    if (w < 0.5 || d < 0.5) { this.vp.hud('Room too small — drag a bigger rectangle'); return; }
    createRoom(this.app, { cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, y: this.vp.workY, w, d }, {
      height: this.opt('wallHeight'), thick: this.opt('wallThick'), wallMaterial: this.opt('wallMaterial'), floorMaterial: this.opt('floorMaterial'),
      ceilingMaterial: this.opt('ceilingMaterial'), ceiling: this.opt('ceiling'), floor: this.opt('floor'), doorSide: this.opt('doorSide'),
    });
    this.vp.hud('Room tool — drag a rectangle on the work plane');
  }
}

/** Builds a room from primitives inside one transaction. Exported so tests and templates can call it. */
export function createRoom(app, { cx, cz, y = 0, w, d }, o) {
  const t = o.thick, h = o.height;
  let group;
  app.tx('Create room', () => {
    group = app.createNode('group', { name: 'Room', p: [cx, y, cz] }, { select: false });
    const gid = group.id;
    const add = (type, opts) => app.createNode(type, opts, { parentId: gid, select: false });
    if (o.floor !== false) add('floor', { name: 'Floor', p: [0, 0, 0], props: { w, d, material: o.floorMaterial } });
    if (o.ceiling !== false) add('ceiling', { name: 'Ceiling', p: [0, h, 0], props: { w, d, material: o.ceilingMaterial } });
    const wall = (name, p, rot, len) => add('wall', { name, p, r: [0, rot, 0], props: { length: len, height: h, thick: t, material: o.wallMaterial } });
    wall('Wall North', [0, 0, -d / 2], 0, w + t);
    wall('Wall South', [0, 0, d / 2], 0, w + t);
    wall('Wall West', [-w / 2, 0, 0], 90, d - t);
    wall('Wall East', [w / 2, 0, 0], 90, d - t);
    const side = o.doorSide;
    if (side && side !== 'none') {
      const spec = { N: [0, 0, -d / 2, 0], S: [0, 0, d / 2, 180], W: [-w / 2, 0, 0, 90], E: [w / 2, 0, 0, -90] }[side[0].toUpperCase()];
      if (spec) add('door', { name: 'Door', p: [spec[0], 0, spec[2]], r: [0, spec[3], 0], props: { thick: t } });
    }
  });
  app.select([group.id]);
  app.log('info', `Created room ${w.toFixed(1)} × ${d.toFixed(1)} m`);
  return group;
}

// ------------------------------------------------------------------ corridor
export class CorridorTool extends BaseTool {
  constructor() { super('corridor'); this.a = null; }
  activate() { this.vp.hud('Corridor tool — drag from start to end (Shift = 15° steps)'); }
  pointerDown(info) { const p = this.point(info); if (p) this.a = p; }
  _end(info) { let p = this.point(info); if (p && this.a && info.shift) { p = snapAngle(this.a, p); p = this.vp.snap(p, info.ctrl); p.y = this.vp.workY; } return p; }
  pointerMove(info) {
    if (!this.a) return;
    const b = this._end(info); this.clear(); if (!b) return;
    const wdt = this.opt('corridorWidth');
    const dx = b.x - this.a.x, dz = b.z - this.a.z, len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const nx = -dz / len * wdt / 2, nz = dx / len * wdt / 2, y = this.vp.workY + 0.05;
    this.vp.toolGroup.add(helperLine([new THREE.Vector3(this.a.x + nx, y, this.a.z + nz), new THREE.Vector3(b.x + nx, y, b.z + nz), new THREE.Vector3(b.x - nx, y, b.z - nz), new THREE.Vector3(this.a.x - nx, y, this.a.z - nz)], 0xffb35a, true));
    this.vp.hud(`Corridor ${len.toFixed(2)} m × ${wdt} m`);
    this.vp.requestRender();
  }
  hover() {}
  pointerUp(info) {
    const a = this.a; this.a = null; this.clear();
    const b = this._end(info);
    if (!a || !b) return;
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    const t = this.opt('wallThick'), h = this.opt('wallHeight'), wdt = this.opt('corridorWidth');
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x) * RAD2DEG;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const app = this.app;
    let group;
    app.tx('Create corridor', () => {
      group = app.createNode('group', { name: 'Corridor', p: [mid.x, a.y, mid.z], r: [0, yaw, 0] }, { select: false });
      const add = (type, opts) => app.createNode(type, opts, { parentId: group.id, select: false });
      add('floor', { name: 'Floor', props: { w: len, d: wdt, material: this.opt('floorMaterial') } });
      if (this.opt('ceiling')) add('ceiling', { name: 'Ceiling', p: [0, h, 0], props: { w: len, d: wdt, material: this.opt('ceilingMaterial') } });
      add('wall', { name: 'Wall Left', p: [0, 0, -wdt / 2], props: { length: len, height: h, thick: t, material: this.opt('wallMaterial') } });
      add('wall', { name: 'Wall Right', p: [0, 0, wdt / 2], props: { length: len, height: h, thick: t, material: this.opt('wallMaterial') } });
    });
    app.select([group.id]);
    app.log('info', `Created corridor ${len.toFixed(1)} m`);
  }
}

// ------------------------------------------------------------------ measure
export class MeasureTool extends BaseTool {
  constructor() { super('measure'); this.a = null; }
  activate() { this.a = null; this.vp.hud('Measure — click two points on the work plane or on a surface'); }
  _p(info) {
    const hit = this.vp.pick(info.ev.clientX, info.ev.clientY, { includeLocked: true });
    return hit?.point || info.ground;
  }
  hover(info) { this.pointerMove(info); }
  pointerMove(info) {
    if (!this.a) return;
    const b = this._p(info); if (!b) return;
    this.clear();
    this.vp.toolGroup.add(helperLine([this.a, b], 0x6fe3ff));
    const d = b.clone().sub(this.a);
    this.vp.hud(`Distance ${d.length().toFixed(3)} m · horizontal ${Math.hypot(d.x, d.z).toFixed(3)} m · vertical ${d.y.toFixed(3)} m`);
    this.vp.requestRender();
  }
  pointerDown(info) { this.down = { x: info.ev.clientX, y: info.ev.clientY }; }
  pointerUp(info) {
    if (Math.hypot(info.ev.clientX - this.down.x, info.ev.clientY - this.down.y) > 5) return;
    const p = this._p(info); if (!p) return;
    if (!this.a) { this.a = p.clone(); return; }
    const d = p.distanceTo(this.a);
    this.app.log('info', `Measured ${d.toFixed(3)} m`);
    this.a = null;
  }
  cancel() { this.a = null; super.cancel(); }
}

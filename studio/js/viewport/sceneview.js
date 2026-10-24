// SceneView: keeps a THREE object graph in sync with the SceneModel.
// One Group per node (mirrors the hierarchy) holding that node's built Entry. The model is never written from here.

import * as THREE from '../../lib/three.module.js';
import { ROOT_ID } from '../core/scene.js';
import { wallOpenings, nodeWorldAABB } from '../core/geometry.js';
import { buildEntry, selectionOutline } from './builders.js';

const D2R = Math.PI / 180;
const r2 = (v) => Math.round(v * 100) / 100;

export class SceneView {
  constructor(app, requestRender) {
    this.app = app;
    this.requestRender = requestRender;
    this.group = new THREE.Group();
    this.group.name = 'SceneView';
    this.items = new Map();      // nodeId -> { obj, entry, outline, sig }
    this.helpersVisible = true;
    this.animate = false;
    this.pendingWalls = new Set();
    this.pendingDoors = new Set();
    this.pendingPaths = new Set();
    this.flushScheduled = false;
    this.selected = new Set();
    this.hover = null;
    this.stats = { rebuilds: 0 };
    this._bx = {
      get scene() { return app.scene; },
      get geo() { return app.project.geoCtx; },
      assets: app.assets,
      baseUrl: app.baseUrl,
      log: (l, m) => app.log(l, m),
      mat: (id) => app.materials.get(id),
      animate: () => this.animate,
      requestRender: () => this.requestRender(),
    };
    this._off = [
      app.on('scene', (ev, ...a) => this.onSceneEvent(ev, ...a)),
    ];
  }

  dispose() { this._off.forEach((f) => f()); this.clear(); }

  clear() {
    for (const it of this.items.values()) it.entry.dispose();
    this.items.clear();
    while (this.group.children.length) this.group.remove(this.group.children[0]);
  }

  /** Rebuild everything from the current project (after open / import / new). */
  rebuild() {
    this.clear();
    this.selected.clear();
    const scene = this.app.scene;
    scene.walk((n) => { this.add(n.id); });
    this.requestRender();
  }

  parentGroup(node) { return node.parent && node.parent !== ROOT_ID ? this.items.get(node.parent)?.obj : this.group; }

  add(id) {
    const node = this.app.scene.get(id);
    if (!node || this.items.has(id)) return;
    const obj = new THREE.Group();
    obj.userData.nodeId = id;
    obj.name = node.name;
    const entry = buildEntry(node, this._bx);
    entry.helpers.visible = this.helpersVisible;
    obj.add(entry.root);
    this.applyTransform(node, obj);
    obj.visible = node.visible;
    (this.parentGroup(node) || this.group).add(obj);
    this.items.set(id, { obj, entry, outline: null, sig: this.wallSig(node) });
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    it.obj.parent?.remove(it.obj);
    it.entry.dispose();
    this.items.delete(id);
    this.selected.delete(id);
  }

  applyTransform(node, obj) {
    obj.position.set(...node.t.p);
    obj.rotation.set(node.t.r[0] * D2R, node.t.r[1] * D2R, node.t.r[2] * D2R, 'XYZ');
    obj.scale.set(...node.t.s);
  }

  rebuildEntry(id) {
    const it = this.items.get(id);
    const node = this.app.scene.get(id);
    if (!it || !node) return;
    it.obj.remove(it.entry.root);
    it.entry.dispose();
    it.entry = buildEntry(node, this._bx);
    it.entry.helpers.visible = this.helpersVisible;
    it.obj.add(it.entry.root);
    it.entry.extras.visible = this.selected.has(id);
    it.sig = this.wallSig(node);
    this.stats.rebuilds++;
    if (this.selected.has(id)) this._refreshOutline(id);
  }

  wallSig(node) {
    if (node.type !== 'wall') return '';
    return JSON.stringify(wallOpenings(this.app.scene, node, this.app.project.geoCtx).map((o) => [o.nodeId, r2(o.x0), r2(o.x1), r2(o.y0), r2(o.y1)]));
  }

  onSceneEvent(ev, id, a, b) {
    const scene = this.app.scene;
    if (ev === 'added') {
      this.add(id);
      const n = scene.get(id);
      if (n.type === 'door' || n.type === 'window') this.pendingDoors.add(id);
      if (n.type === 'wall') this.pendingWalls.add(id);
      if (n.type === 'waypoint' && n.parent) this.pendingPaths.add(n.parent);
    } else if (ev === 'removed') {
      const it = this.items.get(id);
      const t = it && scene.get(id);
      this.remove(id);
      this.pendingDoors.add('*'); // openings may have closed up
      if (a) this.pendingPaths.add(a);
    } else if (ev === 'moved') {
      const it = this.items.get(id);
      const node = scene.get(id);
      if (it) { const pg = this.parentGroup(node); if (pg && it.obj.parent !== pg) pg.add(it.obj); }
      if (node.type === 'door' || node.type === 'window') this.pendingDoors.add(id);
      if (node.type === 'wall') this.pendingWalls.add(id);
      if (node.type === 'waypoint') { this.pendingPaths.add(a); this.pendingPaths.add(b); }
    } else if (ev === 'changed') {
      const it = this.items.get(id);
      const node = scene.get(id);
      if (!it || !node) return;
      const fields = a || [];
      if (fields.includes('t')) {
        this.applyTransform(node, it.obj);
        if (node.type === 'door' || node.type === 'window') this.pendingDoors.add(id);
        if (node.type === 'wall') this.pendingWalls.add(id);
        if (node.type === 'waypoint' && node.parent) this.pendingPaths.add(node.parent);
        // children of a moved door/window/wall (rare) are handled by their own events
      }
      const propChange = fields.some((f) => f.startsWith('props'));
      if (propChange) {
        this.rebuildEntry(id);
        if (node.type === 'door' || node.type === 'window') this.pendingDoors.add(id);
        if (node.type === 'waypoint' && node.parent) this.pendingPaths.add(node.parent);
      }
      if (fields.includes('visible')) {
        it.obj.visible = node.visible;
        if (node.type === 'door' || node.type === 'window') this.pendingDoors.add('*');
      }
      if (fields.includes('name')) it.obj.name = node.name;
      if (fields.includes('props') || fields.includes('meta') ) { /* patch() with whole props object */ if (!propChange) this.rebuildEntry(id); }
    }
    this.scheduleFlush();
    this.requestRender();
  }

  scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    (globalThis.requestAnimationFrame || ((f) => setTimeout(f, 16)))(() => { this.flushScheduled = false; this.flush(); });
  }

  /** Re-check walls whose door/window openings may have changed, and path lines. */
  flush() {
    const scene = this.app.scene;
    const doors = [...this.pendingDoors]; this.pendingDoors.clear();
    const walls = new Set([...this.pendingWalls].filter((i) => scene.has(i))); this.pendingWalls.clear();
    const paths = [...this.pendingPaths]; this.pendingPaths.clear();
    if (doors.length) {
      const all = doors.includes('*') || doors.length > 40;
      const boxes = all ? [] : doors.filter((d) => scene.has(d)).map((d) => nodeWorldAABB(scene, d, this.app.project.geoCtx).expandByScalar(0.6));
      scene.walk((n) => {
        if (n.type !== 'wall') return;
        if (all) { walls.add(n.id); return; }
        const wb = nodeWorldAABB(scene, n.id, this.app.project.geoCtx);
        if (boxes.some((b) => b.intersectsBox(wb))) walls.add(n.id);
      });
    }
    for (const id of walls) {
      const node = scene.get(id); const it = this.items.get(id);
      if (!node || !it) continue;
      const sig = this.wallSig(node);
      if (sig !== it.sig) this.rebuildEntry(id);
    }
    for (const id of paths) if (id && scene.has(id) && scene.get(id).type === 'path') this.rebuildEntry(id);
    this.requestRender();
  }

  /** Rebuild every node that displays an asset (after asset metadata such as scale/pivot/overrides changed). */
  rebuildModels() {
    for (const [id] of this.items) { const n = this.app.scene.get(id); if (n && (n.type === 'model' || n.type === 'itemSpawn')) this.rebuildEntry(id); }
    this.requestRender();
  }

  // ------------------------------------------------------------ editor state
  setHelpersVisible(v) {
    this.helpersVisible = v;
    for (const it of this.items.values()) it.entry.helpers.visible = v;
    this.requestRender();
  }

  setSelection(ids, primary) {
    const next = new Set(ids);
    for (const id of this.selected) if (!next.has(id)) { this._clearOutline(id); const it = this.items.get(id); if (it) it.entry.extras.visible = false; }
    this.selected = next;
    for (const id of next) {
      const it = this.items.get(id);
      if (!it) continue;
      it.entry.extras.visible = true;
      this._refreshOutline(id, id === primary);
    }
    this.requestRender();
  }

  _clearOutline(id) {
    const it = this.items.get(id);
    if (it?.outline) { it.obj.remove(it.outline); it.outline.geometry.dispose(); it.outline.material.dispose(); it.outline = null; }
  }
  _refreshOutline(id, primary = null) {
    const it = this.items.get(id); const node = this.app.scene.get(id);
    if (!it || !node) return;
    if (primary === null) primary = this.app.selection.at(-1) === id;
    this._clearOutline(id);
    const locked = this.app.scene.isLocked(id);
    it.outline = selectionOutline(node, this.app.project.geoCtx, locked ? 0x8a8f96 : primary ? 0xff9a2a : 0xffd84a);
    it.obj.add(it.outline);
  }
  refreshOutlines() { for (const id of this.selected) this._refreshOutline(id); }

  setHover(id) {
    if (this.hover === id) return;
    const prev = this.hover && this.items.get(this.hover);
    if (prev && !this.selected.has(this.hover)) this._clearOutline(this.hover);
    this.hover = id;
    if (id && !this.selected.has(id)) {
      const it = this.items.get(id), node = this.app.scene.get(id);
      if (it && node) { this._clearOutline(id); it.outline = selectionOutline(node, this.app.project.geoCtx, 0x6fc3ff); it.obj.add(it.outline); }
    }
    this.requestRender();
  }

  tick(dt) {
    let any = false;
    for (const it of this.items.values()) if (it.entry.tick) { it.entry.tick(dt); any = true; }
    return any && this.animate;
  }

  /** nodeId for a raycast-hit object. */
  nodeIdOf(obj) {
    while (obj) { if (obj.userData?.nodeId) return obj.userData.nodeId; obj = obj.parent; }
    return null;
  }

  entryOf(id) { return this.items.get(id)?.entry || null; }
  objectOf(id) { return this.items.get(id)?.obj || null; }

  /** Problems reported by builders (missing assets, failed loads...). */
  problems() {
    const out = [];
    for (const [id, it] of this.items) for (const p of it.entry.problems) out.push({ nodeId: id, message: p });
    return out;
  }

  stat() {
    let meshes = 0, tris = 0;
    this.group.traverse((o) => {
      if (o.isMesh && o.layers.isEnabled(0) && o.visible) { meshes++; const g = o.geometry; tris += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3; }
    });
    return { meshes, tris: Math.round(tris), nodes: this.items.size };
  }
}

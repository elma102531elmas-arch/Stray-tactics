// Debug overlays drawn on top of the scene: collision boxes, navigation mesh, validation markers, bounds.
// Everything is rebuilt lazily from the model, only while the overlay is switched on.

import * as THREE from '../../lib/three.module.js';
import { worldColliders, nodeWorldAABB, subtreeAABB } from '../core/geometry.js';
import { CollisionWorld } from '../core/collision.js';
import { buildNavMesh } from '../core/navmesh.js';
import { sceneBounds } from '../core/geometry.js';
import { HELPER_LAYER } from './builders.js';
import { resolveArchetype, HIT_ZONES, hitRadius } from '../core/aisystem.js';
import { PLAYER_REFERENCE } from '../core/game-constants.js';
import { propsOf } from '../core/geometry.js';

const KIND_COLOR = { solid: 0xff5050, ground: 0x50ff90, door: 0xffa040, volume: 0x40a0ff, terrain: 0x60c060, navBlock: 0xff40ff, navAllow: 0x40ffd0 };
const SEV_COLOR = { error: 0xff4444, warn: 0xffc34a, info: 0x6fc3ff };

export class Overlays {
  constructor(vp) {
    this.vp = vp; this.app = vp.app;
    this.on = { collision: false, navmesh: false, issues: true, bounds: false, lights: false, hitboxes: false };
    this.group = new THREE.Group(); this.group.name = 'overlays';
    vp.scene.add(this.group);
    this.parts = {};
    this.stale = { collision: true, navmesh: true, issues: true, bounds: true, lights: true, hitboxes: true };
    this.issues = [];
    this.nav = null;
    this.navInfo = null;
    this.colliderCount = 0;
  }

  set(name, v) {
    this.on[name] = v;
    this.stale[name] = true;
    this.refresh(name);
    this.vp.emit('overlay', name, v);
  }
  toggle(name) { this.set(name, !this.on[name]); }
  invalidate() {
    for (const k of ['collision', 'issues', 'bounds', 'lights', 'hitboxes']) this.stale[k] = true;
    this.navStale = true;
    for (const k of Object.keys(this.on)) if (this.on[k] && k !== 'navmesh') this._schedule(k);
  }
  onSelection() { this.stale.bounds = true; if (this.on.bounds) this.refresh('bounds'); this.stale.hitboxes = true; if (this.on.hitboxes) this.refresh('hitboxes'); }
  _schedule(k) {
    this._t = this._t || {};
    if (this._t[k]) return;
    this._t[k] = setTimeout(() => { this._t[k] = null; this.refresh(k); }, 120);
  }

  _clear(name) {
    const p = this.parts[name];
    if (p) { this.group.remove(p); p.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); delete this.parts[name]; }
  }
  _set(name, obj) { this._clear(name); if (obj) { obj.traverse((o) => { o.layers.set(HELPER_LAYER); if (!o.userData.pickable) o.raycast = () => {}; }); this.parts[name] = obj; this.group.add(obj); } this.vp.requestRender(); }

  refresh(name) {
    if (!this.on[name]) { this._clear(name); this.vp.requestRender(); return; }
    if (name === 'collision') this._collision();
    else if (name === 'navmesh') this._navmesh();
    else if (name === 'issues') this._issues();
    else if (name === 'bounds') this._bounds();
    else if (name === 'lights') this._lights();
    else if (name === 'hitboxes') this._hitboxes();
    this.stale[name] = false;
  }

  _collision() {
    const cols = worldColliders(this.app.scene, this.app.project.geoCtx);
    this.colliderCount = cols.length;
    const byKind = {};
    const corner = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const v = new THREE.Vector3();
    for (const c of cols) {
      if (c.kind === 'terrain') continue;
      const arr = (byKind[c.kind] = byKind[c.kind] || []);
      const pts = corner.map((k) => v.clone().set(c.min[0] + (c.max[0] - c.min[0]) * k[0], c.min[1] + (c.max[1] - c.min[1]) * k[1], c.min[2] + (c.max[2] - c.min[2]) * k[2]).applyMatrix4(c.rt));
      for (const [a, b] of edges) arr.push(pts[a].x, pts[a].y, pts[a].z, pts[b].x, pts[b].y, pts[b].z);
    }
    const g = new THREE.Group();
    for (const [k, arr] of Object.entries(byKind)) {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: KIND_COLOR[k] || 0xffffff, transparent: true, opacity: 0.8 })));
    }
    this._set('collision', g);
  }

  /** Builds (synchronously) and draws the navigation mesh. Returns stats. */
  buildNav(opts = {}) {
    const t0 = performance.now();
    const project = this.app.project;
    const world = new CollisionWorld(worldColliders(project.scene, project.geoCtx));
    const b = sceneBounds(project.scene, project.geoCtx);
    const seeds = project.scene.find((n) => n.type === 'playerSpawn').map((n) => project.scene.worldPosition(n.id));
    this.nav = buildNavMesh(world, b, { cell: 0.25, seeds, ...opts });
    this.navInfo = { ...this.nav.stats, ms: Math.round(performance.now() - t0), sceneVersion: project.scene.version };
    this.navStale = false;
    return this.navInfo;
  }

  _navmesh() {
    if (!this.nav || this.navStale) this.buildNav();
    const nav = this.nav;
    const n = nav.nodes.length;
    const geo = new THREE.PlaneGeometry(nav.cell * 0.92, nav.cell * 0.92).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    nav.nodes.forEach((nd, i) => {
      m.makeTranslation(nd.x, nd.y + 0.03, nd.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, nd.reachable ? c.setHSL(((nd.comp * 0.137) % 1), 0.6, 0.5) : c.set(0xff2a2a));
    });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    this._set('navmesh', mesh);
  }

  setIssues(issues) { this.issues = issues || []; this.stale.issues = true; if (this.on.issues) this._issues(); }
  _issues() {
    const g = new THREE.Group();
    const scene = this.app.scene;
    for (const is of this.issues) {
      if (is.severity === 'info') continue;
      for (const id of is.nodes || []) {
        if (!scene.has(id)) continue;
        const pos = scene.worldPosition(id);
        const box = nodeWorldAABB(scene, id, this.app.project.geoCtx);
        const top = new THREE.Vector3(pos.x, Math.max(box.max.y, pos.y) + 0.5, pos.z);
        const geo = new THREE.ConeGeometry(0.16, 0.4, 4).rotateX(Math.PI);
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: SEV_COLOR[is.severity] || 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }));
        mesh.position.copy(top); mesh.renderOrder = 30;
        g.add(mesh);
      }
    }
    this._set('issues', g);
  }

  _bounds() {
    const g = new THREE.Group();
    const scene = this.app.scene;
    for (const id of this.app.selection) {
      if (!scene.has(id)) continue;
      const b = subtreeAABB(scene, id, this.app.project.geoCtx);
      if (b.isEmpty()) continue;
      const h = new THREE.Box3Helper(b, 0x5ad1ff); h.material.depthTest = false; h.renderOrder = 25;
      g.add(h);
    }
    this._set('bounds', g);
  }

  _lights() {
    const g = new THREE.Group();
    const scene = this.app.scene;
    scene.walk((n) => {
      if (n.type !== 'light') return;
      const p = { ...n.props };
      const pos = scene.worldPosition(n.id);
      const geo = new THREE.SphereGeometry(p.range || 5, 14, 8);
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: new THREE.Color(p.color || '#ffd070'), transparent: true, opacity: 0.25 }));
      geo.dispose(); l.position.copy(pos); g.add(l);
    });
    this._set('lights', g);
  }

  /**
   * Hit boxes and reach: every enemy as the cylinder the hit-scan really tests (legs / body / head bands from core/aisystem.js, so the picture cannot drift from
   * the rules), the player capsule + eye height at each player spawn, and the 2.4 m interaction reach around the selected pickups / interaction volumes.
   */
  _hitboxes() {
    const g = new THREE.Group(), scene = this.app.scene, project = this.app.project;
    const band = (r, y0, y1, color, pos) => {
      const geo = new THREE.CylinderGeometry(r, r, y1 - y0, 20, 1, true);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(pos.x, pos.y + (y0 + y1) / 2, pos.z); g.add(m);
      const w = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 })); w.position.copy(m.position); g.add(w);
    };
    scene.walk((n) => {
      if (!scene.isVisible(n.id)) return;
      const pos = scene.worldPosition(n.id);
      if (n.type === 'enemySpawn') {
        const arch = resolveArchetype(project, propsOf(n).archetype); if (!arch) return;
        const r = hitRadius(arch), h = arch.height;
        band(r, 0, h * HIT_ZONES.body, 0x4aa3ff, pos); band(r, h * HIT_ZONES.body, h * HIT_ZONES.head, 0xffb347, pos); band(r, h * HIT_ZONES.head, h, 0xff4a4a, pos);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9b0 })); eye.position.set(pos.x, pos.y + h * 0.9, pos.z); g.add(eye);
      } else if (n.type === 'playerSpawn') {
        const r = PLAYER_REFERENCE.radius, h = 1.8;
        band(r, 0, h, 0x40ff90, pos);
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(pos.x - 0.5, pos.y + PLAYER_REFERENCE.eyeHeight, pos.z), new THREE.Vector3(pos.x + 0.5, pos.y + PLAYER_REFERENCE.eyeHeight, pos.z)]), new THREE.LineBasicMaterial({ color: 0xffffff })); g.add(l);
      } else if (this.app.selection.includes(n.id) && (n.type === 'itemSpawn' || n.type === 'interaction' || (n.type === 'model' && n.props.interaction?.enabled))) {
        const c = nodeWorldAABB(scene, n.id, project.geoCtx).getCenter(new THREE.Vector3());
        const geo = new THREE.SphereGeometry(PLAYER_REFERENCE.interactReach, 18, 10);
        const w = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x7bd88f, transparent: true, opacity: 0.35 })); w.position.copy(c); g.add(w);
      }
    });
    this._set('hitboxes', g);
  }

  summary() {
    return { collision: this.on.collision ? this.colliderCount : null, nav: this.navInfo };
  }
}

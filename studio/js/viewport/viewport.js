// Viewport: WebGL renderer, camera navigation, picking, grid, lights, gizmo and tool dispatch.
// Rendering is on demand (only when something changed) so an idle editor costs nothing.

import * as THREE from '../../lib/three.module.js';
import { Emitter } from '../core/util.js';
import { SceneView } from './sceneview.js';
import { LightRig } from './lightrig.js';
import { GizmoController } from './gizmo.js';
import { Overlays } from './overlays.js';
import { HELPER_LAYER } from './builders.js';
import { sceneBounds, subtreeAABB } from '../core/geometry.js';

const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Viewport extends Emitter {
  constructor(app, container) {
    super();
    this.app = app;
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vp-canvas';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, app.pref('pixelRatio', 2)));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.enabled = !!app.pref('shadows', false);
    app.assets.setRenderer(this.renderer);

    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -1000, 2000);
    this.camera = this.persp;
    this.projection = 'persp';
    this.nav = { target: new THREE.Vector3(8, 0, 8), yaw: 35 * D2R, pitch: 32 * D2R, dist: 22 };
    this.flySpeed = 7;
    this.keys = new Set();
    this.flying = false;
    this.shading = 'lit';            // lit | game | wire | normals
    this.workY = 0;
    this.needsRender = true;
    this.fps = 0; this._frames = 0; this._fpsT = performance.now();
    this.animate = false;
    this.time = 0;
    this.hoverEnabled = true;
    this.tools = {};
    this.tool = null;

    // lighting
    this.hemi = new THREE.HemisphereLight(0xdde6f5, 0x3a3a44, 1.2);
    this.headlight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.moon = new THREE.DirectionalLight(0x8fa3c8, 0);
    this.scene.add(this.hemi, this.headlight, this.headlight.target, this.moon, this.moon.target);
    this.rig = new LightRig(this.scene);

    // content
    this.sceneView = new SceneView(app, () => this.requestRender());
    this.scene.add(this.sceneView.group);
    this.toolGroup = new THREE.Group(); this.toolGroup.name = 'tool'; this.scene.add(this.toolGroup);
    this.grid = null;
    this.rebuildGrid();
    this.gizmo = new GizmoController(app, this);
    this.overlays = new Overlays(this);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line = { threshold: 0.08 };
    this.hudEl = document.createElement('div');
    this.hudEl.className = 'chip vp-tool-hud';
    Object.assign(this.hudEl.style, { position: 'absolute', left: '50%', top: '10px', transform: 'translateX(-50%)', display: 'none', pointerEvents: 'none', color: '#ffd9a8', zIndex: 3 });
    container.appendChild(this.hudEl);
    this.axisScene = this._makeAxisScene();

    this._bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    app.on('project', () => this.onProject());
    app.on('selection', () => this.onSelection());
    app.on('history', () => this.onHistory());
    app.on('assets', () => { this.sceneView.rebuild(); this.onSelection(); });
    app.materials.onChange(() => this.requestRender());
    this.onProject();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    window.__vp = this;     // handy for the browser tests
  }

  // ------------------------------------------------------------ lifecycle / state
  onProject() {
    this.sceneView.rebuild();
    this.rebuildGrid();
    this.applyEnvironment();
    this.gizmo.applySnap();
    this.gizmo.sync();
    this.overlays.invalidate();
    const b = sceneBounds(this.app.scene, this.app.project.geoCtx);
    if (this.app.scene.size) this.frameBox(b, false); else { this.nav.target.set(0, 0, 0); this.nav.dist = 14; this.updateCamera(); }
    this.requestRender();
  }
  onSelection() {
    this.sceneView.setSelection(this.app.selection, this.app.selection.at(-1));
    this.gizmo.sync();
    this.overlays.onSelection();
  }
  onHistory() {
    const changed = this.app.materials.refreshChanged();
    this.applyEnvironment();
    this.rebuildGrid();
    this.gizmo.applySnap();
    this.overlays.invalidate();
    this.sceneView.refreshOutlines();
    if (changed.length) this.requestRender();
    this.requestRender();
  }

  requestRender() { this.needsRender = true; }

  resize() {
    const w = Math.max(10, this.container.clientWidth), h = Math.max(10, this.container.clientHeight);
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    this.updateCamera();
    this.requestRender();
  }

  setProjection(kind) {
    this.projection = kind;
    this.camera = kind === 'ortho' ? this.ortho : this.persp;
    this.gizmo.setCamera(this.camera);
    this.updateCamera();
    this.emit('projection', kind);
  }

  setShading(mode) { this.shading = mode; this.applyEnvironment(); this.emit('shading', mode); this.requestRender(); }

  applyEnvironment() {
    const env = this.app.project.data.environment;
    const game = this.shading === 'game';
    this.renderer.toneMappingExposure = game ? env.exposure : 1;
    this.scene.background = new THREE.Color(game ? env.clearColor : '#1c2027');
    this.scene.fog = game ? new THREE.FogExp2(env.fog.color, env.fog.density) : null;
    this.hemi.color.set(env.ambient.color); this.hemi.groundColor.set(env.ambient.groundColor);
    this.hemi.intensity = game ? env.ambient.intensity * 0.5 : 1.25;
    this.headlight.visible = !game;
    this.moon.intensity = game && env.moon.enabled ? env.moon.intensity : 0;
    this.moon.color.set(env.moon.color);
    this.moon.position.set(...env.moon.direction.map((v) => v * 50));
    this.renderer.shadowMap.enabled = !!this.app.pref('shadows', false);
    this.requestRender();
  }

  rebuildGrid() {
    const s = this.app.project.data.settings.grid;
    const size = s.size || 0.5;
    const ext = Math.min(200, Math.max(40, Math.max(...(this.app.project.data.environment.mapSize || [64, 64]))));
    const step = size < 0.25 ? 0.25 : size;
    const half = Math.ceil(ext / 2 / step) * step;
    const n = Math.round((half * 2) / step);
    if (n > 800) { /* absurdly fine grid: draw 1 m lines only */ }
    const g = this._gridGeometry(half, n > 800 ? 1 : step);
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); }
    this.grid = g;
    this.grid.position.y = this.workY;
    this.grid.visible = this.app.pref('grid', true);
    this.scene.add(this.grid);
    this.requestRender();
  }
  _gridGeometry(half, step) {
    const minor = [], major = [], axisX = [], axisZ = [];
    for (let v = -half; v <= half + 1e-6; v += step) {
      const isMajor = Math.abs(v / 1 - Math.round(v / 1)) < 1e-6 && Math.round(v) % 5 === 0;
      const arr = Math.abs(v) < 1e-6 ? null : isMajor ? major : minor;
      if (arr) { arr.push(-half, 0, v, half, 0, v, v, 0, -half, v, 0, half); }
    }
    axisX.push(-half, 0, 0, half, 0, 0); axisZ.push(0, 0, -half, 0, 0, half);
    const grp = new THREE.Group();
    const mk = (pts, color, op) => {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
      l.raycast = () => {}; l.layers.set(HELPER_LAYER); grp.add(l); return l;
    };
    mk(minor, 0x5a6577, 0.5); mk(major, 0x7d899c, 0.85); mk(axisX, 0xc0504d, 0.9); mk(axisZ, 0x4d7fc0, 0.9);
    grp.traverse((o) => o.layers.set(HELPER_LAYER));
    grp.geometry = { dispose: () => grp.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); }) };
    return grp;
  }

  // ------------------------------------------------------------ camera
  get dir() {
    const { yaw, pitch } = this.nav;
    return new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
  }
  updateCamera() {
    const n = this.nav;
    n.pitch = clamp(n.pitch, -89.9 * D2R, 89.9 * D2R);
    n.dist = clamp(n.dist, 0.3, 1500);
    const d = this.dir.multiplyScalar(n.dist);
    const cam = this.camera;
    if (this.projection === 'ortho') {
      const half = n.dist * 0.5, a = this.width / this.height;
      this.ortho.left = -half * a; this.ortho.right = half * a; this.ortho.top = half; this.ortho.bottom = -half;
      this.ortho.position.copy(n.target).add(this.dir.multiplyScalar(500));
      this.ortho.updateProjectionMatrix();
    } else cam.position.copy(n.target).add(d);
    cam.lookAt(n.target);
    cam.updateMatrixWorld(true);
    this.requestRender();
  }
  /** World units covered by one screen pixel at the target distance. */
  pixelSize() {
    if (this.projection === 'ortho') return this.nav.dist / this.height;
    return (2 * this.nav.dist * Math.tan((this.persp.fov * D2R) / 2)) / this.height;
  }
  orbit(dx, dy) { this.nav.yaw -= dx * 0.0055; this.nav.pitch += dy * 0.0055; this.updateCamera(); }
  pan(dx, dy) {
    const k = this.pixelSize();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.nav.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    this.updateCamera();
  }
  dolly(deltaY, clientX, clientY) {
    const f = Math.exp(clamp(deltaY, -300, 300) * 0.0012);
    const before = this.nav.dist;
    const after = clamp(before * f, 0.3, 1500);
    // zoom toward the cursor: move the target toward the point under the cursor by the fraction we zoomed
    if (clientX !== undefined) {
      const p = this.pointOnTargetPlane(clientX, clientY);
      if (p) this.nav.target.lerp(p, 1 - after / before);
    }
    this.nav.dist = after;
    this.updateCamera();
  }
  pointOnTargetPlane(clientX, clientY) {
    const ray = this.rayFromClient(clientX, clientY);
    const n = new THREE.Vector3(); this.camera.getWorldDirection(n);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.nav.target);
    return ray.intersectPlane(plane, new THREE.Vector3());
  }
  flyLook(dx, dy) {
    const pos = this.nav.target.clone().addScaledVector(this.dir, this.nav.dist);
    this.nav.yaw -= dx * 0.0035; this.nav.pitch = clamp(this.nav.pitch - dy * 0.0035, -89 * D2R, 89 * D2R);
    this.nav.target.copy(pos).addScaledVector(this.dir, -this.nav.dist);
    this.updateCamera();
  }
  flyMove(dt) {
    if (!this.flying) return false;
    const k = this.keys; let f = 0, r = 0, u = 0;
    if (k.has('KeyW')) f++; if (k.has('KeyS')) f--; if (k.has('KeyD')) r++; if (k.has('KeyA')) r--; if (k.has('KeyE')) u++; if (k.has('KeyQ')) u--;
    if (!f && !r && !u) return false;
    const fwd = this.dir.multiplyScalar(-1);
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const v = fwd.multiplyScalar(f).addScaledVector(right, r).addScaledVector(new THREE.Vector3(0, 1, 0), u);
    v.multiplyScalar(this.flySpeed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1) * dt);
    this.nav.target.add(v);
    this.updateCamera();
    return true;
  }
  setView(name) {
    const v = { top: [0, 89.9], bottom: [0, -89.9], front: [0, 0], back: [180, 0], right: [90, 0], left: [-90, 0], iso: [35, 32] }[name];
    if (!v) return;
    this.nav.yaw = v[0] * D2R; this.nav.pitch = v[1] * D2R;
    this.setProjection(['top', 'bottom', 'front', 'back', 'left', 'right'].includes(name) ? 'ortho' : 'persp');
    this.updateCamera();
  }
  frameBox(box, animate = true) {
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const r = Math.max(s.length() * 0.5, 0.5);
    this.nav.target.copy(c);
    this.nav.dist = this.projection === 'ortho' ? r * 2.2 : r / Math.sin((this.persp.fov * D2R) / 2) * 1.05;
    this.updateCamera();
  }
  frameSelection() {
    const ids = this.app.selection;
    if (!ids.length) return this.frameAll();
    const box = new THREE.Box3();
    for (const id of ids) box.union(subtreeAABB(this.app.scene, id, this.app.project.geoCtx));
    this.frameBox(box);
  }
  frameAll() { this.frameBox(sceneBounds(this.app.scene, this.app.project.geoCtx)); }

  // ------------------------------------------------------------ pointer / picking
  rayFromClient(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.camera = this.camera;
    return this.raycaster.ray.clone();
  }

  /** Nearest pickable node under a screen point. Icons beat solid geometry; transparent volume fills come last. */
  pick(clientX, clientY, { includeLocked = false, ignore = null } = {}) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.camera = this.camera;
    this.raycaster.layers.set(0);
    if (this.sceneView.helpersVisible) this.raycaster.layers.enable(HELPER_LAYER);
    const hits = this.raycaster.intersectObject(this.sceneView.group, true);
    const scene = this.app.scene;
    let sprite = null, solid = null, volume = null;
    for (const h of hits) {
      if (h.object.name === '__outline') continue;
      let id = this.sceneView.nodeIdOf(h.object);
      if (!id || !scene.has(id)) continue;
      if (ignore && ignore(id)) continue;
      if (!scene.isVisible(id)) continue;
      if (!includeLocked && scene.isLocked(id)) continue;
      const rec = { id, point: h.point, distance: h.distance, object: h.object, face: h.face };
      if (h.object.isSprite) { if (!sprite) sprite = rec; }
      else if (h.object.userData.volume) { if (!volume) volume = rec; }
      else if (!solid) solid = rec;
      if (sprite && solid) break;
    }
    const best = sprite && (!solid || sprite.distance < solid.distance + 4) ? sprite : solid || sprite || volume;
    if (!best) return null;
    if (best.face && best.object.matrixWorld) {
      best.normal = best.face.normal.clone().transformDirection(best.object.matrixWorld);
    }
    return best;
  }

  groundPoint(clientX, clientY, y = this.workY) {
    const ray = this.rayFromClient(clientX, clientY);
    const p = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    if (!p) return null;
    if (this.projection === 'persp' && p.distanceTo(this.camera.position) > 900) return null;
    return p;
  }
  snap(v, invert = false) {
    const s = this.app.project.data.settings.grid;
    if (!(invert ? !s.snap : s.snap)) return v;
    const k = s.size;
    return new THREE.Vector3(Math.round(v.x / k) * k, v.y, Math.round(v.z / k) * k);
  }

  info(ev) {
    const r = this.canvas.getBoundingClientRect();
    const info = { ev, x: ev.clientX - r.left, y: ev.clientY - r.top, alt: ev.altKey, shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey };
    info.ground = this.groundPoint(ev.clientX, ev.clientY);
    info.snapped = info.ground ? this.snap(info.ground, info.ctrl) : null;
    return info;
  }

  _bind() {
    const c = this.canvas;
    this.drag = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => this._up(e));
    c.addEventListener('wheel', (e) => { e.preventDefault(); if (this.flying) { this.flySpeed = clamp(this.flySpeed * (e.deltaY < 0 ? 1.25 : 0.8), 0.5, 80); return; } this.dolly(e.deltaY, e.clientX, e.clientY); }, { passive: false });
    c.addEventListener('pointerleave', () => { this.sceneView.setHover(null); });
    window.addEventListener('keydown', (e) => { if (!isTyping(e)) this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.flying = false; });
  }

  _down(e) {
    this.canvas.focus({ preventScroll: true });
    const nav = e.button === 1 || (e.button === 0 && e.altKey);
    if (nav) {
      this.drag = { kind: e.shiftKey ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      this.drag = { kind: 'fly', x: e.clientX, y: e.clientY, moved: 0 };
      this.flying = true; this.keys.clear();
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (this.gizmo.tc.axis !== null || this.gizmo.dragging) return;
    this.drag = { kind: 'tool' };
    this.canvas.setPointerCapture(e.pointerId);
    this.tool?.pointerDown?.(this.info(e));
  }
  _move(e) {
    const d = this.drag;
    if (d && d.kind !== 'tool') {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY;
      if (d.kind === 'orbit') this.orbit(dx, dy);
      else if (d.kind === 'pan') this.pan(dx, dy);
      else if (d.kind === 'fly') { d.moved += Math.abs(dx) + Math.abs(dy); this.flyLook(dx, dy); }
      return;
    }
    if (d && d.kind === 'tool') { this.tool?.pointerMove?.(this.info(e)); return; }
    // hover
    if (this.gizmo.dragging) return;
    this.tool?.hover?.(this.info(e));
  }
  _up(e) {
    const d = this.drag; this.drag = null;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.kind === 'fly') {
      this.flying = false;
      if (d.moved < 4) this.emit('contextmenu', e);   // plain right-click: context menu
      return;
    }
    if (d.kind === 'tool') this.tool?.pointerUp?.(this.info(e));
  }
  onGizmoDragging(on) { this.emit('gizmo-dragging', on); }

  setTool(id) {
    const next = this.tools[id];
    if (!next) throw new Error(`Unknown tool "${id}"`);
    if (this.tool === next) return;
    this.tool?.deactivate?.();
    this.toolGroup.clear();
    this.tool = next;
    next.activate?.();
    this.canvas.style.cursor = next.cursor || 'default';
    this.gizmo.sync();
    this.emit('tool', id);
    this.requestRender();
  }
  registerTool(tool) { this.tools[tool.id] = tool; tool.vp = this; tool.app = this.app; }

  /** One-line message shown at the top of the viewport (tool hints, live measurements). */
  hud(text) { this.hudEl.textContent = text || ''; this.hudEl.style.display = text ? 'block' : 'none'; }

  // ------------------------------------------------------------ frame loop
  _loop(now) {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, (now - (this._last || now)) / 1000);
    this._last = now;
    if (this.flying) { if (this.flyMove(dt)) this.needsRender = true; }
    this.time += dt;
    if (this.animate) { this.sceneView.animate = true; this.sceneView.tick(dt); this.needsRender = true; }
    else this.sceneView.animate = false;
    if (this.tool?.frame) this.tool.frame(dt);
    if (!this.needsRender) return;
    this.needsRender = false;
    this.render();
    this._frames++;
    if (now - this._fpsT > 1000) { this.fps = (this._frames * 1000) / (now - this._fpsT); this._frames = 0; this._fpsT = now; this.emit('stats'); }
  }

  render() {
    const r = this.renderer;
    const game = this.shading === 'game';
    this.headlight.position.copy(this.camera.position).add(new THREE.Vector3(2, 6, 1));
    this.headlight.target.position.copy(this.nav.target);
    this.rig.update(this.app.scene, this.camera, { animate: this.animate, time: this.time, enabled: this.app.pref('sceneLights', true) });
    const cam = this.camera;
    this.persp.near = Math.max(0.03, this.nav.dist / 2000);
    if (this.projection === 'persp') this.persp.updateProjectionMatrix();
    if (this.shading === 'wire' || this.shading === 'normals') {
      cam.layers.set(0);
      this.scene.overrideMaterial = this.shading === 'wire' ? WIRE : NORMALS;
      r.render(this.scene, cam);
      this.scene.overrideMaterial = null;
      r.autoClear = false;
      cam.layers.set(HELPER_LAYER);
      r.render(this.scene, cam);
      r.autoClear = true;
      cam.layers.enable(0);
    } else {
      cam.layers.enable(0); cam.layers.enable(HELPER_LAYER);
      r.render(this.scene, cam);
    }
    this._renderAxes();
    this.lastInfo = { calls: r.info.render.calls, tris: r.info.render.triangles };
  }

  _makeAxisScene() {
    const s = new THREE.Scene();
    const mk = (dir, color, label) => {
      const g = new THREE.Group();
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color }));
      const cvs = document.createElement('canvas'); cvs.width = cvs.height = 64;
      const x = cvs.getContext('2d'); x.fillStyle = '#' + color.toString(16).padStart(6, '0'); x.font = 'bold 44px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, 32, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs), depthTest: false }));
      sp.position.set(0, 1.35, 0); sp.scale.setScalar(0.7);
      g.add(line, sp);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      s.add(g);
    };
    mk(new THREE.Vector3(1, 0, 0), 0xe06060, 'X'); mk(new THREE.Vector3(0, 1, 0), 0x70d070, 'Y'); mk(new THREE.Vector3(0, 0, 1), 0x6090f0, 'Z');
    this.axisCam = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 10);
    return s;
  }
  _renderAxes() {
    const r = this.renderer, size = 84, pr = r.getPixelRatio();
    this.axisCam.position.copy(this.dir.multiplyScalar(5)); this.axisCam.lookAt(0, 0, 0); this.axisCam.updateMatrixWorld();
    r.autoClear = false;
    r.setViewport(8, this.height - size - 8, size, size);
    r.setScissor(8, this.height - size - 8, size, size);
    r.setScissorTest(true);
    r.clearDepth();
    r.render(this.axisScene, this.axisCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.autoClear = true;
  }

  /** Screenshot of the current frame as a PNG blob (used by tests and "export screenshot"). */
  async screenshot() {
    this.render();
    return new Promise((res) => this.canvas.toBlob(res, 'image/png'));
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.ro.disconnect();
    this.sceneView.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

const WIRE = new THREE.MeshBasicMaterial({ color: 0x9db4c9, wireframe: true });
const NORMALS = new THREE.MeshNormalMaterial();
export function isTyping(e) { const t = e.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

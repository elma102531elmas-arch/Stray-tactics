// Map Editor: build maps from boxes, ramps, stairs, pillars, arches,
// procedural buildings and props. Saves to the browser, exports JSON you can
// send, and play-tests instantly.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { el } from '../core/util.js';
import { store } from '../core/settings.js';
import { materials, BUILTIN_RECIPES } from '../gfx/materials.js';
import { OBJECT_TYPES } from '../world/mapbuilder.js';
import { PREFABS, PREFAB_BOUNDS } from '../world/prefabs.js';
import { makeKasbah } from '../world/maps/kasbah.js';
import { DEFAULT_ATMOS } from '../gfx/sky.js';
import { toast, num, vec3, prop, select, color, range, text, palette, jsonDialog } from './ui.js';

const DEG = Math.PI / 180;
const BOXY = ['box', 'ramp', 'stairs', 'cyl', 'arch', 'building'];

function blankMap() {
  return {
    format: 'strikepoint-map', version: 1, name: 'My Map', author: '', seed: 1, bounds: [-30, -30, 30, 30], ground: 'sand', atmos: {},
    objects: [
      { type: 'box', pos: [0, 0, 0], size: [60, 0.04, 60], rot: 0, mat: 'pavers' },
      { type: 'building', pos: [-12, 0, -12], size: [10, 7, 8], rot: 0, mat: 'plaster', trim: 'sandstone', seed: 1, windows: 0.6, beams: true, door: true, doorSide: 0 },
      { type: 'prop', prop: 'crate', pos: [3, 0, 2], rot: 15, scale: 1 },
      { type: 'spawn', team: 0, pos: [0, 0, 22], rot: 0 }, { type: 'spawn', team: 0, pos: [3, 0, 22], rot: 0 },
      { type: 'spawn', team: 1, pos: [0, 0, -22], rot: 180 }, { type: 'spawn', team: 1, pos: [3, 0, -22], rot: 180 },
    ],
  };
}

export class MapEditor {
  constructor(app) {
    this.app = app; this.world = app.world; this.camera = app.camera;
    const st = app.editorState;
    this.map = st && st.map ? JSON.parse(JSON.stringify(st.map)) : JSON.parse(JSON.stringify(this.world.map || makeKasbah()));
    this.key = st ? st.key : null;
    this.sel = -1; this.history = []; this.future = []; this.mode = 'translate'; this.snap = 0.25;
    this.dirty = false;
  }

  async init() {
    this.buildUI();
    // camera + controls
    const cam = this.camera; cam.fov = 60; cam.updateProjectionMatrix();
    cam.position.set(0, 45, 55); cam.lookAt(0, 0, 0);
    this.orbit = new OrbitControls(cam, this.app.renderer.canvas);
    this.orbit.target.set(0, 0, 0); this.orbit.enableDamping = true; this.orbit.dampingFactor = 0.12; this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.screenSpacePanning = false;
    this.gizmo = new TransformControls(cam, this.app.renderer.canvas);
    this.gizmo.addEventListener('dragging-changed', (e) => { this.orbit.enabled = !e.value; if (e.value) this.pushHistory(); else this.commitGizmo(true); });
    this.gizmo.addEventListener('objectChange', () => this.commitGizmo(false));
    this.helpers = new THREE.Group(); this.helpers.name = 'editor-helpers';
    this.world.scene.add(this.helpers);
    this.gizmoHelper = this.gizmo.getHelper(); this.world.scene.add(this.gizmoHelper);
    this.grid = new THREE.GridHelper(200, 200, 0x555555, 0x333333); this.grid.material.transparent = true; this.grid.material.opacity = 0.35; this.grid.position.y = 0.01;
    this.helpers.add(this.grid);
    this.boundsLine = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffb43c }));
    this.helpers.add(this.boundsLine);
    this.selBox = new THREE.BoxHelper(undefined, 0xffd060); this.selBox.visible = false; this.helpers.add(this.selBox);
    this.proxies = new THREE.Group(); this.helpers.add(this.proxies);
    this.applyGizmoMode();
    // events
    this._down = null;
    this._onDown = (e) => { this._down = { x: e.clientX, y: e.clientY }; };
    this._onUp = (e) => { if (!this._down) return; const d = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y); this._down = null; if (d < 5 && !this.gizmo.dragging) this.pick(e); };
    this._onKey = (e) => this.onKey(e);
    const cv = this.app.renderer.canvas;
    cv.addEventListener('pointerdown', this._onDown); cv.addEventListener('pointerup', this._onUp);
    addEventListener('keydown', this._onKey);
    this.keys = new Set();
    this._kd = (e) => this.keys.add(e.code); this._ku = (e) => this.keys.delete(e.code);
    addEventListener('keydown', this._kd); addEventListener('keyup', this._ku);
    await this.rebuild(true);
    this.inspect();
  }

  // ------------------------------------------------------------------ UI
  buildUI() {
    const t = (label, fn, cls = '') => el('button', { class: 'tb ' + cls, onclick: fn }, label);
    this.modeBtns = {};
    const modeBtn = (m, label) => (this.modeBtns[m] = t(label, () => { this.mode = m; this.applyGizmoMode(); }));
    this.nameIn = el('input', { class: 'sel', style: { width: '150px' }, value: this.map.name || 'My Map' });
    this.nameIn.addEventListener('change', () => { this.map.name = this.nameIn.value; this.dirty = true; });
    this.nameIn.addEventListener('keydown', (e) => e.stopPropagation());
    const snapSel = select([['0', 'Snap off'], ['0.1', 'Snap 0.1'], ['0.25', 'Snap 0.25'], ['0.5', 'Snap 0.5'], ['1', 'Snap 1']], String(this.snap), (v) => { this.snap = +v; this.applyGizmoMode(); });
    snapSel.style.width = 'auto';
    const top = el('div', { class: 'ed-top' },
      t('◀ LOBBY', () => this.exit()), el('h1', {}, 'MAP EDITOR'), this.nameIn,
      t('NEW', () => this.newMap()), t('OPEN', () => this.openDialog()), t('SAVE', () => this.save()), t('JSON ⇅', () => this.jsonIO()),
      t('↶', () => this.undo()), t('↷', () => this.redo()),
      modeBtn('translate', 'MOVE'), modeBtn('rotate', 'ROTATE'), modeBtn('scale', 'SIZE'), snapSel,
      t('BAKE LIGHT', () => this.rebuild(false)), el('div', { class: 'sp' }), t('▶ PLAY TEST', () => this.playTest(), 'go'));
    const addSide = el('div', { class: 'ed-side left' });
    addSide.append(el('h3', {}, 'ADD SHAPE'));
    const shapes = el('div', { class: 'palette' });
    for (const k of ['box', 'ramp', 'stairs', 'cyl', 'arch', 'building']) shapes.appendChild(el('button', { onclick: () => this.add({ type: k }) }, el('span', { style: { fontSize: '20px' } }, { box: '▭', ramp: '◺', stairs: '⌸', cyl: '◯', arch: '⌒', building: '🏠' }[k]), OBJECT_TYPES[k].label));
    addSide.append(shapes, el('h3', {}, 'ADD PROP'));
    const props = el('div', { class: 'palette' });
    for (const k in PREFABS) props.appendChild(el('button', { onclick: () => this.add({ type: 'prop', prop: k }) }, PREFABS[k].label));
    addSide.append(props, el('h3', {}, 'SPAWNS'),
      el('div', { class: 'palette' }, el('button', { onclick: () => this.add({ type: 'spawn', team: 0 }) }, el('span', { style: { color: '#e0a64a', fontSize: '18px' } }, '●'), 'Team A'), el('button', { onclick: () => this.add({ type: 'spawn', team: 1 }) }, el('span', { style: { color: '#4aa3e0', fontSize: '18px' } }, '●'), 'Team B')));
    this.side = el('div', { class: 'ed-side' });
    this.view = el('div', { class: 'ed-view' }, this.status = el('div', { class: 'ed-status' }, ''),
      el('div', { class: 'ed-help' }, 'Click: select · Drag: orbit · Right-drag: pan · Wheel: zoom · WASD/QE: move camera', el('br'), '1/2/3: move/rotate/size · Del: delete · Ctrl+D: duplicate · Ctrl+Z/Y: undo/redo · F: focus'));
    this.ui = el('div', { class: 'ed' }, top, el('div', { class: 'ed-main' }, addSide, this.view, this.side));
    document.getElementById('ui').appendChild(this.ui);
    this.fitView = () => { const r = this.view.getBoundingClientRect(); this.app.renderer.setArea({ x: r.left, y: r.top, w: r.width, h: r.height }); };
    this.fitView(); addEventListener('resize', this.fitView);
  }

  setStatus(s) { this.status.textContent = s; }

  inspect() {
    const S = this.side; S.innerHTML = '';
    const o = this.map.objects[this.sel];
    if (!o) return this.inspectMap();
    const change = (fn, rebuildProxy = true) => (v) => { this.pushHistory(); fn(v); this.dirty = true; if (rebuildProxy) this.syncProxies(); this.scheduleRebuild(); };
    S.append(el('h3', {}, (OBJECT_TYPES[o.type] || {}).label?.toUpperCase() || o.type.toUpperCase()));
    S.append(prop('Position', vec3(o.pos, change((v) => { o.pos = v; }), 0.25)));
    S.append(prop('Rotation', num(o.rot || 0, change((v) => { o.rot = v; }), 15)));
    if (BOXY.includes(o.type)) S.append(prop('Size W/H/D', vec3(o.size, change((v) => { o.size = v.map((x) => Math.max(0.05, x)); }), 0.25)));
    if (o.type === 'stairs') S.append(prop('Steps', num(o.steps || 8, change((v) => { o.steps = Math.max(2, Math.round(v)); }), 1)));
    if (o.type === 'arch') S.append(prop('Opening W/H', vec3([...(o.open || [3, 3.6]), 0].slice(0, 3), change((v) => { o.open = [v[0], v[1]]; }), 0.1)));
    if (o.type === 'building') {
      S.append(prop('Trim mat', select(materials.ids(), o.trim || 'sandstone', change((v) => { o.trim = v; }, false))));
      S.append(prop('Windows', range(0, 1, 0.05, o.windows ?? 0.6, change((v) => { o.windows = v; }, false))));
      S.append(prop('Roof beams', select([['true', 'Yes'], ['false', 'No']], String(o.beams !== false), change((v) => { o.beams = v === 'true'; }, false))));
      S.append(prop('Parapet', select([['true', 'Yes'], ['false', 'No']], String(o.parapet !== false), change((v) => { o.parapet = v === 'true'; }, false))));
      S.append(prop('Door', select([['-1', 'None'], ['0', '+Z side'], ['1', '-Z side'], ['2', '+X side'], ['3', '-X side']], String(o.door === false ? -1 : o.doorSide ?? 0), change((v) => { if (+v < 0) o.door = false; else { o.door = true; o.doorSide = +v; } }, false))));
      S.append(prop('Variation', num(o.seed || 1, change((v) => { o.seed = Math.round(v); }, false), 1)));
    }
    if (o.type === 'prop') {
      S.append(prop('Prop', select(Object.keys(PREFABS).map((k) => [k, PREFABS[k].label]), o.prop, change((v) => { o.prop = v; }))));
      S.append(prop('Scale', num(o.scale || 1, change((v) => { o.scale = Math.max(0.1, v); }), 0.1)));
      if (['barrel', 'car', 'awning'].includes(o.prop)) S.append(prop('Variant', select([['', 'Default'], ['rust', 'Rust'], ['metal', 'Metal'], ['blue', 'Blue'], ['red', 'Red']], o.variant || '', change((v) => { o.variant = v || undefined; }, false))));
    }
    if (o.type === 'spawn') S.append(prop('Team', select([['0', 'Team A (Raiders)'], ['1', 'Team B (Guardians)']], String(o.team || 0), change((v) => { o.team = +v; }))));
    if (BOXY.includes(o.type)) {
      S.append(el('h3', {}, 'MATERIAL'));
      S.append(palette(materials.ids(), o.mat, change((v) => { o.mat = v; }, false)));
      S.append(el('p', { class: 'hint' }, 'Make your own textures in the Texture Studio — they show up here.'));
    }
    S.append(el('div', { class: 'btn-row' }, el('button', { class: 'tb', onclick: () => this.duplicate() }, 'DUPLICATE'), el('button', { class: 'tb', onclick: () => this.remove() }, 'DELETE'), el('button', { class: 'tb', onclick: () => this.select(-1) }, 'DESELECT')));
  }

  inspectMap() {
    const S = this.side, m = this.map;
    const a = { ...DEFAULT_ATMOS, ...(m.atmos || {}) };
    const change = (fn, atm) => (v) => { this.pushHistory(); fn(v); this.dirty = true; if (atm) this.world.applyAtmos(m.atmos); this.updateBounds(); this.scheduleRebuild(); };
    const sd = new THREE.Vector3(...a.sunDir).normalize();
    let az = Math.atan2(sd.x, sd.z) / DEG, elv = Math.asin(sd.y) / DEG;
    const setSun = () => { const e = elv * DEG, z = az * DEG; m.atmos = { ...(m.atmos || {}), sunDir: [+(Math.cos(e) * Math.sin(z)).toFixed(3), +Math.sin(e).toFixed(3), +(Math.cos(e) * Math.cos(z)).toFixed(3)] }; };
    S.append(el('h3', {}, 'MAP SETTINGS'),
      el('p', { class: 'hint' }, 'Nothing selected. Click an object to edit it, or use the panel on the left to add one.'),
      prop('Author', text(m.author || '', (v) => { m.author = v; })),
      prop('Bounds', el('div', {}, vec3([m.bounds[0], m.bounds[1], 0], change((v) => { m.bounds[0] = v[0]; m.bounds[1] = v[1]; }), 1), vec3([m.bounds[2], m.bounds[3], 0], change((v) => { m.bounds[2] = v[0]; m.bounds[3] = v[1]; }), 1))),
      el('p', { class: 'hint' }, 'Bounds: min X/Z then max X/Z (the playable area, orange box).'),
      el('h3', {}, 'GROUND'), palette(materials.ids(), m.ground || 'sand', change((v) => { m.ground = v; })),
      el('h3', {}, 'SUN & SKY'),
      prop('Sun angle', range(0, 360, 1, (az + 360) % 360, change((v) => { az = v; setSun(); }, true))),
      prop('Sun height', range(5, 85, 1, elv, change((v) => { elv = v; setSun(); }, true))),
      prop('Sun color', color(a.sunColor, change((v) => { m.atmos = { ...(m.atmos || {}), sunColor: v }; }, true))),
      prop('Sun power', range(0, 8, 0.1, a.sunIntensity, change((v) => { m.atmos = { ...(m.atmos || {}), sunIntensity: v }; }, true))),
      prop('Sky top', color(a.skyTop, change((v) => { m.atmos = { ...(m.atmos || {}), skyTop: v }; }, true))),
      prop('Horizon', color(a.skyHorizon, change((v) => { m.atmos = { ...(m.atmos || {}), skyHorizon: v }; }, true))),
      prop('Fog color', color(a.fogColor, change((v) => { m.atmos = { ...(m.atmos || {}), fogColor: v }; }, true))),
      prop('Fog', range(0, 0.03, 0.0005, a.fogDensity, change((v) => { m.atmos = { ...(m.atmos || {}), fogDensity: v }; }, true))),
      prop('Clouds', range(0, 1, 0.05, a.clouds, change((v) => { m.atmos = { ...(m.atmos || {}), clouds: v }; }, true))),
      prop('Ambient', range(0, 2, 0.05, a.envIntensity, change((v) => { m.atmos = { ...(m.atmos || {}), envIntensity: v }; }, true))));
  }

  // ------------------------------------------------------------------ proxies
  objBounds(o) {
    if (o.type === 'prop') { const b = PREFAB_BOUNDS[o.prop] || [1, 1, 1]; const s = o.scale || 1; return [b[0] * s, b[1] * s, b[2] * s]; }
    if (o.type === 'spawn') return [0.6, 1.8, 0.6];
    return o.size || [1, 1, 1];
  }
  syncProxies() {
    const P = this.proxies;
    while (P.children.length > this.map.objects.length) { const c = P.children.pop(); c.geometry.dispose(); }
    const geo = this._boxGeo || (this._boxGeo = new THREE.BoxGeometry(1, 1, 1));
    const inv = this._inv || (this._inv = new THREE.MeshBasicMaterial({ visible: false }));
    this.map.objects.forEach((o, i) => {
      let m = P.children[i];
      if (!m) { m = new THREE.Mesh(geo, inv); P.add(m); }
      const b = this.objBounds(o);
      if (o.type === 'spawn') {
        if (!m.userData.spawn) { m.material = new THREE.MeshBasicMaterial({ color: o.team ? 0x4aa3e0 : 0xe0a64a, transparent: true, opacity: 0.7 }); m.userData.spawn = true; const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 8), m.material); arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, 0.35, -0.7); arrow.scale.set(1 / 0.6, 1 / 1.8, 1 / 0.6); m.add(arrow); }
        m.material.color.set(o.team ? 0x4aa3e0 : 0xe0a64a);
      } else if (m.userData.spawn) { m.clear(); m.material = inv; m.userData.spawn = false; }
      m.position.set(o.pos[0], o.pos[1] + b[1] / 2, o.pos[2]);
      m.rotation.set(0, (o.rot || 0) * DEG, 0);
      m.scale.set(b[0], b[1], b[2]);
      m.userData.index = i;
    });
    this.updateSelBox();
    this.updateBounds();
  }
  updateBounds() {
    const b = this.map.bounds;
    this.boundsLine.position.set((b[0] + b[2]) / 2, 4, (b[1] + b[3]) / 2);
    this.boundsLine.scale.set(b[2] - b[0], 8, b[3] - b[1]);
  }
  updateSelBox() {
    const p = this.proxies.children[this.sel];
    if (p) { this.selBox.setFromObject(p); this.selBox.visible = true; } else this.selBox.visible = false;
  }

  select(i) {
    this.sel = i;
    const p = this.proxies.children[i];
    if (p) this.gizmo.attach(p); else this.gizmo.detach();
    this.updateSelBox(); this.inspect();
    const o = this.map.objects[i];
    this.setStatus(o ? `Selected #${i}: ${o.type}${o.prop ? ' · ' + o.prop : ''}` : `${this.map.objects.length} objects`);
  }
  pick(e) {
    const r = this.app.renderer.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.camera);
    // invisible proxies: test against their boxes
    let best = -1, bd = Infinity;
    const box = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)), ray = new THREE.Ray(), inv = new THREE.Matrix4(), hit = new THREE.Vector3();
    this.proxies.children.forEach((p, i) => {
      const o = this.map.objects[i];
      inv.copy(p.matrixWorld).invert(); ray.copy(rc.ray).applyMatrix4(inv);
      if (ray.intersectBox(box, hit)) {
        hit.applyMatrix4(p.matrixWorld); let d = hit.distanceTo(rc.ray.origin);
        // prefer small objects when nested inside big ones (floors, buildings)
        const vol = p.scale.x * p.scale.y * p.scale.z; d += Math.min(30, Math.cbrt(vol)) * 0.15;
        if (o.type === 'box' && p.scale.y < 0.2) d += 20;
        if (d < bd) { bd = d; best = i; }
      }
    });
    this.select(best);
  }

  applyGizmoMode() {
    const g = this.gizmo; if (!g) return;
    g.setMode(this.mode);
    g.showX = this.mode !== 'rotate'; g.showZ = this.mode !== 'rotate'; g.showY = true;
    g.setTranslationSnap(this.snap || null); g.setRotationSnap(this.snap ? 15 * DEG : null); g.setScaleSnap(this.snap ? 0.05 : null);
    g.space = this.mode === 'scale' ? 'local' : 'world';
    for (const k in this.modeBtns) this.modeBtns[k].classList.toggle('on', k === this.mode);
  }
  commitGizmo(final) {
    const o = this.map.objects[this.sel], p = this.proxies.children[this.sel];
    if (!o || !p) return;
    const b = this.objBounds(o);
    if (this.mode === 'scale') {
      if (BOXY.includes(o.type)) o.size = [p.scale.x, p.scale.y, p.scale.z].map((v) => +Math.max(0.05, this.snap ? Math.round(v / this.snap) * this.snap || this.snap : v).toFixed(3));
      else if (o.type === 'prop') { const base = PREFAB_BOUNDS[o.prop] || [1, 1, 1]; o.scale = +Math.max(0.1, p.scale.y / base[1]).toFixed(2); }
    }
    const nb = this.objBounds(o);
    o.pos = [+p.position.x.toFixed(3), +(p.position.y - (this.mode === 'scale' ? nb[1] : b[1]) / 2).toFixed(3), +p.position.z.toFixed(3)];
    if (this.mode === 'scale') o.pos[1] = +(p.position.y - p.scale.y / 2).toFixed(3);
    o.rot = +((p.rotation.y / DEG) % 360).toFixed(1);
    this.dirty = true;
    this.updateSelBox();
    if (final) { this.syncProxies(); this.inspect(); }
    this.scheduleRebuild();
  }

  // ------------------------------------------------------------------ edit ops
  pushHistory() { this.history.push(JSON.stringify(this.map)); if (this.history.length > 80) this.history.shift(); this.future.length = 0; }
  undo() { if (!this.history.length) return; this.future.push(JSON.stringify(this.map)); this.map = JSON.parse(this.history.pop()); this.afterLoad(); toast('Undo'); }
  redo() { if (!this.future.length) return; this.history.push(JSON.stringify(this.map)); this.map = JSON.parse(this.future.pop()); this.afterLoad(); toast('Redo'); }
  afterLoad() { this.nameIn.value = this.map.name || ''; this.world.applyAtmos(this.map.atmos || {}); this.sel = Math.min(this.sel, this.map.objects.length - 1); this.syncProxies(); this.select(this.sel); this.scheduleRebuild(); }

  spawnPoint() {
    // place new objects where the camera looks (on the ground or on top of things)
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const hit = this.world.collision && this.world.collision.raycast(this.camera.position, dir, 300, {});
    const p = hit ? hit.point : this.orbit.target.clone();
    const s = this.snap || 0.25;
    return [Math.round(p.x / s) * s, Math.max(0, Math.round(p.y / s) * s), Math.round(p.z / s) * s];
  }
  add(def) {
    this.pushHistory();
    const o = { ...JSON.parse(JSON.stringify(OBJECT_TYPES[def.type].defaults)), ...def, pos: this.spawnPoint(), rot: 0 };
    if (o.type === 'spawn') o.rot = o.team ? 180 : 0;
    this.map.objects.push(o);
    this.syncProxies(); this.select(this.map.objects.length - 1);
    this.scheduleRebuild(); this.dirty = true;
  }
  duplicate() {
    const o = this.map.objects[this.sel]; if (!o) return;
    this.pushHistory();
    const c = JSON.parse(JSON.stringify(o)); c.pos = [c.pos[0] + 1, c.pos[1], c.pos[2] + 1];
    this.map.objects.push(c); this.syncProxies(); this.select(this.map.objects.length - 1); this.scheduleRebuild();
  }
  remove() {
    if (this.sel < 0) return;
    this.pushHistory();
    this.map.objects.splice(this.sel, 1); this.gizmo.detach(); this.sel = -1;
    this.syncProxies(); this.select(-1); this.scheduleRebuild();
  }
  focus() {
    const p = this.proxies.children[this.sel]; if (!p) return;
    const d = this.camera.position.clone().sub(this.orbit.target);
    this.orbit.target.copy(p.position);
    this.camera.position.copy(p.position).add(d.setLength(Math.max(6, p.scale.length() * 1.6)));
  }

  onKey(e) {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.code === 'Delete' || e.code === 'Backspace') { this.remove(); e.preventDefault(); }
    else if (ctrl && e.code === 'KeyD') { this.duplicate(); e.preventDefault(); }
    else if (ctrl && e.code === 'KeyZ') { e.shiftKey ? this.redo() : this.undo(); e.preventDefault(); }
    else if (ctrl && e.code === 'KeyY') { this.redo(); e.preventDefault(); }
    else if (ctrl && e.code === 'KeyS') { this.save(); e.preventDefault(); }
    else if (e.code === 'Digit1') { this.mode = 'translate'; this.applyGizmoMode(); }
    else if (e.code === 'Digit2') { this.mode = 'rotate'; this.applyGizmoMode(); }
    else if (e.code === 'Digit3') { this.mode = 'scale'; this.applyGizmoMode(); }
    else if (e.code === 'KeyF') this.focus();
    else if (e.code === 'Escape') this.select(-1);
  }

  scheduleRebuild() { clearTimeout(this._rt); this._rt = setTimeout(() => this.rebuild(true), 160); }
  async rebuild(fast) {
    if (this._building) { this._again = fast; return; }
    this._building = true;
    if (!fast) this.setStatus('Baking lighting…');
    try { await this.world.load(this.map, { fast }); } catch (err) { toast('Build error: ' + err.message, 3000); console.error(err); }
    this._building = false;
    this.world.nav = null;
    this.syncProxies();
    this.setStatus(fast ? `${this.map.objects.length} objects · preview lighting (press BAKE LIGHT for final)` : `Lighting baked · ${this.world.built.stats.tris.toLocaleString()} triangles`);
    if (this._again !== undefined) { const f = this._again; this._again = undefined; this.rebuild(f); }
  }

  // ------------------------------------------------------------------ files
  save() {
    const name = (this.map.name || 'My Map').trim() || 'My Map';
    this.map.name = name;
    const maps = store.get('maps', {});
    maps[name] = this.map;
    if (!store.set('maps', maps)) { toast('Browser storage is full — export the JSON instead!', 3500); return; }
    this.key = name; this.dirty = false;
    this.app.selectedMap = name;
    toast('Saved "' + name + '" — it is now selectable in the lobby');
  }
  newMap() { if (this.dirty && !confirm('Discard unsaved changes?')) return; this.pushHistory(); this.map = blankMap(); this.key = null; this.afterLoad(); }
  openDialog() {
    const maps = store.get('maps', {});
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    const box = el('div', { class: 'modal show' }, el('div', { class: 'panel' }, el('div', { class: 'panel-head' }, el('h2', {}, 'OPEN MAP'), el('button', { class: 'x', onclick: () => box.remove() }, '✕')), list));
    const open = (m, key) => { this.pushHistory(); this.map = JSON.parse(JSON.stringify(m)); this.key = key; this.afterLoad(); box.remove(); };
    list.append(el('button', { class: 'btn sm', onclick: () => open(makeKasbah(), null) }, 'Kasbah (built-in, edit a copy)'), el('button', { class: 'btn sm', onclick: () => open(blankMap(), null) }, 'Empty template'));
    for (const k in maps) list.append(el('div', { class: 'btn-row' }, el('button', { class: 'btn sm', onclick: () => open(maps[k], k) }, k), el('button', { class: 'tb', onclick: () => { if (confirm('Delete map "' + k + '"?')) { delete maps[k]; store.set('maps', maps); box.remove(); this.openDialog(); } } }, '🗑')));
    document.getElementById('ui').appendChild(box);
  }
  jsonIO() {
    jsonDialog('MAP JSON', this.map, (this.map.name || 'map').replace(/\W+/g, '_') + '.json', (obj) => {
      if (!obj.objects || !obj.bounds) { toast('That is not a map JSON', 2500); return; }
      this.pushHistory(); this.map = obj; this.afterLoad(); toast('Map imported');
    });
  }
  playTest() {
    this.app.editorState = { map: JSON.parse(JSON.stringify(this.map)), key: this.key };
    this.app.startGame({ mode: this.map.objects.some((o) => o.type === 'spawn' && o.team === 1) && this.map.objects.some((o) => o.type === 'spawn' && o.team === 0) ? 'practice' : 'practice', mapData: this.map, map: '__editor', onQuit: () => this.app.openTool('map') });
  }
  exit() {
    if (this.dirty && !confirm('Leave without saving? (Your edits stay open until you close the page.)')) return;
    this.app.editorState = { map: this.map, key: this.key };
    this.app.toLobby();
  }

  // ------------------------------------------------------------------ loop
  update(dt) {
    // WASD / QE camera movement
    const k = this.keys, sp = (k.has('ShiftLeft') ? 40 : 15) * dt;
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const mv = new THREE.Vector3();
    if (k.has('KeyW')) mv.add(fwd); if (k.has('KeyS')) mv.sub(fwd); if (k.has('KeyD')) mv.add(right); if (k.has('KeyA')) mv.sub(right);
    if (k.has('KeyE')) mv.y += 1; if (k.has('KeyQ')) mv.y -= 1;
    if (mv.lengthSq() > 0 && !(document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName))) { mv.normalize().multiplyScalar(sp); this.camera.position.add(mv); this.orbit.target.add(mv); }
    this.orbit.update();
    this.world.update(dt);
  }
  render() { this.app.renderer.render({ scene: this.world.scene, camera: this.camera }); }
  destroy() {
    clearTimeout(this._rt);
    const cv = this.app.renderer.canvas;
    cv.removeEventListener('pointerdown', this._onDown); cv.removeEventListener('pointerup', this._onUp);
    removeEventListener('keydown', this._onKey); removeEventListener('keydown', this._kd); removeEventListener('keyup', this._ku);
    this.gizmo.detach(); this.gizmo.dispose(); this.orbit.dispose();
    this.world.scene.remove(this.helpers, this.gizmoHelper);
    this.ui.remove();
    removeEventListener('resize', this.fitView); this.app.renderer.setArea(null);
    this.app.camera.fov = 78; this.app.camera.updateProjectionMatrix();
    void BUILTIN_RECIPES;
  }
}

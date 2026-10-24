// Standalone model viewer with orbit camera, bounds/collider/pivot overlays and animation playback.
// Used by the Asset editor (and weapon / enemy tools) so assets can be inspected without placing them in a map.
import * as THREE from '../../lib/three.module.js';

export class ModelViewer {
  constructor(app, container) {
    this.app = app; this.container = container;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'vp-canvas';
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#191c22');
    this.cam = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
    this.scene.add(new THREE.HemisphereLight(0xdde6f5, 0x303038, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 5, 4); this.scene.add(key);
    this.grid = new THREE.GridHelper(10, 20, 0x667080, 0x2c333d); this.scene.add(this.grid);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.overlays = new THREE.Group(); this.scene.add(this.overlays);
    this.yaw = 0.8; this.pitch = 0.4; this.dist = 3; this.target = new THREE.Vector3(0, 0.5, 0);
    this.object = null; this.mixer = null; this.clips = []; this.action = null;
    this.playing = false; this.speed = 1; this.loop = true;
    this.show = { bounds: true, collider: true, pivot: true, wire: false, grid: true };
    this.needs = true;
    this.listeners = new Set();
    this.firedEvents = [];
    this._bind();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container);
    this._tick = this._tick.bind(this); this._last = performance.now(); this._raf = requestAnimationFrame(this._tick);
    this.resize();
  }
  onFrame(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async load(assetId, { overrides = {}, meta = null } = {}) {
    const token = (this._tok = (this._tok || 0) + 1);
    this.clear();
    if (!assetId) return null;
    const m = meta || this.app.assets.meta(assetId);
    const { object, animations, bounds } = await this.app.assets.instantiate(assetId);
    if (token !== this._tok) return null;
    object.scale.multiplyScalar(m?.scale || 1);
    const holder = new THREE.Group();
    const p = m?.pivot || [0, 0, 0];
    holder.position.set(p[0], p[1], p[2]); holder.add(object);
    this.root.add(holder);
    this.object = holder; this.meshObject = object;
    this.applyOverrides(overrides);
    this.clips = animations; this.events = m?.animations || [];
    if (animations.length) this.mixer = new THREE.AnimationMixer(object);
    this.bounds = new THREE.Box3().setFromObject(holder);
    this.frame();
    this.needs = true;
    return { animations, bounds: this.bounds.clone() };
  }
  clear() {
    this.root.clear(); this.object = null; this.mixer = null; this.action = null; this.clips = []; this.playing = false;
    this.overlays.clear();
  }
  materialNames() {
    const set = new Map();
    this.meshObject?.traverse((o) => { if (o.isMesh) for (const mt of [].concat(o.material)) set.set(mt.name || '(unnamed)', (set.get(mt.name || '(unnamed)') || 0) + 1); });
    return [...set].map(([name, meshes]) => ({ name, meshes }));
  }
  applyOverrides(overrides) {
    if (!this.meshObject) return;
    this.meshObject.traverse((o) => {
      if (!o.isMesh) return;
      o.userData._orig = o.userData._orig || o.material;
      const list = [].concat(o.userData._orig);
      const mapped = list.map((mt) => (overrides[mt.name] ? this.app.materials.get(overrides[mt.name]) : mt));
      o.material = Array.isArray(o.userData._orig) ? mapped : mapped[0];
    });
    this.needs = true;
  }
  setWire(on) { this.show.wire = on; this.meshObject?.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) m.wireframe = on; }); this.needs = true; }

  /** Rebuild overlay boxes. meta supplies collision mode/size; bounds are the scene-effective bounds. */
  setOverlays(meta) {
    this.overlays.clear();
    if (!this.object) return;
    const add = (min, max, color) => { const b = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)); const h = new THREE.Box3Helper(b, color); this.overlays.add(h); };
    const bb = new THREE.Box3().setFromObject(this.object);
    if (this.show.bounds) add(bb.min.toArray(), bb.max.toArray(), 0x6fc3ff);
    if (this.show.collider && meta) {
      if (meta.collision === 'custom' && meta.colliderCenter && meta.colliderSize) { const c = meta.colliderCenter, s = meta.colliderSize; add([c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2], [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2], 0xff5a5a); }
      else if (meta.collision !== 'none') add(bb.min.toArray(), bb.max.toArray(), 0xff5a5a);
    }
    if (this.show.pivot) { const ax = new THREE.AxesHelper(Math.max(0.3, bb.getSize(new THREE.Vector3()).length() * 0.25)); ax.renderOrder = 5; ax.material.depthTest = false; this.overlays.add(ax); }
    this.grid.visible = this.show.grid;
    this.needs = true;
  }

  // ------------------------------------------------------------ animation
  clipNames() { return this.clips.map((c) => c.name); }
  play(name, { loop = this.loop, speed = this.speed, from = 0 } = {}) {
    if (!this.mixer) return false;
    const clip = this.clips.find((c) => c.name === name) || this.clips[0];
    if (!clip) return false;
    this.mixer.stopAllAction();
    this.action = this.mixer.clipAction(clip);
    this.action.reset(); this.action.time = from; this.action.timeScale = speed;
    this.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); this.action.clampWhenFinished = true;
    this.action.play();
    this.clip = clip; this.playing = true; this.firedEvents = []; this._lastT = from;
    return true;
  }
  pause() { if (this.action) this.action.paused = true; this.playing = false; }
  resume() { if (this.action) { this.action.paused = false; this.playing = true; } }
  seek(t) {
    if (!this.action) return;
    this.action.paused = true; this.playing = false;
    this.action.time = Math.max(0, Math.min(this.clip.duration, t));
    this.mixer.update(0);
    this.needs = true;
  }
  get time() { return this.action ? this.action.time : 0; }
  setSpeed(s) { this.speed = s; if (this.action) this.action.timeScale = s; }

  /** Show the model the way the player sees a held weapon. vm = {pos:[x,y,z], rot:[x,y,z] deg, scale}; only applied while first-person is on. */
  setFirstPerson(on, fov = 60) { this.fp = on; this.fpFov = fov; this._applyRoot(); }
  applyViewmodel(vm) { this.vm = vm; this._applyRoot(); }
  _applyRoot() {
    const vm = this.fp ? this.vm : null, D = Math.PI / 180;
    if (vm) { this.root.position.set(...vm.pos); this.root.rotation.set(vm.rot[0] * D, vm.rot[1] * D, vm.rot[2] * D); this.root.scale.setScalar(vm.scale || 1); }
    else { this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.scale.setScalar(1); }
    this.grid.visible = !this.fp && this.show.grid;
    this.needs = true;
  }

  // ------------------------------------------------------------ camera
  frame() {
    if (!this.bounds || this.bounds.isEmpty()) return;
    const c = this.bounds.getCenter(new THREE.Vector3()), s = this.bounds.getSize(new THREE.Vector3());
    this.target.copy(c);
    this.dist = Math.max(0.4, s.length() * 1.15);
    this.grid.position.y = this.bounds.min.y;
    this.needs = true;
  }
  resize() {
    const w = Math.max(40, this.container.clientWidth), h = Math.max(40, this.container.clientHeight);
    this.renderer.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); this.needs = true;
  }
  _bind() {
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) { const k = this.dist * 0.0016; const r = new THREE.Vector3().setFromMatrixColumn(this.cam.matrixWorld, 0), u = new THREE.Vector3().setFromMatrixColumn(this.cam.matrixWorld, 1); this.target.addScaledVector(r, -dx * k).addScaledVector(u, dy * k); }
      else { this.yaw -= dx * 0.01; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.01)); }
      this.needs = true;
    });
    this.canvas.addEventListener('pointerup', () => { drag = null; });
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.dist = Math.max(0.1, Math.min(200, this.dist * Math.exp(e.deltaY * 0.001))); this.needs = true; }, { passive: false });
  }
  _tick(now) {
    this._raf = requestAnimationFrame(this._tick);
    const dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
    if (!this.container.isConnected || !this.container.offsetParent) return;
    if (this.mixer && this.playing) {
      const before = this.action.time;
      this.mixer.update(dt);
      const t = this.action.time;
      for (const ev of (this.events?.find((c) => c.name === this.clip?.name)?.events) || []) {
        const crossed = t >= before ? ev.time > before && ev.time <= t : ev.time > before || ev.time <= t;   // handles looping wrap-around
        if (crossed) { this.firedEvents.push({ name: ev.name, time: ev.time }); this.onEvent?.(ev); }
      }
      this.needs = true;
    }
    this.listeners.forEach((fn) => fn(this));
    if (!this.needs) return;
    this.needs = false;
    if (this.fp) {            // first-person framing: camera at the origin looking down -Z, like the player's eye
      this.cam.position.set(0, 0, 0); this.cam.rotation.set(0, 0, 0); this.cam.fov = this.fpFov || 60; this.cam.near = 0.01;
    } else {
      this.cam.position.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist).add(this.target);
      this.cam.lookAt(this.target);
      this.cam.fov = 40;
      this.cam.near = Math.max(0.005, this.dist / 500);
    }
    this.cam.updateProjectionMatrix();
    this.renderer.render(this.scene, this.cam);
  }
  dispose() { cancelAnimationFrame(this._raf); this.ro.disconnect(); this.renderer.dispose(); this.canvas.remove(); }
}

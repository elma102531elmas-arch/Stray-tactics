// Small standalone 3D preview (sphere / cube / floor plane) used by the Material and Asset editors.
// It has its own renderer so it works while the main viewport is hidden; materials are the SAME objects the scene uses,
// so edits appear in the preview and the scene at the same moment.
import * as THREE from '../../lib/three.module.js';
import { boxProjectUVs } from '../viewport/geocache.js';

export class MaterialPreview {
  constructor(app, container, { shape = 'sphere' } = {}) {
    this.app = app; this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vp-canvas';
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#171a20');
    this.cam = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
    this.yaw = 0.7; this.pitch = 0.35; this.dist = 3.2;
    this.scene.add(new THREE.HemisphereLight(0xdde6f5, 0x303038, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 4, 2); this.scene.add(key);
    const rim = new THREE.PointLight(0xffd8a8, 18, 12, 2); rim.position.set(-2.5, 1.5, -2); this.scene.add(rim);
    this.shape = shape;
    this.mesh = null;
    this.materialId = null;
    this.needs = true;
    this._bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this._off = app.materials.onChange(() => { this.needs = true; });
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
    this.setShape(shape);
    this.resize();
  }

  setShape(shape) {
    this.shape = shape;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    let g;
    if (shape === 'cube') g = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    else if (shape === 'plane') { g = new THREE.BoxGeometry(2.4, 0.04, 2.4); }
    else g = new THREE.SphereGeometry(0.75, 64, 48);
    boxProjectUVs(g);        // metre-based UVs, same as walls and floors in the scene
    this.mesh = new THREE.Mesh(g, this.mesh?.material || this.app.materials.fallback);
    this.scene.add(this.mesh);
    this.dist = shape === 'plane' ? 3.4 : 3.2;
    this.needs = true;
  }
  setMaterial(id) { this.materialId = id; this.mesh.material = this.app.materials.get(id); this.needs = true; }
  refresh() { if (this.materialId) this.mesh.material = this.app.materials.get(this.materialId); this.needs = true; }

  resize() {
    const w = Math.max(40, this.container.clientWidth), h = Math.max(40, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    this.needs = true;
  }
  _bind() {
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => { if (!drag) return; this.yaw -= (e.clientX - drag.x) * 0.01; this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + (e.clientY - drag.y) * 0.01)); drag = { x: e.clientX, y: e.clientY }; this.needs = true; });
    this.canvas.addEventListener('pointerup', () => { drag = null; });
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.dist = Math.max(1.2, Math.min(9, this.dist * Math.exp(e.deltaY * 0.001))); this.needs = true; }, { passive: false });
  }
  _tick() {
    this._raf = requestAnimationFrame(this._tick);
    if (!this.needs || !this.container.isConnected || !this.container.offsetParent) return;
    this.needs = false;
    this.cam.position.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist);
    this.cam.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.cam);
  }
  dispose() { cancelAnimationFrame(this._raf); this.ro.disconnect(); this._off(); this.mesh.geometry.dispose(); this.renderer.dispose(); this.canvas.remove(); }
}

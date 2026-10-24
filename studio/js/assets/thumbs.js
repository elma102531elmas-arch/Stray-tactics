// Thumbnails for the asset browser. One small shared WebGL renderer draws each model once, on demand, to a data URL.
import * as THREE from '../../lib/three.module.js';

export class Thumbs {
  constructor(app) {
    this.app = app;
    this.cache = new Map();
    this.queue = Promise.resolve();
    this.renderer = null;
  }
  _init() {
    if (this.renderer) return;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setSize(128, 128, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(3, 5, 4); this.scene.add(d);
    this.cam = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  }

  /** Resolves to a data URL, or null if the asset cannot be rendered (error is logged once). */
  model(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const p = (this.queue = this.queue.then(async () => {
      try {
        this._init();
        const { object, bounds } = await this.app.assets.instantiate(id);
        const size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
        const r = Math.max(size.length() / 2, 0.05);
        this.scene.add(object);
        this.cam.position.copy(centre).add(new THREE.Vector3(1, 0.7, 1.2).normalize().multiplyScalar(r / Math.sin(0.305) * 1.05));
        this.cam.lookAt(centre);
        this.renderer.render(this.scene, this.cam);
        const url = this.renderer.domElement.toDataURL('image/png');
        this.scene.remove(object);
        return url;
      } catch (e) { this.app.log('warn', `Thumbnail for ${id} failed: ${e.message}`); return null; }
    }));
    this.cache.set(id, p);
    return p;
  }
  invalidate(id) { this.cache.delete(id); }
}

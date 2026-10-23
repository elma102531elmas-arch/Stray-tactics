// Light fixtures (models + emissive parts) and a small pool of real point lights that follow the
// most relevant fixtures, so the shader light count stays constant on phones.
import * as THREE from '../../lib/three.module.js';
import { noise2 } from '../util.js';
import { mergeGeometries } from '../../lib/BufferGeometryUtils.js';

const tubeGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.82, 8);
tubeGeo.rotateX(Math.PI / 2);
const bulbGeo = new THREE.SphereGeometry(0.05, 12, 8);
const tubesGeo = mergeGeometries([tubeGeo.clone().translate(-0.2, -0.045, 0), tubeGeo.clone().translate(0.2, -0.045, 0)]);
const boxGeo = new THREE.BoxGeometry(0.18, 0.1, 0.06);

export class Fixture {
  constructor(o) {
    Object.assign(this, { color: 0xfff1d6, intensity: 6, range: 9, state: 'on', group: 'main', phase: Math.random() * 100, flick: 1, power: true }, o);
    this.col = new THREE.Color(this.color);
    this.emissives = [];
    this.value = 0;
  }
  setOn(on) { this.power = on; }
  level(t) {
    if (!this.power || this.state === 'off') return 0;
    if (this.state === 'flicker') {
      const n = noise2(t * 9 + this.phase, this.phase);
      const n2 = noise2(t * 31 + this.phase * 2, 3.1);
      if (n > 0.25) return n2 > 0.1 ? 0.0 : 0.6;
      return 0.9 + n2 * 0.1;
    }
    if (this.state === 'dying') {
      const n = noise2(t * 2.5 + this.phase, 1.7);
      return n > 0.45 ? 0.05 : 0.35 + 0.2 * noise2(t * 13, this.phase);
    }
    if (this.state === 'pulse') return 0.5 + 0.5 * Math.sin(t * 3 + this.phase);
    return 1;
  }
}

export class LightSystem {
  constructor(scene, assets, maxLights) {
    this.scene = scene;
    this.assets = assets;
    this.fixtures = [];
    this.pool = [];
    this.setPoolSize(maxLights);
    this.acc = 0;
  }

  setPoolSize(n) {
    for (const s of this.pool) this.scene.remove(s.light);
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.layers.enableAll();
      this.scene.add(l);
      this.pool.push({ light: l, fx: null, fade: 0 });
    }
  }

  clear() {
    for (const f of this.fixtures) if (f.obj) f.obj.parent?.remove(f.obj);
    this.fixtures = [];
    for (const s of this.pool) { s.fx = null; s.fade = 0; s.light.intensity = 0; }
  }

  add(kind, x, y, z, opts = {}, parent) {
    const A = this.assets;
    const obj = new THREE.Group();
    let fx;
    if (kind === 'fluoro') {
      const m = A.model('mounted_fluorescent_lights');
      m.scale.setScalar(0.85);
      m.position.y = 0;
      obj.add(m);
      fx = new Fixture(Object.assign({ color: 0xe8f4ff, intensity: 24, range: 9, pos: new THREE.Vector3(x, y - 0.25, z) }, opts));
      const em = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: fx.col, emissiveIntensity: 0, roughness: 0.4 });
      const t = new THREE.Mesh(tubesGeo, em);
      obj.add(t);
      fx.emissives.push([em, 4.5]);
    } else if (kind === 'cage') {
      const m = A.model('caged_hanging_light');
      m.scale.setScalar(0.8);
      obj.add(m);
      fx = new Fixture(Object.assign({ color: 0xffc98a, intensity: 32, range: 9, pos: new THREE.Vector3(x, y - 0.75, z) }, opts));
      const em = new THREE.MeshStandardMaterial({ color: 0x555555, emissive: fx.col, emissiveIntensity: 0 });
      const b = new THREE.Mesh(bulbGeo, em); b.position.y = -0.62; b.scale.set(1.6, 1, 1);
      obj.add(b);
      fx.emissives.push([em, 6]);
    } else if (kind === 'bulb') {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.6, 4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      cord.position.y = -0.3;
      fx = new Fixture(Object.assign({ color: 0xffb46b, intensity: 20, range: 7, pos: new THREE.Vector3(x, y - 0.65, z) }, opts));
      const em = new THREE.MeshStandardMaterial({ color: 0x777766, emissive: fx.col, emissiveIntensity: 0, roughness: 0.2 });
      const b = new THREE.Mesh(bulbGeo, em); b.position.y = -0.64;
      obj.add(cord, b);
      fx.emissives.push([em, 8]);
      fx.swing = true;
    } else if (kind === 'wall') {
      const m = A.model('industrial_wall_lamp');
      obj.add(m);
      fx = new Fixture(Object.assign({ color: 0xffd7a0, intensity: 20, range: 7, pos: new THREE.Vector3(x, y, z) }, opts));
      const em = new THREE.MeshStandardMaterial({ color: 0x666666, emissive: fx.col, emissiveIntensity: 0 });
      const b = new THREE.Mesh(bulbGeo, em); b.position.set(0, 0, 0.07); b.scale.set(1.2, 2, 1);
      obj.add(b);
      fx.emissives.push([em, 5]);
    } else if (kind === 'emergency') {
      fx = new Fixture(Object.assign({ color: 0xff2012, intensity: 14, range: 7, state: 'pulse', group: 'emergency', pos: new THREE.Vector3(x, y, z) }, opts));
      const em = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: fx.col, emissiveIntensity: 0 });
      const b = new THREE.Mesh(boxGeo, em);
      obj.add(b);
      fx.emissives.push([em, 6]);
    } else if (kind === 'street') {
      const m = A.model('street_lamp_01');
      obj.add(m);
      fx = new Fixture(Object.assign({ color: 0xff9a45, intensity: 260, range: 20, pos: new THREE.Vector3(x, 3.6, z) }, opts));
      const em = new THREE.MeshStandardMaterial({ color: 0x553311, emissive: fx.col, emissiveIntensity: 0 });
      const b = new THREE.Mesh(bulbGeo, em); b.position.set(0, 3.72, 0); b.scale.set(2, 0.8, 2);
      obj.add(b);
      fx.emissives.push([em, 8]);
    } else if (kind === 'security') {
      const m = A.model('security_light');
      obj.add(m);
      fx = new Fixture(Object.assign({ color: 0xdfe8ff, intensity: 110, range: 16, pos: new THREE.Vector3(x, y - 0.3, z) }, opts));
      const em = new THREE.MeshStandardMaterial({ color: 0x555555, emissive: fx.col, emissiveIntensity: 0 });
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), em); b.position.set(0, -0.12, 0.25); b.rotation.x = -0.9;
      obj.add(b);
      fx.emissives.push([em, 4]);
    } else if (kind === 'virtual') {
      fx = new Fixture(Object.assign({ pos: new THREE.Vector3(x, y, z) }, opts));
    }
    obj.position.set(x, y, z);
    if (opts.rotY !== undefined) obj.rotation.y = opts.rotY;
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    fx.obj = obj;
    fx.kind = kind;
    if (parent) parent.add(obj);
    this.fixtures.push(fx);
    return fx;
  }

  setGroup(group, on) { for (const f of this.fixtures) if (f.group === group) f.setOn(on); }

  update(dt, t, camPos, quality) {
    // emissive parts every frame
    for (const f of this.fixtures) {
      const v = f.level(t) * f.flick;
      f.value = v;
      for (const [m, k] of f.emissives) m.emissiveIntensity = v * k;
      if (f.swing && f.obj) { f.obj.rotation.z = Math.sin(t * 0.9 + f.phase) * 0.06; f.obj.rotation.x = Math.cos(t * 0.7 + f.phase) * 0.05; }
    }
    // pick the best fixtures for the real lights a few times per second
    this.acc -= dt;
    if (this.acc <= 0) {
      this.acc = 0.15;
      const scored = [];
      for (const f of this.fixtures) {
        if (!f.power || f.state === 'off' || f.intensity <= 0) continue;
        const d2 = f.pos.distanceToSquared(camPos);
        if (d2 > (f.range + 14) * (f.range + 14)) continue;
        scored.push([f.intensity * f.range / (d2 + 4), f]);
      }
      scored.sort((a, b) => b[0] - a[0]);
      this.want = new Set(scored.slice(0, this.pool.length).map((s) => s[1]));
      // free slots whose fixture is no longer wanted
      for (const s of this.pool) if (s.fx && !this.want.has(s.fx)) s.leaving = true;
      for (const f of this.want) {
        if (this.pool.some((s) => s.fx === f)) continue;
        const slot = this.pool.find((s) => !s.fx) || this.pool.find((s) => s.leaving && s.fade < 0.05);
        if (slot) { slot.fx = f; slot.fade = 0; slot.leaving = false; }
      }
    }
    for (const s of this.pool) {
      if (!s.fx) { s.light.intensity = 0; continue; }
      s.fade = Math.max(0, Math.min(1, s.fade + (s.leaving ? -dt * 4 : dt * 4)));
      if (s.leaving && s.fade <= 0) { s.fx = null; s.leaving = false; s.light.intensity = 0; continue; }
      const f = s.fx;
      s.light.position.copy(f.pos);
      if (f.swing && f.obj) { s.light.position.x += Math.sin(f.obj.rotation.z) * 0.6; s.light.position.z -= Math.sin(f.obj.rotation.x) * 0.6; }
      s.light.color.copy(f.col);
      s.light.distance = f.range;
      s.light.intensity = f.intensity * f.value * s.fade;
    }
  }
}

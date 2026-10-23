import * as THREE from '../../lib/three.module.js';
import { RoundedBoxGeometry } from '../../lib/RoundedBoxGeometry.js';
import { DOOR_H } from './builder.js';
import { mergeGeometries } from '../../lib/BufferGeometryUtils.js';

let leafGeo = null, handleGeo = null, plateGeo = null, winGeo = null, hardwareGeo = null;

// Hinged door leaf living in a door cell. axis 'x' => leaf spans X.
export class Door {
  constructor(level, x, z, axis, opts = {}) {
    this.level = level;
    this.x = x; this.z = z; this.axis = axis;
    this.id = opts.id || `door_${x}_${z}`;
    this.locked = opts.locked || null;       // null | 'key:<item>' | 'code:1234' | 'script' | 'chain' | 'jammed'
    this.lockMsg = opts.lockMsg || null;
    this.open = !!opts.open;
    this.angle = this.open ? 1 : 0;           // 0 closed .. 1 open
    this.target = this.angle;
    this.dir = 1;                             // which way it swings
    this.metal = !!opts.metal;
    this.double = !!opts.double;
    this.slamT = 0;
    this.build(opts);
  }

  build(opts) {
    const A = this.level.assets;
    if (!leafGeo) {
      leafGeo = new RoundedBoxGeometry(0.9, DOOR_H - 0.03, 0.045, 2, 0.008);
      leafGeo.translate(0.45, (DOOR_H - 0.03) / 2, 0);
      handleGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.12, 8); handleGeo.rotateZ(Math.PI / 2);
      plateGeo = new THREE.BoxGeometry(0.05, 0.2, 0.008);
      winGeo = new THREE.PlaneGeometry(0.34, 0.5);
    }
    const tint = opts.tint ?? (this.metal ? 0x8a9289 : 0x9fa596);
    const mat = this.metal ? A.mat('green_metal_rust', { metal: false, color: tint, env: 0.3 }) : A.mat('wood_peeling_paint_weathered', { color: tint });
    this.pivot = new THREE.Group();
    const leaf = new THREE.Mesh(leafGeo, mat);
    leaf.castShadow = true; leaf.receiveShadow = true;
    this.pivot.add(leaf);
    const steel = A.mat('rusty_metal_02', { metal: true, color: 0x9a948c, env: 0.5 });
    if (!hardwareGeo) {
      const parts = [];
      for (const s of [-1, 1]) {
        parts.push(handleGeo.clone().translate(0.8, 1.02, s * 0.06));
        parts.push(plateGeo.clone().translate(0.82, 1.0, s * 0.026));
      }
      hardwareGeo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
    }
    const hw = new THREE.Mesh(hardwareGeo, steel);
    this.pivot.add(hw);
    if (opts.window) {
      const g = new THREE.Mesh(winGeo, new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55, envMapIntensity: 1 }));
      g.position.set(0.45, 1.55, 0.024);
      const g2 = g.clone(); g2.rotation.y = Math.PI; g2.position.z = -0.024;
      this.pivot.add(g, g2);
    }
    if (opts.sign) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.13), new THREE.MeshStandardMaterial({ map: opts.sign, roughness: 0.6 }));
      s.position.set(0.45, 1.75, 0.025);
      const s2 = s.clone(); s2.rotation.y = Math.PI; s2.position.z = -0.025;
      this.pivot.add(s, s2);
    }
    // hinge sits on one jamb, on the wall mid-plane
    // right half of a double door hinges on the far jamb so the pair opens from the middle
    this.mirror = opts.double === 'right';
    if (this.axis === 'x') { this.pivot.position.set(this.mirror ? this.x + 0.95 : this.x + 0.05, 0, this.z + 0.5); this.baseRot = this.mirror ? Math.PI : 0; }
    else { this.pivot.position.set(this.x + 0.5, 0, this.mirror ? this.z + 0.05 : this.z + 0.95); this.baseRot = this.mirror ? -Math.PI / 2 : Math.PI / 2; }
    this.pivot.rotation.y = this.baseRot;
    this.level.root.add(this.pivot);
    this.applyAngle();
  }

  blocking() { return this.angle < 0.5; }

  applyAngle() {
    this.pivot.rotation.y = this.baseRot + (this.mirror ? -1 : 1) * this.dir * this.angle * Math.PI * 0.52;
  }

  // Swing direction that opens away from someone standing at (x,z).
  dirFrom(x, z) {
    const side = this.axis === 'x' ? Math.sign(z - (this.z + 0.5)) : Math.sign(x - (this.x + 0.5));
    return side > 0 ? 1 : -1;
  }

  // Open away from the user so it never swings into them.
  toggle(fromX, fromZ, force) {
    if (this.locked && !force) return false;
    if (this.target < 0.5) {
      const side = this.axis === 'x' ? Math.sign(fromZ - (this.z + 0.5)) : Math.sign(fromX - (this.x + 0.5));
      this.dir = side > 0 ? 1 : -1;
      this.target = 1;
    } else this.target = 0;
    this.open = this.target > 0.5;
    return true;
  }

  setOpen(open, dir, instant) {
    if (dir) this.dir = dir;
    this.target = open ? 1 : 0;
    this.open = open;
    if (instant) { this.angle = this.target; this.applyAngle(); }
  }

  slam(open = false) { this.target = open ? 1 : 0; this.open = open; this.slamT = 1; }

  center() { return new THREE.Vector3(this.x + 0.5, 1.1, this.z + 0.5); }

  update(dt) {
    if (this.angle !== this.target) {
      const sp = this.slamT > 0 ? 6 : 2.2;
      const d = this.target - this.angle;
      const st = Math.sign(d) * Math.min(Math.abs(d), sp * dt);
      this.angle += st;
      this.applyAngle();
      if (this.angle === this.target) this.slamT = 0;
    }
  }
}

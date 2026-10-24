// Forward rendering cannot afford one real light per scene light on big maps (imported chapters have dozens).
// The rig keeps a fixed pool of real lights and assigns them to the scene lights nearest the camera each time the
// camera moves. The pool size is constant so shaders never recompile while navigating.

import * as THREE from '../../lib/three.module.js';
import { propsOf } from '../core/geometry.js';

const D2R = Math.PI / 180;

export class LightRig {
  constructor(parent, { points = 10, spots = 4, dirs = 1 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'LightRig';
    parent.add(this.group);
    this.points = Array.from({ length: points }, () => { const l = new THREE.PointLight(0xffffff, 0, 10, 2); l.visible = true; this.group.add(l); return l; });
    this.spots = Array.from({ length: spots }, () => { const l = new THREE.SpotLight(0xffffff, 0, 10, 0.6, 0.3, 2); this.group.add(l, l.target); return l; });
    this.dirs = Array.from({ length: dirs }, () => { const l = new THREE.DirectionalLight(0xffffff, 0); this.group.add(l, l.target); return l; });
    this.cache = { version: -1, lights: [] };
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
    this.lastVersion = -1;
    this.activeIds = [];
    this.totalLights = 0;
    this.groupState = null;   // playtest: power group -> 'on' | 'off' | 'flicker'
  }

  collect(scene, version) {
    if (this.cache.version === version) return this.cache.lights;
    const lights = [];
    scene.walk((n) => {
      if (n.type !== 'light') return;
      if (!scene.isVisible(n.id)) return;
      const p = propsOf(n);
      const m = scene.worldMatrix(n.id);
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
      lights.push({ id: n.id, p, pos, dir });
    });
    this.cache = { version, lights };
    return lights;
  }

  /** @param time seconds, for flicker preview (only used when animate=true) */
  update(scene, camera, { force = false, animate = false, time = 0, enabled = true } = {}) {
    const lights = this.collect(scene, scene.version);
    this.totalLights = lights.length;
    const moved = this.lastCam.distanceToSquared(camera.position) > 0.25 || this.lastVersion !== scene.version || this.forceUpdate;
    if (!enabled) { for (const l of [...this.points, ...this.spots, ...this.dirs]) l.intensity = 0; return false; }
    if (!moved && !force && !animate) return false;
    this.lastCam.copy(camera.position);
    this.lastVersion = scene.version; this.forceUpdate = false;
    const pts = [], spots = [], dirs = [];
    for (const L of lights) {
      const gs = this.groupState?.[L.p.powerGroup];
      if (!L.p.enabled && gs !== 'on') continue;
      if (gs === 'off') continue;
      L.flickerOverride = gs === 'flicker' ? 'flicker' : null;
      (L.p.kind === 'spot' ? spots : L.p.kind === 'directional' ? dirs : pts).push(L);
    }
    const nearest = (arr, n) => arr.map((L) => ({ L, d: L.pos.distanceToSquared(camera.position) })).sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.L);
    this.activeIds = [];
    const assign = (pool, list, setup) => {
      const chosen = nearest(list, pool.length);
      pool.forEach((l, i) => {
        const L = chosen[i];
        if (!L) { l.intensity = 0; return; }
        this.activeIds.push(L.id);
        l.color.set(L.p.color);
        l.position.copy(L.pos);
        l.intensity = L.p.intensity * flicker(L.flickerOverride || L.p.flicker, time, animate || !!L.flickerOverride);
        l.castShadow = !!L.p.castShadow;
        setup(l, L);
      });
    };
    assign(this.points, pts, (l, L) => { l.distance = L.p.range; l.decay = 2; });
    assign(this.spots, spots, (l, L) => { l.distance = L.p.range; l.angle = (L.p.angle * D2R) / 2; l.penumbra = L.p.penumbra; l.target.position.copy(L.pos).add(L.dir); });
    assign(this.dirs, dirs, (l, L) => { l.target.position.copy(L.pos).add(L.dir); });
    return true;
  }
}

function flicker(kind, t, animate) {
  if (!animate || kind === 'none') return 1;
  if (kind === 'pulse') return 0.65 + 0.35 * Math.sin(t * 2.2);
  if (kind === 'dying') return Math.random() < 0.12 ? 0.05 : 0.55 + 0.35 * Math.sin(t * 9) * Math.sin(t * 3.1);
  return Math.random() < 0.07 ? 0.2 : 1; // flicker
}

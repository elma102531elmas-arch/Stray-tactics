// World: scene + sky + sun + built map + collision. Shared by game, lobby and
// the map editor.
import * as THREE from 'three';
import { buildMap } from './mapbuilder.js';
import { bakeSky, DEFAULT_ATMOS } from '../gfx/sky.js';
import { preset } from '../core/settings.js';
import { BOUNCE, patchBakedAO } from '../gfx/materials.js';
import { hasModel, loadGLTF } from '../assets/loader.js';

// clutter skipped on the lowest prop detail
const SMALL_PROPS = new Set(['ammo_box', 'jerrycan', 'vase_jug', 'pot_clay']);
// world copies of glTF materials (patched for baked lighting)
const propMats = new Map();
function propMaterial(m) {
  let c = propMats.get(m);
  if (!c) { c = m.clone(); patchBakedAO(c, { macro: false, dust: 0.7 }); propMats.set(m, c); }
  return c;
}

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.name = 'world';
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.camera.layers.enable(1);
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.HemisphereLight(0xbfd8ff, 0x9a7b55, 0.32);
    this.scene.add(this.fill);
    this.map = null;
    this.built = null;
    this.sky = null;
    this.atmos = { ...DEFAULT_ATMOS };
    this.sunDir = new THREE.Vector3(...DEFAULT_ATMOS.sunDir).normalize();
    this.dynamic = new THREE.Group(); this.dynamic.name = 'dynamic';
    this.scene.add(this.dynamic);
    // pooled world point lights (constant count => no shader recompiles)
    this.flashLights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 9, 2); l.castShadow = false; this.scene.add(l); this.flashLights.push({ light: l, t: 0 });
    }
  }

  async load(map, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    if (this.built) { this.scene.remove(this.built.group); this.built.dispose(); this.built = null; }
    this.map = map;
    this.applyAtmos(map.atmos || {});
    const p = preset();
    const built = await buildMap(map, { aoCell: p.aoCell, aoRays: p.aoCell >= 1 ? 8 : 12, fast: !!opts.fast, onProgress });
    this.built = built;
    this.collision = built.collision;
    this.spawns = built.spawns;
    try {
      const props = await this._instanceModels(built.models, built.collision, p);
      built.group.add(props.group);
      const dispose = built.dispose;
      built.dispose = () => { dispose(); props.dispose(); };
      built.stats.props = props.count;
    } catch (e) { console.warn('props failed', e); }
    this.scene.add(built.group);
    this.fitShadow();
    this.applyQuality();
    return built;
  }

  // glTF props: one InstancedMesh per glTF mesh, all placements of that model
  // in one draw call. Per-instance sky visibility feeds the baked-AO shader so
  // props under roofs/arches darken like the map does.
  async _instanceModels(list, col, p) {
    const group = new THREE.Group(); group.name = 'props';
    const meshes = [];
    const by = new Map();
    for (const it of list || []) {
      if (p.propDetail === 0 && SMALL_PROPS.has(it.name)) continue;
      if (!by.has(it.name)) by.set(it.name, []);
      by.get(it.name).push(it.matrix);
    }
    const tmp = new THREE.Matrix4(), top = new THREE.Vector3(), dir = new THREE.Vector3(), hit = {};
    for (const [name, mats] of by) {
      if (!hasModel(name)) continue;
      const g = await loadGLTF(name);
      g.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.scene);
      const ao = new Float32Array(mats.length * 2);
      mats.forEach((m, i) => {
        top.set((box.min.x + box.max.x) / 2, box.max.y + 0.06, (box.min.z + box.max.z) / 2).applyMatrix4(m);
        let free = 0, n = 0;
        for (let k = 0; k < 10; k++) {
          const a = k * 2.39996, y = 0.45 + 0.55 * (k / 9);
          const r = Math.sqrt(1 - y * y); dir.set(Math.cos(a) * r, y, Math.sin(a) * r);
          n++; if (!col.raycast(top, dir, 9, hit)) free++;
        }
        ao[i * 2] = 1; ao[i * 2 + 1] = free / n;
      });
      const aoAttr = new THREE.InstancedBufferAttribute(ao, 2);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geo = new THREE.BufferGeometry();
        for (const k in o.geometry.attributes) geo.setAttribute(k, o.geometry.attributes[k]);
        geo.setIndex(o.geometry.index);
        for (const gr of o.geometry.groups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
        geo.setAttribute('ao', aoAttr);
        const mat = Array.isArray(o.material) ? o.material.map(propMaterial) : propMaterial(o.material);
        const im = new THREE.InstancedMesh(geo, mat, mats.length);
        for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, tmp.multiplyMatrices(mats[i], o.matrixWorld));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = true; im.receiveShadow = true;
        im.computeBoundingSphere(); im.computeBoundingBox();
        im.name = name;
        group.add(im); meshes.push(im);
      });
    }
    return {
      group, count: list ? list.length : 0,
      dispose() { for (const m of meshes) { m.geometry.dispose(); m.dispose(); } },
    };
  }

  applyAtmos(over) {
    const a = { ...DEFAULT_ATMOS, ...over };
    const key = JSON.stringify(a);
    this.atmos = a;
    this.sunDir.set(...a.sunDir).normalize();
    this.sun.color.set(a.sunColor);
    this.sun.intensity = a.sunIntensity;
    this.scene.fog = new THREE.FogExp2(new THREE.Color(a.fogColor), a.fogDensity);
    if (this._skyKey !== key) {
      if (this.sky) this.sky.dispose();
      this.sky = bakeSky(this.renderer.r, a);
      this._skyKey = key;
    }
    this.scene.background = this.sky.background;
    this.scene.environment = this.sky.environment;
    this.scene.environmentIntensity = a.envIntensity;
    // bounce light used in sky-occluded areas (see patchBakedAO)
    BOUNCE.value.set(a.sunColor).multiply(new THREE.Color(a.skyGround).lerp(new THREE.Color('#9a9088'), 0.6)).multiplyScalar(a.sunIntensity * 0.18 * (a.bounce ?? 1));
    { const b = BOUNCE.value, l = b.r * 0.2126 + b.g * 0.7152 + b.b * 0.0722; b.lerp(new THREE.Color(l, l, l), 0.5); } // desaturate
    // warm bounce fill: sunlit sand reflects into shadows
    this.fill.color.set(a.skyHorizon); this.fill.groundColor.set(a.skyGround).lerp(new THREE.Color(a.sunColor), 0.2);
  }

  fitShadow() {
    const s = this.sun;
    const b = this.map.bounds;
    const pad = 14;
    const minX = b[0] - pad, minZ = b[1] - pad, maxX = b[2] + pad, maxZ = b[3] + pad;
    const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    s.position.copy(center).addScaledVector(this.sunDir, 120);
    s.target.position.copy(center);
    s.target.updateMatrixWorld();
    s.updateMatrixWorld();
    // same orientation three.js gives the shadow camera (looks from light to target)
    const camWorld = new THREE.Matrix4().lookAt(s.position, center, new THREE.Vector3(0, 1, 0)).setPosition(s.position);
    const toView = camWorld.clone().invert();
    let l = Infinity, r = -Infinity, bt = Infinity, tp = -Infinity, n = Infinity, f = -Infinity;
    for (const x of [minX, maxX]) for (const y of [0, 16]) for (const z of [minZ, maxZ]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(toView);
      l = Math.min(l, v.x); r = Math.max(r, v.x); bt = Math.min(bt, v.y); tp = Math.max(tp, v.y); n = Math.min(n, -v.z); f = Math.max(f, -v.z);
    }
    const cam = s.shadow.camera;
    cam.left = l; cam.right = r; cam.bottom = bt; cam.top = tp; cam.near = Math.max(0.5, n - 5); cam.far = f + 5;
    cam.updateProjectionMatrix();
    s.shadow.bias = -0.00025;
    s.shadow.normalBias = 0.035;
  }

  applyQuality() {
    const p = preset();
    const s = this.sun;
    const size = p.shadowSize;
    if (s.shadow.mapSize.x !== size) {
      s.shadow.mapSize.set(size, size);
      if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
    }
    s.shadow.radius = p.softShadows ? 2.5 : 1;
    const r = this.renderer.r;
    r.shadowMap.autoUpdate = p.shadows === 'dynamic';
    r.shadowMap.needsUpdate = true;
  }

  refreshShadows() { this.renderer.r.shadowMap.needsUpdate = true; }

  // fraction of sun visible from a point (0..1), used to light the viewmodel
  sunVisibility(pos) {
    if (!this.collision) return 1;
    const o = this._sv || (this._sv = new THREE.Vector3());
    let vis = 0;
    const offs = [[0, 0], [0.25, 0], [-0.25, 0]];
    for (const [ox, oz] of offs) {
      o.set(pos.x + ox, pos.y, pos.z + oz);
      if (!this.collision.raycast(o, this.sunDir, 80, this._svh || (this._svh = {}))) vis += 1;
    }
    return vis / offs.length;
  }

  flash(pos, intensity = 6, color = 0xffb060) {
    let best = this.flashLights[0];
    for (const f of this.flashLights) if (f.t < best.t) best = f;
    best.light.position.copy(pos); best.light.color.set(color); best.light.intensity = intensity; best.t = 0.06; best.max = intensity;
  }

  update(dt) {
    for (const f of this.flashLights) {
      if (f.t > 0) { f.t -= dt; f.light.intensity = Math.max(0, f.t / 0.06) * f.max; } else f.light.intensity = 0;
    }
  }
}

// Turns material definitions (plain JSON in the project) into cached THREE materials with
// per-material texture clones (tiling / offset / rotation live on the texture clone).

import * as THREE from '../../lib/three.module.js';
import { getMaterialDef, defaultMaterial } from '../core/materials.js';

export class MaterialFactory {
  constructor(project, assetLib) {
    this.project = project;
    this.assetLib = assetLib;
    this.cache = new Map();    // key -> {mat, sig, textures:[]}
    this.listeners = new Set();
    this.fallback = new THREE.MeshStandardMaterial({ color: 0xff00ff, roughness: 1 });
  }
  setProject(project) { this.project = project; this.disposeAll(); }

  signature(def) { return JSON.stringify(def); }

  get(id) {
    const def = getMaterialDef(this.project, id);
    if (!def) return this.fallback;
    const sig = this.signature(def);
    const hit = this.cache.get(id);
    if (hit && hit.sig === sig) return hit.mat;
    if (hit) this._dispose(hit);
    const entry = this._build(id, def, sig);
    this.cache.set(id, entry);
    return entry.mat;
  }

  _build(id, def, sig) {
    const d = { ...defaultMaterial(), ...def };
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(d.color), roughness: d.roughness, metalness: d.metalness,
      emissive: new THREE.Color(d.emissive), emissiveIntensity: d.emissiveIntensity,
      transparent: d.opacity < 1 || !!d.alphaMap, opacity: d.opacity, side: d.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: d.opacity >= 1,
    });
    mat.name = d.name;
    mat.userData.materialId = id;
    const entry = { mat, sig, textures: [] };
    const slot = (assetId, apply, srgb) => {
      if (!assetId) return;
      this.assetLib.loadTexture(assetId).then((base) => {
        if (!base) return;
        const t = base.clone();
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(d.tiling[0], d.tiling[1]);
        t.offset.set(d.offset[0], d.offset[1]);
        t.rotation = (d.rotation * Math.PI) / 180;
        t.anisotropy = 4;
        t.needsUpdate = true;
        entry.textures.push(t);
        apply(t);
        mat.needsUpdate = true;
        this.listeners.forEach((fn) => fn(id));
      }).catch(() => {});
    };
    slot(d.map, (t) => { mat.map = t; }, true);
    slot(d.normalMap, (t) => { mat.normalMap = t; mat.normalScale.set(d.normalScale, d.normalScale); }, false);
    slot(d.ormMap, (t) => { mat.aoMap = t; mat.roughnessMap = t; if (d.metalness > 0) mat.metalnessMap = t; }, false);
    slot(d.emissiveMap, (t) => { mat.emissiveMap = t; }, true);
    slot(d.alphaMap, (t) => { mat.alphaMap = t; }, false);
    return entry;
  }

  _dispose(e) { e.textures.forEach((t) => t.dispose()); e.mat.dispose(); }
  disposeAll() { for (const e of this.cache.values()) this._dispose(e); this.cache.clear(); }
  stats() { return { materials: this.cache.size }; }
}

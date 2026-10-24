// Turns material definitions (plain JSON in the project) into THREE materials.
// A material id always maps to ONE stable THREE.MeshStandardMaterial that is updated in place when its
// definition changes, so meshes never hold stale references. Each texture slot uses a per-material clone
// of the shared texture so tiling / offset / rotation are independent between materials.

import * as THREE from '../../lib/three.module.js';
import { getMaterialDef, defaultMaterial } from '../core/materials.js';

const SLOTS = ['map', 'normalMap', 'ormMap', 'emissiveMap', 'alphaMap'];

export class MaterialFactory {
  constructor(project, assetLib) {
    this.project = project;
    this.assetLib = assetLib;
    this.cache = new Map();    // id -> {mat, sig, textures:{slot: Texture}}
    this.listeners = new Set();
    this.fallback = new THREE.MeshStandardMaterial({ color: 0xff00ff, roughness: 1 });
    this.fallback.name = '(missing material)';
    this.loadFailures = new Map(); // assetId -> message (for the diagnostics panel)
  }
  setProject(project) { this.project = project; this.disposeAll(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _notify(id) { this.listeners.forEach((fn) => fn(id)); }

  signature(def) { return JSON.stringify(def); }

  get(id) {
    const def = getMaterialDef(this.project, id);
    if (!def) return this.fallback;
    const sig = this.signature(def);
    let e = this.cache.get(id);
    if (!e) {
      e = { mat: new THREE.MeshStandardMaterial(), sig: '', textures: {}, gen: 0 };
      e.mat.userData.materialId = id;
      this.cache.set(id, e);
    }
    if (e.sig !== sig) this._apply(e, def, sig);
    return e.mat;
  }

  /** Re-check every cached material against the project data (call after undo/redo/edits). Returns changed ids. */
  refreshChanged() {
    const changed = [];
    for (const [id, e] of [...this.cache]) {
      const def = getMaterialDef(this.project, id);
      if (!def) continue;
      const sig = this.signature(def);
      if (sig !== e.sig) { this._apply(e, def, sig); changed.push(id); }
    }
    return changed;
  }

  _apply(e, def, sig) {
    const d = { ...defaultMaterial(), ...def };
    const m = e.mat;
    e.sig = sig;
    e.gen++;
    const gen = e.gen;
    m.name = d.name;
    m.color.set(d.color);
    m.roughness = d.roughness; m.metalness = d.metalness;
    m.emissive.set(d.emissive); m.emissiveIntensity = d.emissiveIntensity;
    m.opacity = d.opacity;
    m.transparent = d.opacity < 1 || !!d.alphaMap;
    m.depthWrite = d.opacity >= 1;
    m.side = d.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    m.alphaTest = d.alphaMap ? 0.35 : 0;
    m.normalScale.set(d.normalScale, d.normalScale);
    for (const slot of SLOTS) {
      const old = e.textures[slot];
      if (old) { old.dispose(); delete e.textures[slot]; }
    }
    m.map = m.normalMap = m.aoMap = m.roughnessMap = m.metalnessMap = m.emissiveMap = m.alphaMap = null;
    m.needsUpdate = true;
    const slot = (name, assetId, apply, srgb) => {
      if (!assetId) return;
      this.assetLib.loadTexture(assetId).then((base) => {
        if (e.gen !== gen || !base) return;
        const t = base.clone();
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(d.tiling[0], d.tiling[1]);
        t.offset.set(d.offset[0], d.offset[1]);
        t.rotation = (d.rotation * Math.PI) / 180;
        t.anisotropy = 4;
        t.needsUpdate = true;
        e.textures[name] = t;
        apply(t);
        m.needsUpdate = true;
        this._notify(m.userData.materialId);
      }).catch((err) => { this.loadFailures.set(assetId, err.message); this._notify(m.userData.materialId); });
    };
    slot('map', d.map, (t) => { m.map = t; }, true);
    slot('normalMap', d.normalMap, (t) => { m.normalMap = t; }, false);
    slot('ormMap', d.ormMap, (t) => { m.aoMap = t; m.roughnessMap = t; if (d.metalness > 0) m.metalnessMap = t; }, false);
    slot('emissiveMap', d.emissiveMap, (t) => { m.emissiveMap = t; }, true);
    slot('alphaMap', d.alphaMap, (t) => { m.alphaMap = t; }, false);
  }

  textureCount() { let n = 0; for (const e of this.cache.values()) n += Object.keys(e.textures).length; return n; }
  disposeAll() {
    for (const e of this.cache.values()) { Object.values(e.textures).forEach((t) => t.dispose()); e.mat.dispose(); }
    this.cache.clear();
  }
  stats() { return { materials: this.cache.size, textures: this.textureCount() }; }
}

// Runtime asset library: resolves asset ids to loaded THREE resources (models, textures, audio buffers).
// Built-in ids ("builtin:...") read the original game's files; user ids read blobs from storage.
// Everything is cached; call release*/dispose to free GPU memory.

import * as THREE from '../../lib/three.module.js';
import { GLTFLoader } from '../../lib/GLTFLoader.js';
import { OBJLoader } from '../../lib/OBJLoader.js';
import { MTLLoader } from '../../lib/MTLLoader.js';
import { FBXLoader } from '../../lib/FBXLoader.js';
import { DRACOLoader } from '../../lib/DRACOLoader.js';
import { KTX2Loader } from '../../lib/KTX2Loader.js';
import { MeshoptDecoder } from '../../lib/meshopt_decoder.module.js';
import * as SkeletonUtils from '../../lib/SkeletonUtils.js';
import { getBuiltinLibrary, builtinMeta, isBuiltinId } from '../core/builtin.js';
import { extOf, baseName, dirName, resolvePath } from './classify.js';

export class AssetLibrary {
  /** @param {{storage, getProject:()=>object, baseUrl?:string}} o  baseUrl = URL the studio page is served from */
  constructor({ storage, getProject, baseUrl = '' }) {
    this.storage = storage;
    this.getProject = getProject;
    this.baseUrl = baseUrl;
    this.models = new Map();
    this.textures = new Map();
    this.audio = new Map();
    this.urls = new Map();
    this.renderer = null;
    this.errors = new Map();      // assetId -> last load error message (for the missing-asset report)
    this.stats = { modelsLoaded: 0, texturesLoaded: 0, audioLoaded: 0 };
  }

  setRenderer(r) { this.renderer = r; this._ktx2 = null; }

  meta(id) { return this.getProject()?.data.assets[id] || builtinMeta(id) || null; }
  has(id) { return !!this.meta(id); }

  allMeta(kind) {
    const out = [];
    const b = getBuiltinLibrary();
    for (const m of Object.values(b.models)) if (!kind || kind === 'model') out.push(m);
    for (const m of Object.values(b.textures)) if (!kind || kind === 'image') out.push(m);
    for (const m of Object.values(this.getProject()?.data.assets || {})) if (!kind || m.kind === kind) out.push(m);
    return out;
  }

  _key(meta, path) { return `${this.getProject().meta.id}/${meta.id}/${path}`; }

  async fileBlob(meta, path = meta.path) {
    const b = await this.storage.getBlob(this._key(meta, path));
    if (!b) throw new Error(`The stored file "${path}" of asset "${meta.name}" is missing from local storage. Re-import the asset (or restore the project bundle).`);
    return b;
  }

  async url(meta, path = meta.path) {
    if (meta.builtin) return new URL(meta.path, this.baseUrl || document.baseURI).href;
    const key = this._key(meta, path);
    if (this.urls.has(key)) return this.urls.get(key);
    const u = URL.createObjectURL(await this.fileBlob(meta, path));
    this.urls.set(key, u);
    return u;
  }

  // ------------------------------------------------------------------ textures
  loadTexture(id) {
    if (this.textures.has(id)) return this.textures.get(id);
    const p = (async () => {
      const meta = this.meta(id);
      if (!meta) throw new Error(`Texture asset "${id}" does not exist.`);
      const url = await this.url(meta);
      let tex;
      if (extOf(meta.path) === 'ktx2') {
        if (!this.renderer) throw new Error('KTX2 textures need the 3D viewport to be initialised first.');
        tex = await this._ktx2Loader().loadAsync(url);
      } else tex = await new THREE.TextureLoader().loadAsync(url);
      tex.name = meta.name;
      this.stats.texturesLoaded++;
      this.errors.delete(id);
      return tex;
    })();
    p.catch((e) => { this.errors.set(id, e.message); this.textures.delete(id); });
    this.textures.set(id, p);
    return p;
  }
  _ktx2Loader() {
    if (!this._ktx2) this._ktx2 = new KTX2Loader().setTranscoderPath(new URL('lib/basis/', this.baseUrl || document.baseURI).href).detectSupport(this.renderer);
    return this._ktx2;
  }

  // ------------------------------------------------------------------ models
  /** Loads once; returns {scene, animations, bounds, triangles}. Use instantiate() to get a clone. */
  loadModel(id) {
    if (this.models.has(id)) return this.models.get(id);
    const p = this._loadModel(id);
    p.then(() => { this.errors.delete(id); }, (e) => { this.errors.set(id, e.message); this.models.delete(id); });
    this.models.set(id, p);
    return p;
  }

  _manager(meta, files) {
    const manager = new THREE.LoadingManager();
    const dir = dirName(meta.path);
    manager.setURLModifier((url) => {
      if (/^(data:|blob:)/.test(url)) return url;
      const rel = resolvePath(dir, url.replace(/^.*?:\/\/[^/]+\//, ''));
      const hit = files.get(rel) || [...files.entries()].find(([k]) => baseName(k).toLowerCase() === baseName(rel).toLowerCase())?.[1];
      if (hit) return hit;
      this._missing?.push(baseName(url));
      return url;
    });
    return manager;
  }

  async _fileUrls(meta) {
    const files = new Map();
    for (const f of meta.files || [meta.path]) files.set(f, await this.url(meta, f));
    return files;
  }

  async _loadModel(id) {
    const meta = this.meta(id);
    if (!meta) throw new Error(`Model asset "${id}" does not exist.`);
    const ext = extOf(meta.path);
    let scene, animations = [];
    this._missing = [];
    try {
      if (meta.builtin) {
        const loader = this._gltf(new THREE.LoadingManager());
        const g = await loader.loadAsync(await this.url(meta));
        scene = g.scene; animations = g.animations;
      } else {
        const files = await this._fileUrls(meta);
        const manager = this._manager(meta, files);
        const mainBlob = await this.fileBlob(meta);
        if (ext === 'glb' || ext === 'gltf') {
          const loader = this._gltf(manager);
          const data = ext === 'glb' ? await mainBlob.arrayBuffer() : await mainBlob.text();
          const g = await new Promise((res, rej) => loader.parse(data, '', res, rej));
          scene = g.scene; animations = g.animations;
        } else if (ext === 'fbx') {
          const g = new FBXLoader(manager).parse(await mainBlob.arrayBuffer(), '');
          scene = g; animations = g.animations || [];
        } else if (ext === 'obj') {
          const objText = await mainBlob.text();
          const loader = new OBJLoader(manager);
          const mtlPath = (meta.files || []).find((f) => extOf(f) === 'mtl');
          if (mtlPath) {
            const mats = new MTLLoader(manager).parse(await (await this.fileBlob(meta, mtlPath)).text(), '');
            mats.preload();
            loader.setMaterials(mats);
          }
          scene = loader.parse(objText);
        } else throw new Error(`Unsupported model format ".${ext}".`);
      }
    } catch (e) {
      throw new Error(`Could not load model "${meta.name}": ${e.message || e}`);
    }
    this._finishModel(scene);
    const bounds = new THREE.Box3().setFromObject(scene);
    const info = { scene, animations, bounds, missingTextures: [...new Set(this._missing)], meta };
    this.stats.modelsLoaded++;
    return info;
  }

  _finishModel(scene) {
    scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.anisotropy = 4; }
      }
    });
  }

  _gltf(manager) {
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    const draco = new DRACOLoader().setDecoderPath(new URL('lib/draco/', this.baseUrl || document.baseURI).href);
    loader.setDRACOLoader(draco);
    if (this.renderer) loader.setKTX2Loader(this._ktx2Loader());
    return loader;
  }

  /** Cloned scene graph safe to add to a THREE scene (shares geometry/materials/textures). */
  async instantiate(id) {
    const info = await this.loadModel(id);
    const clone = SkeletonUtils.clone(info.scene);
    return { object: clone, animations: info.animations, bounds: info.bounds.clone() };
  }

  // ------------------------------------------------------------------ audio
  async loadAudio(id, ctx) {
    if (this.audio.has(id)) return this.audio.get(id);
    const meta = this.meta(id);
    if (!meta) throw new Error(`Audio asset "${id}" does not exist.`);
    const blob = await this.fileBlob(meta);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    this.audio.set(id, buf);
    this.stats.audioLoaded++;
    return buf;
  }

  invalidate(id) {
    this.models.delete(id); this.textures.delete(id); this.audio.delete(id);
    for (const [k, u] of this.urls) if (k.includes(`/${id}/`)) { URL.revokeObjectURL(u); this.urls.delete(k); }
  }

  dispose() {
    for (const p of this.textures.values()) p.then((t) => t.dispose()).catch(() => {});
    for (const p of this.models.values()) p.then((m) => m.scene.traverse((o) => { o.geometry?.dispose?.(); })).catch(() => {});
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.models.clear(); this.textures.clear(); this.audio.clear(); this.urls.clear();
  }
}

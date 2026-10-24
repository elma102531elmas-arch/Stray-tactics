// Browser-side import pipeline: reads dropped files, validates them with the real loaders,
// stores blobs, and produces manifest entries. Errors are collected per file and phrased for humans.

import * as THREE from '../../lib/three.module.js';
import { GLTFLoader } from '../../lib/GLTFLoader.js';
import { OBJLoader } from '../../lib/OBJLoader.js';
import { MTLLoader } from '../../lib/MTLLoader.js';
import { FBXLoader } from '../../lib/FBXLoader.js';
import { MeshoptDecoder } from '../../lib/meshopt_decoder.module.js';
import { sha256Hex, uid, formatBytes } from '../core/util.js';
import { planImport, inspectGlb, extOf, baseName, dirName, stem, resolvePath, gltfExtensionSupport } from './classify.js';
import { setData } from '../core/commands.js';
import { defaultMaterial } from '../core/materials.js';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'asset';

export class AssetImporter {
  constructor(app) { this.app = app; }

  /** files: [{path, file:Blob}] — path keeps the folder structure of a dropped pack. */
  async importFiles(files, { license = '', source = 'user import', onProgress } = {}) {
    const app = this.app;
    const project = app.project;
    const result = { added: [], errors: [], warnings: [], skipped: [], materialsAdded: 0 };
    const norm = files.map((f) => ({ path: f.path.replace(/\\/g, '/').replace(/^\/+/, ''), size: f.file.size, file: f.file }));
    const blobOf = new Map(norm.map((f) => [f.path, f.file]));
    const readText = async (p) => blobOf.get(p).text();
    const plan = await planImport(norm, readText);
    result.errors.push(...plan.errors);
    result.warnings.push(...plan.warnings);
    const newAssets = {};
    const existingByHash = new Map(Object.values(project.data.assets).filter((a) => a.hash).map((a) => [a.hash, a]));
    let done = 0;
    for (const item of plan.items) {
      try {
        onProgress?.(done / plan.items.length, item.path);
        const meta = await this._importItem(item, blobOf, result, existingByHash, license, source);
        if (meta) { newAssets[meta.id] = meta; existingByHash.set(meta.hash, meta); result.added.push(meta.id); }
      } catch (e) {
        result.errors.push({ path: item.path, message: `"${baseName(item.path)}": ${e.message || e}` });
      }
      done++;
    }
    if (Object.keys(newAssets).length) {
      app.history.exec(setData(['assets'], { ...project.data.assets, ...newAssets }, { label: `Import ${Object.keys(newAssets).length} asset(s)` }));
    }
    onProgress?.(1, '');
    return result;
  }

  async _store(meta, path, blob) { await this.app.storage.putBlob(`${this.app.project.meta.id}/${meta.id}/${path}`, blob); }

  async _importItem(item, blobOf, result, existingByHash, license, source) {
    const mainBlob = blobOf.get(item.path);
    const bytes = new Uint8Array(await mainBlob.arrayBuffer());
    const hash = await sha256Hex(bytes);
    const dup = existingByHash.get(hash);
    if (dup && item.kind !== 'data') { result.skipped.push({ path: item.path, existing: dup.id }); result.warnings.push({ path: item.path, message: `"${baseName(item.path)}" is identical to the already-imported asset "${dup.name}" and was skipped.` }); return null; }
    const base = {
      id: `${item.kind === 'image' ? 'tex' : item.kind}_${slug(stem(item.path))}_${hash.slice(0, 6)}`,
      name: stem(item.path), kind: item.kind, format: item.ext, path: item.path, folder: dirName(item.path),
      files: item.files, size: item.files.reduce((n, f) => n + (blobOf.get(f)?.size || 0), 0), hash,
      license: license || 'Unspecified', source, importedAt: new Date().toISOString(),
    };
    if (item.kind === 'model') await this._inspectModel(item, base, blobOf, bytes, result);
    else if (item.kind === 'image') await this._inspectImage(base, mainBlob, result);
    else if (item.kind === 'audio') await this._inspectAudio(base, bytes, result);
    else if (item.kind === 'data') return await this._importData(item, base, bytes, blobOf, result);
    for (const f of item.files) await this._store(base, f, blobOf.get(f));
    return base;
  }

  async _inspectModel(item, meta, blobOf, bytes, result) {
    const ext = item.ext;
    const files = new Map();
    for (const f of item.files) files.set(f, URL.createObjectURL(blobOf.get(f)));
    const manager = new THREE.LoadingManager();
    const dir = dirName(item.path);
    const missing = [];
    manager.setURLModifier((url) => {
      if (/^(data:|blob:)/.test(url)) return url;
      const rel = resolvePath(dir, url.replace(/^.*?:\/\/[^/]+\//, ''));
      const hit = files.get(rel) || [...files.entries()].find(([k]) => baseName(k).toLowerCase() === baseName(rel).toLowerCase())?.[1];
      if (!hit) missing.push(baseName(url));
      return hit || url;
    });
    let scene, animations = [];
    try {
      if (ext === 'glb') {
        const g = inspectGlb(bytes);
        if (!g.ok) throw new Error(g.error);
        const sup = gltfExtensionSupport(g.json);
        if (sup.unsupported.length) result.warnings.push({ path: item.path, message: `Uses glTF extensions this viewer cannot decode: ${sup.unsupported.join(', ')}.` });
        const loader = new GLTFLoader(manager); loader.setMeshoptDecoder(MeshoptDecoder);
        const res = await new Promise((ok, no) => loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, no));
        scene = res.scene; animations = res.animations;
      } else if (ext === 'gltf') {
        const loader = new GLTFLoader(manager); loader.setMeshoptDecoder(MeshoptDecoder);
        const res = await new Promise((ok, no) => loader.parse(new TextDecoder().decode(bytes), '', ok, no));
        scene = res.scene; animations = res.animations;
      } else if (ext === 'fbx') {
        // external textures referenced by name are matched from every image dropped alongside
        for (const [p, f] of blobOf) if (['png', 'jpg', 'jpeg', 'webp'].includes(extOf(p)) && !files.has(p)) files.set(p, URL.createObjectURL(f));
        scene = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
        animations = scene.animations || [];
        const used = new Set();
        scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.map?.image?.src) used.add(m.map.image.src); });
      } else if (ext === 'obj') {
        const loader = new OBJLoader(manager);
        const mtlPath = item.files.find((f) => extOf(f) === 'mtl');
        if (mtlPath) { const mats = new MTLLoader(manager).parse(await blobOf.get(mtlPath).text(), ''); mats.preload(); loader.setMaterials(mats); }
        scene = loader.parse(new TextDecoder().decode(bytes));
      }
    } catch (e) {
      const msg = e?.message || String(e);
      throw new Error(`could not be read as a ${ext.toUpperCase()} model (${msg}). The file may be corrupt, truncated or use unsupported features.`);
    } finally { /* object URLs are revoked by the browser on unload; small */ }
    if (missing.length) result.warnings.push({ path: item.path, message: `Textures not found: ${[...new Set(missing)].join(', ')}. The model imported without them — add the files and re-import to attach them.` });
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    if (box.isEmpty()) throw new Error('contains no visible geometry.');
    let tris = 0, meshes = 0;
    const mats = new Set();
    scene.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; for (const m of [].concat(o.material)) mats.add(m.name || '(unnamed)'); } });
    const size = box.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) > 60) result.warnings.push({ path: item.path, message: `The model is ${Math.max(size.x, size.y, size.z).toFixed(0)} m across — it was probably exported in centimetres. Set the asset scale to 0.01 in the Asset Editor.` });
    if (Math.max(size.x, size.y, size.z) < 0.02) result.warnings.push({ path: item.path, message: 'The model is under 2 cm across — probably exported in metres from a centimetre scene. Increase the asset scale.' });
    if (tris > 300000) result.warnings.push({ path: item.path, message: `${Math.round(tris).toLocaleString()} triangles is heavy for a game prop — consider simplifying it.` });
    Object.assign(meta, {
      bounds: { min: box.min.toArray().map((v) => +v.toFixed(4)), max: box.max.toArray().map((v) => +v.toFixed(4)) },
      triangles: Math.round(tris), meshes, materials: [...mats],
      animations: animations.map((a) => ({ name: a.name || 'clip', duration: +a.duration.toFixed(3), events: [] })),
      scale: 1, pivot: [0, 0, 0], collision: 'auto-box', colliderCenter: null, colliderSize: null,
      attachedSounds: [], interaction: null, materialOverrides: {}, units: Math.max(size.x, size.y, size.z) > 60 ? 'cm?' : 'm',
    });
    scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  }

  async _inspectImage(meta, blob, result) {
    if (meta.format === 'ktx2') { meta.width = meta.height = null; result.warnings.push({ path: meta.path, message: 'KTX2 textures are GPU-compressed; their size is shown after the viewport loads them.' }); return; }
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (!bmp) throw new Error('could not be decoded as an image (corrupt or unsupported).');
    meta.width = bmp.width; meta.height = bmp.height; bmp.close?.();
    const pot = (n) => (n & (n - 1)) === 0;
    if (!pot(meta.width) || !pot(meta.height)) result.warnings.push({ path: meta.path, message: `Texture is ${meta.width}×${meta.height} (not a power of two): mipmaps/compression work better with 512, 1024, 2048…` });
    if (Math.max(meta.width, meta.height) > 4096) result.warnings.push({ path: meta.path, message: `Texture is ${meta.width}×${meta.height} — very large; it will use ${formatBytes(meta.width * meta.height * 4)} of GPU memory.` });
    meta.sheet = null;
  }

  async _inspectAudio(meta, bytes, result) {
    const Ctx = globalThis.OfflineAudioContext || globalThis.AudioContext;
    if (!Ctx) { result.warnings.push({ path: meta.path, message: 'Audio decoding is not available in this browser; the file was stored but not verified.' }); return; }
    const ctx = new (globalThis.OfflineAudioContext || Ctx)(1, 1, 44100);
    try {
      const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      meta.duration = +buf.duration.toFixed(3); meta.channels = buf.numberOfChannels; meta.sampleRate = buf.sampleRate;
      if (buf.numberOfChannels > 1) result.warnings.push({ path: meta.path, message: 'Stereo sounds are not positioned in 3D — use a mono file for sounds that should come from a place in the world.' });
    } catch { throw new Error('could not be decoded as audio (corrupt, truncated or an unsupported codec).'); }
  }

  /** JSON: asset manifests, material definition files, or plain data. */
  async _importData(item, base, bytes, blobOf, result) {
    let json;
    try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new Error('is not valid JSON: ' + e.message); }
    const app = this.app;
    // material definitions
    const mats = json.materials && (Array.isArray(json.materials) ? json.materials : Object.values(json.materials));
    if (mats && json.format !== 'saint-marrow-studio-asset-manifest') {
      const next = { ...app.project.data.materials };
      for (const m of mats) { const id = `mat_${slug(m.name || 'imported')}_${uid('m').slice(-4)}`; next[id] = { ...defaultMaterial(m.name), ...m, preset: false }; result.materialsAdded++; }
      app.history.exec(setData(['materials'], next, { label: 'Import materials' }));
      return null;
    }
    // asset manifest: [{name, kind, path|url, license}] -> resolve against dropped files
    if (Array.isArray(json.assets)) {
      for (const a of json.assets) {
        const p = a.path || a.url;
        if (!p) { result.warnings.push({ path: item.path, message: `Manifest entry "${a.name || '?'}" has no path.` }); continue; }
        if (/^https?:/i.test(p)) { result.warnings.push({ path: item.path, message: `Manifest entry "${a.name || p}" points to an external URL. Downloads are blocked for safety — download it yourself, check its licence, and drop the file here.` }); continue; }
        const rel = resolvePath(dirName(item.path), p);
        if (!blobOf.has(rel)) result.warnings.push({ path: item.path, message: `Manifest entry "${a.name || p}" refers to "${rel}" which was not included in the drop.` });
      }
      result.warnings.push({ path: item.path, message: 'Manifest read. Files it lists are imported when they are dropped together with it.' });
      return null;
    }
    base.kind = 'data'; base.format = 'json';
    return base;
  }
}

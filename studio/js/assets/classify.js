// DOM-free file classification and dependency analysis for the import pipeline (unit-testable in Node).

export const MODEL_EXT = ['glb', 'gltf', 'obj', 'fbx'];
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'ktx2'];
export const AUDIO_EXT = ['wav', 'mp3', 'ogg'];
export const DATA_EXT = ['json'];
const UNSUPPORTED_HELP = {
  blend: 'Blender files cannot be read directly — in Blender use File ▸ Export ▸ glTF 2.0 (.glb).',
  max: '3ds Max files cannot be read directly — export to glTF/GLB or FBX.',
  '3ds': '.3ds is not supported — convert to glTF/GLB, OBJ or FBX.',
  dae: 'Collada (.dae) is not supported — convert to glTF/GLB.',
  stl: '.stl is not supported — convert to OBJ or glTF/GLB.',
  psd: 'Photoshop files are not supported — export PNG, JPG or WebP.',
  tga: 'TGA textures are not supported — convert to PNG or WebP.',
  bmp: 'BMP images are not supported — convert to PNG.',
  gif: 'GIF images are not supported — use PNG/WebP (sprite sheets are images with rows × cols).',
  mp4: 'Video files are not supported.', flac: 'FLAC is not supported — convert to WAV, OGG or MP3.', m4a: 'M4A/AAC is not supported — convert to MP3 or OGG.',
  zip: 'Archives are not opened here — extract the pack and drop the folder (or use File ▸ Open project bundle for .smproj files).',
  smproj: 'This is a Studio project bundle — use File ▸ Open project.',
};

export const extOf = (name) => { const m = /\.([^.\\/]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; };
export const baseName = (p) => (p || '').split(/[\\/]/).pop();
export const dirName = (p) => { const parts = (p || '').split(/[\\/]/); parts.pop(); return parts.join('/'); };
export const stem = (name) => baseName(name).replace(/\.[^.]+$/, '');

export function kindOfExt(ext) {
  if (MODEL_EXT.includes(ext)) return 'model';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (DATA_EXT.includes(ext)) return 'data';
  return null;
}

/** Normalise "./a/../b" style relative references. */
export function resolvePath(fromDir, ref) {
  if (/^(https?:|data:|blob:)/i.test(ref)) return ref;
  const parts = (fromDir ? fromDir.split('/') : []).filter(Boolean);
  for (const seg of decodeURIComponent(ref).split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}

/** glTF JSON: external files it needs. Returns [{path, kind:'buffer'|'image'}]. */
export function gltfDependencies(json, gltfPath) {
  const dir = dirName(gltfPath);
  const out = [];
  for (const b of json.buffers || []) if (b.uri && !/^data:/i.test(b.uri)) out.push({ path: resolvePath(dir, b.uri), kind: 'buffer' });
  for (const i of json.images || []) if (i.uri && !/^data:/i.test(i.uri)) out.push({ path: resolvePath(dir, i.uri), kind: 'image' });
  return out;
}

/** OBJ: material library files; MTL: texture maps. */
export function objDependencies(text, objPath) {
  const dir = dirName(objPath);
  const out = [];
  for (const line of text.split(/\r?\n/)) { const m = /^\s*mtllib\s+(.+)$/.exec(line); if (m) out.push({ path: resolvePath(dir, m[1].trim()), kind: 'mtl' }); }
  return out;
}
export function mtlDependencies(text, mtlPath) {
  const dir = dirName(mtlPath);
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:map_Kd|map_Ks|map_Ka|map_Bump|map_bump|bump|map_d|map_Ns|norm)\s+(?:-\S+\s+(?:\S+\s+)*)?(\S+)\s*$/.exec(line);
    if (m) out.push({ path: resolvePath(dir, m[1]), kind: 'image' });
  }
  return out;
}

/** Inspect the first bytes of a GLB. Returns {ok, error?, version?, json?}. */
export function inspectGlb(bytes) {
  const dv = new DataView(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
  if (dv.byteLength < 20) return { ok: false, error: 'The file is too small to be a GLB (it may be truncated).' };
  if (dv.getUint32(0, true) !== 0x46546c67) return { ok: false, error: 'Not a valid GLB: the "glTF" header is missing. The file may be corrupt, renamed, or a .gltf (JSON) file with the wrong extension.' };
  const version = dv.getUint32(4, true);
  if (version !== 2) return { ok: false, error: `Unsupported glTF version ${version}; only glTF 2.0 is supported.` };
  const total = dv.getUint32(8, true);
  if (total > dv.byteLength) return { ok: false, error: `The GLB is truncated: header says ${total} bytes but only ${dv.byteLength} were read.` };
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) return { ok: false, error: 'The GLB has no JSON chunk.' };
  try {
    const text = new TextDecoder().decode(new Uint8Array(dv.buffer, 20, jsonLen));
    const json = JSON.parse(text);
    return { ok: true, version, json };
  } catch (e) { return { ok: false, error: 'The GLB JSON chunk is not valid JSON: ' + e.message }; }
}

/** Extensions glTF files require that this viewer can/cannot decode. */
export function gltfExtensionSupport(json) {
  const used = json.extensionsRequired || [];
  const unsupported = [];
  const supported = ['KHR_materials_pbrSpecularGlossiness', 'KHR_draco_mesh_compression', 'KHR_texture_basisu', 'KHR_mesh_quantization', 'EXT_meshopt_compression', 'KHR_texture_transform', 'KHR_materials_emissive_strength', 'KHR_materials_unlit', 'KHR_lights_punctual', 'EXT_texture_webp', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_sheen', 'KHR_materials_volume', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion', 'EXT_texture_avif'];
  for (const e of used) if (!supported.includes(e)) unsupported.push(e);
  return { required: used, unsupported };
}

/**
 * Plan an import from a list of {path, size}. Groups files into primary assets and records dependencies.
 * `readText(path)` is only needed for .gltf/.obj/.mtl dependency discovery.
 * Returns { items:[{kind, path, files:[paths], ext}], errors:[{path,message}], warnings:[{path,message}] }
 */
export async function planImport(files, readText) {
  const byPath = new Map(files.map((f) => [f.path.replace(/\\/g, '/'), f]));
  const items = [], errors = [], warnings = [];
  const claimed = new Set();
  const findByBase = (p) => { if (byPath.has(p)) return p; const b = baseName(p).toLowerCase(); for (const k of byPath.keys()) if (baseName(k).toLowerCase() === b) return k; return null; };

  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    const ext = extOf(path);
    if (ext === 'gltf') {
      let json;
      try { json = JSON.parse(await readText(path)); } catch (e) { errors.push({ path, message: `"${baseName(path)}" is not valid glTF JSON: ${e.message}` }); continue; }
      const deps = gltfDependencies(json, path);
      const present = [path];
      for (const d of deps) {
        const hit = findByBase(d.path);
        if (hit) { present.push(hit); claimed.add(hit); } else warnings.push({ path, message: `"${baseName(path)}" references "${d.path}" which was not included. Drop the whole folder or add the missing file; the model will load without it.` });
      }
      const ext2 = gltfExtensionSupport(json);
      if (ext2.unsupported.length) warnings.push({ path, message: `Uses glTF extensions this viewer cannot decode: ${ext2.unsupported.join(', ')}.` });
      items.push({ kind: 'model', ext, path, files: present });
      claimed.add(path);
    } else if (ext === 'obj') {
      let text = ''; try { text = await readText(path); } catch { /* ignore */ }
      const present = [path];
      for (const d of objDependencies(text, path)) {
        const hit = findByBase(d.path);
        if (!hit) { warnings.push({ path, message: `OBJ references material library "${d.path}" which was not included; the model will be grey.` }); continue; }
        present.push(hit); claimed.add(hit);
        let mtl = ''; try { mtl = await readText(hit); } catch { /* ignore */ }
        for (const t of mtlDependencies(mtl, hit)) {
          const th = findByBase(t.path);
          if (th) { present.push(th); claimed.add(th); } else warnings.push({ path, message: `Material "${baseName(hit)}" references texture "${t.path}" which was not included.` });
        }
      }
      items.push({ kind: 'model', ext, path, files: present }); claimed.add(path);
    } else if (ext === 'glb' || ext === 'fbx') {
      items.push({ kind: 'model', ext, path, files: [path] }); claimed.add(path);
    }
  }
  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    if (claimed.has(path)) continue;
    const ext = extOf(path);
    const kind = kindOfExt(ext);
    if (ext === 'mtl' || ext === 'bin') { warnings.push({ path, message: `"${baseName(path)}" was not used by any model that was imported with it.` }); continue; }
    if (!kind) { errors.push({ path, message: UNSUPPORTED_HELP[ext] || `Unsupported file type ".${ext}" ("${baseName(path)}"). Supported: GLB, glTF, OBJ, FBX, PNG, JPG, WebP, KTX2, WAV, MP3, OGG, JSON.` }); continue; }
    items.push({ kind, ext, path, files: [path] });
  }
  return { items, errors, warnings };
}

/** Group dropped files by kind for the confirmation dialog: { Models: [names], Textures: [...], ... } */
export function classifyForDisplay(files) {
  const out = {};
  const names = { model: 'Models', image: 'Textures', audio: 'Audio', data: 'Data', other: 'Other (will be ignored unless referenced)' };
  for (const f of files) {
    const k = kindOfExt(extOf(f.path));
    const key = names[k] || names.other;
    (out[key] = out[key] || []).push(baseName(f.path));
  }
  return out;
}

// Built-in asset library: read-only references to the original game's CC0 (Poly Haven) models and textures.
// Nothing is copied: ids look like "builtin:model/old_bed_frame" and resolve to files under ../saint-marrow/assets.

let LIB = { models: {}, textures: {} };

export function setBuiltinLibrary(lib) { LIB = { models: lib?.models || {}, textures: lib?.textures || {}, license: lib?.license, generated: lib?.generated }; }
export function getBuiltinLibrary() { return LIB; }
export function builtinMeta(id) { return LIB.models[id] || LIB.textures[id] || null; }
export const isBuiltinId = (id) => typeof id === 'string' && id.startsWith('builtin:');
export function builtinModelId(name) { return `builtin:model/${name}`; }
export function builtinTexId(name) { return `builtin:tex/${name}`; }

/** Look up asset metadata: project assets first, then the built-in library. */
export function makeAssetLookup(projectAssets) {
  return new Proxy({}, {
    get: (_, id) => (typeof id === 'string' ? projectAssets[id] || builtinMeta(id) || undefined : undefined),
    has: (_, id) => typeof id === 'string' && !!(projectAssets[id] || builtinMeta(id)),
  });
}

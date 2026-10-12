// Material library: built-in texture recipes + user textures (Texture Studio).
// Generates PBR textures on demand and caches the THREE materials.
import * as THREE from 'three';
import { generateTexture, normalizeRecipe, initTexGen } from './texgen.js';
import { preset, store, settings } from '../core/settings.js';
import { hasTex, loadTexture, textureAverage } from '../assets/loader.js';

export const BUILTIN_RECIPES = {
  sand: { name: 'Desert Sand', photo: 'sand', tint: '#fff0d6', tile: 3, color1: '#dcc29a', color2: '#c4a476', noiseScale: 3, noiseAmt: 0.5, detail: 0.6, grime: 0.12, grimeColor: '#a88a63', grimeScale: 2, spots: 0.25, spotColor: '#b99a70', spotScale: 9, rough: 0.96, roughVar: 0.04, bump: 1.6, seed: 3 },
  sandstone: { name: 'Sandstone Blocks', photo: 'sandstone', tile: 3, color1: '#d2b78d', color2: '#b8976c', pattern: 'bricks', rows: 7, cols: 3, offset: 0.43, gap: 0.011, gapColor: '#a08a68', bevel: 0.02, cellVar: 0.45, chip: 0.8, noiseScale: 7, noiseAmt: 0.5, detail: 0.55, grime: 0.28, grimeColor: '#8a6e4e', grimeScale: 3, streaks: 0.25, cracks: 0.3, spots: 0.12, spotColor: '#e2d0ae', spotScale: 9, rough: 0.92, roughVar: 0.06, bump: 1.25, seed: 5 },
  plaster: { name: 'Plaster (cream)', photo: 'plaster', tile: 2, color1: '#e6d6b6', color2: '#d4c09a', noiseScale: 3, noiseAmt: 0.55, detail: 0.35, grime: 0.32, grimeColor: '#9c8463', grimeScale: 3, streaks: 0.35, cracks: 0.5, spots: 0.15, spotColor: '#c9b28c', spotScale: 6, rough: 0.92, roughVar: 0.06, bump: 0.9, seed: 7 },
  plaster_ochre: { name: 'Plaster (ochre)', photo: 'plaster_ochre', tile: 1.8, color1: '#d9a46a', color2: '#c48a4e', noiseScale: 3, noiseAmt: 0.6, detail: 0.35, grime: 0.3, grimeColor: '#7d5a3a', grimeScale: 3, streaks: 0.4, cracks: 0.45, spots: 0.2, spotColor: '#e3c193', spotScale: 5, rough: 0.92, roughVar: 0.06, bump: 0.9, seed: 9 },
  plaster_blue: { name: 'Plaster (faded blue)', photo: 'plaster_blue', tile: 2, color1: '#7fa4b8', color2: '#a3b9c2', noiseScale: 3, noiseAmt: 0.7, detail: 0.35, grime: 0.3, grimeColor: '#6d6656', grimeScale: 3, streaks: 0.4, cracks: 0.4, spots: 0.12, spotColor: '#d8ccb0', spotScale: 3, rough: 0.9, roughVar: 0.08, bump: 0.9, seed: 11 },
  pavers: { name: 'Stone Pavers', photo: 'pavers', tint: '#f6d9b4', tile: 2, color1: '#c9b493', color2: '#ae9a7b', pattern: 'cobble', cols: 7, gap: 0.022, gapColor: '#9a8564', bevel: 0.045, cellVar: 0.3, jitter: 0.9, chip: 0.4, noiseScale: 5, noiseAmt: 0.4, detail: 0.45, grime: 0.22, grimeColor: '#86735a', grimeScale: 4, rough: 0.9, roughVar: 0.06, bump: 1.05, seed: 13 },
  tiles: { name: 'Floor Tiles', photo: 'tiles', tint: '#f7e2c4', tile: 1.2, color1: '#c7b08c', color2: '#b59a74', pattern: 'tiles', rows: 5, cols: 5, gap: 0.012, gapColor: '#8a7a64', bevel: 0.01, cellVar: 0.3, chip: 0.5, noiseScale: 5, noiseAmt: 0.35, detail: 0.3, grime: 0.3, grimeColor: '#7d6a50', grimeScale: 4, cracks: 0.3, rough: 0.7, roughVar: 0.15, bump: 1.0, seed: 15 },
  concrete: { name: 'Concrete', photo: 'concrete', tint: '#f3e6d3', tile: 2, color1: '#bdb2a0', color2: '#a69a86', noiseScale: 4, noiseAmt: 0.5, detail: 0.5, grime: 0.35, grimeColor: '#6e675c', grimeScale: 3, streaks: 0.3, cracks: 0.35, spots: 0.2, spotColor: '#8d877c', spotScale: 14, rough: 0.9, roughVar: 0.08, bump: 1.1, seed: 17 },
  wood: { name: 'Wood Planks', photo: 'wood', tile: 1.8, color1: '#8a6240', color2: '#6e4b2e', pattern: 'planks', rows: 2, cols: 6, gap: 0.012, gapColor: '#2e2116', bevel: 0.01, cellVar: 0.4, chip: 0.3, noiseScale: 4, noiseAmt: 0.4, detail: 0.3, grain: 0.9, grime: 0.25, grimeColor: '#3d2d1f', grimeScale: 3, rough: 0.78, roughVar: 0.12, bump: 1.2, seed: 19 },
  crate: { name: 'Crate Wood', photo: 'crate', tile: 1.4, color1: '#b08a5a', color2: '#93704a', pattern: 'planks', rows: 1, cols: 5, gap: 0.014, gapColor: '#3a2a1a', bevel: 0.012, cellVar: 0.3, chip: 0.3, noiseScale: 4, noiseAmt: 0.35, detail: 0.3, grain: 0.8, grime: 0.2, grimeColor: '#5a4630', grimeScale: 3, rough: 0.8, roughVar: 0.1, bump: 1.2, seed: 21 },
  metal: { name: 'Painted Metal', photo: 'metal', tile: 1, color1: '#56636a', color2: '#4a565c', pattern: 'panels', rows: 2, cols: 2, gap: 0.006, gapColor: '#262b2e', bevel: 0.006, cellVar: 0.15, chip: 0.2, noiseScale: 4, noiseAmt: 0.4, detail: 0.3, edgeWear: 0.55, wearColor: '#9a7a5a', grime: 0.35, grimeColor: '#6a4a2c', grimeScale: 4, streaks: 0.4, rough: 0.6, roughVar: 0.2, metal: 0.35, bump: 0.9, seed: 23 },
  rust: { name: 'Rusty Metal', photo: 'rust', tile: 1, color1: '#7a4a2c', color2: '#5a3520', noiseScale: 5, noiseAmt: 0.8, detail: 0.6, grime: 0.4, grimeColor: '#3a2416', grimeScale: 4, spots: 0.4, spotColor: '#a0603a', spotScale: 10, rough: 0.85, roughVar: 0.15, metal: 0.3, bump: 1.5, seed: 25 },
  roof: { name: 'Clay Roof Tiles', photo: 'roof', tile: 2.5, color1: '#b5643c', color2: '#9a4e2e', pattern: 'bricks', rows: 8, cols: 6, offset: 0.5, gap: 0.01, gapColor: '#5a3220', bevel: 0.03, cellVar: 0.4, chip: 0.4, noiseScale: 4, noiseAmt: 0.4, detail: 0.3, grime: 0.3, grimeColor: '#4a3020', grimeScale: 3, rough: 0.8, roughVar: 0.1, bump: 1.6, seed: 27 },
  cloth_red: { name: 'Awning Red', tile: 2, color1: '#a8332a', color2: '#92281f', noiseScale: 3, noiseAmt: 0.4, detail: 0.6, stripes: 1, stripeColor: '#e8dcc4', stripeCount: 4, grime: 0.3, grimeColor: '#5a3a28', grimeScale: 3, streaks: 0.3, rough: 0.95, roughVar: 0.03, bump: 0.5, seed: 29 },
  cloth_blue: { name: 'Awning Blue', tile: 2, color1: '#2f5f86', color2: '#27506f', noiseScale: 3, noiseAmt: 0.4, detail: 0.6, stripes: 1, stripeColor: '#e8dcc4', stripeCount: 3, grime: 0.3, grimeColor: '#4a4030', grimeScale: 3, streaks: 0.3, rough: 0.95, roughVar: 0.03, bump: 0.5, seed: 31 },
  dark: { name: 'Dark Interior', tile: 2, color1: '#1d1914', color2: '#14110d', noiseScale: 3, noiseAmt: 0.3, detail: 0.2, grime: 0, rough: 0.95, roughVar: 0.02, bump: 0.3, seed: 33 },
  door: { name: 'Painted Door', photo: 'door', tile: 1.0, color1: '#3a6f72', color2: '#2f5e60', pattern: 'planks', rows: 1, cols: 5, gap: 0.01, gapColor: '#1f2a28', bevel: 0.01, cellVar: 0.25, chip: 0.5, noiseScale: 4, noiseAmt: 0.4, detail: 0.3, edgeWear: 0.7, wearColor: '#8a6a48', grain: 0.4, grime: 0.3, grimeColor: '#3e3626', grimeScale: 3, rough: 0.75, roughVar: 0.15, bump: 1.0, seed: 35 },
  clay: { name: 'Terracotta', tile: 1.5, color1: '#b86a42', color2: '#a35a36', noiseScale: 4, noiseAmt: 0.5, detail: 0.5, grime: 0.3, grimeColor: '#6d4a32', grimeScale: 3, spots: 0.2, spotColor: '#d8b896', spotScale: 8, rough: 0.85, roughVar: 0.1, bump: 0.8, seed: 37 },
  bark: { name: 'Palm Bark', tile: 1.2, color1: '#7a6248', color2: '#5e4a36', pattern: 'bricks', rows: 10, cols: 3, offset: 0.5, gap: 0.03, gapColor: '#3a2c1f', bevel: 0.04, cellVar: 0.3, chip: 0.7, noiseScale: 4, noiseAmt: 0.5, detail: 0.6, grime: 0.2, grimeColor: '#3a2c1f', grimeScale: 4, rough: 0.92, roughVar: 0.05, bump: 2.0, seed: 39 },
  sandstone_white: { name: 'White Sandstone', photo: 'sandstone_white', tile: 2, color1: '#e4d8c2', color2: '#d1c3a8', pattern: 'bricks', rows: 6, cols: 3, gap: 0.01, gapColor: '#b8a98e', bevel: 0.02, cellVar: 0.3, rough: 0.9, bump: 1.1, seed: 43 },
  sandbag: { name: 'Sandbag Cloth', tile: 1, color1: '#a89670', color2: '#968460', noiseScale: 6, noiseAmt: 0.4, detail: 0.9, grime: 0.35, grimeColor: '#6a5a40', grimeScale: 4, rough: 0.97, roughVar: 0.02, bump: 1.2, seed: 41 },
};

// procedural textures used only by guns/arms (not in map palette)
const GEAR_RECIPES = {
  gunmetal: { tile: 0.25, color1: '#62666c', color2: '#55595e', noiseScale: 6, noiseAmt: 0.5, detail: 0.5, grime: 0.15, grimeColor: '#1e1f22', grimeScale: 5, rough: 0.42, roughVar: 0.12, metal: 0.9, bump: 0.35, seed: 101 },
  polymer: { tile: 0.2, color1: '#26282b', color2: '#202225', noiseScale: 8, noiseAmt: 0.3, detail: 1.0, grime: 0.1, grimeColor: '#18191b', grimeScale: 5, rough: 0.7, roughVar: 0.1, metal: 0, bump: 0.6, seed: 103 },
  gunwood: { tile: 0.35, color1: '#8f5530', color2: '#6a3a1c', pattern: 'none', noiseScale: 3, noiseAmt: 0.5, detail: 0.2, grain: 1.0, grime: 0.15, grimeColor: '#2a160c', grimeScale: 4, rough: 0.42, roughVar: 0.12, bump: 0.6, seed: 105 },
  grip: { tile: 0.08, color1: '#2a2c2f', color2: '#232528', pattern: 'tiles', rows: 10, cols: 10, gap: 0.03, gapColor: '#151617', bevel: 0.03, cellVar: 0.05, chip: 0, noiseScale: 4, noiseAmt: 0.2, detail: 0.3, rough: 0.75, roughVar: 0.05, bump: 1.4, seed: 107 },
  fabric: { tile: 0.25, color1: '#5d6650', color2: '#4f5844', noiseScale: 6, noiseAmt: 0.5, detail: 1.0, grime: 0.25, grimeColor: '#3a3e30', grimeScale: 4, rough: 0.95, roughVar: 0.03, bump: 1.4, seed: 109 },
  glove: { tile: 0.12, color1: '#2b2a28', color2: '#24231f', noiseScale: 8, noiseAmt: 0.4, detail: 1.0, grime: 0.15, grimeColor: '#4a4436', grimeScale: 4, rough: 0.72, roughVar: 0.12, bump: 1.0, seed: 111 },
  bakelite: { tile: 0.2, color1: '#7c3a1e', color2: '#652d16', noiseScale: 5, noiseAmt: 0.6, detail: 0.4, grime: 0.2, grimeColor: '#2a120a', grimeScale: 5, rough: 0.38, roughVar: 0.12, metal: 0, bump: 0.4, seed: 115 },
  polymer_olive: { tile: 0.2, color1: '#4d5340', color2: '#454a39', noiseScale: 8, noiseAmt: 0.3, detail: 1.0, grime: 0.15, grimeColor: '#2e3126', grimeScale: 5, rough: 0.72, roughVar: 0.1, metal: 0, bump: 0.6, seed: 117 },
  polymer_tan: { tile: 0.2, color1: '#a08a68', color2: '#93805f', noiseScale: 8, noiseAmt: 0.3, detail: 1.0, grime: 0.18, grimeColor: '#5a4c38', grimeScale: 5, rough: 0.7, roughVar: 0.1, metal: 0, bump: 0.6, seed: 119 },
  blade: { tile: 0.2, color1: '#b9bec4', color2: '#a6abb2', noiseScale: 12, noiseAmt: 0.3, detail: 0.2, grime: 0.05, grimeColor: '#6a6e74', grimeScale: 6, rough: 0.22, roughVar: 0.08, metal: 1.0, bump: 0.2, seed: 113 },
};

// Baked per-vertex lighting from the map builder: ao.x = contact occlusion,
// ao.y = sky visibility. Where the sky is blocked (under roofs, arches) the
// ambient light becomes warm bounce light from the sunlit ground instead of
// blue sky light -> cheap fake global illumination.
// Also breaks up texture tiling (macro variation from a second, larger-scale
// sample + world-space noise) and adds wind-blown sand dust at wall bottoms.
export const BOUNCE = { value: new THREE.Color(0.32, 0.25, 0.17) };
export const DUST = { value: new THREE.Color(0.62, 0.5, 0.36) };
const NOISE_GLSL = `
float spHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float spNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(spHash(i), spHash(i + vec2(1.0, 0.0)), f.x), mix(spHash(i + vec2(0.0, 1.0)), spHash(i + vec2(1.0, 1.0)), f.x), f.y); }`;
export function patchBakedAO(mat, opts = {}) {
  const macroAvg = { value: opts.macroAvg || 0.25 };
  const dust = { value: opts.dust ?? 1 };
  mat.userData.macroAvg = macroAvg; mat.userData.dustAmt = dust;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBounce = BOUNCE; sh.uniforms.uDust = DUST; sh.uniforms.uMacroAvg = macroAvg; sh.uniforms.uDustAmt = dust;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 ao;\nvarying vec2 vBakedAO;\nvarying vec3 vWorldP;\nvarying vec3 vWorldN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBakedAO = ao;\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBakedAO;\nvarying vec3 vWorldP;\nvarying vec3 vWorldN;\nuniform vec3 uBounce;\nuniform vec3 uDust;\nuniform float uMacroAvg;\nuniform float uDustAmt;' + NOISE_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
          vec3 macroS = texture2D(map, vMapUv * 0.217 + vec2(0.37, 0.71)).rgb;
          float macroL = dot(macroS, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb *= clamp(mix(1.0, macroL / max(uMacroAvg, 0.02), 0.32), 0.6, 1.5);
        #endif
        float mN = spNoise(vWorldP.xz * 0.11 + vWorldP.y * 0.07) * 0.65 + spNoise(vWorldP.xz * 0.37 + 7.0) * 0.35;
        diffuseColor.rgb *= mix(0.84, 1.1, mN);
        float wallMask = 1.0 - abs(vWorldN.y);
        float dustH = smoothstep(1.1 + mN * 0.6, 0.0, vWorldP.y) * wallMask + (vWorldN.y > 0.5 ? 0.12 * mN : 0.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uDust * (0.85 + 0.3 * mN), clamp(dustH * 0.42 * uDustAmt, 0.0, 0.6));`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        float bao = clamp(vBakedAO.x, 0.0, 1.0);
        float bsky = clamp(vBakedAO.y, 0.0, 1.0);
        vec3 bounceL = uBounce * diffuseColor.rgb * (1.0 - bsky) * bao;
        reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse * bao * (0.3 + 0.7 * bsky) + bounceL;
        reflectedLight.indirectSpecular *= mix(1.0, bao * (0.35 + 0.65 * bsky), 0.85);
        reflectedLight.directDiffuse *= mix(1.0, bao, 0.4);
        reflectedLight.directSpecular *= mix(1.0, bao, 0.4);`);
  };
  mat.customProgramCacheKey = () => 'bakedAO3';
  return mat;
}

class MaterialLibrary {
  constructor() {
    this.custom = store.get('textures', {}); // id -> recipe
    this.texCache = new Map(); // key -> {albedo,normal,orm} THREE textures
    this.matCache = new Map();
    this.listeners = new Set();
  }
  ids() { return [...Object.keys(BUILTIN_RECIPES), ...Object.keys(this.custom)]; }
  recipe(id) { return this.custom[id] || BUILTIN_RECIPES[id] || GEAR_RECIPES[id] || BUILTIN_RECIPES.concrete; }
  isCustom(id) { return !!this.custom[id]; }
  tileOf(id) { return normalizeRecipe(this.recipe(id)).tile; }
  saveCustom(id, recipe) {
    this.custom[id] = recipe;
    store.set('textures', this.custom);
    this.invalidate(id);
  }
  deleteCustom(id) { delete this.custom[id]; store.set('textures', this.custom); this.invalidate(id); }
  init(renderer) { initTexGen(renderer); }
  invalidate(id) {
    for (const k of [...this.texCache.keys()]) if (k.startsWith(id + '@')) {
      const t = this.texCache.get(k); t.rts.forEach((rt) => rt.dispose()); this.texCache.delete(k);
    }
    for (const k of [...this.matCache.keys()]) if (k.startsWith(id + '@') || k.startsWith(id + '|')) this.matCache.delete(k);
    this.listeners.forEach((f) => f(id));
  }

  isPhoto(id) { const r = this.recipe(id); return !!(r.photo && hasTex(r.photo)); }
  async textures(id, size) {
    const S = size || preset().texSize;
    const key = id + '@' + S;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const r = this.recipe(id);
    if (r.photo && hasTex(r.photo)) {
      const sz = size ? Math.min(1024, size) : ({ low: 256, medium: 512, high: 1024, ultra: 1024 }[settings.quality] || 512);
      const opts = { size: sz, aniso: preset().aniso };
      const [albedo, normal, orm] = await Promise.all([loadTexture(r.photo, 'diff', opts), loadTexture(r.photo, 'nor', opts), loadTexture(r.photo, 'arm', { ...opts, size: Math.min(512, sz) })]);
      const avg = await textureAverage(r.photo);
      const tex = { albedo, normal, orm, rts: [], size: sz, photo: true, avg: Math.pow(avg, 2.2) };
      this.texCache.set(key, tex);
      return tex;
    }
    const g = await generateTexture(r, S, preset().aniso);
    const tex = {
      albedo: g.albedoRT.texture, normal: g.normalRT.texture, orm: g.ormRT.texture,
      rts: [g.albedoRT, g.normalRT, g.ormRT], size: S,
    };
    this.texCache.set(key, tex);
    return tex;
  }

  // Map surface material (uses baked AO attribute)
  async mapMaterial(id) {
    const key = id + '|map@' + preset().texSize;
    if (this.matCache.has(key)) return this.matCache.get(key);
    const t = await this.textures(id);
    const r = normalizeRecipe(this.recipe(id));
    const m = new THREE.MeshStandardMaterial({
      map: t.albedo, normalMap: t.normal, roughnessMap: t.orm, metalnessMap: t.orm,
      roughness: r.roughMul ?? 1, metalness: 1, normalScale: new THREE.Vector2(r.normalScale ?? 1, r.normalScale ?? 1),
      side: (id.startsWith('cloth') ? THREE.DoubleSide : THREE.FrontSide),
    });
    if (t.photo) { m.aoMap = t.orm; m.aoMapIntensity = 0.85; if (r.tint) m.color.set(r.tint); }
    m.name = id;
    m.userData.tile = r.tile;
    patchBakedAO(m, { macroAvg: t.avg || 0.25, dust: id === 'sand' || id === 'dark' || id.startsWith('cloth') ? 0 : 1 });
    this.matCache.set(key, m);
    return m;
  }

  // Gear material for guns / arms (no baked AO). opts override color etc.
  async gearMaterial(id, opts = {}) {
    const key = id + '|gear|' + JSON.stringify(opts);
    if (this.matCache.has(key)) return this.matCache.get(key);
    const t = await this.textures(id, Math.min(512, preset().texSize));
    const Ctor = opts.clearcoat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const m = new Ctor({
      map: t.albedo, normalMap: t.normal, roughnessMap: t.orm, metalnessMap: t.orm,
      roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 1,
      color: opts.color ? new THREE.Color(opts.color) : new THREE.Color(1, 1, 1),
      envMapIntensity: opts.env ?? 1,
    });
    if (opts.clearcoat) { m.clearcoat = opts.clearcoat; m.clearcoatRoughness = opts.clearcoatRoughness ?? 0.35; }
    if (opts.normalScale) m.normalScale.set(opts.normalScale, opts.normalScale);
    m.name = id;
    const tile = normalizeRecipe(this.recipe(id)).tile;
    m.userData.tile = tile;
    // gear geometry has UVs in meters: repeat = 1/tile
    for (const tx of [t.albedo, t.normal, t.orm]) tx.repeat.set(1 / tile, 1 / tile);
    this.matCache.set(key, m);
    return m;
  }

  onChange(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
}

export const materials = new MaterialLibrary();

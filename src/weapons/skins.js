// Weapon skins: procedural patterns evaluated in the weapon's own space by a
// shader patch, so one skin works on any model (procedural or glTF) without
// UVs. Wear (item float) reveals the base finish through scratches.
import * as THREE from 'three';

export const RARITIES = {
  common: { name: 'Common', color: '#b0c3d9', sell: 15 },
  rare: { name: 'Rare', color: '#4b69ff', sell: 40 },
  epic: { name: 'Epic', color: '#8847ff', sell: 120 },
  legendary: { name: 'Legendary', color: '#d32ce6', sell: 420 },
  arcane: { name: 'Arcane', color: '#eb4b4b', sell: 1200 },
  gold: { name: 'Gold', color: '#e4ae39', sell: 4500 },
};
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'arcane', 'gold'];

export const CONDITIONS = [
  { max: 0.07, name: 'Factory New', short: 'FN', mul: 1.5 },
  { max: 0.15, name: 'Minimal Wear', short: 'MW', mul: 1.2 },
  { max: 0.38, name: 'Field-Tested', short: 'FT', mul: 1.0 },
  { max: 0.45, name: 'Well-Worn', short: 'WW', mul: 0.85 },
  { max: 1.01, name: 'Battle-Scarred', short: 'BS', mul: 0.7 },
];
export const condition = (wear) => CONDITIONS.find((c) => wear < c.max) || CONDITIONS[4];

// pattern presets: p = pattern type, c = colors, s = scale, m = metalness, r = roughness, e = emissive amount
export const SKINS = {
  // ---------------- rifles
  rifle_sand: { name: 'Sandstorm', weapon: 'rifle', rarity: 'rare', p: 'camo', c: ['#b9a27c', '#8c7655', '#d8c7a4', '#5d4f3b'], s: 9, m: 0.1, r: 0.75 },
  rifle_tiger: { name: 'Bengal', weapon: 'rifle', rarity: 'epic', p: 'tiger', c: ['#e08a1e', '#1b1410', '#f3c46a', '#000'], s: 1.2, m: 0.3, r: 0.4 },
  rifle_neon: { name: 'Neon Rider', weapon: 'rifle', rarity: 'legendary', p: 'neon', c: ['#0d0f14', '#ff2bd6', '#2be8ff', '#000'], s: 1, m: 0.4, r: 0.35, e: 2.2 },
  rifle_fire: { name: 'Inferno', weapon: 'rifle', rarity: 'arcane', p: 'fade', c: ['#ffd23a', '#ff5a14', '#7a0a12', '#000'], s: 1, m: 0.75, r: 0.22 },
  rifle_carbon: { name: 'Carbon Weave', weapon: 'rifle', rarity: 'rare', p: 'carbon', c: ['#16181b', '#2c3036', '#000', '#000'], s: 1, m: 0.2, r: 0.3 },
  m4_urban: { name: 'Urban Grid', weapon: 'm4', rarity: 'rare', p: 'digital', c: ['#6d737a', '#41464c', '#9aa0a6', '#25292d'], s: 10, m: 0.1, r: 0.7 },
  m4_ocean: { name: 'Deep Ocean', weapon: 'm4', rarity: 'epic', p: 'marble', c: ['#0b3a6e', '#1d8fc4', '#e8f6ff', '#000'], s: 6, m: 0.5, r: 0.3 },
  m4_hyper: { name: 'Hyper Beast', weapon: 'm4', rarity: 'arcane', p: 'hyper', c: ['#5a3ab0', '#ff3d7f', '#2bffd2', '#ffd21e'], s: 5, m: 0.25, r: 0.35 },
  m4_gold: { name: 'Gilded', weapon: 'm4', rarity: 'legendary', p: 'gold', c: ['#e8b84a', '#8a5a14', '#000', '#000'], s: 6, m: 1, r: 0.18 },
  // ---------------- snipers
  sniper_web: { name: 'Crimson Web', weapon: 'sniper', rarity: 'legendary', p: 'web', c: ['#8f1414', '#0c0606', '#000', '#000'], s: 9, m: 0.2, r: 0.45 },
  sniper_dragon: { name: 'Dragon Scale', weapon: 'sniper', rarity: 'arcane', p: 'scales', c: ['#0f6b3e', '#d4b13a', '#082a1a', '#000'], s: 26, m: 0.7, r: 0.3 },
  sniper_forest: { name: 'Woodland', weapon: 'sniper', rarity: 'rare', p: 'camo', c: ['#4c5a36', '#2f3824', '#7d6e4c', '#1c2016'], s: 8, m: 0.05, r: 0.8 },
  sniper_frost: { name: 'Frostbite', weapon: 'sniper', rarity: 'epic', p: 'fade', c: ['#ffffff', '#7fd3ff', '#1a3c8a', '#000'], s: 1, m: 0.6, r: 0.25 },
  // ---------------- smg / shotgun
  smg_toxic: { name: 'Toxic', weapon: 'smg', rarity: 'epic', p: 'splatter', c: ['#1b1d1f', '#8bff2b', '#f2ff3a', '#000'], s: 14, m: 0.2, r: 0.5, e: 0.6 },
  smg_desert: { name: 'Dune', weapon: 'smg', rarity: 'rare', p: 'camo', c: ['#c8ae82', '#9d8158', '#e2d2b0', '#6e5b40'], s: 10, m: 0.1, r: 0.75 },
  smg_royal: { name: 'Royal', weapon: 'smg', rarity: 'legendary', p: 'damascus', c: ['#1d2a6b', '#d6b45a', '#0a1033', '#000'], s: 1, m: 0.8, r: 0.25 },
  shotgun_rust: { name: 'Rust Bucket', weapon: 'shotgun', rarity: 'rare', p: 'camo', c: ['#7a3e1c', '#4a2410', '#a8693a', '#2a160a'], s: 12, m: 0.5, r: 0.7 },
  shotgun_lava: { name: 'Lava Flow', weapon: 'shotgun', rarity: 'arcane', p: 'lava', c: ['#120806', '#ff4d0a', '#ffd23a', '#000'], s: 6, m: 0.2, r: 0.55, e: 2.5 },
  // ---------------- pistols
  pistol_blue: { name: 'Blue Steel', weapon: 'pistol', rarity: 'rare', p: 'casehard', c: ['#2a4f8a', '#b88a3c', '#5a6b7c', '#000'], s: 8, m: 1, r: 0.25 },
  pistol_dopp: { name: 'Doppler', weapon: 'pistol', rarity: 'legendary', p: 'doppler', c: ['#0b0614', '#7a2bd8', '#ff3da6', '#3dd2ff'], s: 7, m: 0.9, r: 0.15 },
  pistol_candy: { name: 'Candy Apple', weapon: 'pistol', rarity: 'rare', p: 'solid', c: ['#c4161c', '#000', '#000', '#000'], s: 1, m: 0.35, r: 0.25 },
  deagle_gold: { name: 'Golden Eagle', weapon: 'deagle', rarity: 'arcane', p: 'gold', c: ['#f2c14e', '#a06a18', '#000', '#000'], s: 5, m: 1, r: 0.14 },
  deagle_marble: { name: 'Marble', weapon: 'deagle', rarity: 'epic', p: 'marble', c: ['#e9e6df', '#9a948a', '#2a2622', '#000'], s: 7, m: 0.2, r: 0.2 },
  deagle_camo: { name: 'Night Ops', weapon: 'deagle', rarity: 'rare', p: 'digital', c: ['#2b2f36', '#191c21', '#3f454e', '#0d0f12'], s: 12, m: 0.1, r: 0.6 },
  // ---------------- knives (gold rarity: the knife itself is the drop)
  karambit_fade: { name: 'Fade', weapon: 'karambit', rarity: 'gold', p: 'fade', c: ['#ffe14a', '#ff4fb0', '#6a3bff', '#000'], s: 1, m: 0.95, r: 0.12 },
  karambit_dopp: { name: 'Doppler', weapon: 'karambit', rarity: 'gold', p: 'doppler', c: ['#06040c', '#ff2b7a', '#6a2bff', '#2bc8ff'], s: 9, m: 0.95, r: 0.1 },
  karambit_tiger: { name: 'Tiger Tooth', weapon: 'karambit', rarity: 'gold', p: 'tiger', c: ['#ffb31a', '#6a3a08', '#ffe08a', '#000'], s: 2.4, m: 1, r: 0.12 },
  butterfly_marble: { name: 'Marble Fade', weapon: 'butterfly', rarity: 'gold', p: 'marble', c: ['#ff2a2a', '#2a4dff', '#ffd84a', '#000'], s: 9, m: 0.95, r: 0.1 },
  butterfly_web: { name: 'Crimson Web', weapon: 'butterfly', rarity: 'gold', p: 'web', c: ['#9a1212', '#120404', '#000', '#000'], s: 14, m: 0.6, r: 0.25 },
  butterfly_damascus: { name: 'Damascus Steel', weapon: 'butterfly', rarity: 'gold', p: 'damascus', c: ['#8a9096', '#d8dde2', '#3c4146', '#000'], s: 1, m: 1, r: 0.2 },
  m9_dopp: { name: 'Doppler', weapon: 'm9', rarity: 'gold', p: 'doppler', c: ['#060408', '#2bff9a', '#2b6bff', '#d22bff'], s: 9, m: 0.95, r: 0.1 },
  m9_blue: { name: 'Blue Steel', weapon: 'm9', rarity: 'gold', p: 'casehard', c: ['#244a9a', '#c79a44', '#6a7a8c', '#000'], s: 12, m: 1, r: 0.18 },
  m9_vanilla: { name: 'Vanilla', weapon: 'm9', rarity: 'gold', p: 'none', c: ['#000', '#000', '#000', '#000'], s: 1, m: 1, r: 0.2 },
  karambit_vanilla: { name: 'Vanilla', weapon: 'karambit', rarity: 'gold', p: 'none', c: ['#000', '#000', '#000', '#000'], s: 1, m: 1, r: 0.2 },
  butterfly_vanilla: { name: 'Vanilla', weapon: 'butterfly', rarity: 'gold', p: 'none', c: ['#000', '#000', '#000', '#000'], s: 1, m: 1, r: 0.2 },
  knife_fade: { name: 'Fade', weapon: 'knife', rarity: 'legendary', p: 'fade', c: ['#ffe14a', '#ff4fb0', '#6a3bff', '#000'], s: 1, m: 0.95, r: 0.12 },
};

// ------------------------------------------------------------------ shader
const GLSL_COMMON = /* glsl */`
uniform vec3 uSkC1, uSkC2, uSkC3, uSkC4;
uniform float uSkScale, uSkMetal, uSkRough, uSkWear, uSkSeed, uSkEmis, uSkLen;
varying vec3 vSkinP;
float skH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float skN(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(skH(i), skH(i + vec3(1,0,0)), f.x), mix(skH(i + vec3(0,1,0)), skH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(skH(i + vec3(0,0,1)), skH(i + vec3(1,0,1)), f.x), mix(skH(i + vec3(0,1,1)), skH(i + vec3(1,1,1)), f.x), f.y), f.z); }
float skF(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * skN(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
vec2 skV(vec3 p){ vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z)); vec3 o = vec3(skH(i + g), skH(i + g + 17.1), skH(i + g + 33.7));
    vec3 r = g + o - f; float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return sqrt(vec2(d1, d2)); }
`;

// each pattern writes skCol (vec3), skMet, skRou, skEm (vec3); p = weapon-space position (meters) + seed
const PATTERNS = {
  none: 'skCol = vec3(-1.0);',
  solid: 'skCol = uSkC1 * (0.9 + 0.2 * skF(p * 30.0));',
  camo: `float n = skF(p * uSkScale);
    skCol = n < 0.42 ? uSkC1 : n < 0.52 ? uSkC2 : n < 0.6 ? uSkC3 : uSkC4;
    skCol *= 0.92 + 0.16 * skN(p * 90.0);`,
  digital: `vec3 q = floor(p * uSkScale * 5.0) / (uSkScale * 5.0);
    float n = skF(q * uSkScale);
    skCol = n < 0.42 ? uSkC1 : n < 0.52 ? uSkC2 : n < 0.6 ? uSkC3 : uSkC4;`,
  tiger: `float w = sin(p.z * 60.0 * uSkScale + skF(p * 12.0 * uSkScale) * 9.0 + p.y * 30.0);
    float st = smoothstep(0.35, 0.6, w);
    skCol = mix(mix(uSkC1, uSkC3, skF(p * 20.0)), uSkC2, st);`,
  fade: `float t = clamp(-p.z / uSkLen + 0.5 + (skF(p * 6.0) - 0.5) * 0.15, 0.0, 1.0);
    skCol = t < 0.5 ? mix(uSkC1, uSkC2, t * 2.0) : mix(uSkC2, uSkC3, t * 2.0 - 1.0);`,
  marble: `float w = skF(p * uSkScale + skF(p * uSkScale * 2.0) * 3.0);
    skCol = mix(uSkC1, uSkC2, smoothstep(0.35, 0.65, w));
    skCol = mix(skCol, uSkC3, smoothstep(0.035, 0.0, abs(w - 0.5)) * 0.9);`,
  doppler: `float w = skF(p * uSkScale + skF(p * uSkScale * 1.7) * 2.5);
    skCol = mix(uSkC1, uSkC2, smoothstep(0.42, 0.7, w));
    skCol = mix(skCol, uSkC3, smoothstep(0.55, 0.8, skF(p * uSkScale * 0.7 + 5.0)));
    skCol = mix(skCol, uSkC4, smoothstep(0.62, 0.85, skF(p * uSkScale * 1.3 + 9.0)) * 0.7);
    float sp = skH(floor(p * 900.0)); skCol += vec3(step(0.992, sp)) * 1.5;`,
  carbon: `float u = p.z * 260.0, v = (p.x + p.y) * 260.0;
    float cell = mod(floor(u) + floor(v), 2.0);
    float fib = cell > 0.5 ? fract(u) : fract(v);
    skCol = mix(uSkC1, uSkC2, 0.5 + 0.5 * sin(fib * 6.2831));`,
  web: `vec2 d = skV(p * uSkScale);
    float e = smoothstep(0.06, 0.02, d.y - d.x);
    float ring = smoothstep(0.03, 0.0, abs(fract(length(p.zy * uSkScale * 1.2)) - 0.5) - 0.47);
    skCol = mix(uSkC1 * (0.85 + 0.3 * skF(p * 20.0)), uSkC2, max(e, ring * 0.8));`,
  damascus: `float l = sin((p.z + skF(p * 9.0) * 0.06 + p.y * 0.3) * 260.0);
    skCol = mix(uSkC1, uSkC2, smoothstep(-0.2, 0.6, l));
    skCol = mix(skCol, uSkC3, smoothstep(0.85, 1.0, l) * 0.6);`,
  gold: `float n = skF(p * uSkScale * 4.0);
    skCol = mix(uSkC2, uSkC1, 0.75 + 0.25 * n);`,
  neon: `float l1 = abs(sin(p.z * 70.0 + skF(p * 6.0) * 5.0)), l2 = abs(sin((p.y + p.x) * 90.0 + skF(p * 8.0 + 3.0) * 4.0));
    float g1 = smoothstep(0.06, 0.0, l1), g2 = smoothstep(0.05, 0.0, l2);
    skCol = uSkC1;
    skEm = uSkC2 * g1 * uSkEmis + uSkC3 * g2 * uSkEmis;
    skCol += uSkC2 * g1 * 0.6 + uSkC3 * g2 * 0.6;`,
  hyper: `float t = skF(p * uSkScale + skF(p * uSkScale * 2.0) * 1.5);
    skCol = mix(uSkC1, uSkC2, smoothstep(0.3, 0.5, t));
    skCol = mix(skCol, uSkC3, smoothstep(0.5, 0.65, t));
    skCol = mix(skCol, uSkC4, smoothstep(0.66, 0.78, t));
    skCol = mix(skCol, vec3(0.02), smoothstep(0.01, 0.0, abs(t - 0.49)) + smoothstep(0.01, 0.0, abs(t - 0.65)));`,
  splatter: `float n = skF(p * uSkScale), n2 = skF(p * uSkScale * 2.3 + 7.0);
    skCol = uSkC1;
    float s1 = smoothstep(0.62, 0.66, n), s2 = smoothstep(0.66, 0.7, n2);
    skCol = mix(skCol, uSkC2, s1); skCol = mix(skCol, uSkC3, s2);
    skEm = (uSkC2 * s1 + uSkC3 * s2) * uSkEmis;`,
  lava: `vec2 d = skV(p * uSkScale);
    float crack = smoothstep(0.12, 0.0, d.y - d.x);
    float heat = crack * (0.6 + 0.4 * skF(p * 20.0));
    skCol = mix(uSkC1 * (0.8 + 0.4 * skF(p * 30.0)), uSkC2, heat);
    skEm = mix(uSkC2, uSkC3, heat) * heat * uSkEmis;`,
  scales: `vec3 q = p * uSkScale; q.y += floor(q.z) * 0.5;
    vec2 d = skV(vec3(q.z, q.y, 0.0));
    float edge = smoothstep(0.0, 0.25, d.y - d.x);
    skCol = mix(uSkC3, mix(uSkC1, uSkC2, smoothstep(0.2, 0.0, d.x) * 0.6), edge);`,
  casehard: `float w = skF(p * uSkScale + skF(p * uSkScale * 2.0) * 2.0);
    skCol = mix(uSkC1, uSkC2, smoothstep(0.45, 0.62, w));
    skCol = mix(skCol, uSkC3, smoothstep(0.62, 0.75, skF(p * uSkScale * 1.5 + 4.0)) * 0.7);`,
};

// materials that never take a skin (glass, sights, brass rounds)
const SKIP = /glass|sight|brass|bullet|lens/i;

function skinMaterial(base, def, uniforms, space) {
  const m = base.clone();
  const sp = { value: space.clone() };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uSkinSpace: sp });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uSkinSpace;\nvarying vec3 vSkinP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinP = (uSkinSpace * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 skCol = vec3(0.0); vec3 skEm = vec3(0.0); float skMet = uSkMetal, skRou = uSkRough;
        { vec3 p = vSkinP + uSkSeed; ${PATTERNS[def.p] || PATTERNS.solid} }
        float skWorn = 0.0;
        if (skCol.r >= 0.0) {
          // scratches and edge wear reveal the base finish
          float wn = skF(vSkinP * 70.0 + uSkSeed) * 0.75 + skN(vSkinP * 420.0) * 0.25;
          skWorn = smoothstep(uSkWear * 0.9 - 0.02, uSkWear * 0.9 + 0.02, 1.0 - wn) * step(0.001, uSkWear);
          skWorn = 1.0 - skWorn;
          float bl = clamp(dot(diffuseColor.rgb, vec3(0.3333)) * 2.4, 0.55, 1.15);
          diffuseColor.rgb = mix(diffuseColor.rgb, skCol * mix(1.0, bl, 0.4), skWorn);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (skCol.r >= 0.0) roughnessFactor = mix(roughnessFactor, skRou, skWorn);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (skCol.r >= 0.0) metalnessFactor = mix(metalnessFactor, skMet, skWorn);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += skEm * skWorn;');
  };
  m.customProgramCacheKey = () => 'skin_' + def.p;
  m.userData.skinned = true;
  return m;
}

// Apply a skin to a weapon hierarchy. Returns an undo function.
// opts: {wear (0..1), seed}
export function applySkin(root, skinId, opts = {}) {
  const def = SKINS[skinId];
  if (!def || def.p === 'none') return () => {};
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3().setFromObject(root);
  const len = Math.max(0.1, (box.max.clone().applyMatrix4(inv).z - box.min.clone().applyMatrix4(inv).z));
  const C = (i) => new THREE.Color(def.c[i] || '#000');
  const uniforms = {
    uSkC1: { value: C(0) }, uSkC2: { value: C(1) }, uSkC3: { value: C(2) }, uSkC4: { value: C(3) },
    uSkScale: { value: def.s || 1 }, uSkMetal: { value: def.m ?? 0.3 }, uSkRough: { value: def.r ?? 0.5 },
    uSkWear: { value: opts.wear ?? 0.05 }, uSkSeed: { value: (opts.seed ?? 0) * 3.17 }, uSkEmis: { value: def.e || 0 },
    uSkLen: { value: Math.abs(len) },
  };
  const undo = [];
  const space = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.noSkin) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.every((m) => SKIP.test(m.name || ''))) return;
    space.multiplyMatrices(inv, o.matrixWorld);
    const orig = o.material;
    const next = mats.map((m) => (SKIP.test(m.name || '') || o.userData.noSkin ? m : skinMaterial(m, def, uniforms, space)));
    o.material = Array.isArray(orig) ? next : next[0];
    undo.push(() => { for (const m of next) if (m.userData.skinned) m.dispose(); o.material = orig; });
  });
  return () => undo.forEach((f) => f());
}

export function skinsFor(weapon) { return Object.entries(SKINS).filter(([, s]) => s.weapon === weapon).map(([id]) => id); }

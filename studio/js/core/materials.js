// Material definitions (plain JSON) + built-in presets that reference the game's CC0 textures.
// `tiling` is in repeats per metre, applied in world scale so textures never stretch when you resize an object.

import { builtinTexId } from './builtin.js';
import { deepClone } from './util.js';

export const MATERIAL_SLOTS = ['map', 'normalMap', 'ormMap', 'emissiveMap', 'alphaMap'];

export function defaultMaterial(name = 'New material') {
  return {
    name, color: '#ffffff', roughness: 1, metalness: 0,
    map: '', normalMap: '', ormMap: '', emissiveMap: '', alphaMap: '',
    normalScale: 1, emissive: '#000000', emissiveIntensity: 0,
    opacity: 1, doubleSided: false,
    tiling: [1, 1], offset: [0, 0], rotation: 0,
    surface: '', preset: false,
  };
}

const T = (set) => ({ map: builtinTexId(`${set}_diff`), normalMap: builtinTexId(`${set}_nor`), ormMap: builtinTexId(`${set}_arm`) });
const preset = (name, set, tile, color = '#ffffff', extra = {}) => ({ ...defaultMaterial(name), ...(set ? T(set) : {}), tiling: [1 / tile, 1 / tile], color, preset: true, ...extra });

/** Always-available presets. Projects may override one by defining a material with the same id. */
export const PRESET_MATERIALS = {
  mat_plaster: preset('Plaster (peeling)', 'peeling_painted_wall', 2.4, '#b9bfb0', { surface: 'concrete' }),
  mat_tile: preset('Tiles (white)', 'long_white_tiles', 1.35, '#c9cbb8', { surface: 'tile' }),
  mat_concrete: preset('Concrete', 'concrete_wall_006', 2.5, '#8d8a82', { surface: 'concrete' }),
  mat_concrete_floor: preset('Concrete floor', 'concrete_floor_worn_001', 2.8, '#8f8c84', { surface: 'concrete' }),
  mat_wood: preset('Painted wood', 'wood_peeling_paint_weathered', 1.4, '#7a6a58', { surface: 'wood' }),
  mat_wood_floor: preset('Wood floor', 'wood_floor_worn', 2.0, '#9a8a78', { surface: 'wood' }),
  mat_metal: preset('Rusty metal', 'rusty_metal_02', 1.0, '#9a948c', { metalness: 1, roughness: 1, surface: 'metal' }),
  mat_green_metal: preset('Green painted metal', 'green_metal_rust', 1.6, '#8aa08f', { surface: 'metal' }),
  mat_brick: preset('Red brick', 'red_bricks_04', 2.2, '#a08a80', { surface: 'concrete' }),
  mat_linoleum: preset('Linoleum', 'old_linoleum_flooring_01', 1.6, '#8a8576', { surface: 'tile' }),
  mat_dirty_tiles: preset('Dirty floor tiles', 'dirty_tiles', 1.2, '#b4ae9f', { surface: 'tile' }),
  mat_mud: preset('Mud', 'mud_forest', 2.6, '#ffffff', { surface: 'mud' }),
  mat_grass: preset('Forest ground', 'forest_ground_06', 2.2, '#ffffff', { surface: 'grass' }),
  mat_road: preset('Damaged road', 'road_damaged', 3.5, '#ffffff', { surface: 'concrete' }),
  mat_bark: preset('Bark', 'pine_bark', 1.0, '#6e655c', {}),
  mat_padded: preset('Padded cloth', 'waffle_pique_cotton', 0.45, '#b8ad90', { surface: 'carpet' }),
  mat_ceiling: preset('Ceiling tiles', 'polystyrene', 1.2, '#a7a49a', {}),
  mat_plain_white: { ...defaultMaterial('Plain white'), color: '#d8d8d8', preset: true },
  mat_plain_dark: { ...defaultMaterial('Plain dark'), color: '#2a2a2a', preset: true },
  mat_glass: { ...defaultMaterial('Glass'), color: '#9fb4c4', roughness: 0.05, opacity: 0.25, preset: true },
  mat_blood: { ...defaultMaterial('Dried blood'), color: '#3a0805', roughness: 0.35, preset: true },
};

export function getMaterialDef(project, id) {
  return project?.data?.materials?.[id] || PRESET_MATERIALS[id] || null;
}
export function cloneMaterial(def, name) { const c = deepClone(def); c.name = name || `${def.name} copy`; c.preset = false; return c; }

export function allMaterialIds(project) {
  return [...new Set([...Object.keys(PRESET_MATERIALS), ...Object.keys(project?.data?.materials || {})])];
}

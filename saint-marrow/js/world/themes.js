// Surface themes. Each wall face takes the theme of the floor cell it faces.
// [textureSet, metresPerTile, tint]
export const THEMES = {
  corridor: {
    h: 3.2, split: 1.35, surface: 'tile',
    floor: ['old_linoleum_flooring_01', 1.6, 0x8a8576],
    low: ['long_white_tiles', 1.35, 0xc9cbb8],
    high: ['peeling_painted_wall', 2.4, 0x98b19c],
    ceil: ['polystyrene', 1.2, 0xa7a49a],
    trim: ['wood_peeling_paint_weathered', 1, 0x4b5a50],
  },
  ward: {
    h: 3.2, split: 1.15, surface: 'tile',
    floor: ['dirty_tiles', 1.2, 0xb4ae9f],
    low: ['peeling_painted_wall', 2.2, 0x6c9277],
    high: ['peeling_painted_wall', 2.4, 0xa9b6a6],
    ceil: ['polystyrene', 1.2, 0x9e9b92],
    trim: ['wood_peeling_paint_weathered', 1, 0x3e4a42],
  },
  office: {
    h: 3.0, split: 1.0, surface: 'wood',
    floor: ['wood_floor_worn', 2.0, 0x9a8a78],
    low: ['wood_peeling_paint_weathered', 1.4, 0x6b5a48],
    high: ['decrepit_wallpaper', 1.8, 0xb9ae98],
    ceil: ['polystyrene', 1.2, 0x9b958a],
    trim: ['wood_peeling_paint_weathered', 1, 0x3b2c22],
  },
  surgery: {
    h: 3.4, split: 2.1, surface: 'tile',
    floor: ['dirty_tiles', 1.0, 0xa9b0ae],
    low: ['long_white_tiles', 1.1, 0xd4dbd6],
    high: ['peeling_painted_wall', 2.4, 0xa3b8ad],
    ceil: ['polystyrene', 1.2, 0xa4a6a0],
    trim: ['rusty_metal_02', 1, 0x777777],
  },
  basement: {
    h: 3.0, split: 1.2, surface: 'concrete',
    floor: ['concrete_floor_worn_001', 2.8, 0x8f8c84],
    low: ['concrete_wall_006', 2.5, 0x7d7a72],
    high: ['concrete_wall_006', 2.5, 0x8d8a82],
    ceil: ['concrete_wall_006', 2.5, 0x6f6c66],
    trim: null,
  },
  storage: {
    h: 3.0, split: 1.2, surface: 'concrete',
    floor: ['concrete_floor_worn_001', 2.5, 0x9a968c],
    low: ['green_metal_rust', 1.6, 0x8aa08f],
    high: ['concrete_wall_006', 2.5, 0x9a978e],
    ceil: ['concrete_wall_006', 2.5, 0x77746d],
    trim: ['rusty_metal_02', 1, 0x666666],
  },
  chapel: {
    h: 6.0, split: 1.3, surface: 'wood',
    floor: ['wood_floor_worn', 2.2, 0x8b7a68],
    low: ['wood_peeling_paint_weathered', 1.4, 0x5a4636],
    high: ['red_bricks_04', 2.2, 0xb59d90],
    ceil: ['wood_peeling_paint_weathered', 2.0, 0x4a3a2e],
    trim: ['wood_peeling_paint_weathered', 1, 0x2e2018],
  },
  hut: {
    h: 2.7, split: 1.0, surface: 'wood',
    floor: ['wood_floor_worn', 1.8, 0x7d6d5c],
    low: ['wood_peeling_paint_weathered', 1.4, 0x6a5848],
    high: ['wood_peeling_paint_weathered', 1.6, 0x7b6a58],
    ceil: ['wood_peeling_paint_weathered', 1.6, 0x4d4034],
    trim: null,
  },
  padded: {
    h: 3.0, split: 2.2, surface: 'tile',
    floor: ['dirty_tiles', 1.0, 0x8d8a80],
    low: ['waffle_pique_cotton', 0.45, 0xb8ad90],
    high: ['peeling_painted_wall', 2.4, 0x9aa596],
    ceil: ['polystyrene', 1.2, 0x8a877e],
    trim: null,
  },
  morgue: {
    h: 3.0, split: 2.2, surface: 'tile',
    floor: ['dirty_tiles', 0.9, 0x8e9a98],
    low: ['long_white_tiles', 1.0, 0xa9b8b4],
    high: ['concrete_wall_006', 2.5, 0x8a8a84],
    ceil: ['concrete_wall_006', 2.5, 0x6b6b66],
    trim: ['rusty_metal_02', 1, 0x666666],
  },
};
export const THEME_LIST = ['corridor', 'ward', 'office', 'surgery', 'basement', 'storage', 'chapel', 'hut', 'morgue'];

export const SURFACE_OF_TEX = {
  old_linoleum_flooring_01: 'tile', dirty_tiles: 'tile', wood_floor_worn: 'wood', concrete_floor_worn_001: 'concrete',
};

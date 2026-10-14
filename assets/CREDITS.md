# Asset credits

STRIKEPOINT embeds third-party assets in `index.html`. Each one was checked for a license that allows redistribution in a game. CC0 assets do not require attribution; they are listed here for provenance.

## Textures (Poly Haven, CC0)

All from <https://polyhaven.com>, license CC0 1.0. Resized and converted to WebP by `tools/assets.mjs`.

| In game | Poly Haven asset |
|---|---|
| `sandstone` | [sandstone_blocks_04](https://polyhaven.com/a/sandstone_blocks_04) |
| `sandstone_white` | [white_sandstone_bricks](https://polyhaven.com/a/white_sandstone_bricks) |
| `plaster` | [patterned_clay_plaster](https://polyhaven.com/a/patterned_clay_plaster) |
| `plaster_ochre` | [clay_plaster](https://polyhaven.com/a/clay_plaster) |
| `plaster_blue` | [blue_plaster_weathered](https://polyhaven.com/a/blue_plaster_weathered) |
| `sand` | [coast_sand_01](https://polyhaven.com/a/coast_sand_01) |
| `pavers` | [stone_tiles_02](https://polyhaven.com/a/stone_tiles_02) |
| `tiles` | [cobblestone_square](https://polyhaven.com/a/cobblestone_square) |
| `concrete` | [rough_concrete](https://polyhaven.com/a/rough_concrete) |
| `wood` | [weathered_brown_planks](https://polyhaven.com/a/weathered_brown_planks) |
| `crate` | [wood_planks_dirt](https://polyhaven.com/a/wood_planks_dirt) |
| `door` | [wood_peeling_paint_weathered](https://polyhaven.com/a/wood_peeling_paint_weathered) |
| `metal` | [green_metal_rust](https://polyhaven.com/a/green_metal_rust) |
| `rust` | [rusty_metal_02](https://polyhaven.com/a/rusty_metal_02) |
| `roof` | [clay_roof_tiles_02](https://polyhaven.com/a/clay_roof_tiles_02) |
| `leather` | [fabric_leather_02](https://polyhaven.com/a/fabric_leather_02) |
| `fabric` | [stretch_poplin](https://polyhaven.com/a/stretch_poplin) |
| `neoprene` | [scuba_suede](https://polyhaven.com/a/scuba_suede) |
| `denim` | [denim_fabric_05](https://polyhaven.com/a/denim_fabric_05) |

## Map props (Poly Haven, CC0)

| In game | Poly Haven model |
|---|---|
| `crate_lettered` | [wooden_crate_02](https://polyhaven.com/a/wooden_crate_02) |
| `crate_military` | [old_military_crate](https://polyhaven.com/a/old_military_crate) |
| `barrel_red` | [Barrel_01](https://polyhaven.com/a/Barrel_01) |
| `barrel_blue` | [barrel_03](https://polyhaven.com/a/barrel_03) |
| `barrel_wood` | [wine_barrel_01](https://polyhaven.com/a/wine_barrel_01) |
| `jerrycan` | [metal_jerrycan_green](https://polyhaven.com/a/metal_jerrycan_green) |
| `ammo_box` | [ammo_box](https://polyhaven.com/a/ammo_box) |
| `pot_clay` | [planter_pot_clay](https://polyhaven.com/a/planter_pot_clay) |
| `vase_jug` | [ceramic_vase_04](https://polyhaven.com/a/ceramic_vase_04) |
| `barrier` | [concrete_road_barrier](https://polyhaven.com/a/concrete_road_barrier) |
| `castle_door` | [large_castle_door](https://polyhaven.com/a/large_castle_door) |
| `utility_box` | [utility_box_01](https://polyhaven.com/a/utility_box_01) |
| `covered_car` | [covered_car](https://polyhaven.com/a/covered_car) |
| `tyre` | [old_tyre](https://polyhaven.com/a/old_tyre) |
| `cement_bag` | [cement_bag](https://polyhaven.com/a/cement_bag) |
| `crate_wood` | [wooden_crate_01](https://polyhaven.com/a/wooden_crate_01) |
| `shutter_door` | [rollershutter_door](https://polyhaven.com/a/rollershutter_door) |
| `basket` | [wicker_basket_02](https://polyhaven.com/a/wicker_basket_02) |
| `brass_pot` | [brass_pot_01](https://polyhaven.com/a/brass_pot_01) |
| `table_wood` | [WoodenTable_01](https://polyhaven.com/a/WoodenTable_01) |
| `lantern` | [wooden_lantern_01](https://polyhaven.com/a/wooden_lantern_01) |

## Weapons

| In game | Source | Author | License |
|---|---|---|---|
| KR-47 (`gun_ak`), SG-12 (`gun_shotgun`), GR-3 (`gun_smg`), PM-9 (`gun_pistol`), R-338 (`gun_sniper`) | [Free CC0 Guns & Explosives Pack](https://3dmodelscc0.itch.io/free-cc0-guns-explosives-pack) | 3DModelsCC0 | CC0 1.0 |
| Talon combat knife (`knife_combat`) | [Free CC0 Melee Weapons Pack](https://3dmodelscc0.itch.io/free-cc0-melee-weapons-pack) | 3DModelsCC0 | CC0 1.0 |
| MR-4 Ranger (`gun_m4`) | "M4A1 Assault Rifle", OpenGameArt (<https://opengameart.org/sites/default/files/m4a1_0.zip>) | nisu | CC0 1.0 |
| D-50 Eagle (`gun_deagle`) | "Desert Eagle", OpenGameArt (<https://opengameart.org/sites/default/files/desert_eagle_0.zip>) | SirDraco65 | CC0 1.0 |
| M9 Bayonet (`knife_m9`) | "M9 Knife PBR", OpenGameArt (<https://opengameart.org/sites/default/files/m9_knife.zip>) | khairul169 | CC0 1.0 |
| Karambit, Butterfly | procedural (built in code, `src/weapons/models.js`) | — | project code |

The weapon names in the game are fictional. Models were re-oriented, un-skinned, simplified and texture-compressed by `tools/assets.mjs` (`node tools/assets.mjs guns`).

## First-person hands

Generic hand models from the WebXR Input Profiles project, <https://github.com/immersive-web/webxr-input-profiles> (package `@webxr-input-profiles/assets@1.0.19`, profile `generic-hand`), MIT License, Copyright (c) 2019 Amazon. The gloves and sleeves are drawn with the Poly Haven fabric textures listed above.

License of the hand models:

```
MIT License

Copyright (c) 2019 Amazon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

The above copyright notice and this permission notice (including the next
paragraph) shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS
OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Sounds

Recorded sound effects and their sources are listed in [`tools/sounds-credits.md`](../tools/sounds-credits.md). All are CC0.

## Code libraries

- three.js (MIT), <https://threejs.org>
- meshoptimizer decoder (MIT), bundled with three.js


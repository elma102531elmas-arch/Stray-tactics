# STRIKEPOINT

A Standoff 2–style tactical FPS that runs in the browser on phones and PCs. Graphics and weapon feel came first; the game ships with built-in dev tools so you can make maps, textures and animations yourself.

The whole game is a single file, **`index.html`**, with no downloads or server. Open it in Chrome, Edge, Safari or Firefox (desktop or mobile), or host the repo on GitHub Pages.

> `stray-tactical.html` is the old game. It is left untouched.

## What's in it

- **Graphics**
  - Physically based materials with procedurally generated albedo, normal and roughness textures (generated on the GPU in milliseconds).
  - Baked ambient occlusion plus sky-occlusion "bounce light" (fake global illumination).
  - Dynamic sun shadows, an image-based-lighting sky with clouds, ACES tone mapping, bloom and color grading.
  - Distance haze and desert dunes.
- **Weapons:** KR-47 rifle, R-338 Raven bolt-action sniper (with scope), Vanta-9 pistol and Talon knife. All are detailed procedural models with beveled edges, wood and metal materials, and moving parts (bolt, slide, trigger, magazine).
- **First-person animations:** draw, fire, reload, empty reload (charging handle, slide release, bolt cycling) and inspect for every weapon. Knife slashes, stab and a twirl inspect.
  - Magazines are passed between gun and hand, and dropped mags bounce on the floor.
  - Shells eject and clink on the ground.
  - Springs add weapon sway, bob, recoil, landing and impact kicks.
- **Gameplay:**
  - 5v5 Team Deathmatch against bots (easy, normal or hard) and a Practice free-roam mode.
  - CS-style movement and spray patterns, headshots, hitscan bullets (no wall penetration) and a knife backstab.
  - Kill feed, radar, scoreboard and damage indicators.
- **Bots:** they navigate any map automatically (navigation grid plus A\*), react with a human-like delay, settle their aim, fire in bursts, strafe and crouch, and hear gunfire.
- **Audio:** every sound is synthesized: layered gunshots with reverb, mechanical reload clicks synced to the animations, footsteps and 3D positional audio.
- **Performance (120 FPS):**
  - FPS cap of 30/60/90/120/144/MAX, with dynamic resolution that holds the target.
  - Four quality presets.
  - ~64 draw calls for the whole world and ~13 for the weapon, because the map is merged per material and the shadows use a low-poly proxy.
  - Browsers can't go above your screen's refresh rate, so 120 FPS needs a 120 Hz screen.
- **Phones:** the controls follow the Standoff 2 layout: a floating move stick, drag anywhere on the right to look, fire buttons on both sides, and jump, crouch, reload, scope and inspect buttons.

## Controls (PC)

| Key | Action |
|---|---|
| WASD | move |
| Mouse | aim |
| Left click | fire |
| Right click | scope (sniper) / heavy stab (knife) |
| R | reload |
| F | inspect |
| 1 / 2 / 3, mouse wheel, Q | switch weapons (Q = last weapon) |
| Space | jump |
| Ctrl / C | crouch |
| Shift | walk |
| Tab | scoreboard |
| Esc | pause |

## Dev tools (lobby → DEV TOOLS)

Everything you make is saved in your browser and works in the game right away.

### 🗺 Map Editor
- Add boxes and walls, ramps, stairs, pillars, arch walls, whole **buildings**, all with automatic windows, doors, beams and trim.
- Add 18 props (crates, barrels, sandbags, palms, cars, market stalls, wells…) and spawn points for both teams.
- Move, rotate and resize with the gizmo, with grid snapping. Undo and redo with Ctrl+Z / Ctrl+Y; duplicate with Ctrl+D.
- Set the ground, sun direction and color, sky, fog and clouds.
- **BAKE LIGHT** shows final quality. **▶ PLAY TEST** drops you into the map instantly.
- **SAVE** adds the map to the lobby's map list.

### 🎨 Texture Studio
- Start from any built-in material or make a new one. Patterns: bricks, tiles, planks, cobble, panels.
- Sliders for colors, noise, dirt, streaks, cracks, spots, edge wear, wood grain, stripes, roughness, metalness and bumpiness. Live 3D preview on a sphere, cube or wall.
- **📷 FROM PHOTO** turns any picture into a texture; bumps are generated automatically.
- Saved textures appear in the Map Editor's material palette. You can export PNGs.

### 🎬 Animation Studio
- Pick a weapon and a clip (draw, fire, reload, reloadEmpty, inspect, slashes…).
- Pick a track (weapon, left hand, right hand, magazine, camera, bolt, fingers…) and drag the gizmo. A key is created at the playhead automatically.
- Drag keys on the timeline and set easing per key.
- Add events: sounds, "kick" jolts, magazine hand-offs and drops, the ammo refill moment, shell ejection, hand poses.
- First-person or orbit camera. **▶ TEST IN GAME** saves the clip and plays it in a live match.

### 📦 Sending me your work
Use **lobby → 📦 EXPORT ALL (SEND THIS)** to download `strikepoint-pack.json`, which holds all your maps, textures and animations in one small file. You can also copy single items with the **JSON ⇅** button in each tool.

Send the file or JSON and it can be merged into the game as built-in content. **IMPORT PACK…** in the same window loads a pack from someone else.

## Building from source

The source code is in `src/` (ES modules, three.js). The build inlines everything into `index.html`.

```bash
npm install
npm run build     # -> index.html
npm run watch     # rebuild on change
```

| Folder | Contents |
|---|---|
| `src/core` | renderer (post FX, FPS limiter, dynamic resolution), settings, utilities |
| `src/gfx` | GPU texture generator, material library, sky |
| `src/world` | map format and builder (AO bake), collision, prefabs, default map `maps/kasbah.js` |
| `src/weapons` | weapon models, IK arms, viewmodel, weapon stats |
| `src/anim` | keyframe clip format/player, built-in clips (`defaults.js`) |
| `src/game` | player, bots, navigation, combat, effects, HUD, audio, input, match logic |
| `src/editors` | Map Editor, Texture Studio, Animation Studio |
| `src/ui` | lobby and settings |

## Not included yet

- Online multiplayer (bots only for now).
- Bomb defuse mode.
- Weapon skins and a shop.

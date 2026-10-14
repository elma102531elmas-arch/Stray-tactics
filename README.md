# STRIKEPOINT

A Standoff 2–style tactical FPS that runs in the browser on phones and PCs. Graphics and weapon feel came first; the game ships with built-in dev tools so you can make maps, textures and animations yourself.

The whole game is a single file, **`index.html`**, with no downloads or server. Open it in Chrome, Edge, Safari or Firefox (desktop or mobile), or host the repo on GitHub Pages.

> `stray-tactical.html` is the old game. It is left untouched.

## What's in it

- **Graphics**
  - Photo-scanned PBR textures and map props from Poly Haven (sandstone, plaster, cobblestone, barrels, crates, a covered car, doors…), instanced so the whole map stays cheap to draw.
  - Baked ambient occlusion plus sky-occlusion "bounce light" (fake global illumination).
  - Dynamic sun shadows, an image-based-lighting sky with clouds, ACES tone mapping, bloom and color grading.
- **Weapons:** 7 guns with real CC0 3D models and moving parts (magazine, bolt, slide, pump, trigger):
  - Rifles: KR-47, MR-4 Ranger. SMG: GR-3 Grease. Shotgun: SG-12 Breacher (pellets, shell-by-shell reload with pump). Sniper: R-338 Raven (scope, bolt action).
  - Pistols: PM-9, D-50 Eagle.
  - Knives: Talon (default), M9 Bayonet, Karambit (spins around your finger in the inspect) and Butterfly (handle flips in the draw and inspect).
- **Realistic first-person hands:** gloved hands with real finger joints (WebXR hand models), photo fabric sleeves and leather knuckle pads, posed per weapon like Standoff 2.
- **First-person animations:** draw, fire, reload, empty reload and inspect for every weapon; clips are retargeted automatically to each gun's magazine and charging handle.
  - Magazines pass between gun and hand; dropped mags and shells bounce on the floor.
  - Springs add weapon sway, bob, recoil, landing and impact kicks.
- **Skins and cases (Standoff / CS style):**
  - Win matches to earn coins: Victory 300, Defeat 120, Draw 180, +15 per kill, +5 per headshot, plus XP and levels.
  - Three cases (250 / 400 / 1000 coins) with drop odds: Rare 72%, Epic 19%, Legendary 6%, Arcane 2.2%, ★ Knife 0.8% (the Blade Case has better odds).
  - A roulette opening with a reveal, wear (float: Factory New → Battle-Scarred) and pattern seeds, selling, and equipping.
  - ~35 skins: Fade, Doppler, Marble Fade, Tiger Tooth, Crimson Web, Damascus, Case Hardened, Hyper Beast-style, Neon, Lava and camos. Patterns are drawn by a shader on the real models; wear adds scratches.
- **Main menu:** profile bar (level, XP, coins), PLAY / INVENTORY / CASES / DEV TOOLS, a 3D weapon showcase with your skin (drag to rotate), and PRIMARY / SECONDARY / KNIFE loadout slots.
- **Gameplay:**
  - 5v5 Team Deathmatch against bots (easy, normal or hard) and a Practice free-roam mode.
  - CS-style movement and spray patterns, headshots, hitscan bullets (no wall penetration) and a knife backstab.
  - Kill feed, radar, scoreboard and damage indicators.
- **Bots:** they navigate any map automatically (navigation grid plus A\*), react with a human-like delay, settle their aim, fire in bursts, strafe and crouch, and hear gunfire. They carry a mix of rifles, SMGs, shotguns and snipers.
- **Audio:** 60 recorded CC0 / public-domain sounds: a different gunshot for every gun, distant gunfire for far shots, reload and bolt handling, footsteps on stone and sand, bullet impacts, shell casings, knife sounds, case opening and coins, and a desert wind ambience. They are synced to the animations and use 3D positional audio and reverb; synthesized sounds fill in anything without a recording.
- **Performance (120 FPS):**
  - FPS cap of 30/60/90/120/144/MAX, with dynamic resolution that holds the target.
  - Four quality presets.
  - Browsers can't go above your screen's refresh rate, so 120 FPS needs a 120 Hz screen.
- **Phones:** the controls follow the Standoff 2 layout: a floating move stick, drag anywhere on the right to look, fire buttons on both sides, and jump, crouch, reload, scope and inspect buttons. The menu fits landscape phones.

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

## Dev tools (main menu → DEV TOOLS)

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
- Pick any weapon or knife and a clip (draw, fire, reload, reloadEmpty, inspect, slashes, shotgun shell loading…).
- Pick a track (weapon, left hand, right hand, magazine, camera, bolt, fingers, spin, butterfly handles…) and drag the gizmo. A key is created at the playhead automatically.
- Made easier:
  - **Undo / redo** (Ctrl+Z / Ctrl+Y).
  - **Copy / paste a pose** (Ctrl+C / Ctrl+V), **HOLD** (repeat the previous pose for a pause, key H) and **END = START** (finish on the first pose).
  - **Pose presets** for the weapon (lowered, inspect left/right side, look at top, tilt for reload, out of view).
  - **SPIN 360°** buttons that add a whole knife twirl in one click.
- Drag keys on the timeline and set easing per key; play at 0.1×–1× speed.
- Add events: sounds, "kick" jolts, magazine hand-offs and drops, the ammo refill moment, shell ejection, hand poses.
- First-person or orbit camera. **▶ TEST IN GAME** saves the clip and plays it in a live match.

### 📦 Sending me your work
Use **main menu → DEV TOOLS → 📦 EXPORT ALL** to download `strikepoint-pack.json`, which holds all your maps, textures and animations in one small file. You can also copy single items with the **JSON ⇅** button in each tool.

Send the file or JSON and it can be merged into the game as built-in content. **IMPORT PACK…** in the same window loads a pack from someone else.

## Building from source

The source code is in `src/` (ES modules, three.js). The build inlines everything, including the 3D models, textures and sounds, into `index.html`.

```bash
npm install
npm run build     # -> index.html
npm run watch     # rebuild on change
```

Assets are downloaded and optimized by `tools/assets.mjs` (glTF simplify + WebP textures + meshopt, ffmpeg cuts for sounds):

```bash
node tools/assets.mjs fetch && node tools/assets.mjs build   # textures + map props
node tools/assets.mjs guns                                   # weapon models
node tools/assets.mjs sounds                                 # recorded sound effects
```

| Folder | Contents |
|---|---|
| `src/core` | renderer (post FX, FPS limiter, dynamic resolution), settings, player profile and economy, utilities |
| `src/gfx` | GPU texture generator, material library, sky |
| `src/world` | map format and builder (AO bake), collision, prefabs, default map `maps/kasbah.js` |
| `src/weapons` | weapon models, IK arms and hands, viewmodel, weapon stats, skins |
| `src/anim` | keyframe clip format/player, built-in clips (`defaults.js`), clip retargeting |
| `src/game` | player, bots, navigation, combat, effects, HUD, audio, input, match logic |
| `src/editors` | Map Editor, Texture Studio, Animation Studio |
| `src/ui` | main menu, cases and inventory, skin thumbnails, settings |
| `assets/` | optimized models, textures and sounds that get embedded |

All third-party assets are CC0 or MIT. See [`assets/CREDITS.md`](assets/CREDITS.md).

## Not included yet

- Online multiplayer (bots only for now).
- Bomb defuse mode.
- Photo-real third-person soldiers (the bots are still procedural models).

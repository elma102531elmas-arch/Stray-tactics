# Stray

Browser games built with three.js. Each game is a single HTML file with no build step, and both run on desktop and mobile.

- `index.html`: launcher page
- `straycraft.html`: **Straycraft**, an infinite voxel survival and creative sandbox
- `stray-tactical.html`: **Stray Tactical**, a 1v1 duel shooter

## Straycraft

An endless block world that generates as you explore.

- **Infinite world.** Chunks generate around you in a background worker, so the game stays smooth. There are 9 biomes: plains, forest, birch forest, desert, snowy taiga, mountains, beaches, and warm and frozen oceans. Underground you'll find spaghetti caves and caverns with coal, iron, gold and diamond ores and lava pools. Trees, cacti, flowers, tall grass and pumpkins grow on the surface.
- **More realistic look.** It uses detailed 32px procedural textures with per-block random rotation so they don't repeat, smooth lighting with ambient occlusion, and real sunlight and block light where caves are dark and torches glow. Sun shadows, swaying leaves and grass, see-through water with waves, drifting clouds, a full day/night cycle with stars and moon, underwater fog and block-break particles complete the look.
- **First-person hand.** A modelled arm and gripping hand holds blocks as small cubes and tools and items as 3D pixel models, with swing, place, eat, equip, bob and sway animations. You can also switch to third person or a front view and see your full character.
- **Survival.** Mine with the right tool (the harder ores need better pickaxes). Craft planks, sticks, a crafting table, a furnace, torches, and wood, stone, iron and diamond tools, and smelt ores, glass and food. Manage health, hunger and air, take fall damage, and watch out for lava and cactus. Pigs, cows and sheep give food and wool. Zombies come out at night and in dark caves, and burn in the sun.
- **Creative.** Fly (double-tap jump), take any block or item for free, and break blocks instantly.
- **Saves.** Multiple worlds with names and seeds are saved in your browser and auto-saved every 30 seconds.
- **Co-op.** Open your world to friends from the pause menu. They join with the 5-letter code and everyone builds in the same world. It's peer-to-peer through the public PeerJS broker, so there's no server to run.

### Controls

| Desktop | Mobile |
| --- | --- |
| `WASD` move, `Space` jump (double-tap to fly in creative), `Shift` sneak, `Ctrl` sprint | Left side: virtual stick (push far forward to sprint) |
| Mouse look, left click mine/attack, right click place/use/eat | Right side: drag to look, tap to place/use/attack, hold to mine or eat |
| `E` inventory and crafting, `1`–`9` or wheel for the hotbar, middle click picks a block (creative) | BAG, JUMP, SNEAK, FLY, DOWN, CAM buttons, tap the hotbar |
| `F5`/`V` camera, `F3` debug info, `Esc` pause | Pause button |

For local multiplayer testing, open two tabs with `?net=bc` to connect over `BroadcastChannel` instead of PeerJS.

### Hosting

Serve the folder with any static file server (for example GitHub Pages), then open `index.html`.

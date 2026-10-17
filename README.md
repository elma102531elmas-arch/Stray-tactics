# Stray

Browser shooters built with three.js. Each game is a single HTML file with no build step, and both run on desktop and mobile.

- `index.html`: launcher page
- `stray-survival.html`: **Stray Survival**, co-op wave survival with endless bosses
- `stray-tactical.html`: **Stray Tactical**, 1v1 duel

## Stray Survival

Hold the camp with up to 3 friends against endless waves of infected.

- **Endless waves.** Each wave is bigger and tougher than the last. New enemy types join as waves go on: walkers, runners, acid spitters and brutes.
- **Bosses every 3rd wave.** The Butcher (cleaver and ground slam), The Matriarch (acid volleys, summons runners) and The Colossus (armored, thrown rocks, stomp, glowing weak-point core). They rotate, level up each time they return, become enraged at half health, and later waves send several at once.
- **Squad play.** A downed player can still shoot a pistol, and a teammate revives them by standing next to them. Dead players respawn when the wave is cleared, and the run ends only when everyone is down.
- **Operators.** Detailed procedural soldier models with skin, jacket, pants, vest, headgear, hair, beard, squad color and backpack options. Your squad sees your look in the lobby and in game.
- **World.** A camp with a campfire, tents, a watchtower and sandbag walls, ruined houses, a barn, a gas station, a crashed helicopter, wrecked cars and explosive barrels. It has a forest, wind-blown grass and a full day/night cycle, and you get a flashlight at night.
- **Weapons.** Pistol, rifle and pump shotgun, with aim-down-sights, reloads, recoil, headshots, ammo/medkit/armor drops and a supply drop after every wave.
- **Views.** Third-person or first-person (press `V` or the CAM button).

### Controls

| Desktop | Mobile |
| --- | --- |
| `WASD` move, `Shift` sprint, `Space` jump, `C` crouch | Left side: virtual stick (push far forward to sprint) |
| Mouse look, `LMB` fire, `RMB` aim | Right side: drag to look; FIRE buttons also aim while held |
| `R` reload, `1`/`2`/`3` or wheel to switch weapons | R, ⇄, AIM, JUMP, CROUCH buttons |
| `V` camera, `Esc` pause, `N` start the next wave (host) | CAM and pause buttons |

### Multiplayer

Choose **CREATE SQUAD**, share the 5-letter code, and friends use **JOIN SQUAD**. It is peer-to-peer over WebRTC through the public PeerJS broker, so no server is needed. The host runs the enemies and everyone else syncs to the host. **PLAY SOLO** works offline once the page has loaded.

For local testing, open two tabs with `?net=bc` to connect over `BroadcastChannel` instead of PeerJS.

### Hosting

Serve the folder with any static file server (for example GitHub Pages), then open `index.html`.

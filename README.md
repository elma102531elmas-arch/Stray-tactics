# STRAY TACTICS — 5v5 mobile FPS

A complete search-and-destroy shooter that runs in a phone browser. One HTML file, no build step,
no assets to download: every texture, weapon model, character and sound is generated procedurally
at load time.

**Play it:** open `index.html` (or the GitHub Pages URL for this repo) on your phone and turn it
landscape. The old 1v1 prototype is still here as `stray-tactical.html`.

---

## The match

* **5 vs 5** — you plus four bot team mates against five enemy bots.
* **Attackers** carry the C4. They win by planting it and letting it detonate, or by killing every
  defender.
* **Defenders** win by defusing the C4, killing every attacker, or running the clock out.
* **First team to 5 rounds wins the match.**
* Everyone has **100 HP**. There is no armour and no respawning inside a round — die and you
  spectate your team mates until the next round.

| Timer | Length |
|---|---|
| Buy phase | 20 s |
| Round | 1:55 |
| Plant | 4 s |
| C4 fuse | 40 s |
| Defuse | 7 s |

## Economy

* Win a round: **+$3400**. Lose a round: **+$1400**. Everyone starts on **$800**, capped at $9000.
* **Survive the round and you keep everything you bought.**
* **Die and you start the next round with the Glock-18 and a knife** — the money you saved is still
  yours, so a bad round means buying again from scratch.
* Magazines and reserve ammo are refilled at the start of every round.

## Slots

`1` pistol · `2` rifle · `3` knife · `4` utility (up to 3 items) · `5` C4 (only if you are carrying it)

## Weapons

Prices match the games these guns come from (CS2 / VALORANT).

| Weapon | Body | Head | Ammo | Fire | Price | Notes |
|---|---|---|---|---|---|---|
| **Glock-18** | 23 | 80 | 13 / 39 | single **or** 3-round burst | free | Your starting sidearm. Tap slot 1 (or `B`) to switch fire mode. |
| **Tec-9** | 20 | 50 | 20 / 60 | semi | $500 | Barely punished for moving — the run-and-gun pistol. |
| **Sheriff** | 45 | **100** | 6 / 12 | semi | $800 | One tap to the head. Very hard to shoot while running. |
| **AK-47** | 25 | **105** | 20 / 120 | full auto | $2700 | Always a one-shot headshot. Enormous movement penalty. |
| **AWP** | 94 | **100** | 4 / 12 | bolt action, scoped | $4750 | Body shot leaves 6 HP. Slow, lethal, hopeless on the move. |
| **Knife** | 40 (front) | — | ∞ | melee | free | **One hit from behind kills.** Fastest movement speed in the game. |

Utility: **Flashbang $200 · Smoke $300 · HE Grenade $300 · Molotov $400**

* **Flashbang** — blinds anyone with line of sight, scaled by how directly they were looking at it.
* **Smoke** — a 15 second cloud that genuinely blocks sight lines, for you *and* for the bots.
* **HE grenade** — up to 90 damage inside a 8 m blast, with falloff and line-of-sight checks.
* **Molotov** — a pool of fire that burns anyone standing in it, and that bots will walk around.

### Movement and accuracy

Standing still gives you the weapon's base cone. Moving adds a penalty scaled per weapon, so the
same sprint that barely affects a Tec-9 makes an AWP useless:

```
Tec-9  ▏                     easy while running
Glock  ▏▎                    medium
Sheriff▏▍                    hard while running
AK-47  ▏▋                    very hard while moving
AWP    ▏█                    hopeless while moving
```

Crouching tightens the cone further; jumping widens it a lot.

## Maps

Both maps are around **120 m across** with two bomb sites, long rotations and multiple lanes.

* **HARBOR** — container yard and warehouses. Long east lane, tight west main, a central warehouse
  that both teams fight through.
* **SANDSTONE** — desert village. Open plaza in the middle, market alleys down both wings.

## Controls

**Phone (touch)**

* Left stick: move · right side of the screen: look
* `FIRE` · `JUMP` · `CROUCH` · `R` reload · `WALK` (quiet, accurate) · `SCOPE` (AWP only)
* `PLANT` / `DEFUSE`: hold the amber button when you are on the site or on the bomb
* Slot strip on the right: tap to swap weapons; tap the pistol slot again to change fire mode;
  tap the utility slot again to cycle through your grenades
* `BUY` opens the shop during the buy phase, `☰` is the scoreboard, `||` pauses
* While dead, tap the spectate bar to switch team mate

**Desktop**

`WASD` move · mouse look (click to lock the pointer) · left click fire · right click / `F` scope ·
`R` reload · `1`–`5` slots · `B` fire mode / buy menu · `E` plant, defuse, pick up the C4 ·
`G` cycle utility · `C` crouch · `Shift` walk · `Tab` scoreboard · `Esc` pause

## Bots

Bots path across the map with A* over a navigation grid built from the level geometry. They hold
angles, rotate to gunfire they hear, push sites together, escort the carrier, plant, defuse under
pressure, throw utility, stop moving before taking a shot with a heavy gun, and buy with the same
economy rules you do. Four difficulty levels change reaction time, aim error, spray discipline and
how often they use utility.

## Settings

Language (English / Türkçe), sensitivity, separate scope sensitivity, FOV, graphics preset
(texture resolution, shadows, pixel ratio), left-handed view model, an auto-shoot assist for small
screens, and a full crosshair editor (colour, thickness, length, gap, dot, outline). Everything is
saved in `localStorage`.

## Technical notes

* Rendered with three.js r128 (loaded from cdnjs) — a single `index.html`, everything else is
  generated at runtime.
* **Textures:** each surface is built from layered value noise into an albedo canvas, then a normal
  map is derived with a Sobel filter over the height field, plus roughness maps for metals on the
  high preset. 17 surfaces at up to 512², generated with a progress bar on the loading screen.
* **World:** data-driven maps of axis-aligned blocks; the same blocks feed collision, bullet
  raycasts (slab test), the navigation grid and the radar.
* **Combat:** hitscan against per-limb hitboxes (head sphere, torso box, leg box) with per-weapon
  damage, plus a knife that checks whether you are behind your target.
* **Audio:** every gunshot, reload click, footstep, bomb beep and explosion is synthesised with the
  Web Audio API and attenuated by distance.
* `window.STRAY` exposes the match state, agents and most game functions for tinkering from the
  browser console.

## Development

There is no build step — edit `index.html` and reload. The gameplay rules are covered by a headless
test suite (42 checks over the damage table, economy, loadout persistence, buy restrictions, plant
and defuse timing, and every round-ending condition) that runs against the real page in Chromium
with Playwright.

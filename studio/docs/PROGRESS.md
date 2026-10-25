# Progress

Status of the 16 phases of the Saint Marrow Developer Studio instructions. “Done” means: the feature exists, its buttons do real work, and it is covered by the tests named. “Partly” says exactly what is missing. Nothing here is claimed without a test; what has *no* test is listed in [TESTING.md](TESTING.md) and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

| # | Phase | Status | Where | Verified by |
|---|---|---|---|---|
| 1 | Analyse the real source, project guide, backup | Done | `../CLAUDE.md`, `../backups/` (tarball + SHA-256 of every original file) | `00-original-backup-intact` (3 tests) |
| 2 | 3D editor workspace (viewport, gizmos, hierarchy, inspector, undo/redo, panels, shortcuts) | Done | `js/viewport`, `js/tools`, `js/ui` | `editor` (browser), `scene-model`, `history-commands`, `app-level` |
| 3 | Map / environment builder; **Create new map** and **Import existing map** with an honest report | Done (all chapters of the game importable, the epilogue too; JS logic is not) | `js/core/importers/sm-chapter.js`, `js/tools/build.js` | `importer-chapters` (41), `chapter` (browser), **`original-oracle`** (runs the real game and compares) |
| 4 | External asset import (glTF/GLB, OBJ(+MTL), FBX, images, audio), inspection, licence confirmation, refusal of code | Done | `js/assets` | `assets-classify`, `assets` (browser) |
| 5 | Material / texture editor with live preview, clone-before-edit for shared materials | Done | `js/workspaces/materials.js`, `js/ui/matpreview.js` | `assets` (browser) |
| 6 | Cinematic / jumpscare timeline (camera, transform, property, audio, event, text, fade, shake, flash, animation) | Done | `js/core/sequence.js`, `js/ui/timeline.js` | `sequence` (15), `timeline` (browser) |
| 7 | Script / plugin system: sandbox, permission prompts, approvals, code editor, nothing runs automatically | Done within the limits in PLUGINS.md | `js/core/plugins.js`, `js/ui/sandbox.js`, `js/workspaces/plugins.js` | `plugins` (10 unit + 17 browser incl. hostile code: network, storage, infinite loops, flooding) |
| 8 | Audio Studio (mixer, spatial preview, distance models, occlusion, zones, footsteps, reverb) | Done; rules are the Studio’s own | `js/core/audio.js`, `js/workspaces/audio.js` | `audio` (12 unit + 13 browser) |
| 9 | Enemy / boss AI editor (state graphs, senses, stats, arena test) | Done; archetypes are Studio-made | `js/core/ai.js`, `aisystem.js`, `js/workspaces/enemies.js` | `ai`, `aisystem`, `enemies` (browser) |
| 10 | Chapter / story event-graph editor — **never auto-generated** | Done | `js/core/events.js`, `story.js`, `js/workspaces/events.js`, `story.js` | `events` (14 + browser), `story` (9 + 9) |
| 11 | Weapon and animation tools (stats, recoil, viewmodel pose, clip preview, test range) | Done; feel curves of the game not imported | `js/core/weapons.js`, `js/workspaces/weapons.js` | `weapons` (9 unit + 10 browser), `combat` (browser) |
| 12 | Hitbox and bug diagnostics with classification and issue tracker | Done | `js/core/diagnostics.js`, `js/workspaces/diagnostics.js` | `diagnostics` (10 + 9), original-oracle |
| 13 | Playtest mode (walk, doors, items, triggers, checkpoints, weapons, enemies, audio, scripts) | Done; **approximates** the game | `js/core/playtest.js`, `js/ui/playtest.js` | `playtest` (15 + browser), `combat`, `audio` |
| 14 | Save / open / autosave / backup / export / bundle with a versioned format | Done | `js/store`, `js/core/project.js` | `project-format` (12), `editor`/`assets` (browser) |
| 15 | Performance (stats, budgets, hot spots, render scale, on-demand rendering) | Partly: measures and advises; **no instancing or static merging yet** | `js/core/perf.js`, `js/ui/perf.js` | `perf` (4), `diagnostics` (browser) |
| 16 | Real automated tests, documentation, compatibility report, known limitations | Done | `tests/`, `docs/` | `docs-fresh` keeps the generated reports in step with the code |

## What the Studio does not do (on purpose)
* It does not change, repack or export into the playable game. (The game was reworked separately, by hand, on 2026-10-25 — see below; the original stays in `backups/`, checked by `00-original-backup-intact`.)
* It does not write story, levels or enemies for you. The only content that comes from outside is what you import and the *read-only* conversion of the original chapters’ map data.

## Decisions log
* **No build step, no framework.** Plain ES modules and vendored libraries (`lib/`) so the Studio opens from any static server and can be audited. Cost: no tree-shaking, more files.
* **DOM-free core.** All rules live in `js/core` so they can be tested in Node without a browser; the UI is a thin layer (see ARCHITECTURE.md).
* **One command path.** Every edit — including plugin edits and `setData` on non-scene data — goes through `History`, so undo/redo and dirty-tracking cannot be bypassed.
* **Use the real game as an oracle.** Importer and validator claims about the original are checked against the original running in Chromium (read-only), not against my own reading of its source. It found one real importer bug (the chapter 5 gate imported closed) and several validator false positives, all fixed.
* **Classify issues, never hide them.** Every validator issue on the imported chapters is kept and given a class (`bug / quirk / script / limit / note / unverified`) with evidence; “unverified” stays visible rather than being relabelled as fine.
* **Sandbox with a deadline per message.** The first design trusted timers for the plugin deadline; a flooding plugin starved them (a 23 s hang), so the deadline is checked on every message and in-flight work is capped.
* **Plugin approvals are per browser, keyed by project id + code hash,** and never stored in the project file, so a received project is always “not approved”.
* **Story, enemies and weapons are data, not code.** They are plain JSON in the project; scripts are separate, and permission-gated.
* **Budgets are guidance.** Performance budgets are the Studio’s numbers and are labelled as such; they are not the game’s limits.
* **Docs that contain numbers are generated** (`tools/gen-docs.mjs`) and a unit test fails when they drift, so COMPATIBILITY.md and DIAGNOSTICS.md cannot silently go stale.

## The game rework (2026-10-25)
The user asked for the game itself to be reworked to the story design document (v0.1): scary, no bugs, good hitboxes, a new viewmodel and reloads, and more use of the Studio. What changed, and how it is checked:

| Area | What | Checked by |
|---|---|---|
| Story structure | Six chapters as in the document — 1 The Woods, 2 Inside, 3 Below, 4 and 5 **draft** (labelled in the game), 6 Burn the Memory — plus a hidden epilogue (out through the woods, the hospital comes down). 1–5 players. Nothing from the document's "later decisions" list is invented. | `game-woods`, `game-inside`, `game-drafts`, `game-finale`, `game-epilogue` (every chapter finished with real keys) |
| The watcher | A tall figure that stands between the trees and vanishes when approached, stared at or lit; seen once more when the gate closes. Host-driven, synced in co-op. | `game-woods` (gate closes → figure appears) |
| Viewmodel | Two-bone IK arms and posed hands; pistol, rifle, crowbar and torch rebuilt; keyframed reloads whose sounds come from the animation. | `game-viewmodel` (sound order, ammo, magazine back in the grip) |
| Hitboxes | Capsules fitted to each creature's skinned mesh per bone (head / torso / limbs); F9 shows them. | measured: head 30/30, coverage 92 % (Hollow), 88 % (Warden) |
| Stealth | Patrol routes, bottles to throw (X), noise pulls the patrol. | `game-inside` (thrown bottle → patrol investigates) |
| Performance | Trees batched per 12 m tile (frustum, shadow and fog culling now work; 218k → 142k triangles a frame in the woods); fire lights go through the light pool. | measured on software GL |

**Bugs the Studio and the playthrough tests found in the game, all fixed:** chapter 6's east console used the legend letter `B`, which the grid reads as an exterior wall, so the chapter could not be finished (the importer now reports any legend letter that is a tile letter); a timer that loads the next chapter crashed the frame (the timer list was replaced mid-loop); the chapter 6 exit and the stairs triggers were one-shot although their handlers wait for a condition, so visiting them early soft-locked the chapter; the security code note and the lab plan lay on the floor in front of their desks; the epilogue showed "use" prompts that did nothing; four basement doorways were walled up; the fuse box use point was 2.9 m up; blood writing floated in mid-air. The Studio's own false alarms found on the way (prefix handlers counted as dead triggers, painted windows expected to cut walls, the gate pose hard-coded per chapter number) were fixed in the Studio.

## Measured (software rendering, so absolute speed is pessimistic)
Chapter 2 imported: 413–466 objects depending on chapter; ≈540 draw calls, ≈156 k triangles, ≈524 geometries; navigation mesh 136–227 ms (≈24 k cells); full validation 189–261 ms; import ≈31 ms.

## Open items worth doing next
* Instancing / static merging for repeated props (the Performance tab already lists candidates).
* Executing story transitions across maps in the playtest.
* Importing the original chapter scripts as event graphs (needs a decision about how much of the game’s JS to translate).
* Firefox / Safari / touch coverage.

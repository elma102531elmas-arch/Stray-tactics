# Known limitations

An honest list. Where a limitation has a measured number or a test, it is named. If something is not listed here it does not mean it is perfect — it means nobody has found it yet; please add it.

## By design
* **The Studio never writes into the game, and there is no export into it.** The Studio reads `saint-marrow/` and nothing else. (The game itself was reworked on 2026-10-25 at the user's request, by hand, outside the Studio; the original is kept in `../backups/` and on the `saint-marrow-original-backup` branch, and `tests/unit/00-original-backup-intact.test.mjs` verifies the archive against its SHA-256 list.) Bringing authored content into the game is a separate, future, deliberate step.
* **Nothing is generated for you**: the Studio never writes story, dialogue or level content. The story tool stores what you type; the only data from outside is the *read-only* list of the original game’s chapters.
* **Plugins never run by themselves** and only after you review and approve them (see PLUGINS.md).

## Importing the original chapters (see COMPATIBILITY.md for per-chapter numbers)
* **JavaScript logic cannot be converted.** Chapter functions (`start/update/onTrigger/onUse/…`) are stored as read-only reference scripts and are never executed. Events they handle therefore show up as “handled by the original script” in Diagnostics. “Handled” is decided from the source text: the event's id written literally, or a `startsWith('prefix')` test that covers it (chapter 5's `relay1…3`, chapter 6's `stationW/E/N`). Any other way of matching an id would be reported as a trigger the game never handles.
* **Windows are painted, not cut.** The game draws a boarded window on the face of a solid wall cell (`builder.js windowOverlay`), so the importer places window objects tagged `overlay` on the wall face and the validator does not expect them to cut an opening. Imported walls are axis-aligned boxes (a vertical run is 1 m long and N m thick), so a real opening could not be cut into them anyway.
* **Per-session randomness is not reproducible**: random clutter props, which wall a wall-mounted prop picks when several are adjacent (the first in N,E,S,W order is used), random prop rotations, procedurally scattered old-blood decals. The oracle test compares such props by footprint rather than exactly.
* **Props the game builds in code** (lockers, sinks, gurneys, beds, trees, bodies…) have no model file; a box of the real dimensions stands in.
* **Walls use one material** (the game splits tiled lower / painted upper halves). Warden director settings are not scene data.
* **Colliders are boxes.** Both the game and the Studio use model bounding boxes for props, which are solid where the real model has open space (under a table top). Custom collider boxes can be set per asset; mesh colliders do not exist.

## Validation and navigation
* **Reachability is an approximation.** The navigation mesh uses a 0.25 m grid, agent radius 0.3 m, step height 0.45 m, treats every door as passable (locks are ignored) and knows nothing about scripts, ladders, elevators or flooding. On the reworked game it flags nothing in any chapter, and the oracle test checks that the game's own pickup logic agrees for every item and use point. (Before the rework it flagged the hut interior behind a 0.43 m gap and a basement region only scripts joined; both are gone from the game.)
* **Interaction reach** uses the game’s 2.4 m and a straight line from a 1.62 m eye; the game’s own picking has a slack that grows with distance, which is not modelled.
* Validation is point-in-time: press F7 (or Validate) after changes; plugin validators run asynchronously.

## Playtest
* It **approximates** the game’s rules; it is not the game. Door swing is instantaneous for collision; there is no stamina, injury, inventory UI, crafting or multiplayer; flashlight and lighting are the viewport’s, not the game’s renderer.
* Enemies use Studio archetypes (graph of states with conditions). The reference Hollow and Warden copy the game’s **numbers**; their **behaviour graph is a generic starting point**, not the game’s AI code.
* Weapon feel (recoil curves, viewmodel animation) is not imported; the reference weapons copy stats only.
* Scripts run asynchronously in a sandbox (≈20–50 ms per run) and never block a frame; a script runs at most 30 times per 10 s.

## Audio
* The distance curves, wall occlusion (a step-down per wall or closed door between listener and source), reverb (synthetic impulse responses) and mixing are **the Studio’s own rules**, not the game’s audio engine. Panning is equal-power, not HRTF.
* Browsers keep audio suspended until a click or key press; the Audio tab and playtest start audio from one. Automated tests verify what the engine was told to do (voices, gains, cut-offs), not what comes out of speakers.

## Plugins and scripts
* The sandbox is best-effort: it cannot limit memory or CPU use within the time limit, and cannot defend against browser bugs. Approvals live in your browser’s local storage. See PLUGINS.md.

## Performance
* Budgets in the Diagnostics tab are the Studio’s own guidance, not limits of the game. **There is no instancing or static merging**: chapter 2 draws ~540 calls with ~156k triangles (measured), which is fine on a laptop GPU but leaves headroom on the table for dense maps. The Performance tab lists the instancing candidates.
* Automated tests run on software rendering (2–10 fps), so they check logic and state, never frame rate.

## Browser and device support
* **Tested in Chromium only** (Playwright). Firefox and Safari are not tested; pointer lock, Web Audio and sandboxed-iframe behaviour may differ.
* **Touch input is neither designed for nor tested** in the editor or the playtest (mouse and keyboard only; the viewport uses pointer events, so basic orbiting may work on a tablet, but nothing has been checked). The original game’s touch controls are unaffected.
* IndexedDB being blocked (private windows) falls back to session storage: save projects as files in that case.
* Very large maps (tens of thousands of objects) are untested; the biggest imported chapter is the woods (chapter 1) with 1927 objects, 1648 of them tree stand-ins.

## The game's own tests (`tests/browser/game-*.test.mjs`)
* They play every chapter with real key presses, but **walking between places is a teleport**: that a place can be reached on foot is the Studio validator's and the oracle's job, not theirs. Enemies are sent away or kept asleep where the route is what is tested.
* The woods are the heaviest scenes (~1600 trees; 142k triangles a frame after the tree batches were split into 12 m tiles, measured). Software rendering draws them at about 1 fps (the epilogue at ~0.3 fps), and the game clamps a frame to 0.1 s of game time, so `game-epilogue.test.mjs` takes about 6 minutes. That is a test-machine cost, not a game frame rate.
* `game-single-file.test.mjs` checks the committed `saint-marrow.html`; it cannot tell whether that file is older than the source (rebuilding needs esbuild, which is not a Studio dependency).

## Not covered by automated tests
Real GPU rendering fidelity, real audio output, Firefox/Safari, touch, multi-user, accessibility beyond keyboard/labels, and long-session memory growth.

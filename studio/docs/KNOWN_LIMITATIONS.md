# Known limitations

An honest list. Where a limitation has a measured number or a test, it is named. If something is not listed here it does not mean it is perfect — it means nobody has found it yet; please add it.

## By design
* **The playable game is never modified, and there is no export into it.** The Studio reads `saint-marrow/` and nothing else; `tests/unit/00-original-game-untouched.test.mjs` verifies every original file against the SHA-256 list taken before the work began (`../backups/` at the repository root). Bringing authored content into the game is a separate, future, deliberate step.
* **Nothing is generated for you**: the Studio never writes story, dialogue or level content. The story tool stores what you type; the only data from outside is the *read-only* list of the original game’s chapters.
* **Plugins never run by themselves** and only after you review and approve them (see PLUGINS.md).

## Importing the original chapters (see COMPATIBILITY.md for per-chapter numbers)
* **JavaScript logic cannot be converted.** Chapter functions (`start/update/onTrigger/onUse/…`) are stored as read-only reference scripts and are never executed. Events they handle therefore show up as “handled by the original script” in Diagnostics.
* **Per-session randomness is not reproducible**: random clutter props, which wall a wall-mounted prop picks when several are adjacent (the first in N,E,S,W order is used), random prop rotations, procedurally scattered old-blood decals. The oracle test compares such props by footprint rather than exactly.
* **Props the game builds in code** (lockers, sinks, gurneys, beds, trees, bodies…) have no model file; a box of the real dimensions stands in.
* **Walls use one material** (the game splits tiled lower / painted upper halves). Warden director settings are not scene data.
* **Colliders are boxes.** Both the game and the Studio use model bounding boxes for props, which are solid where the real model has open space (under a table top). Custom collider boxes can be set per asset; mesh colliders do not exist.

## Validation and navigation
* **Reachability is an approximation.** The navigation mesh uses a 0.25 m grid, agent radius 0.3 m, step height 0.45 m, treats every door as passable (locks are ignored) and knows nothing about scripts, ladders, elevators or flooding. Items it cannot reach are explained in DIAGNOSTICS.md: the hut interior in chapters 1 and 5 sits behind a 0.43 m gap (the original’s push-out collision might let a player squeeze through; the Studio makes no claim), and the chapter 4 basement is joined to the start by game logic.
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
* Very large maps (tens of thousands of objects) are untested; the biggest imported chapter has 466 objects.

## Not covered by automated tests
Real GPU rendering fidelity, real audio output, Firefox/Safari, touch, multi-user, accessibility beyond keyboard/labels, and long-session memory growth.

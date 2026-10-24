# Testing

```bash
node studio/tests/run.mjs unit      # DOM-free logic (node:test) — seconds
node studio/tests/run.mjs browser   # real Chromium through Playwright — minutes
node studio/tests/run.mjs all       # both; exit code is non-zero if anything fails
node studio/tests/run.mjs browser plugins   # suites whose file name contains the filter
```

Last full run (this document is updated by hand when the suites change; run the command to get today’s numbers): **367 of 367 tests passed in 35 suites** (231 unit in 21 suites, 136 browser in 14 suites; the browser run takes roughly six minutes on software rendering, the original-game oracle suite alone ≈ 2 minutes).

## How the tests are built
* **Unit tests** import `js/core` directly in Node. They check rules with independent oracles (hand-computed expectations, the original game’s own data) rather than re-running the implementation.
* **Browser tests** start the Studio on a random local port and drive it in headless Chromium with software WebGL (`--use-angle=swiftshader`). They use **real mouse and keyboard events** (menus are opened by clicking, fields typed into, nodes dragged), and read state back from the page. Most suites also assert that the page raised no uncaught error, failed request or `console.error` (the oracle suite does not).
* **The original game as an oracle** (`original-oracle`): the real Saint Marrow is loaded read-only in the same browser, and the Studio’s import is compared with what the game actually built — object counts, positions, collision boxes, door/gate state, interactable heights, and whether the game’s own `findInteractable()` can pick items the validator calls unreachable.
* Software rendering runs at 2–10 fps, so tests wait for **conditions** (`waitForFunction`) and never assert frame rate.

## Unit suites (what each proves)
| Suite | Proves |
|---|---|
| `00-original-game-untouched` | Every file of the original game is byte-identical to the pre-Studio SHA-256 list; nothing was added to `saint-marrow/`; the backup archive exists |
| `scene-model`, `history-commands` | Scene tree rules (parenting, cycles, names), every command’s do/undo/redo round trip, merging and transactions |
| `project-format` | Versioned format, migrations, refusal of newer/foreign files, bundle round trip with hashes, unsafe zip paths rejected |
| `app-level` | App object without a DOM: creating nodes, selection, copy/paste, the Room tool as one undo step, doors cutting wall openings, action dispatch, project replacement |
| `assets-classify` | File classification, refusal of executable/script files with help text |
| `collision-nav` | Raycasts, pushes, ground queries, nav mesh components and reachability |
| `importer-chapters` | The five chapters import with pinned counts, preserve coordinates, report what cannot be imported |
| `validation` | Each validator check fires on a crafted case and stays quiet on a clean one |
| `events`, `sequence` | Event runtime semantics (clock, loops, budgets), timeline evaluation and player semantics |
| `playtest`, `weapons`, `ai`, `aisystem` | Player movement and interaction rules, weapon stats/recoil/ammo, enemy state machines and senses, hit zones |
| `audio` | Distance models, occlusion, zone priority, footstep surface lookup, reverb IR, sound analysis |
| `plugins` | Permissions, approvals keyed by code hash, record validation, imported-record sanitising, API router limits |
| `story` | Reachability/dead ends/loops/paths over a hand-authored graph, item checks, outline export |
| `diagnostics` | Classification of every issue on every imported chapter (pinned class counts; no “bug” or “unverified”), tracker keys stable across re-import |
| `perf` | Budget evaluation and hot-spot detection on synthetic scenes |
| `docs-fresh` | COMPATIBILITY.md / DIAGNOSTICS.md match what the code generates now; required documents exist |

## Browser suites
| Suite | Proves (with real input) |
|---|---|
| `editor` | Boot, menus, creating objects, inspector edits (and rejected input), click/shift-click/marquee selection, dragging, keyboard duplicate/delete/group, hierarchy (rename, hide, lock, search, reparent), Room and Wall tools, save → reload → open |
| `chapter` | Importing a chapter through the UI with its honest report, non-blank render and draw-call count, virtualised hierarchy, validation with click-to-frame, explicit undoable auto-fix, collision/navigation overlays, undo of the whole import |
| `assets` | Licence confirmation before import, GLB/glTF/texture/WAV inspection, duplicate detection, corrupt-file errors, placing models, built-in game assets read-only until copied, materials and prefabs, persistence across reload, `.smproj` bundle round trip |
| `events`, `timeline` | Editing event graphs and sequences in the UI; previewing a sequence changes the viewport and **restores** the scene afterwards |
| `playtest` | Starting/stopping a playtest, walking, doors/pickups/triggers, the scene JSON is identical before and after |
| `combat`, `weapons`, `enemies` | Firing with the mouse hits and damages enemies by zone, reloading, the weapon workspace’s edits take effect in the test range, enemy graph editing and arena tests |
| `audio` | Audio Studio edits change what the engine plays (voices, gains, cut-offs), footsteps in playtest follow the surface |
| `plugins` | Review-and-approve flow, approvals withdrawn on edit, hostile code (network, storage, timers, flooding, infinite loops) contained, one undo step per command, scripts run in playtest only after approval |
| `story` | Building a story graph with the mouse, analysis results, outline export, nothing generated automatically |
| `diagnostics` | Triage table with “Why?” evidence, filters, issue tracker (track, status, notes, undo), your own objects classified as bugs in your map, Markdown export, hit-box overlay and calculator, performance panel with measured steps |
| `original-oracle` | Studio import equals the running original (see above) |

## What is NOT tested (so nobody assumes it is)
* Real GPU output, visual fidelity, frame rate, or memory growth over long sessions.
* Real audio output — tests verify what the Web Audio graph was told, not what a person would hear.
* Browsers other than Chromium; touch input; screen readers.
* The original game’s runtime behaviour beyond what the oracle reads (its AI, scripts and physics feel).
* Very large maps (the largest imported chapter has 466 objects).
* Flakiness: the plugins browser suite once failed 1 test of 17 and could not be reproduced in six re-runs; diagnostic logging was added. If it fails for you, re-run once and report the output.

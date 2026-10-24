# Architecture

Saint Marrow Studio is a separate, browser-based developer environment. It lives entirely in `studio/` and **reads** the original game (`saint-marrow/`) but never writes to it. It is plain ES modules — no build step, no framework — served as static files (`node studio/serve.mjs`).

```
studio/
  index.html, css/            shell page and styles
  js/
    app.js, main.js  App object (project, history, selection, events, actions) and start-up
    core/        DOM-free model and rules (runs in Node → unit-tested)
    viewport/    three.js rendering of the model, gizmos, overlays
    tools/       viewport tools (select, build wall/room/corridor, measure)
    assets/      import pipeline, asset library, classification
    store/       project files, bundles, autosave, IndexedDB
    ui/          panels, dialogs, widgets, sandbox, playtest session
    workspaces/  one file per centre tab (Events, Story, Enemies, Weapons, Audio, Plugins, Diagnostics, Assets, Materials)
    actions/     the action registry (menus, shortcuts, commands)
  lib/           vendored third-party code (three.js r170 + loaders, fflate, acorn, decoders)
  assets-builtin/ index of the original game's CC0 assets (read-only references)
  tests/         unit (Node) and browser (Playwright/Chromium) suites
  tools/         generators (built-in library index, generated docs)
  serve.mjs      tiny static server (serves the repo root so /studio/ and /saint-marrow/ both resolve)
  docs/          this folder
../backups/      tarball + SHA-256 list of the original game, taken before any work began (repo root, outside studio/)
```

## Layers and the rule between them

1. **`core/` never touches the DOM** (it imports three.js math only). Everything that can be decided without a screen is decided here: the scene model, commands and undo, validation, collision and navigation, the playtest world, enemy AI, weapons, event graphs and sequences, audio rules, story analysis, plugin permissions, diagnostics, performance analysis. This is why most behaviour is covered by fast Node tests.
2. **UI modules talk to the `App`** (`js/app.js`), not to each other. `App` owns the open project, history, selection, asset library and the action registry, and emits events (`scene`, `selection`, `history`, `project`, `issues`, `plugins`…).
3. **Every edit is a command** (`core/commands.js`) executed through `History` (`core/history.js`): undoable, mergeable (`mergeKey` coalesces drags/typing), groupable into transactions (`app.tx`). Panels never mutate the model directly. Project data outside the scene (events, enemies, weapons, audio, story, plugins…) is edited with `setData(path, value)`, also a command.

## Data model

* **`SceneModel`** (`core/scene.js`): nodes with `id, name, type, parent, children, t{p,r,s}` (position, rotation in degrees XYZ, scale), `visible, locked, props, tags, meta`. Node types and their properties are declared once in `core/schema.js` (`def(type, {props, box, …})`); the inspector, validators, builders and importers all read that schema.
* **`Project`** (`core/project.js`): `{ meta, data, scene }`. `data` holds everything else as plain JSON: `settings, environment, materials, assets, libraries, prefabs, events, sequences, enemies, weapons, audio, story, plugins, scripts, issues, importReport`.
* **Versioned file format**: `format: "saint-marrow-studio-project"`, `version: 1` (`FORMAT_VERSION`), migrations chained in `migrations[]`; a file from a newer Studio is refused with a readable message. `store/bundle.js` writes `.smproj` (zip: manifest with per-file SHA-256, `project.json`, asset files); unsafe paths are rejected on read.
* **Persistence**: IndexedDB (`store/storage.js`) with an in-memory fallback when it is blocked; autosave on a timer; a backup is kept on every save; “recover unsaved work” is offered on start. Preferences use `localStorage` (wrapped in try/catch).

## Geometry, collision and navigation (all DOM-free)

`core/geometry.js` turns nodes into world-space colliders (oriented boxes; walls are cut around door/window nodes). `core/collision.js` (`CollisionWorld`) answers raycasts, sphere pushes, ground queries and moves the player. `core/navmesh.js` builds a multi-level 0.25 m grid mesh by probing the collision world with agent-sized spheres, links neighbours, labels components and flags the ones reachable from player spawns; `interactableFrom()` answers “can a player standing somewhere reachable use this object?” with reach and line of sight. The viewport, validation, the enemy AI and the playtest all use the same collision world, so what you see, what the validator checks and what the playtest does agree.

## Viewport (`viewport/`)

`SceneView` mirrors model → three.js objects (per-node entries with root, helpers, extras). Rendering is **on demand** (nothing is drawn while idle), editor helpers live on a separate layer, lights use a fixed pool of the nearest lights (`lightrig.js`), shading modes are lit / game / wire / normals, overlays (`overlays.js`) draw collision, navigation, issues, bounds, light ranges and hit boxes. `?lowfx=1` and the render-scale preference exist for slow GPUs and for the software-GL used in tests.

## Importers

* **Chapter importer** (`core/importers/sm-chapter.js`) reads the original game’s modules *read-only* (`loadGameModules`), converts a chapter’s map grid, legend, props and markers into scene nodes, keeps 1 cell = 1 m and the original coordinates, stamps `meta.source` on every object, and produces an honest report of what it could not import. The original chapter functions are stored as read-only reference scripts and are never executed.
* **Asset importer** (`assets/importer.js`, `classify.js`): classifies files, resolves glTF/OBJ dependencies, inspects models (triangles, bounds, materials, animations), images and audio, refuses code, requires a licence confirmation, and reports every problem per file.

## Event graphs, sequences, story

`core/events.js` — typed graph nodes (triggers, flow, actions), an `EventRuntime` with a virtual clock, loop and step budgets, static analysis merged into validation. `core/sequence.js` + `seqhost.js` — timeline tracks (camera, transform, property, audio, event, text, fade, shake, flash, animation), a player with cancel/skip semantics and capture/restore of the scene. `core/story.js` — the author’s chapter/ending graph, items and notes, with structural checks. The generic graph editor (`ui/graph.js`) serves events, enemy state machines and the story.

## Playtest

`core/playtest.js` (`PlaytestWorld`) runs a map: walking with the game’s reference speeds, doors and locks (mirroring the game’s `interact()` rules), pickups, interaction volumes, triggers, checkpoints, noises, weapons (`core/weapons.js`), enemies (`core/aisystem.js`, `core/ai.js`), audio events, script requests. It **never edits the scene model**; the UI (`ui/playtest.js`) renders first-person view, HUD, death/pause screens, and restores everything on stop (the test suite compares the scene JSON before and after).

## Audio

Rules in `core/audio.js` (bus mixing with mute/solo, Web-Audio distance models plus a smooth range cut-off, wall occlusion by counting blockers, zone priority, footstep surface lookup, synthetic reverb impulses, sound analysis). `ui/audioengine.js` turns them into Web Audio nodes; `workspaces/audio.js` is the Audio Studio; the playtest uses the same engine.

## Plugins and scripts

`core/plugins.js` defines records, permissions, static analysis (acorn), per-browser approvals keyed by code hash, and the permission-checked `ApiRouter`. `ui/sandbox.js` runs approved code in a sandboxed iframe (opaque origin, own CSP) hosting a Worker with network/storage globals removed. Details and limits: [PLUGINS.md](PLUGINS.md).

## Diagnostics and performance

`core/diagnostics.js` classifies validator issues (bug / original quirk / original script / Studio limitation / note) with cited evidence and runs the issue tracker; `core/perf.js` evaluates budgets and finds hot spots; the Diagnostics workspace is the view. Hit-box constants are shared with the playtest’s hit-scan (`core/aisystem.js`).

## Testing strategy

See [TESTING.md](TESTING.md). In short: DOM-free core logic is unit-tested with independent oracles; every workspace is driven in real Chromium with real mouse and keyboard events; and the **original game itself** is run as an oracle for importer and validator claims.

# Stray Tactics / Saint Marrow — project guide

Two things live in this repository:

| Path | What | May you change it? |
|---|---|---|
| `saint-marrow/`, `saint-marrow.html` | The **playable game** (Saint Marrow, no build step: ES modules + vendored three.js; `saint-marrow.html` is a single-file build of it) | **Yes, since 2026-10-25** — the user asked for the game to be reworked to the story design (see below). |
| `stray-tactical.html` | An older, unrelated prototype | Leave it alone unless asked. |
| `studio/` | **Saint Marrow Studio**, a separate browser-based developer environment | Yes. |
| `backups/` | Tarball + SHA-256 list of the original game, taken before any of this work | **Never edit.** The git branch `saint-marrow-original-backup` holds the same original, including the single-file build. |

## History of the "do not touch the game" rule
Until 2026-10-24 the game was frozen: the user's Studio brief said to build tools only. On 2026-10-25 the user asked for the game itself to be reworked ("make the game good, no bugs, good hitboxes, rebuild the viewmodel/reload, follow this story"). The freeze is lifted for that; the backup is not. `studio/tests/unit/00-original-backup-intact.test.mjs` checks every file in the backup archive against the manifest.

## Non-negotiable
1. Keep the original recoverable: never edit `backups/` or the `saint-marrow-original-backup` branch.
2. Story decisions belong to the user (the "oyun yönetmeni"). The story design document (Saint Marrow — Hikâye Tasarım Dosyası v0.1) is the source: chapters 1–3 and 6 follow it; chapters 4 and 5 are marked **draft / not approved** in the game and must stay clearly labelled as such until the user decides. Things the document lists under "later decisions" (why the team came, character identities, the creature's name, the final boss) are not invented — leave them open or neutral.
3. No fabricated data: never invent imported game data, never silently replace models/assets. Only use external assets whose licences permit it, and say so.
4. Do not claim a feature works unless a test (or a run you actually did) shows it. Do not claim tests ran if they did not. Known problems go in `studio/docs/KNOWN_LIMITATIONS.md` (Studio) or the game README.
5. Buttons and menus must perform real actions — no static mock-ups.
6. Third-party/untrusted code (plugins, scripts) must never run automatically; it needs the user's review and approval first (see `studio/docs/PLUGINS.md`).
7. The Studio only **reads** the game (importer, oracle tests); Studio content is not exported into the game automatically.

## Game at a glance
* Entry: `saint-marrow/index.html` (needs a static server: `node studio/serve.mjs` and open `/saint-marrow/`). `window.__game` exposes the running game for tests.
* `js/chapters/chapters.js` (chapter scripts + legends), `js/chapters/maps.js` (ASCII maps, 1 cell = 1 m), `js/world/*` (level building, props, doors, lights), `js/entities/*` (player, viewmodel, enemies, creatures), `js/engine/*` (renderer, audio, input, textures), `js/i18n.js` (English + Turkish text).
* After changing the game, rebuild the single file: `node studio/tools/build-game-single.mjs` (writes `saint-marrow.html`).

## Studio at a glance
* Plain ES modules, **no build step**. `node studio/serve.mjs [port]` serves the repo root; open `/studio/`.
* `studio/js/core/` is **DOM-free** (three.js math allowed, `document`/`window` not). Keep all rules there so they run in Node tests. UI code (`ui/`, `workspaces/`, `viewport/`, `tools/`) is a thin layer over it.
* **Every edit is a command** run through `History` (`core/commands.js`, `core/history.js`), including `setData(path, value)` for project data outside the scene. Never mutate the model directly from UI code, or undo/redo and dirty tracking break.
* Node types and their properties are declared once in `core/schema.js`; inspector, validation, builders and importers read that.
* Project file: `.smproj` zip, `format: "saint-marrow-studio-project"`, `FORMAT_VERSION` in `core/project.js`. Changing stored shape ⇒ bump the version and add a migration.
* Layout and rationale: `studio/docs/ARCHITECTURE.md`. Phase status and decisions: `studio/docs/PROGRESS.md`.

## Commands (run from the repository root)
```bash
node studio/tests/run.mjs unit             # fast, DOM-free (node:test), seconds
node studio/tests/run.mjs browser          # real Chromium via Playwright, minutes
node studio/tests/run.mjs all              # everything; non-zero exit on failure
node studio/tests/run.mjs browser plugins  # only suites whose file name contains "plugins"
node studio/tools/gen-docs.mjs             # regenerate docs/COMPATIBILITY.md and docs/DIAGNOSTICS.md
node studio/tools/make-builtin-library.mjs # rebuild assets-builtin/library.json (index of the game's CC0 assets; needs the npm packages listed at the top of that file, not part of the Studio itself)
```
Run them from the repo root; a `cd` into a subfolder inside a multi-command line has broken relative paths before.

## Testing requirements
* A new feature needs a test that exercises it: **unit** for logic in `core/`, **browser** for anything a person clicks. Browser tests must use real mouse/keyboard input through Playwright, not call internal functions to fake the result.
* Before committing, run `node studio/tests/run.mjs all` and look at the result. Do not chain `git commit` after a pipe (`| tail`) — the exit status is lost and a failing run still commits.
* Pinned facts (per-chapter object counts, diagnostic class counts, unreachable item lists) are asserted in tests on purpose: a change that moves them should be understood, not silenced.
* **Generated docs**: `COMPATIBILITY.md` and `DIAGNOSTICS.md` come from `tools/docs-lib.mjs`. `tests/unit/docs-fresh.test.mjs` fails when they are stale — regenerate with `gen-docs.mjs` and review the diff. Never hand-edit those two files.
* Game changes move Studio facts (chapter object counts, diagnostics, the oracle test): update the pinned numbers deliberately and regenerate the docs.
* **Test pitfalls**: Chromium runs on software GL (2–10 fps), so wait on *conditions* (`waitForFunction`, state checks), never fixed sleeps, and never assert frame rate. The original-game oracle suite (`original-oracle.test.mjs`, ~2 min) loads the real game read-only. Tests start their own server on a random port (`startServer(0)`).
* Do not put randomness into anything a test or generated doc compares: node ids are random per import — compare by name/source cell.

## Style
Match the surrounding code: short comments that say *why*, no framework, no new dependencies unless vendored into `studio/lib/` with its licence noted. Commit messages end with the session attribution lines. Do not open pull requests unless asked.

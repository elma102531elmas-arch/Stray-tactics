# Stray Tactics / Saint Marrow — project guide

Two things live in this repository:

| Path | What | May you change it? |
|---|---|---|
| `saint-marrow/`, `saint-marrow.html`, `stray-tactical.html` | The **playable game** (Saint Marrow, no build step: ES modules + vendored three.js) | **NO.** See "Non-negotiable" below. |
| `studio/` | **Saint Marrow Studio**, a separate browser-based developer environment | Yes — this is where work happens. |
| `backups/` | Tarball + SHA-256 list of the original game, taken before the Studio was started | Never edit. |

## Non-negotiable: the playable game is protected
1. Do not modify, move, delete or add files under `saint-marrow/`, nor `saint-marrow.html` / `stray-tactical.html`. `studio/tests/unit/00-original-game-untouched.test.mjs` hashes every original file against `backups/saint-marrow-original.sha256` and fails on any difference, including new files inside `saint-marrow/`.
2. Do not integrate editor content into the game, and do not add gameplay content to the playable beta. The Studio only **reads** the game (importer, oracle tests).
3. Developer tools, diagnostics and editor functionality are allowed — in `studio/`.
4. No fabricated data: never invent imported game data, never silently replace existing models/assets, never generate story/levels for the user. Only use external assets whose licences permit it, and say so.
5. Do not claim a feature works unless a test (or a run you actually did) shows it. Do not claim tests ran if they did not. Anything not working belongs in `studio/docs/KNOWN_LIMITATIONS.md`.
6. Buttons and menus must perform real actions — no static mock-ups.
7. Third-party/untrusted code (plugins, scripts) must never run automatically; it needs the user's review and approval first (see `studio/docs/PLUGINS.md`).

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
* **Test pitfalls**: Chromium runs on software GL (2–10 fps), so wait on *conditions* (`waitForFunction`, state checks), never fixed sleeps, and never assert frame rate. The original-game oracle suite (`original-oracle.test.mjs`, ~2 min) loads the real game read-only. Tests start their own server on a random port (`startServer(0)`).
* Do not put randomness into anything a test or generated doc compares: node ids are random per import — compare by name/source cell.

## Style
Match the surrounding code: short comments that say *why*, no framework, no new dependencies unless vendored into `studio/lib/` with its licence noted. Commit messages end with the session attribution lines. Do not open pull requests unless asked.

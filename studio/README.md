# Saint Marrow Studio

A browser-based developer environment for **Saint Marrow**: a 3D map editor, importer, asset/material tools, event-graph and story editors, cinematic timeline, audio studio, enemy/weapon editors, plugin sandbox, diagnostics and playtest — all in a separate workspace. **It never modifies the playable game** (`../saint-marrow/`), which is verified by a test.

## Run it
```bash
node studio/serve.mjs 8765        # then open http://127.0.0.1:8765/studio/
```
Only a static file server is needed (it serves the repository root so both `/studio/` and `/saint-marrow/` resolve). Use a Chromium-based browser; it is the only one tested.

Start screen: **New map** (blank or a template), **Import existing map** (chapters 1–5 of the game, with a report of what could and could not be converted), **Open** a `.smproj` bundle, or recover an autosave.

## Where things are
| | |
|---|---|
| `js/core` | DOM-free model, rules, validation, playtest world, AI, audio rules, story, plugins, diagnostics |
| `js/viewport`, `js/tools`, `js/ui`, `js/workspaces` | Rendering, tools, panels and the centre tabs |
| `js/assets`, `js/store` | Asset import pipeline; project files, bundles, autosave |
| `lib/` | Vendored three.js r170, loaders, fflate, acorn (third-party licences apply) |
| `tests/` | `unit` (Node) and `browser` (Playwright + Chromium) |
| `docs/` | The documents below |

## Tests
```bash
node studio/tests/run.mjs unit        # fast, no browser
node studio/tests/run.mjs browser     # real Chromium, ~minutes (software GL)
node studio/tests/run.mjs all         # both; non-zero exit on any failure
node studio/tests/run.mjs browser audio   # only suites whose file name contains "audio"
```
Browser tests need `playwright` and Chromium (`require('playwright')` must resolve). What the tests prove — and what they do not — is in [docs/TESTING.md](docs/TESTING.md).

## Documents
* [PROGRESS.md](docs/PROGRESS.md) — phase checklist, decisions, measurements
* [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) — read this before trusting a result
* [COMPATIBILITY.md](docs/COMPATIBILITY.md) — what imports from the game and what does not (generated)
* [DIAGNOSTICS.md](docs/DIAGNOSTICS.md) — every validator issue on the imported chapters, triaged with evidence (generated)
* [ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, data model, file format
* [PLUGINS.md](docs/PLUGINS.md) — plugin/script security model and its limits
* [TESTING.md](docs/TESTING.md) — test suites and gaps

## Licences
The repository has no licence file yet, so no licence is granted for the Studio code by this folder. Vendored libraries in `lib/` keep their upstream licences: three.js (MIT, header in file), fflate (MIT, header in file), meshoptimizer (MIT, header in file), Basis Universal transcoder (Apache-2.0, `lib/basis/README.md`). The upstream licences of acorn, ktx-parse, zstddec and the Draco decoder are not copied into `lib/` — check those projects before redistributing. Imported assets stay under their authors’ licences: the importer asks you to confirm the licence of every file and records the answer in the project.

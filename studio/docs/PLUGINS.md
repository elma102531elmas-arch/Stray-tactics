# Plugin & script security

Saint Marrow Studio lets you extend the editor with **plugins** (menu commands, validators) and run **scripts** inside the playtest.
Both are JavaScript programs. This page says exactly what protects you, what does not, and how to use them safely.

## The rules

1. **Nothing runs by itself.** Opening a project, importing a file or switching tabs never executes plugin or script code. A project can *contain* plugins; they stay switched off.
2. **You approve code before it runs.** The *Review & approve* dialog shows the permissions requested, what the code analyser noticed and the **complete source**. You must tick “I have read this code”. Code that uses dynamic-code tricks needs a second confirmation.
3. **Approvals stay in this browser.** They are stored in your browser's local storage, keyed by *project id + code hash*. They are never written to the project file, so a project you receive from someone else is always *not approved*, even if the author approved it on their machine.
4. **Any change withdraws the approval.** Editing the code, or asking for more permissions, makes the plugin “Changed — review again” and stops it.
5. **Imported code is inert.** Imported plugins get a fresh id, no permissions beyond what the file lists (and those are only *requested*), and flags such as `enabled` / `approved` in the file are ignored. `.js` files cannot be imported as assets at all.
6. **Every action is a permission.** Code can only do what the permissions you granted allow (table below). Anything else is refused with a clear error in the plugin console.
7. **Changes to your map are one undo step.** A plugin command's edits are collected and applied together only if the command finishes successfully; if it fails or times out, nothing is applied. One *Undo* reverts everything it did.
8. **Scripts cannot edit the map.** They run in the playtest and may only change the playtest state (flags, items, doors, lights, messages). They have no `scene.write` permission by design.

## Permissions

| Permission | Kind | Lets the code… |
|---|---|---|
| `scene.read` | plugin, script | read objects in the map (names, positions, properties) |
| `scene.write` | plugin | create, change and delete objects — applied as one undoable step |
| `project.read` | plugin | read settings, materials, the asset list, event graphs, sequences, enemies, weapons, audio, story, prefabs |
| `ui.menu` | plugin | add commands to the **Plugins** menu |
| `ui.validate` | plugin | add checks to the validator (shown in Issues, marked *plugin*) |
| `files.download` | plugin | offer a file to save — you are asked each time |
| `game.read` | script | read flags, items, door/light state, player position, time |
| `game.write` | script | set flags, give/take items, open/lock doors, switch lights, show messages, set objectives, emit events |

Logging (`api.log`) and short notifications need no permission. **No permission exists for network access, reading your files, or touching the rest of the Studio** — they cannot be granted.

## How the sandbox works

```
Studio page ── postMessage ──▶ <iframe sandbox="allow-scripts" srcdoc>  ── Worker (your plugin's code)
                               opaque origin, own Content-Security-Policy
```

* The iframe has **no same-origin access**: no Studio DOM, no cookies, no `localStorage`, no IndexedDB.
* Its CSP is `default-src 'none'; connect-src 'none'; …`, inherited by the worker: `fetch`, XHR, WebSocket, `importScripts()` and `import()` are blocked by the browser.
* Inside the worker the network, storage, nested-worker and page globals are **deleted** before your code is compiled, so even tricks like `(()=>{}).constructor('return this')()` find nothing.
* The worker can only talk to the editor through a small request/response protocol. The editor checks **every** request against the granted permissions, validates the arguments (types, finite numbers, known object types and properties, size limits) and counts calls.
* **Time limits:** loading 3 s, a command 8 s, a validator 4 s, a script 1.5 s. When the limit passes the editor *removes the iframe*, which terminates the worker even if it is stuck in `while(true){}`. The Studio stays responsive meanwhile because the code runs on another thread.
* **Flood protection:** more than 200 unanswered requests, or more than 16,000 messages, stops the code.
* All of the above is verified by automated tests that run hostile code in a real browser (`studio/tests/browser/plugins.test.mjs`).

## What the sandbox does NOT protect against (read this)

* **Memory.** A plugin can allocate memory until the tab becomes slow or crashes. There is no memory limit in browsers' workers.
* **CPU inside the time limit.** A plugin can keep a CPU core busy for up to the limit; the editor stays responsive but the machine may get warm.
* **Browser bugs.** A sandbox is only as strong as the browser's. Keep your browser up to date.
* **Plugins you approve without reading.** The permission system limits what a plugin can *ask the editor to do*; within its permissions it can still do harm (a plugin with `scene.write` can delete your whole map — one undo reverts it, but save first).
* **The code analyser is advisory.** It uses acorn to flag blocked APIs, dynamic-code constructs and endless loops. It cannot prove code safe.
* **Plugin output is untrusted.** Text a plugin shows (toasts, validator messages) comes from the plugin.
* Approvals live in your browser's storage; anyone with access to your browser profile can change them.

## Writing a plugin

```js
// Commands appear in the Plugins menu (needs "ui.menu").
api.command('Count walls', async () => {
  const walls = await api.scene.find({ type: 'wall' });       // needs "scene.read"
  api.notify(`${walls.length} walls`);
});

// Validators add Issues (needs "ui.validate").
api.validator(async () => (await api.scene.find({ type: 'door' }))
  .filter((d) => !d.props.doorId).map((d) => ({ severity: 'warn', message: `Door ${d.name} has no id`, nodes: [d.id] })));
```

`api.scene.find({type, name, tag, limit})`, `api.scene.get(id)`, `api.scene.selection()`, `api.scene.create({type, name, p, r, s, props, parent})`,
`api.scene.update(id, {name, p, r, s, props, visible})`, `api.scene.remove(idOrIds)`, `api.project.get(key)`, `api.download(name, text)`, `api.log(level, text)`, `api.notify(text)`.
Positions are `[x, y, z]` in metres, rotations in degrees. Results are plain JSON copies: changing them does not change the map.

## Writing a script

Scripts run when an event graph reaches a **Run plugin script** node (the script is looked up by name or id).

```js
const seen = (await game.getFlag('seen_note')) || 0;
await game.setFlag('seen_note', seen + 1);
await game.say('You have read the note ' + (seen + 1) + ' time(s).');
```

`game.say(text, seconds)`, `game.setFlag(name, value)`, `game.getFlag(name)`, `game.flags()`, `game.emit(event)` (≤ 20 per run),
`game.giveItem(id, n)`, `game.takeItem(id, n)`, `game.countItem(id)`, `game.door(id, 'open'|'close'|'toggle'|'lock'|'unlock')`, `game.doorState(id)`,
`game.light(group, 'on'|'off'|'flicker')`, `game.objective(text)`, `game.player()`, `game.time()`; `ctx = { script, event }`.
A script that is not approved is skipped, and the playtest tells you so. A script runs at most 30 times per 10 seconds.
Use **Dry run** in the Plugins tab to test a script against a pretend game that only prints what it was asked to do.

## Sharing

*Export…* writes a `.smplugin.json` file (code + manifest, **no approval**). Whoever imports it must review and approve it themselves.
Only share code whose licence allows it, and say where it came from in the *Author* / *Licence* fields.

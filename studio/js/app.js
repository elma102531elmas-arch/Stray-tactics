// App: owns the open project, undo history, selection, asset library and the action registry.
// UI modules talk to the App (never to each other) so any panel can be tested or replaced independently.

import { Emitter, deepClone, uid } from './core/util.js';
import { Project } from './core/project.js';
import { History } from './core/history.js';
import * as C from './core/commands.js';
import { makeNode, ROOT_ID } from './core/scene.js';
import { setBuiltinLibrary } from './core/builtin.js';
import { AssetLibrary } from './assets/library.js';
import { AssetImporter } from './assets/importer.js';
import { MaterialFactory } from './viewport/matfactory.js';
import { createStorage } from './store/storage.js';

export class App extends Emitter {
  constructor({ storage = createStorage(), baseUrl = document.baseURI } = {}) {
    super();
    this.storage = storage;
    this.baseUrl = baseUrl;
    this.actions = new Map();
    this.logLines = [];
    this.prefs = loadPrefs();
    this.selection = [];
    this.clipboard = null;
    this.plugins = null;      // set by plugin host
    this.issues = [];
    this.validatedOnce = false;
    this.setProject(new Project('Untitled map'), { silent: true });
    this.assets = new AssetLibrary({ storage, getProject: () => this.project, baseUrl });
    this.materials = new MaterialFactory(this.project, this.assets);
    this.importer = new AssetImporter(this);
  }

  async init() {
    try {
      const r = await fetch(new URL('assets-builtin/library.json', this.baseUrl));
      setBuiltinLibrary(await r.json());
    } catch (e) { this.log('error', 'Could not load the built-in asset library: ' + e.message); }
    this.emit('ready');
  }

  // ------------------------------------------------------------ project lifecycle
  setProject(project, { silent = false } = {}) {
    this.project = project;
    this.history = new History(project.ctx);
    this.history.on('change', () => this.emit('history'));
    const s = project.scene;
    for (const ev of ['added', 'removed', 'moved', 'changed']) s.on(ev, (...a) => this._sceneEvent(ev, a));
    this.selection = [];
    this.fileHandleName = null;
    if (this.materials) { this.materials.setProject(project); }
    if (!silent) { this.emit('project'); this.emit('selection'); this.emit('history'); }
  }
  _sceneEvent(ev, args) {
    if (ev === 'removed' && this.selection.includes(args[0])) {
      this.selection = this.selection.filter((i) => i !== args[0]);
      queueMicrotask(() => this.emit('selection'));
    }
    this.emit('scene', ev, ...args);
    this.dirtyValidation = true;
  }
  issuesFor(id) { return this.issues.filter((i) => i.nodes?.includes(id)); }
  get scene() { return this.project.scene; }
  get dirty() { return this.history.dirty; }

  /** Execute a command through the history, reporting readable errors instead of throwing into UI code. */
  exec(cmd, opts) {
    try { return this.history.exec(cmd, opts); } catch (e) { this.log('error', `${cmd.label}: ${e.message}`); this.toast(e.message, 'error'); return null; }
  }
  tx(label, fn) { return this.history.transaction(label, fn); }
  undo() { if (this.history.undo()) this.log('info', 'Undo'); }
  redo() { if (this.history.redo()) this.log('info', 'Redo'); }

  // ------------------------------------------------------------ selection
  select(ids, { add = false, toggle = false } = {}) {
    ids = ids.filter((i) => this.scene.has(i) && i !== ROOT_ID);
    let next;
    if (toggle) { next = [...this.selection]; for (const i of ids) { const k = next.indexOf(i); if (k >= 0) next.splice(k, 1); else next.push(i); } }
    else if (add) { next = [...this.selection]; for (const i of ids) if (!next.includes(i)) next.push(i); }
    else next = [...ids];
    if (next.length === this.selection.length && next.every((v, i) => v === this.selection[i])) return;
    this.selection = next;
    this.emit('selection');
  }
  selectAll() { this.select(this.scene.all().filter((n) => this.scene.isVisible(n.id) && !this.scene.isLocked(n.id)).map((n) => n.id)); }
  get primary() { return this.selection.length ? this.scene.get(this.selection.at(-1)) : null; }
  /** Selected nodes with nodes whose ancestor is also selected removed. */
  topSelection() {
    const set = new Set(this.selection);
    return this.selection.filter((id) => !this.scene.ancestors(id).some((a) => set.has(a.id)));
  }

  // ------------------------------------------------------------ editing helpers (all undoable)
  createNode(type, opts = {}, { parentId = ROOT_ID, select = true } = {}) {
    const node = makeNode(type, opts);
    node.name = this.scene.uniqueNameIn(parentId, opts.name || node.name);
    this.exec(C.addNode(node, parentId));
    if (select) this.select([node.id]);
    return node;
  }
  deleteSelection() {
    const ids = this.selection.filter((i) => !this.scene.isLocked(i) || true);
    if (!ids.length) return;
    this.exec(C.removeNodes(ids));
    this.log('info', `Deleted ${ids.length} object(s)`);
  }
  duplicateSelection() {
    const ids = this.topSelection();
    if (!ids.length) return;
    const created = this.exec(C.duplicateNodes(ids));
    if (created) this.select(created);
  }
  groupSelection() {
    const ids = this.topSelection();
    if (!ids.length) return;
    const gid = this.exec(C.groupNodes(ids));
    if (gid) this.select([gid]);
  }
  ungroupSelection() {
    const n = this.primary;
    if (n?.type === 'group') { const kids = this.exec(C.ungroupNode(n.id)); if (kids) this.select(kids); }
  }
  copy() {
    const ids = this.topSelection();
    if (!ids.length) return;
    this.clipboard = ids.map((id) => ({ snap: this.scene.snapshot(id), worldM: this.scene.worldMatrix(id).toArray() }));
    this.log('info', `Copied ${ids.length} object(s)`);
  }
  paste(offset = [1, 0, 1]) {
    if (!this.clipboard?.length) return;
    const idMap = new Map();
    const created = [];
    this.tx('Paste', () => {
      for (const c of this.clipboard) {
        const snap = C.cloneSnapshotWithNewIds(c.snap, idMap);
        snap.name = this.scene.uniqueNameIn(ROOT_ID, c.snap.name);
        snap.t.p = [snap.t.p[0] + offset[0], snap.t.p[1] + offset[1], snap.t.p[2] + offset[2]];
        this.exec(C.addSnapshot(snap, ROOT_ID, -1, 'Paste'));
        created.push(snap.id);
      }
    });
    this.select(created);
  }
  setProps(id, changes, mergeKey) { return this.exec(C.setProps(id, changes, { mergeKey })); }
  rename(id, name) { name = String(name).trim(); if (name) this.exec(C.setFields(id, { name })); }

  // ------------------------------------------------------------ logging / toasts
  log(level, msg, data) {
    const line = { level, msg, time: Date.now(), data };
    this.logLines.push(line);
    if (this.logLines.length > 1000) this.logLines.shift();
    this.emit('log', line);
    return line;
  }
  toast(msg, kind = 'info') { this.emit('toast', msg, kind); }

  // ------------------------------------------------------------ actions
  /** action = { id, label, shortcut?, menu?, group?, enabled?(app), run(app), checked?(app) } */
  register(action) { this.actions.set(action.id, action); return action; }
  registerAll(list) { list.forEach((a) => this.register(a)); }
  can(id) { const a = this.actions.get(id); return !!a && (!a.enabled || a.enabled(this)); }
  async run(id, ...args) {
    const a = this.actions.get(id);
    if (!a) { this.log('error', `Unknown action "${id}"`); return; }
    if (a.enabled && !a.enabled(this)) return;
    try { return await a.run(this, ...args); } catch (e) { this.log('error', `${a.label || id}: ${e.message}`); this.toast(`${a.label || id}: ${e.message}`, 'error'); console.error(e); }
  }

  setPref(key, value) { this.prefs[key] = value; savePrefs(this.prefs); this.emit('prefs', key); }
  pref(key, def) { return this.prefs[key] ?? def; }
}

const PREF_KEY = 'smstudio.prefs';
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* storage blocked: prefs last for this session */ } }

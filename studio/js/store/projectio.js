// Project file operations: new / open / save / autosave / backups / import & export.
import { Project } from '../core/project.js';
import { exportBundle, importBundle, projectToJSON, projectFromJSON, BUNDLE_EXT } from './bundle.js';
import { download, pickFiles } from '../ui/dom.js';
import { modal, confirmBox, promptBox, toast } from '../ui/dialogs.js';
import { h } from '../ui/dom.js';

export const AUTOSAVE_MS = 30000;

export class ProjectIO {
  constructor(app) {
    this.app = app;
    this.lastSaved = null;
    this.fileHandle = null;
    this.timer = null;
  }

  startAutosave(ms = AUTOSAVE_MS) {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.autosave(), ms);
  }

  async autosave() {
    const app = this.app;
    if (!app.dirty) return false;
    try {
      await app.storage.putAutosave(app.project.meta.id, projectToJSON(app.project));
      app.log('info', 'Autosaved');
      app.emit('autosaved', Date.now());
      return true;
    } catch (e) { app.log('error', 'Autosave failed: ' + e.message); return false; }
  }

  async recoverIfAny() {
    const app = this.app;
    try {
      const list = await app.storage.listProjects();
      for (const p of list) {
        const auto = await app.storage.getAutosave(p.id);
        if (auto && auto.time > p.time) {
          const when = new Date(auto.time).toLocaleString();
          const ok = await modal({ title: 'Recover unsaved work?', body: h('div', {}, `An autosave of “${p.name}” from ${when} is newer than the last save.`), buttons: [{ label: 'Discard', value: 'discard' }, { label: 'Recover', value: 'recover', primary: true }] });
          if (ok === 'recover') { await this.openJSON(auto.json, { dirty: true }); return true; }
          if (ok === 'discard') await app.storage.clearAutosave(p.id);
        }
      }
    } catch (e) { app.log('warn', 'Could not check for autosaves: ' + e.message); }
    return false;
  }

  async confirmDiscard() {
    if (!this.app.dirty) return true;
    return confirmBox('Unsaved changes', `“${this.app.project.meta.name}” has unsaved changes. Discard them?`, { ok: 'Discard changes', danger: true });
  }

  async newProject(name = 'Untitled map') {
    if (!(await this.confirmDiscard())) return false;
    this.app.setProject(new Project(name));
    this.fileHandle = null;
    this.app.log('info', `New project “${name}”`);
    return true;
  }

  /** Persist to browser storage (and the linked file when one exists). */
  async save() {
    const app = this.app;
    const json = projectToJSON(app.project);
    await app.storage.putBackup?.(app.project.meta.id, json);
    await app.storage.putProject(app.project.meta.id, json);
    await app.storage.clearAutosave(app.project.meta.id);
    app.history.markSaved();
    this.lastSaved = Date.now();
    app.emit('saved', this.lastSaved);
    app.log('ok', `Saved “${app.project.meta.name}” to browser storage`);
    if (this.fileHandle) { try { await this.writeHandle(); } catch (e) { app.log('warn', 'Could not write the linked file: ' + e.message); } }
    return true;
  }

  async writeHandle() {
    const { blob } = await exportBundle(this.app.project, this.app.storage);
    const w = await this.fileHandle.createWritable();
    await w.write(blob); await w.close();
  }

  async saveToFile() {
    const app = this.app;
    const { blob, missing, bytes } = await exportBundle(app.project, app.storage);
    const name = fileName(app.project.meta.name) + BUNDLE_EXT;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Saint Marrow project bundle', accept: { 'application/zip': [BUNDLE_EXT] } }] });
        const w = await handle.createWritable(); await w.write(blob); await w.close();
        this.fileHandle = handle;
        app.log('ok', `Saved ${handle.name} (${(bytes / 1024).toFixed(0)} KB)`);
        await this.save();
        return true;
      } catch (e) { if (e.name === 'AbortError') return false; app.log('warn', 'File picker unavailable, downloading instead: ' + e.message); }
    }
    download(name, blob);
    if (missing.length) app.log('warn', `Bundle written without ${missing.length} missing asset file(s): ${missing.slice(0, 5).join('; ')}`);
    app.log('ok', `Downloaded ${name} (${(bytes / 1024).toFixed(0)} KB)`);
    await this.save();
    return true;
  }

  async exportJSON() {
    download(fileName(this.app.project.meta.name) + '.project.json', projectToJSON(this.app.project), 'application/json');
  }

  async openFromBrowser(id) {
    const json = await this.app.storage.getProject(id);
    if (!json) throw new Error('That project no longer exists in browser storage.');
    await this.openJSON(json);
  }

  async openJSON(json, { dirty = false } = {}) {
    const project = projectFromJSON(json);
    this.app.setProject(project);
    if (dirty) this.app.history.revision = 1; // marks unsaved
    this.app.log('info', `Opened “${project.meta.name}”`);
    this.app.emit('project-opened', project);
    return project;
  }

  async openFile(file) {
    const app = this.app;
    try {
      const { project, warnings, assetFilesStored } = await importBundle(file, app.storage);
      app.setProject(project);
      this.fileHandle = null;
      for (const w of warnings) app.log('warn', w);
      app.log('ok', `Opened “${project.meta.name}” from ${file.name} (${assetFilesStored} asset file(s))`);
      app.emit('project-opened', project);
      if (warnings.length) toast(`${warnings.length} warning(s) while opening — see the Console.`, 'warn');
      return project;
    } catch (e) {
      app.log('error', `Could not open ${file.name}: ${e.message}`);
      await modal({ title: 'Could not open project', body: h('div', { class: 'note err', style: { margin: 0 } }, e.message) });
      return null;
    }
  }

  async openDialog() {
    const app = this.app;
    if (!(await this.confirmDiscard())) return;
    const list = await app.storage.listProjects();
    const body = h('div', {},
      list.length ? h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Project'), h('th', {}, 'Saved'), h('th', {}, ''))),
        h('tbody', {}, list.map((p) => h('tr', { 'data-id': p.id }, h('td', {}, h('a', { href: '#', style: { color: 'var(--accent)' }, onclick: (e) => { e.preventDefault(); close(p.id); } }, p.name)), h('td', {}, new Date(p.time).toLocaleString()),
          h('td', {}, h('button', { class: 'btn small danger', onclick: async (e) => { if (await confirmBox('Delete project', `Delete “${p.name}” from this browser?`, { ok: 'Delete', danger: true })) { await app.storage.deleteProject(p.id); e.target.closest('tr').remove(); } } }, 'Delete'))))))
        : h('div', { class: 'empty' }, 'No projects saved in this browser yet.'));
    let close;
    const res = await modal({ title: 'Open project', body, width: 640, buttons: [{ label: 'Close', value: undefined }, { label: 'Open from file…', value: 'file', primary: true }], onMount: (_, c) => { close = c; } });
    if (res === 'file') { const f = (await pickFiles({ accept: `${BUNDLE_EXT},.json,.zip`, multiple: false }))[0]; if (f) await this.openFile(f.file); }
    else if (res) { try { await this.openFromBrowser(res); } catch (e) { app.toast(e.message, 'error'); } }
  }

  async backupsDialog() {
    const app = this.app;
    const list = await app.storage.listBackups(app.project.meta.id);
    if (!list.length) { toast('No backups yet — one is kept every time you save.', 'info'); return; }
    let close;
    const body = h('div', {}, h('div', { class: 'hint', style: { marginBottom: '8px', color: 'var(--dim)' } }, 'Studio keeps the 10 most recent saves of this project.'),
      h('table', { class: 't' }, h('tbody', {}, list.map((b) => h('tr', {}, h('td', {}, new Date(b.time).toLocaleString()), h('td', {}, h('button', { class: 'btn small', onclick: () => close(b.index) }, 'Restore'))))))); 
    const idx = await modal({ title: 'Restore backup', body, buttons: [{ label: 'Cancel', value: undefined }], onMount: (_, c) => { close = c; } });
    if (idx !== undefined) { const json = await app.storage.getBackup(app.project.meta.id, idx); if (json) { await this.openJSON(json, { dirty: true }); toast('Backup restored (not saved yet).', 'ok'); } }
  }

  async rename() {
    const v = await promptBox('Rename project', 'Project name', this.app.project.meta.name);
    if (v && v.trim()) { this.app.project.meta.name = v.trim(); this.app.history.revision++; this.app.history.emit('change'); }
  }
}

export const fileName = (s) => String(s).replace(/[^\w\-. ]+/g, '_').trim().replace(/\s+/g, '_') || 'project';

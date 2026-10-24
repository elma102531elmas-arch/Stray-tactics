// Plugins & scripts workspace: write, import, review, approve and run sandboxed code. See core/plugins.js for the security model.
import { h } from '../ui/dom.js';
import { pickFiles, download } from '../ui/dom.js';
import { textField, boolField, button } from '../ui/fields.js';
import { CodeEditor } from '../ui/codeeditor.js';
import { confirmBox } from '../ui/dialogs.js';
import { reviewAndApprove } from '../ui/plugindialogs.js';
import { setData } from '../core/commands.js';
import { PERMISSIONS, KIND_PERMISSIONS, newRecord, sanitizeImported, validateRecord, analyzeCode, worstFinding } from '../core/plugins.js';

const BADGE = { running: ['Running', 'run'], approved: ['Approved', 'ok'], unapproved: ['Not approved', 'warn'], changed: ['Changed — review again', 'warn'], failed: ['Stopped', 'err'], invalid: ['Invalid', 'err'] };
const bucket = (kind) => (kind === 'script' ? 'scripts' : 'plugins');
const stem = (n) => n.replace(/\.(smplugin\.json|json|js|mjs)$/i, '');

class PluginsWorkspace {
  constructor(app, el) {
    this.app = app; this.el = el; this.sel = null; this.statuses = new Map(); this.showAll = false;
    this.list = h('div', { class: 'panel-body', style: { flex: 1 } });
    this.head = h('div', { class: 'toolbar', style: { height: 'auto', padding: '6px 10px', gap: '8px', flexWrap: 'wrap' } });
    this.edHolder = h('div', { style: { flex: 1, minHeight: '140px', padding: '0 10px' } });
    this.findingsBox = h('div', { id: 'pl-findings', style: { maxHeight: '110px', overflow: 'auto', borderTop: '1px solid var(--line)', marginTop: '6px', paddingTop: '4px' } });
    this.consoleBox = h('div', { class: 'pl-console', id: 'pl-console', style: { height: '140px' } });
    this.form = h('div', { class: 'panel-body insp' });
    el.append(h('div', { class: 'split', style: { height: '100%' } },
      h('div', { class: 'pane', style: { width: '260px', display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: '1px solid var(--line)' } },
        h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Plugins & scripts')), this.list,
        h('div', { style: { padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: '1px solid var(--line)' } }, button('+ Plugin', () => this.create('plugin'), { primary: true }), button('+ Script', () => this.create('script')), button('Import…', () => this.importFile(), { title: 'Import a .smplugin.json or .js file. It is added switched off; nothing is run.' }), button('Delete', () => this.remove()))),
      h('div', { class: 'pane', style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 } },
        h('div', { class: 'note warn', style: { margin: '8px 10px 0' } }, h('b', {}, 'Code never runs by itself. '), 'Plugins and scripts are programs. Opening or importing a project never runs them. Each one runs only after you review it and approve it here, in a sandbox with no network access, limited to the permissions you see on the right. Approvals are stored in this browser only and are lost if the code changes.'),
        this.head, this.edHolder, this.findingsBox,
        h('div', { class: 'toolbar', style: { height: 'auto', padding: '3px 10px', gap: '8px', borderTop: '1px solid var(--line)' } }, h('b', {}, 'Console'), h('label', { style: { display: 'flex', gap: '4px', color: 'var(--dim)', marginLeft: 'auto' } }, h('input', { type: 'checkbox', 'aria-label': 'Show all plugins', onchange: (e) => { this.showAll = e.target.checked; this.renderConsole(); } }), 'all plugins'), button('Clear', () => { app.plugins.console = []; this.renderConsole(); })), this.consoleBox),
      h('div', { class: 'pane', style: { width: '340px', background: 'var(--panel)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' } }, h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Details & permissions')), this.form)));
    this.editor = new CodeEditor(this.edHolder, { value: '', onChange: (v) => this.codeChanged(v) });
    app.on('project', () => { this.sel = null; this.statuses.clear(); if (this.live) this.refresh(); });
    app.on('history', () => { if (this.live) this.refresh(false); });
    app.on('plugins', () => { if (this.live) this.refreshStatuses(); });
    app.on('plugins-console', () => { if (this.live) this.renderConsole(); });
  }

  get live() { return this.el.classList.contains('on'); }
  show() { this.refresh(); }
  hide() { clearTimeout(this._t); }
  rec() { return this.sel ? this.app.project.data[bucket(this.sel.kind)]?.[this.sel.id] || null : null; }
  all() { return [...this.app.plugins.list('plugin'), ...this.app.plugins.list('script')]; }

  async refreshStatuses() {
    const ids = new Set();
    for (const r of this.all()) { ids.add(r.id); this.statuses.set(r.id, await this.app.plugins.status(r)); }
    for (const k of [...this.statuses.keys()]) if (!ids.has(k)) this.statuses.delete(k);
    this.renderList(); this.renderHead(); this.renderForm();
  }
  refresh(full = true) {
    const all = this.all();
    if (!this.rec() && all.length) this.sel = { kind: all[0].kind, id: all[0].id }; else if (!this.rec()) this.sel = null;
    const r = this.rec();
    if (full || (r && this.editor.value !== r.code)) { this.editor.setValue(r?.code || ''); this.analyze(); }
    this.editor.ta.readOnly = !r;
    this.refreshStatuses(); this.renderConsole();
  }

  // ---------------------------------------------------------------- list / header
  badge(rec) { const s = this.statuses.get(rec.id), [t, c] = BADGE[s?.state] || ['…', '']; return h('span', { class: 'badge-st ' + c, 'data-status': s?.state || '', title: s?.message || '' }, s?.state === 'failed' ? 'Stopped' : t); }
  renderList() {
    const group = (title, kind) => { const items = this.app.plugins.list(kind); return [h('div', { class: 'insp-title', style: { padding: '6px 10px', color: 'var(--faint)' } }, `${title} (${items.length})`), ...items.map((r) => h('div', { class: 'tree-row' + (this.sel?.id === r.id ? ' sel primary' : ''), 'data-rec': r.id, style: { position: 'relative', height: '30px' }, onclick: () => { this.sel = { kind, id: r.id }; this.refresh(); } },
      h('span', { class: 'tree-icon', style: { background: kind === 'plugin' ? '#4a9fd8' : '#d89a4a', marginLeft: '8px' } }, kind === 'plugin' ? 'P' : 'S'), h('span', { class: 'tree-name' }, r.name), this.badge(r)))]; };
    this.list.replaceChildren(...group('Plugins', 'plugin'), ...group('Scripts', 'script'), ...(this.all().length ? [] : [h('div', { class: 'empty' }, 'Nothing yet. A plugin extends the editor (menu commands, validators). A script runs inside the playtest when an event graph reaches a “Run plugin script” node.')]));
  }
  renderHead() {
    const r = this.rec(); this.head.replaceChildren();
    if (!r) { this.head.append(h('span', { style: { color: 'var(--faint)' } }, 'Select or create a plugin or script.')); return; }
    const st = this.statuses.get(r.id)?.state, run = st === 'running';
    this.head.append(h('b', { id: 'pl-title', style: { marginRight: 'auto' } }, `${r.name}  `, this.badge(r)),
      button('Review & approve…', () => this.review(), { primary: st !== 'approved' && st !== 'running', title: 'Read the code and its permissions, then decide' }),
      ...(r.kind === 'plugin' ? [run ? button('■ Stop', () => this.app.plugins.stop(r.id)) : button('▶ Start', () => this.start(), { primary: st === 'approved', title: 'Runs the plugin in the sandbox (must be approved)' })] : [button('Dry run', () => this.dryRun(), { title: 'Runs the script in the sandbox against a pretend game that only prints what it was asked to do' })]),
      button('Export…', () => this.exportRec()));
  }

  // ---------------------------------------------------------------- right form
  renderForm() {
    const r = this.rec();
    if (!r) { this.form.replaceChildren(h('div', { class: 'empty' }, 'No selection.')); return; }
    const st = this.statuses.get(r.id), set = (patch, label) => this.update(patch, label);
    const allowed = KIND_PERMISSIONS[r.kind];
    const probs = validateRecord(r);
    this.form.replaceChildren(
      ...probs.map((p) => h('div', { class: 'note ' + (p.severity === 'error' ? 'err' : 'warn') }, p.message)),
      h('div', { class: 'note' + (st?.state === 'approved' || st?.state === 'running' ? '' : ' warn'), id: 'pl-state' }, st?.state === 'running' ? 'Running in the sandbox.' : st?.state === 'approved' ? `Approved on this browser (${new Date(st.approvedAt).toLocaleString()}). ${r.kind === 'plugin' ? 'Press Start to run it.' : 'It runs when an event graph reaches it in the playtest.'}` : st?.state === 'changed' ? 'The code or permissions changed since you approved it. It will not run until you review it again.' : st?.state === 'failed' ? `Stopped: ${st.message}` : 'Not approved: it will not run.'),
      textField('Name', { value: r.name, onChange: (v) => set({ name: v }, 'Rename') }).el,
      textField('Version', { value: r.version, onChange: (v) => set({ version: v }, 'Version') }).el,
      textField('Author', { value: r.author, onChange: (v) => set({ author: v }, 'Author') }).el,
      textField('Licence', { value: r.license, hint: 'Only use code whose licence allows it.', onChange: (v) => set({ license: v }, 'Licence') }).el,
      textField('Description', { value: r.description, multiline: true, onChange: (v) => set({ description: v }, 'Description') }).el,
      h('div', { class: 'insp-title', style: { margin: '10px 0 2px' } }, 'Permissions it may use'),
      ...allowed.map((p) => { const f = boolField(p, { value: (r.permissions || []).includes(p), hint: PERMISSIONS[p], onChange: (on) => set({ permissions: on ? [...new Set([...(r.permissions || []), p])] : (r.permissions || []).filter((x) => x !== p) }, `Permission ${p}`) }); f.input.setAttribute('aria-label', `Permission ${p}`); return f.el; }),
      h('div', { class: 'hint', style: { color: 'var(--faint)', fontSize: '11px', margin: '6px 0' } }, 'Changing permissions or code withdraws the approval. Imported code starts with none of these.'),
      h('div', { class: 'kv', style: { fontSize: '12px' } }, h('span', {}, 'Source'), h('b', {}, r.source?.type === 'imported' ? `imported (${r.source.file || 'file'})` : 'authored here'), h('span', {}, 'Modified'), h('b', {}, new Date(r.modified).toLocaleString())),
      (st?.state === 'approved' || st?.state === 'running') ? button('Revoke approval', () => { this.app.plugins.stop(r.id); this.app.plugins.approvals.revoke(this.app.project.meta.id, r); this.app.plugins.state.delete(r.id); this.refreshStatuses(); }) : null);
  }

  renderConsole() {
    const r = this.rec(), lines = this.app.plugins.console.filter((l) => this.showAll || !r || l.id === r.id).slice(-200);
    this.consoleBox.replaceChildren(...lines.map((l) => h('div', { class: 'l-' + l.level }, h('span', { class: 't' }, new Date(l.t).toLocaleTimeString()), this.showAll ? `[${l.plugin}] ` : '', l.text)));
    this.consoleBox.scrollTop = this.consoleBox.scrollHeight;
  }

  // ---------------------------------------------------------------- editing
  update(patch, label = 'Edit plugin', mergeKey) {
    const r = this.rec(); if (!r) return;
    const next = { ...JSON.parse(JSON.stringify(r)), ...patch, modified: new Date().toISOString() };
    if (patch.code !== undefined || patch.permissions !== undefined) this.app.plugins.stop(r.id);        // changed code / permissions never keep running
    this.app.exec(setData([bucket(r.kind), r.id], next, { label: `${label}: ${r.name}`, mergeKey: mergeKey || `pl:${r.id}:${label}` }));
  }
  codeChanged(v) { clearTimeout(this._t); this._t = setTimeout(() => { if (this.rec() && this.rec().code !== v) this.update({ code: v }, 'Edit code', `pl:${this.sel.id}:code`); }, 350); this.analyze(v); }
  analyze(code = this.editor.value) {
    const f = analyzeCode(code); this.editor.setFindings(f);
    this.findingsBox.replaceChildren(...(f.length ? [h('div', { style: { padding: '0 10px', fontWeight: 600, fontSize: '12px' } }, `Code analysis: ${f.length} note${f.length === 1 ? '' : 's'} (advisory — the sandbox and your approval are what protect you)`), ...f.slice(0, 40).map((x) => h('div', { class: 'pl-finding', 'data-sev': x.severity, onclick: () => this.editor.goto(x.line) }, h('span', { class: 'sev ' + x.severity }, { danger: 'Careful', error: 'Error', warn: 'Blocked', info: 'Note' }[x.severity]), h('span', {}, `line ${x.line}: ${x.message}`)))] : [h('div', { style: { padding: '0 10px', color: 'var(--faint)', fontSize: '12px' } }, 'Code analysis: nothing unusual.')]));
    this.worst = worstFinding(f);
  }

  // ---------------------------------------------------------------- actions
  create(kind) {
    const r = newRecord(kind); r.permissions = kind === 'plugin' ? ['scene.read', 'ui.menu'] : ['game.read', 'game.write'];
    this.app.exec(setData([bucket(kind), r.id], r, { label: `New ${kind}` }));
    this.sel = { kind, id: r.id }; this.refresh();
  }
  async remove() {
    const r = this.rec(); if (!r) return;
    if (!(await confirmBox(`Delete ${r.kind}`, `Delete “${r.name}”? This can be undone.`, { ok: 'Delete', danger: true }))) return;
    this.app.plugins.stop(r.id);
    const next = { ...this.app.project.data[bucket(r.kind)] }; delete next[r.id];
    this.app.exec(setData([bucket(r.kind)], next, { label: `Delete ${r.kind}` })); this.sel = null; this.refresh();
  }
  async importFile() {
    const files = await pickFiles({ accept: '.json,.js,.mjs,.smplugin', multiple: false });
    if (!files.length) return;
    const { file, path } = files[0];
    if (file.size > 500_000) { this.app.toast('That file is larger than 500 KB, so it was not imported.', 'error'); return; }
    const text = await file.text();                                                // read as TEXT only; nothing is evaluated
    let raw;
    if (/\.(js|mjs)$/i.test(path)) raw = { kind: 'plugin', name: stem(path), code: text };
    else { try { raw = JSON.parse(text); } catch (e) { this.app.toast('That file is not valid JSON: ' + e.message, 'error'); return; } }
    const r = sanitizeImported(raw, { fileName: path });
    const bad = validateRecord(r).filter((m) => m.severity === 'error' && !/permission/i.test(m.message));
    if (bad.length) { this.app.toast('Cannot import: ' + bad[0].message, 'error'); return; }
    r.permissions = r.permissions.filter((p) => (KIND_PERMISSIONS[r.kind] || []).includes(p));
    this.app.exec(setData([bucket(r.kind), r.id], r, { label: `Import ${r.kind} “${r.name}”` }));
    this.sel = { kind: r.kind, id: r.id }; this.refresh();
    this.app.log('warn', `Imported ${r.kind} “${r.name}” from ${path}. It is switched off and has NOT been run. Review it before approving.`);
    this.app.toast(`Imported “${r.name}” — switched off, not run. Review it first.`, 'info');
  }
  exportRec() {
    const r = this.rec(); if (!r) return;
    const { id, source, created, modified, ...rest } = r;
    download(`${r.name.replace(/[^\w.-]+/g, '_')}.smplugin.json`, JSON.stringify({ format: 'smstudio-plugin', formatVersion: 1, ...rest }, null, 2), 'application/json');
  }
  async review() { const r = this.rec(); if (!r) return; await reviewAndApprove(this.app, r); this.refreshStatuses(); }
  async start() {
    const r = this.rec(); if (!r) return;
    let st = await this.app.plugins.status(r);
    if (st.state !== 'approved') { if (!(await reviewAndApprove(this.app, r))) return; }
    try { await this.app.plugins.start(r); } catch (e) { this.app.toast(`Could not start: ${e.message}`, 'error'); }
    this.refreshStatuses();
  }
  async dryRun() {
    const r = this.rec(); if (!r) return;
    let st = await this.app.plugins.status(r);
    if (st.state !== 'approved') { if (!(await reviewAndApprove(this.app, r))) return; }
    const flags = {}, say = (t) => this.app.plugins.print('info', r, t);
    const M = (perm, name, fn) => [name, [perm, (c, a) => { say(`game.${name.slice(5)}(${a.map((x) => JSON.stringify(x)).join(', ')})`); return fn ? fn(a) : null; }]];
    const methods = Object.fromEntries([M('game.write', 'game.say'), M('game.write', 'game.setFlag', ([k, v]) => { flags[k] = v; return null; }), M('game.read', 'game.getFlag', ([k]) => flags[k] ?? null), M('game.write', 'game.emit'), M('game.write', 'game.giveItem'), M('game.write', 'game.takeItem'), M('game.read', 'game.countItem', () => 0), M('game.write', 'game.door'), M('game.write', 'game.light'), M('game.write', 'game.objective'), M('game.read', 'game.player', () => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100 }))]);
    await this.app.plugins.runScript(r, { ctx: { script: r.name, event: 'dry-run' }, methods });
    this.refreshStatuses();
  }
}

export default {
  id: 'plugins', label: 'Plugins', fill: true,
  create(app, el) { const w = new PluginsWorkspace(app, el); app.pluginsWs = w; return w; },
};

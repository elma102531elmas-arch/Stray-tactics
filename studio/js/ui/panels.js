// Bottom panels (Console, Issues, Assets) and the status bar.
import { h } from './dom.js';
import { TYPES } from '../core/schema.js';
import { Thumbs } from '../assets/thumbs.js';
import { formatBytes } from '../core/util.js';

const pad = (n) => String(n).padStart(2, '0');
const hhmmss = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

export class ConsolePanel {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.filter = 'all';
    this.list = h('div', { class: 'console panel-body', role: 'log', 'aria-live': 'polite' });
    this.sel = h('select', { class: 'tb-select', 'aria-label': 'Filter log', onchange: () => { this.filter = this.sel.value; this.render(); } }, ['all', 'info', 'ok', 'warn', 'error'].map((v) => h('option', { value: v }, v === 'all' ? 'All messages' : v)));
    el.append(h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Console'), h('span', { class: 'grow' }), this.sel, h('button', { class: 'btn small', onclick: () => { app.logLines.length = 0; this.render(); } }, 'Clear')), this.list);
    app.on('log', (l) => this.append(l));
    this.render();
  }
  row(l) { return h('div', { class: 'log ' + l.level }, h('time', {}, hhmmss(l.time)), h('span', {}, l.msg)); }
  append(l) {
    if (this.filter !== 'all' && l.level !== this.filter) return;
    const atEnd = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 30;
    this.list.appendChild(this.row(l));
    while (this.list.childElementCount > 500) this.list.firstChild.remove();
    if (atEnd) this.list.scrollTop = this.list.scrollHeight;
  }
  render() {
    this.list.replaceChildren(...this.app.logLines.filter((l) => this.filter === 'all' || l.level === this.filter).slice(-500).map((l) => this.row(l)));
    this.list.scrollTop = this.list.scrollHeight;
  }
}

export class IssuesPanel {
  constructor(app, el, { viewport } = {}) {
    this.app = app; this.el = el; this.vp = viewport;
    this.sevFilter = new Set(['error', 'warn', 'info']);
    this.list = h('div', { class: 'panel-body' });
    this.summary = h('span', { class: 'badge' });
    this.chips = ['error', 'warn', 'info'].map((s) => h('button', { class: 'btn small', 'aria-pressed': 'true', 'data-sev': s, onclick: (e) => { if (this.sevFilter.has(s)) this.sevFilter.delete(s); else this.sevFilter.add(s); e.currentTarget.setAttribute('aria-pressed', String(this.sevFilter.has(s))); e.currentTarget.style.opacity = this.sevFilter.has(s) ? 1 : 0.45; this.render(); } }, s));
    el.append(h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Issues'), this.summary, h('span', { class: 'grow' }), ...this.chips,
      h('button', { class: 'btn small primary', onclick: () => app.run('project.validate') }, 'Validate map')), this.list);
    app.on('issues', () => this.render());
    this.render();
  }
  render() {
    const issues = this.app.issues || [];
    const c = { error: 0, warn: 0, info: 0 };
    issues.forEach((i) => c[i.severity]++);
    this.summary.textContent = `${c.error} errors · ${c.warn} warnings · ${c.info} notes`;
    const shown = issues.filter((i) => this.sevFilter.has(i.severity));
    if (!issues.length) { this.list.replaceChildren(h('div', { class: 'empty' }, this.app.validatedOnce ? 'No problems found.' : 'Run “Validate map” (Project menu) to check walls, openings, floating objects, reachability and references.')); return; }
    this.list.replaceChildren(...shown.slice(0, 600).map((i) => h('div', { class: 'issue', 'data-code': i.code, title: i.code, onclick: () => this.go(i) },
      h('span', { class: 'sev ' + i.severity }), h('div', { style: { flex: 1 } }, i.message, i.fix ? h('span', { class: 'badge', style: { marginLeft: '8px' } }, 'auto-fix available') : null),
      i.fix ? h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); this.app.run('project.fixIssue', i); } }, 'Fix') : null)));
    if (shown.length > 600) this.list.appendChild(h('div', { class: 'empty' }, `…and ${shown.length - 600} more. Filter by severity to narrow the list.`));
  }
  go(i) {
    const ids = (i.nodes || []).filter((id) => this.app.scene.has(id));
    if (ids.length) { this.app.select(ids); this.vp?.frameSelection(); }
  }
}

export class AssetsPanel {
  constructor(app, el, { viewport } = {}) {
    this.app = app; this.el = el; this.vp = viewport;
    this.thumbs = new Thumbs(app);
    app.thumbs = this.thumbs;
    this.kind = 'model';
    this.q = '';
    this.selected = null;
    const kinds = [['model', 'Models'], ['image', 'Textures'], ['audio', 'Audio'], ['prefab', 'Prefabs'], ['project', 'This project'], ['all', 'All']];
    this.tabs = h('div', { class: 'panel-tabs' }, kinds.map(([k, l]) => h('button', { 'data-kind': k, class: k === this.kind ? 'on' : '', onclick: (e) => { this.kind = k; this.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); this.render(); } }, l)));
    this.grid = h('div', { class: 'grid-cards panel-body' });
    this.search = h('input', { class: 'search', placeholder: 'Search assets…', 'aria-label': 'Search assets', oninput: () => { this.q = this.search.value.toLowerCase(); this.render(); } });
    el.append(h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Assets'), this.search, h('button', { class: 'btn small primary', onclick: () => app.run('asset.import') }, 'Import…')), this.tabs, this.grid);
    app.on('assets', () => this.render());
    app.on('project', () => this.render());
    app.on('ready', () => this.render());
    this.render();
  }
  prefabItems() { return Object.values(this.app.project.data.prefabs || {}).map((p) => ({ id: p.id, name: p.name, kind: 'prefab', prefab: true, license: 'this project' })); }
  list() {
    if (this.kind === 'prefab') return this.prefabItems().filter((m) => !this.q || m.name.toLowerCase().includes(this.q));
    const all = [...this.app.assets.allMeta(null), ...(this.kind === 'all' ? this.prefabItems() : [])];
    return all.filter((m) => {
      if (this.kind === 'project' && m.builtin) return false;
      if (['model', 'image', 'audio'].includes(this.kind) && m.kind !== this.kind) return false;
      return !this.q || m.name.toLowerCase().includes(this.q) || (m.license || '').toLowerCase().includes(this.q);
    });
  }
  render() {
    const items = this.list();
    this.io?.disconnect();
    this.io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { this.io.unobserve(en.target); en.target._load?.(); } }), { root: this.grid });
    const cards = items.slice(0, 400).map((m) => {
      const thumb = h('div', { class: 'thumb' }, m.prefab ? '❒ prefab' : m.kind === 'audio' ? '♪ ' + (m.duration ? m.duration.toFixed(1) + ' s' : 'audio') : '…');
      const card = h('div', { class: 'card' + (this.selected === m.id ? ' sel' : ''), draggable: 'true', tabindex: '0', 'data-asset': m.id, title: `${m.name}\n${m.id}\n${m.license || ''}`,
        onclick: () => { this.selected = m.id; this.app.emit('asset-selected', m.id); this.grid.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.asset === m.id)); },
        ondblclick: () => (m.prefab ? this.app.run('prefab.place', m.id) : this.app.run('asset.place', m.id)),
        ondragstart: (e) => { e.dataTransfer.setData('application/x-sm-asset', m.id); e.dataTransfer.effectAllowed = 'copy'; },
        onkeydown: (e) => { if (e.key === 'Enter') (m.prefab ? this.app.run('prefab.place', m.id) : this.app.run('asset.place', m.id)); },
        oncontextmenu: (e) => { e.preventDefault(); const items = m.prefab ? [{ label: 'Place in scene', run: () => this.app.run('prefab.place', m.id) }, { label: 'Delete prefab', run: () => this.app.deletePrefab(m.id) }] : [{ label: 'Place in scene', run: () => this.app.run('asset.place', m.id), disabled: m.kind !== 'model' }, { label: 'Open in Assets editor', run: () => { this.app.shell.show('assets'); this.app.emit('goto', { workspace: 'assets', asset: m.id }); } }]; import('./dialogs.js').then((d) => d.contextMenu(e.clientX, e.clientY, items)); } },
      thumb, h('div', { class: 'nm' }, m.name), h('div', { class: 'sm' }, m.prefab ? `prefab · ${(this.app.project.data.prefabs[m.id]?.snapshot.children || []).length} object(s)` : `${m.kind}${m.triangles ? ' · ' + m.triangles.toLocaleString() + ' tris' : ''}${m.size ? ' · ' + formatBytes(m.size) : ''}`));
      card._load = async () => {
        if (m.kind === 'model') { const url = await this.thumbs.model(m.id); if (url) thumb.replaceChildren(h('img', { src: url, alt: m.name })); else thumb.textContent = 'no preview'; }
        else if (m.kind === 'image') { try { thumb.replaceChildren(h('img', { src: await this.app.assets.url(m), alt: m.name })); } catch { thumb.textContent = 'missing'; } }
      };
      this.io.observe(card);
      return card;
    });
    this.grid.replaceChildren(...(cards.length ? cards : [h('div', { class: 'empty' }, 'No assets here yet. Use Import… or drop files onto the window.')]));
    if (items.length > 400) this.grid.appendChild(h('div', { class: 'empty' }, `Showing 400 of ${items.length} — use search to narrow.`));
  }
}

export class StatusBar {
  constructor(app, el, { viewport } = {}) {
    this.app = app; this.el = el; this.vp = viewport;
    this.cells = { msg: h('span', { class: 'grow' }), sel: h('span'), proj: h('span'), save: h('span'), perf: h('span'), issues: h('span') };
    el.append(...Object.values(this.cells));
    this.hint('Ready');
    app.on('selection', () => this.update());
    app.on('history', () => this.update());
    app.on('saved', () => this.update());
    app.on('autosaved', () => this.update());
    app.on('issues', () => this.update());
    app.on('scene', () => this.statsSoon());
    viewport?.on('stats', () => this.update());
    viewport?.on('tool', (t) => this.hint(TOOL_HINTS[t] || ''));
    app.on('log', (l) => { if (l.level === 'error') this.hint(l.msg, 'sb-err'); });
    this.update();
  }
  statsSoon() { if (this._s) return; this._s = setTimeout(() => { this._s = null; this.update(); }, 300); }
  hint(msg, cls = '') { this.cells.msg.textContent = msg; this.cells.msg.className = 'grow ' + cls; }
  update() {
    const a = this.app, c = this.cells;
    c.sel.innerHTML = '';
    c.sel.append('Selected ', h('b', {}, String(a.selection.length)));
    c.proj.textContent = `${a.scene.size} objects`;
    const last = a.projectIO?.lastSaved;
    c.save.textContent = a.dirty ? 'Unsaved changes' : last ? `Saved ${new Date(last).toLocaleTimeString()}` : 'Not saved yet';
    c.save.className = a.dirty ? 'sb-warn' : 'sb-ok';
    const counts = { error: 0, warn: 0 };
    (a.issues || []).forEach((i) => { if (counts[i.severity] !== undefined) counts[i.severity]++; });
    c.issues.textContent = a.validatedOnce ? `${counts.error} errors · ${counts.warn} warnings` : '';
    c.issues.className = counts.error ? 'sb-err' : counts.warn ? 'sb-warn' : 'sb-ok';
    if (this.vp) { const li = this.vp.lastInfo; c.perf.textContent = li ? `${li.tris.toLocaleString()} tris · ${li.calls} draws · ${this.vp.fps > 0 ? this.vp.fps.toFixed(0) + ' fps' : 'idle'}` : ''; }
  }
}
const TOOL_HINTS = {
  select: 'Click to select · drag for marquee · MMB/Alt+LMB orbit · Shift+MMB pan · wheel zoom · RMB+WASD fly · F frame',
};

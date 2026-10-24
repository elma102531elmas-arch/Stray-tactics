// Hierarchy panel: virtualised tree of the scene with selection, rename, drag & drop reparenting, visibility and lock toggles.
import { h, clear } from './dom.js';
import { TYPES } from '../core/schema.js';
import * as C from '../core/commands.js';
import { ROOT_ID } from '../core/scene.js';
import { contextMenu } from './dialogs.js';

const ROW = 24;
const NESTABLE = new Set(['group', 'path']);
const hex = (n) => '#' + (n ?? 0x888888).toString(16).padStart(6, '0');

export class HierarchyPanel {
  constructor(app, el, { viewport } = {}) {
    this.app = app; this.el = el; this.vp = viewport;
    this.expanded = new Set();
    this.filter = '';
    this.rows = [];
    this.anchor = null;
    this.renaming = null;
    el.classList.add('hier');
    this.search = h('input', { class: 'search', placeholder: 'Search objects…', 'aria-label': 'Search objects', oninput: (e) => { this.filter = e.target.value.trim().toLowerCase(); this.rebuild(); } });
    this.count = h('span', { class: 'badge', 'aria-live': 'polite' });
    this.body = h('div', { class: 'panel-body', tabindex: '0', onscroll: () => this.paint() });
    this.tree = h('div', { class: 'tree', role: 'tree' });
    this.body.appendChild(this.tree);
    el.append(h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Hierarchy'), this.search, this.count), this.body);
    this.body.addEventListener('keydown', (e) => this.key(e));
    this.body.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!e.target.closest('.tree-row')) contextMenu(e.clientX, e.clientY, this.menuItems(null)); });
    new ResizeObserver(() => this.paint()).observe(this.body);
    app.on('scene', (ev, id, a) => { if (ev === 'changed' && a && !a.some((f) => f === 'name' || f === 'visible' || f === 'locked' || f === 'tags')) return; this.dirty(); });
    app.on('project', () => { this.expanded.clear(); this.expandToDepth(1); this.rebuild(); });
    app.on('selection', () => { this.revealSelection(); this.paint(); });
    this.expandToDepth(1);
    this.rebuild();
  }

  expandToDepth(d) {
    const walk = (id, depth) => { if (depth >= d) return; for (const c of this.app.scene.children(id)) if (c.children.length) { this.expanded.add(c.id); walk(c.id, depth + 1); } };
    walk(ROOT_ID, 0);
  }

  dirty() { if (this._d) return; this._d = true; requestAnimationFrame(() => { this._d = false; this.rebuild(); }); }

  rebuild() {
    const scene = this.app.scene;
    const rows = [];
    const q = this.filter;
    if (q) {
      scene.walk((n) => {
        const hay = (n.name + ' ' + n.type + ' ' + (TYPES[n.type]?.label || '') + ' ' + n.tags.join(' ')).toLowerCase();
        if (hay.includes(q)) rows.push({ id: n.id, depth: 0, has: false, path: scene.ancestors(n.id).filter((a) => a.id !== ROOT_ID).reverse().map((a) => a.name).join(' / ') });
      });
    } else {
      const walk = (id, depth) => {
        for (const c of scene.children(id)) {
          rows.push({ id: c.id, depth, has: c.children.length > 0 });
          if (c.children.length && this.expanded.has(c.id)) walk(c.id, depth + 1);
        }
      };
      walk(ROOT_ID, 0);
    }
    this.rows = rows;
    this.count.textContent = `${scene.size}`;
    this.tree.style.height = rows.length * ROW + 'px';
    this.paint();
  }

  paint() {
    const top = this.body.scrollTop, hgt = this.body.clientHeight || 400;
    const first = Math.max(0, Math.floor(top / ROW) - 3), last = Math.min(this.rows.length, Math.ceil((top + hgt) / ROW) + 3);
    const scene = this.app.scene, sel = new Set(this.app.selection), prim = this.app.selection.at(-1);
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const r = this.rows[i]; const n = scene.get(r.id);
      if (!n) continue;
      const def = TYPES[n.type];
      const row = h('div', {
        class: 'tree-row' + (sel.has(n.id) ? ' sel' : '') + (prim === n.id ? ' primary' : '') + (n.visible ? '' : ' hidden-node'),
        role: 'treeitem', 'aria-selected': sel.has(n.id) ? 'true' : 'false', 'aria-level': r.depth + 1, 'data-id': n.id, 'data-name': n.name,
        draggable: this.renaming === n.id ? 'false' : 'true',
        style: { top: i * ROW + 'px', paddingLeft: 4 + r.depth * 14 + 'px' },
        onclick: (e) => this.click(e, n, i),
        ondblclick: (e) => { if (e.target.closest('button,input')) return; this.vp?.frameSelection(); },
        oncontextmenu: (e) => { e.preventDefault(); if (!sel.has(n.id)) this.app.select([n.id]); contextMenu(e.clientX, e.clientY, this.menuItems(n)); },
        ondragstart: (e) => this.dragStart(e, n),
        ondragover: (e) => this.dragOver(e, n), ondragleave: (e) => e.currentTarget.classList.remove('drop-in', 'drop-before', 'drop-after'),
        ondrop: (e) => this.drop(e, n),
      },
      h('span', { class: 'tree-caret', onclick: (e) => { e.stopPropagation(); this.toggle(n.id); } }, r.has && !this.filter ? (this.expanded.has(n.id) ? '▼' : '▶') : ''),
      h('span', { class: 'tree-icon', style: { background: hex(def?.color) }, title: def?.label }, def?.icon || '?'),
      this.renaming === n.id ? this.renameInput(n) : h('span', { class: 'tree-name', title: n.name + (r.path ? '  —  ' + r.path : '') }, n.name, r.path ? h('span', { class: 'tree-tag' }, '  ' + r.path) : null),
      h('button', { class: 'tree-btn' + (n.visible ? '' : ' on'), title: n.visible ? 'Hide' : 'Show', 'aria-label': 'Toggle visibility', onclick: (e) => { e.stopPropagation(); this.app.exec(C.setFields(n.id, { visible: !n.visible })); } }, n.visible ? '👁' : '◌'),
      h('button', { class: 'tree-btn' + (n.locked ? ' on' : ''), title: n.locked ? 'Unlock' : 'Lock', 'aria-label': 'Toggle lock', onclick: (e) => { e.stopPropagation(); this.app.exec(C.setFields(n.id, { locked: !n.locked })); } }, n.locked ? '🔒' : '·'));
      frag.appendChild(row);
    }
    this.tree.replaceChildren(frag);
    if (this.renaming) this.tree.querySelector('input')?.focus();
  }

  toggle(id) { if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id); this.rebuild(); }

  click(e, n, index) {
    if (e.target.closest('button,input')) return;
    const app = this.app;
    if (e.shiftKey && this.anchor) {
      const a = this.rows.findIndex((r) => r.id === this.anchor), b = index;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      app.select(this.rows.slice(lo, hi + 1).map((r) => r.id), e.ctrlKey || e.metaKey ? { add: true } : {});
    } else if (e.ctrlKey || e.metaKey) { app.select([n.id], { toggle: true }); this.anchor = n.id; }
    else { app.select([n.id]); this.anchor = n.id; }
  }

  revealSelection() {
    const id = this.app.selection.at(-1);
    if (!id || this.filter) return;
    let changed = false;
    for (const a of this.app.scene.ancestors(id)) if (a.id !== ROOT_ID && !this.expanded.has(a.id)) { this.expanded.add(a.id); changed = true; }
    if (changed) this.rebuild();
    const i = this.rows.findIndex((r) => r.id === id);
    if (i < 0) return;
    const y = i * ROW, b = this.body;
    if (y < b.scrollTop) b.scrollTop = y - ROW; else if (y + ROW > b.scrollTop + b.clientHeight) b.scrollTop = y - b.clientHeight + ROW * 2;
  }

  // ---------------------------------------------------------------- rename
  startRename(id) { this.renaming = id; this.paint(); }
  renameInput(n) {
    const input = h('input', { value: n.name, 'aria-label': 'Rename', onclick: (e) => e.stopPropagation(), onkeydown: (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = input.value; this.renaming = null; this.app.rename(n.id, v); this.paint(); }
      else if (e.key === 'Escape') { this.renaming = null; this.paint(); }
    }, onblur: () => { if (this.renaming === n.id) { const v = input.value; this.renaming = null; this.app.rename(n.id, v); this.paint(); } } });
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return h('span', { class: 'tree-name' }, input);
  }

  // ---------------------------------------------------------------- keyboard
  key(e) {
    if (e.target.tagName === 'INPUT') return;
    const app = this.app;
    const idx = this.rows.findIndex((r) => r.id === app.selection.at(-1));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const ni = Math.max(0, Math.min(this.rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      if (this.rows[ni]) { app.select([this.rows[ni].id]); this.anchor = this.rows[ni].id; }
    } else if (e.key === 'ArrowRight' && idx >= 0) { const r = this.rows[idx]; if (r.has && !this.expanded.has(r.id)) this.toggle(r.id); }
    else if (e.key === 'ArrowLeft' && idx >= 0) { const r = this.rows[idx]; if (r.has && this.expanded.has(r.id)) this.toggle(r.id); }
    else if (e.key === 'F2') { e.preventDefault(); if (app.selection.length) this.startRename(app.selection.at(-1)); }
  }

  // ---------------------------------------------------------------- drag & drop
  dragStart(e, n) {
    if (!this.app.selection.includes(n.id)) this.app.select([n.id]);
    e.dataTransfer.setData('application/x-sm-nodes', JSON.stringify(this.app.topSelection()));
    e.dataTransfer.effectAllowed = 'move';
  }
  zone(e, n) {
    const r = e.currentTarget.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
    if (this.filter) return 'in-none';
    if (NESTABLE.has(n.type) && y > 0.25 && y < 0.75) return 'in';
    return y < 0.5 ? 'before' : 'after';
  }
  dragOver(e, n) {
    if (!e.dataTransfer.types.includes('application/x-sm-nodes')) return;
    e.preventDefault();
    const z = this.zone(e, n);
    const el = e.currentTarget;
    el.classList.remove('drop-in', 'drop-before', 'drop-after');
    if (z !== 'in-none') el.classList.add('drop-' + z);
  }
  drop(e, n) {
    const raw = e.dataTransfer.getData('application/x-sm-nodes');
    e.currentTarget.classList.remove('drop-in', 'drop-before', 'drop-after');
    if (!raw) return;
    e.preventDefault();
    const scene = this.app.scene;
    const ids = JSON.parse(raw).filter((id) => scene.has(id));
    const z = this.zone(e, n);
    if (z === 'in-none') return;
    let parentId, index;
    if (z === 'in') { parentId = n.id; index = -1; }
    else {
      parentId = n.parent;
      const sibs = scene.get(parentId).children.filter((c) => !ids.includes(c));
      const at = sibs.indexOf(n.id);
      index = z === 'before' ? at : at + 1;
    }
    if (ids.some((id) => id === parentId || scene.isDescendant(parentId, id))) { this.app.toast('Cannot move an object into itself.', 'warn'); return; }
    this.app.exec(C.reparent(ids, parentId, index));
  }

  // ---------------------------------------------------------------- context menu
  menuItems(n) {
    const app = this.app;
    const has = app.selection.length > 0;
    const run = (id) => () => app.run(id);
    return [
      { label: 'Rename', shortcut: 'F2', disabled: !n, run: () => n && this.startRename(n.id) },
      { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !has, run: run('edit.duplicate') },
      { label: 'Delete', shortcut: 'Del', disabled: !has, run: run('edit.delete') },
      { sep: true },
      { label: 'Group selection', shortcut: 'Ctrl+G', disabled: !has, run: run('edit.group') },
      { label: 'Ungroup', disabled: !(n && n.type === 'group'), run: run('edit.ungroup') },
      { label: 'Select children', disabled: !(n && n.children.length), run: () => app.select(app.scene.descendants(n.id).map((d) => d.id)) },
      { sep: true },
      { label: 'Frame in viewport', shortcut: 'F', disabled: !has, run: run('view.frame') },
      { label: 'Hide / show', disabled: !has, run: run('edit.toggleVisible') },
      { label: 'Lock / unlock', disabled: !has, run: run('edit.toggleLock') },
      { sep: true },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !has, run: run('edit.copy') },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !app.clipboard, run: run('edit.paste') },
    ];
  }
}

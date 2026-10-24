// Menu bar built from the action registry: every action with a `menu` path appears here.
// menu: "File" | "Create/Architecture" (nested). Items sort by `order` then registration order.
import { h } from './dom.js';

const ORDER = ['File', 'Edit', 'Create', 'View', 'Tools', 'Project', 'Plugins', 'Help'];

export function buildMenuTree(app) {
  const tree = {};
  let i = 0;
  for (const a of app.actions.values()) {
    if (!a.menu) continue;
    const path = a.menu.split('/');
    let node = (tree[path[0]] = tree[path[0]] || { items: [], subs: {} });
    for (const p of path.slice(1)) node = (node.subs[p] = node.subs[p] || { items: [], subs: {} });
    node.items.push({ a, order: a.order ?? 100, seq: i++, group: a.group || '' });
  }
  return tree;
}

export class MenuBar {
  constructor(app, el) {
    this.app = app; this.el = el; this.open = null;
    app.on('actions', () => this.render());
    app.on('project', () => this.updateTitle());
    app.on('history', () => this.updateTitle());
    window.addEventListener('mousedown', (e) => { if (this.open && !e.target.closest('.menu-pop') && !e.target.closest('.menu-top')) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.close(); }, true);
    this.render();
  }

  render() {
    const tree = buildMenuTree(this.app);
    const names = [...ORDER.filter((n) => tree[n]), ...Object.keys(tree).filter((n) => !ORDER.includes(n))];
    this.title = h('div', { class: 'project-title', id: 'project-title' });
    this.el.replaceChildren(
      h('div', { class: 'brand' }, 'SAINT MARROW STUDIO'),
      ...names.map((n) => h('div', { class: 'menu-top', role: 'menuitem', 'aria-haspopup': 'true', 'data-menu': n, onclick: (e) => this.toggle(n, e.currentTarget, tree[n]), onmouseenter: (e) => { if (this.open && this.open !== n) this.show(n, e.currentTarget, tree[n]); } }, n)),
      h('div', { class: 'spacer' }), this.title);
    this.updateTitle();
  }

  updateTitle() {
    if (!this.title) return;
    const a = this.app;
    this.title.replaceChildren(...[a.dirty ? h('span', { class: 'dirty-dot', title: 'Unsaved changes' }) : null, h('b', {}, a.project.meta.name), h('span', {}, a.storage.kind === 'memory' ? '(session storage)' : '')].filter(Boolean));
    document.title = `${a.dirty ? '• ' : ''}${a.project.meta.name} — Saint Marrow Studio`;
  }

  toggle(name, anchor, node) { if (this.open === name) this.close(); else this.show(name, anchor, node); }
  close() {
    document.querySelectorAll('.menu-pop:not(.ctx)').forEach((e) => e.remove());
    this.el.querySelectorAll('.menu-top.open').forEach((e) => e.classList.remove('open'));
    this.open = null;
  }
  show(name, anchor, node) {
    this.close();
    this.open = name;
    anchor.classList.add('open');
    const r = anchor.getBoundingClientRect();
    const pop = this.popup(node, r.left, r.bottom);
    document.getElementById('overlay-root').appendChild(pop);
    this.clamp(pop);
  }
  clamp(pop) {
    const b = pop.getBoundingClientRect();
    if (b.right > window.innerWidth) pop.style.left = Math.max(0, window.innerWidth - b.width - 4) + 'px';
    if (b.bottom > window.innerHeight) pop.style.top = Math.max(0, window.innerHeight - b.height - 4) + 'px';
  }
  popup(node, x, y) {
    const app = this.app;
    const pop = h('div', { class: 'menu-pop', role: 'menu', style: { left: x + 'px', top: y + 'px', pointerEvents: 'auto' } });
    const items = node.items.sort((a, b) => a.order - b.order || a.seq - b.seq);
    const closeSub = () => { pop._sub?.remove(); pop._sub = null; };
    let lastGroup = null;
    const rows = [];
    for (const it of items) {
      if (lastGroup !== null && it.group !== lastGroup) rows.push(h('div', { class: 'menu-sep' }));
      lastGroup = it.group;
      const a = it.a;
      const enabled = !a.enabled || a.enabled(app);
      const checked = a.checked ? a.checked(app) : false;
      const sc = a.shortcut ? [].concat(a.shortcut)[0] : '';
      rows.push(h('div', { class: 'menu-item' + (enabled ? '' : ' disabled'), role: 'menuitem', 'data-action': a.id, 'data-label': a.label, title: a.hint || '', onmouseenter: closeSub, onclick: () => { if (!enabled) return; this.close(); app.run(a.id); } },
        checked ? h('span', { class: 'chk' }, '✓') : null, a.label, sc ? h('span', { class: 'kbd' }, sc.replace('Ctrl', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')) : null));
    }
    for (const [name, sub] of Object.entries(node.subs)) {
      const row = h('div', { class: 'menu-item', role: 'menuitem', 'data-label': name, 'aria-haspopup': 'true' }, name, h('span', { class: 'sub' }, '▸'));
      row.addEventListener('mouseenter', () => {
        closeSub();
        const rr = row.getBoundingClientRect();
        const subPop = this.popup(sub, rr.right - 2, rr.top - 4);
        document.getElementById('overlay-root').appendChild(subPop);
        pop._sub = subPop;
        this.clamp(subPop);
      });
      rows.push(row);
    }
    pop.append(...rows);
    return pop;
  }
}

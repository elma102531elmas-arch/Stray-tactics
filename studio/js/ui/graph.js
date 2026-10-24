// Generic node-graph editor (used for event graphs, AI state machines and the story graph).
// Pure view over plain JSON: render(graph) -> DOM. All edits are reported through opts.commit(newGraph, label, mergeKey)
// so the caller makes them undoable commands. Pan/zoom, drag nodes, drag from a port to connect, Delete, context menu to add.
import { h } from './dom.js';
import { contextMenu } from './dialogs.js';

const W = 230;

export class GraphEditor {
  /**
   * opts: { registry:{types, categories}, getGraph(), commit(graph,label,mergeKey), newNode(type,x,y), suggest?(kind)->[string],
   *         decorate?(node)->[{severity,message}], edgeFields?:[def], edgeLabel?(edge)->string, singleInput?:bool, onSelect?(sel) }
   */
  constructor(app, container, opts) {
    this.app = app; this.container = container; this.opts = opts;
    this.view = { x: 40, y: 40, k: 1 };
    this.selection = new Set(); this.selEdge = null;
    this.fired = new Map();
    container.classList.add('graph-root');
    this.viewEl = h('div', { class: 'graph-view', tabindex: '0', role: 'application', 'aria-label': 'Graph editor' });
    this.world = h('div', { class: 'graph-world' });
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'graph-edges');
    this.world.appendChild(this.svg);
    this.nodesEl = h('div', { class: 'graph-nodes' });
    this.world.appendChild(this.nodesEl);
    this.viewEl.appendChild(this.world);
    this.edgePanel = h('div', { class: 'graph-edgepanel', style: { display: 'none' } });
    container.append(this.viewEl, this.edgePanel);
    this.datalists = h('div', { style: { display: 'none' } });
    container.appendChild(this.datalists);
    this._bind();
  }

  get graph() { return this.opts.getGraph(); }
  commit(graph, label, mergeKey) { this.opts.commit(graph, label, mergeKey); }
  mutate(fn, label, mergeKey) { const g = JSON.parse(JSON.stringify(this.graph)); fn(g); this.commit(g, label, mergeKey); }

  // ------------------------------------------------------------------ rendering
  render() {
    const g = this.graph;
    this.applyView();
    this.nodesEl.replaceChildren();
    this.datalists.replaceChildren();
    if (!g) { this.svg.replaceChildren(); return; }
    this.nodeEls = new Map();
    for (const n of g.nodes) { const el = this.nodeEl(n); this.nodesEl.appendChild(el); this.nodeEls.set(n.id, el); }
    requestAnimationFrame(() => this.drawEdges());
    this.drawEdges();
    this.showEdgePanel();
  }

  applyView() { this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.k})`; }

  def(n) { return this.opts.registry.types[n.type] || { label: n.type + ' (unknown)', color: '#a33', inputs: [], outputs: [], fields: [] }; }

  nodeEl(n) {
    const def = this.def(n);
    const badges = this.opts.decorate?.(n) || [];
    const el = h('div', { class: 'gnode' + (this.selection.has(n.id) ? ' sel' : '') + (this.fired.has(n.id) ? ' fired' : ''), 'data-id': n.id, 'data-type': n.type, style: { left: n.x + 'px', top: n.y + 'px', width: (def.width || W) + 'px' } });
    const head = h('div', { class: 'gnode-head', style: { background: def.color } },
      h('span', { class: 'gnode-title', title: def.hint || def.label }, def.label),
      ...badges.map((b) => h('span', { class: 'gbadge ' + b.severity, title: b.message }, b.severity === 'error' ? '⛔' : '⚠')),
      h('button', { class: 'gnode-x', title: 'Delete node', 'aria-label': 'Delete node', onpointerdown: (e) => e.stopPropagation(), onclick: () => this.deleteNodes([n.id]) }, '×'));
    el.appendChild(head);
    const body = h('div', { class: 'gnode-body' });
    if (def.inputs.length) body.appendChild(h('div', { class: 'gports in' }, def.inputs.map((p) => h('div', { class: 'gport-row' }, h('span', { class: 'gport in', 'data-node': n.id, 'data-port': p, title: 'Input' }), h('span', {}, p === 'in' ? '' : p)))));
    for (const f of def.fields) body.appendChild(this.fieldEl(n, f));
    if (def.outputs.length) body.appendChild(h('div', { class: 'gports out' }, def.outputs.map((p) => h('div', { class: 'gport-row' }, h('span', { class: 'gport-label' }, p === 'out' ? '' : p), h('span', { class: 'gport out', 'data-node': n.id, 'data-port': p, title: 'Drag to connect' })))));
    el.appendChild(body);
    head.addEventListener('pointerdown', (e) => this.startNodeDrag(e, n));
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('input,select,textarea,button,.gport')) return; this.select(n.id, e.shiftKey || e.ctrlKey); });
    if (def.hint) el.title = def.hint;
    return el;
  }

  fieldEl(n, f) {
    const val = n.data?.[f.key] ?? (f.default ?? '');
    const set = (v) => this.mutate((g) => { g.nodes.find((x) => x.id === n.id).data[f.key] = v; }, `Edit ${this.def(n).label}`, `gf:${n.id}:${f.key}`);
    let input;
    if (f.type === 'select') { input = h('select', { 'aria-label': f.label, onchange: (e) => set(e.target.value) }, f.options.map((o) => h('option', { value: o, selected: String(o) === String(val) }, o))); }
    else if (f.type === 'text') input = h('textarea', { rows: 2, 'aria-label': f.label, onchange: (e) => set(e.target.value) }, String(val));
    else if (f.type === 'number') input = h('input', { type: 'number', step: 'any', value: val, 'aria-label': f.label, onchange: (e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) set(v); } });
    else {
      input = h('input', { type: 'text', value: val, 'aria-label': f.label, onchange: (e) => set(e.target.value) });
      const sug = this.opts.suggest?.(f.ref || f.key === 'name' && n.type.startsWith('on.event') ? 'event' : f.ref, n, f);
      if (sug?.length) { const id = `dl-${n.id}-${f.key}`; this.datalists.appendChild(h('datalist', { id }, sug.map((s) => h('option', { value: s })))); input.setAttribute('list', id); }
    }
    ['keydown', 'pointerdown'].forEach((ev) => input.addEventListener(ev, (e) => e.stopPropagation()));
    return h('label', { class: 'gfield' }, h('span', {}, f.label), input);
  }

  // ------------------------------------------------------------------ edges
  portPoint(nodeId, port, side) {
    const el = this.nodeEls?.get(nodeId); if (!el) return null;
    const p = el.querySelector(`.gport.${side}[data-port="${CSS.escape(port)}"]`) || el.querySelector(`.gport.${side}`);
    if (!p) return null;
    const r = p.getBoundingClientRect(), w = this.world.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - w.left) / this.view.k, y: (r.top + r.height / 2 - w.top) / this.view.k };
  }
  drawEdges() {
    const g = this.graph; if (!g) return;
    const paths = [];
    for (const e of g.edges) {
      const a = this.portPoint(e.from.node, e.from.port, 'out'), b = this.portPoint(e.to.node, e.to.port, 'in');
      if (!a || !b) continue;
      const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5);
      const d = `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
      const label = this.opts.edgeLabel?.(e);
      const sel = this.selEdge === e.id;
      paths.push(`<path d="${d}" class="gedge${sel ? ' sel' : ''}" fill="none"/><path d="${d}" class="gedge-hit" data-edge="${e.id}" fill="none"/>`);
      if (label) paths.push(`<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 6}" class="gedge-label" text-anchor="middle">${label.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</text>`);
    }
    this.svg.innerHTML = paths.join('');
    this.svg.querySelectorAll('.gedge-hit').forEach((p) => p.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); this.selEdge = p.dataset.edge; this.selection.clear(); this.render(); this.opts.onSelect?.({ edge: this.selEdge }); }));
    if (this.pending) this.drawPending();
  }
  drawPending() {
    const pe = this.pending; const a = this.portPoint(pe.node, pe.port, 'out'); if (!a) return;
    const old = this.svg.querySelector('.gedge-pending'); old?.remove();
    const b = pe.to; const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'gedge-pending'); path.setAttribute('d', `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`); path.setAttribute('fill', 'none');
    this.svg.appendChild(path);
  }

  showEdgePanel() {
    const fields = this.opts.edgeFields;
    const g = this.graph;
    const e = this.selEdge && g?.edges.find((x) => x.id === this.selEdge);
    if (!fields || !e) { this.edgePanel.style.display = 'none'; return; }
    this.edgePanel.style.display = 'block';
    this.edgePanel.replaceChildren(h('b', {}, 'Connection'), ...fields.map((f) => {
      const val = e.data?.[f.key] ?? f.default ?? '';
      const set = (v) => this.mutate((gg) => { const ed = gg.edges.find((x) => x.id === e.id); ed.data = { ...(ed.data || {}), [f.key]: v }; }, 'Edit connection', `ge:${e.id}:${f.key}`);
      let input;
      if (f.type === 'select') input = h('select', { 'aria-label': f.label, onchange: (ev) => set(ev.target.value) }, f.options.map((o) => h('option', { value: o, selected: String(o) === String(val) }, o)));
      else if (f.type === 'number') input = h('input', { type: 'number', step: 'any', value: val, 'aria-label': f.label, onchange: (ev) => { const v = ev.target.valueAsNumber; if (Number.isFinite(v)) set(v); } });
      else input = h('input', { type: 'text', value: val, 'aria-label': f.label, onchange: (ev) => set(ev.target.value) });
      input.addEventListener('keydown', (ev) => ev.stopPropagation());
      return h('label', { class: 'gfield' }, h('span', {}, f.label), input);
    }), h('button', { class: 'btn small danger', onclick: () => this.deleteEdge(e.id) }, 'Delete connection'));
  }

  // ------------------------------------------------------------------ interaction
  _bind() {
    const v = this.viewEl;
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = v.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.max(0.3, Math.min(1.8, this.view.k * Math.exp(-e.deltaY * 0.0012)));
      this.view.x = mx - ((mx - this.view.x) / this.view.k) * k; this.view.y = my - ((my - this.view.y) / this.view.k) * k; this.view.k = k;
      this.applyView();
    }, { passive: false });
    v.addEventListener('pointerdown', (e) => {
      const port = e.target.closest('.gport.out');
      if (port) return this.startConnect(e, port);
      if (e.target.closest('.gnode')) return;
      if (e.target.closest('.gedge-hit')) return;
      v.focus();
      this.selection.clear(); this.selEdge = null; this.render(); this.opts.onSelect?.(null);
      if (e.button === 2) return;
      const start = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      v.setPointerCapture(e.pointerId);
      const mv = (ev) => { this.view.x = start.vx + ev.clientX - start.x; this.view.y = start.vy + ev.clientY - start.y; this.applyView(); };
      const up = () => { v.removeEventListener('pointermove', mv); v.removeEventListener('pointerup', up); };
      v.addEventListener('pointermove', mv); v.addEventListener('pointerup', up);
    });
    v.addEventListener('contextmenu', (e) => { e.preventDefault(); const p = this.toWorld(e); this.addMenu(e.clientX, e.clientY, p.x, p.y); });
    v.addEventListener('dblclick', (e) => { if (e.target === v || e.target === this.world || e.target.closest('.graph-edges')) { const p = this.toWorld(e); this.addMenu(e.clientX, e.clientY, p.x, p.y); } });
    v.addEventListener('keydown', (e) => {
      if (e.target.closest('input,select,textarea')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); if (this.selEdge) this.deleteEdge(this.selEdge); else if (this.selection.size) this.deleteNodes([...this.selection]); }
    });
  }
  toWorld(e) { const r = this.viewEl.getBoundingClientRect(); return { x: (e.clientX - r.left - this.view.x) / this.view.k, y: (e.clientY - r.top - this.view.y) / this.view.k }; }

  select(id, add) { if (!add) this.selection.clear(); if (add && this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); this.selEdge = null; this.nodeEls?.forEach((el, nid) => el.classList.toggle('sel', this.selection.has(nid))); this.showEdgePanel(); this.opts.onSelect?.({ nodes: [...this.selection] }); }

  startNodeDrag(e, n) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (!this.selection.has(n.id)) this.select(n.id, e.shiftKey || e.ctrlKey);
    const ids = [...this.selection];
    const start = { x: e.clientX, y: e.clientY };
    const orig = new Map(ids.map((id) => { const nn = this.graph.nodes.find((x) => x.id === id); return [id, { x: nn.x, y: nn.y }]; }));
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    let moved = false;
    const mv = (ev) => {
      const dx = (ev.clientX - start.x) / this.view.k, dy = (ev.clientY - start.y) / this.view.k;
      if (!moved && Math.hypot(dx, dy) < 3) return; moved = true;
      for (const [id, o] of orig) { const nel = this.nodeEls.get(id); nel.style.left = Math.round(o.x + dx) + 'px'; nel.style.top = Math.round(o.y + dy) + 'px'; }
      this.drawEdges();
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      if (!moved) return;
      const dx = (ev.clientX - start.x) / this.view.k, dy = (ev.clientY - start.y) / this.view.k;
      this.mutate((g) => { for (const [id, o] of orig) { const nn = g.nodes.find((x) => x.id === id); nn.x = Math.round(o.x + dx); nn.y = Math.round(o.y + dy); } }, ids.length > 1 ? `Move ${ids.length} nodes` : 'Move node');
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  }

  startConnect(e, portEl) {
    e.preventDefault(); e.stopPropagation();
    const node = portEl.dataset.node, port = portEl.dataset.port;
    this.pending = { node, port, to: this.toWorld(e) };
    const v = this.viewEl; v.setPointerCapture(e.pointerId);
    const mv = (ev) => { this.pending.to = this.toWorld(ev); this.drawPending(); };
    const up = (ev) => {
      v.removeEventListener('pointermove', mv); v.removeEventListener('pointerup', up);
      try { v.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const inPort = target?.closest?.('.gport.in');
      const pend = this.pending; this.pending = null;
      this.svg.querySelector('.gedge-pending')?.remove();
      if (inPort) this.connect(pend.node, pend.port, inPort.dataset.node, inPort.dataset.port);
      else if (this.opts.quickAdd !== false && !target?.closest?.('.gnode')) { const p = this.toWorld(ev); this.addMenu(ev.clientX, ev.clientY, p.x, p.y, { from: pend }); }
    };
    v.addEventListener('pointermove', mv); v.addEventListener('pointerup', up);
  }

  connect(fromNode, fromPort, toNode, toPort) {
    if (fromNode === toNode) { this.app.toast('A node cannot connect to itself.', 'warn'); return false; }
    const g = this.graph;
    if (g.edges.some((e) => e.from.node === fromNode && e.from.port === fromPort && e.to.node === toNode && e.to.port === toPort)) return false;
    this.mutate((gg) => { gg.edges.push({ id: 'e_' + Math.random().toString(36).slice(2, 9), from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort }, data: this.opts.defaultEdgeData ? { ...this.opts.defaultEdgeData } : undefined }); }, 'Connect nodes');
    return true;
  }

  addMenu(x, y, wx, wy, { from = null } = {}) {
    const reg = this.opts.registry;
    const items = [];
    for (const cat of reg.categories) {
      items.push({ header: cat });
      for (const [type, def] of Object.entries(reg.types)) if (def.cat === cat && !(from && !def.inputs.length)) items.push({ label: def.label, run: () => this.addNode(type, wx, wy, from) });
    }
    contextMenu(x, y, items);
  }
  addNode(type, x, y, from = null) {
    const node = this.opts.newNode(type, Math.round(x - 20), Math.round(y - 10));
    this.mutate((g) => {
      g.nodes.push(node);
      if (from) { const def = this.def(node); g.edges.push({ id: 'e_' + Math.random().toString(36).slice(2, 9), from: { node: from.node, port: from.port }, to: { node: node.id, port: def.inputs[0] || 'in' }, data: this.opts.defaultEdgeData ? { ...this.opts.defaultEdgeData } : undefined }); }
    }, `Add ${this.def(node).label}`);
    this.selection = new Set([node.id]);
    return node;
  }
  deleteNodes(ids) {
    const s = new Set(ids);
    this.mutate((g) => { g.nodes = g.nodes.filter((n) => !s.has(n.id)); g.edges = g.edges.filter((e) => !s.has(e.from.node) && !s.has(e.to.node)); }, ids.length > 1 ? `Delete ${ids.length} nodes` : 'Delete node');
    this.selection.clear();
  }
  deleteEdge(id) { this.mutate((g) => { g.edges = g.edges.filter((e) => e.id !== id); }, 'Delete connection'); this.selEdge = null; }

  fit() {
    const g = this.graph; if (!g?.nodes.length) { this.view = { x: 40, y: 40, k: 1 }; this.applyView(); return; }
    const xs = g.nodes.map((n) => n.x), ys = g.nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 30, minY = Math.min(...ys) - 30, maxX = Math.max(...xs) + W + 30, maxY = Math.max(...ys) + 200;
    const r = this.viewEl.getBoundingClientRect();
    const k = Math.max(0.3, Math.min(1.2, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    this.view = { k, x: -minX * k + 20, y: -minY * k + 20 };
    this.applyView(); requestAnimationFrame(() => this.drawEdges());
  }

  /** Flash nodes (simulator). ids: Set of node ids. */
  flash(ids) {
    this.fired = new Map([...ids].map((i) => [i, 1]));
    this.nodeEls?.forEach((el, id) => el.classList.toggle('fired', this.fired.has(id)));
    clearTimeout(this._ft); this._ft = setTimeout(() => { this.fired.clear(); this.nodeEls?.forEach((el) => el.classList.remove('fired')); }, 2500);
  }
}

// Events workspace: author event graphs (triggers → conditions → actions), check them statically, and simulate them.
// The simulator uses the SAME runtime as playtest, with a virtual clock, so what you see here is what runs there.
import { h } from '../ui/dom.js';
import { GraphEditor } from '../ui/graph.js';
import { button, textField, selectField } from '../ui/fields.js';
import { confirmBox, promptBox } from '../ui/dialogs.js';
import { setData } from '../core/commands.js';
import { EVENT_NODE_TYPES, EVENT_CATEGORIES, newGraph, newNode, EventRuntime, analyzeGraphs, sceneEventNames, autoLayout } from '../core/events.js';

class EventsWorkspace {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.current = null;
    this.runtime = null;
    this.listEl = h('div', { class: 'panel-body', style: { flex: 1 } });
    this.graphBox = h('div', { style: { flex: 1, position: 'relative' } });
    this.problemsEl = h('div', { class: 'panel-body', style: { maxHeight: '170px', borderTop: '1px solid var(--line)' } });
    this.simEl = h('div', { class: 'panel-body insp' });
    el.append(h('div', { class: 'split', style: { height: '100%' } },
      h('div', { class: 'pane', style: { width: '230px', display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: '1px solid var(--line)' } },
        h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Event graphs')), this.listEl,
        h('div', { style: { padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: '1px solid var(--line)' } }, button('New', () => this.createGraph(), { primary: true }), button('Rename', () => this.renameGraph()), button('Duplicate', () => this.duplicateGraph()), button('Delete', () => this.deleteGraph()))),
      h('div', { class: 'pane', style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('div', { class: 'graph-bar' }, h('b', { id: 'ev-title', style: { marginRight: 'auto' } }, 'No graph'), button('Auto layout', () => this.layout()), button('Fit', () => this.editor?.fit()),
          h('span', { style: { color: 'var(--faint)', fontSize: '11px' } }, 'Right-click or double-click the canvas to add nodes · drag from a dot to connect · Del removes')),
        this.graphBox, this.problemsEl),
      h('div', { class: 'pane', style: { width: '330px', background: 'var(--panel)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' } }, h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Simulator')), this.simEl)));
    this.editor = new GraphEditor(app, this.graphBox, {
      registry: { types: EVENT_NODE_TYPES, categories: EVENT_CATEGORIES },
      getGraph: () => (this.current ? app.project.data.events.graphs[this.current] || null : null),
      commit: (g, label, mergeKey) => app.exec(setData(['events', 'graphs', this.current], g, { label, mergeKey })),
      newNode: (type, x, y) => newNode(type, x, y),
      suggest: (kind) => this.suggest(kind),
      decorate: (n) => this.badges(n),
    });
    app.on('history', () => { if (this.el.classList.contains('on')) this.refresh(); });
    app.on('project', () => { this.current = null; this.runtime = null; if (this.el.classList.contains('on')) this.show(); });
    app.on('goto', (e) => { if (e.workspace === 'events' && e.graph) { this.current = e.graph; if (this.el.classList.contains('on')) this.refresh(); if (e.node) setTimeout(() => this.editor.select(e.node), 50); } });
  }

  graphs() { return this.app.project.data.events.graphs; }
  show() { const ids = Object.keys(this.graphs()); if (!this.current || !this.graphs()[this.current]) this.current = ids[0] || null; this.refresh(); this.editor.fit(); }
  hide() {}

  refresh() {
    this.analysis = analyzeGraphs(this.app.project);
    this.renderList(); this.editor.render(); this.renderProblems(); this.renderSim();
    document.getElementById('ev-title').textContent = this.current ? this.graphs()[this.current].name : 'No graph — create one on the left';
  }

  renderList() {
    const gs = Object.values(this.graphs());
    this.listEl.replaceChildren(...(gs.length ? gs.map((g) => {
      const n = this.analysis.issues.filter((i) => i.graph === g.id && i.severity !== 'info').length;
      return h('div', { class: 'tree-row' + (g.id === this.current ? ' sel primary' : ''), style: { position: 'relative', height: '28px' }, 'data-graph': g.id, onclick: () => { this.current = g.id; this.runtime = null; this.refresh(); this.editor.fit(); } },
        h('span', { class: 'tree-name', style: { marginLeft: '10px' } }, g.name), h('span', { class: 'tree-tag' }, `${g.nodes.length} nodes`), n ? h('span', { class: 'gbadge warn', title: `${n} problem(s)` }, '⚠') : null);
    }) : [h('div', { class: 'empty' }, 'No event graphs yet. Create one to react to triggers, pickups and interactions.')]));
  }

  badges(n) {
    return this.analysis.issues.filter((i) => i.node === n.id && i.graph === this.current).map((i) => ({ severity: i.severity === 'info' ? 'warn' : i.severity, message: i.message }));
  }

  suggest(kind) {
    const p = this.app.project, scene = p.scene;
    switch (kind) {
      case 'event': return [...new Set([...sceneEventNames(p).keys(), ...this.analysis.emitted, ...this.analysis.handled])].sort();
      case 'door': return scene.find((n) => n.type === 'door').map((n) => n.props.doorId || n.name);
      case 'lightGroup': return [...new Set(scene.find((n) => n.type === 'light').map((n) => n.props.powerGroup).filter(Boolean))];
      case 'node': return scene.all().filter((n) => n.type !== 'group').map((n) => n.name);
      case 'sequence': return Object.keys(p.data.sequences || {});
      case 'script': return Object.keys(p.data.scripts || {});
      case 'checkpoint': return scene.find((n) => n.type === 'checkpoint').map((n) => n.props.checkpointId || n.name);
      case 'asset': return this.app.assets.allMeta('audio').map((m) => m.id);
      default: return [];
    }
  }

  // ---------------------------------------------------------------- graph management
  createGraph(name) {
    const g = newGraph(name || `Events ${Object.keys(this.graphs()).length + 1}`);
    this.app.exec(setData(['events', 'graphs', g.id], g, { label: 'Create event graph' }));
    this.current = g.id; this.refresh();
    return g;
  }
  async renameGraph() { if (!this.current) return; const g = this.graphs()[this.current]; const v = await promptBox('Rename graph', 'Name', g.name); if (v?.trim()) this.app.exec(setData(['events', 'graphs', g.id, 'name'], v.trim(), { label: 'Rename graph' })); }
  duplicateGraph() { if (!this.current) return; const src = JSON.parse(JSON.stringify(this.graphs()[this.current])); const g = { ...src, id: 'g_' + Math.random().toString(36).slice(2, 8), name: src.name + ' copy' }; const map = new Map(); g.nodes = g.nodes.map((n) => { const id = 'en_' + Math.random().toString(36).slice(2, 8); map.set(n.id, id); return { ...n, id }; }); g.edges = g.edges.map((e) => ({ ...e, id: 'e_' + Math.random().toString(36).slice(2, 8), from: { ...e.from, node: map.get(e.from.node) }, to: { ...e.to, node: map.get(e.to.node) } })); this.app.exec(setData(['events', 'graphs', g.id], g, { label: 'Duplicate graph' })); this.current = g.id; this.refresh(); }
  async deleteGraph() { if (!this.current) return; const g = this.graphs()[this.current]; if (!(await confirmBox('Delete graph', `Delete “${g.name}” (${g.nodes.length} nodes)? You can undo this.`, { ok: 'Delete', danger: true }))) return; const next = { ...this.graphs() }; delete next[g.id]; this.app.exec(setData(['events', 'graphs'], next, { label: 'Delete graph' })); this.current = null; this.runtime = null; this.refresh(); }
  layout() { if (!this.current) return; const g = JSON.parse(JSON.stringify(this.graphs()[this.current])); const pos = autoLayout(g); g.nodes.forEach((n) => { n.x = pos[n.id].x; n.y = pos[n.id].y; }); this.app.exec(setData(['events', 'graphs', g.id], g, { label: 'Auto layout' })); setTimeout(() => this.editor.fit(), 30); }

  addHandler(name) {
    const g = this.current ? this.graphs()[this.current] : this.createGraph();
    const copy = JSON.parse(JSON.stringify(g));
    const maxY = Math.max(0, ...copy.nodes.map((n) => n.y + 120));
    copy.nodes.push(newNode('on.event', 40, maxY, { name }));
    this.app.exec(setData(['events', 'graphs', g.id], copy, { label: `Add handler for “${name}”` }));
    this.refresh(); this.editor.fit();
  }

  // ---------------------------------------------------------------- problems
  renderProblems() {
    const issues = this.analysis.issues.filter((i) => i.severity !== 'info' || true);
    const fired = sceneEventNames(this.app.project);
    const handled = new Set(this.analysis.handled);
    const unhandled = [...fired.keys()].filter((n) => !handled.has(n));
    const rows = [];
    for (const name of unhandled) rows.push(h('div', { class: 'issue', 'data-kind': 'unhandled' }, h('span', { class: 'sev warn' }), h('div', { style: { flex: 1 } }, `“${name}” is fired by ${fired.get(name).slice(0, 2).join(', ')} but nothing handles it.`), button('Add handler', () => this.addHandler(name))));
    for (const i of issues) rows.push(h('div', { class: 'issue', 'data-code': i.code, onclick: () => { if (i.graph && this.graphs()[i.graph]) { this.current = i.graph; this.refresh(); if (i.node) this.editor.select(i.node); } } }, h('span', { class: 'sev ' + i.severity }), h('div', { style: { flex: 1 } }, i.message)));
    this.problemsEl.replaceChildren(h('div', { class: 'panel-head', style: { position: 'sticky', top: 0 } }, h('span', { class: 'title' }, `Graph problems (${rows.length})`)), ...(rows.length ? rows : [h('div', { class: 'empty' }, 'No problems found in the event graphs.')]));
  }

  // ---------------------------------------------------------------- simulator
  ensureRuntime() {
    if (this.runtime) return this.runtime;
    this.visited = new Set();
    this.runtime = new EventRuntime(JSON.parse(JSON.stringify(this.graphs())), {}, { onVisit: (g, n) => { if (g.id === this.current) this.visited.add(n.id); } });
    return this.runtime;
  }
  fire(name) { const r = this.ensureRuntime(); this.visited = new Set(); r.emit(name); this.afterRun(); }
  afterRun() { this.editor.flash(this.visited); this.renderSim(); }
  renderSim() {
    const r = this.runtime, st = r?.state;
    const names = [...new Set([...sceneEventNames(this.app.project).keys(), ...this.analysis.handled])].sort();
    const input = h('input', { type: 'text', list: 'ev-names', placeholder: 'event name', 'aria-label': 'Event to fire', style: { flex: 1, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '4px', padding: '3px 6px' }, onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' && input.value) this.fire(input.value); } });
    const kv = (obj) => Object.keys(obj || {}).length ? h('div', { class: 'kv', style: { fontSize: '11px' } }, Object.entries(obj).flatMap(([k, v]) => [h('span', {}, k), h('span', {}, String(v))])) : h('div', { class: 'hint', style: { color: 'var(--faint)', fontSize: '11px' } }, 'none');
    this.simEl.replaceChildren(
      h('div', { class: 'note' }, 'Fire events and watch the graph run on a virtual clock. Effects are recorded here; they are not applied to the map (use Playtest for that).'),
      h('div', { style: { display: 'flex', gap: '6px', padding: '0 10px 6px' } }, input, button('Fire', () => input.value && this.fire(input.value), { primary: true })),
      h('datalist', { id: 'ev-names' }, names.map((n) => h('option', { value: n }))),
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '0 10px 8px' } },
        button('Start map', () => { const rt = this.ensureRuntime(); this.visited = new Set(); rt.start(); this.afterRun(); }), button('+1 s', () => { this.ensureRuntime().advance(1); this.afterRun(); }), button('+10 s', () => { this.ensureRuntime().advance(10); this.afterRun(); }), button('Reset', () => { this.runtime = null; this.renderSim(); })),
      h('div', { class: 'sec-h', style: { cursor: 'default' } }, `State — t = ${(r?.time || 0).toFixed(1)} s`),
      h('div', { style: { padding: '6px 10px' } }, h('b', {}, 'Flags'), kv(st?.flags), h('b', { style: { display: 'block', marginTop: '6px' } }, 'Counters'), kv(st?.vars), h('b', { style: { display: 'block', marginTop: '6px' } }, 'Inventory'), kv(st?.inventory), h('b', { style: { display: 'block', marginTop: '6px' } }, 'Doors'), kv(st?.doors), h('b', { style: { display: 'block', marginTop: '6px' } }, 'Lights'), kv(st?.lights), st?.objective ? h('div', { style: { marginTop: '6px' } }, h('b', {}, 'Objective: '), st.objective) : null),
      h('div', { class: 'sec-h', style: { cursor: 'default' } }, 'Trace'),
      h('div', { class: 'console', id: 'ev-trace', style: { padding: '6px 10px', maxHeight: '240px', overflow: 'auto' } }, ...(r?.log.slice(-80) || []).map((l) => h('div', { class: 'log ' + (l.includes('ERROR') ? 'error' : 'info') }, l))));
  }
}

export default {
  id: 'events', label: 'Events', fill: true,
  create(app, el) { const w = new EventsWorkspace(app, el); app.eventsWs = w; return w; },
};

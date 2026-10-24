// Event graphs: the data model, a deterministic runtime and static analysis. DOM-free so every rule is unit-tested.
//
// A graph = { id, name, nodes:[{id,type,x,y,data}], edges:[{id, from:{node,port}, to:{node,port}}] }.
// Flow runs along edges from trigger nodes ("on.*") through flow/action nodes. Time (delays) uses a virtual clock the host advances,
// so the same graph behaves identically in the editor simulator, in tests and in playtest.

import { uid, deepClone } from './util.js';

// ---------------------------------------------------------------------------------------------- node types
const F = (key, label, type = 'string', extra = {}) => ({ key, label, type, ...extra });
const COND = [F('kind', 'Condition', 'select', { options: ['flag', 'item', 'var', 'door'], default: 'flag' }), F('name', 'Name / item / door id', 'string'), F('op', 'Compare', 'select', { options: ['==', '!=', '>', '>=', '<', '<='], default: '==' }), F('value', 'Value', 'string', { default: 'true' })];

export const EVENT_NODE_TYPES = {
  'on.start':   { cat: 'Triggers', label: 'On map start', color: '#3aa76d', inputs: [], outputs: ['out'], fields: [] },
  'on.event':   { cat: 'Triggers', label: 'On event', color: '#3aa76d', inputs: [], outputs: ['out'], fields: [F('name', 'Event name')], hint: 'Fires when something emits this event: a trigger zone, an interaction, an item pickup, another graph, a timeline.' },
  'on.flag':    { cat: 'Triggers', label: 'When flag changes', color: '#3aa76d', inputs: [], outputs: ['out'], fields: [F('name', 'Flag'), F('value', 'Becomes', 'string', { default: 'true' })] },
  'on.timer':   { cat: 'Triggers', label: 'Every N seconds', color: '#3aa76d', inputs: [], outputs: ['out'], fields: [F('seconds', 'Seconds', 'number', { default: 10, min: 0.1 }), F('max', 'Max times (0 = forever)', 'number', { default: 0, min: 0 })] },
  'flow.branch': { cat: 'Flow', label: 'Branch', color: '#c78a2b', inputs: ['in'], outputs: ['true', 'false'], fields: COND },
  'flow.delay': { cat: 'Flow', label: 'Wait', color: '#c78a2b', inputs: ['in'], outputs: ['out'], fields: [F('seconds', 'Seconds', 'number', { default: 1, min: 0 })] },
  'flow.once':  { cat: 'Flow', label: 'Only the first time', color: '#c78a2b', inputs: ['in'], outputs: ['out'], fields: [] },
  'flow.sequence': { cat: 'Flow', label: 'In order', color: '#c78a2b', inputs: ['in'], outputs: ['1', '2', '3', '4'], fields: [] },
  'flow.random': { cat: 'Flow', label: 'Pick one at random', color: '#c78a2b', inputs: ['in'], outputs: ['a', 'b', 'c'], fields: [] },
  'act.setFlag': { cat: 'Actions', label: 'Set flag', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('name', 'Flag'), F('value', 'Value', 'string', { default: 'true' })] },
  'act.addVar': { cat: 'Actions', label: 'Add to counter', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('name', 'Counter'), F('amount', 'Add', 'number', { default: 1 })] },
  'act.emit':   { cat: 'Actions', label: 'Emit event', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('name', 'Event name')] },
  'act.door':   { cat: 'Actions', label: 'Door', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('doorId', 'Door id', 'string', { ref: 'door' }), F('action', 'Action', 'select', { options: ['open', 'close', 'toggle', 'lock', 'unlock'], default: 'open' })] },
  'act.light':  { cat: 'Actions', label: 'Lights', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('group', 'Power group', 'string', { ref: 'lightGroup' }), F('action', 'Action', 'select', { options: ['on', 'off', 'flicker'], default: 'off' })] },
  'act.sound':  { cat: 'Actions', label: 'Play sound', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('asset', 'Sound asset', 'asset:audio', { ref: 'asset' }), F('at', 'At object (optional)', 'string', { ref: 'node' }), F('volume', 'Volume', 'number', { default: 1, min: 0, max: 2 })] },
  'act.spawn':  { cat: 'Actions', label: 'Spawn enemy', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('spawnId', 'Enemy spawn (object name or id)', 'string', { ref: 'node' })] },
  'act.item':   { cat: 'Actions', label: 'Give / take item', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('item', 'Item id'), F('action', 'Action', 'select', { options: ['give', 'take'], default: 'give' }), F('count', 'Count', 'number', { default: 1, min: 1 })] },
  'act.say':    { cat: 'Actions', label: 'Show text', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('text', 'Text', 'text'), F('seconds', 'Seconds', 'number', { default: 4, min: 0.5 })] },
  'act.objective': { cat: 'Actions', label: 'Set objective', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('text', 'Objective text', 'text')] },
  'act.sequence': { cat: 'Actions', label: 'Play sequence (timeline)', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('sequence', 'Sequence id', 'string', { ref: 'sequence' })] },
  'act.checkpoint': { cat: 'Actions', label: 'Save checkpoint', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('id', 'Checkpoint id', 'string', { ref: 'checkpoint' })] },
  'act.enable': { cat: 'Actions', label: 'Enable / disable object', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('target', 'Object (name or id)', 'string', { ref: 'node' }), F('enabled', 'Enabled', 'select', { options: ['true', 'false'], default: 'true' })] },
  'act.teleport': { cat: 'Actions', label: 'Move player to spawn', color: '#3f78c4', inputs: ['in'], outputs: ['out'], fields: [F('spawn', 'Player spawn (name or id)', 'string', { ref: 'node' })] },
  'act.script': { cat: 'Actions', label: 'Run plugin script', color: '#a45cc4', inputs: ['in'], outputs: ['out'], fields: [F('script', 'Script id', 'string', { ref: 'script' })], hint: 'Runs in the sandbox with the permissions you granted.' },
};
export const EVENT_CATEGORIES = ['Triggers', 'Flow', 'Actions'];

export function newGraph(name = 'New event graph') { return { id: uid('g'), name, nodes: [], edges: [] }; }
export function newNode(type, x = 0, y = 0, data = {}) {
  const def = EVENT_NODE_TYPES[type];
  if (!def) throw new Error(`Unknown event node type "${type}"`);
  const d = {};
  for (const f of def.fields) if (f.default !== undefined) d[f.key] = f.default;
  return { id: uid('en'), type, x, y, data: { ...d, ...deepClone(data) } };
}

// ---------------------------------------------------------------------------------------------- conditions
export function evalCondition(c, st) {
  const cmp = (a, op, b) => { const na = Number(a), nb = Number(b); const num = Number.isFinite(na) && Number.isFinite(nb) && a !== '' && b !== ''; const x = num ? na : String(a), y = num ? nb : String(b); switch (op) { case '!=': return x !== y; case '>': return x > y; case '>=': return x >= y; case '<': return x < y; case '<=': return x <= y; default: return x === y; } };
  switch (c.kind) {
    case 'flag': return cmp(String(st.flags[c.name] ?? 'false'), c.op || '==', c.value ?? 'true');
    case 'var': return cmp(st.vars[c.name] ?? 0, c.op || '==', c.value ?? 0);
    case 'item': return cmp(st.inventory[c.name] ?? 0, c.op && c.op !== '==' ? c.op : '>=', c.value === 'true' || c.value === undefined ? 1 : c.value);
    case 'door': return cmp(st.doors?.[c.name] ?? 'closed', c.op || '==', c.value ?? 'open');
    default: return false;
  }
}

// ---------------------------------------------------------------------------------------------- runtime
export class EventRuntime {
  /**
   * @param graphs  { [id]: graph }
   * @param adapter optional world adapter: { door(id, action), light(group, action), sound(o), spawn(id), say(text, s), objective(text), sequence(id), checkpoint(id), enable(target, bool), teleport(spawn), item(item, action, n), script(id) }
   */
  constructor(graphs, adapter = {}, { maxSteps = 4000, maxDepth = 40, rng = Math.random, onVisit = null } = {}) {
    this.graphs = graphs || {};
    this.adapter = adapter;
    this.opts = { maxSteps, maxDepth, rng, onVisit };
    this.state = { flags: {}, vars: {}, inventory: {}, doors: {}, lights: {}, enabled: {}, objective: '' };
    this.once = new Set();
    this.timers = [];        // {at, thread}
    this.periodic = [];      // {at, every, left, node, graph}
    this.time = 0;
    this.log = [];           // human-readable trace
    this.effects = [];       // machine-readable list of what happened
    this.errors = [];
    this.depth = 0;
    this._index();
  }

  _index() {
    this.byEvent = new Map(); this.onStart = []; this.onFlag = []; this.timersDef = [];
    for (const g of Object.values(this.graphs)) {
      for (const n of g.nodes) {
        if (n.type === 'on.event' && n.data.name) { if (!this.byEvent.has(n.data.name)) this.byEvent.set(n.data.name, []); this.byEvent.get(n.data.name).push({ g, n }); }
        else if (n.type === 'on.start') this.onStart.push({ g, n });
        else if (n.type === 'on.flag') this.onFlag.push({ g, n });
        else if (n.type === 'on.timer') this.timersDef.push({ g, n });
      }
    }
  }

  start() {
    this.record('start');
    for (const { g, n } of this.onStart) { this.opts.onVisit?.(g, n); this._run(g, n, 'out', { event: 'start' }); }
    for (const { g, n } of this.timersDef) this.periodic.push({ at: this.time + Math.max(0.1, +n.data.seconds || 10), every: Math.max(0.1, +n.data.seconds || 10), left: +n.data.max > 0 ? +n.data.max : Infinity, g, n });
  }

  record(type, detail = {}) { const e = { t: +this.time.toFixed(3), type, ...detail }; this.effects.push(e); return e; }
  say(msg) { this.log.push(`[${this.time.toFixed(2)}s] ${msg}`); }

  /** Emit a named event. Returns the number of graph threads started. */
  emit(name, payload = {}) {
    if (this.depth >= this.opts.maxDepth) { this._err(`Event loop: “${name}” was emitted ${this.depth} levels deep. Check for graphs that emit the event they listen to.`); return 0; }
    this.record('event', { name });
    this.say(`event “${name}”`);
    const handlers = this.byEvent.get(name) || [];
    if (!handlers.length) this.say(`  (nothing listens to “${name}”)`);
    this.depth++;
    try { for (const { g, n } of handlers) { this.opts.onVisit?.(g, n); this._run(g, n, 'out', { event: name, ...payload }); } } finally { this.depth--; }
    return handlers.length;
  }

  setFlag(name, value) {
    const v = String(value);
    const old = this.state.flags[name];
    this.state.flags[name] = v;
    this.record('flag', { name, value: v });
    if (old !== v) for (const { g, n } of this.onFlag) if (n.data.name === name && String(n.data.value ?? 'true') === v) this._run(g, n, 'out', { event: 'flag:' + name });
  }

  /** Advance virtual time and run whatever came due (delays, repeating timers). */
  advance(dt) {
    const end = this.time + dt;
    for (;;) {
      const due = [...this.timers.map((t) => ({ at: t.at, kind: 'thread', t })), ...this.periodic.filter((p) => p.left > 0).map((p) => ({ at: p.at, kind: 'periodic', p }))].filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.time = due.at;
      if (due.kind === 'thread') { this.timers.splice(this.timers.indexOf(due.t), 1); this._continue(due.t.graph, due.t.node, due.t.port, due.t.ctx); }
      else { const p = due.p; p.left--; p.at += p.every; this._run(p.g, p.n, 'out', { event: 'timer' }); }
    }
    this.time = end;
  }

  _err(msg) { this.errors.push(msg); this.say('ERROR ' + msg); }

  _next(g, node, port) { return g.edges.filter((e) => e.from.node === node.id && e.from.port === port).map((e) => g.nodes.find((n) => n.id === e.to.node)).filter(Boolean); }
  _run(g, node, port, ctx) { this._continue(g, node, port, ctx); }
  _continue(g, node, port, ctx) {
    const budget = { steps: 0 };
    const walk = (from, fromPort) => { for (const nx of this._next(g, from, fromPort)) this._exec(g, nx, ctx, budget, walk); };
    walk(node, port);
  }

  _exec(g, n, ctx, budget, walk) {
    if (++budget.steps > this.opts.maxSteps) { if (budget.steps === this.opts.maxSteps + 1) this._err(`Graph “${g.name}” ran more than ${this.opts.maxSteps} steps in one go — stopped (is there a loop?).`); return; }
    this.opts.onVisit?.(g, n);
    const d = n.data || {}, a = this.adapter, st = this.state;
    const out = (p = 'out') => walk(n, p);
    switch (n.type) {
      case 'flow.branch': this.say(`  branch ${d.kind} ${d.name} ${d.op || '=='} ${d.value} → ${evalCondition(d, st)}`); return out(evalCondition(d, st) ? 'true' : 'false');
      case 'flow.delay': this.say(`  wait ${d.seconds}s`); this.timers.push({ at: this.time + Math.max(0, +d.seconds || 0), graph: g, node: n, port: 'out', ctx }); return;
      case 'flow.once': { const k = g.id + ':' + n.id; if (this.once.has(k)) { this.say('  once: already used'); return; } this.once.add(k); return out(); }
      case 'flow.sequence': for (const p of ['1', '2', '3', '4']) out(p); return;
      case 'flow.random': { const ports = ['a', 'b', 'c'].filter((p) => g.edges.some((e) => e.from.node === n.id && e.from.port === p)); if (ports.length) out(ports[Math.floor(this.opts.rng() * ports.length)]); return; }
      case 'act.setFlag': this.say(`  set flag ${d.name} = ${d.value}`); this.setFlag(d.name, d.value ?? 'true'); return out();
      case 'act.addVar': st.vars[d.name] = (st.vars[d.name] || 0) + (+d.amount || 0); this.record('var', { name: d.name, value: st.vars[d.name] }); return out();
      case 'act.emit': this.say(`  emit “${d.name}”`); this.emit(d.name, ctx); return out();
      case 'act.door': { const m = { open: 'open', close: 'closed', unlock: null, lock: null }; if (d.action === 'toggle') st.doors[d.doorId] = st.doors[d.doorId] === 'open' ? 'closed' : 'open'; else if (m[d.action]) st.doors[d.doorId] = m[d.action]; this.record('door', { doorId: d.doorId, action: d.action }); a.door?.(d.doorId, d.action); return out(); }
      case 'act.light': st.lights[d.group] = d.action; this.record('light', { group: d.group, action: d.action }); a.light?.(d.group, d.action); return out();
      case 'act.sound': this.record('sound', { asset: d.asset, at: d.at || null, volume: d.volume ?? 1 }); a.sound?.(d); return out();
      case 'act.spawn': this.record('spawn', { spawnId: d.spawnId }); a.spawn?.(d.spawnId); return out();
      case 'act.item': { const c = +d.count || 1; st.inventory[d.item] = Math.max(0, (st.inventory[d.item] || 0) + (d.action === 'take' ? -c : c)); this.record('item', { item: d.item, action: d.action, count: c }); a.item?.(d.item, d.action, c); return out(); }
      case 'act.say': this.record('say', { text: d.text, seconds: d.seconds }); a.say?.(d.text, d.seconds); return out();
      case 'act.objective': st.objective = d.text; this.record('objective', { text: d.text }); a.objective?.(d.text); return out();
      case 'act.sequence': this.record('sequence', { sequence: d.sequence }); a.sequence?.(d.sequence); return out();
      case 'act.checkpoint': this.record('checkpoint', { id: d.id }); a.checkpoint?.(d.id); return out();
      case 'act.enable': st.enabled[d.target] = d.enabled !== 'false'; this.record('enable', { target: d.target, enabled: st.enabled[d.target] }); a.enable?.(d.target, st.enabled[d.target]); return out();
      case 'act.teleport': this.record('teleport', { spawn: d.spawn }); a.teleport?.(d.spawn); return out();
      case 'act.script': this.record('script', { script: d.script }); a.script?.(d.script, ctx); return out();
      default: if (!n.type.startsWith('on.')) this._err(`Unknown node type “${n.type}” in graph “${g.name}”.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------- static analysis
/**
 * Inspect all graphs against the project. Returns issues [{severity, code, message, graph, node}] — shown as badges in the editor
 * and merged into the project validation.
 */
export function analyzeGraphs(project) {
  const issues = [];
  const graphs = project.data.events?.graphs || {};
  const scene = project.scene;
  const doors = new Set(scene.find((n) => n.type === 'door').flatMap((n) => [n.props.doorId, n.name].filter(Boolean)));
  const lightGroups = new Set(scene.find((n) => n.type === 'light').map((n) => n.props.powerGroup).filter(Boolean));
  const nodeRef = new Set(scene.all().flatMap((n) => [n.id, n.name]));
  const checkpoints = new Set(scene.find((n) => n.type === 'checkpoint').flatMap((n) => [n.props.checkpointId, n.name].filter(Boolean)));
  const sequences = new Set(Object.keys(project.data.sequences || {}).concat(Object.values(project.data.sequences || {}).map((s) => s.name)));
  const scripts = new Set(Object.keys(project.data.scripts || {}));
  const assets = project.data.assets || {};
  const emitted = new Map(), handled = new Map();
  const add = (severity, code, message, g, n) => issues.push({ severity, code, message, graph: g?.id, node: n?.id });
  for (const g of Object.values(graphs)) {
    const incoming = new Map(), outgoing = new Map();
    for (const e of g.edges) { (incoming.get(e.to.node) || incoming.set(e.to.node, []).get(e.to.node)).push(e); (outgoing.get(e.from.node) || outgoing.set(e.from.node, []).get(e.from.node)).push(e); }
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) if (!ids.has(e.from.node) || !ids.has(e.to.node)) add('error', 'edge-dangling', `Graph “${g.name}” has a connection to a node that no longer exists.`, g);
    for (const n of g.nodes) {
      const def = EVENT_NODE_TYPES[n.type];
      if (!def) { add('error', 'node-unknown', `Unknown node type “${n.type}” in “${g.name}”.`, g, n); continue; }
      const d = n.data || {};
      if (def.inputs.length && !(incoming.get(n.id) || []).length) add('warn', 'node-unreachable', `“${def.label}” in “${g.name}” has nothing connected into it, so it never runs.`, g, n);
      if (n.type === 'on.event') { if (!d.name) add('warn', 'node-empty', `An “On event” node in “${g.name}” has no event name.`, g, n); else (handled.get(d.name) || handled.set(d.name, []).get(d.name)).push(g); }
      if (n.type === 'act.emit') { if (!d.name) add('warn', 'node-empty', `An “Emit event” node in “${g.name}” has no event name.`, g, n); else (emitted.get(d.name) || emitted.set(d.name, []).get(d.name)).push({ g, n }); }
      if (n.type === 'act.door' && d.doorId && !doors.has(d.doorId)) add('warn', 'ref-door', `Door “${d.doorId}” (graph “${g.name}”) does not exist in the scene.`, g, n);
      if (n.type === 'act.light' && d.group && !lightGroups.has(d.group)) add('warn', 'ref-lightgroup', `Light group “${d.group}” (graph “${g.name}”) has no lights.`, g, n);
      if ((n.type === 'act.spawn' && d.spawnId && !nodeRef.has(d.spawnId)) || (n.type === 'act.enable' && d.target && !nodeRef.has(d.target)) || (n.type === 'act.teleport' && d.spawn && !nodeRef.has(d.spawn)) || (n.type === 'act.sound' && d.at && !nodeRef.has(d.at))) add('warn', 'ref-node', `An object referenced in “${g.name}” (${d.spawnId || d.target || d.spawn || d.at}) does not exist.`, g, n);
      if (n.type === 'act.sound' && d.asset && !d.asset.startsWith('builtin:') && !assets[d.asset]) add('warn', 'ref-asset', `Sound “${d.asset}” (graph “${g.name}”) is not in the project.`, g, n);
      if (n.type === 'act.sound' && !d.asset) add('warn', 'node-empty', `A “Play sound” node in “${g.name}” has no sound chosen.`, g, n);
      if (n.type === 'act.sequence' && d.sequence && !sequences.has(d.sequence)) add('warn', 'ref-sequence', `Sequence “${d.sequence}” (graph “${g.name}”) does not exist.`, g, n);
      if (n.type === 'act.checkpoint' && d.id && !checkpoints.has(d.id)) add('warn', 'ref-checkpoint', `Checkpoint “${d.id}” (graph “${g.name}”) has no checkpoint volume.`, g, n);
      if (n.type === 'act.script' && d.script && !scripts.has(d.script)) add('warn', 'ref-script', `Script “${d.script}” (graph “${g.name}”) does not exist.`, g, n);
      if (n.type === 'flow.branch' && !(outgoing.get(n.id) || []).length) add('info', 'branch-dead', `A branch in “${g.name}” has no outputs connected.`, g, n);
    }
  }
  // cycles through emit -> on.event with the same name
  for (const [name, list] of emitted) {
    for (const { g, n } of list) {
      // does this emit sit downstream of an on.event with the same name in the same graph?
      const start = g.nodes.filter((x) => x.type === 'on.event' && x.data.name === name);
      const seen = new Set();
      const dfs = (id) => { if (seen.has(id)) return false; seen.add(id); if (id === n.id) return true; return g.edges.filter((e) => e.from.node === id).some((e) => dfs(e.to.node)); };
      if (start.some((s) => dfs(s.id))) add('error', 'event-loop', `Event “${name}” re-emits itself in “${g.name}” — this loops forever.`, g, n);
    }
  }
  return { issues, emitted: [...emitted.keys()], handled: [...handled.keys()] };
}

/** Event names emitted by scene objects (volumes, spawns, pickups, interactions) — used by the editor to suggest names and find unhandled ones. */
export function sceneEventNames(project) {
  const out = new Map();
  const add = (name, where) => { if (name) { if (!out.has(name)) out.set(name, []); out.get(name).push(where); } };
  project.scene.walk((n) => {
    const p = n.props;
    if (n.type === 'trigger') { add(p.onEnter, `${n.name} (enter)`); add(p.onExit, `${n.name} (exit)`); }
    if (n.type === 'interaction') add(p.event, `${n.name} (use)`);
    if (n.type === 'itemSpawn') add(p.event, `${n.name} (pickup)`);
    if (n.type === 'audioSource') add(p.playOnEvent, `${n.name} (plays on)`);
    if (n.type === 'enemySpawn') add(p.spawnOn, `${n.name} (spawns on)`);
    if (n.type === 'model' && p.interaction?.enabled) add(p.interaction.event, `${n.name} (use)`);
  });
  return out;
}

/** Left-to-right layered layout for a graph (pure, returns new x/y per node id). Triggers/roots go in column 0. */
export function autoLayout(graph, { dx = 300, dy = 150, x0 = 40, y0 = 40 } = {}) {
  const incoming = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) incoming.get(e.to.node)?.push(e.from.node);
  const layer = new Map();
  const depthOf = (id, stack = new Set()) => {
    if (layer.has(id)) return layer.get(id);
    if (stack.has(id)) return 0;                           // cycle: break it
    stack.add(id);
    const ins = incoming.get(id) || [];
    const d = ins.length ? 1 + Math.max(...ins.map((i) => depthOf(i, stack))) : 0;
    stack.delete(id); layer.set(id, d); return d;
  };
  graph.nodes.forEach((n) => depthOf(n.id));
  const cols = new Map();
  for (const n of graph.nodes) { const l = layer.get(n.id); (cols.get(l) || cols.set(l, []).get(l)).push(n.id); }
  const out = {};
  for (const [l, ids] of cols) ids.forEach((id, i) => { out[id] = { x: x0 + l * dx, y: y0 + i * dy }; });
  return out;
}

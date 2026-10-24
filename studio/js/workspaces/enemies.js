// Enemy & boss editor: archetype properties, a state-machine graph (states + conditional transitions), boss phases, and a live
// 2D test arena that runs the real AI agent on THIS map's collision and navigation mesh.
import { h } from '../ui/dom.js';
import { GraphEditor } from '../ui/graph.js';
import { numberField, selectField, boolField, textField, button, section, vec3Field } from '../ui/fields.js';
import { confirmBox, promptBox } from '../ui/dialogs.js';
import { setData } from '../core/commands.js';
import { defaultArchetype, allArchetypes, REFERENCE_ARCHETYPES, BEHAVIORS, CONDITIONS, validateArchetype, EnemyAgent } from '../core/ai.js';
import { worldColliders, sceneBounds } from '../core/geometry.js';
import { CollisionWorld } from '../core/collision.js';
import { buildNavMesh } from '../core/navmesh.js';
import { uid } from '../core/util.js';
import * as THREE from '../../lib/three.module.js';

const REGISTRY = { types: { state: { cat: 'States', label: 'State', color: '#7a4ab5', inputs: ['in'], outputs: ['out'], fields: [
  { key: 'name', label: 'Name', type: 'string' }, { key: 'behavior', label: 'Behaviour', type: 'select', options: Object.keys(BEHAVIORS), default: 'idle' },
  { key: 'speed', label: 'Speed ×', type: 'number', default: 1 }, { key: 'onEnter', label: 'Event when entered', type: 'string' }] } }, categories: ['States'] };

class EnemiesWorkspace {
  constructor(app, el) {
    this.app = app; this.el = el; this.current = null;
    this.listEl = h('div', { class: 'panel-body', style: { flex: 1 } });
    this.graphBox = h('div', { style: { flex: 1, position: 'relative', minHeight: '180px' } });
    this.arenaBox = h('div', { style: { height: '300px', position: 'relative', borderTop: '1px solid var(--line)', background: '#12151a' } });
    this.props = h('div', { class: 'panel-body insp' });
    el.append(h('div', { class: 'split', style: { height: '100%' } },
      h('div', { class: 'pane', style: { width: '230px', display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: '1px solid var(--line)' } },
        h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Enemies & bosses')), this.listEl,
        h('div', { style: { padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: '1px solid var(--line)' } }, button('New', () => this.create(), { primary: true }), button('Duplicate', () => this.duplicate()), button('Delete', () => this.remove()))),
      h('div', { class: 'pane', style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('div', { class: 'graph-bar' }, h('b', { id: 'en-title', style: { marginRight: 'auto' } }, 'Behaviour'), button('Auto layout', () => this.layout()), button('Fit', () => this.editor?.fit()), h('span', { style: { color: 'var(--faint)', fontSize: '11px' } }, 'Right-click to add a state · drag a dot to a state to add a transition · click a connection to edit its condition')),
        this.graphBox, this.arenaBox),
      h('div', { class: 'pane', style: { width: '340px', background: 'var(--panel)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' } }, h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Properties')), this.props)));
    this.editor = new GraphEditor(app, this.graphBox, {
      registry: REGISTRY,
      getGraph: () => this.arch()?.graph || null,
      commit: (g, label, mergeKey) => this.update({ graph: g }, label, mergeKey),
      newNode: (type, x, y) => ({ id: 'st_' + uid('s').slice(-5), type: 'state', x, y, data: { name: 'New state', behavior: 'idle', speed: 1, onEnter: '' } }),
      defaultEdgeData: { cond: 'always', priority: 0 },
      edgeLabel: (e) => this.edgeLabel(e),
      edgeFields: (e) => this.edgeFields(e),
      decorate: (n) => (this.arch()?.start === n.id ? [{ severity: 'info', message: 'Start state' }] : []),
    });
    this.arena = null;
    app.on('history', () => { if (this.el.classList.contains('on')) this.refresh(); });
    app.on('project', () => { this.current = null; this.arena?.reset(); });
  }

  all() { return allArchetypes(this.app.project); }
  arch() { return this.current ? this.all()[this.current] || null : null; }
  readOnly() { return !!this.arch()?.readOnly; }
  show() {
    const all = this.all();
    if (!this.current || !all[this.current]) this.current = Object.keys(all).find((k) => !all[k].readOnly) || Object.keys(all)[0];
    if (!this.arena) this.arena = new Arena(this.app, this.arenaBox, this);
    this.refresh(); this.editor.fit(); this.arena.start();
  }
  hide() { this.arena?.stop(); }

  refresh() { this.renderList(); this.editor.render(); this.renderProps(); this.arena?.syncArchetype(); document.getElementById('en-title').textContent = this.arch() ? `${this.arch().name} — behaviour${this.readOnly() ? ' (read-only reference)' : ''}` : 'No enemy'; }

  renderList() {
    const all = this.all();
    this.listEl.replaceChildren(...Object.values(all).map((a) => h('div', { class: 'tree-row' + (a.id === this.current ? ' sel primary' : ''), style: { position: 'relative', height: '30px' }, 'data-enemy': a.id, onclick: () => { this.current = a.id; this.arena?.reset(); this.refresh(); this.editor.fit(); } },
      h('span', { class: 'tree-icon', style: { background: a.readOnly ? '#8a8f96' : '#a45cc4', marginLeft: '8px' } }, a.invulnerable ? 'B' : 'E'), h('span', { class: 'tree-name' }, a.name), h('span', { class: 'tree-tag' }, a.readOnly ? 'reference' : `${a.graph.nodes.length} states`))));
  }

  update(patch, label, mergeKey) {
    const a = this.arch();
    if (!a || a.readOnly) { this.app.toast('This is a read-only reference. Duplicate it to edit.', 'info'); this.refresh(); return; }
    const next = { ...JSON.parse(JSON.stringify(a)), ...patch };
    this.app.exec(setData(['enemies', a.id], next, { label: label || `Edit ${a.name}`, mergeKey: mergeKey || `en:${a.id}:${Object.keys(patch)}` }));
  }

  create(base = null) {
    const a = base || defaultArchetype('New enemy');
    this.app.exec(setData(['enemies', a.id], a, { label: 'Create enemy' }));
    this.current = a.id; this.refresh(); this.editor.fit();
  }
  duplicate() {
    const src = this.arch(); if (!src) return;
    const copy = JSON.parse(JSON.stringify(src)); copy.id = uid('enemy'); copy.name = src.name.replace(' (imported reference)', '') + ' copy'; delete copy.readOnly; delete copy.imported;
    const map = new Map(); copy.graph.nodes.forEach((n) => { const id = 'st_' + uid('s').slice(-5); map.set(n.id, id); n.id = id; });
    copy.graph.edges.forEach((e) => { e.id = uid('et'); e.from.node = map.get(e.from.node); e.to.node = map.get(e.to.node); });
    copy.start = map.get(copy.start) || copy.graph.nodes[0].id; copy.graph.id = uid('g');
    this.create(copy);
  }
  async remove() {
    const a = this.arch(); if (!a || a.readOnly) { this.app.toast('Reference enemies cannot be deleted.', 'info'); return; }
    const used = this.app.scene.find((n) => n.type === 'enemySpawn' && n.props.archetype === a.id);
    if (!(await confirmBox('Delete enemy', `Delete “${a.name}”?${used.length ? `\n\n${used.length} enemy spawn(s) in the map use it and will do nothing until you pick another.` : ''}`, { ok: 'Delete', danger: true }))) return;
    const next = { ...this.app.project.data.enemies }; delete next[a.id];
    this.app.exec(setData(['enemies'], next, { label: 'Delete enemy' })); this.current = null; this.show();
  }
  layout() {
    const a = this.arch(); if (!a || a.readOnly) return;
    const g = JSON.parse(JSON.stringify(a.graph)); const cols = Math.ceil(Math.sqrt(g.nodes.length));
    g.nodes.forEach((n, i) => { n.x = 40 + (i % cols) * 300; n.y = 40 + Math.floor(i / cols) * 190; });
    this.update({ graph: g }, 'Auto layout'); setTimeout(() => this.editor.fit(), 30);
  }

  edgeLabel(e) {
    const c = CONDITIONS[e.data?.cond]; if (!c) return '?';
    const d = e.data; const extra = c.fields.map((f) => d[f.key] ?? f.default).filter((v) => v !== undefined && v !== '').join(' ');
    return `${e.data.cond}${extra ? ' ' + extra : ''}`;
  }
  edgeFields(e) {
    const base = [{ key: 'cond', label: 'When', type: 'select', options: Object.keys(CONDITIONS), default: 'always' }];
    const c = CONDITIONS[e.data?.cond];
    return [...base, ...(c?.fields || []), { key: 'priority', label: 'Priority (higher first)', type: 'number', default: 0 }];
  }

  // ---------------------------------------------------------------- property panel
  renderProps() {
    const a = this.arch();
    if (!a) { this.props.replaceChildren(h('div', { class: 'empty' }, 'Create an enemy to start.')); return; }
    const ro = a.readOnly;
    const lock = (f) => { if (ro) f.el.querySelectorAll('input,select,textarea,button').forEach((i) => { i.disabled = true; }); return f.el; };
    const num = (label, path, o = {}) => { const get = () => path.reduce((x, k) => x?.[k], this.arch()); const f = numberField(label, { value: get() ?? 0, step: 0.05, ...o, onChange: (v) => this.setPath(path, v) }); return lock(f); };
    const blocks = [];
    if (ro) blocks.push(h('div', { class: 'note warn' }, a.notes || 'Read-only reference.'), h('div', { style: { padding: '0 10px 8px' } }, button('Duplicate to edit', () => this.duplicate(), { primary: true })));
    else if (a.notes) blocks.push(h('div', { class: 'note' }, a.notes));
    const probs = validateArchetype(a);
    if (probs.length) blocks.push(h('div', { class: 'sec' }, h('div', { class: 'sec-h', style: { cursor: 'default' } }, `Checks (${probs.length})`), h('div', { class: 'sec-b' }, probs.map((p) => h('div', { class: 'note ' + (p.severity === 'error' ? 'err' : p.severity === 'warn' ? 'warn' : ''), style: { margin: '0 0 6px' } }, p.message)))));
    const models = ['', ...this.app.assets.allMeta('model').map((m) => m.id)];
    blocks.push(section('Identity', [lock(textField('Name', { value: a.name, onChange: (v) => this.setPath(['name'], v) })), lock(selectField('Model', { value: a.model || '', options: models, optionLabel: (id) => (id ? this.app.assets.meta(id)?.name || id : '(placeholder capsule)'), hint: 'Shown in the playtest. Without one a plain capsule marks the enemy.', onChange: (v) => this.setPath(['model'], v) })), lock(selectField('Start state', { value: a.start, options: a.graph.nodes.map((n) => n.id), optionLabel: (id) => a.graph.nodes.find((n) => n.id === id)?.data.name || id, onChange: (v) => this.setPath(['start'], v) }))], { key: 'en.id', prefs: this.app }));
    blocks.push(section('Body', [num('Health', ['health'], { min: 1, step: 5 }), lock(boolField('Invulnerable (stagger only)', { value: !!a.invulnerable, onChange: (v) => this.setPath(['invulnerable'], v) })), num('Walk speed', ['walkSpeed'], { min: 0, unit: 'm/s' }), num('Run speed', ['runSpeed'], { min: 0, unit: 'm/s' }), num('Radius', ['radius'], { min: 0.1, unit: 'm' }), num('Height', ['height'], { min: 0.5, unit: 'm' }), num('Stagger time', ['staggerSeconds'], { min: 0, unit: 's' })], { key: 'en.body', prefs: this.app }));
    blocks.push(section('Senses', [num('Sight range', ['vision', 'range'], { min: 0, unit: 'm' }), num('Sight half-angle', ['vision', 'halfAngleDeg'], { min: 1, max: 180, unit: '°', step: 1 }), num('Half-angle while chasing', ['vision', 'chaseHalfAngleDeg'], { min: 1, max: 180, unit: '°', step: 1 }), num('Always sees within', ['vision', 'closeAlwaysSeen'], { min: 0, unit: 'm' }), num('Hearing multiplier', ['hearing', 'scale'], { min: 0 }), num('Wake radius (dormant)', ['wakeRadius'], { min: 0, unit: 'm' })], { key: 'en.senses', prefs: this.app }));
    blocks.push(section('Melee attack', ['range', 'hitReach', 'damage', 'windup', 'duration', 'cooldown'].map((k) => num({ range: 'Start range', hitReach: 'Hit reach', damage: 'Damage', windup: 'Windup', duration: 'Duration', cooldown: 'Cooldown' }[k], ['attack', k], { min: 0, unit: ['damage'].includes(k) ? '' : k.includes('range') || k === 'hitReach' ? 'm' : 's' })), { key: 'en.atk', prefs: this.app }));
    // weak spots
    const spots = a.weakSpots || [];
    const spotRows = spots.map((s, i) => h('div', { style: { display: 'flex', gap: '6px', marginBottom: '4px' } }, h('input', { type: 'text', value: s.part, disabled: ro, 'aria-label': 'Body part', style: { flex: 1, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '4px', padding: '2px 6px' }, onchange: (e) => this.setPath(['weakSpots', i, 'part'], e.target.value) }), h('input', { type: 'number', step: 0.05, value: s.multiplier, disabled: ro, 'aria-label': 'Damage multiplier', style: { width: '70px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '4px', padding: '2px 6px' }, onchange: (e) => this.setPath(['weakSpots', i, 'multiplier'], parseFloat(e.target.value)) }), h('button', { class: 'tree-btn', disabled: ro, 'aria-label': 'Remove', onclick: () => this.update({ weakSpots: spots.filter((_, k) => k !== i) }) }, '×')));
    blocks.push(section('Weak spots (damage multipliers)', [...spotRows, (() => { const b = button('+ Add', () => this.update({ weakSpots: [...spots, { part: 'part', multiplier: 1 }] })); b.disabled = ro; return b; })()], { key: 'en.spots', prefs: this.app, open: false }));
    // phases
    const phases = a.phases || [];
    const phaseBlocks = phases.map((p, i) => h('div', { style: { borderBottom: '1px solid var(--line)', paddingBottom: '6px', marginBottom: '6px' } },
      lock(textField('Name', { value: p.name, onChange: (v) => this.setPath(['phases', i, 'name'], v) })), lock(numberField('Starts below', { value: p.hpBelow, step: 5, min: 1, max: 99, unit: '% HP', onChange: (v) => this.setPath(['phases', i, 'hpBelow'], v) })),
      lock(textField('Event', { value: p.event || '', placeholder: 'fired when the phase begins', onChange: (v) => this.setPath(['phases', i, 'event'], v) })),
      lock(numberField('Run speed', { value: p.overrides?.runSpeed ?? a.runSpeed, step: 0.1, min: 0, onChange: (v) => this.setPath(['phases', i, 'overrides', 'runSpeed'], v) })), lock(numberField('Attack damage', { value: p.overrides?.attack?.damage ?? a.attack.damage, step: 1, min: 0, onChange: (v) => this.setPath(['phases', i, 'overrides', 'attack', 'damage'], v) })),
      lock(selectField('Switch to state', { value: p.state || '', options: ['', ...a.graph.nodes.map((n) => n.id)], optionLabel: (id) => (id ? a.graph.nodes.find((n) => n.id === id)?.data.name || id : '(stay)'), onChange: (v) => this.setPath(['phases', i, 'state'], v) })),
      (() => { const b = button('Remove phase', () => this.update({ phases: phases.filter((_, k) => k !== i) })); b.disabled = ro; return b; })()));
    blocks.push(section('Boss phases', [...phaseBlocks, (() => { const b = button('+ Add phase', () => this.update({ phases: [...phases, { id: uid('ph'), name: `Phase ${phases.length + 1}`, hpBelow: 50, event: '', overrides: {} }] })); b.disabled = ro; return b; })(), h('div', { class: 'hint', style: { color: 'var(--faint)', fontSize: '11px', marginTop: '4px' } }, 'A phase begins once, when health falls below its threshold: it applies its overrides, fires its event and can switch state.')], { key: 'en.phases', prefs: this.app, open: phases.length > 0 }));
    this.props.replaceChildren(...blocks);
  }
  setPath(path, value) {
    const a = this.arch(); if (!a || a.readOnly) return;
    const next = JSON.parse(JSON.stringify(a)); let o = next;
    for (let i = 0; i < path.length - 1; i++) { if (o[path[i]] === undefined || o[path[i]] === null) o[path[i]] = typeof path[i + 1] === 'number' ? [] : {}; o = o[path[i]]; }
    o[path.at(-1)] = value;
    this.app.exec(setData(['enemies', a.id], next, { label: `Edit ${path.join('.')}`, mergeKey: `en:${a.id}:${path.join('.')}` }));
  }
}

// ---------------------------------------------------------------------------------------------- test arena
class Arena {
  constructor(app, box, ws) {
    this.app = app; this.ws = ws;
    this.canvas = h('canvas', { style: { width: '100%', height: '100%', display: 'block', cursor: 'crosshair' } });
    this.bar = h('div', { class: 'graph-bar', style: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 2, background: '#12151acc', flexWrap: 'wrap' } });
    this.info = h('div', { style: { position: 'absolute', right: '8px', bottom: '8px', font: 'var(--mono)', background: '#000a', padding: '6px 8px', borderRadius: '6px', maxWidth: '45%', pointerEvents: 'none', whiteSpace: 'pre' } });
    box.append(this.canvas, this.bar, this.info);
    this.view = { x: 0, z: 0, k: 8 };
    this.sim = null; this.playing = true; this.speed = 1;
    this.showNav = false; this.noiseR = 8;
    this.player = { pos: new THREE.Vector3(0, 0, 0), radius: 0.3, hp: 100 };
    this.noises = []; this.rings = []; this.hits = 0;
    this.buildBar();
    this.bind();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(box);
  }

  buildBar() {
    const mkb = (label, fn, title) => h('button', { class: 'btn small', title, onclick: fn }, label);
    this.playBtn = mkb('⏸ Pause', () => { this.playing = !this.playing; this.playBtn.textContent = this.playing ? '⏸ Pause' : '▶ Play'; });
    const spd = h('select', { class: 'tb-select', 'aria-label': 'Speed', onchange: (e) => { this.speed = +e.target.value; } }, [0.25, 0.5, 1, 2].map((v) => h('option', { value: v, selected: v === 1 }, v + '×')));
    const nav = h('label', { style: { display: 'flex', gap: '4px', color: 'var(--dim)' } }, h('input', { type: 'checkbox', onchange: (e) => { this.showNav = e.target.checked; if (this.showNav) this.ensureNav(); } }), 'Nav mesh');
    const start = h('select', { class: 'tb-select', 'aria-label': 'Start state', onchange: (e) => this.reset(e.target.value) });
    this.startSel = start;
    this.bar.replaceChildren(h('b', {}, 'Test arena'), this.playBtn, mkb('↺ Reset', () => this.reset()), spd, mkb('Hit 20', () => this.hit(20, 'body')), mkb('Head 20', () => this.hit(20, 'head')), mkb('Heavy hit', () => this.hit(60, 'body', true)), mkb('Noise here', () => this.noise(this.player.pos, this.noiseR), 'Makes a noise at the player'), h('span', { style: { color: 'var(--faint)' } }, 'Start in'), start, nav,
      h('span', { style: { color: 'var(--faint)', fontSize: '11px' } }, 'drag blue = player · click = place enemy · Shift+click = noise'));
  }

  syncArchetype() {
    const a = this.ws.arch(); if (!a || !this.startSel) return;
    this.startSel.replaceChildren(...a.graph.nodes.map((n) => h('option', { value: n.id, selected: n.id === (this.startState || a.start) }, n.data.name)));
    if (this.sim && this.sim.archId === a.id && JSON.stringify(this.sim.def) !== JSON.stringify(a)) this.reset(this.startState);
  }

  ensureWorld() {
    const p = this.app.project, v = p.scene.version;
    if (this.world && this.worldVersion === v) return;
    this.worldVersion = v;
    const cols = worldColliders(p.scene, p.geoCtx);
    this.cols = cols;
    this.world = new CollisionWorld(cols);
    this.bounds = sceneBounds(p.scene, p.geoCtx);
    this.nav = null;
    const c = this.bounds.getCenter(new THREE.Vector3()), s = this.bounds.getSize(new THREE.Vector3());
    if (!this.fitted) { this.view = { x: c.x, z: c.z, k: Math.max(2, Math.min(40, Math.min(this.canvas.clientWidth / (s.x + 4 || 20), (this.canvas.clientHeight - 40) / (s.z + 4 || 20)))) }; this.fitted = true; }
  }
  ensureNav() {
    this.ensureWorld();
    if (this.nav) return this.nav;
    const p = this.app.project;
    const seeds = p.scene.find((n) => n.type === 'playerSpawn').map((n) => p.scene.worldPosition(n.id));
    this.nav = buildNavMesh(this.world, this.bounds, { cell: 0.25, seeds });
    return this.nav;
  }

  reset(startState) {
    const a = this.ws.arch(); if (!a) return;
    this.startState = startState && a.graph.nodes.some((n) => n.id === startState) ? startState : a.start;
    this.ensureWorld();
    const p = this.app.project;
    const spawn = p.scene.find((n) => n.type === 'enemySpawn' && (n.props.archetype === a.id))[0] || p.scene.find((n) => n.type === 'enemySpawn')[0];
    const ps = p.scene.find((n) => n.type === 'playerSpawn')[0];
    const pos = this.startPos || (spawn ? p.scene.worldPosition(spawn.id) : this.bounds.getCenter(new THREE.Vector3()).setY(this.bounds.min.y));
    if (!this.playerMoved) this.player.pos.copy(ps ? p.scene.worldPosition(ps.id) : pos.clone().add(new THREE.Vector3(0, 0, 8)));
    this.player.hp = 100; this.hits = 0; this.noises = []; this.rings = [];
    this.events = [];
    this.sim = { archId: a.id, def: JSON.parse(JSON.stringify(a)), time: 0, agent: new EnemyAgent(a, { pos: pos.toArray(), yaw: 0, collision: this.world, nav: this.nav || (this.ensureNav()), name: a.name, startState: this.startState, emit: (n) => this.events.push({ t: this.sim?.time || 0, n }) }) };
  }

  hit(amount, part, heavy) { this.sim?.agent.takeDamage(amount, part, { heavy }); }
  noise(pos, radius) { this.noises.push({ pos: pos.clone(), radius, t: this.sim?.agent.time ?? 0 }); this.rings.push({ pos: pos.clone(), r: 0, max: radius }); }

  start() { if (!this.sim) this.reset(); this.stop(); this.resize(); this._last = performance.now(); const loop = (now) => { this._raf = requestAnimationFrame(loop); this.frame(Math.min(0.1, (now - this._last) / 1000)); this._last = now; }; this._raf = requestAnimationFrame(loop); }
  stop() { cancelAnimationFrame(this._raf); }
  resize() { const r = this.canvas.getBoundingClientRect(); const d = window.devicePixelRatio || 1; this.canvas.width = Math.max(10, r.width * d); this.canvas.height = Math.max(10, r.height * d); this.d = d; }

  frame(dt) {
    if (!this.sim || !this.canvas.isConnected || !this.canvas.offsetParent) return;
    if (this.playing) {
      const step = 1 / 30; this.acc = (this.acc || 0) + dt * this.speed;
      while (this.acc >= step) {
        this.acc -= step; this.sim.time += step;
        this.sim.agent.update(step, { player: this.player, noises: this.noises, damagePlayer: (d) => { this.player.hp -= d.amount; this.hits++; this.hitFlash = 0.3; this.events.push({ t: this.sim.time, n: `player hit for ${d.amount}` }); } });
        this.noises = this.noises.filter((n) => this.sim.agent.time - n.t < 0.2);
      }
    }
    for (const r of this.rings) r.r += dt * 14; this.rings = this.rings.filter((r) => r.r < r.max);
    this.hitFlash = Math.max(0, (this.hitFlash || 0) - dt);
    this.draw();
  }

  toScreen(x, z) { const r = this.canvas; return [(x - this.view.x) * this.view.k * this.d + r.width / 2, (z - this.view.z) * this.view.k * this.d + r.height / 2]; }
  toWorld(px, py) { const r = this.canvas.getBoundingClientRect(); return [(px - r.left - r.width / 2) / this.view.k + this.view.x, (py - r.top - r.height / 2) / this.view.k + this.view.z]; }

  draw() {
    this.ensureWorld();
    const c = this.canvas, g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#12151a'; g.fillRect(0, 0, c.width, c.height);
    const k = this.view.k * this.d;
    // floors / walls
    for (const col of this.cols) {
      if (col.kind !== 'solid' && col.kind !== 'door') continue;
      const pts = [[col.min[0], col.min[2]], [col.max[0], col.min[2]], [col.max[0], col.max[2]], [col.min[0], col.max[2]]].map(([x, z]) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(col.rt); return this.toScreen(v.x, v.z); });
      const floor = col.walk && col.max[1] - col.min[1] < 0.5;
      g.fillStyle = col.kind === 'door' ? '#8a6a4a' : floor ? '#1d232c' : '#5b6574';
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
    }
    if (this.showNav && this.nav) { g.fillStyle = '#4aa3ff22'; for (const n of this.nav.nodes) { const [x, y] = this.toScreen(n.x, n.z); g.fillRect(x - this.nav.cell * k / 2, y - this.nav.cell * k / 2, this.nav.cell * k, this.nav.cell * k); } }
    const a = this.sim?.agent;
    if (a) {
      const [ex, ez] = this.toScreen(a.pos.x, a.pos.z);
      // vision cone
      const v = a.params.vision, chasing = a.behavior === 'chase' || a.behavior === 'attack', half = (chasing ? v.chaseHalfAngleDeg : v.halfAngleDeg) * Math.PI / 180;
      const yaw = Math.atan2(-Math.cos(a.yaw * Math.PI / 180), -Math.sin(a.yaw * Math.PI / 180));   // canvas angle of the facing direction (x right, z down)
      g.fillStyle = a.seesPlayer ? '#ff505033' : '#ffd84a22'; g.strokeStyle = a.seesPlayer ? '#ff5050' : '#ffd84a66';
      g.beginPath(); g.moveTo(ex, ez); if (half >= Math.PI) g.arc(ex, ez, v.range * k, 0, Math.PI * 2); else g.arc(ex, ez, v.range * k, yaw - half, yaw + half); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = '#ffffff22'; g.beginPath(); g.arc(ex, ez, (v.closeAlwaysSeen || 0) * k, 0, Math.PI * 2); g.stroke();
      // path
      if (a.path?.length) { g.strokeStyle = '#5bd18b'; g.lineWidth = 2 * this.d; g.beginPath(); g.moveTo(ex, ez); for (let i = a.pathIndex; i < a.path.length; i++) { const [x, y] = this.toScreen(a.path[i].x, a.path[i].z); g.lineTo(x, y); } g.stroke(); g.lineWidth = 1; }
      // body
      g.fillStyle = a.alive ? '#e0443e' : '#555'; g.beginPath(); g.arc(ex, ez, Math.max(4, a.def.radius * k), 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(ex, ez); g.lineTo(ex + Math.cos(yaw) * a.def.radius * k * 1.6, ez + Math.sin(yaw) * a.def.radius * k * 1.6); g.stroke();
      g.fillStyle = '#fff'; g.font = `${11 * this.d}px system-ui`; g.textAlign = 'center'; g.fillText(`${a.states.get(a.state)?.data.name}  ${Math.round(a.hp)}/${a.maxHp}`, ex, ez - a.def.radius * k - 6 * this.d);
    }
    // noise rings
    g.strokeStyle = '#ff9a2a'; for (const r of this.rings) { const [x, y] = this.toScreen(r.pos.x, r.pos.z); g.globalAlpha = 1 - r.r / r.max; g.beginPath(); g.arc(x, y, r.r * k, 0, Math.PI * 2); g.stroke(); } g.globalAlpha = 1;
    // player
    const [px, pz] = this.toScreen(this.player.pos.x, this.player.pos.z);
    g.fillStyle = this.hitFlash > 0 ? '#fff' : '#4aa3ff'; g.beginPath(); g.arc(px, pz, Math.max(5, 0.3 * k), 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4aa3ff'; g.textAlign = 'center'; g.fillText(`player ${Math.max(0, Math.round(this.player.hp))} hp`, px, pz - 0.3 * k - 6 * this.d);
    // info
    if (a) { const d = a.debug(); this.info.textContent = `state ${d.state} (${d.behavior}) ${d.stateTime}s\nsees ${d.sees ? 'YES' : 'no'}   hears ${d.heard ? 'YES' : 'no'}\nhp ${d.hp}/${a.maxHp}   phase ${d.phase < 0 ? '–' : d.phase + 1}\nplayer hits taken ${this.hits}\n` + d.history.slice(-5).map((x) => x.phase ? `t${x.t} phase ${x.phase}` : `t${x.t} ${a.states.get(x.from)?.data.name || '·'} → ${a.states.get(x.to)?.data.name} (${x.why})`).join('\n'); }
  }

  bind() {
    const c = this.canvas; let drag = null;
    c.addEventListener('pointerdown', (e) => {
      const [wx, wz] = this.toWorld(e.clientX, e.clientY);
      if (e.shiftKey) { this.noise(new THREE.Vector3(wx, 0, wz), this.noiseR); return; }
      if (Math.hypot(wx - this.player.pos.x, wz - this.player.pos.z) < Math.max(0.5, 12 / this.view.k)) { drag = { kind: 'player' }; c.setPointerCapture(e.pointerId); return; }
      if (e.button === 1 || e.button === 2 || e.altKey) { drag = { kind: 'pan', x: e.clientX, y: e.clientY, vx: this.view.x, vz: this.view.z }; c.setPointerCapture(e.pointerId); return; }
      // click: place the enemy here
      this.startPos = new THREE.Vector3(wx, this.bounds.min.y + 0, wz); const g = this.world.groundAt(wx, wz, this.bounds.max.y + 2, -5); if (g !== null) this.startPos.y = g;
      this.reset(this.startState);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.kind === 'player') { const [wx, wz] = this.toWorld(e.clientX, e.clientY); this.player.pos.set(wx, this.world.groundAt(wx, wz, this.bounds.max.y + 2, -5) ?? this.player.pos.y, wz); this.playerMoved = true; }
      else { this.view.x = drag.vx - (e.clientX - drag.x) / this.view.k; this.view.z = drag.vz - (e.clientY - drag.y) / this.view.k; }
    });
    c.addEventListener('pointerup', () => { drag = null; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.view.k = Math.max(1.5, Math.min(80, this.view.k * Math.exp(-e.deltaY * 0.0012))); }, { passive: false });
  }
}

export default {
  id: 'enemies', label: 'Enemies', fill: true,
  create(app, el) { const w = new EnemiesWorkspace(app, el); app.enemiesWs = w; return w; },
};

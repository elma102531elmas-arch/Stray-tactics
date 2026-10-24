// Diagnostics: triaged validator issues (with evidence), an issue tracker stored in the project, hit-box tools and performance.
// Rules and classifications live in core/diagnostics.js, core/perf.js and core/aisystem.js; this file is the view.
import { h, download } from '../ui/dom.js';
import { numberField, selectField, textField, boolField, button } from '../ui/fields.js';
import { promptBox, confirmBox } from '../ui/dialogs.js';
import { setData } from '../core/commands.js';
import * as D from '../core/diagnostics.js';
import { measureCore } from '../core/perf.js';
import { perfSnapshot } from '../ui/perf.js';
import { allArchetypes } from '../core/ai.js';
import { allWeapons } from '../core/weapons.js';
import { HIT_ZONES, hitRadius, hitPart } from '../core/aisystem.js';

const SEV = ['error', 'warn', 'info'];
const badge = (cls) => h('span', { class: 'badge-st', 'data-cls': cls, style: { background: D.CLASSES[cls].color + '33', color: D.CLASSES[cls].color }, title: D.CLASSES[cls].blurb }, D.CLASSES[cls].label);
const COST = { ok: ['OK', 'ok'], warn: ['High', 'warn'], bad: ['Too high', 'err'] };

class DiagnosticsWorkspace {
  constructor(app, el) {
    this.app = app; this.el = el; this.tab = 'issues';
    this.clsOn = new Set(Object.keys(D.CLASSES)); this.sevOn = new Set(SEV); this.q = ''; this.open = new Set(); this.statusFilter = 'all';
    this.body = h('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } });
    this.tabs = h('div', { class: 'toolbar', style: { height: 'auto', padding: '4px 10px', gap: '6px' } }, [['issues', 'Issues'], ['tracker', 'Tracker'], ['hitboxes', 'Hit boxes'], ['perf', 'Performance']].map(([k, l]) => h('button', { class: 'btn small', 'data-tab': k, onclick: () => { this.tab = k; this.render(); } }, l)));
    el.append(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, this.tabs, this.body));
    app.on('issues', () => { if (this.live) this.render(); });
    app.on('history', () => { if (this.live && this.tab !== 'perf') this.render(); });
    app.on('project', () => { this.open.clear(); if (this.live) this.render(); });
    app.viewport?.on('stats', () => { if (this.live && this.tab === 'perf' && !this.measuring) this.renderPerf(); });
  }

  get live() { return this.el.classList.contains('on'); }
  show() { if (!this.app.validatedOnce) this.app.run('project.validate'); this.render(); }
  enriched() { return D.enrichIssues(this.app.project, this.app.issues || []); }
  tracked() { return this.app.project.data.issues || []; }

  render() {
    this.tabs.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('primary', b.dataset.tab === this.tab));
    ({ issues: () => this.renderIssues(), tracker: () => this.renderTracker(), hitboxes: () => this.renderHitboxes(), perf: () => this.renderPerf() })[this.tab]();
  }

  // ---------------------------------------------------------------- issues
  renderIssues() {
    const all = this.enriched(), sum = D.summarize(all);
    const shown = all.filter((i) => this.clsOn.has(i.triage.cls) && this.sevOn.has(i.severity) && (!this.q || (i.message + i.code + i.names.join(' ')).toLowerCase().includes(this.q.toLowerCase())));
    const chip = (k) => h('button', { class: 'btn small', 'data-cls': k, 'aria-pressed': String(this.clsOn.has(k)), style: { opacity: this.clsOn.has(k) ? 1 : 0.45, borderColor: D.CLASSES[k].color }, title: D.CLASSES[k].blurb, onclick: () => { if (this.clsOn.has(k)) this.clsOn.delete(k); else this.clsOn.add(k); this.render(); } }, `${D.CLASSES[k].label} ${sum[k]}`);
    const sevChip = (s) => h('button', { class: 'btn small', 'data-sev': s, 'aria-pressed': String(this.sevOn.has(s)), style: { opacity: this.sevOn.has(s) ? 1 : 0.45 }, onclick: () => { if (this.sevOn.has(s)) this.sevOn.delete(s); else this.sevOn.add(s); this.render(); } }, s);
    const search = h('input', { type: 'text', value: this.q, placeholder: 'Search issues…', 'aria-label': 'Search issues', style: { width: '180px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '4px', padding: '3px 8px' }, oninput: (e) => { this.q = e.target.value; clearTimeout(this._qt); this._qt = setTimeout(() => this.renderIssues(), 200); } });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    const rows = shown.slice(0, 400).map((i) => this.issueRow(i));
    this.body.replaceChildren(
      h('div', { class: 'toolbar', style: { height: 'auto', padding: '6px 10px', gap: '6px', flexWrap: 'wrap' } }, button('Validate now', () => this.app.run('project.validate'), { primary: true }), ...Object.keys(D.CLASSES).map(chip), h('span', { style: { width: '10px' } }), ...SEV.map(sevChip), search, h('span', { style: { flex: 1 } }),
        button('Track unresolved', () => this.trackMany(all.filter((i) => ['bug', 'unverified', 'limit'].includes(i.triage.cls)))), button('Export report (.md)', () => download(`${this.app.project.meta.name.replace(/[^\w.-]+/g, '_')}-diagnostics.md`, D.reportMarkdown(this.app.project, all), 'text/markdown'))),
      h('div', { id: 'dg-summary', style: { padding: '2px 12px 6px', color: 'var(--dim)', fontSize: '12px' } }, all.length ? `${all.length} issue${all.length === 1 ? '' : 's'}: ${Object.entries(sum).filter(([, c]) => c).map(([k, c]) => `${c} ${D.CLASSES[k].label.toLowerCase()}`).join(' · ')}. Imported objects are checked against what the original game really does — expand a row to see the evidence.` : this.app.validatedOnce ? 'No problems found.' : 'Press “Validate now”.'),
      ...rows, shown.length > 400 ? h('div', { class: 'empty' }, `…and ${shown.length - 400} more. Narrow the filters.`) : null);
  }
  issueRow(i) {
    const t = i.triage, key = i.key, open = this.open.has(key), tracked = this.tracked().some((x) => x.key === key);
    return h('div', { class: 'issue dg-issue', 'data-code': i.code, 'data-cls': t.cls, 'data-key': key, style: { flexWrap: 'wrap' } },
      h('span', { class: 'sev ' + i.severity }), h('div', { style: { flex: 1, minWidth: '240px' } }, h('div', {}, i.message), i.names.length ? h('div', { style: { color: 'var(--faint)', fontSize: '11px', marginTop: '2px' } }, i.names.slice(0, 4).join(', '), i.names.length > 4 ? ` +${i.names.length - 4}` : '') : null), badge(t.cls),
      h('button', { class: 'btn small', 'aria-expanded': String(open), onclick: () => { if (open) this.open.delete(key); else this.open.add(key); this.renderIssues(); } }, open ? 'Hide' : 'Why?'),
      i.nodes.length ? h('button', { class: 'btn small', title: 'Select it and look at it in the Scene tab', onclick: () => this.goto(i) }, 'Show') : null,
      i.fix ? h('button', { class: 'btn small', onclick: () => this.app.run('project.fixIssue', i) }, 'Fix') : null,
      tracked ? h('span', { class: 'chip' }, 'tracked') : h('button', { class: 'btn small', onclick: () => this.trackMany([i]) }, 'Track'),
      open ? h('div', { class: 'dg-why', style: { flexBasis: '100%', margin: '6px 0 2px 18px', padding: '8px 10px', background: '#0003', borderRadius: '6px', fontSize: '12px' } },
        h('div', { style: { fontWeight: 600, marginBottom: '3px' } }, t.title), h('div', { style: { marginBottom: '6px' } }, t.explanation),
        ...(t.evidence.length ? [h('div', { style: { color: 'var(--faint)' } }, 'Evidence:'), ...t.evidence.map((e) => h('div', { style: { fontFamily: 'var(--mono, monospace)', fontSize: '11px', color: 'var(--dim)', padding: '1px 0 1px 10px' } }, '• ' + e))] : [h('div', { style: { color: 'var(--faint)' } }, 'No further evidence recorded.')])) : null);
  }
  goto(i) { const ids = i.nodes.filter((id) => this.app.scene.has(id)); if (!ids.length) return; this.app.select(ids); this.app.emit('goto', { workspace: 'scene' }); setTimeout(() => this.app.viewport?.frameSelection(), 60); }
  trackMany(list) {
    const have = new Set(this.tracked().map((t) => t.key)), fresh = list.filter((i) => !have.has(i.key));
    if (!fresh.length) { this.app.toast('Nothing new to track.', 'info'); return; }
    this.app.exec(setData(['issues'], [...this.tracked(), ...fresh.map((i) => D.newTracked(i))], { label: `Track ${fresh.length} issue${fresh.length === 1 ? '' : 's'}` }));
    this.app.toast(`Tracking ${fresh.length} issue${fresh.length === 1 ? '' : 's'} (Tracker tab).`, 'ok');
  }

  // ---------------------------------------------------------------- tracker
  renderTracker() {
    const items = D.trackedState(this.tracked(), this.enriched()), upd = (id, patch, label) => this.app.exec(setData(['issues'], this.tracked().map((t) => (t.id === id ? { ...t, ...patch, updated: new Date().toISOString() } : t)), { label, mergeKey: `trk:${id}:${Object.keys(patch)}` }));
    const filter = selectField('Show', { value: this.statusFilter, options: ['all', ...D.STATUSES], optionLabel: (s) => (s === 'all' ? 'All statuses' : D.STATUS_LABEL[s]), onChange: (v) => { this.statusFilter = v; this.renderTracker(); } });
    const shown = items.filter((t) => this.statusFilter === 'all' || t.status === this.statusFilter);
    this.body.replaceChildren(
      h('div', { class: 'toolbar', style: { height: 'auto', padding: '6px 10px', gap: '8px' } }, button('+ Add issue', () => this.addManual(), { primary: true }), button('Re-check', () => this.app.run('project.validate')), h('div', { style: { width: '240px' } }, filter.el), h('span', { style: { color: 'var(--dim)', fontSize: '12px' } }, `${items.length} tracked · ${items.filter((t) => t.status === 'open' || t.status === 'investigating').length} open`)),
      ...(shown.length ? shown.map((t) => h('div', { class: 'insp', 'data-tracked': t.id, 'data-status': t.status, style: { margin: '6px 10px', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: '6px', background: 'var(--panel)' } },
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, h('b', { style: { flex: 1, minWidth: '200px' } }, t.title), badge(t.cls || 'bug'),
          t.code ? (t.reproduces ? h('span', { class: 'chip', 'data-repro': 'yes' }, 'still reproduces') : h('span', { class: 'chip warn', 'data-repro': 'no', title: 'The validator no longer reports it' }, 'no longer reproduces')) : h('span', { class: 'chip' }, 'manual'),
          button('Delete', async () => { if (await confirmBox('Delete tracked issue', `Delete “${t.title}”?`, { ok: 'Delete', danger: true })) this.app.exec(setData(['issues'], this.tracked().filter((x) => x.id !== t.id), { label: 'Delete tracked issue' })); })),
        t.message ? h('div', { style: { color: 'var(--dim)', fontSize: '12px', margin: '3px 0' } }, t.message) : null,
        selectField('Status', { value: t.status, options: D.STATUSES, optionLabel: (s) => D.STATUS_LABEL[s], onChange: (v) => upd(t.id, { status: v }, 'Issue status') }).el,
        t.code && !t.reproduces && !['fixed', 'wontfix'].includes(t.status) ? h('div', { class: 'note', style: { margin: '4px 0' } }, 'This no longer shows up in validation. ', button('Mark fixed', () => upd(t.id, { status: 'fixed' }, 'Issue fixed'))) : null,
        textField('Notes', { value: t.notes || '', multiline: true, placeholder: 'What you found, what you tried…', onChange: (v) => upd(t.id, { notes: v }, 'Issue notes') }).el,
        (t.evidence || []).length ? h('details', {}, h('summary', { style: { cursor: 'pointer', color: 'var(--dim)' } }, `Evidence (${t.evidence.length})`), ...t.evidence.map((e) => h('div', { style: { fontFamily: 'var(--mono, monospace)', fontSize: '11px', color: 'var(--dim)', padding: '1px 0 1px 10px' } }, '• ' + e))) : null))
        : [h('div', { class: 'empty' }, items.length ? 'No tracked issues with that status.' : 'Nothing tracked yet. Use “Track” on an issue, or add your own.')]));
  }
  async addManual() {
    const title = await promptBox('New issue', 'Title'); if (!title?.trim()) return;
    const now = new Date().toISOString();
    this.app.exec(setData(['issues'], [...this.tracked(), { id: 'iss_' + Math.random().toString(36).slice(2, 8), key: 'manual:' + now, code: '', title: title.trim(), message: '', cls: 'bug', quirk: null, severity: 'warn', status: 'open', notes: '', evidence: [], nodeNames: [], created: now, updated: now }], { label: 'Add issue' }));
  }

  // ---------------------------------------------------------------- hit boxes
  renderHitboxes() {
    const app = this.app, ov = app.viewport?.overlays, archs = Object.values(allArchetypes(app.project)), weapons = Object.values(allWeapons(app.project)).filter((w) => w.kind === 'gun' || w.kind === 'melee');
    this.hb = this.hb || { arch: archs[0]?.id, weapon: 'ref_pistol', aim: 0.9, dist: 8 };
    const hb = this.hb, a = archs.find((x) => x.id === hb.arch) || archs[0], w = weapons.find((x) => x.id === hb.weapon) || weapons[0];
    const height = a?.height || 1.8, rel = Math.min(1, Math.max(0, hb.aim / height)), part = hitPart(rel), spot = (a?.weakSpots || []).find((s) => s.part === part), mult = spot ? spot.multiplier : 1;
    const dmg = w ? w.damage * (w.pellets || 1) * mult : 0, stk = a?.invulnerable || !(dmg > 0) ? Infinity : Math.ceil(a.health / dmg);
    const spreadR = w?.kind === 'gun' ? Math.tan((w.spreadDeg * Math.PI) / 180) * hb.dist : 0, spreadAds = w?.kind === 'gun' ? Math.tan((w.adsSpreadDeg * Math.PI) / 180) * hb.dist : 0;
    const rows = ['leg', 'body', 'head'].map((p) => { const sp = (a?.weakSpots || []).find((s) => s.part === p), m = sp ? sp.multiplier : 1, d = w ? w.damage * (w.pellets || 1) * m : 0; return h('tr', { 'data-part': p }, h('td', {}, p), h('td', {}, p === 'head' ? `above ${Math.round(HIT_ZONES.head * 100)} %` : p === 'body' ? `${Math.round(HIT_ZONES.body * 100)}–${Math.round(HIT_ZONES.head * 100)} %` : `below ${Math.round(HIT_ZONES.body * 100)} %`), h('td', {}, `×${m}`), h('td', {}, d.toFixed(0)), h('td', { 'data-stk': p }, a?.invulnerable ? '—' : Number.isFinite(Math.ceil(a.health / d)) ? String(Math.ceil(a.health / d)) : '∞')); });
    const sel = (label, key, opts, labelFn) => selectField(label, { value: hb[key], options: opts, optionLabel: labelFn, onChange: (v) => { hb[key] = v; this.renderHitboxes(); } }).el;
    this.body.replaceChildren(h('div', { class: 'insp', style: { padding: '10px 14px', maxWidth: '760px' } },
      h('div', { class: 'note' }, 'Enemies are hit-tested as vertical cylinders (never narrower than the player: 0.3 m radius), split into legs / body / head by height. The overlay draws exactly these volumes, using the same constants the playtest uses (core/aisystem.js).'),
      boolField('Show hit boxes & reach in the Scene view', { value: !!ov?.on.hitboxes, hint: 'Enemy cylinders (blue legs, amber body, red head), player capsule + eye line, and the 2.4 m interaction reach of selected pickups.', onChange: (v) => ov?.set('hitboxes', v) }).el,
      h('div', { style: { fontWeight: 600, margin: '12px 0 4px' } }, 'Hit calculator'),
      sel('Enemy', 'arch', archs.map((x) => x.id), (id) => archs.find((x) => x.id === id)?.name || id), sel('Weapon', 'weapon', weapons.map((x) => x.id), (id) => weapons.find((x) => x.id === id)?.name || id),
      numberField('Aim height above its feet', { value: hb.aim, step: 0.05, min: 0, max: height, unit: 'm', onChange: (v) => { hb.aim = v; this.renderHitboxes(); } }).el,
      numberField('Distance', { value: hb.dist, step: 1, min: 1, unit: 'm', onChange: (v) => { hb.dist = v; this.renderHitboxes(); } }).el,
      h('div', { id: 'dg-hit', class: 'kv', style: { fontSize: '13px', margin: '8px 0' } }, h('span', {}, 'Hit volume'), h('b', {}, `${(hitRadius(a || { radius: 0.3 }) * 2).toFixed(2)} m wide × ${height} m tall`), h('span', {}, 'Aim point is'), h('b', { 'data-hit-part': part }, `${part} (${Math.round(rel * 100)} % of its height)`), h('span', {}, 'Damage per shot'), h('b', {}, dmg.toFixed(0)), h('span', {}, 'Shots to kill'), h('b', { 'data-stk-now': '1' }, a?.invulnerable ? 'cannot be killed (stagger only)' : Number.isFinite(stk) ? String(stk) : '∞'), ...(w?.kind === 'gun' ? [h('span', {}, 'Spread at this distance'), h('b', {}, `${(spreadR * 2).toFixed(2)} m hip · ${(spreadAds * 2).toFixed(2)} m aimed`), h('span', {}, 'Fits the target?'), h('b', {}, `${spreadR <= hitRadius(a) ? 'hip fire stays inside' : spreadAds <= hitRadius(a) ? 'aimed fire stays inside' : 'spread is wider than the body'}`)] : [])),
      h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' } }, h('thead', {}, h('tr', {}, ['Zone', 'Height band', 'Multiplier', 'Damage', 'Shots to kill'].map((x) => h('th', { style: { textAlign: 'left', color: 'var(--faint)', fontWeight: 500, padding: '3px 6px' } }, x)))), h('tbody', {}, rows)),
      h('div', { style: { color: 'var(--faint)', fontSize: '11px', marginTop: '8px' } }, 'Damage uses the enemy archetype’s weak-spot multipliers (Enemies tab). Pellets multiply damage; reference enemies and weapons are read-only copies of the game’s numbers.')));
  }

  // ---------------------------------------------------------------- performance
  renderPerf() {
    const snap = perfSnapshot(this.app), s = snap.stats, vp = this.app.viewport;
    const row = (b) => h('tr', { 'data-budget': b.key, 'data-status': b.status, title: b.hint }, h('td', { style: { padding: '3px 8px' } }, b.label), h('td', { style: { padding: '3px 8px', textAlign: 'right' } }, `${b.value.toLocaleString()}${b.unit}`), h('td', { style: { padding: '3px 8px', color: 'var(--faint)' } }, `warn ${b.warn.toLocaleString()} · high ${b.bad.toLocaleString()}`), h('td', { style: { padding: '3px 8px' } }, h('span', { class: 'badge-st ' + COST[b.status][1] }, COST[b.status][0])));
    const list = (title, items, fmt) => h('div', { style: { margin: '10px 0' } }, h('div', { style: { fontWeight: 600, marginBottom: '3px' } }, title), ...(items.length ? items.map((x) => h('div', { style: { fontSize: '12px', padding: '1px 10px', color: 'var(--dim)' } }, fmt(x))) : [h('div', { style: { fontSize: '12px', padding: '1px 10px', color: 'var(--faint)' } }, 'nothing notable')]));
    this.body.replaceChildren(h('div', { class: 'insp', id: 'dg-perf', style: { padding: '10px 14px', maxWidth: '860px' } },
      h('div', { class: 'note' }, 'Live numbers from the viewport (updated every second) against the Studio’s own budgets for a comfortable editor — not limits of the original game. Render-on-demand means an idle scene costs nothing; use View ▸ Render scale if the viewport is slow.'),
      h('div', { class: 'kv', style: { fontSize: '13px', margin: '6px 0' } }, h('span', {}, 'Viewport speed'), h('b', { 'data-perf': 'fps' }, `${s.fps.toFixed(0)} fps`), h('span', {}, 'Scene objects'), h('b', {}, String(s.nodes)), h('span', {}, 'Unique geometries / materials'), h('b', {}, `${snap.agg.uniqueGeometries} / ${snap.agg.uniqueMaterials}`), ...(s.heapMB !== null ? [h('span', {}, 'JavaScript heap'), h('b', {}, `${s.heapMB} MB`)] : [])),
      h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' } }, h('tbody', {}, snap.budgets.map(row))),
      snap.hints.length ? h('div', { style: { margin: '10px 0' } }, h('div', { style: { fontWeight: 600, marginBottom: '3px' } }, 'Suggestions'), ...snap.hints.map((x) => h('div', { class: 'note ' + (x.severity === 'warn' ? 'warn' : ''), style: { margin: '3px 0' } }, x.message))) : h('div', { style: { margin: '10px 0', color: 'var(--faint)' } }, 'No suggestions: nothing stands out.'),
      list('Repeated geometry (instancing candidates)', snap.agg.repeated, (g) => `${g.name} — ${g.instances}× (${g.tris.toLocaleString()} triangles each)`),
      list('Heaviest models', snap.agg.heaviest.slice(0, 5), (g) => `${g.name} — ${g.instances}× ${g.tris.toLocaleString()} = ${g.total.toLocaleString()} triangles`),
      list('Materials by draw calls', snap.agg.materials.slice(0, 5), (m) => `${m.name} — ${m.calls} draw calls`),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '12px 0 4px' } }, button('Measure editor steps', () => this.measure(), { primary: true, title: 'Times building collision, the navigation mesh and validation for this map' }), h('span', { id: 'dg-measure', style: { color: 'var(--dim)', fontSize: '12px' } }, this.lastMeasure || ''))));
  }
  measure() {
    this.measuring = true;
    const el = document.getElementById('dg-measure'); if (el) el.textContent = 'Measuring…';
    setTimeout(() => { const r = measureCore(this.app.project); this.lastMeasure = `collision ${r.ms.colliders + r.ms.collisionWorld} ms · navigation mesh ${r.ms.navmesh} ms (${r.counts.navNodes.toLocaleString()} cells) · validation ${r.ms.validation} ms (${r.counts.issues} issues) for ${r.counts.nodes} objects`; this.measuring = false; this.app.log('info', 'Measured: ' + this.lastMeasure); const e2 = document.getElementById('dg-measure'); if (e2) e2.textContent = this.lastMeasure; }, 30);
  }
}

export default {
  id: 'diagnostics', label: 'Diagnostics', fill: true,
  create(app, el) { const w = new DiagnosticsWorkspace(app, el); app.diagnosticsWs = w; return w; },
};

// Timeline panel: author cinematic sequences (camera, objects, lights, sounds, events, subtitles, fades, shakes, flashes) and
// preview them in the 3D viewport. Previewing never changes your map: everything the sequence touched is restored when you stop.
import { h } from './dom.js';
import { contextMenu } from './dialogs.js';
import { promptBox, confirmBox, modal, KEEP_OPEN } from './dialogs.js';
import { numberField, vec3Field, selectField, textField, boolField, button } from './fields.js';
import { setData } from '../core/commands.js';
import { newSequence, newTrack, TRACK_TYPES, EASINGS, evaluate, validateSequence, jumpscarePreset, SequencePlayer } from '../core/sequence.js';
import { SceneSequenceHost } from '../core/seqhost.js';
import { playOneShot } from './audioctx.js';
import * as THREE from '../../lib/three.module.js';

const LANE_H = 30, HEAD_W = 210, RULER_H = 24;
const snapT = (t, shift) => (shift ? Math.round(t * 1000) / 1000 : Math.round(t / 0.05) * 0.05);

class SequencePreview {
  constructor(app, getSeq) { this.app = app; this.getSeq = getSeq; this.host = null; this.snapshot = null; this.player = null; this.paused = false; this.t = 0; }
  get active() { return !!this.host; }
  _host() {
    const vp = this.app.viewport, seq = this.getSeq();
    return new SceneSequenceHost({ scene: this.app.scene, seq, hooks: {
      camera: (cam, st) => vp.setCameraOverride(cam, st), overlay: (st) => vp.setFx(st),
      audio: (c) => { if (c.asset) playOneShot(this.app, c.asset, { volume: c.volume }).catch((e) => this.app.log('warn', 'Sequence sound: ' + e.message)); },
      event: (name) => { this.app.log('info', `Sequence event “${name}”`); this.app.emit('sequence-event', name); },
    } });
  }
  begin() {
    if (this.host) return;
    this.app.previewing = this;
    this.host = this._host();
    this.snapshot = this.host.capture(this.host.player().targets());
  }
  seek(t) { this.begin(); this.t = t; const seq = this.getSeq(); this.host.apply(evaluate(seq, t, { reduceFlashing: seq.reduceFlashing })); this.app.viewport.requestRender(); }
  play(from = 0) {
    this.end();
    this.host = this._host(); this.app.previewing = this;
    this.player = this.host.player().start();
    this.paused = false;
    if (from > 0) { this.player.time = from; }
  }
  /** The sequence data was replaced by an edit: keep the live preview on the new data. */
  refresh() {
    if (!this.host) return;
    const seq = this.getSeq();
    if (!seq) { this.end(); return; }
    this.host.seq = seq; if (this.player) this.player.seq = seq;
    const extra = this.host.capture(this.host.player().targets());           // targets that were added after the preview began
    const snap = this.snapshot || this.player?.snapshot;
    if (snap) { for (const n of extra.nodes) if (!snap.nodes.some((x) => x.id === n.id)) snap.nodes.push(n); for (const p of extra.props) if (!snap.props.some((x) => x.id === p.id && x.prop === p.prop)) snap.props.push(p); }
  }
  update(dt) { if (this.player?.playing && !this.paused) { this.player.update(dt); this.t = this.player.time; this.app.viewport.requestRender(); if (this.player.finished) { this.onFinish?.(); } } }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  get playing() { return !!this.player?.playing && !this.paused; }
  /** Put the scene back exactly as it was. */
  end() {
    if (!this.host) return;
    if (this.player?.playing) this.player.cancel(); else { this.host.restore(this.snapshot || this.player?.snapshot); this.host.end('cancelled'); }
    if (this.player && !this.player.playing && this.player.snapshot) this.host.restore(this.player.snapshot);
    this.host = null; this.player = null; this.snapshot = null; this.paused = false;
    if (this.app.previewing === this) this.app.previewing = null;
    this.app.viewport.setCameraOverride(null, null); this.app.viewport.setFx(null);
    this.app.viewport.sceneView.refreshOutlines(); this.app.viewport.requestRender();
  }
}

export class TimelinePanel {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.seqId = null; this.pps = 120; this.sel = null; this.time = 0;
    this.preview = new SequencePreview(app, () => this.seq);
    this.preview.onFinish = () => { this.playBtn && (this.playBtn.textContent = '▶'); };
    el.classList.add('tl');
    this.bar = h('div', { class: 'graph-bar', style: { flexWrap: 'wrap' } });
    this.body = h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } });
    this.props = h('div', { class: 'panel-body insp', style: { width: '280px', flex: 'none', borderLeft: '1px solid var(--line)', background: 'var(--panel)' } });
    el.append(this.bar, this.body);
    this.body.append(h('div', { style: { flex: 1, display: 'flex', minWidth: 0 } }), this.props);
    this.main = this.body.firstChild;
    app.on('history', () => { if (!this.suspendRender) this.render(); });
    app.on('project', () => { this.preview.end(); this.seqId = null; this.sel = null; this.render(); });
    this._raf = requestAnimationFrame((n) => this.tick(n));
    this.render();
  }

  get seqs() { return this.app.project.data.sequences; }
  get seq() { return this.seqId ? this.seqs[this.seqId] || null : null; }
  commit(seq, label, mergeKey) {
    const cmd = setData(['sequences', seq.id], seq, { label, mergeKey });
    cmd.keepPreview = true;
    this.suspendRender = true;
    this.app.exec(cmd);
    this.suspendRender = false;
    this.preview.refresh();
    if (this.preview.active && !this.preview.player) this.preview.seek(this.time);
    this.render();
  }
  mutate(fn, label, mergeKey) { const s = JSON.parse(JSON.stringify(this.seq)); fn(s); this.commit(s, label, mergeKey); }

  tick(now) {
    this._raf = requestAnimationFrame((n) => this.tick(n));
    const dt = Math.min(0.1, (now - (this._last || now)) / 1000); this._last = now;
    if (this.preview.playing) { this.preview.update(dt); this.time = this.preview.t; this.movePlayhead(); }
  }

  // ------------------------------------------------------------------ transport bar
  render() {
    if (!this.el.isConnected) return;
    const seq = this.seq;
    const ids = Object.keys(this.seqs);
    if (!seq && ids.length) this.seqId = ids[0];
    this.renderBar();
    this.renderBody();
  }

  renderBar() {
    const seq = this.seq, app = this.app;
    const sel = h('select', { class: 'tb-select', 'aria-label': 'Sequence', onchange: (e) => { this.preview.end(); this.seqId = e.target.value; this.sel = null; this.time = 0; this.render(); } },
      Object.values(this.seqs).map((s) => h('option', { value: s.id, selected: s.id === this.seqId }, s.name)));
    this.playBtn = h('button', { class: 'btn small primary', 'aria-label': 'Play / pause', onclick: () => this.togglePlay(), disabled: !seq }, this.preview.playing ? '⏸' : '▶');
    this.timeLbl = h('span', { style: { font: 'var(--mono)', minWidth: '110px', textAlign: 'center' } }, '');
    this.updateTime();
    const issues = seq ? validateSequence(seq, app.project) : [];
    this.bar.replaceChildren(
      h('b', { style: { marginRight: '4px' } }, 'Timeline'), Object.keys(this.seqs).length ? sel : h('span', { style: { color: 'var(--faint)' } }, 'No sequences'),
      button('New', () => this.create(), { primary: !seq }), button('Jumpscare…', () => this.jumpscareDialog()), seq ? button('Rename', () => this.rename()) : null, seq ? button('Delete', () => this.remove()) : null,
      h('span', { style: { width: '10px' } }), this.playBtn, h('button', { class: 'btn small', 'aria-label': 'Stop and restore scene', onclick: () => this.stop(), disabled: !seq, title: 'Stop — restores everything the preview moved' }, '■'), this.timeLbl,
      seq ? numberField('Length', { value: seq.duration, step: 0.5, min: 0.1, unit: 's', onChange: (v) => this.mutate((s) => { s.duration = v; }, 'Sequence length', `seqd:${seq.id}`) }).el : null,
      seq ? h('label', { style: { display: 'flex', gap: '4px', color: 'var(--dim)' } }, h('input', { type: 'checkbox', checked: seq.loop, onchange: (e) => this.mutate((s) => { s.loop = e.target.checked; }, 'Loop') }), 'Loop') : null,
      seq ? h('label', { style: { display: 'flex', gap: '4px', color: 'var(--dim)' }, title: 'Players can press Esc / Enter to skip' }, h('input', { type: 'checkbox', checked: seq.skippable, onchange: (e) => this.mutate((s) => { s.skippable = e.target.checked; }, 'Skippable') }), 'Skippable') : null,
      seq ? h('label', { style: { display: 'flex', gap: '4px', color: 'var(--dim)' }, title: 'Caps flash brightness for photosensitive players' }, h('input', { type: 'checkbox', checked: seq.reduceFlashing, onchange: (e) => this.mutate((s) => { s.reduceFlashing = e.target.checked; }, 'Reduce flashing') }), 'Reduce flashing') : null,
      seq ? button('+ Track', () => this.addTrackMenu()) : null,
      h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' } },
        issues.length ? h('span', { class: 'chip ' + (issues.some((i) => i.severity === 'error') ? 'err' : 'warn'), title: issues.map((i) => i.message).join('\n'), style: { cursor: 'help' } }, `${issues.length} note(s)`) : null,
        h('span', { style: { color: 'var(--faint)', fontSize: '11px' } }, 'zoom'), h('input', { type: 'range', min: 40, max: 400, value: this.pps, 'aria-label': 'Zoom', style: { width: '90px' }, oninput: (e) => { this.pps = +e.target.value; this.renderBody(); } })));
  }

  updateTime() { if (this.timeLbl) this.timeLbl.textContent = `${this.time.toFixed(2)} / ${(this.seq?.duration || 0).toFixed(2)} s`; }

  // ------------------------------------------------------------------ lanes
  renderBody() {
    const seq = this.seq;
    const prevScroll = this.lanes ? { x: this.lanes.scrollLeft, y: this.lanes.scrollTop } : { x: 0, y: 0 };
    if (!seq) { this.main.replaceChildren(h('div', { class: 'empty', style: { flex: 1 } }, 'Create a sequence to animate cameras, objects, lights and sounds. “Jumpscare…” builds an editable starting point from the options you choose.')); this.props.replaceChildren(); return; }
    const width = Math.max(600, seq.duration * this.pps + 80);
    this.heads = h('div', { style: { width: HEAD_W + 'px', flex: 'none', borderRight: '1px solid var(--line)', background: 'var(--panel)', overflow: 'hidden' } }, h('div', { style: { height: RULER_H + 'px', borderBottom: '1px solid var(--line)' } }));
    this.lanes = h('div', { style: { flex: 1, overflow: 'auto', position: 'relative' }, onscroll: () => { this.heads.scrollTop = this.lanes.scrollTop; } });
    const inner = h('div', { class: 'tl-inner', style: { position: 'relative', width: width + 'px', minHeight: '100%' } });
    // ruler
    const ruler = h('div', { class: 'tl-ruler', style: { height: RULER_H + 'px', position: 'sticky', top: 0, zIndex: 3, background: 'var(--panel2)', borderBottom: '1px solid var(--line)', cursor: 'ew-resize' }, onpointerdown: (e) => this.scrub(e) });
    const step = this.pps >= 200 ? 0.25 : this.pps >= 90 ? 0.5 : 1;
    for (let t = 0; t <= seq.duration + 1e-6; t += step) ruler.appendChild(h('div', { style: { position: 'absolute', left: t * this.pps + 'px', top: '10px', height: '14px', borderLeft: '1px solid var(--faint)', paddingLeft: '3px', fontSize: '10px', color: 'var(--dim)', pointerEvents: 'none' } }, t % 1 === 0 ? t + 's' : ''));
    inner.appendChild(ruler);
    seq.tracks.forEach((tr, ti) => {
      const def = TRACK_TYPES[tr.type];
      this.heads.appendChild(h('div', { class: 'tl-head' + (this.sel?.track === ti && this.sel.key === undefined ? ' sel' : ''), 'data-track': ti, style: { height: LANE_H + 'px', display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px', borderBottom: '1px solid #ffffff10', background: this.sel?.track === ti && this.sel.key === undefined ? '#3a2a12' : 'transparent', opacity: tr.mute ? 0.5 : 1 }, onclick: () => { this.sel = { track: ti }; this.renderBody(); } },
        h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: def.color, flex: 'none' } }), h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: tr.name }, tr.name),
        h('button', { class: 'tree-btn' + (tr.mute ? ' on' : ''), title: tr.mute ? 'Unmute' : 'Mute', 'aria-label': 'Mute track', onclick: (e) => { e.stopPropagation(); this.mutate((s) => { s.tracks[ti].mute = !s.tracks[ti].mute; }, 'Mute track'); } }, tr.mute ? '🔇' : '🔈'),
        h('button', { class: 'tree-btn', title: 'Delete track', 'aria-label': 'Delete track', onclick: (e) => { e.stopPropagation(); this.mutate((s) => { s.tracks.splice(ti, 1); }, 'Delete track'); this.sel = null; } }, '×')));
      const lane = h('div', { class: 'tl-lane', 'data-track': ti, style: { height: LANE_H + 'px', position: 'relative', borderBottom: '1px solid #ffffff10', background: ti % 2 ? '#ffffff05' : 'transparent' }, ondblclick: (e) => { if (e.target === lane) this.addKeyAt(ti, this.timeAt(e)); } });
      tr.keys.forEach((k, ki) => lane.appendChild(this.keyEl(tr, ti, k, ki, def)));
      inner.appendChild(lane);
    });
    this.playhead = h('div', { class: 'tl-playhead', style: { position: 'absolute', top: 0, bottom: 0, width: '0', borderLeft: '2px solid var(--accent)', pointerEvents: 'none', zIndex: 4, left: this.time * this.pps + 'px' } });
    inner.appendChild(this.playhead);
    this.lanes.appendChild(inner);
    this.main.replaceChildren(this.heads, this.lanes);
    this.lanes.scrollLeft = prevScroll.x; this.lanes.scrollTop = prevScroll.y;
    this.renderProps();
    this.updateTime();
  }

  timeAt(e) { const r = this.lanes.querySelector('.tl-inner').getBoundingClientRect(); return Math.max(0, snapT((e.clientX - r.left) / this.pps, e.shiftKey)); }
  movePlayhead() { if (this.playhead) this.playhead.style.left = this.time * this.pps + 'px'; this.updateTime(); const s = this.lanes; if (s && this.preview.playing) { const x = this.time * this.pps; if (x > s.scrollLeft + s.clientWidth - 40) s.scrollLeft = x - 80; } }

  scrub(e) {
    e.preventDefault();
    const ruler = e.currentTarget; ruler.setPointerCapture(e.pointerId);
    const set = (ev) => { this.preview.pause(); this.time = Math.max(0, Math.min(this.seq.duration, this.timeAt(ev))); this.preview.seek(this.time); this.movePlayhead(); if (this.playBtn) this.playBtn.textContent = '▶'; };
    set(e);
    const mv = (ev) => set(ev), up = () => { ruler.removeEventListener('pointermove', mv); ruler.removeEventListener('pointerup', up); };
    ruler.addEventListener('pointermove', mv); ruler.addEventListener('pointerup', up);
  }

  keyEl(tr, ti, k, ki, def) {
    const selected = this.sel?.track === ti && this.sel.key === ki;
    const isClip = def.kind === 'clips' && k.dur;
    const el = h('div', { class: 'tl-key' + (selected ? ' sel' : ''), 'data-track': ti, 'data-key': ki, title: this.keyTitle(tr, k), tabindex: '0',
      style: { position: 'absolute', top: isClip ? '5px' : '7px', left: k.t * this.pps + 'px', ...(isClip ? { width: Math.max(10, k.dur * this.pps) + 'px', height: '20px', background: def.color + '99', border: `1px solid ${def.color}`, borderRadius: '4px', color: '#fff', fontSize: '10px', overflow: 'hidden', whiteSpace: 'nowrap', padding: '2px 4px' } : { width: '14px', height: '14px', marginLeft: '-7px', background: def.color, transform: 'rotate(45deg)', border: '1px solid #000a' }), outline: selected ? '2px solid var(--accent)' : 'none', cursor: 'grab' },
      onpointerdown: (e) => this.dragKey(e, ti, ki), onkeydown: (e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteKey(ti, ki); } } }, isClip ? this.keyLabel(tr, k) : null);
    return el;
  }
  keyLabel(tr, k) { return tr.type === 'text' ? k.text : tr.type === 'anim' ? k.clip : tr.type === 'audio' ? k.asset : ''; }
  keyTitle(tr, k) { return `${tr.name} @ ${k.t.toFixed(2)} s` + (k.name ? ` — ${k.name}` : '') + (k.text ? ` — ${k.text}` : ''); }

  dragKey(e, ti, ki) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    this.sel = { track: ti, key: ki };
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    this.lanes.querySelectorAll('.tl-key.sel').forEach((x) => { x.classList.remove('sel'); x.style.outline = 'none'; }); el.classList.add('sel'); el.style.outline = '2px solid var(--accent)';
    const startX = e.clientX, t0 = this.seq.tracks[ti].keys[ki].t; let moved = false, nt = t0;
    const mv = (ev) => { const dt = (ev.clientX - startX) / this.pps; if (!moved && Math.abs(ev.clientX - startX) < 3) return; moved = true; nt = Math.max(0, snapT(t0 + dt, ev.shiftKey)); el.style.left = nt * this.pps + 'px'; };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      if (moved && nt !== t0) { this.mutate((s) => { const keys = s.tracks[ti].keys; keys[ki].t = nt; const k = keys[ki]; keys.sort((a, b) => a.t - b.t); this.sel = { track: ti, key: keys.indexOf(k) }; }, 'Move key'); }
      else this.renderProps();
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    this.renderProps();
  }

  deleteKey(ti, ki) { this.mutate((s) => { s.tracks[ti].keys.splice(ki, 1); }, 'Delete key'); this.sel = { track: ti }; }

  // ------------------------------------------------------------------ keys
  defaultKey(tr, t) {
    const app = this.app, vp = app.viewport;
    switch (tr.type) {
      case 'camera': { const c = vp.persp; const e = new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ'); const D = 180 / Math.PI; return { t, p: c.position.toArray().map(round), r: [e.y * D, e.x * D, e.z * D].map(round), fov: Math.round(c.fov), ease: 'inOut' }; }
      case 'transform': { const n = app.scene.get(tr.target) || app.scene.byName(tr.target); return n ? { t, p: [...n.t.p], r: [...n.t.r], s: [...n.t.s], ease: 'inOut' } : { t, p: [0, 0, 0], ease: 'inOut' }; }
      case 'property': { const n = app.scene.get(tr.target) || app.scene.byName(tr.target); const v = n?.props?.[tr.prop]; return { t, v: v ?? 0, ease: 'linear' }; }
      case 'fov': return { t, d: 0, ease: 'inOut' };
      case 'audio': return { t, asset: '', volume: 1 };
      case 'event': return { t, name: '' };
      case 'text': return { t, dur: 2, text: 'Text' };
      case 'fade': return { t, dur: 0.5, from: 0, to: 1, color: '#000000' };
      case 'shake': return { t, dur: 0.5, amp: 0.05, freq: 18 };
      case 'flash': return { t, dur: 0.12, color: '#ffffff', intensity: 0.8 };
      case 'anim': return { t, target: tr.target || '', clip: '', loop: true, speed: 1 };
      default: return { t };
    }
  }
  addKeyAt(ti, t) {
    const tr = this.seq.tracks[ti];
    const key = this.defaultKey(tr, t);
    this.mutate((s) => { s.tracks[ti].keys.push(key); s.tracks[ti].keys.sort((a, b) => a.t - b.t); }, `Add ${TRACK_TYPES[tr.type].label} key`);
    const idx = this.seq.tracks[ti].keys.findIndex((k) => k.t === t);
    this.sel = { track: ti, key: Math.max(0, idx) };
    this.renderBody();
  }
  addTrackMenu() {
    const app = this.app;
    const r = this.bar.getBoundingClientRect();
    contextMenu(r.left + 200, r.top + 30, Object.entries(TRACK_TYPES).map(([type, def]) => ({ label: def.label, run: async () => {
      const extra = {};
      if (['transform', 'property', 'anim'].includes(type)) {
        extra.target = app.primary?.name || '';
        if (!extra.target) { app.toast('Select the object this track should animate first (it can be changed later).', 'info'); }
        if (type === 'property') extra.prop = app.primary?.type === 'light' ? 'intensity' : 'intensity';
      }
      this.mutate((s) => { s.tracks.push(newTrack(type, extra)); }, `Add ${def.label} track`);
      this.sel = { track: this.seq.tracks.length - 1 };
      this.renderBody();
    } })));
  }

  // ------------------------------------------------------------------ properties of the selected key / track
  renderProps() {
    const seq = this.seq, sel = this.sel;
    if (!seq || !sel || !seq.tracks[sel.track]) { this.props.replaceChildren(h('div', { class: 'note' }, 'Double-click a lane to add a key or clip. Click one to edit it; drag to move; Delete removes. Click the ruler to scrub.')); return; }
    const tr = seq.tracks[sel.track], def = TRACK_TYPES[tr.type], app = this.app;
    const rows = [h('div', { class: 'insp-title' }, h('b', {}, tr.name), h('span', { class: 'badge' }, def.label))];
    const setTrack = (patch, label) => this.mutate((s) => { Object.assign(s.tracks[sel.track], patch); }, label, `tr:${tr.id}:${Object.keys(patch)}`);
    rows.push(textField('Track name', { value: tr.name, onChange: (v) => setTrack({ name: v }, 'Rename track') }).el);
    if (['transform', 'property', 'anim'].includes(tr.type)) {
      const names = app.scene.all().filter((n) => n.type !== 'group').map((n) => n.name);
      rows.push(selectField('Object', { value: tr.target || '', options: ['', ...names], optionLabel: (n) => n || '(choose)', onChange: (v) => setTrack({ target: v }, 'Set target') }).el);
      if (tr.type === 'property') { const n = app.scene.byName(tr.target); const keys = n ? Object.entries(n.props).filter(([, v]) => ['number', 'boolean'].includes(typeof v) || (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))).map(([k]) => k) : ['intensity']; rows.push(selectField('Property', { value: tr.prop || '', options: ['', ...new Set([...keys, tr.prop].filter(Boolean))], optionLabel: (n) => n || '(choose)', onChange: (v) => setTrack({ prop: v }, 'Set property') }).el); }
    }
    if (sel.key !== undefined && tr.keys[sel.key]) {
      const k = tr.keys[sel.key];
      const setKey = (patch, label) => this.mutate((s) => { Object.assign(s.tracks[sel.track].keys[sel.key], patch); s.tracks[sel.track].keys.sort((a, b) => a.t - b.t); }, label || 'Edit key', `k:${tr.id}:${sel.key}:${Object.keys(patch)}`);
      rows.push(h('div', { class: 'sec-h', style: { cursor: 'default' } }, `Key at ${k.t.toFixed(2)} s`));
      rows.push(numberField('Time', { value: k.t, step: 0.05, min: 0, unit: 's', onChange: (v) => setKey({ t: v }) }).el);
      const num = (label, key, o = {}) => numberField(label, { value: k[key] ?? 0, step: 0.05, ...o, onChange: (v) => setKey({ [key]: v }) }).el;
      switch (tr.type) {
        case 'camera': rows.push(vec3Field('Position', { value: k.p, step: 0.1, unit: 'm', onChange: (v) => setKey({ p: v }) }).el, vec3Field('Yaw / pitch / roll', { value: k.r, step: 1, unit: '°', onChange: (v) => setKey({ r: v }) }).el, num('Field of view', 'fov', { step: 1, min: 10, max: 140 }), h('div', { style: { padding: '2px 0 6px 118px' } }, button('Capture viewport camera', () => { const d = this.defaultKey(tr, k.t); setKey({ p: d.p, r: d.r, fov: d.fov }, 'Capture camera'); })), selectField('Easing to next', { value: k.ease || 'linear', options: EASINGS, onChange: (v) => setKey({ ease: v }) }).el); break;
        case 'transform': rows.push(vec3Field('Position', { value: k.p || [0, 0, 0], step: 0.1, unit: 'm', onChange: (v) => setKey({ p: v }) }).el, vec3Field('Rotation', { value: k.r || [0, 0, 0], step: 5, unit: '°', onChange: (v) => setKey({ r: v }) }).el, h('div', { style: { padding: '2px 0 6px 118px' } }, button('Use object’s current transform', () => { const d = this.defaultKey(tr, k.t); setKey({ p: d.p, r: d.r, s: d.s }, 'Key from object'); })), selectField('Easing to next', { value: k.ease || 'linear', options: EASINGS, onChange: (v) => setKey({ ease: v }) }).el); break;
        case 'property': rows.push(typeof k.v === 'boolean' ? boolField('Value', { value: k.v, onChange: (v) => setKey({ v }) }).el : typeof k.v === 'string' ? textField('Value', { value: k.v, onChange: (v) => setKey({ v }) }).el : num('Value', 'v', { step: 0.5 }), selectField('Easing to next', { value: k.ease || 'linear', options: EASINGS, onChange: (v) => setKey({ ease: v }) }).el); break;
        case 'fov': rows.push(num('FOV offset', 'd', { step: 1, unit: '°' }), selectField('Easing to next', { value: k.ease || 'linear', options: EASINGS, onChange: (v) => setKey({ ease: v }) }).el); break;
        case 'audio': rows.push(selectField('Sound', { value: k.asset || '', options: ['', ...app.assets.allMeta('audio').map((a) => a.id)], optionLabel: (id) => (id ? app.assets.meta(id)?.name || id : '(choose)'), onChange: (v) => setKey({ asset: v }) }).el, num('Volume', 'volume', { min: 0, max: 2 }), h('div', { style: { padding: '2px 0 6px 118px' } }, button('▶ Preview sound', () => k.asset && playOneShot(app, k.asset, { volume: k.volume }).catch((e) => app.toast(e.message, 'error'))))); break;
        case 'event': rows.push(textField('Event name', { value: k.name || '', placeholder: 'handled by an event graph', onChange: (v) => setKey({ name: v }) }).el); break;
        case 'text': rows.push(num('Duration', 'dur', { min: 0.1, unit: 's' }), textField('Subtitle', { value: k.text || '', multiline: true, onChange: (v) => setKey({ text: v }) }).el); break;
        case 'fade': rows.push(num('Duration', 'dur', { min: 0.01, unit: 's' }), num('From (0–1)', 'from', { min: 0, max: 1 }), num('To (0–1)', 'to', { min: 0, max: 1 }), h('div', { class: 'field' }, h('label', {}, 'Colour'), h('input', { type: 'color', value: k.color || '#000000', onchange: (e) => setKey({ color: e.target.value }) }))); break;
        case 'shake': rows.push(num('Duration', 'dur', { min: 0.05, unit: 's' }), num('Strength', 'amp', { min: 0, step: 0.01 }), num('Speed', 'freq', { min: 1, step: 1 })); break;
        case 'flash': rows.push(num('Duration', 'dur', { min: 0.02, unit: 's' }), num('Brightness (0–1)', 'intensity', { min: 0, max: 1 }), h('div', { class: 'hint', style: { color: 'var(--faint)', fontSize: '11px', paddingLeft: '118px' } }, 'Capped when “Reduce flashing” is on.')); break;
        case 'anim': rows.push(textField('Object', { value: k.target || '', onChange: (v) => setKey({ target: v }) }).el, textField('Clip', { value: k.clip || '', onChange: (v) => setKey({ clip: v }) }).el, num('Speed', 'speed', { min: 0.05 }), boolField('Loop', { value: k.loop !== false, onChange: (v) => setKey({ loop: v }) }).el); break;
        default: break;
      }
      rows.push(h('div', { style: { padding: '8px 10px' } }, button('Delete key', () => this.deleteKey(sel.track, sel.key))));
    } else rows.push(h('div', { class: 'note' }, 'Double-click this track’s lane to add a key.'));
    this.props.replaceChildren(...rows);
  }

  // ------------------------------------------------------------------ transport actions
  togglePlay() {
    const seq = this.seq; if (!seq) return;
    if (this.preview.playing) { this.preview.pause(); this.playBtn.textContent = '▶'; return; }
    if (this.preview.player?.playing && this.preview.paused) { this.preview.resume(); this.playBtn.textContent = '⏸'; return; }
    this.preview.play(); this.time = 0; this.playBtn.textContent = '⏸';
  }
  stop() { this.preview.end(); this.time = 0; this.movePlayhead(); if (this.playBtn) this.playBtn.textContent = '▶'; }

  // ------------------------------------------------------------------ sequence management
  async create() {
    const name = await promptBox('New sequence', 'Name', `Sequence ${Object.keys(this.seqs).length + 1}`);
    if (!name?.trim()) return;
    const s = newSequence(name.trim());
    this.commit(s, 'Create sequence'); this.seqId = s.id; this.render();
  }
  async rename() { const v = await promptBox('Rename sequence', 'Name', this.seq.name); if (v?.trim()) this.mutate((s) => { s.name = v.trim(); }, 'Rename sequence'); }
  async remove() {
    const s = this.seq;
    if (!(await confirmBox('Delete sequence', `Delete “${s.name}”? You can undo this.`, { ok: 'Delete', danger: true }))) return;
    this.preview.end();
    const next = { ...this.seqs }; delete next[s.id];
    this.app.exec(setData(['sequences'], next, { label: 'Delete sequence' }));
    this.seqId = null; this.render();
  }

  async jumpscareDialog() {
    const app = this.app;
    const nodes = app.scene.all().filter((n) => n.type !== 'group');
    const f = (label, el) => h('div', { class: 'field' }, h('label', {}, label), el);
    const name = h('input', { type: 'text', value: 'Jumpscare', 'aria-label': 'Name' });
    const dur = h('input', { type: 'number', value: 2.4, step: 0.1, min: 0.5, 'aria-label': 'Duration' });
    const shake = h('input', { type: 'number', value: 0.08, step: 0.01, min: 0, 'aria-label': 'Shake strength' });
    const fov = h('input', { type: 'number', value: 14, step: 1, 'aria-label': 'FOV punch' });
    const flash = h('input', { type: 'checkbox', 'aria-label': 'White flash' });
    const black = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Blackout' });
    const sting = h('select', { 'aria-label': 'Sting sound' }, [h('option', { value: '' }, '(choose later)'), ...app.assets.allMeta('audio').map((a) => h('option', { value: a.id }, a.name))]);
    const enemy = h('select', { 'aria-label': 'Enemy lunge' }, [h('option', { value: '' }, '(none)'), ...nodes.map((n) => h('option', { value: n.name }, `${n.name} (${n.type})`))]);
    const lights = h('select', { 'aria-label': 'Lights out' }, [h('option', { value: '' }, '(none)'), ...nodes.filter((n) => n.type === 'light').map((n) => h('option', { value: n.name }, n.name))]);
    const body = h('div', {}, h('div', { class: 'note', style: { margin: '0 0 8px' } }, 'Creates a normal, fully editable sequence from the choices below: timing and shape only. Pick your own sound and objects; nothing is written for you.'),
      f('Name', name), f('Length (s)', dur), f('Camera shake', shake), f('FOV punch (°)', fov), f('White flash', flash), f('Blackout', black), f('Sting sound', sting), f('Enemy lunge', enemy), f('Lights out', lights),
      h('div', { class: 'hint', style: { color: 'var(--faint)', fontSize: '11px' } }, 'The sequence starts with “Reduce flashing” ON; a flash is capped at 30 % brightness for players who enable it.'));
    const res = await modal({ title: 'Jumpscare sequence', body, width: 520, buttons: [{ label: 'Cancel', value: undefined }, { label: 'Create', value: () => ({ name: name.value.trim() || 'Jumpscare', duration: +dur.value || 2.4, shake: +shake.value, fovPunch: +fov.value, flash: flash.checked, blackout: black.checked, sting: sting.value, enemy: enemy.value, lights: lights.value }), primary: true }] });
    if (!res) return;
    const opts = { ...res };
    if (opts.enemy) {
      const n = app.scene.byName(opts.enemy);
      const cam = app.viewport.persp.position;
      const from = app.scene.worldPosition(n.id).toArray().map(round);
      const to = [cam.x + (from[0] - cam.x) * 0.2, from[1], cam.z + (from[2] - cam.z) * 0.2].map(round);
      opts.enemyFrom = from; opts.enemyTo = to;
    }
    if (opts.lights) opts.lightsOn = app.scene.byName(opts.lights)?.props.intensity ?? 20;
    const s = jumpscarePreset(opts);
    this.commit(s, 'Create jumpscare sequence'); this.seqId = s.id; this.render();
    app.log('ok', `Created sequence “${s.name}” with ${s.tracks.length} tracks — edit the keys to match your scene.`);
  }
}
const round = (v) => Math.round(v * 1000) / 1000;

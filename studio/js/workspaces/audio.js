// Audio Studio: sounds (waveform + real analysis), spatial preview (distance curves, wall occlusion, zones, reverb, footstep surface
// at a listener you can drag around the map), the bus mixer, footstep-to-sound mapping and reverb tuning.
// All rules come from core/audio.js (unit-tested); sound comes from ui/audioengine.js (Web Audio). Nothing here edits the map except
// through undoable commands (the mixer, footsteps and reverb live in project.data.audio).

import * as THREE from '../../lib/three.module.js';
import { h } from '../ui/dom.js';
import { numberField, button } from '../ui/fields.js';
import { Inspector } from '../ui/inspector.js';
import { AudioEngine } from '../ui/audioengine.js';
import { audioContext } from '../ui/audioctx.js';
import { setData } from '../core/commands.js';
import * as A from '../core/audio.js';
import { CollisionWorld } from '../core/collision.js';
import { sceneBounds, propsOf } from '../core/geometry.js';
import { TYPES } from '../core/schema.js';

const BUS_COLORS = { sfx: '#ffb347', ambience: '#7bd88f', music: '#c792ea', voice: '#6cb6ff' };
const ZONE_COLORS = { ambience: '#7bd88f', music: '#c792ea', reverb: '#4dd0e1' };
const dbText = (g) => (g > 1e-5 ? `${A.toDb(g).toFixed(1)} dB` : '−∞ dB');
const AUDIO_TYPES = ['audioSource', 'audioZone', 'footstepZone'];

class AudioWorkspace {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.sel = null;                                  // selected sound asset id
    this.listener = { x: 0, y: 1.6, z: 0, yaw: 0 };
    this.listening = false; this.showRanges = true;
    this.view = { x: 0, z: 0, k: 12 }; this.fitted = false;
    this.cache = { version: -1 }; this.waves = new Map(); this.tab = 'mixer'; this.hearDirty = true; this.dirty = true;
    this.preview = null;
    this.build();
    app.on('project', () => { this.engine?.dispose(); this.engine = null; this.listening = false; this.cache = { version: -1 }; this.sel = null; this.waves.clear(); this.fitted = false; if (this.live) this.refreshAll(); });
    app.on('scene', () => { this.hearDirty = this.dirty = true; if (this.live) this.renderMapList(); });
    app.on('selection', () => { this.dirty = true; if (this.live) { this.renderMapList(); const n = app.primary; if (n && AUDIO_TYPES.includes(n.type)) this.setTab('selected'); } });
    app.on('assets', () => { if (this.live) this.renderSounds(); });
    app.on('history', () => { if (!this.live) return; this.hearDirty = this.dirty = true; this.engine?.applySettings(A.audioSettings(app.project.data)); this.syncMixer(); this.renderFootsteps(); this.renderReverb(); this.renderSounds(); });
  }

  get live() { return this.el.classList.contains('on'); }
  settings() { return A.audioSettings(this.app.project.data); }

  // ------------------------------------------------------------------ layout
  build() {
    const app = this.app;
    this.soundList = h('div', { class: 'panel-body', style: { flex: '0 0 42%', minHeight: '90px' } });
    this.mapList = h('div', { class: 'panel-body', style: { flex: 1 } });
    this.wave = h('canvas', { width: 900, height: 150, id: 'aud-wave', style: { width: '100%', height: '150px', display: 'block', background: '#12151a', cursor: 'crosshair' } });
    this.waveInfo = h('div', { id: 'aud-wave-info', style: { padding: '4px 10px', fontSize: '12px', color: 'var(--dim)', minHeight: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' } });
    this.canvas = h('canvas', { id: 'aud-spatial', style: { width: '100%', height: '100%', display: 'block', background: '#12151a', cursor: 'crosshair' } });
    this.canvasBox = h('div', { style: { position: 'relative', flex: 1, minHeight: '180px' } }, this.canvas);
    this.hearBox = h('div', { id: 'aud-hearing', style: { maxHeight: '170px', overflow: 'auto', borderTop: '1px solid var(--line)', fontSize: '12px' } });
    this.rightBody = h('div', { class: 'panel-body', style: { flex: 1 } });
    this.selectedBox = h('div', { style: { display: 'none', flex: 1, minHeight: 0, overflow: 'auto' } });
    this.tabBar = h('div', { class: 'toolbar', style: { height: 'auto', padding: '4px 6px', gap: '4px' } },
      ['mixer', 'footsteps', 'reverb', 'selected'].map((t) => h('button', { class: 'btn small', 'data-tab': t, onclick: () => this.setTab(t) }, { mixer: 'Mixer', footsteps: 'Footsteps', reverb: 'Reverb', selected: 'Selected object' }[t])));
    this.mixerBox = h('div'); this.stepsBox = h('div'); this.reverbBox = h('div');
    this.rightBody.append(this.mixerBox, this.stepsBox, this.reverbBox);
    this.inspector = new Inspector(app, this.selectedBox);
    const bar = h('div', { class: 'toolbar', style: { height: 'auto', padding: '4px 10px', gap: '8px', flexWrap: 'wrap' } },
      (this.listenBtn = h('button', { class: 'btn small primary', id: 'aud-listen', onclick: () => this.toggleListen() }, '🎧 Listen')),
      h('label', { style: { display: 'flex', gap: '4px', color: 'var(--dim)', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: true, 'aria-label': 'Show ranges', onchange: (e) => { this.showRanges = e.target.checked; this.dirty = true; } }), 'Ranges & occlusion'),
      h('label', { style: { display: 'flex', gap: '6px', color: 'var(--dim)', alignItems: 'center' } }, 'Facing', h('input', { type: 'range', min: 0, max: 359, value: 0, 'aria-label': 'Listener facing', onInput: (e) => { this.listener.yaw = +e.target.value; this.hearDirty = this.dirty = true; } }), (this.yawText = h('span', {}, '0°'))),
      button('Fit map', () => { this.fit(); }), h('span', { style: { color: 'var(--faint)', fontSize: '11px' } }, 'Drag the blue listener · click an object to select it · wheel zooms · Alt-drag pans'));
    this.legend = h('div', { id: 'aud-zonebar', style: { padding: '3px 10px', fontSize: '12px', color: 'var(--dim)', borderTop: '1px solid var(--line)' } });
    const waveHead = h('div', { class: 'toolbar', style: { height: 'auto', padding: '4px 10px', gap: '8px' } },
      h('b', { id: 'aud-wave-title', style: { marginRight: 'auto' } }, 'No sound selected'),
      (this.playBtn = h('button', { class: 'btn small', id: 'aud-play', disabled: true, onclick: () => this.togglePreview() }, '▶ Play')),
      h('label', { style: { display: 'flex', gap: '4px', color: 'var(--dim)', alignItems: 'center' } }, h('input', { type: 'checkbox', 'aria-label': 'Loop preview', onchange: (e) => { this.previewLoop = e.target.checked; } }), 'Loop'));
    this.el.append(h('div', { class: 'split', style: { height: '100%' } },
      h('div', { class: 'pane', style: { width: '260px', display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: '1px solid var(--line)' } },
        h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Sounds')), this.soundList,
        h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Audio objects in this map')), this.mapList,
        h('div', { style: { padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: '1px solid var(--line)' } },
          button('+ Source', () => this.addNode('audioSource'), { primary: true, title: 'Add an audio source at the listener, using the selected sound' }), button('+ Zone', () => this.addNode('audioZone')), button('+ Footstep zone', () => this.addNode('footstepZone')))),
      h('div', { class: 'pane', style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 } }, waveHead, this.wave, this.waveInfo, bar, this.canvasBox, this.legend, this.hearBox),
      h('div', { class: 'pane', style: { width: '350px', background: 'var(--panel)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' } },
        h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Mix & settings')), this.tabBar, this.rightBody, this.selectedBox)));
    this.bindCanvas();
    this.bindWave();
    this.buildMixer();
    this.ro = new ResizeObserver(() => { this.resize(); }); this.ro.observe(this.canvasBox);
  }

  setTab(t) {
    this.tab = t;
    this.tabBar.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('primary', b.dataset.tab === t));
    this.rightBody.style.display = t === 'selected' ? 'none' : 'block';
    this.selectedBox.style.display = t === 'selected' ? 'block' : 'none';
    this.mixerBox.style.display = t === 'mixer' ? 'block' : 'none'; this.stepsBox.style.display = t === 'footsteps' ? 'block' : 'none'; this.reverbBox.style.display = t === 'reverb' ? 'block' : 'none';
  }

  show() {
    this.setTab(this.tab); this.refreshAll(); this.resize();
    this.stop(); this._last = performance.now();
    const loop = (now) => { this._raf = requestAnimationFrame(loop); const dt = Math.min(0.1, (now - this._last) / 1000); this._last = now; this.frame(dt); };
    this._raf = requestAnimationFrame(loop);
  }
  hide() { this.stop(); if (this.listening) this.toggleListen(); this.stopPreview(); }
  stop() { cancelAnimationFrame(this._raf); }
  refreshAll() { this.renderSounds(); this.renderMapList(); this.syncMixer(); this.renderFootsteps(); this.renderReverb(); this.hearDirty = this.dirty = true; if (this.sel && !this.app.assets.meta(this.sel)) this.sel = null; if (this.sel) this.analyze(this.sel); else this.drawWave(); }

  // ------------------------------------------------------------------ sounds list + waveform
  sounds() { return this.app.assets.allMeta('audio'); }
  renderSounds() {
    const list = this.sounds();
    this.soundList.replaceChildren(...(list.length ? list.map((m) => h('div', { class: 'tree-row' + (m.id === this.sel ? ' sel primary' : ''), 'data-sound': m.id, style: { position: 'relative', height: '28px' }, onclick: () => this.selectSound(m.id) },
      h('span', { class: 'tree-icon', style: { background: '#c792ea', marginLeft: '8px' } }, '♪'), h('span', { class: 'tree-name' }, m.name || m.id), h('span', { class: 'tree-tag' }, m.duration ? `${m.duration.toFixed(1)} s` : ''))) : [h('div', { class: 'empty' }, 'No sounds yet. Use File ▸ Import assets… to add .wav / .ogg / .mp3 files.')]));
  }
  async selectSound(id) { this.stopPreview(); this.sel = id; this.renderSounds(); await this.analyze(id); }

  async analyze(id) {
    let w = this.waves.get(id);
    if (!w) {
      try {
        const buf = await this.app.assets.loadAudio(id, audioContext(this.app));
        const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
        w = { buf, chans, info: A.analyzeSamples(chans, buf.sampleRate), rate: buf.sampleRate }; this.waves.set(id, w);
      } catch (e) { w = { error: e.message }; }
    }
    if (this.sel !== id) return;
    this.cur = w; this.peaks = null; this.drawWave(); this.renderWaveInfo();
    this.playBtn.disabled = !!w.error;
  }
  renderWaveInfo() {
    const w = this.cur, meta = this.sel && this.app.assets.meta(this.sel);
    document.getElementById('aud-wave-title').textContent = meta ? meta.name || meta.id : 'No sound selected';
    if (!w) { this.waveInfo.replaceChildren(); return; }
    if (w.error) { this.waveInfo.replaceChildren(h('span', { class: 'note err', style: { margin: 0 } }, 'Could not decode this sound: ' + w.error)); return; }
    const i = w.info, warn = (t) => h('span', { class: 'chip warn' }, t);
    this.waveInfo.replaceChildren(h('span', {}, `${i.duration.toFixed(2)} s`), h('span', {}, `${i.channels} ch · ${w.rate} Hz`), h('span', { 'data-info': 'peak' }, `peak ${dbText(i.peak)}`), h('span', { 'data-info': 'rms' }, `RMS ${dbText(i.rms)}`),
      i.silent ? warn('this sound is silent') : null,
      i.clipped > 0 ? warn(`clipping: ${i.clipped} sample${i.clipped > 1 ? 's' : ''} at full scale`) : null,
      i.leadingSilence > 0.15 && !i.silent ? warn(`${i.leadingSilence.toFixed(2)} s of silence at the start`) : null,
      i.trailingSilence > 0.3 && !i.silent ? warn(`${i.trailingSilence.toFixed(2)} s of silence at the end`) : null,
      i.peak > 0 && i.peak < 0.05 ? warn('very quiet (peak below −26 dB)') : null);
  }
  drawWave() {
    const c = this.wave, g = c.getContext('2d'); const dpr = window.devicePixelRatio || 1, W = Math.max(100, Math.floor(c.clientWidth * dpr)), H = Math.floor(150 * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this.peaks = null; }
    g.fillStyle = '#12151a'; g.fillRect(0, 0, W, H);
    const w = this.cur;
    g.strokeStyle = '#ffffff22'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    if (!w || w.error) { g.fillStyle = '#7d8794'; g.font = `${12 * dpr}px system-ui`; g.fillText(w?.error ? 'Cannot display this sound' : 'Select a sound to see its waveform', 12 * dpr, H / 2 - 8 * dpr); c.dataset.drawn = '0'; return; }
    if (!this.peaks || this.peaks.id !== this.sel || this.peaks.W !== W) this.peaks = { id: this.sel, W, data: A.waveformPeaks(w.chans, W) };
    const P = this.peaks.data; let ink = 0;
    for (let x = 0; x < W; x++) {
      const lo = P[x * 2], hi = P[x * 2 + 1], clip = Math.max(-lo, hi) >= 0.999;
      g.strokeStyle = clip ? '#ff5a5a' : '#6cb6ff'; g.beginPath(); g.moveTo(x + 0.5, H / 2 - hi * (H / 2 - 4)); g.lineTo(x + 0.5, H / 2 - lo * (H / 2 - 4) + 1); g.stroke();
      if (hi - lo > 0.002) ink++;
    }
    c.dataset.drawn = String(ink);
    g.fillStyle = '#7d8794'; g.font = `${10 * dpr}px system-ui`;
    const dur = w.info.duration, step = dur > 20 ? 5 : dur > 6 ? 1 : dur > 2 ? 0.5 : 0.1;
    for (let t = 0; t < dur; t += step) { const x = (t / dur) * W; g.fillRect(x, H - 6 * dpr, 1, 6 * dpr); g.fillText(`${t.toFixed(step < 1 ? 1 : 0)}s`, x + 3, H - 8 * dpr); }
    if (this.preview) { const t = this.previewTime(); const x = ((t % dur) / dur) * W; g.fillStyle = '#ffd84a'; g.fillRect(x, 0, 2 * dpr, H); }
  }
  bindWave() {
    this.wave.addEventListener('pointerdown', (e) => {
      if (!this.cur?.info) return;
      const r = this.wave.getBoundingClientRect(); this.playFrom(((e.clientX - r.left) / r.width) * this.cur.info.duration);
    });
  }

  // ------------------------------------------------------------------ preview playback
  async ensureEngine() {
    if (!this.engine) this.engine = new AudioEngine(this.app);
    await this.engine.ac.resume().catch(() => {});
    return this.engine;
  }
  previewTime() { return this.preview ? this.engine.ac.currentTime - this.preview.t0 + this.preview.from : 0; }
  async playFrom(t = 0) {
    if (!this.sel || this.cur?.error) return;
    const e = await this.ensureEngine();
    this.stopPreview();
    const key = 'preview';
    const v = await e.playVoice(key, this.sel, { bus: 'sfx', loop: !!this.previewLoop, startAt: t, gain: 1, onEnd: () => { if (this.preview?.voice?.key === key) { this.preview = null; this.playBtn.textContent = '▶ Play'; this.drawWave(); } } });
    if (!v) { this.app.toast('That sound could not be played: ' + (e.stats.failed.at(-1)?.message || 'unknown error'), 'error'); return; }
    this.preview = { voice: v, t0: e.ac.currentTime, from: t }; this.playBtn.textContent = '■ Stop';
  }
  togglePreview() { if (this.preview) this.stopPreview(); else this.playFrom(0); }
  stopPreview() { if (this.preview) { this.engine?.stopVoice('preview', 0.03); this.preview = null; } this.playBtn.textContent = '▶ Play'; }

  // ------------------------------------------------------------------ map objects
  renderMapList() {
    const nodes = this.app.scene.all().filter((n) => AUDIO_TYPES.includes(n.type));
    const sel = new Set(this.app.selection);
    this.mapList.replaceChildren(...(nodes.length ? nodes.map((n) => {
      const p = propsOf(n);
      const tag = n.type === 'audioSource' ? p.bus : n.type === 'audioZone' ? p.kind : p.surface;
      return h('div', { class: 'tree-row' + (sel.has(n.id) ? ' sel primary' : ''), 'data-node': n.id, style: { position: 'relative', height: '28px' }, onclick: () => { this.app.select([n.id]); this.focusNode(n.id); } },
        h('span', { class: 'tree-icon', style: { background: '#c792ea', marginLeft: '8px' } }, TYPES[n.type].icon), h('span', { class: 'tree-name' }, n.name), h('span', { class: 'tree-tag' }, tag || ''));
    }) : [h('div', { class: 'empty' }, 'No audio objects. Add one with the buttons below, or from Create ▸ Audio.')]));
  }
  focusNode(id) { const w = this.app.scene.worldPosition(id); this.view.x = w.x; this.view.z = w.z; this.dirty = true; }
  addNode(type) {
    const L = this.listener, props = {};
    if (type === 'audioSource' || (type === 'audioZone' && this.sel)) { if (this.sel) props.asset = this.sel; }
    const n = this.app.createNode(type, { name: { audioSource: 'Audio source', audioZone: 'Audio zone', footstepZone: 'Footstep zone' }[type], p: [L.x, type === 'audioSource' ? 1.2 : 0, L.z], props });
    return n;
  }

  // ------------------------------------------------------------------ spatial preview
  scene() {
    const p = this.app.project, v = p.scene.version;
    if (this.cache.version !== v) {
      const audio = A.collectAudio(p);
      this.cache = { version: v, audio, world: new CollisionWorld(audio.colliders), bounds: sceneBounds(p.scene, p.geoCtx) };
      this.hearDirty = true;
    }
    return this.cache;
  }
  fit() {
    const { bounds } = this.scene(); const r = this.canvas.getBoundingClientRect();
    if (bounds && !bounds.isEmpty()) { const c = bounds.getCenter(new THREE.Vector3()), s = bounds.getSize(new THREE.Vector3()); this.view = { x: c.x, z: c.z, k: Math.max(2, Math.min(40, Math.min(r.width / (s.x + 6), r.height / (s.z + 6)))) }; }
    else this.view = { x: this.listener.x, z: this.listener.z, k: 14 };
    this.fitted = true; this.dirty = true;
  }
  resize() { const r = this.canvasBox.getBoundingClientRect(), d = window.devicePixelRatio || 1; this.d = d; this.canvas.width = Math.max(10, Math.floor(r.width * d)); this.canvas.height = Math.max(10, Math.floor(r.height * d)); if (!this.fitted && r.width > 50) this.fit(); this.dirty = true; this.drawWave(); }
  toScreen(x, z) { return [(x - this.view.x) * this.view.k * this.d + this.canvas.width / 2, (z - this.view.z) * this.view.k * this.d + this.canvas.height / 2]; }
  toWorld(cx, cy) { const r = this.canvas.getBoundingClientRect(); return [(cx - r.left - r.width / 2) / this.view.k + this.view.x, (cy - r.top - r.height / 2) / this.view.k + this.view.z]; }

  bindCanvas() {
    const c = this.canvas; let drag = null;
    c.addEventListener('pointerdown', (e) => {
      const [wx, wz] = this.toWorld(e.clientX, e.clientY), near = (x, z, px = 12) => Math.hypot(x - wx, z - wz) * this.view.k < px;
      if (e.button === 1 || e.button === 2 || e.altKey) { drag = { kind: 'pan', x: e.clientX, y: e.clientY, vx: this.view.x, vz: this.view.z }; c.setPointerCapture(e.pointerId); return; }
      if (near(this.listener.x, this.listener.z, 14)) { drag = { kind: 'listener' }; c.setPointerCapture(e.pointerId); return; }
      const { audio } = this.scene();
      const hit = audio.sources.find((s) => near(s.pos.x, s.pos.z)) || audio.zones.concat(audio.footZones).filter((z) => this.insideXZ(z, wx, wz)).sort((a, b) => a.volume - b.volume)[0];
      if (hit) { this.app.select([hit.id]); return; }
      this.listener.x = wx; this.listener.z = wz; this.hearDirty = this.dirty = true;               // click on empty space moves the listener there
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.kind === 'listener') { const [wx, wz] = this.toWorld(e.clientX, e.clientY); this.listener.x = wx; this.listener.z = wz; this.hearDirty = this.dirty = true; }
      else { this.view.x = drag.vx - (e.clientX - drag.x) / this.view.k; this.view.z = drag.vz - (e.clientY - drag.y) / this.view.k; this.dirty = true; }
    });
    c.addEventListener('pointerup', () => { drag = null; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.view.k = Math.max(1.5, Math.min(120, this.view.k * Math.exp(-e.deltaY * 0.0012))); this.dirty = true; }, { passive: false });
  }
  insideXZ(z, x, zz) { return A.zonesAt([z], new THREE.Vector3(x, z.c.aabb ? (z.c.aabb.min.y + z.c.aabb.max.y) / 2 : 1, zz)).inside.length > 0; }

  // ------------------------------------------------------------------ hearing table (core rules, same numbers the playtest uses)
  hearing() {
    const { audio, world } = this.scene(), s = this.settings(), L = this.listener, pos = new THREE.Vector3(L.x, L.y, L.z);
    const rows = audio.sources.map((src) => A.hearSource(src, pos, world, s));
    const zr = A.zonesAt(audio.zones, pos);
    const surf = A.surfaceAt(this.app.project, audio, world, { x: L.x, y: this.groundY(world, L), z: L.z });
    return { rows, zr, surf, reverb: A.reverbAt(this.app.project, zr) };
  }
  groundY(world, L) { const g = world.groundAt(L.x, L.z, 20, -20); return g ?? 0; }
  renderHearing() {
    const H = this.hearing(); this.last = H;
    const sel = new Set(this.app.selection);
    const t = h('table', { style: { width: '100%', borderCollapse: 'collapse' } }, h('thead', {}, h('tr', {}, ['Source', 'Bus', 'Distance', 'Wall blockers', 'Level at listener', 'State'].map((x) => h('th', { style: { textAlign: 'left', padding: '3px 8px', color: 'var(--faint)', fontWeight: 500 } }, x)))),
      h('tbody', {}, H.rows.length ? H.rows.map((r) => h('tr', { 'data-row': r.id, 'data-state': r.state, style: { background: sel.has(r.id) ? 'var(--sel)' : '', opacity: r.state === 'audible' ? 1 : 0.6 } },
        h('td', { style: { padding: '2px 8px' } }, r.name), h('td', { style: { padding: '2px 8px', color: BUS_COLORS[r.bus] } }, r.bus), h('td', { style: { padding: '2px 8px' } }, `${r.distance.toFixed(1)} m`), h('td', { style: { padding: '2px 8px' } }, r.blockers ? `${r.blockers} (${Math.round(r.cutoff)} Hz)` : '–'),
        h('td', { style: { padding: '2px 8px' }, 'data-db': r.db }, dbText(r.final)), h('td', { style: { padding: '2px 8px' } }, r.state))) : [h('tr', {}, h('td', { colSpan: 6, style: { padding: '8px', color: 'var(--faint)' } }, 'No audio sources in the map.'))]));
    this.hearBox.replaceChildren(t);
    const z = H.zr, nm = (x) => (x ? x.name : '—');
    this.legend.textContent = `Ambience: ${nm(z.ambience)}   ·   Music: ${nm(z.music)}   ·   Reverb: ${H.reverb}${z.reverb ? ` (zone ${z.reverb.name})` : ' (map default)'}   ·   Low-pass: ${z.muffle ? z.muffle.props.muffle + ' Hz (' + z.muffle.name + ')' : 'off'}   ·   Footsteps: ${H.surf.surface} (${H.surf.from})`;
    this.yawText.textContent = `${Math.round(this.listener.yaw)}°`;
    this.hearDirty = false;
  }

  frame(dt) {
    if (!this.live || !this.canvas.offsetParent) return;
    if (this.hearDirty) { try { this.renderHearing(); } catch (e) { this.legend.textContent = 'Hearing could not be computed: ' + e.message; this.hearDirty = false; } this.dirty = true; }
    if (this.listening && this.engine) {
      const { audio, world } = this.scene(), H = this.last || this.hearing();
      this.engine.update(dt, { pos: new THREE.Vector3(this.listener.x, this.listener.y, this.listener.z), yaw: this.listener.yaw, world, zones: H.zr, reverb: H.reverb });
      this.dirty = true;
      for (const [b, el] of Object.entries(this.meters || {})) el.firstChild.style.width = Math.min(100, this.engine.level(b) * 320) + '%';
      this.masterMeter.firstChild.style.width = Math.min(100, this.engine.level('master') * 320) + '%';
    }
    if (this.preview) this.drawWave();
    if (this.dirty) { this.dirty = false; this.drawSpatial(); }
  }

  drawSpatial() {
    const c = this.canvas, g = c.getContext('2d'); if (!c.width) return;
    const { audio, world } = this.scene(), k = this.view.k * this.d, H = this.last;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#12151a'; g.fillRect(0, 0, c.width, c.height);
    const poly = (col) => [[col.min[0], col.min[2]], [col.max[0], col.min[2]], [col.max[0], col.max[2]], [col.min[0], col.max[2]]].map(([x, z]) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(col.rt); return this.toScreen(v.x, v.z); });
    const path = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    for (const col of audio.colliders) {
      if (col.kind !== 'solid' && col.kind !== 'door') continue;
      const floor = col.walk && col.max[1] - col.min[1] < 0.5;
      g.fillStyle = col.kind === 'door' ? (world.doorOpen.get(col.doorId) ? '#8a6a4a55' : '#8a6a4a') : floor ? '#1d232c' : '#5b6574'; path(poly(col)); g.fill();
    }
    g.lineWidth = this.d; g.font = `${11 * this.d}px system-ui`; g.textAlign = 'center';
    for (const z of audio.zones) { const col = ZONE_COLORS[z.props.kind] || '#fff'; path(poly(z.c)); g.fillStyle = col + '22'; g.fill(); g.strokeStyle = col + (this.app.selection.includes(z.id) ? 'ff' : '88'); g.stroke(); const [x, y] = this.toScreen(...this.center(z.c)); g.fillStyle = col; g.fillText(`${z.name} (${z.props.kind})`, x, y); }
    g.setLineDash([4 * this.d, 4 * this.d]);
    for (const z of audio.footZones) { path(poly(z.c)); g.strokeStyle = '#a0a0ff99'; g.stroke(); const [x, y] = this.toScreen(...this.center(z.c)); g.fillStyle = '#a0a0ff'; g.fillText(`${z.props.surface}`, x, y); }
    g.setLineDash([]);
    const L = this.listener;
    const rows = new Map((H?.rows || []).map((r) => [r.id, r]));
    for (const s of audio.sources) {
      const [x, y] = this.toScreen(s.pos.x, s.pos.z), col = BUS_COLORS[s.props.bus] || '#fff', r = rows.get(s.id);
      if (this.showRanges) {
        g.strokeStyle = col + 'cc'; g.beginPath(); g.arc(x, y, s.props.refDistance * k, 0, Math.PI * 2); g.stroke();
        g.setLineDash([5 * this.d, 5 * this.d]); g.strokeStyle = col + '66'; g.beginPath(); g.arc(x, y, s.props.maxDistance * k, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        if (r && r.attenuation > 0) { const [lx, ly] = this.toScreen(L.x, L.z); g.strokeStyle = r.blockers === 0 ? '#5bd18b88' : r.blockers === 1 ? '#ffb34799' : '#ff5a5a99'; g.beginPath(); g.moveTo(lx, ly); g.lineTo(x, y); g.stroke(); }
      }
      g.fillStyle = r && r.audible ? col : col + '66'; g.beginPath(); g.arc(x, y, 6 * this.d, 0, Math.PI * 2); g.fill();
      if (this.app.selection.includes(s.id)) { g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 10 * this.d, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = '#d9dee6'; g.fillText(`${s.name}${r ? '  ' + dbText(r.final) : ''}`, x, y - 12 * this.d);
    }
    const [lx, ly] = this.toScreen(L.x, L.z), a = L.yaw * Math.PI / 180;
    g.fillStyle = this.listening ? '#4aa3ff' : '#4aa3ffaa'; g.beginPath(); g.arc(lx, ly, 7 * this.d, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx - Math.sin(a) * 16 * this.d, ly - Math.cos(a) * 16 * this.d); g.stroke();
    g.fillStyle = '#4aa3ff'; g.fillText(this.listening ? 'listener (live)' : 'listener', lx, ly + 20 * this.d);
  }
  center(c) { const v = new THREE.Vector3((c.min[0] + c.max[0]) / 2, 0, (c.min[2] + c.max[2]) / 2).applyMatrix4(c.rt); return [v.x, v.z]; }

  async toggleListen() {
    if (this.listening) { this.listening = false; this.engine?.stopAll(); this.engine && (this.engine.sourceState = null); this.listenBtn.textContent = '🎧 Listen'; this.listenBtn.classList.add('primary'); this.dirty = true; return; }
    const e = await this.ensureEngine();
    e.applySettings(this.settings(), true); e.loadScene(this.scene().audio);
    this.listening = true; this.listenBtn.textContent = '■ Stop listening'; this.listenBtn.classList.remove('primary'); this.dirty = true;
  }

  // ------------------------------------------------------------------ mixer
  mix(patch, label, mergeKey) {
    const app = this.app, cur = this.settings();
    const next = { ...(app.project.data.audio || {}), master: cur.master, buses: { ...cur.buses }, mute: { ...cur.mute }, solo: cur.solo, footsteps: cur.footsteps, reverbs: cur.reverbs, ...patch };
    app.exec(setData(['audio'], next, { label, mergeKey }));
  }
  buildMixer() {
    this.faders = {}; this.meters = {}; this.muteBtns = {}; this.soloBtns = {}; this.dbTexts = {};
    const row = (id, label, color, bus) => {
      const slider = h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, 'aria-label': `${label} volume`, style: { flex: 1 }, onInput: (e) => this.mix(bus ? { buses: { ...this.settings().buses, [id]: +e.target.value } } : { master: +e.target.value }, `${label} volume`, `audio.${id}`) });
      const db = h('span', { style: { width: '58px', textAlign: 'right', fontSize: '11px', color: 'var(--dim)' } });
      const meter = h('div', { style: { height: '6px', background: '#0006', borderRadius: '3px', overflow: 'hidden', marginTop: '3px' } }, h('div', { style: { height: '100%', width: '0%', background: color, transition: 'width .05s' } }));
      this.faders[id] = slider; this.dbTexts[id] = db; (id === 'master' ? (this.masterMeter = meter) : (this.meters[id] = meter));
      const btns = bus ? [(this.muteBtns[id] = h('button', { class: 'btn small', 'aria-label': `Mute ${label}`, title: 'Mute', onclick: () => { const s = this.settings(); this.mix({ mute: { ...s.mute, [id]: !s.mute[id] } }, `${s.mute[id] ? 'Unmute' : 'Mute'} ${label}`); } }, 'M')),
        (this.soloBtns[id] = h('button', { class: 'btn small', 'aria-label': `Solo ${label}`, title: 'Solo', onclick: () => { const s = this.settings(); this.mix({ solo: s.solo === id ? '' : id }, `Solo ${label}`); } }, 'S'))] : [];
      return h('div', { style: { padding: '6px 10px', borderBottom: '1px solid var(--line)' } }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('b', { style: { width: '78px', color } }, label), slider, db, btns), meter);
    };
    this.mixerBox.append(row('master', 'Master', '#e6e6e6', false), ...A.BUS_IDS.map((b) => row(b, b[0].toUpperCase() + b.slice(1), BUS_COLORS[b], true)),
      h('div', { class: 'hint', style: { padding: '8px 10px', color: 'var(--faint)', fontSize: '11px' } }, 'Faders go to +3.5 dB (150 %). M = mute, S = solo (silences every other bus). The same levels are used by the playtest. Meters move while you listen or preview.'));
  }
  syncMixer() {
    const s = this.settings(), lv = A.busLevels(s);
    const upd = (id, v, muted, soloed, dim) => { const f = this.faders[id]; if (document.activeElement !== f) f.value = v; this.dbTexts[id].textContent = muted ? 'muted' : dbText(v); if (this.muteBtns[id]) { this.muteBtns[id].classList.toggle('primary', muted); this.muteBtns[id].setAttribute('aria-pressed', String(muted)); this.soloBtns[id].classList.toggle('primary', soloed); this.soloBtns[id].setAttribute('aria-pressed', String(soloed)); } f.style.opacity = dim ? 0.45 : 1; };
    upd('master', s.master, false, false, false);
    for (const b of A.BUS_IDS) upd(b, s.buses[b], s.mute[b], s.solo === b, lv[b] === 0);
  }

  // ------------------------------------------------------------------ footsteps
  renderFootsteps() {
    const s = this.settings(), sounds = this.sounds(), name = (id) => this.app.assets.meta(id)?.name || id;
    this.stepsBox.replaceChildren(
      h('div', { class: 'hint', style: { padding: '8px 10px', color: 'var(--faint)', fontSize: '11px' } }, 'Which sounds play for each surface. The playtest picks one at random (never the same twice in a row). The surface comes from a footstep zone, else the floor’s “Footstep surface”, else its material.'),
      ...A.SURFACES.map((surface) => {
        const list = s.footsteps[surface] || [];
        const add = h('select', { 'aria-label': `Add sound to ${surface}`, class: 'tb-select', onchange: (e) => { if (e.target.value) this.mix({ footsteps: { ...s.footsteps, [surface]: [...list, e.target.value] } }, `Footstep sound (${surface})`); } },
          h('option', { value: '' }, '+ add'), ...sounds.map((m) => h('option', { value: m.id }, m.name || m.id)));
        return h('div', { 'data-surface': surface, style: { padding: '5px 10px', borderBottom: '1px solid var(--line)' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('b', { style: { width: '70px' } }, surface), add,
            h('button', { class: 'btn small', 'aria-label': `Play ${surface} footstep`, disabled: !list.length, onclick: () => this.testStep(surface) }, '▶ Test')),
          h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' } }, list.length ? list.map((id, i) => h('span', { class: 'chip', 'data-step': id }, name(id), h('button', { class: 'tree-btn', 'aria-label': `Remove ${name(id)}`, onclick: () => this.mix({ footsteps: { ...s.footsteps, [surface]: list.filter((_, k) => k !== i) } }, `Remove footstep (${surface})`) }, '×'))) : [h('span', { style: { color: 'var(--faint)', fontSize: '11px' } }, 'no sounds (silent)')]));
      }));
  }
  async testStep(surface) {
    const e = await this.ensureEngine(), id = A.pickFootstep(this.settings(), surface, Math.random, this.lastStep);
    this.lastStep = id; if (id) await e.playFootstep(id, surface);
  }

  // ------------------------------------------------------------------ reverb
  renderReverb() {
    const s = this.settings(), preset = this.reverbPreset && A.REVERB_PRESETS[this.reverbPreset] ? this.reverbPreset : 'room', p = A.reverbParams(s, preset), overridden = !!s.reverbs[preset];
    const sel = h('select', { 'aria-label': 'Reverb preset', class: 'tb-select', onchange: (e) => { this.reverbPreset = e.target.value; this.renderReverb(); } }, Object.keys(A.REVERB_PRESETS).filter((k) => k !== 'none').map((k) => h('option', { value: k, selected: k === preset }, k)));
    const set = (key) => (v) => this.mix({ reverbs: { ...s.reverbs, [preset]: { ...(s.reverbs[preset] || {}), [key]: v } } }, `Reverb ${preset}: ${key}`, `audio.rev.${preset}.${key}`);
    this.reverbBox.replaceChildren(
      h('div', { class: 'hint', style: { padding: '8px 10px', color: 'var(--faint)', fontSize: '11px' } }, 'The reverb is generated from these numbers (decay time, pre-delay, send level, brightness), the same way in the editor and in the playtest. Audio zones choose a preset by name; changes here apply to every zone that uses it.'),
      h('div', { style: { padding: '6px 10px', display: 'flex', gap: '8px', alignItems: 'center' } }, h('b', {}, 'Preset'), sel, h('span', { class: 'chip' + (overridden ? ' warn' : '') }, overridden ? 'modified' : 'default'), button('Reset', () => { const next = { ...s.reverbs }; delete next[preset]; this.mix({ reverbs: next }, `Reset reverb ${preset}`); }), button('▶ Preview', () => this.previewReverb(preset), { primary: true, title: 'Plays the selected sound through this reverb' })),
      h('div', { class: 'insp', style: { padding: '0 10px 10px' } },
        numberField('Decay time', { value: p.decay, step: 0.1, min: 0.05, max: 12, unit: 's', hint: 'Time for the tail to fall 60 dB.', onChange: set('decay') }).el,
        numberField('Pre-delay', { value: p.predelay, step: 0.005, min: 0, max: 0.5, unit: 's', onChange: set('predelay') }).el,
        numberField('Reverb level', { value: p.wet, step: 0.05, min: 0, max: 1, hint: 'How loud the tail is relative to the direct sound.', onChange: set('wet') }).el,
        numberField('Brightness cutoff', { value: p.damp, step: 100, min: 500, max: 20000, unit: 'Hz', hint: 'Lower = a darker, more muffled tail.', onChange: set('damp') }).el));
  }
  async previewReverb(preset) {
    if (!this.sel) { this.app.toast('Select a sound on the left first.', 'info'); return; }
    const e = await this.ensureEngine(); e.applySettings(this.settings(), true); e.setReverb(preset, true);
    setTimeout(() => e.playVoice('reverb-preview', this.sel, { bus: 'sfx', send: 1, gain: 0.8 }), 200);
  }
}

export default {
  id: 'audio', label: 'Audio', fill: true,
  create(app, el) { const w = new AudioWorkspace(app, el); app.audioWs = w; return w; },
};

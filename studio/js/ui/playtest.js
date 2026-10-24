// Playtest session: first-person walk-through of the open map inside the editor viewport.
// Rendering/input live here; all game rules live in core/playtest.js. The scene model is never edited (sequences restore what they touch).
import { h } from './dom.js';
import * as THREE from '../../lib/three.module.js';
import { PlaytestWorld } from '../core/playtest.js';
import { SceneSequenceHost } from '../core/seqhost.js';
import { modal, KEEP_OPEN } from './dialogs.js';
import { playOneShot } from './audioctx.js';
import { PLAYER_REFERENCE } from '../core/game-constants.js';

const D2R = Math.PI / 180;
const FOV = 75;

export class PlaytestSession {
  constructor(app, { spawn = null, from = null } = {}) {
    this.app = app; this.vp = app.viewport;
    this.opts = { spawn, from };
    this.keys = new Set();
    this.look = { dx: 0, dy: 0 };
    this.useQueued = false;
    this.paused = false; this.frozen = false; this.debug = false; this.flashlightOn = true;
    this.lockedAt = 0;
    this.seq = null; this.seqPlayer = null; this.restoreStack = [];
    this.fps = 0; this._ft = 0; this._fc = 0;
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    const app = this.app, vp = this.vp;
    if (app.playtest) throw new Error('A playtest is already running.');
    app.previewing?.end();
    this.saved = { helpers: vp.sceneView.helpersVisible, shading: vp.shading, grid: vp.grid.visible, overlays: { ...vp.overlays.on }, tool: vp.tool?.id, projection: vp.projection };
    this.sceneBefore = JSON.stringify(app.scene.toJSON());
    app.shell.show('scene');
    this.world = new PlaytestWorld(app.project, { spawn: this.opts.spawn, from: this.opts.from });
    app.playtest = this;
    window.__playtest = this;
    // viewport -> play mode
    if (vp.projection !== 'persp') vp.setProjection('persp');
    vp.setShading('game');
    vp.sceneView.setHelpersVisible(false);
    vp.grid.visible = false;
    for (const k of Object.keys(vp.overlays.on)) if (vp.overlays.on[k]) vp.overlays.set(k, false);
    vp.gizmo.helper.visible = false; vp.gizmo.tc.enabled = false;
    vp.sceneView.setHover(null);
    this.flash = new THREE.SpotLight(0xfff2d8, 55, 22, 0.42, 0.45, 1.6);
    vp.scene.add(this.flash, this.flash.target);
    this.buildHud();
    this.bind();
    this.syncVisuals(true);
    vp.tickers.add(this.tick = (dt) => this.update(dt));
    vp.requestRender();
    app.log('info', `Playtest started${this.opts.from ? ' from the editor camera' : ''}. Esc pauses.`);
    app.emit('playtest', true);
    this.requestLock();
    return this;
  }

  stop(reason = 'stopped') {
    const app = this.app, vp = this.vp;
    if (!app.playtest) return;
    this.seqPlayer?.cancel();
    // objects a cutscene moved stay moved during play (like the game) but must go back when the playtest ends
    for (const { host, snap } of this.restoreStack.reverse()) host.restore(snap);
    this.restoreStack = [];
    vp.tickers.delete(this.tick);
    this.unbind();
    this.hud.remove();
    vp.scene.remove(this.flash, this.flash.target); this.flash.dispose?.();
    vp.setCameraOverride(null, null); vp.setFx(null);
    vp.rig.groupState = null; vp.rig.forceUpdate = true;
    // doors and pickups back to their authored look
    for (const d of this.world.doors.values()) vp.sceneView.entryOf(d.node.id)?.setOpen?.(d.node.props.state === 'open' ? 1 : 0);
    vp.sceneView.setHelpersVisible(this.saved.helpers);
    vp.grid.visible = this.saved.grid;
    vp.setShading(this.saved.shading);
    for (const [k, v] of Object.entries(this.saved.overlays)) if (v) vp.overlays.set(k, true);
    vp.sceneView.rebuild(); vp.onSelection();
    if (document.pointerLockElement === vp.canvas) document.exitPointerLock();
    app.playtest = null; window.__playtest = null;
    const after = JSON.stringify(app.scene.toJSON());
    if (after !== this.sceneBefore) app.log('error', 'The playtest left the scene different from how it found it. Please report this as a bug.'); else app.log('ok', 'Playtest ended; the map was not modified.');
    app.emit('playtest', false);
    vp.requestRender();
  }

  // ------------------------------------------------------------------ input
  bind() {
    const c = this.vp.canvas;
    this.onKeyDown = (e) => {
      if (e.target.closest?.('.modal')) return;
      this.keys.add(e.code);
      if (e.code === 'Escape') { e.preventDefault(); this.onEscape(); return; }
      if (this.paused) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyE' && !e.repeat) this.useQueued = true;
      if (e.code === 'KeyF' && !e.repeat) { this.flashlightOn = !this.flashlightOn; this.flash.visible = this.flashlightOn; }
      if (e.code === 'F3') { e.preventDefault(); this.debug = !this.debug; this.hud.querySelector('.pt-debug').style.display = this.debug ? 'block' : 'none'; }
      if (e.code === 'KeyR' && !e.repeat && e.shiftKey) { this.world.restoreCheckpoint(); }
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    this.onMouseMove = (e) => {
      const locked = document.pointerLockElement === c;
      if (!locked && !this.dragLook) return;
      if (performance.now() - this.lockedAt < 250) return;              // Chrome can report one huge bogus delta right after locking
      const dx = e.movementX, dy = e.movementY;
      if (Math.abs(dx) > 220 || Math.abs(dy) > 220) return;
      this.look.dx += dx * 0.0022; this.look.dy += dy * 0.0022;
    };
    this.onLockChange = () => { this.lockedAt = performance.now(); if (document.pointerLockElement !== c && this.app.playtest && !this.paused && !this.modalOpen) this.pause(); };
    this.onDown = (e) => { if (e.button === 0 && !this.paused) { if (document.pointerLockElement !== c) { this.requestLock(); this.dragLook = true; } } };
    this.onUp = () => { this.dragLook = false; };
    window.addEventListener('keydown', this.onKeyDown, true); window.addEventListener('keyup', this.onKeyUp, true); window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove); document.addEventListener('pointerlockchange', this.onLockChange);
    c.addEventListener('pointerdown', this.onDown); window.addEventListener('pointerup', this.onUp);
  }
  unbind() {
    window.removeEventListener('keydown', this.onKeyDown, true); window.removeEventListener('keyup', this.onKeyUp, true); window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove); document.removeEventListener('pointerlockchange', this.onLockChange);
    this.vp.canvas.removeEventListener('pointerdown', this.onDown); window.removeEventListener('pointerup', this.onUp);
  }
  requestLock() { try { const r = this.vp.canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* not available: drag to look instead */ } }

  onEscape() {
    if (this.frozen && this.seqPlayer?.skip()) return;                 // Esc skips a skippable cutscene instead of pausing
    if (this.paused) this.resume(); else this.pause();
  }
  pause() { if (this.paused) return; this.paused = true; if (document.pointerLockElement === this.vp.canvas) document.exitPointerLock(); this.pauseEl.style.display = 'flex'; this.keys.clear(); }
  resume() { this.paused = false; this.pauseEl.style.display = 'none'; this.requestLock(); }

  // ------------------------------------------------------------------ HUD
  buildHud() {
    const mk = (cls, txt = '') => h('div', { class: cls }, txt);
    this.promptEl = mk('pt-prompt'); this.msgEl = mk('pt-msgs'); this.objEl = mk('pt-objective'); this.dbgEl = mk('pt-debug');
    this.pauseEl = h('div', { class: 'pt-pause', style: { display: 'none' } }, h('div', { class: 'pt-menu', role: 'dialog', 'aria-label': 'Playtest paused' }, h('h3', {}, 'Playtest paused'),
      h('button', { class: 'btn primary', onclick: () => this.resume() }, 'Resume'),
      h('button', { class: 'btn', onclick: () => { this.world.restoreCheckpoint(); this.resume(); } }, 'Restart from last checkpoint'),
      h('button', { class: 'btn', onclick: () => this.restart() }, 'Restart from the beginning'),
      h('button', { class: 'btn danger', onclick: () => this.stop() }, 'Stop playtest'),
      h('div', { class: 'pt-help' }, 'WASD move · Shift sprint · C crouch · E use · F flashlight · Arrow keys also look · F3 debug · Esc pause')));
    this.hud = h('div', { class: 'pt-hud' }, h('div', { class: 'pt-cross' }), this.promptEl, this.msgEl, this.objEl, this.dbgEl, this.pauseEl);
    this.dbgEl.style.display = 'none';
    this.vp.container.appendChild(this.hud);
  }
  restart() { const opts = this.opts; this.stop(); setTimeout(() => new PlaytestSession(this.app, opts).start(), 30); }

  // ------------------------------------------------------------------ frame
  update(dt) {
    dt = Math.min(dt, 0.25);
    const w = this.world, vp = this.vp;
    this._fc++; this._ft += dt; if (this._ft >= 0.5) { this.fps = this._fc / this._ft; this._fc = 0; this._ft = 0; this.refreshDebug(); }
    if (!this.paused) {
      if (this.seqPlayer) { this.seqPlayer.update(dt); }
      const k = this.keys, frozen = this.frozen;
      const input = {
        mx: frozen ? 0 : (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0), my: frozen ? 0 : (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
        sprint: k.has('ShiftLeft') || k.has('ShiftRight'), crouch: k.has('KeyC') || k.has('ControlLeft'),
        lookDX: frozen ? 0 : this.look.dx + ((k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)) * 1.8 * dt,
        lookDY: frozen ? 0 : this.look.dy + ((k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)) * 1.4 * dt,
        use: this.useQueued && !frozen,
      };
      this.look.dx = this.look.dy = 0; this.useQueued = false;
      // fixed sub-steps keep movement and collision stable (and game time close to real time) when the frame rate is low
      const n = Math.max(1, Math.ceil(dt / 0.05));
      let res = null;
      for (let i = 0; i < n; i++) {
        const sub = { ...input, lookDX: i === 0 ? input.lookDX : 0, lookDY: i === 0 ? input.lookDY : 0, use: i === 0 && input.use };
        const r = w.step(dt / n, sub); if (r) res = r;
      }
      if (res?.needsCode) this.askCode(res.door);
      while (w.sequenceRequests.length) this.playSequence(w.sequenceRequests.shift());
    }
    this.syncVisuals();
    this.renderHud();
    return true;
  }

  syncVisuals(first = false) {
    const w = this.world, vp = this.vp, P = w.player;
    const eye = w.eye();
    const st = this.seqState;
    const cam = st?.camera ? { p: st.camera.p, r: st.camera.r, fov: st.camera.fov } : { p: eye.toArray(), r: [P.yaw, P.pitch, 0], fov: FOV };
    vp.setCameraOverride(cam, st || { fovDelta: 0 }, { letterbox: !!st?.camera });
    const dir = w.lookDir();
    this.flash.position.copy(eye); this.flash.target.position.copy(eye).add(dir); this.flash.visible = this.flashlightOn;
    vp.rig.groupState = w.lights; vp.rig.forceUpdate = true;
    for (const d of w.doors.values()) { const e = vp.sceneView.entryOf(d.node.id); if (e?.setOpen && (first || e._amount !== d.amount)) { e.setOpen(d.amount); e._amount = d.amount; } }
    for (const it of w.interactions) if (it.node.type === 'itemSpawn') { const e = vp.sceneView.entryOf(it.node.id); if (e) e.helpers.visible = !w.used.has(it.node.id); }
  }

  renderHud() {
    const w = this.world;
    const f = this.paused || this.frozen ? null : w.focus();
    this.promptEl.textContent = f ? `E — ${f.label}` : '';
    this.msgEl.replaceChildren(...w.messages.slice(-4).map((m) => h('div', {}, m.text)));
    this.objEl.textContent = w.objective ? `Objective: ${w.objective}` : '';
  }
  refreshDebug() {
    if (!this.debug) return;
    const w = this.world, P = w.player, r = w.runtime;
    this.dbgEl.innerHTML = '';
    const row = (a, b) => this.dbgEl.append(h('div', {}, h('b', {}, a + ' '), String(b)));
    row('fps', this.fps.toFixed(0)); row('pos', `${P.x.toFixed(2)}, ${P.y.toFixed(2)}, ${P.z.toFixed(2)}`); row('yaw/pitch', `${P.yaw.toFixed(0)}° / ${P.pitch.toFixed(0)}°`);
    row('time', w.time.toFixed(1) + ' s'); row('flags', JSON.stringify(r.state.flags)); row('inventory', JSON.stringify(w.inventory));
    row('doors', [...w.doors.values()].map((d) => `${d.id}:${d.open ? 'open' : d.locked ? 'locked(' + d.locked + ')' : 'closed'}`).join(' ')); row('lights', JSON.stringify(w.lights));
    row('inside', w.volumes.filter((v) => v.inside).map((v) => v.node.name).join(', ') || '—'); row('last events', r.effects.filter((e) => e.type === 'event').slice(-4).map((e) => e.name).join(', ') || '—');
    row('checkpoint', w.checkpointSnap?.id || '—');
  }

  askCode(door) {
    this.modalOpen = true; this.keys.clear();
    if (document.pointerLockElement === this.vp.canvas) document.exitPointerLock();
    const input = h('input', { type: 'text', inputmode: 'numeric', maxlength: 8, 'aria-label': 'Door code', style: { width: '100%', fontSize: '22px', textAlign: 'center', letterSpacing: '.4em', padding: '8px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '6px' } });
    modal({ title: 'Keypad', width: 320, body: h('div', {}, h('div', { style: { color: 'var(--dim)', marginBottom: '8px' } }, `Door “${door.id}” needs a code.`), input), buttons: [{ label: 'Cancel', value: undefined }, { label: 'Enter', value: () => input.value, primary: true }] })
      .then((code) => { this.modalOpen = false; if (code) this.world.useDoor(door, { code }); this.requestLock(); });
  }

  // ------------------------------------------------------------------ cutscenes
  playSequence(id) {
    const seqs = this.app.project.data.sequences;
    const seq = seqs[id] || Object.values(seqs).find((s) => s.name === id);
    if (!seq) { this.world.message(`(sequence “${id}” does not exist)`); return; }
    if (this.seqPlayer?.playing) this.seqPlayer.cancel();
    const host = new SceneSequenceHost({ scene: this.app.scene, seq, hooks: {
      camera: (cam, s) => { this.seqState = cam || s?.fovDelta || s?.shake ? s : null; },
      overlay: (s) => this.vp.setFx(s),
      audio: (c) => { if (c.asset) playOneShot(this.app, c.asset, { volume: c.volume }).catch(() => {}); },
      event: (name) => this.world.runtime.emit(name),
      begin: () => { this.frozen = true; }, end: () => { this.frozen = false; this.seqState = null; this.seqPlayer = null; },
    } });
    this.seqPlayer = host.player({ reduceFlashing: seq.reduceFlashing }).start();
    this.restoreStack.push({ host, snap: this.seqPlayer.snapshot });
    this.world.runtime.state.flags['seq:' + seq.name] = 'playing';
  }
}

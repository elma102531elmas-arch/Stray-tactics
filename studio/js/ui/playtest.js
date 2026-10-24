// Playtest session: first-person walk-through of the open map inside the editor viewport.
// Rendering/input live here; all game rules live in core/playtest.js. The scene model is never edited (sequences restore what they touch).
import { h } from './dom.js';
import * as THREE from '../../lib/three.module.js';
import { PlaytestWorld } from '../core/playtest.js';
import { SceneSequenceHost } from '../core/seqhost.js';
import { modal, KEEP_OPEN } from './dialogs.js';
import { playOneShot } from './audioctx.js';
import { AudioEngine } from './audioengine.js';
import { gameMethods } from '../core/scriptapi.js';
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
    this.seq = null; this.seqPlayer = null; this.restoreStack = []; this.fireHeld = false; this.fireQueued = false; this.adsHeld = false; this.reloadQueued = false; this.weaponWanted = undefined; this.enemyViews = new Map(); this.flashT = 0;
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
    this.muzzle = new THREE.PointLight(0xffd9a0, 0, 9, 2); vp.scene.add(this.muzzle);
    this.buildHud();
    this.buildEnemies();
    this.startAudio();
    this.checkScripts();
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
    this.audio?.dispose(); this.audio = null;
    this.unbind();
    this.hud.remove();
    vp.scene.remove(this.flash, this.flash.target, this.muzzle); this.flash.dispose?.();
    for (const v of this.enemyViews.values()) { vp.scene.remove(v.group); v.group.traverse((o) => { o.geometry?.dispose?.(); }); }
    this.enemyViews.clear(); if (this.dbgLines) { vp.scene.remove(this.dbgLines); this.dbgLines = null; }
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

  // ------------------------------------------------------------------ scripts ("Run plugin script" nodes): sandboxed, approved ones only
  checkScripts() {
    const used = new Set();
    for (const g of Object.values(this.app.project.data.events?.graphs || {})) for (const n of g.nodes) if (n.type === 'act.script' && n.data?.script) used.add(n.data.script);
    this.scriptRuns = {};
    (async () => {
      const bad = [];
      for (const id of used) { const rec = this.app.plugins?.find('script', id); if (!rec) { bad.push(`“${id}” (missing)`); continue; } const st = await this.app.plugins.status(rec); if (st.state !== 'approved') bad.push(`“${rec.name}”`); }
      if (bad.length && this.app.playtest === this) { this.world.message(`Scripts not approved, so they will not run: ${bad.join(', ')}. Review them in the Plugins tab.`, 6); this.app.log('warn', `Playtest: these scripts will not run until you approve them (Plugins tab): ${bad.join(', ')}`); }
    })();
  }
  async pumpScripts() {
    const w = this.world;
    if (this.scriptBusy || !w.scriptRequests.length || !this.app.plugins) return;
    const req = w.scriptRequests.shift(); this.scriptBusy = true;
    try {
      const rec = this.app.plugins.find('script', req.id);
      if (!rec) { w.message(`(script “${req.id}” does not exist)`, 3); return; }
      const now = performance.now(), runs = (this.scriptRuns[rec.id] = (this.scriptRuns[rec.id] || []).filter((t) => now - t < 10000));
      if (runs.length >= 30) { if (!this.scriptSpam?.[rec.id]) { (this.scriptSpam ||= {})[rec.id] = true; w.message(`(script “${rec.name}” runs too often and was throttled)`, 4); } return; }
      runs.push(now);
      const r = await this.app.plugins.runScript(rec, { ctx: { script: rec.name, event: req.event }, methods: gameMethods(w) });
      if (!r.ok && this.app.playtest === this) w.message(`(script “${rec.name}” ${r.skipped ? 'was not run: not approved' : 'failed'} — see the Plugins console)`, 4);
    } finally { this.scriptBusy = false; }
  }

  // ------------------------------------------------------------------ audio (rules: core/audio.js, nodes: audioengine.js)
  startAudio() {
    try {
      this.audio = new AudioEngine(this.app);
      this.audio.ac.resume?.().catch(() => {});
      this.audio.loadScene(this.world.audio);
      this.audio.setReverb(this.world.reverbPreset);
    } catch (e) { this.audio = null; this.app.log('warn', 'Playtest audio is unavailable: ' + e.message); }
  }
  tickAudio(dt) {
    const a = this.audio, w = this.world; if (!a) return;
    for (const ev of w.audioEvents.splice(0)) {
      if (ev.type === 'footstep') { if (ev.sound) a.playFootstep(ev.sound, ev.surface).catch(() => {}); }
      else if (ev.type === 'sound') { const n = ev.at && (w.scene.get(ev.at) || w.scene.byName(ev.at)); a.playOneShot(ev.asset, { volume: ev.volume, at: n ? w.scene.worldPosition(n.id) : null }).catch(() => {}); }
      else if (ev.type === 'event') a.fireEvent(ev.name);
    }
    a.update(dt, { pos: w.eye(), yaw: w.player.yaw, world: w.world, zones: w.audioZones, reverb: w.reverbPreset, isEnabled: (n) => w.isEnabled(n, true) });
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
      if (e.code === 'KeyR' && !e.repeat) { if (e.shiftKey) { if (!this.world.restoreCheckpoint()) this.world.message('No checkpoint saved yet.', 2); } else this.reloadQueued = true; }
      if (/^Digit[1-9]$/.test(e.code) && !e.repeat) this.weaponWanted = parseInt(e.code.slice(5), 10) - 1;
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
    this.onLockChange = () => { this.lockedAt = performance.now(); if (document.pointerLockElement !== c && this.app.playtest && !this.paused && !this.modalOpen && !this.world.dead) this.pause(); };
    this.onDown = (e) => {
      if (this.paused) return;
      if (e.button === 0) {
        const locked = document.pointerLockElement === c;
        if (!locked) { if (!this.noLock) this.requestLock(); this.dragLook = true; }      // first click captures the mouse; drag to look if the browser refuses
        if (locked || this.noLock) { this.fireHeld = true; this.fireQueued = true; }       // without pointer lock (denied / unsupported) a click fires straight away
      }
      if (e.button === 2) this.adsHeld = true;
    };
    this.onLockError = () => { this.noLock = true; };
    this.onUp = (e) => { this.dragLook = false; if (e?.button === 0) this.fireHeld = false; if (e?.button === 2) this.adsHeld = false; };
    this.onCtx = (e) => e.preventDefault();
    this.onWheel = (e) => { if (this.paused || !this.world.weapons.length) return; const n = this.world.weapons.length; this.weaponWanted = (this.world.weaponIndex + (e.deltaY > 0 ? 1 : n - 1)) % n; };
    window.addEventListener('keydown', this.onKeyDown, true); window.addEventListener('keyup', this.onKeyUp, true); window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove); document.addEventListener('pointerlockchange', this.onLockChange); document.addEventListener('pointerlockerror', this.onLockError);
    c.addEventListener('pointerdown', this.onDown); window.addEventListener('pointerup', this.onUp); c.addEventListener('contextmenu', this.onCtx); c.addEventListener('wheel', this.onWheel, { passive: true });
  }
  unbind() {
    window.removeEventListener('keydown', this.onKeyDown, true); window.removeEventListener('keyup', this.onKeyUp, true); window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove); document.removeEventListener('pointerlockchange', this.onLockChange); document.removeEventListener('pointerlockerror', this.onLockError);
    this.vp.canvas.removeEventListener('pointerdown', this.onDown); window.removeEventListener('pointerup', this.onUp); this.vp.canvas.removeEventListener('contextmenu', this.onCtx); this.vp.canvas.removeEventListener('wheel', this.onWheel);
  }
  requestLock() { try { const r = this.vp.canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* not available: drag to look instead */ } }

  onEscape() {
    if (this.world.dead) return;                                      // the death screen has its own buttons
    if (this.frozen && this.seqPlayer?.skip()) return;                 // Esc skips a skippable cutscene instead of pausing
    if (this.paused) this.resume(); else this.pause();
  }
  pause() { if (this.paused) return; this.paused = true; this.audio?.ac.suspend().catch(() => {}); if (document.pointerLockElement === this.vp.canvas) document.exitPointerLock(); this.pauseEl.style.display = 'flex'; this.keys.clear(); }
  resume() { this.paused = false; this.audio?.ac.resume().catch(() => {}); this.pauseEl.style.display = 'none'; this.requestLock(); }

  // ------------------------------------------------------------------ HUD
  buildHud() {
    const mk = (cls, txt = '') => h('div', { class: cls }, txt);
    this.promptEl = mk('pt-prompt'); this.msgEl = mk('pt-msgs'); this.objEl = mk('pt-objective'); this.dbgEl = mk('pt-debug'); this.wpnEl = mk('pt-weapon'); this.hpEl = mk('pt-hp');
    this.deadEl = h('div', { class: 'pt-pause pt-dead', style: { display: 'none' } }, h('div', { class: 'pt-menu' }, h('h3', {}, 'You died'), (this.deadBtn = h('button', { class: 'btn primary', onclick: () => { if (this.world.restoreCheckpoint()) this.deadEl.remove(); else this.restart(); } }, 'Restart')), h('button', { class: 'btn', onclick: () => this.restart() }, 'Restart from the beginning'), h('button', { class: 'btn danger', onclick: () => this.stop() }, 'Stop playtest')));
    this.pauseEl = h('div', { class: 'pt-pause', style: { display: 'none' } }, h('div', { class: 'pt-menu', role: 'dialog', 'aria-label': 'Playtest paused' }, h('h3', {}, 'Playtest paused'),
      h('button', { class: 'btn primary', onclick: () => this.resume() }, 'Resume'),
      h('button', { class: 'btn', onclick: () => { if (this.world.restoreCheckpoint()) this.resume(); else this.world.message('No checkpoint saved yet.', 2); } }, 'Restart from last checkpoint'),
      h('button', { class: 'btn', onclick: () => this.restart() }, 'Restart from the beginning'),
      h('button', { class: 'btn danger', onclick: () => this.stop() }, 'Stop playtest'),
      h('div', { class: 'pt-help' }, 'WASD move · Shift sprint · C crouch · E use · F flashlight · LMB fire · RMB aim · R reload · 1–9 / wheel weapon · Arrow keys also look · F3 debug · Esc pause')));
    this.hud = h('div', { class: 'pt-hud' }, h('div', { class: 'pt-cross' }), this.promptEl, this.msgEl, this.objEl, this.dbgEl, this.wpnEl, this.hpEl, this.pauseEl);
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
        fire: !frozen && (this.fireQueued || (this.fireHeld && !!w.weapon?.def.automatic)), fireHeld: this.fireHeld && !this.fireQueued, ads: !frozen && this.adsHeld, reload: this.reloadQueued && !frozen, weapon: this.weaponWanted,
      };
      const fired = input.fire; this.look.dx = this.look.dy = 0; this.useQueued = false; this.fireQueued = false; this.reloadQueued = false; this.weaponWanted = undefined;
      // fixed sub-steps keep movement and collision stable (and game time close to real time) when the frame rate is low
      const n = Math.max(1, Math.ceil(dt / 0.05));
      let res = null;
      for (let i = 0; i < n; i++) {
        const sub = { ...input, lookDX: i === 0 ? input.lookDX : 0, lookDY: i === 0 ? input.lookDY : 0, use: i === 0 && input.use, fire: i === 0 && input.fire, reload: i === 0 && input.reload, weapon: i === 0 ? input.weapon : undefined };
        const r = w.step(dt / n, sub); if (r) res = r;
      }
      if (res?.needsCode) this.askCode(res.door);
      if (fired && w.shotLog.length && w.shotLog.at(-1).t >= w.time - 0.3) this.flashT = 0.06;
      while (w.sequenceRequests.length) this.playSequence(w.sequenceRequests.shift());
      this.tickAudio(dt);
      this.pumpScripts();
    }
    this.syncVisuals();
    this.renderHud();
    return true;
  }

  buildEnemies() {
    const vp = this.vp, ai = this.world.ai;
    if (!ai) return;
    for (const r of ai.agents) {
      const a = r.agent, g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(a.def.radius, Math.max(0.1, a.def.height - 2 * a.def.radius), 6, 12), new THREE.MeshStandardMaterial({ color: a.def.invulnerable ? 0x2a2a3a : 0x7a1f1f, roughness: 0.8 }));
      body.position.y = a.def.height / 2; body.castShadow = true;
      const eyes = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9b0 }));
      const e2 = eyes.clone(); eyes.position.set(-0.08, a.def.height * 0.9, -a.def.radius * 0.9); e2.position.set(0.08, a.def.height * 0.9, -a.def.radius * 0.9);
      g.add(body, eyes, e2); g.userData.proxy = true;
      vp.scene.add(g);
      this.enemyViews.set(a, { group: g, body, rec: r });
      if (a.def.model) this.app.assets.instantiate(a.def.model).then(({ object }) => { if (!this.enemyViews.has(a)) return; g.remove(body, eyes, e2); g.add(object); }).catch(() => { /* keep the proxy capsule */ });
    }
  }

  syncEnemies() {
    const D = Math.PI / 180;
    for (const [a, v] of this.enemyViews) {
      const rec = v.rec;
      v.group.visible = rec.active || a.behavior === 'dormant' && !rec.spawnOn;
      v.group.position.copy(a.pos); v.group.rotation.y = a.yaw * D;
      if (!a.alive) { v.group.rotation.x = -Math.PI / 2 * 0.98; v.group.position.y += a.def.radius; if (v.body.material) v.body.material.color?.set(0x303030); }
      else if (v.body.material?.color) v.body.material.color.set(a.def.invulnerable ? 0x2a2a3a : (a.behavior === 'chase' || a.behavior === 'attack') ? 0xb02020 : 0x7a1f1f);
    }
    // debug overlay: sight cones and paths
    if (this.debug) {
      if (!this.dbgLines) { this.dbgLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd84a })); this.dbgLines.frustumCulled = false; this.vp.scene.add(this.dbgLines); }
      const pts = [];
      for (const [a] of this.enemyViews) {
        if (!a.alive) continue;
        const v = a.params.vision, half = ((a.behavior === 'chase' || a.behavior === 'attack') ? v.chaseHalfAngleDeg : v.halfAngleDeg) * D, base = a.pos.clone().add(new THREE.Vector3(0, 0.1, 0));
        for (const sgn of [-1, 1]) { const ang = a.yaw * D + sgn * Math.min(half, Math.PI); pts.push(base.x, base.y, base.z, base.x - Math.sin(ang) * v.range, base.y, base.z - Math.cos(ang) * v.range); }
        if (a.path) { let prev = base; for (let i = a.pathIndex; i < a.path.length; i++) { pts.push(prev.x, prev.y, prev.z, a.path[i].x, a.path[i].y + 0.1, a.path[i].z); prev = a.path[i]; } }
      }
      this.dbgLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); this.dbgLines.visible = true;
    } else if (this.dbgLines) this.dbgLines.visible = false;
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
    this.syncEnemies();
    this.flashT = Math.max(0, this.flashT - 0.016); this.muzzle.intensity = this.flashT > 0 ? 40 : 0; this.muzzle.position.copy(eye).addScaledVector(dir, 0.8);
    for (const it of w.interactions) if (it.node.type === 'itemSpawn') { const e = vp.sceneView.entryOf(it.node.id); if (e) e.helpers.visible = !w.used.has(it.node.id); }
  }

  renderHud() {
    const w = this.world;
    const f = this.paused || this.frozen ? null : w.focus();
    this.promptEl.textContent = f ? `E — ${f.label}` : '';
    this.msgEl.replaceChildren(...w.messages.slice(-4).map((m) => h('div', {}, m.text)));
    this.objEl.textContent = w.objective ? `Objective: ${w.objective}` : '';
    const W = w.weapon;
    this.wpnEl.textContent = W ? `${W.def.name.replace(' (game reference)', '')}${W.def.kind === 'gun' ? `   ${W.mag} / ${W.reserve}${W.state === 'reloading' ? '   reloading…' : ''}` : ''}` : '';
    this.hpEl.textContent = `HP ${Math.ceil(w.player.hp)}`;
    if (w.dead && !this.deadEl.isConnected) { this.deadEl.style.display = 'flex'; this.hud.insertBefore(this.deadEl, this.pauseEl); }      // only in the DOM while dead
    else if (!w.dead && this.deadEl.isConnected) this.deadEl.remove();
    if (w.dead) this.deadBtn.textContent = w.checkpointSnap ? 'Restart from last checkpoint' : 'Restart from the beginning';
    if (w.dead && document.pointerLockElement === this.vp.canvas) document.exitPointerLock();
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
    row('checkpoint', w.checkpointSnap?.id || '—'); if (w.ai) for (const r of w.ai.agents) { const d = r.agent.debug(); row('enemy ' + d.name, `${d.state}${r.active ? '' : ' (waiting)'} hp ${d.hp} sees:${d.sees ? 'Y' : 'n'} heard:${d.heard ? 'Y' : 'n'}`); }
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
      audio: (c) => { if (!c.asset) return; if (this.audio) this.audio.playOneShot(c.asset, { volume: c.volume ?? 1 }).catch(() => {}); else playOneShot(this.app, c.asset, { volume: c.volume }).catch(() => {}); },
      event: (name) => this.world.runtime.emit(name),
      begin: () => { this.frozen = true; }, end: () => { this.frozen = false; this.seqState = null; this.seqPlayer = null; },
    } });
    this.seqPlayer = host.player({ reduceFlashing: seq.reduceFlashing }).start();
    this.restoreStack.push({ host, snap: this.seqPlayer.snapshot });
    this.world.runtime.state.flags['seq:' + seq.name] = 'playing';
  }
}

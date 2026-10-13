// Animation Studio: keyframe the first-person weapon animations (draw,
// reload, inspect, fire...). Pose the gun / hands / magazine with a gizmo,
// keys are created automatically at the playhead. Saved clips replace the
// built-in ones in game immediately; export JSON to share.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { el } from '../core/util.js';
import { anims } from '../anim/library.js';
import { sampleClip, makePose, sortClip, VEC_TRACKS, SCALAR_TRACKS, SCALAR_REST, EASES, EVENT_TYPES } from '../anim/clip.js';
import { socketQuat } from '../weapons/models.js';
import { WEAPONS } from '../weapons/weapons.js';
import { HAND_POSES } from '../weapons/arms.js';
import { audio } from '../game/audio.js';
import { settings } from '../core/settings.js';
import { toast, prop, select, num, vec3, range, jsonDialog } from './ui.js';
import { profile } from '../core/profile.js';

const DEG = Math.PI / 180;
const ALL_TRACKS = ['gun', 'lhand', 'rhand', 'mag', 'cam', 'model', 'bolt', 'boltRot', 'lgrip', 'rgrip', 'trigger', 'hA', 'hB'];
const TRACK_LABEL = { gun: 'Weapon', lhand: 'Left hand', rhand: 'Right hand', mag: 'Magazine', cam: 'Camera', model: 'Spin (model)', bolt: 'Bolt / slide', boltRot: 'Bolt rotate', lgrip: 'L fingers', rgrip: 'R fingers', trigger: 'Trigger', hA: 'Handle A', hB: 'Handle B' };
const TRACK_COLOR = { gun: '#ffb43c', lhand: '#5fd38d', rhand: '#4aa3e0', mag: '#e06a4a', cam: '#c08cff', model: '#ff6fd8', bolt: '#d0d0d0', boltRot: '#a0a0a0', lgrip: '#5fd38d', rgrip: '#4aa3e0', trigger: '#909090', hA: '#7fe0ff', hB: '#7fe0ff' };
const SOUNDS = ['magOut', 'magIn', 'magRelease', 'magDrop', 'boltBack', 'boltForward', 'boltUp', 'boltDown', 'slideBack', 'slideForward', 'slideRelease', 'pumpBack', 'pumpForward', 'shellInsert', 'pouch', 'gear', 'draw', 'knifeDraw', 'swing', 'knifeFlip', 'balisong', 'dry'];
const GUN_CLIPS = ['draw', 'fire', 'reload', 'reloadEmpty', 'inspect'];
const CLIP_NAMES = { rifle: GUN_CLIPS, smg: GUN_CLIPS, pistol: GUN_CLIPS, sniper: GUN_CLIPS, shotgun: ['draw', 'fire', 'reloadStart', 'reloadInsert', 'reloadEnd', 'reloadEndPump', 'inspect'], knife: ['draw', 'slash1', 'slash2', 'stab', 'inspect'] };
const clipNames = (w) => CLIP_NAMES[WEAPONS[w].cls] || GUN_CLIPS;
// ready-made weapon poses (offsets from the hip pose)
const GUN_PRESETS = {
  'Rest (hip)': { p: [0, 0, 0], r: [0, 0, 0] },
  'Lowered': { p: [0.02, -0.08, 0.04], r: [-18, 6, 8] },
  'Inspect left side': { p: [-0.07, 0.05, 0.03], r: [12, -38, 42] },
  'Inspect right side': { p: [-0.02, 0.03, 0.0], r: [8, 30, -25] },
  'Look at top': { p: [-0.05, 0.02, 0.05], r: [35, -20, 10] },
  'Tilt for reload': { p: [-0.03, -0.02, 0.02], r: [8, -12, 35] },
  'Out of view (draw)': { p: [0.06, -0.3, 0.12], r: [-45, 10, 15] },
};
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler();

function unwrapDeg(v, ref) { if (ref === undefined) return v; while (v - ref > 180) v -= 360; while (v - ref < -180) v += 360; return v; }
const r3 = (a) => a.map((x) => +(+x).toFixed(4));
const r1 = (a) => a.map((x) => +(+x).toFixed(2));

export class AnimStudio {
  constructor(app) {
    this.app = app; this.vm = app.vm;
    const st = app.animState || {};
    this.weapon = st.weapon || 'rifle'; this.clipName = st.clip || 'reload';
    this.t = 0; this.playing = false; this.loop = true; this.speed = 1; this.autoKey = true;
    this.track = 'lhand'; this.keyIdx = -1; this.evIdx = -1; this.camMode = 'fp'; this.gizmoMode = 'translate';
    this.pxPerSec = 260; this.scroll = 0;
    this.undoStack = []; this.redoStack = []; this.clipboard = null;
  }

  async init() {
    await this.vm.equip(this.weapon, { noDraw: true });
    this.loadClip(this.clipName);
    // cameras
    const cam = this.app.camera; cam.fov = 78; cam.updateProjectionMatrix();
    const sp = this.app.world.spawns.find((s) => s.team === 0) || { pos: new THREE.Vector3(0, 0, 20), yaw: 0 };
    cam.position.set(sp.pos.x, sp.pos.y + 1.64, sp.pos.z); cam.rotation.set(0, sp.yaw, 0, 'YXZ');
    this.orbitCam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 20);
    this.orbitCam.position.set(-0.55, 0.15, 0.05);
    this.orbit = new OrbitControls(this.orbitCam, this.app.renderer.canvas); this.orbit.target.set(0.08, -0.15, -0.35); this.orbit.enabled = false; this.orbit.enableDamping = true;
    this.vm.scene.add(this.orbitCam);
    this.grid = new THREE.GridHelper(1.2, 24, 0x666666, 0x333333); this.grid.position.y = -0.45; this.grid.visible = false; this.vm.scene.add(this.grid);
    // gizmo handle
    this.handle = new THREE.Object3D(); this.vm.scene.add(this.handle);
    this.gizmo = new TransformControls(this.vm.camera, this.app.renderer.canvas);
    this.gizmo.size = 0.6; this.gizmo.setSpace('local');
    this.gizmo.addEventListener('dragging-changed', (e) => { if (this.camMode === 'orbit') this.orbit.enabled = !e.value; this.dragging = e.value; if (!e.value) this.refreshSide(); });
    this.gizmo.addEventListener('objectChange', () => this.onGizmo());
    this.vm.scene.add(this.gizmo.getHelper());
    this.buildUI();
    this.setTrack(this.track);
    this.evaluate();
    this._onKey = (e) => this.onKey(e);
    addEventListener('keydown', this._onKey);
  }

  // ------------------------------------------------------------------ data
  loadClip(name) {
    this.clipName = name;
    const src = anims.get(this.weapon, name);
    this.clip = src ? JSON.parse(JSON.stringify(src)) : { name, weapon: this.weapon, duration: 1.5, tracks: {}, events: [] };
    this.clip.tracks = this.clip.tracks || {}; this.clip.events = this.clip.events || [];
    this.t = 0; this.keyIdx = -1; this.evIdx = -1; this.dirty = false;
    this.app.animState = { weapon: this.weapon, clip: name };
    this.undoStack = []; this.redoStack = []; this.snap = JSON.stringify(this.clip);
  }
  get TRACKS() {
    // balisong handle tracks only for the butterfly knife
    return ALL_TRACKS.filter((t) => (t !== 'hA' && t !== 'hB') || this.weapon === 'butterfly');
  }

  // ------------------------------------------------------------------ undo
  touch() { this.dirty = true; this._edited = true; }
  // record the finished edit (called when no drag is in progress)
  commit() {
    const j = JSON.stringify(this.clip);
    if (j === this.snap) return;
    this.undoStack.push(this.snap); if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack = []; this.snap = j;
  }
  undo() { this.commit(); if (!this.undoStack.length) { toast('Nothing to undo'); return; } this.redoStack.push(this.snap); this.restore(this.undoStack.pop()); toast('Undo'); }
  redo() { if (!this.redoStack.length) { toast('Nothing to redo'); return; } this.undoStack.push(this.snap); this.restore(this.redoStack.pop()); toast('Redo'); }
  restore(j) {
    this.snap = j; this.clip = JSON.parse(j); this.dirty = true; this._edited = false;
    this.keyIdx = this.keyAt(this.track, this.t); this.evIdx = -1;
    this.durIn.value = this.clip.duration; this.evaluate(); this.refreshSide(); this.drawTimeline();
  }

  // ------------------------------------------------------------------ helpers
  copyPose() { this.clipboard = { track: this.track, vec: VEC_TRACKS.includes(this.track), val: this.sampledValue(this.track, this.t) }; toast('Copied ' + TRACK_LABEL[this.track] + ' pose'); }
  pastePose() {
    const c = this.clipboard; if (!c) { toast('Copy a pose first (Ctrl+C)'); return; }
    if (c.vec !== VEC_TRACKS.includes(this.track)) { toast('Paste into a ' + (c.vec ? 'position/rotation' : 'value') + ' track'); return; }
    this.setKey(this.track, JSON.parse(JSON.stringify(c.val))); this.evaluate(); this.refreshSide();
  }
  // key at the playhead with the value of the previous key (a pause / hold)
  holdPrevious() {
    const ks = this.keys(this.track).filter((k) => k.t < this.t - 0.004);
    if (!ks.length) { toast('No earlier key on this track'); return; }
    const k = ks[ks.length - 1];
    this.setKey(this.track, k.p ? { p: k.p.slice(), r: k.r.slice() } : { v: k.v }); this.evaluate(); this.refreshSide();
  }
  // end the clip on the first key's pose so it blends back cleanly
  closeLoop() {
    const ks = this.keys(this.track); if (!ks.length) { toast('No keys on this track'); return; }
    const k = ks[0], t = this.t; this.t = this.clip.duration;
    this.setKey(this.track, k.p ? { p: k.p.slice(), r: k.r.slice() } : { v: k.v }); this.t = t; this.evaluate(); this.refreshSide();
  }
  // a full 360° spin of the weapon model around one axis over `dur` seconds
  addSpin(axis, dur = 0.6, turns = 1) {
    const t0 = this.t, t1 = Math.min(this.clip.duration, t0 + dur), base = this.sampledValue('model', t0);
    const end = base.r.slice(); end[axis] += 360 * turns;
    this.track = 'model';
    this.setKey('model', { p: base.p, r: base.r }); this.t = t1; this.setKey('model', { p: base.p, r: end }); this.t = t0;
    this.keyIdx = this.keyAt('model', t0); this.evaluate(); this.setTrack('model'); toast('Spin added: ' + t0.toFixed(2) + 's → ' + t1.toFixed(2) + 's');
  }
  keys(track) { return this.clip.tracks[track] || []; }
  keyAt(track, t) { return this.keys(track).findIndex((k) => Math.abs(k.t - t) < 0.0051); }
  sampledValue(track, t) {
    const pose = sampleClip(this.clip, t, makePose());
    if (VEC_TRACKS.includes(track)) return { p: pose[track].p.slice(), r: pose[track].r.slice() };
    return { v: pose[track] };
  }
  // insert/update a key at the playhead
  setKey(track, val) {
    const tr = this.clip.tracks[track] || (this.clip.tracks[track] = []);
    let i = this.keyAt(track, this.t);
    if (i < 0) { const base = this.sampledValue(track, this.t); tr.push({ t: +this.t.toFixed(3), ...base }); sortClip(this.clip); i = this.keyAt(track, this.t); }
    const k = tr[i];
    if (val.p) k.p = r3(val.p); if (val.r) k.r = r1(val.r); if (val.v !== undefined) k.v = +(+val.v).toFixed(4);
    this.keyIdx = i; this.touch();
    this.drawTimeline();
  }
  deleteKey() {
    const tr = this.clip.tracks[this.track]; if (!tr || this.keyIdx < 0) return;
    tr.splice(this.keyIdx, 1); if (!tr.length) delete this.clip.tracks[this.track];
    this.keyIdx = -1; this.touch(); this.evaluate(); this.refreshSide();
  }

  // ------------------------------------------------------------------ evaluation
  // replay the clip from 0 to t so events (mag attach/drop) are applied correctly
  evaluate() {
    const vm = this.vm;
    const onEv = vm.onEvent; vm.onEvent = null;
    vm.posSpring.reset(); vm.rotSpring.reset(); vm.camKick.reset(); vm.swayRot.reset();
    vm.slideLocked = false; vm.magHoldRel = null;
    vm.player.play(this.clip, { blend: 0 });
    vm.magState = 'gun'; vm.magBlend = 1; if (vm.active.nodes.mag) vm.active.nodes.mag.visible = true;
    vm.lPoseName = vm.def.vm.lPose; vm.rPoseName = vm.def.vm.rPose;
    vm.player.update(0);
    const step = 1 / 120; let tt = 0;
    const stepFn = (d) => { vm.update(d, {}); };
    while (tt + step < this.t) { stepFn(step); tt += step; }
    stepFn(Math.max(0, this.t - tt));
    if (!vm.player.playing) { vm.player.play(this.clip, { blend: 0 }); vm.player.seek(Math.min(this.t, this.clip.duration - 1e-4)); vm.update(0, {}); }
    vm.onEvent = onEv;
    this.placeHandle();
  }

  // world (vm-scene) transform of the selected track's handle
  trackWorld(track, outP, outQ) {
    const vm = this.vm, m = vm.active; if (!m) return false;
    vm.root.updateMatrixWorld(true);
    const piv = vm.gunPivot.matrixWorld;
    if (track === 'gun') { piv.decompose(outP, outQ, _v); return true; }
    if (track === 'lhand' || track === 'rhand') {
      const h = track === 'lhand' ? vm._lHand : vm._rHand; if (!h) return false;
      const free = track === 'lhand' && vm.def.vm.lhandFree;
      _m.compose(h.p, h.q, _v.set(1, 1, 1));
      _m.premultiply(free ? vm.root.matrixWorld : piv);
      _m.decompose(outP, outQ, _v); return true;
    }
    if (track === 'mag' && m.nodes.mag) { m.nodes.mag.matrixWorld.decompose(outP, outQ, _v); return true; }
    return false;
  }
  placeHandle() {
    if (this.dragging) return;
    const ok = this.trackWorld(this.track, this.handle.position, this.handle.quaternion);
    if (ok && this.camMode !== null) this.gizmo.attach(this.handle); else this.gizmo.detach();
  }
  onGizmo() {
    const vm = this.vm, m = vm.active, s = m.sockets, tr = this.track;
    vm.root.updateMatrixWorld(true);
    const hw = new THREE.Matrix4().compose(this.handle.position, this.handle.quaternion, new THREE.Vector3(1, 1, 1));
    const cur = this.sampledValue(tr, this.t);
    let p, q;
    if (tr === 'gun') {
      const local = vm.root.matrixWorld.clone().invert().multiply(hw);
      p = new THREE.Vector3(); q = new THREE.Quaternion(); local.decompose(p, q, _v);
      const hip = vm.def.vm.hip;
      const hipQ = _q.setFromEuler(_e.set(hip.r[0] * DEG, hip.r[1] * DEG, hip.r[2] * DEG));
      const off = hipQ.clone().invert().multiply(q);
      const e = new THREE.Euler().setFromQuaternion(off);
      this.setKey('gun', { p: [p.x - hip.p[0] - settings.vmOffsetX * 0.04, p.y - hip.p[1], p.z - hip.p[2]], r: [e.x / DEG, e.y / DEG, e.z / DEG].map((v, i) => unwrapDeg(v, cur.r[i])) });
    } else if (tr === 'lhand' || tr === 'rhand' || tr === 'mag') {
      const free = tr === 'lhand' && vm.def.vm.lhandFree;
      const space = free ? vm.root.matrixWorld : vm.gunPivot.matrixWorld;
      const local = space.clone().invert().multiply(hw);
      p = new THREE.Vector3(); q = new THREE.Quaternion(); local.decompose(p, q, _v);
      const sock = tr === 'lhand' ? s.fore : tr === 'rhand' ? s.grip : s.mag;
      const sq = tr === 'lhand' ? m.foreQ : tr === 'rhand' ? m.gripQ : m.magQ;
      const off = sq.clone().invert().multiply(q);
      const e = new THREE.Euler().setFromQuaternion(off);
      this.setKey(tr, { p: [p.x - sock.p[0], p.y - sock.p[1], p.z - sock.p[2]], r: [e.x / DEG, e.y / DEG, e.z / DEG].map((v, i) => unwrapDeg(v, cur.r[i])) });
    }
    this._needEval = true;
  }

  // ------------------------------------------------------------------ UI
  buildUI() {
    const t = (label, fn, cls = '') => el('button', { class: 'tb ' + cls, onclick: fn }, label);
    this.weaponSel = select(Object.keys(WEAPONS).map((k) => [k, WEAPONS[k].name]), this.weapon, async (v) => { if (!this.confirmLose()) { this.weaponSel.value = this.weapon; return; } this.weapon = v; await this.vm.equip(v, { noDraw: true }); this.fillClipSel(); this.loadClip(clipNames(v).includes(this.clipName) ? this.clipName : clipNames(v)[0]); this.clipSel.value = this.clipName; if (!this.TRACKS.includes(this.track)) this.track = 'gun'; this.afterLoad(); });
    this.clipSel = select([], this.clipName, (v) => { if (!this.confirmLose()) { this.clipSel.value = this.clipName; return; } this.loadClip(v); this.afterLoad(); });
    this.fillClipSel();
    this.camBtns = { fp: t('FIRST PERSON', () => this.setCam('fp')), orbit: t('ORBIT', () => this.setCam('orbit')) };
    this.autoBtn = t('AUTO-KEY', () => { this.autoKey = !this.autoKey; this.autoBtn.classList.toggle('on', this.autoKey); });
    this.autoBtn.classList.add('on');
    const top = el('div', { class: 'ed-top' },
      t('◀ LOBBY', () => { if (this.confirmLose()) this.app.toLobby(); }), el('h1', {}, 'ANIMATION STUDIO'), this.weaponSel, this.clipSel,
      t('SAVE', () => this.save()), t('↶ UNDO', () => this.undo()), t('↷ REDO', () => this.redo()), t('RESET', () => this.reset()), t('BLANK', () => this.blank()), t('JSON ⇅', () => this.jsonIO()),
      el('div', { class: 'sp' }), this.camBtns.fp, this.camBtns.orbit, this.autoBtn, t('▶ TEST IN GAME', () => this.testInGame(), 'go'));
    this.side = el('div', { class: 'ed-side' });
    this.viewEl = el('div', { class: 'ed-view' }, el('div', { class: 'ed-help' }, 'Pick a track · drag the gizmo to pose · a key is set at the playhead', el('br'), 'Space: play/pause · ←/→: step · K: key · Del: delete key · G/R: move/rotate gizmo · Ctrl+Z/Y: undo/redo · Ctrl+C/V: copy/paste pose · H: hold previous pose'));
    // timeline
    this.playBtn = t('▶', () => this.togglePlay());
    this.timeLbl = el('span', { style: { minWidth: '120px', fontWeight: '700' } });
    this.durIn = num(this.clip.duration, (v) => { this.clip.duration = Math.max(0.1, v); this.touch(); this.drawTimeline(); }, 0.05);
    this.durIn.style.width = '70px';
    const speedSel = select([['0.1', '0.1×'], ['0.25', '0.25×'], ['0.5', '0.5×'], ['1', '1×']], '1', (v) => { this.speed = +v; });
    speedSel.style.width = 'auto';
    this.loopBtn = t('LOOP', () => { this.loop = !this.loop; this.loopBtn.classList.toggle('on', this.loop); }); this.loopBtn.classList.add('on');
    this.canvas = el('canvas', { class: 'tl-canvas' });
    const bar = el('div', { class: 'tl-bar' }, t('⏮', () => this.seek(0)), this.playBtn, this.loopBtn, speedSel, this.timeLbl, el('span', { class: 'hint' }, 'Duration'), this.durIn,
      t('+ KEY', () => this.keyHere()), t('− KEY', () => this.deleteKey()), t('+ EVENT', () => this.addEvent()),
      t('ZOOM −', () => { this.pxPerSec = Math.max(60, this.pxPerSec / 1.4); this.drawTimeline(); }), t('ZOOM +', () => { this.pxPerSec = Math.min(1600, this.pxPerSec * 1.4); this.drawTimeline(); }));
    this.timeline = el('div', { class: 'timeline' }, bar, el('div', { class: 'tl-body' }, this.canvas));
    this.ui = el('div', { class: 'ed' }, top, el('div', { class: 'ed-main' }, this.viewEl, this.side), this.timeline);
    document.getElementById('ui').appendChild(this.ui);
    this.fitView = () => { const r = this.viewEl.getBoundingClientRect(); this.app.renderer.setArea({ x: r.left, y: r.top, w: r.width, h: r.height }); };
    this.fitView(); addEventListener('resize', this.fitView);
    this.bindTimeline();
    this.setCam('fp');
    this.refreshSide(); this.drawTimeline();
  }
  fillClipSel() {
    const names = new Set([...clipNames(this.weapon), ...anims.names(this.weapon)]);
    this.clipSel.innerHTML = '';
    for (const n of names) this.clipSel.appendChild(el('option', { value: n }, n + (anims.isCustom(this.weapon, n) ? ' ★' : '')));
    this.clipSel.value = this.clipName;
  }
  afterLoad() { this.durIn.value = this.clip.duration; this.setTrack(this.track); this.evaluate(); this.refreshSide(); this.drawTimeline(); }
  confirmLose() { return !this.dirty || confirm('Discard unsaved changes to this clip?'); }

  setCam(mode) {
    this.camMode = mode;
    for (const k in this.camBtns) this.camBtns[k].classList.toggle('on', k === mode);
    this.orbit.enabled = mode === 'orbit'; this.grid.visible = mode === 'orbit';
    this.gizmo.camera = mode === 'orbit' ? this.orbitCam : this.vm.camera;
    this.vm.scene.background = mode === 'orbit' ? new THREE.Color(0x4a5262) : null;
  }
  setTrack(tr) {
    this.track = tr; this.keyIdx = this.keyAt(tr, this.t); this.evIdx = -1;
    this.gizmo.setMode(this.gizmoMode);
    this.placeHandle(); this.refreshSide(); this.drawTimeline();
  }

  refreshSide() {
    const S = this.side; S.innerHTML = '';
    const tr = this.track;
    S.append(el('h3', {}, 'TRACKS'));
    const grid = el('div', { class: 'palette' });
    for (const k of this.TRACKS) grid.appendChild(el('button', { class: k === tr ? 'on' : '', style: { borderLeft: '3px solid ' + TRACK_COLOR[k] }, onclick: () => this.setTrack(k) }, TRACK_LABEL[k]));
    S.append(grid);
    if (['gun', 'lhand', 'rhand', 'mag'].includes(tr)) {
      S.append(el('div', { class: 'btn-row' },
        el('button', { class: 'tb' + (this.gizmoMode === 'translate' ? ' on' : ''), onclick: () => { this.gizmoMode = 'translate'; this.gizmo.setMode('translate'); this.refreshSide(); } }, 'MOVE (G)'),
        el('button', { class: 'tb' + (this.gizmoMode === 'rotate' ? ' on' : ''), onclick: () => { this.gizmoMode = 'rotate'; this.gizmo.setMode('rotate'); this.refreshSide(); } }, 'ROTATE (R)')));
    }
    if (tr === 'mag') S.append(el('p', { class: 'hint' }, 'Magazine keys apply while the mag is in the gun. Use events magToHand / magToGun / dropMag / newMag to pass it to the left hand.'));
    // key editor
    const isVec = VEC_TRACKS.includes(tr);
    const k = this.keyIdx >= 0 ? this.keys(tr)[this.keyIdx] : null;
    S.append(el('h3', {}, (k ? 'KEY @ ' + k.t.toFixed(2) + 's' : 'NO KEY AT PLAYHEAD') + ' — ' + TRACK_LABEL[tr].toUpperCase()));
    const cur = k || this.sampledValue(tr, this.t);
    const edit = (fn) => (v) => { const val = fn(v); this.setKey(tr, val); this.evaluate(); this.refreshSide(); };
    if (isVec) {
      S.append(prop('Position', vec3(cur.p || [0, 0, 0], edit((v) => ({ p: v, r: (cur.r || [0, 0, 0]) })), 0.005)));
      S.append(prop('Rotation°', vec3(cur.r || [0, 0, 0], edit((v) => ({ p: (cur.p || [0, 0, 0]), r: v })), 1)));
    } else {
      const lim = { bolt: [0, 0.12, 0.001], boltRot: [0, 90, 1], lgrip: [0, 1, 0.01], rgrip: [0, 1, 0.01], trigger: [0, 1, 0.01], hA: [0, 180, 1], hB: [0, 180, 1] }[tr];
      S.append(prop('Value', range(lim[0], lim[1], lim[2], cur.v ?? SCALAR_REST[tr], edit((v) => ({ v })))));
    }
    if (k) {
      S.append(prop('Ease → next', select(EASES, k.e || 'smooth', (v) => { if (v === 'smooth') delete k.e; else k.e = v; this.touch(); this.evaluate(); })));
      S.append(prop('Time (s)', num(k.t, (v) => { k.t = Math.max(0, Math.min(this.clip.duration, v)); sortClip(this.clip); this.keyIdx = this.keys(tr).indexOf(k); this.t = k.t; this.touch(); this.evaluate(); this.refreshSide(); this.drawTimeline(); }, 0.01)));
    }
    S.append(el('div', { class: 'btn-row' }, el('button', { class: 'tb', onclick: () => this.keyHere() }, k ? 'UPDATE KEY (K)' : 'ADD KEY (K)'), k ? el('button', { class: 'tb', onclick: () => this.deleteKey() }, 'DELETE KEY') : ''));
    S.append(el('div', { class: 'btn-row wrap' },
      el('button', { class: 'tb', title: 'Ctrl+C', onclick: () => this.copyPose() }, 'COPY POSE'),
      el('button', { class: 'tb', title: 'Ctrl+V', onclick: () => this.pastePose() }, 'PASTE'),
      el('button', { class: 'tb', title: 'H — key the previous pose here (a pause)', onclick: () => this.holdPrevious() }, 'HOLD'),
      el('button', { class: 'tb', title: 'Key the first pose at the clip end', onclick: () => this.closeLoop() }, 'END = START')));
    if (tr === 'gun') S.append(prop('Pose preset', select([['', 'choose…'], ...Object.keys(GUN_PRESETS).map((n) => [n, n])], '', (v) => { if (!v) return; const pr = GUN_PRESETS[v]; this.setKey('gun', { p: pr.p.slice(), r: pr.r.slice() }); this.evaluate(); this.refreshSide(); })));
    if (tr === 'model') {
      S.append(el('p', { class: 'hint' }, 'Spins the weapon in the hand (around the ring / pivot) — knife twirls, flips. Hands stay where they are.'));
      S.append(el('div', { class: 'btn-row wrap' }, ...[['SPIN X', 0], ['SPIN Y', 1], ['SPIN Z', 2]].map(([l, a]) => el('button', { class: 'tb', onclick: () => this.addSpin(a) }, l + ' 360°'))));
    }
    if (tr === 'hA' || tr === 'hB') S.append(el('p', { class: 'hint' }, 'Butterfly handle angle: 0 = open (blade out), 180 = closed over the blade.'));
    if (tr === 'lgrip' || tr === 'rgrip') S.append(el('p', { class: 'hint' }, 'Finger curl: 0 = open hand, 1 = full grip. Hand shape can be switched with lpose/rpose events (' + Object.keys(HAND_POSES).join(', ') + ').'));
    // events
    S.append(el('h3', {}, 'EVENTS'));
    const evs = this.clip.events;
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
    evs.forEach((ev, i) => {
      const on = i === this.evIdx;
      const row = el('div', { style: { padding: '5px', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'), borderRadius: '3px', display: 'flex', flexDirection: 'column', gap: '4px', cursor: 'pointer' }, onclick: (e) => { if (e.target.tagName === 'DIV' || e.target.tagName === 'B') { this.evIdx = i; this.seek(ev.t); this.refreshSide(); } } },
        el('b', { style: { fontSize: '13px' } }, ev.t.toFixed(2) + 's · ' + ev.type + (ev.name ? ' · ' + ev.name : '') + (ev.pose ? ' · ' + ev.pose : '')));
      if (on) {
        row.append(prop('Time', num(ev.t, (v) => { ev.t = Math.max(0, v); sortClip(this.clip); this.evIdx = evs.indexOf(ev); this.touch(); this.drawTimeline(); this.refreshSide(); }, 0.01)),
          prop('Type', select(EVENT_TYPES, ev.type, (v) => { ev.type = v; this.touch(); this.refreshSide(); this.drawTimeline(); })));
        if (ev.type === 'sound') row.append(prop('Sound', select(SOUNDS, ev.name || 'gear', (v) => { ev.name = v; audio.unlock(); audio.play(v); this.touch(); })));
        if (ev.type === 'kick') row.append(prop('Push', vec3(ev.p || [0, 0, 0], (v) => { ev.p = v; this.touch(); }, 0.01)), prop('Rotate', vec3(ev.r || [0, 0, 0], (v) => { ev.r = v; this.touch(); }, 1)), prop('Camera', vec3(ev.cam || [0, 0, 0], (v) => { ev.cam = v; this.touch(); }, 0.1)));
        if (ev.type === 'dropMag') row.append(prop('Velocity', vec3(ev.v || [0, -1, 0], (v) => { ev.v = v; this.touch(); }, 0.1)));
        if (ev.type === 'lpose' || ev.type === 'rpose') row.append(prop('Hand pose', select(Object.keys(HAND_POSES), ev.pose || 'grip', (v) => { ev.pose = v; this.touch(); this.evaluate(); })));
        row.append(el('button', { class: 'tb', onclick: () => { evs.splice(i, 1); this.evIdx = -1; this.touch(); this.evaluate(); this.refreshSide(); this.drawTimeline(); } }, 'DELETE EVENT'));
      }
      list.appendChild(row);
    });
    S.append(list, el('button', { class: 'tb', onclick: () => this.addEvent() }, '+ EVENT AT PLAYHEAD'));
    S.append(el('p', { class: 'hint' }, 'Events: sound (play a sound), kick (springy jolt), magToHand / magToGun (who holds the mag), dropMag (throw it away), newMag (fresh mag appears in hand), ammo (refill happens here), shell (eject casing).'));
  }

  addEvent() {
    this.clip.events.push({ t: +this.t.toFixed(3), type: 'sound', name: 'gear' });
    sortClip(this.clip); this.evIdx = this.clip.events.findIndex((e) => Math.abs(e.t - this.t) < 0.004 && e.type === 'sound');
    this.touch(); this.refreshSide(); this.drawTimeline();
  }
  keyHere() {
    const tr = this.track;
    if (['gun', 'lhand', 'rhand', 'mag'].includes(tr)) { this.onGizmo(); }
    else this.setKey(tr, this.sampledValue(tr, this.t));
    this.evaluate(); this.refreshSide();
  }

  // ------------------------------------------------------------------ timeline
  bindTimeline() {
    const c = this.canvas;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const LEFT = 110, ROW = 15, TOP = 18;
    const timeAt = (x) => Math.max(0, Math.min(this.clip.duration, (x - LEFT) / this.pxPerSec));
    c.addEventListener('pointerdown', (e) => {
      const p = pos(e); c.setPointerCapture(e.pointerId);
      const row = Math.floor((p.y - TOP) / ROW);
      if (p.x < LEFT) { if (row >= 0 && row < this.TRACKS.length) this.setTrack(this.TRACKS[row]); return; }
      if (p.y < TOP) { this.drag = { type: 'head' }; this.seek(timeAt(p.x)); return; }
      if (row >= 0 && row < this.TRACKS.length) {
        const tr = this.TRACKS[row]; const ks = this.keys(tr);
        const hit = ks.findIndex((k) => Math.abs(LEFT + k.t * this.pxPerSec - p.x) < 6);
        if (hit >= 0) { this.track = tr; this.keyIdx = hit; this.drag = { type: 'key', track: tr, key: ks[hit] }; this.seek(ks[hit].t); this.setTrack(tr); this.keyIdx = this.keys(tr).indexOf(this.drag.key); this.refreshSide(); return; }
        this.setTrack(tr); this.drag = { type: 'head' }; this.seek(timeAt(p.x)); return;
      }
      if (row === this.TRACKS.length) {
        const hit = this.clip.events.findIndex((ev) => Math.abs(LEFT + ev.t * this.pxPerSec - p.x) < 6);
        if (hit >= 0) { this.evIdx = hit; this.drag = { type: 'event', ev: this.clip.events[hit] }; this.seek(this.clip.events[hit].t); this.refreshSide(); return; }
      }
      this.drag = { type: 'head' }; this.seek(timeAt(p.x));
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return; const p = pos(e);
      let t = timeAt(p.x); t = Math.round(t / (e.shiftKey ? 0.05 : 0.01)) * (e.shiftKey ? 0.05 : 0.01);
      if (this.drag.type === 'head') this.seek(t);
      else if (this.drag.type === 'key') { this.drag.key.t = +t.toFixed(3); sortClip(this.clip); this.keyIdx = this.keys(this.drag.track).indexOf(this.drag.key); this.touch(); this.seek(t); }
      else if (this.drag.type === 'event') { this.drag.ev.t = +t.toFixed(3); sortClip(this.clip); this.evIdx = this.clip.events.indexOf(this.drag.ev); this.touch(); this.seek(t); }
    });
    c.addEventListener('pointerup', () => { if (this.drag && this.drag.type !== 'head') this.refreshSide(); this.drag = null; });
    c.addEventListener('dblclick', (e) => { const p = pos(e); const row = Math.floor((p.y - TOP) / ROW); if (row >= 0 && row < this.TRACKS.length && p.x > LEFT) { this.setTrack(this.TRACKS[row]); this.seek(timeAt(p.x)); this.keyHere(); } });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.pxPerSec = Math.max(60, Math.min(1600, this.pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); this.drawTimeline(); }, { passive: false });
    this.tl = { LEFT, ROW, TOP };
  }
  drawTimeline() {
    const c = this.canvas; if (!c) return;
    const { LEFT, ROW, TOP } = this.tl || { LEFT: 110, ROW: 15, TOP: 18 };
    const W = Math.max(c.parentElement.clientWidth, LEFT + this.clip.duration * this.pxPerSec + 40), H = TOP + ROW * (this.TRACKS.length + 1) + 6;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; }
    const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#0f1318'; x.fillRect(0, 0, W, H);
    const end = LEFT + this.clip.duration * this.pxPerSec;
    x.fillStyle = '#161b22'; x.fillRect(LEFT, 0, end - LEFT, H);
    // ruler
    x.font = '11px monospace'; x.fillStyle = '#7d8896'; x.strokeStyle = '#2a313b';
    const stepT = this.pxPerSec > 500 ? 0.05 : this.pxPerSec > 200 ? 0.1 : 0.25;
    for (let t = 0; t <= this.clip.duration + 1e-6; t += stepT) {
      const px = LEFT + t * this.pxPerSec; const major = Math.abs(t / (stepT * 4) - Math.round(t / (stepT * 4))) < 1e-6;
      x.beginPath(); x.moveTo(px, major ? 4 : 10); x.lineTo(px, H); x.stroke();
      if (major) x.fillText(t.toFixed(2), px + 2, 11);
    }
    this.TRACKS.forEach((tr, i) => {
      const y = TOP + i * ROW;
      if (tr === this.track) { x.fillStyle = 'rgba(255,180,60,0.10)'; x.fillRect(0, y, W, ROW); }
      x.fillStyle = TRACK_COLOR[tr]; x.fillText(TRACK_LABEL[tr], 6, y + 11);
      const ks = this.keys(tr);
      if (ks.length > 1) { x.strokeStyle = TRACK_COLOR[tr] + '55'; x.lineWidth = 2; x.beginPath(); x.moveTo(LEFT + ks[0].t * this.pxPerSec, y + ROW / 2); x.lineTo(LEFT + ks[ks.length - 1].t * this.pxPerSec, y + ROW / 2); x.stroke(); x.lineWidth = 1; }
      ks.forEach((k, j) => {
        const px = LEFT + k.t * this.pxPerSec, py = y + ROW / 2, s = 5;
        x.fillStyle = tr === this.track && j === this.keyIdx ? '#fff' : TRACK_COLOR[tr];
        x.beginPath(); x.moveTo(px, py - s); x.lineTo(px + s, py); x.lineTo(px, py + s); x.lineTo(px - s, py); x.closePath(); x.fill();
      });
    });
    const ey = TOP + this.TRACKS.length * ROW;
    x.fillStyle = '#e7e7e7'; x.fillText('Events', 6, ey + 11);
    this.clip.events.forEach((ev, i) => {
      const px = LEFT + ev.t * this.pxPerSec;
      x.fillStyle = i === this.evIdx ? '#fff' : ev.type === 'sound' ? '#8fb3ff' : ev.type === 'kick' ? '#ffb43c' : '#ff7a7a';
      x.fillRect(px - 2, ey + 2, 4, ROW - 4);
    });
    // playhead
    const hx = LEFT + this.t * this.pxPerSec;
    x.strokeStyle = '#ff4a4a'; x.lineWidth = 2; x.beginPath(); x.moveTo(hx, 0); x.lineTo(hx, H); x.stroke(); x.lineWidth = 1;
    x.strokeStyle = '#ffb43c'; x.beginPath(); x.moveTo(end, 0); x.lineTo(end, H); x.stroke();
    this.timeLbl.textContent = this.t.toFixed(2) + ' / ' + this.clip.duration.toFixed(2) + ' s';
  }

  seek(t) { this.t = Math.max(0, Math.min(this.clip.duration, t)); this.keyIdx = this.keyAt(this.track, this.t); this._needEval = true; this.drawTimeline(); if (!this.drag) this.refreshSideSoon(); }
  refreshSideSoon() { clearTimeout(this._rs); this._rs = setTimeout(() => this.refreshSide(), 60); }
  togglePlay() {
    this.playing = !this.playing; this.playBtn.textContent = this.playing ? '❚❚' : '▶';
    audio.unlock();
    if (this.playing) { if (this.t >= this.clip.duration - 1e-3) this.t = 0; this.evaluate(); this.vm.onEvent = (e) => { if (e.type === 'sound') audio.play(e.name, { vol: 0.7 }); }; }
    else { this.vm.onEvent = null; this.refreshSide(); }
  }

  onKey(e) {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.code === 'Space') { this.togglePlay(); e.preventDefault(); }
    else if (e.code === 'ArrowRight') this.seek(this.t + (e.shiftKey ? 0.1 : 1 / 60));
    else if (e.code === 'ArrowLeft') this.seek(this.t - (e.shiftKey ? 0.1 : 1 / 60));
    else if (e.code === 'KeyK') this.keyHere();
    else if (e.code === 'Delete' || e.code === 'Backspace') this.deleteKey();
    else if (e.code === 'KeyG') { this.gizmoMode = 'translate'; this.gizmo.setMode('translate'); this.refreshSide(); }
    else if (e.code === 'KeyR') { this.gizmoMode = 'rotate'; this.gizmo.setMode('rotate'); this.refreshSide(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { this.save(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { if (e.shiftKey) this.redo(); else this.undo(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { this.redo(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') { this.copyPose(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') { this.pastePose(); e.preventDefault(); }
    else if (e.code === 'KeyH') this.holdPrevious();
  }

  // ------------------------------------------------------------------ files
  save() {
    this.clip.name = this.clipName; this.clip.weapon = this.weapon;
    if (!anims.save(this.weapon, this.clipName, this.clip)) { toast('Storage full — export JSON instead', 3000); return; }
    this.dirty = false; this.fillClipSel();
    toast('Saved ' + this.weapon + ' / ' + this.clipName + ' — used in game now');
  }
  reset() {
    if (!confirm('Reset this clip to the built-in version?')) return;
    anims.reset(this.weapon, this.clipName); this.loadClip(this.clipName); this.fillClipSel(); this.afterLoad(); toast('Reset to default');
  }
  blank() {
    if (!confirm('Clear all keys and events of this clip?')) return;
    this.clip.tracks = {}; this.clip.events = []; this.touch(); this.afterLoad();
  }
  jsonIO() {
    jsonDialog('ANIMATION JSON', this.clip, `${this.weapon}_${this.clipName}.json`, (obj) => {
      if (!obj.tracks) { toast('Not an animation clip JSON', 2500); return; }
      this.clip = sortClip(obj); this.clip.events = this.clip.events || []; this.touch(); this.afterLoad(); toast('Clip imported — SAVE to use it in game');
    });
  }
  testInGame() {
    this.save();
    const def = WEAPONS[this.weapon], slot = def.slot, key = slot === 'pistol' ? 'secondary' : slot;
    const clip = this.clipName;
    this.app.startGame({ mode: 'practice', loadout: { ...profile.loadout(), [key]: this.weapon }, map: this.app.selectedMap, onQuit: () => this.app.openTool('anim'),
      afterStart: async (g) => {
        if (slot !== 'primary') await g.player.equip(slot);
        setTimeout(() => {
          const gun = g.player.gun;
          if (clip.startsWith('reload')) { if (clip === 'reloadEmpty') { gun.reserve += gun.mag; gun.mag = 0; } else gun.mag = Math.max(1, gun.mag - 5); g.player.startReload(); }
          else if (clip !== 'fire') this.vm.play(clip);
        }, 800);
      } });
  }

  // ------------------------------------------------------------------ loop
  update(dt) {
    const vm = this.vm;
    if (this._edited && !this.dragging && !this.drag) { this._edited = false; this.commit(); }
    if (this.playing) {
      this.t += dt * this.speed;
      if (this.t >= this.clip.duration) { if (this.loop) { this.t = 0; this.evaluate(); } else { this.t = this.clip.duration; this.togglePlay(); } }
      else { vm.update(dt * this.speed, {}); }
      this.placeHandle(); this.drawTimeline();
    } else if (this._needEval && !this._evalLock) {
      this._needEval = false; this.evaluate();
    }
    if (this.camMode === 'orbit') this.orbit.update();
  }
  render() {
    const vm = this.vm, cam = this.app.camera;
    vm.sync(cam, this.app.world, cam.aspect);
    if (this.camMode === 'orbit') {
      this.orbitCam.aspect = cam.aspect; this.orbitCam.updateProjectionMatrix();
      this.app.renderer.render({ scene: vm.scene, camera: this.orbitCam });
    } else this.app.renderer.render({ scene: this.app.world.scene, camera: cam }, { scene: vm.scene, camera: vm.camera });
  }
  destroy() {
    removeEventListener('keydown', this._onKey);
    this.gizmo.detach(); this.vm.scene.remove(this.gizmo.getHelper(), this.handle, this.orbitCam, this.grid); this.gizmo.dispose(); this.orbit.dispose();
    this.vm.scene.background = null; this.vm.onEvent = null;
    this.vm.player.stop(0);
    this.ui.remove();
    removeEventListener('resize', this.fitView); this.app.renderer.setArea(null);
  }
}

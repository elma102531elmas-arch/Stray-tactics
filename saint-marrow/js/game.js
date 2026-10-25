// Game: owns the world, runs the loop, wires player/monsters/story/network/UI together.
import * as THREE from '../lib/three.module.js';
import { CFG, SAVE, DIFF, saveCfg, writeSave, QUALITY } from './settings.js';
import { t } from './i18n.js';
import { Renderer } from './engine/renderer.js';
import { Assets } from './engine/assets.js';
import { Audio } from './engine/audio.js';
import { Input } from './engine/input.js';
import { FX, Rain, DustMotes } from './engine/fx.js';
import { makeBloodAtlas, makeLensBlood, makeSkinDetail } from './engine/textures.js';
import { LightSystem } from './world/lights.js';
import { Level } from './world/level.js';
import { T } from './world/grid.js';
import { Player, WEAPONS } from './entities/player.js';
import { Viewmodel } from './entities/viewmodel.js';
import { Enemy } from './entities/enemy.js';
import { RemotePlayer } from './entities/remote.js';
import { buildCreatureTemplate, instantiate, animate } from './entities/creatures.js';
import { Net } from './net.js';
import { UI } from './ui.js';
import { CHAPTERS } from './chapters/chapters.js';
import { clamp, damp, lerp, rand, pick, isTouch, mulberry32 } from './util.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3();
const KEY_ITEMS = new Set(['boltcutters', 'fuse', 'keycard', 'key', 'fuel']);
const CONSUMABLE = { battery: 'battery', bandage: 'bandage', medkit: 'medkit', painkillers: 'painkillers', ammo9: 'ammo9', ammo762: 'ammo762' };

export class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);
    this.renderer.setQuality(CFG.quality);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CFG.fov, innerWidth / innerHeight, 0.04, 140);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);
    this.vmCamera.layers.set(1);
    this.camera.add(this.vmCamera);
    this.scene.add(this.camera);
    // faint light around the player (eye adaptation) so the dark stays readable on phone screens
    this.fill = new THREE.PointLight(0x9aa6b4, 3.2, 8, 2);
    this.fill.layers.enableAll();
    this.fill.position.set(0, 0.3, 0.2);
    this.camera.add(this.fill);
    this.assets = new Assets(this.renderer.gl);
    this.assets.aniso = this.renderer.q.aniso;
    this.audio = new Audio();
    this.input = new Input(this.canvas);
    this.net = new Net(this);
    this.ui = new UI(this);
    this.t = t;
    this.mode = 'menu';
    this.state = 'boot';
    this.enemies = [];
    this.remotes = new Map();
    this.timers = [];
    this.flags = {};
    this.team = {};
    this.journal = [];
    this.eventQueue = [];
    this.flashMul = 1;
    this.lobbyChapter = 1;
    this.lobbyDiff = 'normal';
    this.stats = { time: 0, kills: 0, deaths: 0 };
    this.fxState = { flash: 0, shake: 0, shakeT: 0, fade: 0, fadeTarget: 0, fadeSpeed: 1 };
    this.clock = new THREE.Clock();
    this.time = 0;
    this.frameTimes = [];
    this.resT = 0;
    this.netT = 0; this.snapT = 0;
    this.heartT = 0;
    this.chaseVol = 0;
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play' && !this.isCoop()) this.pause(); });
    this.input.onUnlock = () => { if (this.state === 'play' && !this.ui.noteOpen && !this.ui.keypadOpen) this.pause(); };
    document.body.classList.toggle('touch', isTouch());
    document.getElementById('ctrlText').textContent = isTouch() ? t('controlsTouch') : t('controlsKeys');
  }

  // ================================================================= boot
  async boot() {
    const ui = this.ui;
    ui.show('boot');
    ui.setLoading(0.02, t('loadingAssets'));
    this.audio.init();
    const atlas = makeBloodAtlas();
    this.fx = new FX(this.scene, this.renderer, atlas, () => this.level?.grid);
    this.fx.bloodLevel = CFG.blood === 'off' ? 0 : CFG.blood === 'low' ? 0.4 : 1;
    this.renderer.setBloodTexture(makeLensBlood());
    this.lights = new LightSystem(this.scene, this.assets, this.renderer.q.lights);
    this.rain = new Rain(this.scene);
    this.rain.setEnabled(false);
    this.dust = new DustMotes(this.scene);
    await this.assets.loadAll((p) => ui.setLoading(0.02 + p * 0.6));
    ui.setLoading(0.64, t('loadingSound'));
    await this.audio.generate((p) => ui.setLoading(0.64 + p * 0.18));
    ui.setLoading(0.84, t('loadingBodies'));
    await new Promise((r) => setTimeout(r, 30));
    this.skinDetail = makeSkinDetail();
    for (const k of ['hollow', 'warden', 'human']) {
      buildCreatureTemplate(k, this.assets, this.skinDetail, this.renderer.qname);
      await new Promise((r) => setTimeout(r, 0));
    }
    ui.setLoading(0.95);
    this.vm = new Viewmodel(this);
    this.vmCamera.add(this.vm.root);
    this.player = new Player(this);
    this.input.bindTouch(document.getElementById('touch'), document.getElementById('joyBase'), document.getElementById('joyKnob'), () => this.audio.resume());
    ui.setLoading(1, t('tapToStart'));
    const btn = document.getElementById('btnTapStart');
    btn.hidden = false;
    btn.addEventListener('click', () => {
      this.audio.resume();
      this.tryFullscreen();
      ui.show('menu');
      this.state = 'menu';
      this.menuAmbience();
    }, { once: true });
    this.loop();
  }

  tryFullscreen() {
    if (!isTouch()) return;
    try {
      const d = document.documentElement;
      const r = d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen && d.webkitRequestFullscreen();
      if (r && r.catch) r.catch(() => {});
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    } catch (e) { /* not available */ }
  }

  menuAmbience() {
    this.audio.stopAll();
    this.menuLoop = this.audio.play('drone', { loop: true, vol: 0.5, bus: 'music', reverb: 0.2 });
    this.audio.play('amb_wind', { loop: true, vol: 0.35, bus: 'amb' });
  }

  onResize() {
    this.renderer.resize();
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = this.camera.aspect;
    this.vmCamera.updateProjectionMatrix();
    this.fx?.setScreen(this.renderer.h * this.renderer.pr);
  }

  applySettings(key) {
    if (key === 'quality') {
      this.renderer.setQuality(CFG.quality);
      this.lights.setPoolSize(this.renderer.q.lights);
      this.vm.setShadowSize(this.renderer.q.shadow);
      this.onResize();
    }
    if (key === 'volume' || key === 'music') this.audio.setVolumes();
    if (key === 'blood') this.fx.bloodLevel = CFG.blood === 'off' ? 0 : CFG.blood === 'low' ? 0.4 : 1;
    if (key === 'hudScale' || key === 'btnOpacity') this.ui.applyHudScale();
    if (key === 'fov') { this.camera.fov = CFG.fov; this.camera.updateProjectionMatrix(); }
    if (key === 'lang') document.getElementById('ctrlText').textContent = isTouch() ? t('controlsTouch') : t('controlsKeys');
    if (key === 'autoRes' && !CFG.autoRes) this.renderer.setScale(1);
  }

  // ================================================================= modes
  isHost() { return this.mode !== 'client'; }
  isCoop() { return (this.mode === 'host' || this.mode === 'client') && this.net.online && this.remotes.size > 0; }
  mySlot() { return this.mode === 'client' ? this.net.slot : 0; }

  startSolo(chapter, inv) {
    this.net.close();
    this.mode = 'solo';
    this.remotes.forEach((r) => r.dispose()); this.remotes.clear();
    this.player.reset(true);
    if (inv) this.player.loadState(inv);
    else if (chapter > 1 && SAVE.checkpoint && SAVE.checkpoint.chapter === chapter) this.player.loadState(SAVE.checkpoint.inv);
    else this.player.loadState(this.defaultLoadout(chapter));
    this.loadChapter(chapter, { seed: (Math.random() * 1e9) | 0 });
  }

  defaultLoadout(ch) {
    // sensible kit when starting a later chapter directly
    const s = { inv: { bandage: 1, medkit: 0, painkillers: 0, battery: 1, ammo9: 0, ammo762: 0 }, owned: { none: true, crowbar: ch > 1, pistol: ch > 2, rifle: ch > 3 }, mag: { pistol: ch > 2 ? 8 : 0, rifle: ch > 3 ? 5 : 0 }, weapon: ch > 2 ? 'pistol' : ch > 1 ? 'crowbar' : 'none', battery: 1, hp: 100 };
    if (ch > 2) s.inv.ammo9 = 8;
    if (ch > 3) s.inv.ammo762 = 3;
    return s;
  }

  hostGame() {
    if (window.__ARTIFACT__) { this.ui.coopStatus(t('coopPreview')); return; }
    const st = this.net.status();
    if (st) { this.ui.coopStatus(t(st)); return; }
    this.ui.coopStatus(t('connecting'));
    this.mode = 'host';
    this.lobbyChapter = Math.min(SAVE.unlocked, 5);
    this.lobbyChapter = 1;
    this.net.host(CFG.name, (ev, info) => {
      if (ev === 'open') this.net.pushLobby();
      else if (ev === 'error') this.ui.coopStatus(t('peerFailed') + ' (' + info + ')');
    });
  }

  joinGame(code) {
    if (window.__ARTIFACT__) { this.ui.coopStatus(t('coopPreview')); return; }
    const st = this.net.status();
    if (st) { this.ui.coopStatus(t(st)); return; }
    this.ui.coopStatus(t('connecting'));
    this.mode = 'client';
    this.net.join(code, CFG.name, (ev, info) => {
      if (ev === 'open') this.ui.coopStatus(t('connected'));
      else if (ev === 'error') { this.ui.coopStatus(t('joinFailed') + (info ? ' (' + info + ')' : '')); this.mode = 'menu'; }
    });
  }

  leaveLobby() { this.net.close(); this.mode = 'menu'; this.ui.show('coop'); }

  onLobby(m) {
    if (this.state === 'play') return;
    this.lobbyChapter = m.chapter || 1;
    this.lobbyDiff = m.diff || 'normal';
    this.ui.lobby(m, this.net.isHost, this.net.code);
  }
  onWelcome(m) { /* lobby message follows */ }
  onJoinRefused(why) { this.ui.coopStatus(t(why === 'full' ? 'roomFull' : 'roomBusy')); this.net.close(); this.mode = 'menu'; }

  lobbyStart() {
    if (!this.net.isHost) return;
    const seed = (Math.random() * 1e9) | 0;
    CFG.difficulty = this.lobbyDiff;
    this.player.reset(true);
    const ch = this.lobbyChapter;
    this.player.loadState(this.defaultLoadout(ch));
    const msg = { t: 'start', chapter: ch, seed, diff: this.lobbyDiff, players: this.net.players };
    this.net.broadcast(msg);
    this.setupRemotes(this.net.players);
    this.loadChapter(ch, { seed });
  }

  setupRemotes(list) {
    const mine = this.mySlot();
    for (const p of list) {
      if (p.slot === mine || this.remotes.has(p.slot)) continue;
      this.remotes.set(p.slot, new RemotePlayer(this, p.slot, p.name));
    }
  }

  onPlayerJoined(slot, name) { if (this.state === 'play') this.ui.toast(name + t('teammateJoined')); }
  onPlayerLeft(slot) {
    const r = this.remotes.get(slot);
    if (r) { this.ui.toast(r.name + t('teammateLeft')); r.dispose(); this.remotes.delete(slot); }
  }
  onHostLost() {
    if (this.mode !== 'client') return;
    this.ui.toast(t('hostLeft'), 'bad');
    setTimeout(() => this.quitToMenu(), 1500);
  }

  // ================================================================= chapters
  async loadChapter(n, opts = {}) {
    const def = CHAPTERS[n - 1];
    if (!def) return;
    this.state = 'loading';
    this.chapterNo = n;
    this.chapter = def;
    this.seed = opts.seed ?? 1;
    this.ui.hideAll();
    this.ui.showHud(false);
    this.input.enabled = false;
    this.audio.stopAll();
    this.audio.stopSpeech();
    this.renderer.fx.fade = 1;
    this.fxState.fade = 1; this.fxState.fadeTarget = 1;
    // tear down
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    this.warden = null;
    this.timers = [];
    this.flags = {};
    this.team = {};
    if (this.level) this.level.dispose();
    this.fx.clear();
    if (this.jonah) { this.scene.remove(this.jonah.root); this.jonah = null; }
    if (this.rescue) { this.scene.remove(this.rescue); this.rescue = null; }
    await new Promise((r) => setTimeout(r, 30));
    // build
    const level = new Level(this, Object.assign({ grid: def.map }, def), this.seed);
    this.level = level;
    level.build();
    this.scene.add(level.root);
    this.audio.setReverb(def.reverb || 'hall');
    this.rain.setEnabled(!!def.rain);
    this.audio.occlude = (p) => !level.grid.lineOfSight(this.camera.position.x, this.camera.position.y, this.camera.position.z, p.x, p.y, p.z);
    // player
    const P = this.player;
    P.reset(false);
    P.hp = Math.max(P.hp, 60);
    const spawns = def.spawnMarker ? (level.markers[def.spawnMarker] || []).map((m) => new THREE.Vector3(m.x, 0, m.z)) : level.playerSpawns;
    const sp = spawns[this.mySlot() % spawns.length] || spawns[0] || new THREE.Vector3(2, 0, 2);
    P.spawn(sp, def.spawnYaw ?? 0);
    this.vm.setWeapon(P.weapon === 'none' ? null : P.weapon);
    // checkpoint
    if (this.mode !== 'client') {
      SAVE.unlocked = Math.max(SAVE.unlocked, n);
      if (this.mode === 'solo') SAVE.checkpoint = { chapter: n, inv: P.saveState() };
      writeSave();
    }
    this.chapterStartInv = P.saveState();
    // monsters & director (host)
    if (this.isHost()) {
      for (const m of level.markers['spawn:hollow'] || []) {
        const d = m.def;
        const e = this.spawnEnemy('hollow', m.x + (d.dx || 0), m.z + (d.dz || 0), { dormant: d.dormant, crawler: d.crawler, id: d.id, scriptOnly: d.scriptOnly, tag: d.tag, side: Math.random() < 0.5 ? 1 : -1 }, true);
        if (e) e.home = e.pos.clone();
      }
      if (def.warden && (def.warden.enabled || def.id === 2)) {
        this.warden = this.spawnEnemy('warden', 2, 2, { id: 'warden' }, true);
        this.wardenCfg = Object.assign({}, def.warden);
        this.wardenTimer = def.warden.first ?? rand(...(def.warden.gap || [30, 60]));
      }
    }
    this.stats.time = 0;
    this.journalCh = n;
    // ambience
    for (const a of def.ambience || []) this.audio.play(a, { loop: true, vol: a === 'drone' ? 0.32 : a === 'amb_rain' ? 0.5 : 0.6, bus: a === 'drone' ? 'music' : 'amb', reverb: 0.1 });
    this.chaseLoop = this.audio.play('chase', { loop: true, vol: 0, bus: 'music', reverb: 0.05 });
    // go
    this.onResize();
    this.state = 'play';
    this.ui.showHud(true);
    this.ui.objective('', def.key);
    this.ui.chapterCard(n, def.key, def.key + 'sub');
    this.input.reset();
    this.input.enabled = true;
    this.input.lockPointer();
    this.fxState.fadeTarget = 0; this.fxState.fadeSpeed = 0.5;
    this.lastHp = P.hp;
    if (this.isHost() && def.start) def.start(this);
    // replay events that arrived while loading
    const q = this.eventQueue; this.eventQueue = [];
    for (const e of q) this.applyEvent(e);
  }

  endChapter() {
    if (!this.isHost() || this.state !== 'play') return;
    this.netEvent({ t: 'chapterEnd' });
  }
  endGame() {
    if (!this.isHost()) return;
    this.netEvent({ t: 'gameEnd' });
  }
  showChapterDone() {
    this.state = 'done';
    this.input.enabled = false;
    this.input.unlockPointer();
    this.ui.showHud(false);
    const next = this.chapterNo + 1;
    if (this.mode !== 'client') { SAVE.unlocked = Math.max(SAVE.unlocked, Math.min(5, next)); if (this.mode === 'solo' && next <= 5) SAVE.checkpoint = { chapter: next, inv: this.player.saveState() }; writeSave(); }
    this.ui.chapterDone(this.stats, next <= 5 && this.mode !== 'client');
    if (this.mode === 'client') document.getElementById('btnNext').hidden = true;
  }
  nextChapter() {
    const next = this.chapterNo + 1;
    if (next > 5) return this.quitToMenu();
    const inv = this.player.saveState();
    if (this.mode === 'host') {
      const seed = (Math.random() * 1e9) | 0;
      this.net.broadcast({ t: 'start', chapter: next, seed, diff: CFG.difficulty, players: this.net.players, keep: true });
      this.player.loadState(inv);
      this.loadChapter(next, { seed });
    } else if (this.mode === 'solo') {
      this.player.loadState(inv);
      this.loadChapter(next, { seed: (Math.random() * 1e9) | 0 });
    }
  }
  restartChapter() {
    if (this.mode === 'client') { this.ui.toast(t('waitingHost')); return; }
    const inv = this.chapterStartInv;
    this.player.reset(true);
    this.player.loadState(inv);
    const seed = (Math.random() * 1e9) | 0;
    if (this.mode === 'host') this.net.broadcast({ t: 'start', chapter: this.chapterNo, seed, diff: CFG.difficulty, players: this.net.players, restart: true });
    this.loadChapter(this.chapterNo, { seed });
  }
  quitToMenu() {
    this.net.close();
    this.mode = 'menu';
    this.state = 'menu';
    this.input.enabled = false;
    this.input.unlockPointer();
    this.ui.showHud(false);
    this.remotes.forEach((r) => r.dispose()); this.remotes.clear();
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    if (this.level) { this.level.dispose(); this.level = null; }
    this.fx.clear();
    this.lights.clear();
    this.rain.setEnabled(false);
    this.audio.stopSpeech();
    this.renderer.fx.fade = 1;
    this.ui.show('menu');
    this.menuAmbience();
  }
  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.input.unlockPointer();
    this.ui.show('pause');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.ui.hideAll();
    this.state = 'play';
    this.input.enabled = true;
    this.input.lockPointer();
  }

  // ================================================================= services for chapters / entities
  timer(sec, fn) { this.timers.push({ t: sec, fn }); }

  objective(key, n, m, timer) {
    let text = t(key);
    if (n !== undefined && n !== null && m) text += ` (${n}/${m})`;
    if (timer !== undefined) { const s = Math.ceil(timer); text += ` — ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
    this.netEvent({ t: 'obj', key, text: null, n, m, timer });
  }
  subtitle(key, dur = 4, local) {
    if (local) { this.ui.subtitle(t(key), dur); return; }
    this.netEvent({ t: 'sub', key, dur });
  }
  sfx(name, p, vol = 1) { this.netEvent({ t: 'sfx', name, p: [p.x, p.y, p.z], vol }); }
  netSound(name, p, vol = 1, vary = 0) { if (this.isHost()) this.netEvent({ t: 'sfx', name, p: [p.x, p.y, p.z], vol, vary }); }
  stinger(name) { this.netEvent({ t: 'sting', name }); }
  custom(k, data = {}) { this.netEvent(Object.assign({ t: 'custom', k }, data)); }
  setPower(group, on) { this.netEvent({ t: 'power', group, on }); }
  setDoor(id, o) { this.netEvent(Object.assign({ t: 'door', id }, o)); }
  toastTo(slot, key, ...args) {
    const txt = key === 'needItem' ? t('needItem') + t(args[0]) + (args[1] ? ' ' + args[1] : '') : t(key);
    if (slot === this.mySlot()) { this.ui.toast(txt); this.audio.play('door_locked', { vol: 0.5 }); }
    else this.net.sendTo(slot, { t: 'toast', text: txt });
  }
  enemyById(id) { return this.enemies.find((e) => e.id === id); }
  wardenDirector(cfg) { this.wardenCfg = Object.assign(this.wardenCfg || {}, cfg); if (this.warden && this.warden.state === 'absent') this.wardenTimer = Math.min(this.wardenTimer ?? 20, 20); if (!this.warden) { this.warden = this.spawnEnemy('warden', 2, 2, { id: 'warden' }, true); this.wardenTimer = 15; } }

  flash(a, dur) { this.fxState.flash = Math.max(this.fxState.flash, a); this.fxState.flashDecay = a / Math.max(0.05, dur); if (this.level?.sky) this.level.sky.material.uniforms.uFlash.value = a; }
  shake(a, dur) { this.player.trauma = Math.max(this.player.trauma, a); this.fxState.shakeT = dur; this.fxState.shakeA = a; }
  fadeOut(dur) { this.fxState.fadeTarget = 1; this.fxState.fadeSpeed = 1 / dur; }

  // spawn on host; broadcast to clients
  spawnEnemy(kind, x, z, opts = {}, silent) {
    if (!this.isHost()) return null;
    const id = opts.id || kind + '_' + Math.floor(Math.random() * 1e9).toString(36);
    if (this.enemyById(id)) return this.enemyById(id);
    const e = new Enemy(this, kind, x, z, Object.assign({}, opts, { id }));
    e.tag = opts.tag; e.scriptOnly = !!opts.scriptOnly;
    this.enemies.push(e);
    this.net.online && this.net.broadcast({ t: 'ev', e: { t: 'spawn', kind, id, x, z, yaw: e.yaw, opts: { dormant: opts.dormant, crawler: opts.crawler, side: opts.side } } });
    return e;
  }

  // players for AI
  allPlayers() {
    const out = [];
    if (this.player && this.state !== 'menu') out.push({ slot: this.mySlot(), p: this.player, pos: this.player.pos });
    for (const r of this.remotes.values()) out.push({ slot: r.slot, p: r.p, pos: r.pos });
    return out;
  }
  playerRef(p) { return this.allPlayers().find((x) => x.p === p) || null; }
  playerBySlot(s) { return this.allPlayers().find((x) => x.slot === s) || null; }
  nearestPlayer(pos, aliveOnly) {
    let best = null, bd = Infinity;
    for (const P of this.allPlayers()) {
      if (aliveOnly && (P.p.dead)) continue;
      const d = Math.hypot(P.pos.x - pos.x, P.pos.z - pos.z);
      if (d < bd) { bd = d; best = P; }
    }
    return best ? { p: best.p, dist: bd, slot: best.slot, pos: best.pos } : null;
  }
  randomPlayer() { const a = this.allPlayers().filter((x) => !x.p.dead); return a.length ? pick(a) : null; }
  anyTeammateUp() { for (const r of this.remotes.values()) if (!r.p.downed && !r.p.dead) return true; return false; }
  anyPlayerSees(pos, range) {
    for (const P of this.allPlayers()) {
      if (P.p.dead) continue;
      const d = Math.hypot(P.pos.x - pos.x, P.pos.z - pos.z);
      if (d < range && this.level.grid.lineOfSight(P.pos.x, 1.6, P.pos.z, pos.x, 1.6, pos.z)) return true;
    }
    return false;
  }

  damagePlayer(slot, amount, opts) {
    if (slot === this.mySlot()) this.player.takeDamage(amount, opts);
    else this.net.sendTo(slot, { t: 'dmg', amount, opts: Object.assign({}, opts, { from: opts.from ? [opts.from.x, opts.from.z] : null }) });
  }

  makeNoise(pos, radius, kind) {
    if (this.isHost()) for (const e of this.enemies) e.hear(pos, radius, kind);
    else if (this.net.online) this.net.send({ t: 'req', r: { k: 'noise', p: [pos.x, pos.z], r: radius } });
  }

  onEnemyKilled(e) { this.stats.kills++; if (this.chapter.onKilled) this.chapter.onKilled(this, e); }
  onWardenChase(w, on) { /* music handled per frame */ }
  onWardenGone() { this.wardenTimer = rand(...(this.wardenCfg?.gap || [30, 60])); }

  onLocalDowned() { this.netEvent({ t: 'downed', slot: this.mySlot() }); }
  onLocalDeath() {
    this.stats.deaths++;
    this.renderer.fx.blood = 1;
    if (!this.isCoop()) {
      setTimeout(() => {
        if (this.state !== 'play') return;
        this.state = 'dead';
        this.input.enabled = false;
        this.input.unlockPointer();
        this.ui.showHud(false);
        this.ui.dead();
      }, 2600);
    } else this.checkWipe();
  }
  checkWipe() {
    if (!this.isHost()) { this.net.send({ t: 'req', r: { k: 'checkWipe' } }); return; }
    const all = this.allPlayers();
    if (all.length && all.every((P) => P.p.dead || P.p.downed)) {
      this.timer(3, () => this.netEvent({ t: 'wipe' }));
    }
  }

  // ================================================================= combat
  fireShot(o, d, w, weaponId) {
    const g = this;
    const hits = [];
    for (const e of this.enemies) { const h = e.raycast(o, d, 80); if (h) hits.push([h.t, e, h]); }
    const wh = this.level.grid.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 80, { props: true, ceil: this.level.ceilAt(o.x, o.z) });
    hits.sort((a, b) => a[0] - b[0]);
    let dmgLeft = w.dmg;
    let blocked = false;
    for (const [tt, e, h] of hits) {
      if (wh && tt > wh.t) break;
      this.hitEnemy(e, dmgLeft, h.part, h.point, d);
      if (!w.pierce) { blocked = true; break; }
      dmgLeft *= 0.6;
    }
    if (!blocked && wh) {
      const surf = wh.kind === 'door' ? 'wood' : wh.kind === 'prop' ? 'metal' : (wh.ny > 0 ? this.level.surfaceAt(wh.x, wh.z) : 'concrete');
      this.fx.impact(wh, d, surf);
      this.audio.play(surf === 'metal' ? 'impact_metal' : surf === 'wood' ? 'impact_wood' : 'impact_wall', { pos: _v.set(wh.x, wh.y, wh.z).clone(), vol: 0.8, vary: 0.2 });
    }
    // sound + light for everyone
    this.audio.play(w.sound, { vol: 1, reverb: 0.6, vary: 0.05 });
    this.fx.muzzleSmoke(_v.copy(o).addScaledVector(d, 0.6), d);
    this.makeNoise(this.player.pos, w.noise, 'shot');
    if (this.net.online) this.net.send(this.mode === 'client' ? { t: 'req', r: { k: 'shot', w: weaponId } } : { t: 'ev', e: { t: 'shot', slot: this.mySlot(), w: weaponId } });
  }

  hitEnemy(e, dmg, part, point, dir) {
    this.fx.bloodHit(point, dir, e.kind === 'warden' ? 0.7 : part === 'head' ? 1.4 : 1);
    this.audio.play('flesh', { pos: point.clone(), vol: 0.9, vary: 0.2 });
    if (part === 'head' && e.kind === 'hollow') this.audio.play('crunch', { pos: point.clone(), vol: 0.6 });
    if (this.isHost()) {
      e.damage(dmg, part, dir, this.mySlot());
      if (this.net.online) this.net.broadcast({ t: 'ev', e: { t: 'fxb', p: [point.x, point.y, point.z], d: [dir.x, dir.y, dir.z], pw: 1, by: this.mySlot() } });
    } else this.net.send({ t: 'req', r: { k: 'hit', id: e.id, dmg, part, p: [point.x, point.y, point.z], d: [dir.x, dir.y, dir.z] } });
  }

  meleeAttack(w) {
    const P = this.player;
    this.camera.getWorldPosition(_v);
    this.camera.getWorldDirection(_f);
    let hit = false;
    for (const e of this.enemies) {
      if (!e.visibleActive()) continue;
      _w.set(e.pos.x - _v.x, 0, e.pos.z - _v.z);
      const d = _w.length();
      if (d > w.range + 0.3) continue;
      _w.normalize();
      const f2 = _f.clone().setY(0).normalize();
      if (_w.dot(f2) < 0.55) continue;
      const pt = new THREE.Vector3(e.pos.x, e.kind === 'warden' ? 1.6 : 1.3, e.pos.z);
      this.hitEnemy(e, w.dmg, P.pitch > 0.15 ? 'head' : 'body', pt, f2);
      this.audio.play('crunch', { pos: pt, vol: 0.7 });
      hit = true;
      break;
    }
    if (!hit) {
      const wh = this.level.grid.raycast(_v.x, _v.y, _v.z, _f.x, _f.y, _f.z, w.range, { props: true, ceil: this.level.ceilAt(_v.x, _v.z) });
      if (wh) { this.audio.play('melee_metal', { pos: _w.set(wh.x, wh.y, wh.z).clone(), vol: 0.7 }); this.fx.impact(wh, _f, 'concrete'); this.player.trauma += 0.2; }
    }
    this.makeNoise(P.pos, w.noise, 'melee');
  }

  // ================================================================= interaction
  updateInteraction(dt, I) {
    const P = this.player;
    this.prompt = null; this.promptShort = null;
    this.holdProgress = 0;
    if (!P.canAct()) { this.holdTarget = null; return; }
    this.camera.getWorldPosition(_v);
    this.camera.getWorldDirection(_f);
    let o = this.level.findInteractable(_v, _f, 2.4);
    // revive downed teammates
    let reviveT = null;
    for (const r of this.remotes.values()) {
      if (!r.p.downed) continue;
      if (r.pos.distanceTo(P.pos) < 1.8) { reviveT = r; break; }
    }
    if (reviveT) o = { kind: 'revive', id: 'revive_' + reviveT.slot, hold: 3, remote: reviveT, prompt: () => 'revive' };
    if (!o) { this.holdTarget = null; this.lookAt = null; return; }
    this.lookAt = o;
    const key = o.prompt();
    let label = t(key === 'locked' ? 'lockedDoor' : key);
    if (o.kind === 'item') label = t('take') + ' ' + t(o.item);
    if (o.kind === 'revive') label = t('holdToRevive');
    this.prompt = label;
    this.promptShort = t(key === 'locked' ? 'lockedDoor' : key);
    const pressed = I.pressed.has('use') || I.pressed.has('tapUse');
    const hold = o.hold || 0;
    if (hold > 0) {
      // press once and keep looking at it (works the same on touch and keyboard)
      if (pressed && this.holdTarget !== o.id) {
        if (o.kind === 'use' && this.needsItemFor(o)) { this.interact(o); return; }
        this.holdTarget = o.id; this.holdT = 0;
      }
      if (this.holdTarget === o.id) {
        this.holdT += dt;
        this.holdProgress = Math.min(1, this.holdT / hold);
        if (this.holdT >= hold) { this.holdTarget = null; this.interact(o); }
      }
      return;
    }
    this.holdTarget = null;
    if (pressed) this.interact(o);
  }

  needsItemFor(o) {
    if (o.use === 'gate') return !this.team.boltcutters;
    if (o.use === 'fusebox') return (this.team.fuse || 0) < 3;
    if (o.use === 'generator') return !this.team.fuel;
    return false;
  }

  interact(o) {
    const P = this.player;
    switch (o.kind) {
      case 'door': {
        const d = o.door;
        if (d.locked) {
          const L = d.locked;
          if (L.startsWith('code:')) {
            this.input.unlockPointer();
            this.ui.openKeypad((val) => { if (val === L.slice(5)) { this.request({ k: 'unlock', id: d.id, code: val }); this.audio.play('switch', { vol: 0.6 }); return true; } this.audio.play('door_locked', { vol: 0.4 }); return false; });
            this.input.enabled = false;
            return;
          }
          if (L.startsWith('item:')) {
            const it = L.slice(5);
            if (this.team[it]) { this.request({ k: 'unlock', id: d.id }); return; }
            this.ui.toast(t('needItem') + t(it));
          } else if (L === 'power') this.ui.toast(t('noPower'));
          else if (L === 'chain') this.ui.toast(t('chained'));
          else if (L === 'script') { this.request({ k: 'use', id: d.id }); return; }
          else this.ui.toast(t('jammed'));
          this.audio.play('door_locked', { pos: d.center(), vol: 0.8 });
          return;
        }
        this.request({ k: 'door', id: d.id, from: [P.pos.x, P.pos.z] });
        return;
      }
      case 'item': this.request({ k: 'take', id: o.id }); return;
      case 'note': case 'tape': this.readNote(o.note, o.kind === 'tape', o.ent); return;
      case 'locker': this.enterLocker(o.locker); return;
      case 'use': this.request({ k: 'use', id: o.id }); return;
      case 'revive': this.request({ k: 'revive', target: o.remote.slot }); return;
    }
  }

  request(r) {
    if (this.isHost()) this.handleRequest(r, this.mySlot());
    else this.net.send({ t: 'req', r });
  }

  readNote(note, tape, ent) {
    this.audio.play(tape ? 'click' : 'paper', { vol: 0.7 });
    if (!this.journal.includes(note)) this.journal.push(note);
    this.input.enabled = false;
    this.input.reset();
    this.input.unlockPointer();
    this.ui.openNote(note + '_t', note, tape);
    if (tape) {
      this.tapeSnd = this.audio.play('static', { vol: 0.25, loop: true });
      this.audio.speak(t(note), { lang: CFG.lang === 'tr' ? 'tr-TR' : 'en-US', pitch: note === 'n_lab' ? 0.6 : 0.85 });
    }
    this.request({ k: 'read', note });
  }
  onNoteClosed() {
    if (this.tapeSnd) { this.tapeSnd.stop(0.3); this.tapeSnd = null; }
    if (this.state === 'play') { this.input.enabled = true; this.input.reset(); this.input.lockPointer(); }
  }

  enterLocker(L) {
    const P = this.player;
    const lk = L.locker;
    if (lk.occupant !== null && lk.occupant !== undefined) return;
    P.hidden = { L, yaw: Math.atan2(-lk.front.x, -lk.front.z) };
    P.hiddenSeen = false;
    // anyone chasing us watched us hide?
    for (const e of this.enemies) if (e.state === 'chase' && e.target && e.target.p === P && e.lastSeenT < 1.2) P.hiddenSeen = true;
    P.preHidePos = P.pos.clone();
    P.pos.set(L.obj.position.x, 0, L.obj.position.z);
    P.yaw = P.hidden.yaw;
    P.pitch = 0;
    P.flashOn = false;
    P.crouch = false;
    this.vm.lowered = true;
    document.body.classList.add('inLocker');
    this.audio.play('locker', { vol: 0.6 });
    this.netEvent({ t: 'locker', id: `${L.x}_${L.z}`, occ: this.mySlot() });
  }
  leaveLocker(forced) {
    const P = this.player;
    if (!P.hidden) return;
    const L = P.hidden.L;
    P.pos.set(L.obj.position.x + L.locker.front.x * 0.75, 0, L.obj.position.z + L.locker.front.z * 0.75);
    const [x, z] = this.level.grid.collide(P.pos.x, P.pos.z, 0.3);
    P.pos.x = x; P.pos.z = z;
    P.hidden = null;
    P.hiddenSeen = false;
    this.vm.lowered = false;
    document.body.classList.remove('inLocker');
    this.audio.play('locker', { vol: forced ? 0.9 : 0.5 });
    this.netEvent({ t: 'locker', id: `${L.x}_${L.z}`, occ: null });
  }

  // host: process an action from any player
  handleRequest(r, slot) {
    const lvl = this.level;
    if (!lvl) return;
    const ch = this.chapter;
    switch (r.k) {
      case 'door': {
        const d = lvl.entities.get(r.id);
        if (!d || d.locked) return;
        const fromX = r.from ? r.from[0] : d.x, fromZ = r.from ? r.from[1] : d.z;
        this.netEvent({ t: 'door', id: d.id, open: !d.open, dir: d.open ? d.dir : d.dirFrom(fromX, fromZ) });
        this.makeNoise(d.center(), 6, 'door');
        return;
      }
      case 'unlock': {
        const d = lvl.entities.get(r.id);
        if (!d || !d.locked) return;
        if (d.locked.startsWith('code:') && r.code !== d.locked.slice(5)) return;
        if (d.locked.startsWith('item:') && !this.team[d.locked.slice(5)]) return;
        const p = this.playerBySlot(slot);
        this.netEvent({ t: 'door', id: d.id, locked: null, open: true, dir: d.dirFrom(p ? p.pos.x : d.x, p ? p.pos.z : d.z), unlocked: true });
        return;
      }
      case 'take': {
        const ent = lvl.entities.get(r.id);
        if (!ent || ent.taken) return;
        const kind = ent.item;
        this.netEvent({ t: 'take', id: r.id, by: slot, kind, count: ent.count });
        if (ch.onPickup) ch.onPickup(this, kind, r.id, slot);
        return;
      }
      case 'use': if (ch.onUse) ch.onUse(this, r.id, slot); return;
      case 'read': if (ch.onRead) ch.onRead(this, r.note, slot); if (ch.onPickup) ch.onPickup(this, 'note', r.note, slot); return;
      case 'revive': {
        if (r.target === this.mySlot()) { if (this.player.downed) { this.player.revive(); this.netEvent({ t: 'revived', slot: r.target }); } }
        else { this.net.sendTo(r.target, { t: 'revive' }); this.netEvent({ t: 'revived', slot: r.target }); }
        return;
      }
      case 'hit': {
        const e = this.enemyById(r.id);
        if (!e) return;
        const dir = new THREE.Vector3(...r.d);
        e.damage(r.dmg, r.part, dir, slot);
        if (this.net.online) this.net.broadcast({ t: 'ev', e: { t: 'fxb', p: r.p, d: r.d, pw: 1, by: slot } });
        this.fx.bloodHit(new THREE.Vector3(...r.p), dir, 1);
        return;
      }
      case 'noise': { const p = new THREE.Vector3(r.p[0], 0, r.p[1]); for (const e of this.enemies) e.hear(p, r.r, 'remote'); return; }
      case 'shot': {
        const pl = this.playerBySlot(slot);
        if (pl) { for (const e of this.enemies) e.hear(pl.pos, WEAPONS[r.w]?.noise || 30, 'shot'); this.remoteShot(slot, r.w); }
        this.net.broadcast({ t: 'ev', e: { t: 'shot', slot, w: r.w } });
        return;
      }
      case 'checkWipe': this.checkWipe(); return;
    }
  }

  remoteShot(slot, w) {
    const r = this.remotes.get(slot);
    if (!r) return;
    const W = WEAPONS[w];
    this.audio.play(W ? W.sound : 'shot_pistol', { pos: r.pos.clone().setY(1.4), vol: 1, ref: 6, reverb: 0.7 });
    r.muzzle = 0.06;
  }

  // ================================================================= events (replicated)
  netEvent(e) {
    if (!this.isHost()) return;
    this.applyEvent(e);
    if (this.net.online) this.net.broadcast({ t: 'ev', e });
  }

  applyEvent(e) {
    if (!this.level && e.t !== 'chapterEnd') { this.eventQueue.push(e); return; }
    if (this.state === 'loading') { this.eventQueue.push(e); return; }
    const lvl = this.level;
    switch (e.t) {
      case 'door': {
        const d = lvl.entities.get(e.id);
        if (!d) return;
        if ('locked' in e) d.locked = e.locked;
        if ('open' in e) {
          const was = d.open;
          if (e.slam) { if (e.dir) d.dir = e.dir; d.slam(e.open); } else d.setOpen(e.open, e.dir);
          if (was !== e.open || e.unlocked) this.audio.play(e.slam ? 'door_slam' : e.open ? 'door_open' : 'door_close', { pos: d.center(), vol: 0.9, vary: 0.15 });
        }
        return;
      }
      case 'take': {
        const ent = lvl.entities.get(e.id);
        if (ent) { ent.taken = true; ent.obj.visible = false; ent.obj.userData.hidden = true; lvl.removeInteractable(e.id); }
        const kind = e.kind;
        if (KEY_ITEMS.has(kind)) this.team[kind] = (this.team[kind] || 0) + 1;
        if (kind === 'pistol' || kind === 'rifle' || kind === 'crowbar') {
          // weapons are shared: everyone in the team gets one
          const P = this.player;
          const had = P.owned[kind];
          P.owned[kind] = true;
          if (kind !== 'crowbar' && !had) P.mag[kind] = WEAPONS[kind].mag;
          if (e.by === this.mySlot()) P.equip(kind);
          this.ui.toast(t('picked') + ': ' + t(kind));
        } else if (e.by === this.mySlot()) {
          const P = this.player;
          const diff = DIFF[CFG.difficulty] || DIFF.normal;
          if (CONSUMABLE[kind]) {
            const n = kind === 'ammo9' ? Math.round((e.count || 8) * diff.loot) : kind === 'ammo762' ? Math.round((e.count || 5) * diff.loot) : 1;
            P.inv[kind] = (P.inv[kind] || 0) + n;
            this.ui.toast(t('picked') + ': ' + t(kind) + (n > 1 ? ' ×' + n : ''));
          } else if (KEY_ITEMS.has(kind)) this.ui.toast(t('picked') + ': ' + t(kind));
        } else if (KEY_ITEMS.has(kind)) this.ui.toast(t('picked') + ': ' + t(kind));
        if (e.by === this.mySlot()) this.audio.play('pickup', { vol: 0.7 });
        return;
      }
      case 'obj': {
        let text = t(e.key);
        if (e.n !== undefined && e.n !== null && e.m) text += ` (${e.n}/${e.m})`;
        if (e.timer !== undefined && e.timer !== null) { const s = Math.ceil(e.timer); text += ` — ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
        const isTimerTick = e.timer !== undefined && e.timer !== null && this.ui.lastObj.startsWith(t(e.key));
        if (isTimerTick) this.ui.objectiveText(text), (this.ui.lastObj = text);
        else { this.ui.objective(text); this.audio.play('objective', { vol: 0.5, bus: 'music' }); }
        return;
      }
      case 'sub': this.ui.subtitle(t(e.key), e.dur || 4); return;
      case 'sfx': this.audio.play(e.name, { pos: new THREE.Vector3(...e.p), vol: e.vol ?? 1, vary: e.vary || 0, ref: e.name.startsWith('warden') ? 3 : 1.8 }); return;
      case 'sting': this.audio.play(e.name, { vol: 0.9, bus: 'music', reverb: 0.3 }); return;
      case 'power': this.lights.setGroup(e.group, e.on); return;
      case 'custom': if (this.chapter.onEvent) this.chapter.onEvent(this, e); return;
      case 'spawn': {
        if (this.isHost() || this.enemyById(e.id)) return;
        const en = new Enemy(this, e.kind, e.x, e.z, Object.assign({ id: e.id, yaw: e.yaw }, e.opts || {}));
        this.enemies.push(en);
        return;
      }
      case 'ewake': { const en = this.enemyById(e.id); if (en && !this.isHost()) { en.state = 'rise'; en.stateT = 0; } return; }
      case 'edie': { const en = this.enemyById(e.id); if (en && !this.isHost()) { en.state = 'dead'; en.deadK = 0; en.dropSide = e.side; } return; }
      case 'fxb': if (e.by !== this.mySlot()) this.fx.bloodHit(new THREE.Vector3(...e.p), new THREE.Vector3(...e.d), e.pw || 1); return;
      case 'shot': if (e.slot !== this.mySlot()) this.remoteShot(e.slot, e.w); return;
      case 'locker': {
        const L = lvl.lockers.find((l) => `${l.x}_${l.z}` === e.id);
        if (L) { L.locker.occupant = e.occ; L.locker.target = 0.0; setTimeout(() => { L.locker.target = 0; }, 400); L.locker.target = 1; setTimeout(() => { L.locker.target = 0; }, 450); }
        return;
      }
      case 'downed': { const r = this.remotes.get(e.slot); if (r) this.ui.toast(r.name + t('teammateDown'), 'bad'); if (this.isHost()) this.checkWipe(); return; }
      case 'revived': return;
      case 'chapterEnd': this.showChapterDone(); return;
      case 'gameEnd': {
        this.state = 'end';
        this.input.enabled = false;
        this.input.unlockPointer();
        this.ui.showHud(false);
        if (this.mode !== 'client') { SAVE.checkpoint = null; writeSave(); }
        this.ui.ending(this.stats);
        return;
      }
      case 'wipe': {
        this.ui.toast(t('allDown'), 'bad');
        if (this.isHost()) setTimeout(() => this.restartChapter(), 1500);
        return;
      }
    }
  }

  // ================================================================= network in
  onNet(m, slot) {
    switch (m.t) {
      case 'start': {
        if (this.mode !== 'client') return;
        CFG.difficulty = m.diff || 'normal';
        if (m.restart) { this.player.reset(true); this.player.loadState(this.chapterStartInv || this.defaultLoadout(m.chapter)); }
        else if (!m.keep) { this.player.reset(true); this.player.loadState(this.defaultLoadout(m.chapter)); }
        this.setupRemotes(m.players || []);
        this.eventQueue = [];
        this.loadChapter(m.chapter, { seed: m.seed });
        return;
      }
      case 'ps': {
        const s = m.slot ?? slot;
        if (s === this.mySlot()) return;
        let r = this.remotes.get(s);
        if (!r && this.level) {
          const info = (this.net.players || []).find((p) => p.slot === s);
          r = new RemotePlayer(this, s, info ? info.name : 'P' + (s + 1));
          this.remotes.set(s, r);
        }
        if (r) r.applyState(m.s);
        return;
      }
      case 'snap': {
        if (this.isHost() || !this.level) return;
        for (const s of m.e) { const e = this.enemyById(s[0]); if (e) e.applySnapshot(s); }
        if (m.team) this.team = m.team;
        return;
      }
      case 'ev': if (!this.isHost()) this.applyEvent(m.e); return;
      case 'req': if (this.isHost()) this.handleRequest(m.r, slot); return;
      case 'dmg': {
        const o = m.opts || {};
        if (o.from) o.from = new THREE.Vector3(o.from[0], 0, o.from[1]);
        this.player.takeDamage(m.amount, o);
        return;
      }
      case 'revive': if (this.player.downed) this.player.revive(); return;
      case 'toast': this.ui.toast(m.text); this.audio.play('door_locked', { vol: 0.5 }); return;
      case 'left': this.onPlayerLeft(m.slot); return;
    }
  }

  sendPlayerState() {
    const P = this.player;
    const flags = (P.flashOn ? 1 : 0) | (P.crouch ? 2 : 0) | (P.downed ? 4 : 0) | (P.hidden ? 8 : 0) | (P.dead ? 16 : 0) | (P.sprinting ? 32 : 0);
    const s = [Math.round(P.pos.x * 100) / 100, Math.round(P.pos.z * 100) / 100, Math.round(P.yaw * 100) / 100, Math.round(P.pitch * 100) / 100, flags, P.weapon, Math.round(P.hp)];
    this.net.send({ t: 'ps', slot: this.mySlot(), s });
  }

  // ================================================================= Jonah & rescue (chapter 5 set pieces)
  spawnJonah() {
    const m = this.level.markers.jonah?.[0];
    if (!m || this.jonah) return;
    const tpl = buildCreatureTemplate('human', this.assets, this.skinDetail, this.renderer.qname, { suit: [0.09, 0.05, 0.03] });
    const inst = instantiate(tpl, this.assets);
    inst.root.position.set(m.x, 0, m.z);
    inst.root.rotation.y = Math.PI * 0.9;
    this.scene.add(inst.root);
    this.jonah = inst;
  }
  jonahTurn() {
    if (!this.jonah) return;
    const j = this.jonah;
    this.jonahTwitch = 2.5;
    setTimeout(() => {
      if (this.jonah !== j) return;
      this.scene.remove(j.root);
      this.jonah = null;
      const p = j.root.position;
      this.fx.bloodHit(new THREE.Vector3(p.x, 1.0, p.z), new THREE.Vector3(0, 0.5, 1), 1.5);
      this.audio.play('hollow_alert', { pos: p.clone().setY(1.5), vol: 1 });
      if (this.isHost()) { const e = this.spawnEnemy('hollow', p.x, p.z + 0.6, { id: 'jonahH' }); if (e) { e.setState('investigate'); e.investigate = this.player.pos.clone(); } }
    }, 2500);
  }
  spawnRescue() {
    const g = new THREE.Group();
    const gate = this.level.markers.gate?.[0] || { x: 31.5, z: 46.5 };
    const base = new THREE.Vector3(gate.x - 7, 0, gate.z + 2.5);
    for (const dz of [-0.7, 0.7]) {
      const s = new THREE.SpotLight(0xf4f0ff, 1600, 45, 0.45, 0.5, 2);
      s.position.set(base.x, 0.8, base.z + dz);
      s.target.position.set(base.x + 12, 0.3, base.z + dz * 0.3);
      s.layers.enableAll();
      g.add(s, s.target);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      lens.position.copy(s.position); lens.rotation.y = Math.PI / 2;
      g.add(lens);
    }
    const red = new THREE.PointLight(0xff1010, 0, 18, 2), blue = new THREE.PointLight(0x1040ff, 0, 18, 2);
    red.position.set(base.x, 2, base.z - 0.5); blue.position.set(base.x, 2, base.z + 0.5);
    red.layers.enableAll(); blue.layers.enableAll();
    g.add(red, blue);
    g.userData.update = (t) => { const k = Math.sin(t * 9) > 0; red.intensity = k ? 120 : 0; blue.intensity = k ? 0 : 120; };
    this.scene.add(g);
    this.rescue = g;
    this.audio.play('generator', { pos: base.clone().setY(0.6), vol: 0.8, loop: true, ref: 4, rate: 1.4 });
    this.ui.subtitle(t('s_headlights'), 4);
    this.audio.play('sting_low', { vol: 0.6, bus: 'music' });
  }

  // ================================================================= loop
  loop() {
    requestAnimationFrame(() => this.loop());
    let dt = this.clock.getDelta();
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.frame(dt);
  }

  // test helper: advance the simulation without drawing
  simulate(sec, step = 0.05) {
    for (let t = 0; t < sec; t += step) { this.time += step; this.frame(step, true); }
  }

  frame(dt, noRender) {
    const R = this.renderer;
    const t = this.time;
    if (this.state === 'menu' || this.state === 'boot' || this.state === 'loading' || !this.level) {
      R.fx.fade = 1;
      if (this.level) R.render(this.scene, this.camera, null, t);
      else { R.gl.setRenderTarget(null); R.gl.setClearColor(0x0b0a09); R.gl.clear(); }
      return;
    }
    const simulate = this.state === 'play' || this.state === 'done' || this.state === 'dead' || this.state === 'end' || (this.state === 'paused' && this.isCoop());
    const I = this.input.frame();
    const P = this.player;
    if (this.state === 'play') {
      if (I.pressed.has('pause')) { this.pause(); return; }
      if (I.pressed.has('journal')) { this.ui.openJournal(); }
      if (I.pressed.has('hitboxes')) { this.showHitboxes = !this.showHitboxes; this.ui.toast(this.showHitboxes ? 'Hit boxes: on (F9)' : 'Hit boxes: off'); }
      if (this.showHitboxes || this.hbShown) { for (const e of this.enemies) e.showHitboxes(this.showHitboxes); this.hbShown = this.showHitboxes; }
      this.stats.time += dt;
      P.update(dt, I);
      this.updateInteraction(dt, I);
    } else if (simulate) P.update(dt, { mx: 0, my: 0, lookDX: 0, lookDY: 0, pressed: new Set(), released: new Set(), held: {}, sprint: false });

    if (simulate && this.state !== 'loading') {
      // timers & chapter script (host)
      if (this.isHost()) {
        for (let i = this.timers.length - 1; i >= 0; i--) {
          const tm = this.timers[i];
          tm.t -= dt;
          if (tm.t <= 0) { this.timers.splice(i, 1); try { tm.fn(); } catch (err) { console.error(err); } }
        }
        if (this.chapter.update) this.chapter.update(this, dt);
        this.checkTriggers();
        this.directWarden(dt);
        for (const e of this.enemies) e.think(dt);
      } else for (const e of this.enemies) e.netSmooth(dt);
      for (const e of this.enemies) e.update(dt, t);
      for (const r of this.remotes.values()) r.update(dt, t, this.camera.position);
      if (this.jonah) {
        const tw = this.jonahTwitch > 0 ? (this.jonahTwitch -= dt, 1) : 0.1;
        animate(this.jonah, { phase: 0, speed: 0, t, crouch: 0.85, twitch: tw, hunch: 0.5, pitch: 0.3, armsDown: true });
      }
      if (this.rescue?.userData.update) this.rescue.userData.update(t);
      // network
      if (this.net.online) {
        this.netT -= dt;
        if (this.netT <= 0) { this.netT = 1 / 15; this.sendPlayerState(); }
        if (this.isHost()) {
          this.snapT -= dt;
          if (this.snapT <= 0) { this.snapT = 1 / 12; this.net.broadcast({ t: 'snap', e: this.enemies.map((e) => e.snapshot()), team: this.team }); }
        }
      }
    }
    // camera
    P.applyCamera(this.camera, dt, t);
    const ads = this.vm.state.ads;
    const zoom = P.weapon === 'rifle' && ads > 0.85 ? 0.32 : 1 - ads * 0.18;
    const fov = CFG.fov * zoom * (P.sprinting ? 1.06 : 1);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = damp(this.camera.fov, fov, 14, dt); this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld(true);
    this.vm.root.visible = !P.dead && !P.downed && !P.hidden && !(P.weapon === 'rifle' && ads > 0.85);
    {
      this.camera.getWorldPosition(_v); this.camera.getWorldDirection(_f);
      // crude eye adaptation: whatever the beam hits up close would blow out, so dim the torch
      const h = this.level.grid.raycast(_v.x, _v.y, _v.z, _f.x, _f.y, _f.z, 7, { props: true, ceil: this.level.ceilAt(_v.x, _v.z) });
      let d = h ? h.t : 7;
      for (const e of this.enemies) { if (!e.visibleActive()) continue; const dd = e.pos.distanceTo(_v); if (dd < d && dd < 6) { _w.set(e.pos.x - _v.x, 0, e.pos.z - _v.z).normalize(); if (_w.x * _f.x + _w.z * _f.z > 0.85) d = Math.max(0.5, dd - 0.3); } }
      for (const r of this.remotes.values()) { const dd = r.pos.distanceTo(_v); if (dd < d && dd < 6) { _w.set(r.pos.x - _v.x, 0, r.pos.z - _v.z).normalize(); if (_w.x * _f.x + _w.z * _f.z > 0.85) d = Math.max(0.5, dd - 0.3); } }
      this.flashNear = damp(this.flashNear ?? 1, clamp(Math.pow(d / 4.5, 1.3), 0.14, 1), 5, dt);
      this.flashMul = this.flashNear;
    }
    this.vm.update(dt, { lookDX: I.lookDX, lookDY: I.lookDY, speed: P.speed, sprint: P.sprinting, crouch: P.crouch, aim: P.aim, flashOn: P.flashOn && !P.dead && !P.hidden, battery: P.battery, lean: 0 }, this.camera);
    // world systems
    this.camera.getWorldDirection(_f);
    this.lights.update(dt, t, this.camera.position);
    this.level.update(dt, t, this.camera.position, _f);
    this.fx.update(dt, (p, b) => this.audio.play('tink', { pos: p.clone(), vol: 0.35 / b, rate: 0.9 + Math.random() * 0.3 }));
    this.rain.update(dt, this.camera.position, (x, z) => this.level.isOutdoorAt(x, z));
    this.dust.points.visible = this.renderer.q.dust;
    if (this.renderer.q.dust) this.dust.update(t, this.vm.spot.position, _w.copy(this.vm.spot.target.position).sub(this.vm.spot.position).normalize(), P.flashOn, R.h * R.pr);
    this.audio.setListener(this.camera.position, _f, _v.set(0, 1, 0).applyQuaternion(this.camera.quaternion));
    this.updateAtmosphere(dt, t);
    // HUD
    if (this.state === 'play') {
      this.ui.updateHud(P, { weapon: WEAPONS[P.weapon], ads, prompt: this.prompt, promptShort: this.promptShort, hold: this.holdProgress, dt, fps: this.fps });
      this.teamT = (this.teamT || 0) - dt;
      if (this.teamT <= 0 && this.remotes.size) { this.teamT = 0.5; this.ui.team([...this.remotes.values()].map((r) => ({ name: r.name, hp: r.p.hp, downed: r.p.downed, dead: r.p.dead }))); }
    }
    if (noRender) return;
    R.render(this.scene, this.camera, this.vm.root.visible ? this.vmCamera : null, t);
    this.adaptResolution(dt);
  }

  checkTriggers() {
    const lvl = this.level;
    for (const tr of lvl.triggers) {
      if (tr.fired && tr.once) continue;
      for (const P of this.allPlayers()) {
        if (P.p.dead) continue;
        if (Math.hypot(P.pos.x - tr.x, P.pos.z - tr.z) < tr.r) {
          tr.fired = true;
          if (this.chapter.onTrigger) this.chapter.onTrigger(this, tr.id, P.slot);
          break;
        }
      }
    }
  }

  directWarden(dt) {
    const w = this.warden;
    const cfg = this.wardenCfg;
    if (!w || !cfg || !cfg.enabled) return;
    if (w.state === 'absent') {
      this.wardenTimer -= dt;
      if (this.wardenTimer <= 0) {
        const spot = this.findWardenSpot();
        if (spot) { w.appear(spot.x, spot.z); this.wardenPresence = rand(...(cfg.presence || [45, 80])); this.netSound('warden_breath', w.headPos(), 0.9); }
        else this.wardenTimer = 3;
      }
    } else if (w.state !== 'chase' && w.state !== 'grab' && w.state !== 'leave' && w.state !== 'stagger') {
      this.wardenPresence -= dt;
      if (this.wardenPresence <= 0) w.startLeave();
    }
  }

  findWardenSpot() {
    const g = this.level.grid;
    const rng = Math.random;
    for (let i = 0; i < 60; i++) {
      const c = g.randomWalkable(rng);
      if (!c) continue;
      let ok = true;
      let near = Infinity;
      for (const P of this.allPlayers()) {
        const d = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
        near = Math.min(near, d);
        if (d < 13 || g.lineOfSight(P.pos.x, 1.6, P.pos.z, c.x, 1.8, c.z)) { ok = false; break; }
      }
      if (ok && near < 32) return c;
    }
    return null;
  }

  updateAtmosphere(dt, t) {
    const R = this.renderer, P = this.player, F = this.fxState;
    const hurt = clamp(1 - P.hp / 100, 0, 1);
    const br = CFG.brightness ?? 1;
    R.fx.exposure = 1.0 * br;
    R.fx.lift = clamp(0.1 + (br - 1) * 0.25, 0, 0.32);
    R.gl.toneMappingExposure = br * 1.25;
    R.fx.blood = Math.max(R.fx.blood * Math.exp(-dt * 0.6), P.hurtFlash * 0.75, P.hp < 30 ? 0.3 : 0, P.dead ? 1 : 0);
    if (CFG.blood === 'off') R.fx.blood = 0;
    R.fx.desat = clamp(hurt * hurt * 0.9 + (P.downed ? 0.6 : 0), 0, 0.95);
    R.fx.pulse = P.hp < 35 && !P.dead ? (0.5 + 0.5 * Math.sin(t * (P.hp < 20 ? 9 : 6))) * (1 - P.hp / 35) * 0.6 : 0;
    R.fx.ca = 1.0 + P.trauma * 6 + hurt * 2;
    R.fx.vignette = 0.75 + hurt * 0.25 + (P.hidden ? 0.4 : 0);
    R.fx.grain = 0.055 + hurt * 0.05;
    R.fx.blur = P.downed ? 0.6 : 0;
    R.fx.tint = P.hurtFlash * 0.12;
    F.flash = Math.max(0, F.flash - dt * (F.flashDecay || 3));
    R.fx.flash = F.flash * 0.25;
    if (this.level?.sky) this.level.sky.material.uniforms.uFlash.value = F.flash;
    if (this.level?.hemi) this.level.hemi.intensity = (this.chapter.ambient?.[2] ?? 0.3) + F.flash * 4;
    if (this.level?.moon) this.level.moon.intensity = (this.chapter.moon ?? 0.25) + F.flash * 3;
    F.fade = F.fade + Math.sign(F.fadeTarget - F.fade) * Math.min(Math.abs(F.fadeTarget - F.fade), dt * (F.fadeSpeed || 1));
    R.fx.fade = this.state === 'dead' ? 0.6 : F.fade;
    document.getElementById('fxOverlay').style.opacity = R.usePost ? 0 : Math.min(0.9, R.fx.blood * 0.8 + R.fx.pulse);
    this.audio.setHurt(P.dead ? 0.9 : P.hp < 25 ? 0.5 : 0);
    // heartbeat when a monster is near
    let nearest = Infinity;
    let chased = false;
    for (const e of this.enemies) {
      if (!e.visibleActive()) continue;
      const d = e.pos.distanceTo(P.pos);
      nearest = Math.min(nearest, d);
      if (e.state === 'chase' && e.target && e.target.p === P) chased = true;
    }
    this.heartT -= dt;
    if (nearest < 10 || P.hp < 30) {
      if (this.heartT <= 0) {
        this.heartT = clamp(nearest / 10, 0.35, 1.1) * (P.hp < 30 ? 0.7 : 1);
        this.audio.play('heart', { vol: 0.5 + (1 - Math.min(1, nearest / 10)) * 0.4, bus: 'music', reverb: 0 });
      }
    }
    this.chaseVol = damp(this.chaseVol, chased ? 0.75 : 0, chased ? 3 : 0.6, dt);
    if (this.chaseLoop) this.chaseLoop.setVol(this.chaseVol, 0.05);
  }

  adaptResolution(dt) {
    this.frameTimes.push(dt);
    this.resT += dt;
    if (this.resT < 1.5) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = Math.round(1 / avg);
    this.frameTimes = [];
    this.resT = 0;
    if (!CFG.autoRes || this.state !== 'play') return;
    const R = this.renderer;
    if (avg > 1 / 42 && R.scale > 0.56) R.setScale(R.scale - 0.08);
    else if (avg < 1 / 57 && R.scale < 1) R.setScale(R.scale + 0.04);
  }
}

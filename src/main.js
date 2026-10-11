// App shell: boots the renderer/world/viewmodel once and switches between
// modes (lobby, game, map editor, texture studio, animation studio).
import * as THREE from 'three';
import { Renderer, startLoop } from './core/renderer.js';
import { settings, saveSettings, store } from './core/settings.js';
import { el, downloadText, copyText } from './core/util.js';
import { materials } from './gfx/materials.js';
import { World } from './world/world.js';
import { makeKasbah } from './world/maps/kasbah.js';
import { ViewModel } from './weapons/viewmodel.js';
import { Game } from './game/game.js';
import { makeWeaponIcons } from './game/hud.js';
import { input } from './game/input.js';
import { audio } from './game/audio.js';
import { Lobby } from './ui/lobby.js';
import { openSettings } from './ui/settings.js';
import { TITLE, VERSION } from './app-info.js';
import { Character } from './game/character.js';

class App {
  constructor() {
    this.renderer = new Renderer(document.getElementById('app'));
    materials.init(this.renderer.r);
    this.world = new World(this.renderer);
    this.vm = new ViewModel();
    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.03, 1500);
    this.renderer.onResize = (w, h) => {
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      if (this.world.effects) this.world.effects.setViewport(h * this.renderer.r.getPixelRatio(), this.camera.fov);
    };
    this.mode = null; this.selectedMap = '__builtin';
    input.attach(this.renderer.canvas);
    this.renderer.canvas.addEventListener('click', () => { audio.unlock(); if (this.mode instanceof Game && !this.mode.paused && !this.mode.over) input.lock(); });
    addEventListener('pointerdown', () => audio.unlock(), { once: false, passive: true });
  }

  loading(on, text, frac) {
    let l = document.getElementById('loading');
    if (!l) {
      l = el('div', { id: 'loading' }, el('div', { class: 'logo big' }, TITLE, el('small', {}, 'v' + VERSION)), el('div', { class: 'lbar' }, el('i')), el('div', { class: 'ltxt' }), el('div', { class: 'ltip' }, 'Tip: every texture, map and animation is editable in the DEV TOOLS — export and share your work.'));
      document.body.appendChild(l);
    }
    l.style.display = on ? 'flex' : 'none';
    if (text) l.querySelector('.ltxt').textContent = text;
    if (frac !== undefined) l.querySelector('.lbar i').style.width = Math.round(frac * 100) + '%';
  }

  async boot() {
    this.loading(true, 'Starting engine', 0.05);
    await new Promise((r) => setTimeout(r, 30));
    this.loading(true, 'Building weapons', 0.1);
    await this.vm.init();
    await this.vm.preload(['rifle', 'pistol', 'sniper', 'knife']);
    await makeWeaponIcons(this.renderer.r);
    await this.loadMap('__builtin');
    this.renderer.onResize(innerWidth, innerHeight);
    this.loading(false);
    this.toLobby();
    startLoop((dt, disp) => this.tick(dt, disp));
    // test hooks: ?autostart=tdm|practice
    const q = new URLSearchParams(location.search);
    if (q.get('autostart')) { await this.startGame({ mode: q.get('autostart'), map: '__builtin' }); }
    window.__ready = true;
  }

  mapData(key) {
    if (!key || key === '__builtin') return makeKasbah();
    const maps = store.get('maps', {});
    return maps[key] || makeKasbah();
  }
  async loadMap(key, data) {
    const map = data || this.mapData(key);
    const sig = key + '|' + JSON.stringify(map).length + '|' + settings.quality;
    if (this._mapSig === sig && !data) return;
    this.loading(true, 'Building map', 0.2);
    await this.world.load(map, { onProgress: (f, s) => this.loading(true, s || 'Building map', 0.2 + f * 0.7) });
    this.world.nav = null;
    this._mapSig = data ? null : sig;
    this.mapKey = key;
  }

  setMode(m) { if (this.mode && this.mode.destroy) this.mode.destroy(); this.mode = m; }
  toLobby() { this.setMode(null); input.enabled = false; this.setMode(new Lobby(this)); }

  async startGame(opts) {
    this.lastOpts = opts;
    this.setMode(null);
    await this.loadMap(opts.map || this.selectedMap, opts.mapData);
    this.loading(true, 'Preparing match', 0.92);
    const g = new Game(this, opts);
    await g.start((f, s) => this.loading(true, s, 0.9 + f * 0.1));
    this.loading(false);
    this.camera.fov = settings.fov; this.camera.updateProjectionMatrix();
    this.renderer.onResize(innerWidth, innerHeight);
    this.mode = g;
    if (opts.afterStart) opts.afterStart(g);
  }
  restartGame() { this.startGame(this.lastOpts || { mode: 'tdm' }); }
  inspectShowcase(id) {
    const slot = id === 'pistol' ? 'pistol' : id === 'knife' ? 'knife' : 'primary';
    const primary = slot === 'primary' ? id : settings.primary;
    audio.unlock();
    this.startGame({ mode: 'practice', primary, map: this.selectedMap, afterStart: async (g) => { if (slot !== 'primary') await g.player.equip(slot); setTimeout(() => this.vm.play('inspect'), 900); } });
  }

  async openTool(kind) {
    audio.unlock();
    this.setMode(null);
    this.loading(true, 'Opening tool', 0.5);
    let M;
    if (kind === 'map') M = (await import('./editors/mapeditor.js')).MapEditor;
    else if (kind === 'texture') M = (await import('./editors/texstudio.js')).TextureStudio;
    else M = (await import('./editors/animstudio.js')).AnimStudio;
    const m = new M(this);
    if (m.init) await m.init();
    this.loading(false);
    this.mode = m;
  }

  openSettings(onClose) { return openSettings(this, onClose); }
  applySettings() {
    this.renderer.applySettings();
    this.world.applyQuality();
    if (this.mode && this.mode.hud) this.mode.hud.applyCrosshair();
    audio.setVolume(settings.volume);
  }

  exportPack() {
    const pack = { format: 'strikepoint-pack', version: 1, exported: new Date().toISOString(), maps: store.get('maps', {}), textures: store.get('textures', {}), anims: store.get('anims', {}) };
    const n = Object.keys(pack.maps).length + Object.keys(pack.textures).length + Object.keys(pack.anims).length;
    const json = JSON.stringify(pack, null, 1);
    const box = el('div', { class: 'modal show' }, el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'EXPORT YOUR WORK'), el('button', { class: 'x', onclick: () => box.remove() }, '✕')),
      el('p', {}, n ? `This pack contains ${Object.keys(pack.maps).length} map(s), ${Object.keys(pack.textures).length} texture(s) and ${Object.keys(pack.anims).length} animation(s).` : 'You have no custom maps, textures or animations yet. Make something in the DEV TOOLS first!'),
      el('p', { class: 'hint' }, 'Download the file (or copy the JSON) and send it — it can be merged into the game as new built-in content.'),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn primary', onclick: () => downloadText('strikepoint-pack.json', json) }, 'DOWNLOAD .JSON'),
        el('button', { class: 'btn', onclick: async (e) => { const ok = await copyText(json); e.currentTarget.textContent = ok ? 'COPIED!' : 'COPY FAILED'; } }, 'COPY JSON')),
      el('p', { class: 'hint' }, 'Import a pack someone sent you:'),
      el('button', { class: 'btn ghost', onclick: () => this.importPack() }, 'IMPORT PACK…')));
    document.getElementById('ui').appendChild(box);
  }
  async importPack() {
    const { pickFile, readFileText } = await import('./core/util.js');
    const f = await pickFile('.json,application/json'); if (!f) return;
    try {
      const p = JSON.parse(await readFileText(f));
      if (p.maps) store.set('maps', { ...store.get('maps', {}), ...p.maps });
      if (p.textures) { for (const k in p.textures) materials.saveCustom(k, p.textures[k]); }
      if (p.anims) { const a = { ...store.get('anims', {}), ...p.anims }; store.set('anims', a); }
      alert('Pack imported. Reloading…'); location.reload();
    } catch (e) { alert('Could not read pack: ' + e.message); }
  }

  tick(dt, disp) {
    this.renderer.displayInterval = disp;
    if (this.mode) { this.mode.update(dt); this.mode.render(); }
    this.renderer.trackFrame(dt);
  }
}

// ---------------------------------------------------------------- boot
window.addEventListener('error', (e) => { const b = document.getElementById('err'); if (b) { b.style.display = 'block'; b.textContent += (e.message || e) + '\n'; } });
const q = new URLSearchParams(location.search);
if (q.has('dbg')) {
  import('./debug.js').then((m) => m.runDebug());
} else {
  const app = new App();
  window.__app = app; window.__dbg = { THREE, Character };
  app.boot().catch((e) => { console.error(e); const b = document.getElementById('err'); if (b) { b.style.display = 'block'; b.textContent = 'Startup error: ' + e.message + '\n' + (e.stack || ''); } });
  void saveSettings;
}

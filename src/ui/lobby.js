// Lobby: cinematic map flyover + 3D weapon showcase turntable, play menu,
// loadout, map choice and the dev tools.
import * as THREE from 'three';
import { el } from '../core/util.js';
import { settings, saveSettings, store } from '../core/settings.js';
import { buildWeaponModel } from '../weapons/models.js';
import { WEAPONS } from '../weapons/weapons.js';
import { weaponIcon } from '../game/hud.js';
import { audio } from '../game/audio.js';
import { TITLE } from '../app-info.js';

export class Lobby {
  constructor(app) {
    this.app = app; this.t = 0;
    this.ui = el('div', { class: 'lobby' }); document.getElementById('ui').appendChild(this.ui);
    this.showcase = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(30, 1, 0.01, 10) };
    const sc = this.showcase.scene;
    const key = new THREE.DirectionalLight(0xfff0dd, 3.2); key.position.set(-1, 2, 2); sc.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 2.2); rim.position.set(2, 1, -2); sc.add(rim);
    sc.add(new THREE.HemisphereLight(0xcfe2ff, 0x6b5a45, 0.6));
    this.turn = new THREE.Group(); sc.add(this.turn);
    this.build();
    this.setWeapon(settings.primary || 'rifle');
  }

  async setWeapon(id) {
    this.weaponId = id;
    const m = await buildWeaponModel(WEAPONS[id].kind);
    if (this.weaponId !== id) return;
    this.turn.clear();
    const box = new THREE.Box3().setFromObject(m.root), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    m.root.position.sub(c);
    const s = 0.9 / Math.max(size.z, 0.3);
    const g = new THREE.Group(); g.add(m.root); g.scale.setScalar(s); g.rotation.y = Math.PI / 2;
    this.turn.add(g);
    this.stats.innerHTML = '';
    const d = WEAPONS[id];
    const bar = (label, v) => el('div', { class: 'stat' }, el('span', {}, label), el('div', { class: 'bar' }, el('i', { style: { width: Math.round(Math.min(1, v) * 100) + '%' } })));
    this.stats.append(el('h3', {}, d.name), d.melee ? bar('Damage', 0.6) : bar('Damage', d.dmg / 120), d.melee ? '' : bar('Fire rate', Math.min(1, 0.08 / d.delay * 1.2)), d.melee ? '' : bar('Accuracy', 1 - d.spread * 60), bar('Mobility', d.speed / 6.2));
  }

  build() {
    const s = settings;
    const nameIn = el('input', { class: 'name-in', value: s.name || '', maxlength: 14, placeholder: 'YOUR NAME' });
    nameIn.addEventListener('input', () => { s.name = nameIn.value.toUpperCase().replace(/[^A-Z0-9_ -]/g, ''); saveSettings(); });
    const userMaps = store.get('maps', {});
    const mapSel = el('select', { class: 'sel' }, el('option', { value: '__builtin' }, 'Kasbah (built-in)'), ...Object.keys(userMaps).map((k) => el('option', { value: k }, k + ' (custom)')));
    mapSel.value = this.app.selectedMap || '__builtin';
    mapSel.addEventListener('change', () => { this.app.selectedMap = mapSel.value; });
    const prim = el('div', { class: 'loadout' });
    const drawPrim = () => {
      prim.innerHTML = '';
      for (const id of ['rifle', 'sniper']) {
        const b = el('button', { class: 'wcard' + (s.primary === id ? ' on' : ''), onclick: () => { s.primary = id; saveSettings(); drawPrim(); this.setWeapon(id); audio.play('uiClick'); } }, el('img', { src: weaponIcon(id), alt: '' }), el('span', {}, WEAPONS[id].name));
        prim.appendChild(b);
      }
      for (const id of ['pistol', 'knife']) prim.appendChild(el('button', { class: 'wcard sm', onclick: () => this.setWeapon(id) }, el('img', { src: weaponIcon(id), alt: '' }), el('span', {}, WEAPONS[id].name)));
    };
    drawPrim();
    const diff = el('div', { class: 'seg' }, ...['easy', 'normal', 'hard'].map((d) => el('button', { class: s.botDifficulty === d ? 'on' : '', onclick: (e) => { s.botDifficulty = d; saveSettings(); [...diff.children].forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); } }, d.toUpperCase())));
    const play = (mode) => { audio.unlock(); audio.play('uiClick'); this.app.startGame({ mode, map: mapSel.value }); };

    this.stats = el('div', { class: 'wstats' });
    this.ui.append(
      el('div', { class: 'lobby-top' }, el('div', { class: 'logo' }, TITLE.split(' ')[0], el('small', {}, 'TACTICAL SHOOTER')), el('div', { class: 'top-right' }, nameIn, el('button', { class: 'icon-btn', title: 'Settings', onclick: () => { audio.unlock(); this.app.openSettings(); } }, '⚙'))),
      el('div', { class: 'lobby-left' },
        el('button', { class: 'btn play', onclick: () => play('tdm') }, el('b', {}, 'PLAY'), el('small', {}, 'Team Deathmatch · 5v5 vs bots')),
        el('button', { class: 'btn', onclick: () => play('practice') }, el('b', {}, 'PRACTICE'), el('small', {}, 'Free roam · try weapons & maps')),
        el('div', { class: 'group' }, el('label', {}, 'MAP'), mapSel),
        el('div', { class: 'group' }, el('label', {}, 'BOTS'), diff),
        el('div', { class: 'group' }, el('label', {}, 'LOADOUT'), prim)),
      el('div', { class: 'lobby-right' }, this.stats, el('button', { class: 'btn ghost sm', onclick: () => this.app.inspectShowcase(this.weaponId) }, 'INSPECT IN FIRST PERSON')),
      el('div', { class: 'lobby-dev' },
        el('div', { class: 'dev-title' }, 'DEV TOOLS'),
        el('button', { class: 'btn dev', onclick: () => this.app.openTool('map') }, '🗺 MAP EDITOR'),
        el('button', { class: 'btn dev', onclick: () => this.app.openTool('texture') }, '🎨 TEXTURE STUDIO'),
        el('button', { class: 'btn dev', onclick: () => this.app.openTool('anim') }, '🎬 ANIMATION STUDIO'),
        el('button', { class: 'btn dev', onclick: () => this.app.exportPack() }, '📦 EXPORT ALL (SEND THIS)')),
      el('div', { class: 'lobby-foot' }, settings.isTouch ? 'Touch controls enabled' : 'Click PLAY · WASD + mouse · R reload · F inspect'),
    );
  }

  update(dt) {
    this.t += dt;
    const cam = this.app.camera;
    // slow cinematic orbit over the map
    const b = this.app.world.map.bounds;
    const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2, R = Math.max(b[2] - b[0], b[3] - b[1]) * 0.42;
    const a = this.t * 0.035 + 0.6;
    cam.position.set(cx + Math.cos(a) * R, 15 + Math.sin(this.t * 0.07) * 3, cz + Math.sin(a) * R);
    cam.lookAt(cx + Math.cos(a + 1.2) * R * 0.2, 2, cz + Math.sin(a + 1.2) * R * 0.2);
    cam.fov = 55; cam.updateProjectionMatrix();
    this.turn.rotation.y = this.t * 0.5;
    this.turn.rotation.x = Math.sin(this.t * 0.6) * 0.12;
    const sc = this.showcase;
    sc.camera.aspect = cam.aspect;
    // place the weapon on the right side of the screen
    const narrow = cam.aspect < 1.2;
    sc.camera.position.set(narrow ? 0 : -0.42, narrow ? 0.45 : 0.05, 2.6); sc.camera.lookAt(narrow ? 0 : -0.42, narrow ? 0.45 : 0.05, 0);
    sc.camera.updateProjectionMatrix();
    sc.scene.environment = this.app.world.scene.environment;
    this.app.world.update(dt);
  }
  render() { this.app.renderer.render({ scene: this.app.world.scene, camera: this.app.camera }, this.showcase); }
  destroy() { this.ui.remove(); }
}

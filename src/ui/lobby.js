// Main menu (Standoff 2 style): profile bar with level + coins, PLAY /
// INVENTORY / CASES / DEV TOOLS tabs, 3D weapon showcase with the equipped
// skin over a cinematic map flyover, loadout slots and the case roulette.
import * as THREE from 'three';
import { el } from '../core/util.js';
import { settings, saveSettings, store } from '../core/settings.js';
import { buildWeaponModel } from '../weapons/models.js';
import { WEAPONS, PRIMARIES, SECONDARIES, KNIVES } from '../weapons/weapons.js';
import { SKINS, RARITIES, RARITY_ORDER, applySkin, condition } from '../weapons/skins.js';
import { profile, CASES, ODDS } from '../core/profile.js';
import { thumb, thumbImg, initThumbs } from './thumbs.js';
import { audio } from '../game/audio.js';

const SLOT_LIST = { primary: PRIMARIES, secondary: SECONDARIES, knife: KNIVES };
const SLOT_NAME = { primary: 'PRIMARY', secondary: 'SECONDARY', knife: 'KNIFE' };
const FILTERS = [['all', 'ALL'], ['rifle', 'RIFLES'], ['sniper', 'SNIPERS'], ['smg', 'SMG'], ['shotgun', 'SHOTGUNS'], ['pistol', 'PISTOLS'], ['knife', 'KNIVES']];
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const rcol = (skinId) => (SKINS[skinId] ? RARITIES[SKINS[skinId].rarity].color : '#8b96a6');
const wname = (w) => (WEAPONS[w] ? WEAPONS[w].name : w);
const isKnife = (w) => WEAPONS[w] && WEAPONS[w].slot === 'knife';
const star = (w) => (isKnife(w) && w !== 'knife' ? '★ ' : '');
const click = () => audio.play(audio.pick('uiClick'), { vol: 0.5 });
const coinTag = (n) => el('span', { class: 'ctag' }, el('i', { class: 'coin' }), fmt(n));
function paint(e, color) { e.style.setProperty('--rc', color); e.style.setProperty('--rcg', hexA(color, 0.32)); return e; }

// glow + dim layer drawn behind the showcase weapon (darkens the map and
// adds a rarity colored glow without tinting the weapon itself)
function makeBackdrop() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uDim: { value: 0 }, uGlow: { value: new THREE.Color(0, 0, 0) }, uC: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uK: { value: 3 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: `uniform float uDim, uAspect, uK; uniform vec3 uGlow; uniform vec2 uC; varying vec2 vUv;
      void main(){ vec2 d = (vUv * 2.0 - 1.0 - uC) * vec2(uAspect, 1.0); float g = exp(-dot(d, d) * uK); gl_FragColor = vec4(uGlow * g, uDim); }`,
    // opaque queue + lowest renderOrder: drawn before the weapon (transparent
    // objects would be drawn after it and darken it too); blending still applies
    transparent: false, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

export class Lobby {
  constructor(app) {
    this.app = app; this.t = 0; this.spin = 0; this.drag = null; this.idle = 0;
    this.mode = settings.menuMode === 'practice' ? 'practice' : 'tdm';
    this.slot = 'primary';
    this.models = new Map(); this.cur = null; this._seq = 0;
    this.lay = { x: 0.34, y: 0.02, s: 1, dim: 0, k: 3, glow: new THREE.Color(0, 0, 0) };
    this.v = { x: 0.34, y: 0.02, s: 0.001, dim: 0, k: 3, glow: new THREE.Color(0, 0, 0) };
    this.showcase = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(30, 1, 0.01, 10) };
    const sc = this.showcase.scene;
    const key = new THREE.DirectionalLight(0xfff0dd, 3.0); key.position.set(-1, 2, 2); sc.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 2.2); rim.position.set(2, 1, -2); sc.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(0.5, -1, 2); sc.add(fill);
    sc.add(new THREE.HemisphereLight(0xcfe2ff, 0x6b5a45, 0.6));
    this.backdrop = makeBackdrop(); sc.add(this.backdrop);
    this.turn = new THREE.Group(); sc.add(this.turn);
    initThumbs(app.renderer.r, app.world.scene.environment);
    this.ui = el('div', { class: 'menu' }); document.getElementById('ui').appendChild(this.ui);
    this.build();
    this.unsub = profile.onChange(() => this.refreshTop());
    this.go('home');
  }

  // ------------------------------------------------------------ 3D showcase
  async show(kind, skin, opts = {}) {
    const seq = ++this._seq;
    if (!this.models.has(kind)) this.models.set(kind, buildWeaponModel(kind));
    const m = await this.models.get(kind);
    if (seq !== this._seq) return;
    if (this.cur && this.cur.undo) this.cur.undo();
    this.turn.clear();
    const root = m.root;
    root.position.set(0, 0, 0); root.quaternion.identity();
    if (m.nodes.handleA) m.nodes.handleA.rotation.x = 0;
    if (m.nodes.handleB) m.nodes.handleB.rotation.x = 0;
    const undo = skin ? applySkin(root, skin.id, { wear: skin.wear, seed: skin.seed }) : null;
    const fit = new THREE.Group(); fit.add(root);
    const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    root.position.sub(c);
    const s = (isKnife(kind) ? 0.62 : 0.95) / Math.max(size.z, 0.2);
    fit.scale.setScalar(s); fit.rotation.y = Math.PI / 2;
    this.turn.add(fit);
    this.cur = { kind, skin, undo };
    if (opts.pop) this.v.s = 0.001;
  }
  // weapon at normalized screen position x,y (-1..1), size s; dim darkens the
  // map; glow = rarity color behind the weapon (k = falloff)
  layout(x, y, s, dim = 0, glow = null, gain = 0.2, k = 4) {
    Object.assign(this.lay, { x, y, s, dim, k });
    this.lay.glow.set(0, 0, 0);
    if (glow) this.lay.glow.set(glow).multiplyScalar(gain);
  }

  // ------------------------------------------------------------ build
  build() {
    const tab = (id, label) => el('button', { class: 'm-tab', 'data-v': id, onclick: () => { click(); this.go(id); } }, label);
    this.nameIn = el('input', { class: 'm-name', value: settings.name || '', maxlength: 14, placeholder: 'PLAYER', spellcheck: 'false' });
    this.nameIn.addEventListener('input', () => { settings.name = this.nameIn.value.toUpperCase().replace(/[^A-Z0-9_ -]/g, ''); saveSettings(); this.refreshTop(); });
    this.nameIn.addEventListener('change', () => { this.nameIn.value = settings.name; });
    this.views = { home: this.buildHome(), inv: el('div', { class: 'view v-inv' }), cases: el('div', { class: 'view v-cases' }), dev: this.buildDev() };
    this.ui.append(
      this.dragEl = el('div', { class: 'm-drag' }),
      el('div', { class: 'm-shade' }),
      el('div', { class: 'm-top' },
        el('div', { class: 'm-prof' }, this.avaEl = el('div', { class: 'm-ava' }),
          el('div', { class: 'm-pinfo' }, this.nameIn, el('div', { class: 'm-lvl' }, this.lvlEl = el('span'), el('div', { class: 'm-xp' }, this.xpEl = el('i'))))),
        this.nav = el('div', { class: 'm-nav' }, tab('home', 'PLAY'), tab('inv', 'INVENTORY'), tab('cases', 'CASES'), tab('dev', 'DEV TOOLS')),
        el('div', { class: 'm-right' },
          this.coinEl = el('div', { class: 'm-coins', title: 'Coins — win matches to earn more' }, el('i', { class: 'coin' }), this.coinNum = el('b')),
          el('button', { class: 'm-icon', title: 'Settings', onclick: () => { audio.unlock(); click(); this.app.openSettings(); } }, '⚙'))),
      this.body = el('div', { class: 'm-body' }, ...Object.values(this.views)));
    this.bindDrag();
    this.refreshTop();
  }

  bindDrag() {
    const d = this.dragEl;
    d.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, spin: this.spin }; d.setPointerCapture(e.pointerId); });
    d.addEventListener('pointermove', (e) => { if (this.drag) { this.spin = this.drag.spin + (e.clientX - this.drag.x) * 0.012; this.idle = 0; } });
    const up = () => { this.drag = null; this.idle = 0; };
    d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
  }

  refreshTop() {
    const lv = profile.level;
    this.avaEl.textContent = (settings.name || 'P')[0];
    this.lvlEl.textContent = 'LVL ' + lv.level;
    this.xpEl.style.width = Math.round(lv.frac * 100) + '%';
    this.coinNum.textContent = fmt(profile.coins);
    if (this.openBtn) this.updateOpenBtn();
  }
  bumpCoins(ok = true) {
    const c = this.coinEl; c.classList.remove('bump', 'no'); void c.offsetWidth; c.classList.add(ok ? 'bump' : 'no');
  }

  go(view) {
    this.view = view;
    for (const t of this.nav.children) t.classList.toggle('on', t.dataset.v === view);
    for (const k in this.views) this.views[k].classList.toggle('on', k === view);
    this.ui.dataset.view = view;
    if (view === 'home') { this.drawLoadout(); this.showSlot(this.slot); }
    if (view === 'inv') this.drawInventory();
    if (view === 'cases') this.drawCases();
    if (view === 'dev') { this.layout(0.5, 0.0, 0.8, 0.45); }
  }

  // ------------------------------------------------------------ home
  buildHome() {
    const s = settings;
    const userMaps = store.get('maps', {});
    const mapSel = el('select', { class: 'sel' }, el('option', { value: '__builtin' }, 'Kasbah'), ...Object.keys(userMaps).map((k) => el('option', { value: k }, k + ' (custom)')));
    mapSel.value = this.app.selectedMap || '__builtin';
    mapSel.addEventListener('change', () => { this.app.selectedMap = mapSel.value; });
    const diff = el('div', { class: 'seg' }, ...['easy', 'normal', 'hard'].map((d) => el('button', { class: s.botDifficulty === d ? 'on' : '', onclick: (e) => { s.botDifficulty = d; saveSettings(); [...diff.children].forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); click(); } }, d.toUpperCase())));
    const modes = el('div', { class: 'h-modes' });
    const drawModes = () => {
      modes.innerHTML = '';
      const card = (id, title, sub) => el('button', { class: 'mode' + (this.mode === id ? ' on' : ''), onclick: () => { this.mode = id; settings.menuMode = id; saveSettings(); click(); drawModes(); this.playSub.textContent = this.modeLabel(); } }, el('b', {}, title), el('small', {}, sub));
      modes.append(card('tdm', 'TEAM DEATHMATCH', '5 vs 5 · first to 40 kills · earns coins'), card('practice', 'PRACTICE', 'Free roam · try weapons, skins & maps'),
        el('div', { class: 'h-opts' }, el('div', { class: 'group' }, el('label', {}, 'MAP'), mapSel), el('div', { class: 'group' }, el('label', {}, 'BOTS'), diff)));
    };
    drawModes();
    this.playBtn = el('button', { class: 'h-play', onclick: () => this.play() }, el('b', {}, 'PLAY'), this.playSub = el('small', {}, this.modeLabel()));
    this.loadoutEl = el('div', { class: 'h-loadout' });
    this.pickerEl = el('div', { class: 'h-picker' });
    this.showLabel = el('div', { class: 'h-show' });
    this.mapSel = mapSel;
    return el('div', { class: 'view v-home' }, modes, this.showLabel, this.pickerEl, this.loadoutEl, this.playBtn,
      el('div', { class: 'h-foot' }, settings.isTouch ? 'Drag the weapon to rotate it' : 'WASD + mouse · R reload · F inspect · drag the weapon to rotate'));
  }
  modeLabel() { return this.mode === 'tdm' ? 'TEAM DEATHMATCH · 5v5' : 'PRACTICE · FREE ROAM'; }
  play() {
    audio.unlock(); click();
    this.app.startGame({ mode: this.mode, map: this.mapSel.value });
  }

  drawLoadout() {
    const L = profile.loadout();
    this.loadoutEl.innerHTML = '';
    for (const slot of ['primary', 'secondary', 'knife']) {
      const w = L[slot], it = profile.equippedItem(w), sk = it ? SKINS[it.skin] : null;
      const card = el('button', { class: 'slot-card' + (this.slot === slot ? ' on' : ''), onclick: () => { click(); this.slot = slot; this.showSlot(slot); this.drawLoadout(); this.drawPicker(slot); } },
        el('span', { class: 'sc-slot' }, SLOT_NAME[slot]),
        thumbImg(w, it ? it.skin : null, it ? it.seed : 0),
        el('div', { class: 'sc-name' }, el('b', {}, star(w) + wname(w)), el('small', {}, sk ? sk.name : 'Default')));
      paint(card, sk ? RARITIES[sk.rarity].color : '#5d6878');
      this.loadoutEl.appendChild(card);
    }
  }
  drawPicker(slot) {
    const p = this.pickerEl;
    if (p.dataset.slot === slot && p.classList.contains('on')) { p.classList.remove('on'); p.dataset.slot = ''; return; }
    p.innerHTML = ''; p.dataset.slot = slot; p.classList.add('on');
    const L = profile.loadout();
    for (const w of SLOT_LIST[slot]) {
      const owned = slot !== 'knife' || profile.ownsKnife(w);
      const it = profile.equippedItem(w);
      const b = el('button', { class: 'pick' + (L[slot] === w ? ' on' : '') + (owned ? '' : ' locked'), onclick: () => {
        if (!owned) { this.toast('Get a ' + wname(w) + ' from a case first'); return; }
        click(); profile.setLoadout(slot, w); this.showSlot(slot); this.drawLoadout(); p.classList.remove('on'); p.dataset.slot = '';
      } }, thumbImg(w, it ? it.skin : null, it ? it.seed : 0), el('b', {}, star(w) + wname(w)), owned ? null : el('small', {}, '🔒 CASE DROP'));
      paint(b, it ? rcol(it.skin) : '#5d6878');
      p.appendChild(b);
    }
  }
  showSlot(slot) {
    const w = profile.loadout()[slot];
    const sk = profile.skinFor(w);
    this.show(w, sk);
    this.layout(0.36, 0.06, 1, 0);
    this.drawShowLabel(w, profile.equippedItem(w));
  }
  drawShowLabel(w, it) {
    const s = it ? SKINS[it.skin] : null, c = s ? RARITIES[s.rarity].color : '#8b96a6';
    this.showLabel.innerHTML = '';
    this.showLabel.append(...[
      el('div', { class: 'hs-w' }, star(w) + wname(w)),
      el('div', { class: 'hs-s' }, s ? s.name : 'Default finish'),
      s ? el('div', { class: 'hs-r' }, RARITIES[s.rarity].name.toUpperCase() + (s.p !== 'none' ? ' · ' + condition(it.wear).name.toUpperCase() : '')) : null,
      el('button', { class: 'btn ghost sm', onclick: () => { click(); this.app.inspectShowcase(w, profile.skinFor(w)); } }, 'INSPECT IN FIRST PERSON')].filter(Boolean));
    paint(this.showLabel, c);
  }

  // ------------------------------------------------------------ inventory
  drawInventory(selUid) {
    const v = this.views.inv;
    v.innerHTML = '';
    this.invFilter = this.invFilter || 'all';
    const items = profile.inventory.filter((it) => this.invFilter === 'all' || (WEAPONS[SKINS[it.skin].weapon] || {}).cls === this.invFilter)
      .sort((a, b) => RARITY_ORDER.indexOf(SKINS[b.skin].rarity) - RARITY_ORDER.indexOf(SKINS[a.skin].rarity) || b.t - a.t);
    const chips = el('div', { class: 'chips' }, ...FILTERS.map(([k, l]) => el('button', { class: 'chip' + (this.invFilter === k ? ' on' : ''), onclick: () => { click(); this.invFilter = k; this.drawInventory(); } }, l)));
    const grid = el('div', { class: 'grid' });
    const detail = el('div', { class: 'inv-detail' });
    const total = profile.inventory.reduce((s, it) => s + profile.itemValue(it), 0);
    v.append(el('div', { class: 'inv-left' }, el('div', { class: 'inv-head' }, el('b', {}, 'INVENTORY'), el('span', {}, profile.inventory.length + ' items · value '), coinTag(total)), chips, grid), detail);
    if (!items.length) {
      grid.appendChild(el('div', { class: 'empty' }, el('b', {}, profile.inventory.length ? 'Nothing in this category' : 'Your inventory is empty'), el('p', {}, 'Open cases to get weapon skins and knives. Win matches to earn coins.'),
        el('button', { class: 'btn primary sm', onclick: () => { click(); this.go('cases'); } }, 'GO TO CASES')));
      detail.style.display = 'none';
      this.layout(0.62, 0.2, 0.8, 0.72);
      const w = profile.loadout().primary; this.show(w, profile.skinFor(w));
      return;
    }
    let sel = items.find((it) => it.uid === (selUid || this.invSel)) || items[0];
    const select = (it) => {
      sel = it; this.invSel = it.uid;
      for (const c of grid.children) c.classList.toggle('sel', c.dataset.uid === it.uid);
      this.drawDetail(detail, it);
      this.show(SKINS[it.skin].weapon, { id: it.skin, wear: it.wear, seed: it.seed });
      this.layout(0.62, 0.2, 0.8, 0.72, rcol(it.skin), 0.16, 3.5);
    };
    for (const it of items) grid.appendChild(this.itemCard(it, () => { click(); select(it); }));
    select(sel);
  }
  itemCard(it, onclick, extraClass = '') {
    const s = SKINS[it.skin], w = s.weapon;
    const c = el('button', { class: 'item ' + extraClass + (profile.isEquipped(it.uid) ? ' eq' : ''), 'data-uid': it.uid || '', onclick },
      thumbImg(w, it.skin, it.seed || 0),
      el('div', { class: 'it-name' }, el('small', {}, star(w) + wname(w)), el('b', {}, s.name)),
      it.wear !== undefined && s.p !== 'none' ? el('span', { class: 'it-tag' }, condition(it.wear).short) : null,
      it.uid && profile.isEquipped(it.uid) ? el('span', { class: 'it-eq' }, 'EQUIPPED') : null);
    return paint(c, RARITIES[s.rarity].color);
  }
  drawDetail(d, it) {
    const s = SKINS[it.skin], w = s.weapon, r = RARITIES[s.rarity], cond = condition(it.wear), val = profile.itemValue(it);
    const eq = profile.isEquipped(it.uid);
    d.innerHTML = ''; d.style.display = '';
    let sellArm = false;
    const sellBtn = el('button', { class: 'btn sm sell', onclick: () => {
      if (!sellArm) { sellArm = true; sellBtn.firstChild.textContent = 'CONFIRM SELL '; click(); return; }
      const got = profile.sell(it.uid); audio.play(audio.pick('coins', 'uiClick'), { vol: 0.6 }); this.bumpCoins(); this.toast('Sold for ' + fmt(got) + ' coins');
      this.invSel = null; this.drawInventory();
    } }, el('span', {}, 'SELL '), coinTag(val));
    d.append(
      el('div', { class: 'id-r' }, r.name.toUpperCase() + (isKnife(w) && w !== 'knife' ? ' · KNIFE' : '')),
      el('div', { class: 'id-n' }, star(w) + wname(w) + ' | ' + s.name),
      s.p !== 'none' ? el('div', { class: 'id-wear' }, el('div', { class: 'wear-bar' }, el('i', { style: { left: (it.wear * 100).toFixed(1) + '%' } })), el('span', {}, cond.name + ' · ' + it.wear.toFixed(4) + ' · pattern ' + it.seed)) : el('div', { class: 'id-wear' }, el('span', {}, 'Vanilla finish')),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn primary sm', onclick: () => { click(); if (eq) profile.unequip(w); else profile.equipItem(it.uid); this.drawInventory(it.uid); } }, eq ? 'UNEQUIP' : 'EQUIP'),
        el('button', { class: 'btn sm', onclick: () => { click(); this.app.inspectShowcase(w, { id: it.skin, wear: it.wear, seed: it.seed }); } }, 'INSPECT'),
        sellBtn));
    paint(d, r.color);
  }

  // ------------------------------------------------------------ cases
  drawCases() {
    const v = this.views.cases;
    v.innerHTML = '';
    this.openBtn = null;
    this.layout(0.0, 0.0, 0.001, 0.7);
    const grid = el('div', { class: 'case-grid' });
    for (const [id, c] of Object.entries(CASES)) {
      const best = c.items.filter((k) => SKINS[k] && !isKnife(SKINS[k].weapon)).sort((a, b) => RARITY_ORDER.indexOf(SKINS[b].rarity) - RARITY_ORDER.indexOf(SKINS[a].rarity))[0];
      const card = el('button', { class: 'case', onclick: () => { click(); this.drawCase(id); } },
        el('div', { class: 'case-art', style: { background: `linear-gradient(160deg, ${c.tint[0]}, ${c.tint[1]})` } }, el('div', { class: 'case-lid' }), thumbImg(SKINS[best].weapon, best, 0, 'thumb case-thumb'), el('div', { class: 'case-knife' }, '★')),
        el('div', { class: 'case-info' }, el('b', {}, c.name), el('small', {}, c.items.length + ' items · rare special item inside')),
        el('div', { class: 'case-price' }, coinTag(c.price)));
      grid.appendChild(card);
    }
    v.append(el('div', { class: 'cases-head' }, el('b', {}, 'CASES'), el('span', {}, 'Win matches to earn coins · Victory ' + 300 + ' · Defeat ' + 120 + ' · +15 per kill')), grid);
  }
  drawCase(id) {
    const c = CASES[id], v = this.views.cases, odds = c.odds || ODDS;
    v.innerHTML = '';
    this.caseId = id;
    const items = c.items.filter((k) => SKINS[k]).sort((a, b) => RARITY_ORDER.indexOf(SKINS[a].rarity) - RARITY_ORDER.indexOf(SKINS[b].rarity));
    const grid = el('div', { class: 'cd-items' });
    for (const k of items) grid.appendChild(this.itemCard({ skin: k }, () => { click(); this.show(SKINS[k].weapon, { id: k, wear: 0.03, seed: 0 }); this.layout(0.76, 0.37, 0.5, 0.72, rcol(k), 0.14, 6); }, 'mini'));
    this.openBtn = el('button', { class: 'open-btn', onclick: () => this.openCase(id) }, el('b', {}, 'OPEN CASE'), coinTag(c.price));
    v.append(el('div', { class: 'case-detail' },
      el('div', { class: 'cd-main' },
        el('div', { class: 'cd-head' }, el('button', { class: 'btn ghost sm back', onclick: () => { click(); this.drawCases(); } }, '‹ BACK'), el('b', {}, c.name.toUpperCase()), el('span', {}, 'Contains one of the following:')),
        grid),
      el('div', { class: 'cd-side' },
        el('div', { class: 'odds' }, el('b', {}, 'DROP CHANCES'), ...['rare', 'epic', 'legendary', 'arcane', 'gold'].map((r) => paint(el('div', { class: 'odds-row' }, el('span', {}, r === 'gold' ? '★ ' + RARITIES[r].name + ' (knives)' : RARITIES[r].name), el('b', {}, odds[r] + '%')), RARITIES[r].color))),
        this.openBtn,
        this.openNote = el('div', { class: 'hint' }))));
    this.updateOpenBtn();
    this.show(SKINS[items[items.length - 1]].weapon, { id: items[items.length - 1], wear: 0.03, seed: 0 });
    this.layout(0.76, 0.37, 0.5, 0.72, RARITIES.gold.color, 0.14, 6);
    // warm the thumbnail cache for the roulette
    for (const k of items) thumb(SKINS[k].weapon, k, 0);
  }
  updateOpenBtn() {
    if (!this.openBtn || !this.caseId) return;
    const ok = profile.coins >= CASES[this.caseId].price;
    this.openBtn.classList.toggle('dis', !ok);
    if (this.openNote) this.openNote.textContent = ok ? 'Items go straight to your inventory.' : 'Not enough coins — play Team Deathmatch to earn more.';
  }

  openCase(id) {
    const c = CASES[id];
    if (this.rolling) return;
    if (profile.coins < c.price) { this.bumpCoins(false); this.toast('Not enough coins'); return; }
    audio.unlock();
    const won = profile.openCase(id);
    if (!won) return;
    this.rolling = true;
    audio.play(audio.pick('caseOpen', 'uiClick'), { vol: 0.7 });
    const N = 52, WIN = 44;
    const list = Array.from({ length: N }, (_, i) => (i === WIN ? won : profile.rollCase(id)));
    const strip = el('div', { class: 'rl-strip' }, ...list.map((it) => this.itemCard(it, null, 'rl')));
    const win = el('div', { class: 'rl-win' }, strip, el('div', { class: 'rl-mark' }));
    const ov = el('div', { class: 'roulette' }, el('div', { class: 'rl-title' }, c.name.toUpperCase()), win, el('div', { class: 'hint' }, 'Tap to skip'));
    this.ui.appendChild(ov);
    this.layout(0, 0, 0.001, 0.85);
    const card = strip.children[0], gap = 6;
    const cw = card.getBoundingClientRect().width + gap, vw = win.getBoundingClientRect().width;
    const target = WIN * cw + cw / 2 - vw / 2 + (Math.random() - 0.5) * cw * 0.8;
    const dur = 6.2;
    let t0 = performance.now(), lastIdx = -1, skip = false;
    ov.addEventListener('pointerdown', () => { if (performance.now() - t0 > 400) skip = true; });
    const step = () => {
      let u = Math.min(1, (performance.now() - t0) / 1000 / dur);
      if (skip && u < 0.97) { t0 -= (0.97 - u) * dur * 1000; u = 0.97; skip = false; }
      const e = 1 - Math.pow(1 - u, 4.2);
      const x = target * e;
      strip.style.transform = `translate3d(${-x}px,0,0)`;
      const idx = Math.floor((x + vw / 2) / cw);
      if (idx !== lastIdx) { lastIdx = idx; audio.play(audio.pick('caseTick', 'uiClick'), { vol: 0.45, pitchVar: 0.08 }); }
      if (u < 1) requestAnimationFrame(step);
      else setTimeout(() => { strip.children[WIN].classList.add('won'); setTimeout(() => { ov.remove(); this.reveal(won, id); }, 650); }, 250);
    };
    requestAnimationFrame(step);
  }
  reveal(it, caseId) {
    const s = SKINS[it.skin], w = s.weapon, r = RARITIES[s.rarity], val = profile.itemValue(it);
    this.rolling = false;
    audio.play(audio.pick('caseReveal', 'kill'), { vol: 0.75 });
    this.show(w, { id: it.skin, wear: it.wear, seed: it.seed }, { pop: true });
    this.layout(0, 0.02, isKnife(w) ? 1.25 : 1.15, 0.86, r.color, s.rarity === 'gold' ? 0.3 : 0.18, 4);
    this.views.cases.style.visibility = 'hidden';
    const close = () => { ov.remove(); this.views.cases.style.visibility = ''; this.drawCase(caseId); };
    const ov = el('div', { class: 'reveal' + (s.rarity === 'gold' ? ' gold' : '') },
      el('div', { class: 'rv-head' }, el('div', { class: 'rv-rar' }, r.name.toUpperCase()), el('div', { class: 'rv-name' }, star(w) + wname(w) + ' | ' + s.name),
        el('div', { class: 'rv-sub' }, (s.p !== 'none' ? condition(it.wear).name + ' · float ' + it.wear.toFixed(4) + ' · ' : '') + 'value ', coinTag(val))),
      el('div', { class: 'rv-btns' },
        el('button', { class: 'btn primary sm', onclick: () => { click(); profile.equipItem(it.uid); this.toast('Equipped ' + wname(w) + ' | ' + s.name); close(); } }, 'EQUIP'),
        el('button', { class: 'btn sm', onclick: () => { const got = profile.sell(it.uid); audio.play(audio.pick('coins', 'uiClick'), { vol: 0.6 }); this.bumpCoins(); this.toast('Sold for ' + fmt(got) + ' coins'); close(); } }, el('span', {}, 'SELL '), coinTag(val)),
        el('button', { class: 'btn sm', onclick: () => { click(); close(); this.openCase(caseId); } }, el('span', {}, 'OPEN AGAIN '), coinTag(CASES[caseId].price)),
        el('button', { class: 'btn ghost sm', onclick: () => { click(); close(); } }, 'CLOSE')));
    paint(ov, r.color);
    this.ui.appendChild(ov);
    this.bumpCoins();
  }

  // ------------------------------------------------------------ dev tools
  buildDev() {
    const tool = (icon, title, desc, fn) => el('button', { class: 'tool-card', onclick: () => { click(); fn(); } }, el('i', {}, icon), el('b', {}, title), el('small', {}, desc));
    return (el('div', { class: 'view v-dev' },
      el('div', { class: 'dev-grid' },
        tool('🗺', 'MAP EDITOR', 'Build maps with real props, textures and spawns', () => this.app.openTool('map')),
        tool('🎨', 'TEXTURE STUDIO', 'Make custom PBR textures for walls and floors', () => this.app.openTool('texture')),
        tool('🎬', 'ANIMATION STUDIO', 'Edit reload, inspect and draw animations', () => this.app.openTool('anim')),
        tool('📦', 'EXPORT ALL', 'Download everything you made as one file — send it', () => this.app.exportPack())),
      el('div', { class: 'dev-note' }, 'Your maps, textures and animations are saved in this browser. Export them to share.')));
  }

  toast(msg) {
    const t = el('div', { class: 'm-toast' }, msg);
    this.ui.appendChild(t);
    setTimeout(() => t.classList.add('out'), 1600);
    setTimeout(() => t.remove(), 2100);
  }

  // ------------------------------------------------------------ frame
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
    // showcase: smooth layout changes, auto spin unless dragged
    const k = 1 - Math.exp(-dt * 7), v = this.v, L = this.lay;
    v.x += (L.x - v.x) * k; v.y += (L.y - v.y) * k; v.s += (L.s - v.s) * k; v.dim += (L.dim - v.dim) * k; v.k += (L.k - v.k) * k; v.glow.lerp(L.glow, k);
    if (!this.drag) { this.idle += dt; if (this.idle > 1.5) this.spin += dt * 0.45; }
    this.turn.rotation.y = this.spin;
    this.turn.rotation.x = Math.sin(this.t * 0.6) * 0.1;
    this.turn.scale.setScalar(Math.max(0.001, v.s));
    this.turn.visible = v.s > 0.01;
    const sc = this.showcase, narrow = cam.aspect < 1.2;
    sc.camera.aspect = cam.aspect;
    const D = 2.6, hh = D * Math.tan(THREE.MathUtils.degToRad(15)), hw = hh * cam.aspect;
    // weapon at normalized screen position (x,y in -1..1); portrait screens center it higher
    const px = narrow ? 0 : v.x, py = narrow ? 0.3 : v.y;
    sc.camera.position.set(-px * hw, -py * hh, D); sc.camera.lookAt(-px * hw, -py * hh, 0);
    sc.camera.updateProjectionMatrix();
    const u = this.backdrop.material.uniforms;
    u.uDim.value = v.dim; u.uGlow.value.copy(v.glow); u.uC.value.set(px, py); u.uAspect.value = cam.aspect; u.uK.value = v.k;
    sc.scene.environment = this.app.world.scene.environment;
    this.app.world.update(dt);
  }
  render() { this.app.renderer.render({ scene: this.app.world.scene, camera: this.app.camera }, this.showcase); }
  destroy() {
    if (this.unsub) this.unsub();
    if (this.cur && this.cur.undo) this.cur.undo();
    this.ui.remove();
  }
}

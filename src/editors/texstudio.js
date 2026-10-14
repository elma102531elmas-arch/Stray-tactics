// Texture Studio: design procedural PBR textures (or import a photo) with live
// 3D preview. Saved textures appear in the Map Editor's material palette.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { el, downloadText, pickFile, readFileDataURL } from '../core/util.js';
import { materials, BUILTIN_RECIPES, patchBakedAO } from '../gfx/materials.js';
import { RECIPE_DEFAULTS, PATTERNS, normalizeRecipe, generateTexture, texGen } from '../gfx/texgen.js';
import { toast, prop, select, color, range, text, jsonDialog, clearThumb } from './ui.js';

const GROUPS = [
  ['Base', [['color1', 'color'], ['color2', 'color'], ['noiseScale', 1, 24, 1], ['noiseAmt', 0, 1, 0.01], ['noiseOct', 1, 8, 1], ['detail', 0, 1.5, 0.01], ['tile', 0.2, 10, 0.1]]],
  ['Pattern', [['pattern', 'pattern'], ['rows', 1, 24, 1], ['cols', 1, 24, 1], ['offset', 0, 1, 0.01], ['gap', 0, 0.08, 0.001], ['gapColor', 'color'], ['bevel', 0, 0.08, 0.001], ['cellVar', 0, 1, 0.01], ['jitter', 0, 1, 0.01], ['chip', 0, 1.5, 0.01], ['depth', 0, 2, 0.01]]],
  ['Wear & dirt', [['grime', 0, 1, 0.01], ['grimeColor', 'color'], ['grimeScale', 1, 12, 1], ['streaks', 0, 1, 0.01], ['cracks', 0, 1, 0.01], ['spots', 0, 1, 0.01], ['spotColor', 'color'], ['spotScale', 2, 30, 1], ['edgeWear', 0, 1, 0.01], ['wearColor', 'color']]],
  ['Details', [['grain', 0, 1.5, 0.01], ['stripes', 0, 1, 0.01], ['stripeColor', 'color'], ['stripeCount', 1, 16, 1]]],
  ['Surface', [['rough', 0.02, 1, 0.01], ['roughVar', 0, 0.5, 0.01], ['metal', 0, 1, 0.01], ['bump', 0, 4, 0.05], ['seed', 1, 999, 1]]],
];
const LABELS = { color1: 'Color A', color2: 'Color B', noiseScale: 'Noise scale', noiseAmt: 'Color mix', noiseOct: 'Noise detail', detail: 'Grain', tile: 'Size (m)', rows: 'Rows', cols: 'Columns', offset: 'Row offset', gap: 'Gap width', gapColor: 'Gap color', bevel: 'Edge bevel', cellVar: 'Cell variety', jitter: 'Jitter', chip: 'Chipped edges', depth: 'Depth', grime: 'Dirt', grimeColor: 'Dirt color', grimeScale: 'Dirt scale', streaks: 'Streaks', cracks: 'Cracks', spots: 'Spots', spotColor: 'Spot color', spotScale: 'Spot scale', edgeWear: 'Edge wear', wearColor: 'Wear color', grain: 'Wood grain', stripes: 'Stripes', stripeColor: 'Stripe color', stripeCount: 'Stripe count', rough: 'Roughness', roughVar: 'Rough. variety', metal: 'Metalness', bump: 'Bumpiness', seed: 'Random seed', pattern: 'Pattern' };

export class TextureStudio {
  constructor(app) { this.app = app; this.shape = 'sphere'; this.view = '3d'; }

  async init() {
    this.scene = new THREE.Scene();
    this.scene.environment = this.app.world.scene.environment;
    this.scene.background = new THREE.Color(0x3a4150);
    const sun = new THREE.DirectionalLight(0xfff0dd, 3); sun.position.set(2, 3, 2); this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x6b5a45, 0.4));
    this.cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 50); this.cam.position.set(0, 0.6, 3.4);
    this.orbit = new OrbitControls(this.cam, this.app.renderer.canvas); this.orbit.enableDamping = true; this.orbit.target.set(0, 0, 0);
    this.mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1 }); patchBakedAO(this.mat);
    this.meshes = {};
    const withAO = (g, s = 1) => { const n = g.attributes.position.count; g.setAttribute('ao', new THREE.BufferAttribute(new Float32Array(n * 2).fill(1), 2)); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s); return g; };
    this.meshes.sphere = new THREE.Mesh(withAO(new THREE.SphereGeometry(1, 96, 64), 2), this.mat);
    this.meshes.cube = new THREE.Mesh(withAO(new THREE.BoxGeometry(1.5, 1.5, 1.5)), this.mat);
    this.meshes.wall = new THREE.Mesh(withAO(new THREE.PlaneGeometry(3.2, 2.2), 1.5), this.mat);
    for (const k in this.meshes) { this.scene.add(this.meshes[k]); }
    this.pickBase('sandstone');
    this.buildUI();
    this.setShape('sphere');
    await this.regen();
  }

  pickBase(id) {
    this.srcId = id;
    this.isCustom = materials.isCustom(id);
    this.recipe = normalizeRecipe(JSON.parse(JSON.stringify(materials.recipe(id))));
    this.id = this.isCustom ? id : null;
    if (!this.isCustom) this.recipe.name = (this.recipe.name || id) + ' (copy)';
  }

  buildUI() {
    const t = (label, fn, cls = '') => el('button', { class: 'tb ' + cls, onclick: fn }, label);
    const ids = materials.ids();
    this.baseSel = select(ids.map((k) => [k, (materials.recipe(k).name || k) + (materials.isCustom(k) ? ' ★' : '')]), this.srcId, (v) => { this.pickBase(v); this.renderParams(); this.regen(); });
    this.baseSel.style.width = '200px';
    const top = el('div', { class: 'ed-top' },
      t('◀ LOBBY', () => this.app.toLobby()), el('h1', {}, 'TEXTURE STUDIO'),
      el('span', { class: 'hint' }, 'Start from:'), this.baseSel,
      t('NEW', () => { this.recipe = normalizeRecipe({ name: 'My Texture' }); this.id = null; this.renderParams(); this.regen(); }),
      t('📷 FROM PHOTO', () => this.importImage()),
      t('SAVE', () => this.save()), t('JSON ⇅', () => this.jsonIO()), t('PNG', () => this.exportPng()),
      el('div', { class: 'sp' }),
      ...['sphere', 'cube', 'wall'].map((s) => (this['b_' + s] = t(s.toUpperCase(), () => this.setShape(s)))),
      ...[['3d', '3D'], ['albedo', 'COLOR'], ['normal', 'NORMAL'], ['orm', 'ROUGH']].map(([v, l]) => (this['v_' + v] = t(l, () => this.setView(v)))));
    this.side = el('div', { class: 'ed-side' });
    this.flat = el('canvas', { style: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(70%, 70vh)', aspectRatio: '1', display: 'none', imageRendering: 'auto', border: '1px solid rgba(255,255,255,.1)' } });
    this.viewEl = el('div', { class: 'ed-view' }, this.flat, el('div', { class: 'ed-help' }, 'Drag to rotate · Wheel to zoom', el('br'), 'Saved textures appear in the Map Editor palette'));
    this.ui = el('div', { class: 'ed' }, top, el('div', { class: 'ed-main' }, this.viewEl, this.side));
    document.getElementById('ui').appendChild(this.ui);
    this.fitView = () => { const r = this.viewEl.getBoundingClientRect(); this.app.renderer.setArea({ x: r.left, y: r.top, w: r.width, h: r.height }); };
    this.fitView(); addEventListener('resize', this.fitView);
    this.renderParams();
    this.setView('3d');
  }

  renderParams() {
    const S = this.side, r = this.recipe; S.innerHTML = '';
    S.append(prop('Name', text(r.name || '', (v) => { r.name = v; })));
    if (r.image) S.append(el('p', { class: 'hint' }, 'Photo texture: color comes from your image; bumps are generated from its brightness.'), el('button', { class: 'tb', onclick: () => { delete r.image; r.image = null; this.renderParams(); this.regen(); } }, 'REMOVE PHOTO'));
    for (const [title, params] of GROUPS) {
      if (r.image && title !== 'Surface' && title !== 'Base') continue;
      S.append(el('h3', {}, title.toUpperCase()));
      for (const p of params) {
        const [k, a, b, step] = p;
        if (r.image && k !== 'tile' && title === 'Base') continue;
        let ctrl;
        if (a === 'color') ctrl = color(r[k] || '#888888', (v) => { r[k] = v; this.queue(); });
        else if (a === 'pattern') ctrl = select(PATTERNS, r.pattern, (v) => { r.pattern = v; this.queue(); });
        else ctrl = range(a, b, step, r[k] ?? RECIPE_DEFAULTS[k], (v) => { r[k] = v; this.queue(); });
        S.append(prop(LABELS[k] || k, ctrl));
      }
    }
    S.append(el('p', { class: 'hint' }, this.id ? 'Editing your texture "' + this.id + '". SAVE to update it everywhere.' : 'This is a new texture — press SAVE to add it to your library.'));
  }

  queue() { clearTimeout(this._q); this._q = setTimeout(() => this.regen(), 40); }
  async regen() {
    const old = this.tex;
    const g = await generateTexture(this.recipe, 1024, this.app.renderer.maxAniso);
    this.tex = g;
    const tile = this.recipe.tile || 2;
    for (const rt of [g.albedoRT, g.normalRT, g.ormRT]) rt.texture.repeat.set(2 / tile, 2 / tile);
    Object.assign(this.mat, { map: g.albedoRT.texture, normalMap: g.normalRT.texture, roughnessMap: g.ormRT.texture, metalnessMap: g.ormRT.texture });
    this.mat.needsUpdate = true;
    if (old) [old.albedoRT, old.normalRT, old.ormRT].forEach((rt) => rt.dispose());
    if (this.view !== '3d') this.drawFlat();
  }
  setShape(s) { this.shape = s; for (const k in this.meshes) this.meshes[k].visible = k === s; for (const k of ['sphere', 'cube', 'wall']) this['b_' + k].classList.toggle('on', k === s); }
  setView(v) {
    this.view = v; for (const k of ['3d', 'albedo', 'normal', 'orm']) this['v_' + k].classList.toggle('on', k === v);
    this.flat.style.display = v === '3d' ? 'none' : 'block';
    if (v !== '3d') this.drawFlat();
  }
  drawFlat() {
    if (!this.tex) return;
    const rt = this.view === 'albedo' ? this.tex.albedoRT : this.view === 'normal' ? this.tex.normalRT : this.tex.ormRT;
    const c = texGen().toCanvas(rt);
    this.flat.width = c.width; this.flat.height = c.height;
    const x = this.flat.getContext('2d');
    // tile 2x2 to show seamlessness
    x.drawImage(c, 0, 0, c.width / 2, c.height / 2); x.drawImage(c, c.width / 2, 0, c.width / 2, c.height / 2); x.drawImage(c, 0, c.height / 2, c.width / 2, c.height / 2); x.drawImage(c, c.width / 2, c.height / 2, c.width / 2, c.height / 2);
  }

  async importImage() {
    const f = await pickFile('image/*'); if (!f) return;
    const url = await readFileDataURL(f);
    // downscale to keep storage small
    const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = url; });
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S; c.getContext('2d').drawImage(img, 0, 0, S, S);
    this.recipe = normalizeRecipe({ name: f.name.replace(/\.\w+$/, ''), image: c.toDataURL('image/jpeg', 0.85), tile: 2, rough: 0.8, roughVar: 0.2, bump: 1.2 });
    this.id = null; this.renderParams(); await this.regen();
    toast('Photo loaded — adjust size/roughness, then SAVE');
  }
  save() {
    const name = (this.recipe.name || 'My Texture').trim();
    let id = this.id;
    if (!id) { id = 'u_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24); let n = 1; while (materials.isCustom(id) || BUILTIN_RECIPES[id]) id = id.replace(/_\d+$/, '') + '_' + (++n); }
    const clean = {}; for (const k in this.recipe) if (this.recipe[k] !== RECIPE_DEFAULTS[k] || k === 'name') clean[k] = this.recipe[k];
    materials.saveCustom(id, clean);
    clearThumb();
    this.id = id; this.isCustom = true;
    toast('Saved texture "' + name + '" (' + id + ')');
    const ids = materials.ids();
    this.baseSel.innerHTML = ''; ids.forEach((k) => this.baseSel.appendChild(el('option', { value: k }, (materials.recipe(k).name || k) + (materials.isCustom(k) ? ' ★' : '')))); this.baseSel.value = id;
    this.renderParams();
  }
  jsonIO() {
    const clean = {}; for (const k in this.recipe) if (this.recipe[k] !== RECIPE_DEFAULTS[k] || k === 'name') clean[k] = this.recipe[k];
    jsonDialog('TEXTURE JSON', { [this.id || 'new_texture']: clean }, (this.recipe.name || 'texture').replace(/\W+/g, '_') + '.json', (obj) => {
      const first = obj.color1 || obj.pattern || obj.image ? obj : obj[Object.keys(obj)[0]];
      this.recipe = normalizeRecipe(first); this.id = null; this.renderParams(); this.regen(); toast('Texture imported — SAVE to keep it');
    });
  }
  exportPng() {
    if (!this.tex) return;
    for (const [rt, suf] of [[this.tex.albedoRT, 'albedo'], [this.tex.normalRT, 'normal'], [this.tex.ormRT, 'rough-metal']]) {
      const c = texGen().toCanvas(rt);
      const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = (this.recipe.name || 'texture').replace(/\W+/g, '_') + '_' + suf + '.png'; document.body.appendChild(a); a.click(); a.remove();
    }
    void downloadText;
  }

  update(dt) {
    this.orbit.update();
    if (this.shape !== 'wall') { this.meshes.sphere.rotation.y += dt * 0.15; this.meshes.cube.rotation.y += dt * 0.15; }
    const R = this.app.renderer; this.cam.aspect = R.width / R.height; this.cam.updateProjectionMatrix();
  }
  render() { this.app.renderer.render({ scene: this.scene, camera: this.cam }); }
  destroy() {
    clearTimeout(this._q); this.orbit.dispose(); this.ui.remove();
    if (this.tex) [this.tex.albedoRT, this.tex.normalRT, this.tex.ormRT].forEach((rt) => rt.dispose());
  }
}

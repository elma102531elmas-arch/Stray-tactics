// Weapon & animation tools: edit weapon stats, see balance numbers, test spread/recoil on a target, preview the viewmodel
// with its animation clips, and compare reload time with the reload animation. Game reference weapons are read-only until duplicated.
import { h } from '../ui/dom.js';
import { numberField, selectField, boolField, textField, vec3Field, button, section } from '../ui/fields.js';
import { confirmBox } from '../ui/dialogs.js';
import { ModelViewer } from '../ui/modelviewer.js';
import { playOneShot } from '../ui/audioctx.js';
import { setData } from '../core/commands.js';
import { REFERENCE_WEAPONS, allWeapons, newWeapon, validateWeapon, weaponStats, WeaponRuntime } from '../core/weapons.js';
import { uid } from '../core/util.js';

const AIM_Y = 1.4;                                  // metres: where the range test aims on the dummy
const SOUND_SLOTS = [['fire', 'Fire'], ['reload', 'Reload'], ['empty', 'Dry fire'], ['draw', 'Draw']];
const CLIP_SLOTS = [['idle', 'Idle'], ['draw', 'Draw'], ['fire', 'Fire'], ['reload', 'Reload']];

class WeaponsWorkspace {
  constructor(app, el) {
    this.app = app; this.el = el; this.current = null; this.hp = 100; this.dist = 15; this.headshot = false; this.fpMode = true; this.shots = [];
    this.listEl = h('div', { class: 'panel-body', style: { flex: 1 } });
    this.viewerBox = h('div', { style: { flex: 1, position: 'relative', minHeight: '180px' } });
    this.transport = h('div', { class: 'toolbar', style: { height: 'auto', padding: '6px 10px', flexWrap: 'wrap', gap: '8px' } });
    this.rangeBox = h('div', { style: { height: '270px', display: 'flex', borderTop: '1px solid var(--line)' } });
    this.props = h('div', { class: 'panel-body insp' });
    el.append(h('div', { class: 'split', style: { height: '100%' } },
      h('div', { class: 'pane', style: { width: '230px', display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: '1px solid var(--line)' } },
        h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Weapons')), this.listEl,
        h('div', { style: { padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: '1px solid var(--line)' } }, button('New', () => this.create(), { primary: true }), button('Duplicate', () => this.duplicate()), button('Delete', () => this.remove()))),
      h('div', { class: 'pane', style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }, h('div', { class: 'panel-head' }, h('span', { class: 'title', id: 'wp-title' }, 'Preview')), this.viewerBox, this.transport, this.rangeBox),
      h('div', { class: 'pane', style: { width: '350px', background: 'var(--panel)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' } }, h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Properties')), this.props)));
    app.on('history', () => { if (this.el.classList.contains('on')) { this.refresh(false); } });
    app.on('project', () => { this.current = null; this._modelFor = undefined; this.shots = []; });
  }

  all() { return allWeapons(this.app.project); }
  w() { return this.current ? this.all()[this.current] || null : null; }
  ro() { return !!this.w()?.readOnly; }

  show() {
    if (!this.viewer) this.viewer = new ModelViewer(this.app, this.viewerBox);
    const all = this.all();
    if (!this.current || !all[this.current]) this.current = Object.keys(all).find((k) => !all[k].readOnly) || Object.keys(all)[0];
    this.viewer.resize(); this.refresh(true);
  }
  hide() { this.viewer?.pause(); }

  async refresh(reloadModel) {
    this.renderList(); this.renderProps(); this.renderRange();
    const w = this.w();
    document.getElementById('wp-title').textContent = w ? `${w.name}${w.readOnly ? ' — read-only reference' : ''}` : 'Preview';
    if (reloadModel || this._modelFor !== w?.model) await this.loadModel();
    else this.applyView();
  }

  renderList() {
    const carried = new Set(this.app.project.data.settings.loadout || ['ref_crowbar', 'ref_pistol', 'ref_rifle']);
    this.listEl.replaceChildren(...Object.values(this.all()).map((w) => h('div', { class: 'tree-row' + (w.id === this.current ? ' sel primary' : ''), style: { position: 'relative', height: '30px' }, 'data-weapon': w.id, onclick: () => { this.current = w.id; this.range = null; this.refresh(true); } },
      h('span', { class: 'tree-icon', style: { background: w.readOnly ? '#8a8f96' : '#e0a040', marginLeft: '8px' } }, w.kind === 'melee' ? 'M' : 'G'), h('span', { class: 'tree-name' }, w.name.replace(' (game reference)', '')), h('span', { class: 'tree-tag', title: 'Carried in playtest' }, carried.has(w.id) ? '●' : ''))));
  }

  update(patch, label, mergeKey) {
    const w = this.w(); if (!w || w.readOnly) { this.app.toast('This is a read-only reference. Duplicate it to edit.', 'info'); return; }
    this.app.exec(setData(['weapons', w.id], { ...JSON.parse(JSON.stringify(w)), ...patch }, { label: label || `Edit ${w.name}`, mergeKey: mergeKey || `wp:${w.id}:${Object.keys(patch)}` }));
  }
  setPath(path, value) {
    const w = this.w(); if (!w || w.readOnly) return;
    const next = JSON.parse(JSON.stringify(w)); let o = next;
    for (let i = 0; i < path.length - 1; i++) { o[path[i]] = o[path[i]] ?? {}; o = o[path[i]]; }
    o[path.at(-1)] = value;
    this.app.exec(setData(['weapons', w.id], next, { label: `Edit ${path.join('.')}`, mergeKey: `wp:${w.id}:${path.join('.')}` }));
  }
  create(base = null) { const w = base || newWeapon('New weapon'); this.app.exec(setData(['weapons', w.id], w, { label: 'Create weapon' })); this.current = w.id; this.refresh(true); }
  duplicate() { const s = this.w(); if (!s) return; const c = JSON.parse(JSON.stringify(s)); c.id = uid('wpn'); c.name = s.name.replace(' (game reference)', '') + ' copy'; delete c.readOnly; delete c.imported; delete c.source; this.create(c); }
  async remove() {
    const w = this.w(); if (!w || w.readOnly) { this.app.toast('Reference weapons cannot be deleted.', 'info'); return; }
    if (!(await confirmBox('Delete weapon', `Delete “${w.name}”?`, { ok: 'Delete', danger: true }))) return;
    const next = { ...this.app.project.data.weapons }; delete next[w.id];
    this.app.exec(setData(['weapons'], next, { label: 'Delete weapon' })); this.current = null; this.show();
  }
  toggleCarry(on) {
    const cur = this.app.project.data.settings.loadout || ['ref_crowbar', 'ref_pistol', 'ref_rifle'];
    const next = on ? [...new Set([...cur, this.current])] : cur.filter((x) => x !== this.current);
    this.app.exec(setData(['settings', 'loadout'], next, { label: 'Playtest loadout' }));
  }

  // ---------------------------------------------------------------- preview
  async loadModel() {
    const w = this.w(); this._modelFor = w?.model;
    this.transport.replaceChildren();
    if (!w?.model) { this.viewer.clear(); this.applyView(); this.transport.append(h('span', { style: { color: 'var(--faint)' } }, 'No model assigned. Pick one under “Model” (import a .glb first). Stats and the range test below work without a model.')); return; }
    try {
      const res = await this.viewer.load(w.model, {});
      if (!res) return;                                   // a newer load superseded this one
      this.applyView();
      this.buildTransport(res.animations, w);
      this.renderProps();                                  // clip drop-downs can now list this model's clips
    } catch (e) { this.transport.append(h('span', { class: 'note err', style: { margin: 0 } }, 'Could not load the model: ' + e.message)); }
  }
  applyView() { const w = this.w(); if (!w) return; this.viewer.applyViewmodel(w.viewmodel); this.viewer.setFirstPerson(this.fpMode, this.ads && w.adsFov > 0 ? w.adsFov : 60); }

  buildTransport(clips, w) {
    const v = this.viewer, t = this.transport; t.replaceChildren();
    const check = (label, checked, on) => h('label', { style: { display: 'flex', gap: '4px', color: 'var(--dim)', alignItems: 'center' } }, h('input', { type: 'checkbox', checked, onchange: (e) => on(e.target.checked) }), label);
    t.append(check('First-person view', this.fpMode, (c) => { this.fpMode = c; this.applyView(); }), check('Aiming (ADS) field of view', !!this.ads, (c) => { this.ads = c; this.applyView(); }));
    if (!clips.length) { t.append(h('span', { style: { color: 'var(--faint)' } }, 'This model has no animation clips.')); return; }
    const byName = (n) => clips.find((c) => c.name === n);
    for (const [slot, label] of CLIP_SLOTS) {
      const clip = byName(w.clips?.[slot]);
      // the reload clip is played at the speed that makes it end exactly when the reload does
      const speed = slot === 'reload' && clip && w.reloadTime > 0 ? clip.duration / w.reloadTime : 1;
      t.append(h('button', { class: 'btn small', 'data-clip': slot, disabled: !clip, title: clip ? `${clip.duration.toFixed(2)} s${speed !== 1 ? ` at ${speed.toFixed(2)}×` : ''}` : 'No clip assigned (see “Animation clips”)', onclick: () => v.play(clip.name, { loop: slot === 'idle', speed }) }, `▶ ${label}`));
    }
    const rc = byName(w.clips?.reload), fc = byName(w.clips?.fire);
    if (rc && w.reloadTime > 0) { const k = rc.duration / w.reloadTime; t.append(h('span', { class: 'chip ' + (Math.abs(k - 1) > 0.15 ? 'warn' : ''), title: 'Reload clip length ÷ reload time. The reload preview plays at this speed.' }, `reload clip ${rc.duration.toFixed(2)} s vs ${w.reloadTime} s → ${k.toFixed(2)}×`)); }
    if (fc && fc.duration > w.fireInterval + 0.001) t.append(h('span', { class: 'chip warn', title: 'The next shot starts before this clip finishes, so it will be cut off.' }, `fire clip ${fc.duration.toFixed(2)} s is longer than the ${w.fireInterval} s fire interval`));
  }

  // ---------------------------------------------------------------- range test
  /** Balance table + scatter test. Built once per weapon/setting change; the numbers are refreshed in place so dragging a label keeps working. */
  renderRange() {
    const w = this.w(); if (!w) { this.rangeBox.replaceChildren(); return; }
    const sig = JSON.stringify([w.id, w.kind, w.spreadDeg, w.adsSpreadDeg, w.pellets, this.dist]);
    if (sig !== this.rangeSig) { this.shots = []; this.rangeSig = sig; }
    const canvas = h('canvas', { width: 420, height: 250, style: { width: '420px', height: '250px', flex: 'none', background: '#12151a', cursor: 'crosshair' } });
    this.rangeCanvas = canvas;
    const gun = w.kind === 'gun';
    const stat = (label, key) => [h('span', {}, label), h('b', { 'data-stat': key })];
    this.statEls = {};
    const kv = h('div', { class: 'kv', style: { fontSize: '12px', marginTop: '6px' } }, [['Damage / shot', 'dmg'], ['Shots to kill', 'stk'], ['Time to kill', 'ttk'], ['Burst DPS', 'burst'], ['Sustained DPS', 'sus'], ...(gun ? [['Magazine dump', 'dump'], ['Spread radius', 'spread']] : [])].flatMap(([l, k]) => stat(l, k)));
    kv.querySelectorAll('[data-stat]').forEach((e) => { this.statEls[e.dataset.stat] = e; });
    this.rangeBox.replaceChildren(canvas, h('div', { style: { flex: 1, padding: '8px 12px', overflow: 'auto', minWidth: 0 } },
      gun ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' } }, button('Fire ×1', () => this.fireRange(1), { primary: true }), button('Fire ×20', () => this.fireRange(20)), button('Clear', () => { this.shots = []; this.drawRange(); }),
        h('label', { style: { display: 'flex', gap: '4px', color: 'var(--dim)', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: !!this.rangeAds, onchange: (e) => { this.rangeAds = e.target.checked; this.drawRange(); } }), 'Aiming'))
        : h('div', { class: 'note', style: { margin: '0 0 8px' } }, 'Melee weapons have no spread, so there is no scatter test.'),
      numberField('Target distance', { value: this.dist, step: 1, min: 1, max: 120, unit: 'm', onChange: (v) => { this.dist = Math.max(1, v); this.renderRange(); } }).el,
      numberField('Enemy health', { value: this.hp, step: 10, min: 1, onChange: (v) => { this.hp = Math.max(1, v); this.updateStats(); } }).el,
      boolField('Head shots', { value: this.headshot, onChange: (v) => { this.headshot = v; this.updateStats(); } }).el,
      kv,
      h('div', { style: { color: 'var(--faint)', fontSize: '11px', marginTop: '8px' } }, 'Numbers use this weapon’s settings and the same firing code as the playtest.')));
    this.updateStats(); this.drawRange();
  }
  updateStats() {
    const w = this.w(); if (!w || !this.statEls) return;
    const st = weaponStats(w, { enemyHp: this.hp, headshot: this.headshot, distance: this.dist });
    const f = (x) => (Number.isFinite(x) ? (Math.round(x * 100) / 100).toString() : '∞');
    const set = (k, text) => { if (this.statEls[k]) this.statEls[k].textContent = text; };
    set('dmg', f(st.damagePerShot)); set('stk', f(st.shotsToKill)); set('ttk', f(st.timeToKill) + ' s'); set('burst', f(st.burstDps)); set('sus', f(st.sustainedDps));
    set('dump', f(st.magDumpTime) + ' s'); set('spread', `${f(st.hipSpreadRadius)} m hip · ${f(st.adsSpreadRadius)} m aimed`);
  }
  fireRange(n) {
    const w = this.w(); if (!w || w.kind !== 'gun') return;
    const rt = new WeaponRuntime(w); rt.drawn = 0; rt.mag = Infinity; rt.ads = !!this.rangeAds;
    const basis = { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
    for (let i = 0; i < n; i++) {
      rt.cooldown = 0; const s = rt.fire(basis); if (!s) continue;
      for (const d of s.dirs) { const t = this.dist / -d.z; this.shots.push({ x: d.x * t, y: AIM_Y + d.y * t }); }     // the player aims at the target's upper chest
    }
    if (this.shots.length > 600) this.shots.splice(0, this.shots.length - 600);
    this.drawRange();
  }
  drawRange() {
    const c = this.rangeCanvas; if (!c) return; const g = c.getContext('2d'), W = c.width, H = c.height, w = this.w();
    const spreadR = w?.kind === 'gun' ? Math.tan(((this.rangeAds ? w.adsSpreadDeg : w.spreadDeg) * Math.PI) / 180) * this.dist : 0;
    const half = Math.max(2.2, spreadR * 1.25), k = W / 2 / half;                         // pixels per metre, same scale on both axes
    const X = (x) => W / 2 + x * k, Y = (y) => H - 20 - y * k;
    g.fillStyle = '#12151a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#222a34'; g.fillRect(0, Y(0), W, H);
    g.fillStyle = '#5a1f1f'; g.fillRect(X(-0.25), Y(1.5), 0.5 * k, 0.75 * k); g.fillRect(X(-0.2), Y(0.75), 0.4 * k, 0.75 * k);       // torso, legs
    g.fillStyle = '#7a2b2b'; g.beginPath(); g.arc(X(0), Y(1.68), 0.13 * k, 0, Math.PI * 2); g.fill();                                 // head
    g.strokeStyle = '#ffffff1a'; g.lineWidth = 1; for (let m = Math.ceil(-half); m <= half; m++) { g.beginPath(); g.moveTo(X(m), 0); g.lineTo(X(m), Y(0)); g.stroke(); }
    if (spreadR > 0) { g.strokeStyle = '#ff9a2a'; g.beginPath(); g.arc(X(0), Y(AIM_Y), spreadR * k, 0, Math.PI * 2); g.stroke(); }
    let head = 0, body = 0, miss = 0;
    for (const s of this.shots) {
      const inHead = Math.hypot(s.x, s.y - 1.68) < 0.13, inBody = Math.abs(s.x) < 0.25 && s.y > 0.75 && s.y < 1.5, inLegs = Math.abs(s.x) < 0.2 && s.y > 0 && s.y <= 0.75;
      if (inHead) head++; else if (inBody || inLegs) body++; else miss++;
      g.fillStyle = inHead ? '#ffd84a' : inBody || inLegs ? '#5bd18b' : '#9aa5b5'; g.beginPath(); g.arc(X(s.x), Y(s.y), 2.5, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#d9dee6'; g.font = '11px system-ui'; g.fillText(`${this.dist} m target · ${this.shots.length} shots: ${head} head · ${body} body · ${miss} miss${this.shots.length ? ` (${Math.round(100 * (head + body) / this.shots.length)}% on target)` : ''}`, 8, 14);
    c.dataset.head = head; c.dataset.body = body; c.dataset.miss = miss;
  }

  // ---------------------------------------------------------------- property panel
  renderProps() {
    const w = this.w();
    if (!w) { this.props.replaceChildren(h('div', { class: 'empty' }, 'Create a weapon.')); return; }
    const ro = w.readOnly, app = this.app;
    const lock = (f) => { if (ro) f.el.querySelectorAll('input,select,textarea,button').forEach((i) => { i.disabled = true; }); return f.el; };
    const num = (label, key, o = {}) => lock(numberField(label, { value: w[key] ?? 0, step: 0.05, ...o, onChange: (v) => this.setPath([key], v) }));
    const blocks = [];
    if (ro) blocks.push(h('div', { class: 'note warn' }, w.notes), h('div', { style: { padding: '0 10px 8px' } }, button('Duplicate to edit', () => this.duplicate(), { primary: true })));
    const issues = validateWeapon(w, app.project);
    if (issues.length) blocks.push(h('div', { class: 'sec' }, h('div', { class: 'sec-h', style: { cursor: 'default' } }, `Checks (${issues.length})`), h('div', { class: 'sec-b' }, issues.map((i) => h('div', { class: 'note ' + (i.severity === 'error' ? 'err' : i.severity === 'warn' ? 'warn' : ''), style: { margin: '0 0 6px' } }, i.message)))));
    const carried = (app.project.data.settings.loadout || ['ref_crowbar', 'ref_pistol', 'ref_rifle']).includes(w.id);
    const models = ['', ...app.assets.allMeta('model').map((m) => m.id)];
    blocks.push(section('General', [lock(textField('Name', { value: w.name, onChange: (v) => this.setPath(['name'], v) })), lock(selectField('Kind', { value: w.kind, options: ['gun', 'melee'], onChange: (v) => this.setPath(['kind'], v) })), lock(selectField('Model', { value: w.model || '', options: models, optionLabel: (id) => (id ? app.assets.meta(id)?.name || id : '(none)'), onChange: (v) => this.setPath(['model'], v) })), boolField('Carry in playtest', { value: carried, hint: 'Weapons you carry are selectable with 1–9 in the playtest.', onChange: (v) => this.toggleCarry(v) }).el], { key: 'wp.gen', prefs: app }));
    blocks.push(section('Damage & rate', [num('Damage', 'damage', { min: 0, step: 1 }), ...(w.kind === 'gun' ? [num('Head multiplier', 'headMultiplier', { min: 0 }), num('Pellets per shot', 'pellets', { min: 1, step: 1, int: true })] : []), num(w.kind === 'melee' ? 'Swing interval' : 'Time between shots', 'fireInterval', { min: 0.01, unit: 's' }), ...(w.kind === 'gun' ? [lock(boolField('Automatic (hold to fire)', { value: !!w.automatic, onChange: (v) => this.setPath(['automatic'], v) })), lock(boolField('Pierces enemies', { value: !!w.pierce, onChange: (v) => this.setPath(['pierce'], v) }))] : []), num('Range', 'range', { min: 0.1, unit: 'm', step: 1 }), num('Noise radius', 'noise', { min: 0, unit: 'm', step: 1 })], { key: 'wp.dmg', prefs: app }));
    if (w.kind === 'gun') {
      blocks.push(section('Ammo & reload', [num('Magazine size', 'magazine', { min: 1, step: 1, int: true }), num('Reserve ammo', 'reserve', { min: 0, step: 1, int: true }), lock(textField('Ammo item id', { value: w.ammoType || '', hint: 'Pickups of this item add to the reserve.', onChange: (v) => this.setPath(['ammoType'], v) })), num('Reload time', 'reloadTime', { min: 0.05, unit: 's' }), lock(boolField('Reload one round at a time', { value: !!w.perRoundReload, onChange: (v) => this.setPath(['perRoundReload'], v) }))], { key: 'wp.ammo', prefs: app }));
      blocks.push(section('Accuracy & recoil', [num('Hip-fire spread', 'spreadDeg', { min: 0, unit: '°' }), num('Aimed spread', 'adsSpreadDeg', { min: 0, unit: '°' }), num('Recoil kick', 'recoilDeg', { min: 0, unit: '°' }), num('Recoil recovery', 'recoilRecover', { min: 0.1, step: 0.5 }), num('Aiming field of view', 'adsFov', { min: 10, max: 120, step: 1, unit: '°' })], { key: 'wp.acc', prefs: app }));
    }
    const vm = w.viewmodel || { pos: [0, 0, -0.5], rot: [0, 0, 0], scale: 1 };
    blocks.push(section('Viewmodel (how it is held)', [lock(vec3Field('Position', { value: vm.pos, step: 0.01, unit: 'm', onChange: (v) => this.setPath(['viewmodel', 'pos'], v) })), lock(vec3Field('Rotation', { value: vm.rot, step: 1, unit: '°', onChange: (v) => this.setPath(['viewmodel', 'rot'], v) })), num2('Scale', vm.scale, (v) => this.setPath(['viewmodel', 'scale'], v), ro)], { key: 'wp.vm', prefs: app, open: !!w.model }));
    const audio = ['', ...app.assets.allMeta('audio').map((a) => a.id)];
    blocks.push(section('Sounds', SOUND_SLOTS.map(([slot, label]) => { const f = selectField(label, { value: w.sounds?.[slot] || '', options: audio, optionLabel: (id) => (id ? app.assets.meta(id)?.name || id : '(none)'), onChange: (v) => this.setPath(['sounds', slot], v) }); const ctl = f.el.querySelector('.ctl'); ctl.appendChild(button('▶', () => w.sounds?.[slot] && playOneShot(app, w.sounds[slot]).catch((e) => app.toast(e.message, 'error')), { title: 'Preview' })); return lock(f); }), { key: 'wp.snd', prefs: app, open: false }));
    const clipNames = ['', ...(this.viewer?.clipNames() || [])];
    blocks.push(section('Animation clips', CLIP_SLOTS.map(([slot, label]) => lock(selectField(label, { value: w.clips?.[slot] || '', options: [...new Set([...clipNames, w.clips?.[slot] || ''])], optionLabel: (c) => c || '(none)', hint: slot === 'fire' ? 'Clip events (set in the Assets editor) can drive muzzle flash / shell eject.' : undefined, onChange: (v) => this.setPath(['clips', slot], v) }))), { key: 'wp.clips', prefs: app, open: !!w.model }));
    this.props.replaceChildren(...blocks);
  }
}
const num2 = (label, value, onChange, ro) => { const f = numberField(label, { value, step: 0.05, min: 0.01, onChange }); if (ro) f.el.querySelectorAll('input').forEach((i) => { i.disabled = true; }); return f.el; };

export default {
  id: 'weapons', label: 'Weapons', fill: true,
  create(app, el) { const w = new WeaponsWorkspace(app, el); app.weaponsWs = w; return w; },
};

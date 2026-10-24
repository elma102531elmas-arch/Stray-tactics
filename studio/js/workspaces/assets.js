// Asset editor: inspect and configure imported (or built-in) assets — pivot, scale, collision, material overrides, animation
// clips + events, attached sounds, interaction defaults — and save them as prefabs. Built-in assets are read-only until copied.
import { h } from '../ui/dom.js';
import { numberField, selectField, boolField, textField, vec3Field, button, section } from '../ui/fields.js';
import { confirmBox, promptBox } from '../ui/dialogs.js';
import { ModelViewer } from '../ui/modelviewer.js';
import { setData } from '../core/commands.js';
import { allMaterialIds, getMaterialDef } from '../core/materials.js';
import { withTransform, PIVOT_PRESETS, placementProps, effectiveBounds, rawBoundsOf } from '../assets/meta.js';
import { formatBytes, uid } from '../core/util.js';
import { baseName } from '../assets/classify.js';

const SOUND_TRIGGERS = ['loop', 'on interact', 'on animation event', 'on event'];

class AssetsWorkspace {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.selected = null; this.kind = 'all'; this.q = '';
    this.list = h('div', { class: 'panel-body', style: { flex: 1 } });
    this.search = h('input', { class: 'search', placeholder: 'Search assets…', 'aria-label': 'Search assets', oninput: () => { this.q = this.search.value.toLowerCase(); this.renderList(); } });
    this.kindSel = h('select', { class: 'tb-select', 'aria-label': 'Asset kind', onchange: () => { this.kind = this.kindSel.value; this.renderList(); } }, [['all', 'All'], ['model', 'Models'], ['image', 'Images'], ['audio', 'Audio'], ['project', 'This project only']].map(([v, l]) => h('option', { value: v }, l)));
    this.center = h('div', { style: { flex: 1, position: 'relative', minHeight: '200px', display: 'flex', flexDirection: 'column' } });
    this.viewerBox = h('div', { style: { flex: 1, position: 'relative', minHeight: '160px' } });
    this.transport = h('div', { class: 'toolbar', style: { height: 'auto', padding: '6px 10px', flexWrap: 'wrap', gap: '8px' } });
    this.center.append(this.viewerBox, this.transport);
    this.props = h('div', { class: 'panel-body insp' });
    el.append(h('div', { class: 'split', style: { height: '100%' } },
      h('div', { class: 'pane', style: { width: '270px', display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: '1px solid var(--line)' } },
        h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Assets'), this.search), h('div', { style: { padding: '6px 8px' } }, this.kindSel), this.list,
        h('div', { style: { padding: '8px', borderTop: '1px solid var(--line)', display: 'flex', gap: '6px' } }, button('Import…', () => app.run('asset.import'), { primary: true }), button('Folder…', () => app.run('asset.importFolder')))),
      h('div', { class: 'pane', style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }, h('div', { class: 'panel-head' }, h('span', { class: 'title', id: 'asset-title' }, 'Preview')), this.center),
      h('div', { class: 'pane', style: { width: '350px', background: 'var(--panel)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' } }, h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Asset properties')), this.props)));
    app.on('assets', () => { this.renderList(); this.build(); });
    app.on('project', () => { this.selected = null; this.renderList(); this.build(); });
    app.on('history', () => { if (this.el.classList.contains('on')) { this.renderList(); this.refresh(); } });
    app.on('asset-selected', (id) => { if (this.el.classList.contains('on')) this.select(id); });
    app.on('goto', (e) => { if (e.workspace === 'assets' && e.asset) this.select(e.asset); });
  }

  show() {
    if (!this.viewer) this.viewer = new ModelViewer(this.app, this.viewerBox);
    this.viewer.resize();
    this.renderList();
    if (!this.selected) { const first = this.app.assets.allMeta('model').find((m) => !m.builtin) || this.app.assets.allMeta(null)[0]; if (first) this.select(first.id); else this.build(); } else this.build();
  }
  hide() { this.stopAudio(); this.viewer?.pause(); }

  meta() { return this.selected ? this.app.assets.meta(this.selected) : null; }
  editable(meta = this.meta()) { return !!meta && !meta.builtin; }
  usage(id) { return this.app.scene.find((n) => n.props.asset === id || n.props.model === id || n.props.texture === id || (n.props.sounds || []).some((s) => s.asset === id)); }

  renderList() {
    const items = this.app.assets.allMeta(null).filter((m) => {
      if (this.kind === 'project' && m.builtin) return false;
      if (['model', 'image', 'audio'].includes(this.kind) && m.kind !== this.kind) return false;
      return !this.q || m.name.toLowerCase().includes(this.q);
    });
    const icon = { model: '▣', image: '▤', audio: '♪', data: '{}' };
    this.list.replaceChildren(...items.slice(0, 500).map((m) => h('div', { class: 'tree-row' + (m.id === this.selected ? ' sel primary' : ''), style: { position: 'relative', height: '28px' }, 'data-asset': m.id, onclick: () => this.select(m.id) },
      h('span', { style: { width: '18px', textAlign: 'center', color: 'var(--dim)', marginLeft: '6px' } }, icon[m.kind] || '?'), h('span', { class: 'tree-name' }, m.name), h('span', { class: 'tree-tag' }, m.builtin ? 'built-in' : this.usage(m.id).length ? this.usage(m.id).length + '×' : ''))));
    if (!items.length) this.list.replaceChildren(h('div', { class: 'empty' }, 'Nothing here. Import files with the button below or drop them on the window.'));
  }

  async select(id) {
    this.selected = id;
    this.stopAudio();
    this.renderList();
    await this.loadPreview();
    this.build();
  }

  // ---------------------------------------------------------------- preview
  async loadPreview() {
    const m = this.meta();
    document.getElementById('asset-title').textContent = m ? m.name : 'Preview';
    this.viewerBox.querySelectorAll('.asset-extra').forEach((e) => e.remove());
    this.transport.replaceChildren();
    if (!m) { this.viewer?.clear(); return; }
    const showViewer = m.kind === 'model';
    if (this.viewer) this.viewer.canvas.style.display = showViewer ? 'block' : 'none';
    if (m.kind === 'model') {
      try {
        const res = await this.viewer.load(m.id, { overrides: m.materialOverrides || {}, meta: m });
        this.viewer.setOverlays(m);
        this.buildTransport(res?.animations || []);
      } catch (e) { this.viewerBox.appendChild(h('div', { class: 'note err asset-extra', style: { position: 'absolute', left: '12px', right: '12px', top: '12px' } }, `Could not display this model: ${e.message}`)); this.app.log('error', e.message); }
    } else if (m.kind === 'image') {
      try { this.viewerBox.appendChild(h('div', { class: 'asset-extra', style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'repeating-conic-gradient(#20242b 0% 25%, #1a1d23 0% 50%) 0 0/20px 20px' } }, h('img', { src: await this.app.assets.url(m), alt: m.name, style: { maxWidth: '92%', maxHeight: '92%', imageRendering: 'auto' } }))); }
      catch (e) { this.viewerBox.appendChild(h('div', { class: 'note err asset-extra', style: { margin: '12px' } }, e.message)); }
    } else if (m.kind === 'audio') this.buildAudioPreview(m);
  }

  buildTransport(animations) {
    const v = this.viewer, m = this.meta();
    const t = this.transport;
    t.replaceChildren();
    const mkChk = (label, key, cb) => h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center', color: 'var(--dim)' } }, h('input', { type: 'checkbox', checked: v.show[key], onchange: (e) => { v.show[key] = e.target.checked; cb ? cb(e.target.checked) : v.setOverlays(this.meta()); } }), label);
    t.append(mkChk('Bounds', 'bounds'), mkChk('Collider', 'collider'), mkChk('Pivot axes', 'pivot'), mkChk('Wireframe', 'wire', (on) => v.setWire(on)), mkChk('Grid', 'grid'), button('Frame', () => v.frame()));
    if (!animations.length) { t.append(h('span', { style: { color: 'var(--faint)' } }, 'No animation clips in this file.')); return; }
    const sel = h('select', { class: 'tb-select', 'aria-label': 'Animation clip' }, animations.map((c) => h('option', { value: c.name }, `${c.name} (${c.duration.toFixed(2)} s)`)));
    const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: 0, 'aria-label': 'Animation time', style: { flex: 1, minWidth: '160px' } });
    const timeLbl = h('span', { style: { font: 'var(--mono)', minWidth: '90px' } }, '0.00 s');
    const playBtn = h('button', { class: 'btn small primary', onclick: () => { if (!v.action || v.action.getClip().name !== sel.value) { v.play(sel.value); } else if (v.playing) v.pause(); else v.resume(); playBtn.textContent = v.playing ? 'Pause' : 'Play'; } }, 'Play');
    const loop = h('label', { style: { display: 'flex', gap: '4px', color: 'var(--dim)' } }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { v.loop = e.target.checked; if (v.action) v.action.setLoop(v.loop ? 2201 : 2200, Infinity); } }), 'Loop');
    const speed = h('select', { class: 'tb-select', 'aria-label': 'Speed', onchange: (e) => v.setSpeed(parseFloat(e.target.value)) }, [0.25, 0.5, 1, 2].map((s) => h('option', { value: s, selected: s === 1 }, s + '×')));
    sel.onchange = () => { v.play(sel.value); v.pause(); slider.value = 0; playBtn.textContent = 'Play'; this.build(); };
    slider.oninput = () => { if (!v.action) v.play(sel.value); const clip = v.clip; v.seek(parseFloat(slider.value) * clip.duration); playBtn.textContent = 'Play'; };
    this.evLog = h('span', { style: { color: 'var(--accent)', font: 'var(--mono)' } });
    v.onEvent = (ev) => { this.evLog.textContent = `event “${ev.name}” @ ${ev.time.toFixed(2)} s`; this.app.log('info', `Animation event “${ev.name}” fired at ${ev.time.toFixed(2)} s (${v.clip.name})`); };
    t.append(h('span', { style: { width: '100%', height: 0 } }), sel, playBtn, loop, speed, slider, timeLbl, this.evLog);
    this._timeUpd?.(); this._timeUpd = v.onFrame(() => { if (v.clip && v.action) { timeLbl.textContent = `${v.time.toFixed(2)} / ${v.clip.duration.toFixed(2)} s`; if (v.playing) slider.value = (v.time % v.clip.duration) / v.clip.duration; } });
    this.clipSel = sel;
  }

  async buildAudioPreview(m) {
    const box = h('div', { class: 'asset-extra', style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', justifyContent: 'center', padding: '20px' } });
    const cv = h('canvas', { width: 700, height: 140, style: { width: '90%', maxWidth: '700px', height: '140px', background: 'var(--bg)', borderRadius: '6px' } });
    const status = h('div', { style: { color: 'var(--dim)' } }, 'Decoding…');
    box.append(cv, h('div', { style: { display: 'flex', gap: '8px' } }, button('▶ Play', () => this.playAudio(m), { primary: true }), button('■ Stop', () => this.stopAudio())), status);
    this.viewerBox.appendChild(box);
    try {
      const buf = await this.app.assets.loadAudio(m.id, this.audioCtx());
      const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, data = buf.getChannelData(0), step = Math.max(1, Math.floor(data.length / W));
      ctx.fillStyle = '#ff9a2a'; ctx.clearRect(0, 0, W, H);
      for (let x = 0; x < W; x++) { let lo = 1, hi = -1; for (let i = 0; i < step; i++) { const v = data[x * step + i] || 0; if (v < lo) lo = v; if (v > hi) hi = v; } ctx.fillRect(x, (1 + lo) * H / 2, 1, Math.max(1, (hi - lo) * H / 2)); }
      status.textContent = `${buf.duration.toFixed(2)} s · ${buf.numberOfChannels} ch · ${buf.sampleRate} Hz`;
    } catch (e) { status.textContent = 'Could not decode: ' + e.message; status.style.color = 'var(--danger)'; }
  }
  audioCtx() { return (this._ac ||= new (window.AudioContext || window.webkitAudioContext)()); }
  async playAudio(m) {
    this.stopAudio();
    try { const ac = this.audioCtx(); await ac.resume(); const buf = await this.app.assets.loadAudio(m.id, ac); const src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination); src.start(); this._src = src; } catch (e) { this.app.toast('Cannot play: ' + e.message, 'error'); }
  }
  stopAudio() { try { this._src?.stop(); } catch { /* already stopped */ } this._src = null; }

  // ---------------------------------------------------------------- editing
  update(patch, { label, mergeKey, preview = true } = {}) {
    const m = this.meta();
    if (!this.editable(m)) return;
    const next = patch.__replace ? patch.__replace : { ...m, ...patch };
    this.app.exec(setData(['assets', m.id], next, { mergeKey: mergeKey || `asset:${m.id}:${Object.keys(patch).join(',')}`, label: label || `Edit asset “${m.name}”` }));
    if (preview) { this.viewer?.applyOverrides(next.materialOverrides || {}); this.viewer?.setOverlays(next); }
  }
  refresh() { for (const r of this.refreshers || []) r(); const m = this.meta(); if (m && m.kind === 'model') this.viewer?.setOverlays(m); }

  async makeEditable() {
    const m = this.meta();
    const ok = await confirmBox('Copy built-in asset', `Copy “${m.name}” (${formatBytes(m.size || 0)}) into this project so it can be edited? The game’s own file is only read, never changed.`, { ok: 'Copy into project' });
    if (!ok) return;
    try {
      const res = await fetch(await this.app.assets.url(m));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const id = `user_${m.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${uid('c').slice(-4)}`;
      const file = baseName(m.path);
      await this.app.storage.putBlob(`${this.app.project.meta.id}/${id}/${file}`, blob);
      const copy = { ...JSON.parse(JSON.stringify(m)), id, builtin: false, path: file, files: [file], name: `${m.name} (copy)`, source: `copied from built-in ${m.id}`, importedAt: new Date().toISOString() };
      this.app.exec(setData(['assets', id], copy, { label: 'Copy built-in asset' }));
      this.app.emit('assets');
      this.select(id);
    } catch (e) { this.app.toast('Could not copy the asset: ' + e.message, 'error'); this.app.log('error', 'Copy built-in asset failed: ' + e.message); }
  }

  async removeAsset() {
    const m = this.meta(), users = this.usage(m.id);
    if (!(await confirmBox('Remove asset', `Remove “${m.name}” from this project?${users.length ? `\n\n${users.length} object(s) use it and will show a “missing asset” problem.` : ''}`, { ok: 'Remove', danger: true }))) return;
    const next = { ...this.app.project.data.assets }; delete next[m.id];
    this.app.exec(setData(['assets'], next, { label: 'Remove asset' }));
    for (const f of m.files || [m.path]) await this.app.storage.deleteBlob(`${this.app.project.meta.id}/${m.id}/${f}`).catch(() => {});
    this.app.assets.invalidate(m.id);
    this.selected = null; this.app.emit('assets'); this.show();
  }

  placeNow() { this.app.run('asset.place', this.selected); this.app.shell.show('scene'); }

  async saveAsPrefab() {
    const m = this.meta();
    const name = await promptBox('Save as prefab', 'Prefab name', m.name);
    if (!name?.trim()) return;
    const id = this.app.makePrefabFromAsset(name.trim(), m);
    this.app.toast(`Prefab “${name.trim()}” saved (${id}).`, 'ok');
  }

  async applyToInstances() {
    const m = this.meta(), users = this.app.scene.find((n) => n.type === 'model' && n.props.asset === m.id);
    if (!users.length) { this.app.toast('No objects in the scene use this asset.', 'info'); return; }
    if (!(await confirmBox('Apply defaults to existing objects', `Overwrite collision, sounds, interaction and material overrides of ${users.length} existing object(s) with this asset’s defaults? Their position and rotation stay unchanged.`, { ok: 'Overwrite' }))) return;
    const d = placementProps(m);
    this.app.tx('Apply asset defaults', () => users.forEach((n) => { const { asset, ...rest } = d; this.app.setProps(n.id, { collision: 'auto-box', sounds: [], interaction: null, materialOverrides: {}, ...rest }); }));
  }

  // ---------------------------------------------------------------- properties panel
  build() {
    this.refreshers = [];
    const m = this.meta();
    if (!m) { this.props.replaceChildren(h('div', { class: 'empty' }, 'Select an asset to inspect it.')); return; }
    const ed = this.editable(m);
    const ro = (f) => { if (!ed) f.el.querySelectorAll('input,select,textarea,button').forEach((i) => { i.disabled = true; }); return f.el; };
    const users = this.usage(m.id);
    const blocks = [];
    if (!ed) blocks.push(h('div', { class: 'note warn' }, 'Built-in asset from the game (read-only). Copy it into the project to edit scale, pivot, collision and more.'), h('div', { style: { padding: '0 10px 8px' } }, button('Copy into project to edit', () => this.makeEditable(), { primary: true })));
    blocks.push(h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '8px 10px' } }, m.kind === 'model' ? button('Place in scene', () => this.placeNow(), { primary: true }) : null, m.kind === 'model' ? button('Save as prefab…', () => this.saveAsPrefab()) : null,
      m.kind === 'image' ? button('Create material', () => { this.app.shell.show('materials'); this.app.materialsWs?.create({ name: m.name, map: m.id }); }) : null,
      ed ? button('Remove', () => this.removeAsset()) : null));
    const info = h('div', { class: 'kv', style: { fontSize: '11px' } }, h('span', {}, 'Id'), h('code', {}, m.id), h('span', {}, 'Format'), h('span', {}, `${m.format} · ${formatBytes(m.size || 0)}`),
      ...(m.kind === 'model' ? [h('span', {}, 'Geometry'), h('span', {}, `${(m.triangles || 0).toLocaleString()} tris · ${m.meshes || 0} meshes`), h('span', {}, 'Size (m)'), h('span', {}, (() => { const b = m.bounds; return b ? b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' × ') : '—'; })())] : []),
      ...(m.kind === 'image' ? [h('span', {}, 'Dimensions'), h('span', {}, m.width ? `${m.width}×${m.height}` : '—')] : []),
      ...(m.kind === 'audio' ? [h('span', {}, 'Audio'), h('span', {}, `${m.duration || '?'} s · ${m.channels || '?'} ch · ${m.sampleRate || '?'} Hz`)] : []),
      h('span', {}, 'Used by'), h('span', {}, `${users.length} object(s)`), h('span', {}, 'Imported'), h('span', {}, m.importedAt ? new Date(m.importedAt).toLocaleString() : 'part of the game'));
    const name = textField('Name', { value: m.name, onChange: (v) => this.update({ name: v.trim() || m.name }, { label: 'Rename asset' }) });
    const lic = textField('Licence', { value: m.license || '', hint: 'Who may use this, under what terms.', onChange: (v) => this.update({ license: v }, { label: 'Edit licence' }) });
    const src = textField('Source', { value: m.source || '', onChange: (v) => this.update({ source: v }, { label: 'Edit source' }) });
    blocks.push(section('General', [ro(name), ro(lic), ro(src), info], { key: 'asset.general', prefs: this.app }));
    if (m.kind === 'model') this.modelSections(m, ro, blocks);
    this.props.replaceChildren(...blocks);
  }

  modelSections(m, ro, blocks) {
    const app = this.app;
    const scale = numberField('Scale', { value: m.scale || 1, step: 0.01, min: 0.0001, hint: 'Multiplier applied to the file. 0.01 for centimetre exports, 0.0254 for inches.', onChange: (v) => this.update(withTransform(m, { scale: v }), { label: 'Scale asset', mergeKey: `asset:${m.id}:scale` }) });
    const pivot = vec3Field('Pivot offset', { value: m.pivot || [0, 0, 0], step: 0.05, unit: 'm', onChange: (v) => this.update(withTransform(m, { pivot: v }), { label: 'Move pivot', mergeKey: `asset:${m.id}:pivot` }) });
    const preset = selectField('Pivot preset', { value: 'origin', options: Object.keys(PIVOT_PRESETS), optionLabel: (k) => PIVOT_PRESETS[k].label, onChange: (k) => { const cur = this.meta(); this.update(withTransform(cur, { pivot: PIVOT_PRESETS[k].calc(cur) }), { label: 'Set pivot preset' }); } });
    this.refreshers.push(() => { const c = this.meta(); if (c) { scale.set(c.scale || 1); pivot.set(c.pivot || [0, 0, 0]); } });
    blocks.push(section('Scale & pivot', [ro(scale), h('div', { style: { display: 'flex', gap: '6px', padding: '2px 0 6px 118px' } }, ...[['×1', 1], ['cm→m', 0.01], ['in→m', 0.0254], ['mm→m', 0.001]].map(([l, v]) => { const b = button(l, () => this.update(withTransform(this.meta(), { scale: v }), { label: 'Scale asset' })); b.disabled = !this.editable(); return b; })), ro(pivot), ro(preset)], { key: 'asset.scale', prefs: app }));

    const col = selectField('Collision', { value: m.collision || 'auto-box', options: ['none', 'auto-box', 'custom'], hint: 'Default for NEW objects placed from this asset.', onChange: (v) => { const cur = this.meta(); const b = effectiveBounds(cur); this.update({ collision: v, ...(v === 'custom' && !cur.colliderSize && b ? { colliderCenter: b.min.map((x, i) => (x + b.max[i]) / 2), colliderSize: b.max.map((x, i) => x - b.min[i]) } : {}) }, { label: 'Set collision' }); this.build(); } });
    const cc = vec3Field('Collider centre', { value: m.colliderCenter || [0, 0.5, 0], step: 0.05, unit: 'm', onChange: (v) => this.update({ colliderCenter: v }, { label: 'Move collider', mergeKey: `asset:${m.id}:cc` }) });
    const cs = vec3Field('Collider size', { value: m.colliderSize || [1, 1, 1], step: 0.05, unit: 'm', min: 0.01, onChange: (v) => this.update({ colliderSize: v }, { label: 'Resize collider', mergeKey: `asset:${m.id}:cs` }) });
    const fit = button('Fit to bounds', () => { const b = effectiveBounds(this.meta()); if (b) { this.update({ collision: 'custom', colliderCenter: b.min.map((x, i) => (x + b.max[i]) / 2), colliderSize: b.max.map((x, i) => x - b.min[i]) }, { label: 'Fit collider' }); this.build(); } });
    if (!this.editable()) fit.disabled = true;
    blocks.push(section('Collision', [ro(col), ...(m.collision === 'custom' ? [ro(cc), ro(cs)] : []), h('div', { style: { padding: '2px 0 4px 118px' } }, fit)], { key: 'asset.collision', prefs: app }));

    // material overrides
    const names = this.viewer?.materialNames() || [];
    const matIds = ['', ...allMaterialIds(app.project)];
    const ov = m.materialOverrides || {};
    const rows = names.length ? names.map((n) => { const f = selectField(n.name, { value: ov[n.name] || '', options: matIds, optionLabel: (id) => id === '' ? '(original)' : getMaterialDef(app.project, id)?.name || id, hint: `${n.meshes} mesh(es)`, onChange: (v) => { const next = { ...(this.meta().materialOverrides || {}) }; if (v) next[n.name] = v; else delete next[n.name]; this.update({ materialOverrides: next }, { label: 'Material override' }); } }); return ro(f); }) : [h('div', { class: 'hint', style: { color: 'var(--faint)' } }, 'Materials appear once the model has loaded.')];
    blocks.push(section('Materials', rows, { key: 'asset.mats', prefs: app, open: false }));

    // animations
    const clips = this.viewer?.clips || [];
    const clipName = this.clipSel?.value || clips[0]?.name;
    const anims = m.animations || [];
    const entry = anims.find((a) => a.name === clipName);
    const animBody = [];
    if (!clips.length) animBody.push(h('div', { class: 'hint', style: { color: 'var(--faint)' } }, 'No animation clips in this file.'));
    else {
      animBody.push(h('div', { class: 'kv', style: { fontSize: '11px', marginBottom: '6px' } }, clips.flatMap((c) => [h('span', {}, c.name), h('span', {}, `${c.duration.toFixed(2)} s · ${anims.find((a) => a.name === c.name)?.events?.length || 0} event(s)`)])));
      const evs = entry?.events || [];
      animBody.push(h('div', { class: 'menu-head', style: { padding: '4px 0' } }, `Events on “${clipName}”`));
      evs.forEach((ev, i) => {
        const t = numberField('Time', { value: ev.time, step: 0.01, min: 0, unit: 's', onChange: (v) => this.setEvents(clipName, evs.map((e, k) => (k === i ? { ...e, time: v } : e))) });
        const nm = textField('Event', { value: ev.name, placeholder: 'e.g. footstep, hit, spawn', onChange: (v) => this.setEvents(clipName, evs.map((e, k) => (k === i ? { ...e, name: v } : e))) });
        animBody.push(ro(t), ro(nm), h('div', { style: { padding: '0 0 6px 118px' } }, (() => { const b = button('Remove event', () => this.setEvents(clipName, evs.filter((_, k) => k !== i))); b.disabled = !this.editable(); return b; })()));
      });
      const add = button('+ Add event at current time', () => this.setEvents(clipName, [...evs, { time: +(this.viewer.time || 0).toFixed(3), name: 'event' }].sort((a, b) => a.time - b.time)));
      add.disabled = !this.editable();
      animBody.push(add);
    }
    blocks.push(section('Animation clips & events', animBody, { key: 'asset.anim', prefs: app, open: clips.length > 0 }));

    // sounds
    const sounds = m.attachedSounds || [];
    const audio = ['', ...app.assets.allMeta('audio').map((a) => a.id)];
    const soundBody = sounds.map((s, i) => {
      const set = (patch) => this.update({ attachedSounds: sounds.map((x, k) => (k === i ? { ...x, ...patch } : x)) }, { label: 'Edit attached sound' });
      return h('div', { style: { borderBottom: '1px solid var(--line)', paddingBottom: '6px', marginBottom: '6px' } },
        ro(selectField('Sound', { value: s.asset || '', options: audio, optionLabel: (id) => id === '' ? '(none)' : app.assets.meta(id)?.name || id, onChange: (v) => set({ asset: v }) })),
        ro(selectField('Plays', { value: s.trigger || 'loop', options: SOUND_TRIGGERS, onChange: (v) => set({ trigger: v }) })),
        ro(textField('Event name', { value: s.event || '', hint: 'For “on event” / “on animation event”.', onChange: (v) => set({ event: v }) })),
        ro(numberField('Volume', { value: s.volume ?? 1, step: 0.05, min: 0, max: 2, onChange: (v) => set({ volume: v }) })),
        ro(numberField('Max distance', { value: s.maxDistance ?? 20, step: 1, min: 1, unit: 'm', onChange: (v) => set({ maxDistance: v }) })),
        (() => { const b = button('Remove sound', () => this.update({ attachedSounds: sounds.filter((_, k) => k !== i) }, { label: 'Remove attached sound' })); b.disabled = !this.editable(); return b; })());
    });
    const addSnd = button('+ Attach sound', () => this.update({ attachedSounds: [...sounds, { asset: '', trigger: 'loop', volume: 1, maxDistance: 20 }] }, { label: 'Attach sound' }));
    addSnd.disabled = !this.editable();
    blocks.push(section('Attached sounds', [...soundBody, addSnd], { key: 'asset.snd', prefs: app, open: sounds.length > 0 }));

    // interaction
    const it = m.interaction;
    const setI = (patch) => this.update({ interaction: { enabled: true, prompt: 'use', hold: 0, requires: '', event: '', ...(this.meta().interaction || {}), ...patch } }, { label: 'Edit interaction' });
    const interBody = [ro(boolField('Interactable', { value: !!it?.enabled, onChange: (v) => (v ? setI({ enabled: true }) : this.update({ interaction: it ? { ...it, enabled: false } : null }, { label: 'Disable interaction' })) }))];
    if (it?.enabled) interBody.push(ro(textField('Prompt', { value: it.prompt || 'use', onChange: (v) => setI({ prompt: v }) })), ro(numberField('Hold time', { value: it.hold || 0, step: 0.1, min: 0, unit: 's', onChange: (v) => setI({ hold: v }) })), ro(textField('Requires item', { value: it.requires || '', onChange: (v) => setI({ requires: v }) })), ro(textField('Event on use', { value: it.event || '', hint: 'Name handled by the Events graph.', onChange: (v) => setI({ event: v }) })));
    blocks.push(section('Interaction defaults', interBody, { key: 'asset.inter', prefs: app, open: !!it?.enabled }));
    blocks.push(h('div', { style: { padding: '10px' } }, (() => { const b = button('Apply defaults to existing objects…', () => this.applyToInstances()); return b; })(), h('div', { class: 'hint', style: { color: 'var(--faint)', fontSize: '11px', marginTop: '4px' } }, 'Defaults only affect objects you place from now on, unless you press this button.')));
  }

  setEvents(clip, events) {
    const m = this.meta();
    const anims = (m.animations || []).map((a) => (a.name === clip ? { ...a, events } : a));
    this.update({ animations: anims }, { label: 'Edit animation events' });
    this.build();
  }
}

export default {
  id: 'assets', label: 'Assets', fill: true,
  create(app, el) { const w = new AssetsWorkspace(app, el); app.assetsWs = w; return w; },
};

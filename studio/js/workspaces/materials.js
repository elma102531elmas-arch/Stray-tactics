// Material editor: list, live 3D preview and property editor. Edits are undoable data commands; built-in presets are
// read-only until you explicitly duplicate (or override) them, so nothing the game or a map relies on is silently changed.
import { h } from '../ui/dom.js';
import { numberField, selectField, boolField, textField, colorField, button, section, vec3Field } from '../ui/fields.js';
import { confirmBox, promptBox } from '../ui/dialogs.js';
import { MaterialPreview } from '../ui/matpreview.js';
import { PRESET_MATERIALS, defaultMaterial, getMaterialDef, cloneMaterial, allMaterialIds } from '../core/materials.js';
import { SURFACES } from '../core/schema.js';
import { setData } from '../core/commands.js';
import { guessTextureSet } from '../assets/meta.js';
import { uid } from '../core/util.js';

const SLOTS = [['map', 'Base colour'], ['normalMap', 'Normal map'], ['ormMap', 'AO / Roughness / Metal'], ['emissiveMap', 'Emissive'], ['alphaMap', 'Opacity mask']];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'material';

class MaterialsWorkspace {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.selected = null;
    this.q = '';
    this.list = h('div', { class: 'panel-body', style: { flex: 1 } });
    this.search = h('input', { class: 'search', placeholder: 'Search materials…', 'aria-label': 'Search materials', oninput: () => { this.q = this.search.value.toLowerCase(); this.renderList(); } });
    this.previewBox = h('div', { style: { flex: 1, position: 'relative', minHeight: '200px' } });
    this.shapeSel = h('select', { class: 'tb-select', 'aria-label': 'Preview shape', onchange: () => this.preview?.setShape(this.shapeSel.value) }, ['sphere', 'cube', 'plane'].map((s) => h('option', { value: s }, s)));
    this.props = h('div', { class: 'panel-body insp' });
    el.append(h('div', { class: 'split', style: { height: '100%' } },
      h('div', { class: 'pane', style: { width: '250px', display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: '1px solid var(--line)' } },
        h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Materials'), this.search),
        this.list,
        h('div', { style: { padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: '1px solid var(--line)' } }, button('New', () => this.create(), { primary: true }), button('From textures…', () => this.fromTextures()))),
      h('div', { class: 'pane', style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('div', { class: 'panel-head' }, h('span', { class: 'title', id: 'mat-title' }, 'Preview'), h('span', { class: 'grow' }), this.shapeSel), this.previewBox),
      h('div', { class: 'pane', style: { width: '340px', background: 'var(--panel)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' } }, h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Properties')), this.props)));
    app.on('history', () => this.onData());
    app.on('project', () => { this.selected = null; this.renderList(); this.build(); this.preview?.refresh(); });
    app.on('assets', () => this.build());
    app.on('goto', (e) => { if (e.workspace === 'materials' && e.material) this.select(e.material); });
  }

  show() {
    if (!this.preview) { this.preview = new MaterialPreview(this.app, this.previewBox); }
    this.preview.resize();
    if (!this.selected) this.select(allMaterialIds(this.app.project)[0]);
    else { this.renderList(); this.build(); }
  }
  hide() {}

  ids() { return allMaterialIds(this.app.project); }
  isPreset(id) { return !!PRESET_MATERIALS[id] && !this.app.project.data.materials[id]; }
  usage(id) { return this.app.scene.find((n) => n.props.material === id); }

  onData() {
    if (!this.el.classList.contains('on')) return;
    this.renderList();
    if (this.selected && !getMaterialDef(this.app.project, this.selected)) this.selected = null;
    this.refreshValues();
    this.preview?.refresh();
  }

  select(id) {
    this.selected = id;
    this.preview?.setMaterial(id);
    this.renderList(); this.build();
  }

  renderList() {
    const proj = this.app.project, all = this.ids();
    const match = (id) => !this.q || id.toLowerCase().includes(this.q) || (getMaterialDef(proj, id)?.name || '').toLowerCase().includes(this.q);
    const row = (id) => {
      const d = getMaterialDef(proj, id);
      return h('div', { class: 'tree-row' + (id === this.selected ? ' sel primary' : ''), style: { position: 'relative', height: '28px' }, 'data-mat': id, onclick: () => this.select(id) },
        h('span', { style: { width: '16px', height: '16px', borderRadius: '50%', background: d.color, border: '1px solid #fff3', marginLeft: '8px', flex: 'none' } }),
        h('span', { class: 'tree-name' }, d.name), h('span', { class: 'tree-tag' }, this.usage(id).length ? `${this.usage(id).length}×` : ''));
    };
    const mine = all.filter((id) => !this.isPreset(id) && match(id)), presets = all.filter((id) => this.isPreset(id) && match(id));
    this.list.replaceChildren(h('div', { class: 'menu-head' }, `Project materials (${mine.length})`), ...mine.map(row), h('div', { class: 'menu-head' }, `Built-in presets (${presets.length})`), ...presets.map(row));
  }

  // ---------------------------------------------------------------- editing
  edit(patch, label) {
    const id = this.selected, cur = getMaterialDef(this.app.project, id);
    this.app.exec(setData(['materials', id], { ...cur, ...patch, preset: false }, { mergeKey: `mat:${id}:${Object.keys(patch).join(',')}`, label: label || `Edit material “${cur.name}”` }));
  }

  create(def = {}) {
    const id = `mat_${slug(def.name || 'new')}_${uid('m').slice(-4)}`;
    this.app.exec(setData(['materials', id], { ...defaultMaterial(def.name || 'New material'), ...def, preset: false }, { label: 'Create material' }));
    this.select(id);
    return id;
  }
  async duplicate() {
    const src = getMaterialDef(this.app.project, this.selected);
    const id = this.create(cloneMaterial(src, `${src.name} copy`));
    this.app.log('info', `Duplicated material “${src.name}”`);
    return id;
  }
  async override() {
    const id = this.selected;
    if (!(await confirmBox('Override built-in preset', `Create a project-level copy of “${PRESET_MATERIALS[id].name}” under the SAME id?\n\nEvery object using it will use your edited version. The original preset is not changed and can be restored by deleting the override.`, { ok: 'Create override' }))) return;
    this.app.exec(setData(['materials', id], { ...PRESET_MATERIALS[id], preset: false }, { label: 'Override preset' }));
    this.select(id);
  }
  async remove() {
    const id = this.selected, users = this.usage(id);
    const d = getMaterialDef(this.app.project, id);
    const restoresPreset = !!PRESET_MATERIALS[id];
    const msg = users.length ? `“${d.name}” is used by ${users.length} object(s). They will show the “missing material” warning${restoresPreset ? '' : ' (magenta)'} until you assign another.` : `Delete “${d.name}”?`;
    if (!(await confirmBox('Delete material', msg + (restoresPreset ? '\n\nThe built-in preset with this id will be used again.' : ''), { ok: 'Delete', danger: true }))) return;
    const next = { ...this.app.project.data.materials }; delete next[id];
    this.app.exec(setData(['materials'], next, { label: 'Delete material' }));
    this.select(restoresPreset ? id : this.ids()[0]);
  }
  async rename() {
    const d = getMaterialDef(this.app.project, this.selected);
    const v = await promptBox('Rename material', 'Name', d.name);
    if (v && v.trim()) this.edit({ name: v.trim() }, 'Rename material');
  }
  async fromTextures() {
    const images = this.app.assets.allMeta('image').filter((m) => !m.builtin);
    if (!images.length) { this.app.toast('Import some texture files first (File ▸ Import assets…). Names like wood_diff, wood_nor, wood_arm are matched automatically.', 'info'); return; }
    const guess = guessTextureSet(images);
    if (!Object.keys(guess).length) { this.app.toast('Could not tell which texture is which from the file names. Create a material and pick the textures by hand.', 'warn'); }
    const base = (images.find((m) => m.id === guess.map) || images[0]).name.replace(/[_\-. ]?(diff|diffuse|albedo|basecolor|color)$/i, '');
    const id = this.create({ name: base, ...guess });
    this.app.log('ok', `Created material “${base}” from ${Object.keys(guess).length} texture(s): ${Object.keys(guess).join(', ') || 'none matched'}`);
    return id;
  }
  assignToSelection() {
    const a = this.app, id = this.selected;
    const targets = a.selection.filter((n) => a.scene.get(n) && 'material' in a.scene.get(n).props);
    if (!targets.length) { a.toast('Select objects that have a material (walls, floors, boxes…) first.', 'info'); return; }
    a.tx('Assign material', () => targets.forEach((n) => a.setProps(n, { material: id })));
    a.log('info', `Assigned “${getMaterialDef(a.project, id).name}” to ${targets.length} object(s)`);
  }

  // ---------------------------------------------------------------- property panel
  build() {
    this.refreshers = [];
    const id = this.selected;
    const def = id && getMaterialDef(this.app.project, id);
    document.getElementById('mat-title') && (document.getElementById('mat-title').textContent = def ? def.name : 'Preview');
    if (!def) { this.props.replaceChildren(h('div', { class: 'empty' }, 'Select a material.')); return; }
    const preset = this.isPreset(id);
    const ro = (f) => { if (preset) f.el.querySelectorAll('input,select,textarea').forEach((i) => { i.disabled = true; }); this.refreshers.push(() => { const d = getMaterialDef(this.app.project, id); if (d) f.set(f.__get(d)); }); return f.el; };
    const num = (label, key, o = {}) => { const f = numberField(label, { value: def[key], step: 0.05, ...o, onChange: (v) => this.edit({ [key]: v }) }); f.__get = (d) => d[key]; return ro(f); };
    const col = (label, key) => { const f = colorField(label, { value: def[key], onChange: (v) => this.edit({ [key]: v }) }); f.__get = (d) => d[key]; return ro(f); };
    const bool = (label, key) => { const f = boolField(label, { value: def[key], onChange: (v) => this.edit({ [key]: v }) }); f.__get = (d) => d[key]; return ro(f); };
    const used = this.usage(id);
    const head = [
      preset ? h('div', { class: 'note warn' }, 'Built-in preset (read-only). Duplicate it to make an editable copy, or override it for this project.') : null,
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '8px 10px' } },
        button('Duplicate', () => this.duplicate(), { primary: preset }), preset ? button('Override preset…', () => this.override()) : button('Rename…', () => this.rename()),
        !preset ? button(PRESET_MATERIALS[id] ? 'Remove override' : 'Delete', () => this.remove()) : null,
        button('Assign to selection', () => this.assignToSelection(), { primary: !preset }),
        button(`Select users (${used.length})`, () => { this.app.select(used.map((n) => n.id)); this.app.shell.show('scene'); })),
    ];
    const surface = selectField('Footstep surface', { value: def.surface || '', options: ['', ...SURFACES], hint: 'Used for footstep sounds on floors made with this material.', onChange: (v) => this.edit({ surface: v }) });
    surface.__get = (d) => d.surface || '';
    const tile = (axis) => { const f = numberField(axis === 0 ? 'Tile size X' : 'Tile size Y', { value: 1 / def.tiling[axis], step: 0.1, min: 0.01, unit: 'm', hint: axis === 0 ? 'How many metres one copy of the texture covers. Walls and floors keep this size when resized.' : undefined, onChange: (v) => { const t = [...getMaterialDef(this.app.project, id).tiling]; t[axis] = 1 / v; this.edit({ tiling: t }); } }); f.__get = (d) => 1 / d.tiling[axis]; return ro(f); };
    const off = vec3Field('Offset (x,y)', { value: [def.offset[0], def.offset[1], 0], step: 0.05, onChange: (v) => this.edit({ offset: [v[0], v[1]] }) });
    off.__get = (d) => [d.offset[0], d.offset[1], 0];
    const slots = SLOTS.map(([key, label]) => this.slotField(key, label, def, preset));
    this.props.replaceChildren(...head.filter(Boolean),
      section('Surface', [num('Roughness', 'roughness', { min: 0, max: 1 }), num('Metalness', 'metalness', { min: 0, max: 1 }), col('Colour tint', 'color'), num('Opacity', 'opacity', { min: 0, max: 1 }), bool('Double sided', 'doubleSided'), ro(surface)], { key: 'mat.surface', prefs: this.app }),
      section('Emission', [col('Emissive colour', 'emissive'), num('Emissive strength', 'emissiveIntensity', { min: 0, step: 0.1 })], { key: 'mat.emis', prefs: this.app }),
      section('Textures', [...slots, num('Normal strength', 'normalScale', { min: 0, step: 0.1 })], { key: 'mat.tex', prefs: this.app }),
      section('Tiling', [tile(0), tile(1), num('Rotation', 'rotation', { step: 5, unit: '°' }), ro(off)], { key: 'mat.tile', prefs: this.app }),
      section('Info', h('div', { class: 'kv', style: { fontSize: '11px' } }, h('span', {}, 'Id'), h('code', {}, id), h('span', {}, 'Used by'), h('span', {}, `${used.length} object(s)`), h('span', {}, 'Load problems'), h('span', {}, [...this.app.materials.loadFailures].map(([k, v]) => `${k}: ${v}`).join('; ') || 'none')), { key: 'mat.info', prefs: this.app, open: false }));
  }

  slotField(key, label, def, preset) {
    const imgs = this.app.assets.allMeta('image');
    const opts = ['', ...imgs.map((m) => m.id)];
    const lab = (id) => id === '' ? '(none)' : (imgs.find((m) => m.id === id)?.name || id) + (id.startsWith('builtin:') ? '  [built-in]' : '');
    const f = selectField(label, { value: def[key] || '', options: opts, optionLabel: lab, onChange: (v) => this.edit({ [key]: v }, `Set ${label}`) });
    f.__get = (d) => d[key] || '';
    const thumb = h('img', { alt: label, style: { width: '34px', height: '34px', objectFit: 'cover', borderRadius: '4px', background: 'var(--bg)', flex: 'none' } });
    const setThumb = async (id) => { const m = id && this.app.assets.meta(id); thumb.style.visibility = m ? 'visible' : 'hidden'; if (m) { try { thumb.src = await this.app.assets.url(m); } catch { thumb.removeAttribute('src'); } } };
    setThumb(def[key]);
    const ctl = f.el.querySelector('.ctl');
    ctl.prepend(thumb);
    ctl.appendChild(button('Import…', () => this.app.run('asset.import'), { title: 'Import texture files' }));
    if (preset) f.el.querySelectorAll('input,select,button').forEach((i) => { i.disabled = true; });
    this.refreshers.push(() => { const d = getMaterialDef(this.app.project, this.selected); if (d) { f.set(d[key] || ''); setThumb(d[key]); } });
    return f.el;
  }

  refreshValues() { for (const r of this.refreshers || []) r(); }
}

export default {
  id: 'materials', label: 'Materials', fill: true,
  create(app, el) { const w = new MaterialsWorkspace(app, el); app.materialsWs = w; return w; },
};

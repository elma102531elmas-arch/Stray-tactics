// Inspector: schema-driven property editor for the selection. The node type registry (core/schema.js) describes
// every property, so new node types get an editor for free. All edits are undoable commands.
import { h, fmt } from './dom.js';
import { TYPES } from '../core/schema.js';
import * as C from '../core/commands.js';
import { allMaterialIds, getMaterialDef } from '../core/materials.js';
import { propsOf } from '../core/geometry.js';
import { numberField, vec3Field, boolField, selectField, textField, colorField, jsonField, button, section } from './fields.js';
import { DECAL_KINDS } from '../viewport/decals.js';

export class Inspector {
  constructor(app, el, { viewport } = {}) {
    this.app = app; this.el = el; this.vp = viewport;
    this.ctrls = [];
    this.body = h('div', { class: 'panel-body' });
    el.append(h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Inspector')), this.body);
    app.on('selection', () => this.build());
    app.on('project', () => this.build());
    app.on('assets', () => this.build());
    app.on('scene', (ev, id) => { if (ev === 'changed' && app.selection.includes(id)) this.softRefresh(); });
    app.on('history', () => this.softRefresh());
    this.build();
  }

  softRefresh() {
    if (this._sr) return;
    this._sr = true;
    requestAnimationFrame(() => {
      this._sr = false;
      const ids = this.app.selection;
      if (!ids.length || ids.some((i) => !this.app.scene.has(i))) { this.build(); return; }
      for (const c of this.ctrls) c();
    });
  }

  build() {
    this.ctrls = [];
    const app = this.app;
    const ids = app.selection.filter((i) => app.scene.has(i));
    const b = this.body;
    if (!ids.length) { b.replaceChildren(this.projectSummary()); return; }
    const nodes = ids.map((i) => app.scene.get(i));
    const sameType = nodes.every((n) => n.type === nodes[0].type);
    const frag = [];
    frag.push(this.titleBlock(nodes));
    frag.push(section('Transform', this.transformBlock(nodes), { key: 'transform', prefs: app }));
    if (sameType && TYPES[nodes[0].type]) {
      const groups = new Map();
      for (const p of TYPES[nodes[0].type].props) { if (p.type === 'hidden') continue; const g = p.group || 'Properties'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); }
      for (const [g, props] of groups) frag.push(section(g, props.map((p) => this.propField(nodes, p)), { key: nodes[0].type + '.' + g, prefs: app, open: !['Audio', 'Validation', 'Physics'].includes(g) || nodes[0].type !== 'model' }));
    } else frag.push(h('div', { class: 'note' }, 'Objects of different types are selected. Select objects of one type to edit their properties together.'));
    frag.push(section('Tags & info', this.infoBlock(nodes), { key: 'info', prefs: app, open: false }));
    const prob = this.problems(nodes);
    if (prob) frag.push(prob);
    b.replaceChildren(h('div', { class: 'insp' }, frag));
    b.scrollTop = 0;
  }

  projectSummary() {
    const app = this.app, s = app.scene;
    const counts = {};
    s.walk((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
    return h('div', { class: 'insp' },
      h('div', { class: 'insp-title' }, h('b', {}, app.project.meta.name), h('span', { class: 'badge' }, 'project')),
      h('div', { class: 'note' }, 'Nothing selected. Click an object in the viewport or the hierarchy, or choose Create ▸ to add one.'),
      section('Scene summary', h('div', { class: 'kv' }, h('span', {}, 'Objects'), h('b', {}, String(s.size)), ...Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14).flatMap(([t, n]) => [h('span', {}, TYPES[t]?.label || t), h('span', {}, String(n))])), { key: 'summary', prefs: app }));
  }

  titleBlock(nodes) {
    const app = this.app, n = nodes[0];
    const multi = nodes.length > 1;
    const name = h('input', { class: 'name', style: { width: '100%', flex: '1 1 100%' }, 'aria-label': 'Name', value: multi ? '' : n.name, placeholder: multi ? `${nodes.length} objects` : '', disabled: multi, onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); }, onchange: () => app.rename(n.id, name.value) });
    this.ctrls.push(() => { if (!multi && document.activeElement !== name) name.value = app.scene.get(n.id)?.name ?? ''; });
    const vis = h('input', { type: 'checkbox', 'aria-label': 'Visible', title: 'Visible', checked: nodes.every((x) => x.visible), onchange: () => app.tx('Visibility', () => nodes.forEach((x) => app.exec(C.setFields(x.id, { visible: vis.checked })))) });
    const lock = h('input', { type: 'checkbox', 'aria-label': 'Locked', title: 'Locked', checked: nodes.every((x) => x.locked), onchange: () => app.tx('Lock', () => nodes.forEach((x) => app.exec(C.setFields(x.id, { locked: lock.checked })))) });
    this.ctrls.push(() => { vis.checked = nodes.every((x) => app.scene.get(x.id)?.visible); lock.checked = nodes.every((x) => app.scene.get(x.id)?.locked); });
    const types = [...new Set(nodes.map((x) => TYPES[x.type]?.label || x.type))].join(', ');
    return h('div', { class: 'insp-title', style: { flexWrap: 'wrap' } }, name,
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', width: '100%' } }, h('span', { class: 'badge', title: n.id }, types),
        h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center', color: 'var(--dim)' } }, vis, 'Visible'), h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center', color: 'var(--dim)' } }, lock, 'Locked')));
  }

  transformBlock(nodes) {
    const app = this.app, scene = app.scene;
    if (nodes.length > 1) {
      // relative edits for multi-selection
      const moveBy = vec3Field('Move by', { value: [0, 0, 0], unit: 'm', onChange: (v) => { const ids = app.topSelection(); app.exec(C.setTransforms(ids.map((id) => { const t = scene.get(id).t; return { id, t: { p: [t.p[0] + v[0], t.p[1] + v[1], t.p[2] + v[2]] } }; }), { label: 'Move by' })); moveBy.set([0, 0, 0]); } });
      const rotBy = vec3Field('Rotate by', { value: [0, 0, 0], unit: '°', onChange: (v) => { const ids = app.topSelection(); app.exec(C.setTransforms(ids.map((id) => { const t = scene.get(id).t; return { id, t: { r: [t.r[0] + v[0], t.r[1] + v[1], t.r[2] + v[2]] } }; }), { label: 'Rotate by' })); rotBy.set([0, 0, 0]); } });
      const scaleBy = numberField('Scale ×', { value: 1, step: 0.05, min: 0.01, hint: 'Multiplies each object’s own scale.', onChange: (v) => { const ids = app.topSelection(); app.exec(C.setTransforms(ids.map((id) => { const t = scene.get(id).t; return { id, t: { s: t.s.map((x) => x * v) } }; }), { label: 'Scale by' })); scaleBy.set(1); } });
      return [h('div', { class: 'hint', style: { color: 'var(--faint)', marginBottom: '4px' } }, `${nodes.length} objects — values are applied relative to each object.`), moveBy.el, rotBy.el, scaleBy.el];
    }
    const n = nodes[0];
    const mk = (label, key, step, unit) => {
      const f = vec3Field(label, { value: n.t[key], step, unit, onChange: (v) => app.exec(C.setTransforms([{ id: n.id, t: { [key]: v } }], { mergeKey: `t:${n.id}:${key}`, label: `Edit ${label.toLowerCase()}` })) });
      this.ctrls.push(() => { const cur = scene.get(n.id); if (cur) f.set(cur.t[key]); });
      return f.el;
    };
    const world = h('div', { class: 'hint', style: { color: 'var(--faint)', fontSize: '11px', padding: '2px 0 4px' } });
    const upd = () => { const cur = scene.get(n.id); if (!cur) return; const w = scene.worldPosition(n.id); world.textContent = `World position  ${fmt(w.x, 2)}, ${fmt(w.y, 2)}, ${fmt(w.z, 2)}` + (cur.parent !== 'root' ? '  (local values shown above)' : ''); };
    upd(); this.ctrls.push(upd);
    return [mk('Position', 'p', 0.1, 'm'), mk('Rotation', 'r', 5, '°'), mk('Scale', 's', 0.05), world,
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        button('Snap to grid', () => app.run('edit.snapGrid')), button('Drop to floor', () => app.run('edit.dropFloor')), button('Reset', () => app.exec(C.setTransforms([{ id: n.id, t: { r: [0, 0, 0], s: [1, 1, 1] } }], { label: 'Reset rotation/scale' }))))];
  }

  propField(nodes, p) {
    const app = this.app, scene = app.scene;
    const primary = nodes.at(-1);
    const get = () => { const cur = scene.get(primary.id); return cur ? propsOf(cur)[p.key] : undefined; };
    const apply = (value) => {
      const run = () => nodes.forEach((n) => { if (scene.has(n.id)) app.setProps(n.id, { [p.key]: value }); });
      if (nodes.length > 1) app.tx(`Edit ${p.label}`, run); else run();
    };
    const hint = p.hint;
    let f;
    switch (p.type) {
      case 'number': case 'int': f = numberField(p.label, { value: get(), step: p.step ?? 0.05, min: p.min, max: p.max, unit: p.unit, int: p.type === 'int', hint, onChange: (v) => apply(v) }); break;
      case 'bool': f = boolField(p.label, { value: get(), hint, onChange: apply }); break;
      case 'select': f = selectField(p.label, { value: get(), options: p.options, hint, onChange: apply }); break;
      case 'vec3': f = vec3Field(p.label, { value: get() || [0, 0, 0], step: p.step ?? 0.05, min: p.min, unit: p.unit, hint, onChange: apply }); break;
      case 'color': f = colorField(p.label, { value: get(), hint, onChange: apply }); break;
      case 'text': f = textField(p.label, { value: get(), multiline: true, hint, onChange: apply }); break;
      case 'json': f = jsonField(p.label, { value: get(), hint, onChange: apply }); break;
      case 'material': f = this.materialField(p, get, apply); break;
      default:
        if (p.type.startsWith('asset:')) { f = this.assetField(p, get, apply); break; }
        f = textField(p.label, { value: get() ?? '', hint, onChange: apply });
    }
    if (p.readonly) f.el.querySelectorAll('input,select,textarea').forEach((i) => { i.disabled = true; });
    // mixed values
    const mixed = () => nodes.length > 1 && new Set(nodes.map((n) => JSON.stringify(propsOf(scene.get(n.id) || n)[p.key]))).size > 1;
    this.ctrls.push(() => {
      const v = get();
      if (f.set && v !== undefined) f.set(p.type === 'json' ? JSON.stringify(v ?? null, null, 1) : v);
      f.el.title = mixed() ? 'Selected objects have different values; editing sets all of them.' : '';
      f.el.style.opacity = mixed() ? 0.75 : 1;
    });
    return f.el;
  }

  materialField(p, get, apply) {
    const ids = allMaterialIds(this.app.project);
    const f = selectField(p.label, { value: get() || '', options: ['', ...ids], optionLabel: (id) => id === '' ? '(default)' : (getMaterialDef(this.app.project, id)?.name || id), hint: p.hint, onChange: apply });
    const edit = button('Edit…', () => this.app.emit('goto', { workspace: 'materials', material: get() }), { title: 'Open in the Material editor' });
    f.el.querySelector('.ctl').appendChild(edit);
    return f;
  }

  assetField(p, get, apply) {
    const kind = p.type.split(':')[1];
    const app = this.app;
    const metas = app.assets.allMeta(kind);
    const opts = ['', ...metas.map((m) => m.id)];
    if (kind === 'image' && p.key === 'texture') for (const d of DECAL_KINDS) opts.push('builtin:decal/' + d);
    const label = (id) => id === '' ? '(none)' : id.startsWith('builtin:decal/') ? `Decal · ${id.slice(14)} (game art)` : (metas.find((m) => m.id === id)?.name ? `${metas.find((m) => m.id === id).name}${id.startsWith('builtin:') ? '  [built-in]' : ''}` : id);
    const f = selectField(p.label, { value: get() || '', options: [...new Set(opts)], optionLabel: label, hint: p.hint, onChange: apply });
    f.el.querySelector('.ctl').appendChild(button('Import…', () => app.run('asset.import'), { title: 'Import files into this project' }));
    f.el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-sm-asset')) e.preventDefault(); });
    f.el.addEventListener('drop', (e) => { const id = e.dataTransfer.getData('application/x-sm-asset'); if (id) { e.preventDefault(); apply(id); } });
    return f;
  }

  infoBlock(nodes) {
    const app = this.app, n = nodes[0];
    const tags = textField('Tags', { value: nodes.length === 1 ? n.tags.join(', ') : '', placeholder: 'comma separated', hint: 'Used for searching and by events/scripts.', onChange: (v) => {
      const list = v.split(',').map((s) => s.trim()).filter(Boolean);
      app.tx('Edit tags', () => nodes.forEach((x) => app.exec(C.setFields(x.id, { tags: list }))));
    } });
    const rows = [tags.el];
    if (nodes.length === 1) {
      rows.push(h('div', { class: 'kv', style: { marginTop: '6px', fontSize: '11px' } }, h('span', {}, 'ID'), h('code', {}, n.id), h('span', {}, 'Type'), h('span', {}, n.type), h('span', {}, 'Children'), h('span', {}, String(n.children.length))));
      const m = n.meta || {};
      const src = m.source;
      if (src) rows.push(h('div', { class: 'note', style: { margin: '8px 0 0' } }, `Imported object — ${typeof src === 'string' ? src : JSON.stringify(src)}`));
      const extra = Object.entries(m).filter(([k]) => k !== 'source');
      if (extra.length) rows.push(h('div', { class: 'kv', style: { marginTop: '6px', fontSize: '11px' } }, extra.flatMap(([k, v]) => [h('span', {}, k), h('span', {}, typeof v === 'object' ? JSON.stringify(v) : String(v))])));
    }
    return rows;
  }

  problems(nodes) {
    const app = this.app, out = [];
    for (const n of nodes) {
      const entry = this.vp?.sceneView.entryOf(n.id);
      for (const p of entry?.problems || []) out.push({ severity: 'warn', msg: `${n.name}: ${p}` });
      for (const is of app.issuesFor?.(n.id) || []) out.push({ severity: is.severity, msg: is.message });
    }
    if (!out.length) return null;
    return section(`Problems (${out.length})`, out.slice(0, 20).map((o) => h('div', { class: 'note ' + (o.severity === 'error' ? 'err' : 'warn'), style: { margin: '0 0 6px' } }, o.msg)), { key: 'problems', prefs: app });
  }
}

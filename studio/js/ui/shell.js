// Shell: lays out the Studio window, hosts the workspaces (tabs) and wires drag/drop, resizers and tool options.
import { h } from './dom.js';
import { MenuBar } from './menubar.js';
import { HierarchyPanel } from './hierarchy.js';
import { Inspector } from './inspector.js';
import { ConsolePanel, IssuesPanel, AssetsPanel, StatusBar } from './panels.js';
import { Toolbar } from './toolbar.js';
import { toast, contextMenu, modal } from './dialogs.js';
import { numberField, selectField, boolField } from './fields.js';
import { allMaterialIds, getMaterialDef } from '../core/materials.js';
import { BUILD_DEFAULTS } from '../tools/build.js';
import { Viewport } from '../viewport/viewport.js';
import { SelectTool } from '../tools/select.js';
import { PlaceTool, WallTool, RoomTool, CorridorTool, MeasureTool } from '../tools/build.js';
import { runAssetImport } from './importdialog.js';
import { workspaceFactories } from '../workspaces/registry.js';

const TOOL_OPTIONS = {
  wall: ['wallHeight', 'wallThick', 'wallMaterial', 'overlapJoints'],
  room: ['wallHeight', 'wallThick', 'wallMaterial', 'floorMaterial', 'ceilingMaterial', 'floor', 'ceiling', 'doorSide'],
  corridor: ['corridorWidth', 'wallHeight', 'wallThick', 'wallMaterial', 'floorMaterial', 'ceilingMaterial', 'ceiling'],
};
const OPT_LABEL = { wallHeight: 'Wall height', wallThick: 'Wall thickness', wallMaterial: 'Wall material', floorMaterial: 'Floor material', ceilingMaterial: 'Ceiling material', floor: 'Floor', ceiling: 'Ceiling', doorSide: 'Door on side', corridorWidth: 'Corridor width', overlapJoints: 'Fill wall corners' };

export class Shell {
  constructor(app) {
    this.app = app;
    app.shell = this;
    this.workspaces = new Map();
    this.current = null;
  }

  build() {
    const app = this.app;
    const $ = (id) => document.getElementById(id);
    this.el = { app: $('app'), menubar: $('menubar'), toolbar: $('toolbar'), left: $('left'), right: $('right'), center: document.querySelector('.center'), tabs: $('wstabs'), ws: $('workspaces'), bottom: $('bottom'), status: $('statusbar') };
    this.applySizes();
    this.bindResizers();

    // workspace: Scene (viewport) is always first
    const sceneEl = h('div', { class: 'ws fill on', id: 'ws-scene' });
    this.el.ws.appendChild(sceneEl);
    this.workspaces.set('scene', { id: 'scene', label: 'Scene', el: sceneEl, instance: null });
    try {
      this.mountViewport(sceneEl);
    } catch (e) {
      sceneEl.replaceChildren(h('div', { class: 'note err', style: { margin: '24px' } }, h('b', {}, 'The 3D viewport could not start. '), e.message, h('div', { style: { marginTop: '8px' } }, 'Saint Marrow Studio needs WebGL 2. Enable hardware acceleration in your browser settings, or try a current Chrome, Edge or Firefox.')));
      app.log('error', 'Viewport failed to start: ' + e.message);
      console.error(e);
    }
    const vp = app.viewport;

    this.hierarchy = new HierarchyPanel(app, this.el.left, { viewport: vp });
    this.inspector = new Inspector(app, this.el.right, { viewport: vp });
    this.buildBottom(vp);
    this.status = new StatusBar(app, this.el.status, { viewport: vp });
    // extra workspaces
    for (const f of workspaceFactories) this.addWorkspace(f);
    this.renderTabs();
    app.on('goto', (e) => { this.show(e.workspace); app.emit('goto-done', e); });
  }

  mountViewport(sceneEl) {
    const app = this.app;
    const wrap = h('div', { class: 'vp-wrap' });
    sceneEl.appendChild(wrap);
    const vp = new Viewport(app, wrap);
    app.viewport = vp;
    vp.registerTool(new SelectTool()); vp.registerTool(new PlaceTool()); vp.registerTool(new WallTool());
    vp.registerTool(new RoomTool()); vp.registerTool(new CorridorTool()); vp.registerTool(new MeasureTool());
    vp.setTool('select');
    vp.gizmo.setMode('translate');
    this.dropzone = h('div', { class: 'vp-dropzone' }, 'Drop files to import');
    wrap.appendChild(this.dropzone);
    this.toolOpts = h('div', { class: 'chip', style: { position: 'absolute', left: '100px', top: '40px', padding: '8px 10px', borderRadius: '8px', display: 'none', width: '260px' } });
    wrap.appendChild(this.toolOpts);
    vp.on('tool', (t) => this.showToolOptions(t));
    vp.on('contextmenu', (e) => this.viewportMenu(e));
    // drag assets from the browser into the viewport
    wrap.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-sm-asset')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    wrap.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-sm-asset');
      if (!id) return;
      e.preventDefault();
      const meta = app.assets.meta(id);
      if (meta?.kind !== 'model') { toast('Only models can be dropped into the scene.', 'info'); return; }
      const p = vp.groundPoint(e.clientX, e.clientY);
      if (!p) return;
      const s = vp.snap(p);
      app.createNode('model', { name: meta.name, p: [s.x, s.y, s.z], props: { asset: id } });
    });
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) this.dropzone.classList.add('on'); });
    window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) this.dropzone.classList.remove('on'); });
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      this.dropzone.classList.remove('on');
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      const files = await collectDropped(e.dataTransfer);
      if (files.length) await runAssetImport(app, files);
    });
  }

  buildBottom(vp) {
    const app = this.app, b = this.el.bottom;
    const panes = {};
    const mk = (id, label) => { const el = h('div', { id: 'bp-' + id, style: { display: 'none', flex: 1, minHeight: 0, flexDirection: 'column' } }); panes[id] = { el, label }; return el; };
    const consoleEl = mk('console', 'Console'), issuesEl = mk('issues', 'Issues'), assetsEl = mk('assets', 'Assets');
    this.bottomTabs = h('div', { class: 'panel-tabs' });
    const show = (id) => {
      for (const [k, p] of Object.entries(panes)) p.el.style.display = k === id ? 'flex' : 'none';
      this.bottomTabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.id === id));
      this.bottomId = id;
      if (this.el.bottom.classList.contains('collapsed')) this.togglePanel('bottom');
    };
    this.showBottom = show;
    for (const [id, p] of Object.entries(panes)) this.bottomTabs.appendChild(h('button', { 'data-id': id, onclick: () => show(id) }, p.label));
    this.bottomTabs.appendChild(h('span', { style: { flex: 1 } }));
    this.bottomTabs.appendChild(h('button', { title: 'Collapse / expand', 'aria-label': 'Toggle bottom panel', onclick: () => this.togglePanel('bottom') }, '▾'));
    b.append(this.bottomTabs, consoleEl, issuesEl, assetsEl);
    this.console = new ConsolePanel(app, consoleEl);
    this.issues = new IssuesPanel(app, issuesEl, { viewport: vp });
    this.assetsPanel = new AssetsPanel(app, assetsEl, { viewport: vp });
    show('console');
    app.on('issues', () => { const n = (app.issues || []).filter((i) => i.severity !== 'info').length; this.bottomTabs.querySelector('[data-id=issues]').textContent = `Issues${n ? ` (${n})` : ''}`; });
  }

  // ------------------------------------------------------------------ panels & sizes
  panelVisible(which) {
    if (which === 'left') return this.el.left.style.display !== 'none';
    if (which === 'right') return this.el.right.style.display !== 'none';
    return !this.el.bottom.classList.contains('collapsed');
  }
  togglePanel(which) {
    const hide = this.panelVisible(which);
    if (which === 'bottom') this.el.bottom.classList.toggle('collapsed', hide);
    else { this.el[which].style.display = hide ? 'none' : ''; const r = document.querySelector(`[data-resize=${which}]`); if (r) r.style.display = hide ? 'none' : ''; }
    this.app.setPref('panel.' + which, !hide);
    this.app.emit('view');
    requestAnimationFrame(() => this.app.viewport?.resize());
  }
  applySizes() {
    const root = this.el.app.style, p = (k, d) => this.app.pref(k, d);
    root.setProperty('--left-w', p('size.left', 270) + 'px'); root.setProperty('--right-w', p('size.right', 320) + 'px'); root.setProperty('--bottom-h', p('size.bottom', 190) + 'px');
  }
  bindResizers() {
    document.querySelectorAll('.resizer').forEach((r) => {
      r.addEventListener('pointerdown', (e) => {
        e.preventDefault(); r.setPointerCapture(e.pointerId);
        const which = r.dataset.resize, start = which === 'bottom' ? e.clientY : e.clientX;
        const cur = parseInt(getComputedStyle(this.el.app).getPropertyValue(`--${which}-${which === 'bottom' ? 'h' : 'w'}`), 10);
        const move = (ev) => {
          let v;
          if (which === 'left') v = cur + (ev.clientX - start); else if (which === 'right') v = cur - (ev.clientX - start); else v = cur - (ev.clientY - start);
          v = Math.max(which === 'bottom' ? 60 : 160, Math.min(which === 'bottom' ? 600 : 640, v));
          this.el.app.style.setProperty(`--${which}-${which === 'bottom' ? 'h' : 'w'}`, v + 'px');
          this.app.setPref('size.' + which, v);
          this.app.viewport?.resize();
        };
        const up = () => { r.removeEventListener('pointermove', move); r.removeEventListener('pointerup', up); };
        r.addEventListener('pointermove', move); r.addEventListener('pointerup', up);
      });
    });
  }

  // ------------------------------------------------------------------ workspaces
  addWorkspace(factory) {
    const el = h('div', { class: 'ws', id: 'ws-' + factory.id });
    this.el.ws.appendChild(el);
    this.workspaces.set(factory.id, { id: factory.id, label: factory.label, el, factory, instance: null });
  }
  renderTabs() {
    this.el.tabs.replaceChildren(...[...this.workspaces.values()].map((w) => h('button', { class: 'tab' + (w.id === (this.current || 'scene') ? ' on' : ''), 'data-ws': w.id, role: 'tab', onclick: () => this.show(w.id) }, w.label)));
  }
  show(id) {
    const w = this.workspaces.get(id);
    if (!w) { this.app.log('warn', `Workspace "${id}" is not available.`); return; }
    if (!w.instance && w.factory) {
      try { w.instance = w.factory.create(this.app, w.el, this); w.el.classList.toggle('fill', !!w.factory.fill); }
      catch (e) { w.el.replaceChildren(h('div', { class: 'note err', style: { margin: '20px' } }, `The ${w.label} workspace failed to start: ${e.message}`)); this.app.log('error', `Workspace ${w.label}: ${e.message}`); console.error(e); }
      w.instance = w.instance || {};
    }
    for (const o of this.workspaces.values()) { o.el.classList.toggle('on', o.id === id); if (o.id !== id && o.id === this.current) o.instance?.hide?.(); }
    this.current = id;
    w.instance?.show?.();
    this.renderTabs();
    if (id === 'scene') requestAnimationFrame(() => this.app.viewport?.resize());
    this.app.emit('workspace', id);
  }

  // ------------------------------------------------------------------ tool options
  showToolOptions(tool) {
    const keys = TOOL_OPTIONS[tool];
    if (!keys) { this.toolOpts.style.display = 'none'; return; }
    const app = this.app;
    const set = (k, v) => app.setPref('build.' + k, v);
    const get = (k) => app.pref('build.' + k, BUILD_DEFAULTS[k]);
    const mats = allMaterialIds(app.project);
    const matLabel = (id) => getMaterialDef(app.project, id)?.name || id;
    const rows = keys.map((k) => {
      const lab = OPT_LABEL[k];
      if (typeof BUILD_DEFAULTS[k] === 'boolean') return boolField(lab, { value: get(k), onChange: (v) => set(k, v) }).el;
      if (k === 'doorSide') return selectField(lab, { value: get(k), options: ['none', 'N', 'S', 'E', 'W'], onChange: (v) => set(k, v) }).el;
      if (k.endsWith('Material')) return selectField(lab, { value: get(k), options: mats, optionLabel: matLabel, onChange: (v) => set(k, v) }).el;
      return numberField(lab, { value: get(k), step: 0.1, min: 0.05, unit: 'm', onChange: (v) => set(k, v) }).el;
    });
    this.toolOpts.replaceChildren(h('b', { style: { display: 'block', marginBottom: '4px', color: 'var(--text)' } }, { wall: 'Wall tool', room: 'Room tool', corridor: 'Corridor tool' }[tool]), ...rows);
    this.toolOpts.style.display = 'block';
  }

  // ------------------------------------------------------------------ viewport context menu
  viewportMenu(e) {
    const app = this.app, vp = app.viewport;
    if (vp.tool.contextMenu?.()) return;
    if (vp.tool.id !== 'select') { vp.tool.cancel?.(); vp.setTool('select'); return; }
    const hit = vp.pick(e.clientX, e.clientY);
    if (hit && !app.selection.includes(hit.id)) app.select([hit.id]);
    const has = app.selection.length > 0;
    const run = (id) => () => app.run(id);
    contextMenu(e.clientX, e.clientY, [
      { header: has ? `${app.selection.length} selected` : 'Scene' },
      { label: 'Frame', shortcut: 'F', disabled: !has, run: run('view.frame') },
      { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !has, run: run('edit.duplicate') },
      { label: 'Delete', shortcut: 'Del', disabled: !has, run: run('edit.delete') },
      { label: 'Group', shortcut: 'Ctrl+G', disabled: !has, run: run('edit.group') },
      { label: 'Drop to floor', shortcut: 'End', disabled: !has, run: run('edit.dropFloor') },
      { sep: true },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !app.clipboard, run: run('edit.paste') },
      { label: 'Create light here', run: () => app.run('create.light') },
      { label: 'Create marker here', run: () => app.run('create.marker') },
    ]);
  }
}

/** Collect files from a drop event, descending into dropped folders. */
export async function collectDropped(dt) {
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) await new Promise((res) => entry.file((f) => { out.push({ path: prefix + f.name, file: f }); res(); }, () => res()));
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      for (;;) { const batch = await new Promise((res) => reader.readEntries(res, () => res([]))); if (!batch.length) break; all.push(...batch); }
      for (const e of all) await walk(e, prefix + entry.name + '/');
    }
  };
  const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) for (const e of entries) await walk(e, '');
  else for (const f of dt.files) out.push({ path: f.name, file: f });
  return out;
}

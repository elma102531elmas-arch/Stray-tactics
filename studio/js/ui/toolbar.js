// Toolbar: buttons bound to actions; checked/enabled state follows the app. Declared as data so it is easy to extend.
import { h } from './dom.js';
import { setData } from '../core/commands.js';

const GROUPS = [
  [['file.new', 'New', 'New / import map'], ['file.open', 'Open', 'Open project'], ['file.save', 'Save', 'Save (Ctrl+S)']],
  [['edit.undo', '↶', 'Undo (Ctrl+Z)'], ['edit.redo', '↷', 'Redo (Ctrl+Shift+Z)']],
  [['tool.select', 'Select', 'Select (Q)'], ['tool.move', 'Move', 'Move (W)'], ['tool.rotate', 'Rotate', 'Rotate (E)'], ['tool.scale', 'Scale', 'Scale (R)'], ['tool.space', 'Local', 'Local / world space (X)']],
  [['tool.wall', 'Wall', 'Draw walls (B)'], ['tool.room', 'Room', 'Draw a room (N)'], ['tool.corridor', 'Corridor', 'Draw a corridor (M)'], ['tool.measure', 'Measure', 'Measure (T)']],
  [['tool.snap', 'Snap', 'Grid snapping (G)']],
];
const VIEW = [['overlay.collision', 'Collision'], ['overlay.navmesh', 'Nav'], ['view.helpers', 'Helpers'], ['view.animate', 'Animate']];

export class Toolbar {
  constructor(app, el) {
    this.app = app; this.el = el; this.btns = new Map();
    this.render();
    for (const ev of ['history', 'selection', 'view', 'project', 'actions', 'playtest']) app.on(ev, () => this.update());
    app.viewport?.on('tool', () => this.update());
    app.viewport?.on('overlay', () => this.update());
    app.viewport?.on('shading', () => this.update());
    app.viewport?.on('projection', () => this.update());
    this.update();
  }
  button(id, label, title) {
    const b = h('button', { class: 'tb-btn', title, 'aria-label': title || label, 'data-action': id, onclick: () => this.app.run(id) }, label);
    this.btns.set(id, b);
    return b;
  }
  render() {
    const app = this.app, vp = app.viewport;
    const groups = GROUPS.map((g) => h('div', { class: 'tb-group' }, g.map(([id, label, title]) => this.button(id, label, title))));
    const k = app.project.data.settings.grid.size;
    this.gridSize = h('select', { class: 'tb-select', 'aria-label': 'Grid size', title: 'Grid size', onchange: (e) => { app.exec(setData(['settings', 'grid', 'size'], parseFloat(e.target.value), { label: 'Grid size' })); vp.rebuildGrid(); vp.gizmo.applySnap(); } },
      [0.1, 0.25, 0.5, 1, 2].map((v) => h('option', { value: v }, v + ' m')));
    this.gridSize.value = String(k);
    this.shading = h('select', { class: 'tb-select', 'aria-label': 'Shading', title: 'Shading mode', onchange: (e) => vp.setShading(e.target.value) },
      [['lit', 'Lit'], ['game', 'Game lighting'], ['wire', 'Wireframe'], ['normals', 'Normals']].map(([v, l]) => h('option', { value: v }, l)));
    const view = h('div', { class: 'tb-group' }, VIEW.map(([id, label]) => this.button(id, label, label)));
    const cam = h('div', { class: 'tb-group' }, h('span', { class: 'tb-label' }, 'Grid'), this.gridSize, h('span', { class: 'tb-label', style: { marginLeft: '8px' } }, 'View'), this.shading,
      this.button('view.ortho', 'Ortho', 'Orthographic camera'), this.button('view.top', 'Top', 'Top view'), this.button('view.frame', 'Frame', 'Frame selection (F)'));
    const proj = h('div', { class: 'tb-group' }, this.button('project.validate', 'Validate', 'Validate map (F7)'), this.button('playtest.start', '▶ Playtest', 'Walk through the map (Ctrl+P)'), this.button('playtest.stop', '■ Stop', 'Stop the playtest'));
    this.el.replaceChildren(...groups, cam, view, proj);
  }
  update() {
    const app = this.app;
    for (const [id, b] of this.btns) {
      const a = app.actions.get(id);
      if (!a) { b.disabled = true; continue; }
      b.disabled = !!a.enabled && !a.enabled(app);
      b.classList.toggle('on', !!a.checked && a.checked(app));
    }
    const vp = app.viewport;
    if (vp) this.shading.value = vp.shading;
    const k = String(app.project.data.settings.grid.size);
    if (![...this.gridSize.options].some((o) => o.value === k)) this.gridSize.appendChild(h('option', { value: k }, k + ' m'));
    this.gridSize.value = k;
  }
}

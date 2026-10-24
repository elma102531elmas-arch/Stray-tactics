// The action registry: every command in the Studio (menus, toolbar, shortcuts, context menus, tests) is an action here.
// An action = { id, label, menu?, group?, order?, shortcut?, global?, enabled?(app), checked?(app), run(app, ...args) }
import * as THREE from '../../lib/three.module.js';
import { TYPES, CATEGORIES, localBox } from '../core/schema.js';
import { makeNode, ROOT_ID } from '../core/scene.js';
import * as C from '../core/commands.js';
import { validateProject, makeValidationContext } from '../core/validate.js';
import { fixCommand } from '../core/fixes.js';
import { worldColliders, nodeWorldAABB, sceneBounds } from '../core/geometry.js';
import { CollisionWorld } from '../core/collision.js';
import { confirmBox, modal, alertBox, toast } from '../ui/dialogs.js';
import { h, pickFiles } from '../ui/dom.js';
import { createRoom } from '../tools/build.js';
import { runAssetImport } from '../ui/importdialog.js';
import { shortcutsDialog, aboutDialog, docDialog } from '../ui/helpdialogs.js';
import { startDialog } from '../ui/startdialog.js';
import { PlaytestSession } from '../ui/playtest.js';

const hasSel = (a) => a.selection.length > 0;
const vp = (a) => a.viewport;

/** Where "Create" puts new objects: the work-plane point under the centre of the viewport, grid-snapped. */
export function viewCenterPoint(app) {
  const v = app.viewport;
  const r = v.canvas.getBoundingClientRect();
  let p = v.groundPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!p || p.distanceTo(v.nav.target) > 80) p = v.nav.target.clone().setY(v.workY);
  p = v.snap(p);
  p.y = v.workY;
  return p;
}

const CREATE_LIFT = { light: 2.6, audioSource: 1.2, particleEmitter: 1.0, cameraShot: 1.6, ceiling: 'ceiling', window: 1.0 };

export function createAtView(app, type, extra = {}) {
  const p = viewCenterPoint(app);
  const def = TYPES[type];
  const opts = { p: [p.x, p.y, p.z], ...extra };
  const probe = makeNode(type, { props: opts.props || {} });
  if (typeof CREATE_LIFT[type] === 'number') opts.p[1] += CREATE_LIFT[type];
  if (CREATE_LIFT[type] === 'ceiling') opts.p[1] += app.project.data.environment.ceilingHeight;
  if (def.helper && ['trigger', 'interaction', 'checkpoint', 'navBlocker', 'arena', 'audioZone', 'footstepZone'].includes(type)) opts.p[1] += (probe.props.size?.[1] || 1) / 2;
  return app.createNode(type, opts);
}

export function registerActions(app) {
  const A = (a) => app.register(a);
  const tool = (id) => () => { vp(app).setTool(id); };
  const placeTool = () => vp(app).tools.place;

  // ------------------------------------------------------------------ File
  A({ id: 'file.new', label: 'New / Import map…', menu: 'File', group: 'a', order: 1, shortcut: 'Ctrl+N', global: true, run: (a) => startDialog(a) });
  A({ id: 'file.open', label: 'Open…', menu: 'File', group: 'a', order: 2, shortcut: 'Ctrl+O', global: true, run: (a) => a.projectIO.openDialog() });
  A({ id: 'file.save', label: 'Save', menu: 'File', group: 'b', order: 1, shortcut: 'Ctrl+S', global: true, run: async (a) => { await a.projectIO.save(); toast('Saved.', 'ok'); } });
  A({ id: 'file.saveFile', label: 'Save to file (.smproj bundle)…', menu: 'File', group: 'b', order: 2, shortcut: 'Ctrl+Shift+S', global: true, run: (a) => a.projectIO.saveToFile() });
  A({ id: 'file.exportJSON', label: 'Export project JSON (no assets)', menu: 'File', group: 'b', order: 3, run: (a) => a.projectIO.exportJSON() });
  A({ id: 'file.backups', label: 'Restore backup…', menu: 'File', group: 'b', order: 4, run: (a) => a.projectIO.backupsDialog() });
  A({ id: 'file.rename', label: 'Rename project…', menu: 'File', group: 'b', order: 5, run: (a) => a.projectIO.rename() });
  A({ id: 'asset.import', label: 'Import assets…', menu: 'File', group: 'c', order: 1, shortcut: 'Ctrl+I', run: async (a) => { const files = await pickFiles({ accept: '.glb,.gltf,.obj,.mtl,.fbx,.png,.jpg,.jpeg,.webp,.ktx2,.wav,.mp3,.ogg,.json,.bin' }); if (files.length) await runAssetImport(a, files); } });
  A({ id: 'asset.importFolder', label: 'Import asset folder…', menu: 'File', group: 'c', order: 2, run: async (a) => { const files = await pickFiles({ directory: true }); if (files.length) await runAssetImport(a, files); } });

  // ------------------------------------------------------------------ Edit
  A({ id: 'edit.undo', label: 'Undo', menu: 'Edit', group: 'a', order: 1, shortcut: 'Ctrl+Z', global: false, enabled: (a) => a.history.canUndo, run: (a) => a.undo() });
  A({ id: 'edit.redo', label: 'Redo', menu: 'Edit', group: 'a', order: 2, shortcut: ['Ctrl+Shift+Z', 'Ctrl+Y'], enabled: (a) => a.history.canRedo, run: (a) => a.redo() });
  A({ id: 'edit.copy', label: 'Copy', menu: 'Edit', group: 'b', order: 1, shortcut: 'Ctrl+C', enabled: hasSel, run: (a) => a.copy() });
  A({ id: 'edit.paste', label: 'Paste', menu: 'Edit', group: 'b', order: 2, shortcut: 'Ctrl+V', enabled: (a) => !!a.clipboard, run: (a) => a.paste() });
  A({ id: 'edit.duplicate', label: 'Duplicate', menu: 'Edit', group: 'b', order: 3, shortcut: 'Ctrl+D', enabled: hasSel, run: (a) => a.duplicateSelection() });
  A({ id: 'edit.delete', label: 'Delete', menu: 'Edit', group: 'b', order: 4, shortcut: ['Delete', 'Backspace'], enabled: hasSel, run: (a) => a.deleteSelection() });
  A({ id: 'edit.selectAll', label: 'Select all', menu: 'Edit', group: 'c', order: 1, shortcut: 'Ctrl+A', run: (a) => a.selectAll() });
  A({ id: 'edit.deselect', label: 'Deselect', menu: 'Edit', group: 'c', order: 2, shortcut: 'Escape', enabled: (a) => hasSel(a) && vp(a).tool?.id === 'select', run: (a) => a.select([]) });
  A({ id: 'edit.selectParent', label: 'Select parent', menu: 'Edit', group: 'c', order: 3, enabled: hasSel, run: (a) => { const p = a.scene.parentOf(a.primary.id); if (p && p.id !== ROOT_ID) a.select([p.id]); } });
  A({ id: 'edit.group', label: 'Group selection', menu: 'Edit', group: 'd', order: 1, shortcut: 'Ctrl+G', enabled: hasSel, run: (a) => a.groupSelection() });
  A({ id: 'edit.ungroup', label: 'Ungroup', menu: 'Edit', group: 'd', order: 2, shortcut: 'Ctrl+Shift+G', enabled: (a) => a.primary?.type === 'group', run: (a) => a.ungroupSelection() });
  A({ id: 'edit.toggleVisible', label: 'Hide / show selection', menu: 'Edit', group: 'd', order: 3, shortcut: 'H', enabled: hasSel, run: (a) => { const v = !a.primary.visible; a.tx('Visibility', () => a.selection.forEach((id) => a.exec(C.setFields(id, { visible: v })))); } });
  A({ id: 'edit.toggleLock', label: 'Lock / unlock selection', menu: 'Edit', group: 'd', order: 4, shortcut: 'Ctrl+L', enabled: hasSel, run: (a) => { const v = !a.primary.locked; a.tx('Lock', () => a.selection.forEach((id) => a.exec(C.setFields(id, { locked: v })))); } });
  A({ id: 'edit.rename', label: 'Rename', menu: 'Edit', group: 'd', order: 5, shortcut: 'F2', enabled: hasSel, run: (a) => a.shell.hierarchy.startRename(a.selection.at(-1)) });
  A({ id: 'edit.snapGrid', label: 'Snap selection to grid', menu: 'Edit', group: 'e', order: 1, enabled: hasSel, run: (a) => {
    const k = a.project.data.settings.grid.size;
    const items = a.topSelection().map((id) => { const t = a.scene.get(id).t; return { id, t: { p: t.p.map((v) => Math.round(v / k) * k) } }; });
    a.exec(C.setTransforms(items, { label: 'Snap to grid' }));
  } });
  A({ id: 'edit.dropFloor', label: 'Drop selection to floor', menu: 'Edit', group: 'e', order: 2, shortcut: 'End', enabled: hasSel, run: (a) => dropToFloor(a) });
  A({ id: 'edit.savePrefab', label: 'Save selection as prefab…', menu: 'Edit', group: 'e', order: 4, enabled: hasSel, run: async (a) => {
    const { promptBox } = await import('../ui/dialogs.js');
    const name = await promptBox('Save as prefab', 'Prefab name', a.primary?.name || 'Prefab');
    if (name?.trim()) a.savePrefab(name.trim());
  } });
  A({ id: 'prefab.place', label: 'Place prefab', run: (a, id) => { const p = viewCenterPoint(a); a.placePrefab(id, [p.x, p.y, p.z]); } });
  A({ id: 'edit.resetTransform', label: 'Reset rotation & scale', menu: 'Edit', group: 'e', order: 3, enabled: hasSel, run: (a) => a.exec(C.setTransforms(a.topSelection().map((id) => ({ id, t: { r: [0, 0, 0], s: [1, 1, 1] } })), { label: 'Reset rotation/scale' })) });

  // ------------------------------------------------------------------ Create (one action per node type)
  for (const cat of CATEGORIES) {
    for (const [type, def] of Object.entries(TYPES)) {
      if (def.category !== cat || type === 'group') continue;
      A({ id: 'create.' + type, label: def.label, menu: `Create/${cat}`, run: (a) => createAtView(a, type) });
    }
  }
  A({ id: 'create.group', label: 'Empty group', menu: 'Create', group: 'a', order: 1, run: (a) => createAtView(a, 'group') });
  A({ id: 'create.room', label: 'Room (6 × 5 m, with floor, ceiling, walls)', menu: 'Create', group: 'a', order: 2, run: (a) => { const p = viewCenterPoint(a); createRoom(a, { cx: p.x, cz: p.z, y: p.y, w: 6, d: 5 }, { height: 2.8, thick: 0.2, wallMaterial: 'mat_plaster', floorMaterial: 'mat_tile', ceilingMaterial: 'mat_plaster', doorSide: 'none' }); } });

  // ------------------------------------------------------------------ View
  A({ id: 'view.frame', label: 'Frame selection', menu: 'View', group: 'a', order: 1, shortcut: 'F', run: (a) => vp(a).frameSelection() });
  A({ id: 'view.frameAll', label: 'Frame all', menu: 'View', group: 'a', order: 2, shortcut: 'Home', run: (a) => vp(a).frameAll() });
  for (const [id, label, key] of [['top', 'Top', '7'], ['front', 'Front', '1'], ['right', 'Right', '3'], ['iso', 'Perspective (isometric start)', '0']]) A({ id: 'view.' + id, label, menu: 'View/Camera', shortcut: 'Alt+' + key, run: (a) => vp(a).setView(id) });
  A({ id: 'view.ortho', label: 'Orthographic camera', menu: 'View/Camera', group: 'b', shortcut: 'Alt+O', checked: (a) => vp(a).projection === 'ortho', run: (a) => vp(a).setProjection(vp(a).projection === 'ortho' ? 'persp' : 'ortho') });
  for (const [id, label] of [['lit', 'Lit (work light)'], ['game', 'Game lighting & fog (approximate)'], ['wire', 'Wireframe'], ['normals', 'Normals']]) A({ id: 'shade.' + id, label, menu: 'View/Shading', checked: (a) => vp(a).shading === id, run: (a) => vp(a).setShading(id) });
  const overlay = (name, label, order, key) => A({ id: 'overlay.' + name, label, menu: 'View/Overlays', order, shortcut: key, checked: (a) => vp(a).overlays.on[name], run: (a) => vp(a).overlays.toggle(name) });
  overlay('collision', 'Collision boxes', 1); overlay('navmesh', 'Navigation mesh', 2); overlay('issues', 'Validation markers', 3); overlay('bounds', 'Selection bounds', 4); overlay('lights', 'Light ranges', 5);
  A({ id: 'view.helpers', label: 'Editor helpers (volumes, icons, spawns)', menu: 'View', group: 'b', order: 1, shortcut: 'Shift+H', checked: (a) => vp(a).sceneView.helpersVisible, run: (a) => { const v = vp(a).sceneView; v.setHelpersVisible(!v.helpersVisible); a.emit('view'); } });
  A({ id: 'view.grid', label: 'Grid', menu: 'View', group: 'b', order: 2, shortcut: 'Shift+G', checked: (a) => a.pref('grid', true), run: (a) => { a.setPref('grid', !a.pref('grid', true)); vp(a).grid.visible = a.pref('grid', true); vp(a).requestRender(); } });
  A({ id: 'view.shadows', label: 'Shadows', menu: 'View', group: 'b', order: 3, checked: (a) => a.pref('shadows', false), run: (a) => { a.setPref('shadows', !a.pref('shadows', false)); vp(a).applyEnvironment(); } });
  A({ id: 'view.sceneLights', label: 'Scene lights', menu: 'View', group: 'b', order: 4, checked: (a) => a.pref('sceneLights', true), run: (a) => { a.setPref('sceneLights', !a.pref('sceneLights', true)); vp(a).requestRender(); } });
  A({ id: 'view.animate', label: 'Animate (light flicker, model clips)', menu: 'View', group: 'b', order: 5, checked: (a) => vp(a).animate, run: (a) => { vp(a).animate = !vp(a).animate; vp(a).requestRender(); } });
  for (const k of [0.5, 0.75, 1, 1.5]) A({ id: 'view.scale.' + k, label: `Render scale ${Math.round(k * 100)}%`, menu: 'View/Render scale', order: k, checked: (a) => a.pref('renderScale', 1) === k, run: (a) => vp(a).setRenderScale(k) });
  A({ id: 'view.panelLeft', label: 'Hierarchy panel', menu: 'View', group: 'c', order: 1, checked: (a) => a.shell.panelVisible('left'), run: (a) => a.shell.togglePanel('left') });
  A({ id: 'view.panelRight', label: 'Inspector panel', menu: 'View', group: 'c', order: 2, checked: (a) => a.shell.panelVisible('right'), run: (a) => a.shell.togglePanel('right') });
  A({ id: 'view.panelBottom', label: 'Bottom panel', menu: 'View', group: 'c', order: 3, checked: (a) => a.shell.panelVisible('bottom'), run: (a) => a.shell.togglePanel('bottom') });

  // ------------------------------------------------------------------ Tools
  A({ id: 'tool.select', label: 'Select (no gizmo)', menu: 'Tools', group: 'a', order: 1, shortcut: 'Q', checked: (a) => vp(a).tool?.id === 'select' && vp(a).gizmo.mode === 'none', run: (a) => { vp(a).setTool('select'); vp(a).gizmo.setMode('none'); a.emit('view'); } });
  A({ id: 'tool.move', label: 'Move', menu: 'Tools', group: 'a', order: 2, shortcut: 'W', checked: (a) => vp(a).tool?.id === 'select' && vp(a).gizmo.mode === 'translate', run: (a) => { vp(a).setTool('select'); vp(a).gizmo.setMode('translate'); a.emit('view'); } });
  A({ id: 'tool.rotate', label: 'Rotate', menu: 'Tools', group: 'a', order: 3, shortcut: 'E', checked: (a) => vp(a).tool?.id === 'select' && vp(a).gizmo.mode === 'rotate', run: (a) => { vp(a).setTool('select'); vp(a).gizmo.setMode('rotate'); a.emit('view'); } });
  A({ id: 'tool.scale', label: 'Scale', menu: 'Tools', group: 'a', order: 4, shortcut: 'R', enabled: (a) => vp(a).tool?.id !== 'place', checked: (a) => vp(a).tool?.id === 'select' && vp(a).gizmo.mode === 'scale', run: (a) => { vp(a).setTool('select'); vp(a).gizmo.setMode('scale'); a.emit('view'); } });
  A({ id: 'tool.space', label: 'Local / world gizmo space', menu: 'Tools', group: 'a', order: 5, shortcut: 'X', checked: (a) => vp(a).gizmo.space === 'local', run: (a) => { vp(a).gizmo.setSpace(vp(a).gizmo.space === 'world' ? 'local' : 'world'); a.emit('view'); } });
  A({ id: 'tool.snap', label: 'Grid snapping', menu: 'Tools', group: 'b', order: 1, shortcut: 'G', checked: (a) => a.project.data.settings.grid.snap, run: (a) => setSetting(a, ['grid', 'snap'], !a.project.data.settings.grid.snap) });
  A({ id: 'tool.rotSnap', label: 'Rotation snapping', menu: 'Tools', group: 'b', order: 2, checked: (a) => a.project.data.settings.rotSnapOn, run: (a) => setSetting(a, ['rotSnapOn'], !a.project.data.settings.rotSnapOn) });
  A({ id: 'tool.surfaceSnap', label: 'Place on surfaces', menu: 'Tools', group: 'b', order: 3, checked: (a) => a.project.data.settings.surfaceSnap, run: (a) => setSetting(a, ['surfaceSnap'], !a.project.data.settings.surfaceSnap) });
  A({ id: 'tool.wall', label: 'Draw walls', menu: 'Tools', group: 'c', order: 1, shortcut: 'B', checked: (a) => vp(a).tool?.id === 'wall', run: tool('wall') });
  A({ id: 'tool.room', label: 'Draw room', menu: 'Tools', group: 'c', order: 2, shortcut: 'N', checked: (a) => vp(a).tool?.id === 'room', run: tool('room') });
  A({ id: 'tool.corridor', label: 'Draw corridor', menu: 'Tools', group: 'c', order: 3, shortcut: 'M', checked: (a) => vp(a).tool?.id === 'corridor', run: tool('corridor') });
  A({ id: 'tool.measure', label: 'Measure', menu: 'Tools', group: 'c', order: 4, shortcut: 'T', checked: (a) => vp(a).tool?.id === 'measure', run: tool('measure') });
  A({ id: 'tool.workplane', label: 'Set work plane height from selection', menu: 'Tools', group: 'd', order: 1, enabled: hasSel, run: (a) => { const b = nodeWorldAABB(a.scene, a.primary.id, a.project.geoCtx); vp(a).workY = Math.round(b.max.y * 100) / 100; vp(a).grid.position.y = vp(a).workY; vp(a).requestRender(); a.log('info', `Work plane height = ${vp(a).workY} m`); a.emit('view'); } });
  A({ id: 'tool.workplane0', label: 'Reset work plane to ground', menu: 'Tools', group: 'd', order: 2, run: (a) => { vp(a).workY = 0; vp(a).grid.position.y = 0; vp(a).requestRender(); a.emit('view'); } });
  A({ id: 'place.rotate', label: 'Rotate placement 90°', shortcut: 'R', enabled: (a) => vp(a).tool?.id === 'place', run: (a) => placeTool().rotate(90) });
  A({ id: 'tool.cancel', label: 'Cancel tool', shortcut: 'Escape', enabled: (a) => vp(a).tool?.id !== 'select', run: (a) => { const t = vp(a).tool; if (t.cancel && (t.pts?.length || t.a)) { t.cancel(); return; } vp(a).setTool('select'); } });
  A({ id: 'asset.place', label: 'Place asset', run: (a, id) => {
    const meta = a.assets.meta(id);
    if (!meta) { a.toast('That asset no longer exists.', 'error'); return; }
    if (meta.kind !== 'model') { a.toast('Only models can be placed in the scene. Textures are applied from the Material editor, sounds from Audio sources.', 'info'); return; }
    placeTool().setSpec({ kind: 'asset', type: 'model', assetId: id, label: meta.name });
    vp(a).setTool('place');
  } });
  A({ id: 'place.type', label: 'Place node type', run: (a, type, props = {}, extra = {}) => { placeTool().setSpec({ kind: 'type', type, props, label: TYPES[type].label, ...extra }); vp(a).setTool('place'); } });

  // ------------------------------------------------------------------ Project
  A({ id: 'project.validate', label: 'Validate map', menu: 'Project', group: 'a', order: 1, shortcut: 'F7', run: (a) => runValidation(a) });
  A({ id: 'project.fixAll', label: 'Apply all safe auto-fixes', menu: 'Project', group: 'a', order: 2, enabled: (a) => (a.issues || []).some((i) => i.fix), run: (a) => fixAll(a) });
  A({ id: 'project.fixIssue', label: 'Fix issue', run: (a, issue) => {
    try { const cmd = fixCommand(a.project, issue.fix); a.exec(cmd); a.log('ok', `Applied fix: ${issue.message}`); runValidation(a, { quiet: true }); } catch (e) { a.toast(e.message, 'error'); a.log('error', 'Fix failed: ' + e.message); }
  } });
  A({ id: 'project.nav', label: 'Build navigation mesh', menu: 'Project', group: 'a', order: 3, run: (a) => { const info = vp(a).overlays.buildNav(); a.log('ok', `Navmesh: ${info.nodes} cells, ${info.components} island(s), ${info.reachable} reachable from player spawns (${info.ms} ms)`); vp(a).overlays.set('navmesh', true); } });

  // ------------------------------------------------------------------ Playtest
  A({ id: 'playtest.start', label: 'Playtest from the player spawn', menu: 'Project', group: 'p', order: 1, shortcut: 'Ctrl+P', global: true, enabled: (a) => !a.playtest, run: (a) => {
    const sel = a.primary?.type === 'playerSpawn' ? a.primary.id : null;
    new PlaytestSession(a, { spawn: sel }).start();
  } });
  A({ id: 'playtest.fromHere', label: 'Playtest from the editor camera', menu: 'Project', group: 'p', order: 2, shortcut: 'Ctrl+Shift+P', global: true, enabled: (a) => !a.playtest, run: (a) => {
    const v = a.viewport, t = v.nav.target, ground = v.groundPoint(v.canvas.getBoundingClientRect().left + v.width / 2, v.canvas.getBoundingClientRect().top + v.height / 2, 0) || t;
    const yaw = (v.nav.yaw * 180) / Math.PI + 180;
    new PlaytestSession(a, { from: { x: ground.x, y: 0, z: ground.z, yaw } }).start();
  } });
  A({ id: 'playtest.stop', label: 'Stop playtest', menu: 'Project', group: 'p', order: 3, enabled: (a) => !!a.playtest, run: (a) => a.playtest?.stop() });

  // ------------------------------------------------------------------ Help
  A({ id: 'plugins.open', label: 'Open the Plugins tab…', menu: 'Plugins', group: '0', order: 0, run: (a) => a.emit('goto', { workspace: 'plugins' }) });
  A({ id: 'help.plugins', label: 'Plugin & script security', menu: 'Help', group: 'a', order: 5, run: (a) => docDialog(a, 'Plugin & script security', 'docs/PLUGINS.md') });
  A({ id: 'help.shortcuts', label: 'Keyboard shortcuts', menu: 'Help', group: 'a', order: 1, shortcut: 'F1', run: (a) => shortcutsDialog(a) });
  A({ id: 'help.limits', label: 'Known limitations', menu: 'Help', group: 'a', order: 2, run: (a) => docDialog(a, 'Known limitations', 'docs/KNOWN_LIMITATIONS.md') });
  A({ id: 'help.compat', label: 'Compatibility report', menu: 'Help', group: 'a', order: 3, run: (a) => docDialog(a, 'Compatibility report', 'docs/COMPATIBILITY.md') });
  A({ id: 'help.arch', label: 'Architecture notes', menu: 'Help', group: 'a', order: 4, run: (a) => docDialog(a, 'Architecture', 'docs/ARCHITECTURE.md') });
  A({ id: 'help.about', label: 'About Saint Marrow Studio', menu: 'Help', group: 'b', order: 1, run: (a) => aboutDialog(a) });
  app.emit('actions');
}

function setSetting(app, path, value) {
  app.exec(C.setData(['settings', ...path], value, { label: 'Change setting' }));
  app.viewport.gizmo.applySnap();
  app.emit('view');
}

export function runValidation(app, { quiet = false } = {}) {
  const t0 = performance.now();
  const res = validateProject(app.project);
  app.issues = res.issues;
  app.validatedOnce = true;
  app.emit('issues');
  app.viewport?.overlays.setIssues(res.issues);
  const ms = Math.round(performance.now() - t0);
  // running plugins may add their own checks (asynchronously, in their sandbox); they are merged in when they answer
  if (app.plugins?.running.size) app.plugins.validate().then((extra) => { if (!extra.length) return; app.issues = [...app.issues.filter((i) => i.source !== 'plugin'), ...extra]; app.emit('issues'); app.viewport?.overlays.setIssues(app.issues); });
  if (!quiet) app.log(res.counts.error ? 'warn' : 'ok', `Validation: ${res.counts.error} errors, ${res.counts.warn} warnings, ${res.counts.info} notes (${ms} ms)`);
  return res;
}

async function fixAll(app) {
  const fixable = (app.issues || []).filter((i) => i.fix);
  if (!fixable.length) return;
  const ok = await confirmBox('Apply auto-fixes', `Apply ${fixable.length} automatic fix(es)? Each change is undoable as a single step.\n\nFixes move or resize objects; review the Issues list afterwards.`, { ok: 'Apply fixes' });
  if (!ok) return;
  let done = 0, failed = 0;
  app.tx(`Apply ${fixable.length} auto-fixes`, () => {
    for (const i of fixable) { try { app.exec(fixCommand(app.project, i.fix)); done++; } catch (e) { failed++; app.log('warn', `Skipped a fix: ${e.message}`); } }
  });
  app.log('ok', `Applied ${done} fix(es)${failed ? `, ${failed} skipped` : ''}`);
  runValidation(app);
}

/** Lowers selection so its bounding box rests on the highest walkable surface beneath it. */
function dropToFloor(app) {
  const ids = app.topSelection();
  const ctx = app.project.geoCtx;
  const exclude = new Set();
  for (const id of ids) { exclude.add(id); app.scene.descendants(id).forEach((d) => exclude.add(d.id)); }
  const cols = worldColliders(app.scene, ctx).filter((c) => !exclude.has(c.nodeId));
  const world = new CollisionWorld(cols);
  const items = [];
  for (const id of ids) {
    const box = nodeWorldAABB(app.scene, id, ctx);
    const origin = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + 0.02, (box.min.z + box.max.z) / 2);
    const hit = world.raycast(origin, new THREE.Vector3(0, -1, 0), 200, { kinds: new Set(['solid', 'ground', 'terrain']), doors: false });
    if (!hit) continue;
    const dy = hit.point.y - box.min.y;
    if (Math.abs(dy) < 1e-4) continue;
    const t = app.scene.get(id).t;
    items.push({ id, t: { p: [t.p[0], t.p[1] + dy, t.p[2]] } });
  }
  if (!items.length) { app.toast('Nothing to drop onto — no surface found beneath the selection.', 'warn'); return; }
  app.exec(C.setTransforms(items, { label: 'Drop to floor' }));
}

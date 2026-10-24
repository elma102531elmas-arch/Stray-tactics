// "New / Import map" dialog: create a blank map from a tool-built template, or import an existing map.
// Imports ALWAYS create a new project, so nothing existing is overwritten, and every import ends with an honest report.
import { h } from './dom.js';
import { modal, confirmBox, toast } from './dialogs.js';
import { Project, defaultEnvironment } from '../core/project.js';
import { importChapterDef, importIntoProject, loadGameModules } from '../core/importers/sm-chapter.js';
import { createRoom } from '../tools/build.js';
import { runAssetImport } from './importdialog.js';
import { pickFiles } from './dom.js';
import { makeNode } from '../core/scene.js';

const ENV_PRESETS = {
  indoor: { label: 'Indoor — dark and foggy', apply: (e) => e },
  outdoor: { label: 'Outdoor — night, moonlight', apply: (e) => ({ ...e, outdoor: true, fog: { color: '#0a0e14', density: 0.02 }, moon: { ...e.moon, enabled: true, intensity: 0.7 }, ceilingHeight: 6 }) },
  neutral: { label: 'Neutral — bright, no fog', apply: (e) => ({ ...e, fog: { color: '#20242b', density: 0 }, ambient: { ...e.ambient, intensity: 1.4 }, clearColor: '#20242b' }) },
};
const TEMPLATES = {
  blank: 'Blank map (empty)',
  room: 'Test room — one room with a player spawn and a light (for trying tools)',
  ground: 'Open ground — flat terrain patch',
};

export async function startDialog(app) {
  const name = h('input', { type: 'text', value: 'New map', 'aria-label': 'Map name', style: { width: '100%' } });
  const tpl = h('select', { 'aria-label': 'Template' }, Object.entries(TEMPLATES).map(([k, v]) => h('option', { value: k }, v)));
  const env = h('select', { 'aria-label': 'Environment' }, Object.entries(ENV_PRESETS).map(([k, v]) => h('option', { value: k }, v.label)));
  const mk = (id, title, desc) => h('label', { style: { display: 'block', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: '6px', marginBottom: '6px', cursor: 'pointer' } },
    h('input', { type: 'radio', name: 'mode', value: id, 'aria-label': title, style: { marginRight: '8px' } }), h('b', {}, title), h('div', { style: { color: 'var(--dim)', fontSize: '12px', marginLeft: '24px' } }, desc));
  const body = h('div', {},
    h('div', { class: 'sec-h', style: { cursor: 'default', marginBottom: '8px' } }, 'Create new map'),
    h('div', { class: 'field' }, h('label', {}, 'Name'), name), h('div', { class: 'field' }, h('label', {}, 'Template'), tpl), h('div', { class: 'field' }, h('label', {}, 'Environment'), env),
    h('div', { class: 'sec-h', style: { cursor: 'default', margin: '16px 0 8px' } }, 'Import existing map'),
    mk('chapter', 'Original Saint Marrow chapter', 'Reads the game’s own map data (read-only) and rebuilds it as editable objects at the same scale and coordinates. Produces a report of anything that cannot be imported.'),
    mk('project', 'Studio project or bundle (.smproj / .json)', 'Opens a project saved by Studio.'),
    mk('scene', '3D scene file (.glb .gltf .obj .fbx)', 'Imports one model file as static scenery. Collision is NOT generated automatically.'));
  const res = await modal({ title: 'New / Import map', body, width: 640, buttons: [{ label: 'Cancel', value: undefined }, { label: 'Continue', value: () => {
    const mode = body.querySelector('input[name=mode]:checked')?.value;
    return mode ? { mode } : { mode: 'new', name: name.value.trim() || 'New map', tpl: tpl.value, env: env.value };
  }, primary: true }] });
  if (!res) return;
  if (!(await app.projectIO.confirmDiscard())) return;
  if (res.mode === 'new') return createNew(app, res);
  if (res.mode === 'chapter') return importChapter(app);
  if (res.mode === 'project') { const f = (await pickFiles({ accept: '.smproj,.json,.zip', multiple: false }))[0]; if (f) await app.projectIO.openFile(f.file); return; }
  if (res.mode === 'scene') return importScene(app);
}

export function createNew(app, { name, tpl = 'blank', env = 'indoor' }) {
  const project = new Project(name);
  project.data.environment = ENV_PRESETS[env].apply(defaultEnvironment());
  app.setProject(project);
  if (tpl === 'room') {
    app.tx('Create test room', () => {
      createRoom(app, { cx: 0, cz: 0, y: 0, w: 8, d: 6 }, { height: 2.8, thick: 0.2, wallMaterial: 'mat_plaster', floorMaterial: 'mat_tile', ceilingMaterial: 'mat_plaster', doorSide: 'S' });
      app.createNode('playerSpawn', { name: 'Player spawn', p: [0, 0, 1.5] }, { select: false });
      app.createNode('light', { name: 'Ceiling light', p: [0, 2.6, 0], props: { intensity: 25, range: 9 } }, { select: false });
    });
  } else if (tpl === 'ground') {
    app.createNode('terrain', { name: 'Ground', props: { size: 64, cells: 32 } }, { select: false });
    app.createNode('playerSpawn', { name: 'Player spawn', p: [0, 0, 0] }, { select: false });
  }
  app.select([]);
  app.history.clear();
  app.history.revision = 1; // new maps start "unsaved"
  app.emit('history');
  app.viewport.frameAll();
  app.log('info', `Created new map “${name}” (${TEMPLATES[tpl].split(' — ')[0]}, ${ENV_PRESETS[env].label})`);
}

export async function importChapter(app) {
  const base = new URL('../saint-marrow', app.baseUrl).href;
  let mods;
  try { mods = await loadGameModules(base); } catch (e) { app.log('error', e.message); await modal({ title: 'Cannot read the game', body: h('div', { class: 'note err', style: { margin: 0 } }, e.message) }); return; }
  const list = h('div', {}, mods.CHAPTERS.map((c) => h('label', { style: { display: 'flex', gap: '10px', padding: '6px 4px', cursor: 'pointer', alignItems: 'center' } },
    h('input', { type: 'radio', name: 'chapter', value: String(c.id), 'aria-label': `Chapter ${c.id}` }), h('b', {}, `Chapter ${c.id}`), h('span', { style: { color: 'var(--dim)' } }, `${c.key} · ${c.map.length ? c.map[0].length : '?'}×${c.map.length} cells · themes: ${(c.themes || []).join(', ')}`))));
  const pick = await modal({ title: 'Import original chapter', body: h('div', {}, h('div', { class: 'note', style: { margin: '0 0 8px' } }, 'The playable game is not modified. Its map data is read and converted into a NEW Studio project.'), list), width: 640, buttons: [{ label: 'Cancel', value: undefined }, { label: 'Import', value: () => list.querySelector('input:checked')?.value || null, primary: true }] });
  if (!pick) return;
  const def = mods.CHAPTERS.find((c) => String(c.id) === pick);
  let result;
  try { result = importChapterDef(def, mods); } catch (e) { app.log('error', 'Chapter import failed: ' + e.message); await modal({ title: 'Import failed', body: h('div', { class: 'note err', style: { margin: 0 } }, e.message) }); console.error(e); return; }
  const project = new Project(`Chapter ${def.id} (imported)`);
  app.setProject(project);
  importIntoProject(project, app.history, result);
  app.history.revision = Math.max(app.history.revision, 1);
  app.emit('history');
  app.viewport.frameAll();
  app.log('ok', `Imported chapter ${def.id}: ${result.entries.length} objects`);
  await importReportDialog(app, result.report);
}

export function importReportDialog(app, report) {
  const counts = Object.entries(report.counts).sort((a, b) => b[1] - a[1]);
  const body = h('div', {},
    h('div', { class: 'note', style: { margin: '0 0 10px' } }, `Chapter ${report.chapter} was rebuilt at the game’s own scale (1 cell = 1 m). Items below were NOT reproduced exactly — nothing was invented to fill the gap.`),
    h('div', { class: 'sec-h', style: { cursor: 'default' } }, 'Imported'),
    h('div', { class: 'kv', style: { margin: '6px 0 12px' } }, counts.flatMap(([k, v]) => [h('span', {}, k), h('span', { 'data-count': k }, String(v))])),
    h('div', { class: 'sec-h', style: { cursor: 'default' } }, `Not importable (${report.unimportable.length})`),
    report.unimportable.length ? h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['What', 'Count', 'Why / what happened instead'].map((t) => h('th', {}, t)))), h('tbody', {}, report.unimportable.map((u) => h('tr', {}, h('td', {}, u.what), h('td', {}, String(u.count)), h('td', {}, u.reason))))) : h('div', { class: 'empty' }, 'Everything in this chapter was imported.'),
    report.proxies?.length ? h('div', {}, h('div', { class: 'sec-h', style: { cursor: 'default', marginTop: '12px' } }, `Stand-ins tagged "proxy" (${report.proxies.length})`), h('div', { style: { color: 'var(--dim)', padding: '6px 0' } }, 'Procedural props and trees are drawn by code in the game. They are imported as simple blocks of the same footprint so collision and layout match; replace them with real models when you have them.')) : null,
    h('div', { class: 'sec-h', style: { cursor: 'default', marginTop: '12px' } }, 'Notes'),
    h('ul', { style: { paddingLeft: '20px', margin: '6px 0' } }, report.notes.map((n) => h('li', {}, n))));
  return modal({ title: `Import report — chapter ${report.chapter}`, body, width: 760 });
}

async function importScene(app) {
  const files = await pickFiles({ accept: '.glb,.gltf,.obj,.mtl,.fbx,.bin,.png,.jpg,.jpeg,.webp' });
  if (!files.length) return;
  const stemName = files.find((f) => /\.(glb|gltf|obj|fbx)$/i.test(f.path))?.path.split('/').pop().replace(/\.[^.]+$/, '') || 'Imported scene';
  const project = new Project(stemName);
  app.setProject(project);
  const res = await runAssetImport(app, files);
  const id = res?.added.map((a) => app.assets.meta(a)).find((m) => m?.kind === 'model')?.id;
  if (!id) { toast('No model was imported, so the new map is empty.', 'warn'); return; }
  app.createNode('model', { name: stemName, props: { asset: id, collision: 'none' } });
  app.viewport.frameAll();
  app.log('warn', `“${stemName}” was imported as static scenery with NO collision. Add floor/wall/box colliders (or switch the model to auto-box) before testing movement.`);
}

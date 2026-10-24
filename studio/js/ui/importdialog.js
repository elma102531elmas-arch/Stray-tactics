// Asset import flow: confirm licence/source -> import with progress -> readable report.
import { h } from './dom.js';
import { modal } from './dialogs.js';
import { classifyForDisplay } from '../assets/classify.js';
import { formatBytes } from '../core/util.js';

export async function runAssetImport(app, files, { skipConfirm = false, license = '', source = 'user import' } = {}) {
  if (!files.length) return null;
  if (!skipConfirm) {
    const groups = classifyForDisplay(files);
    const lic = h('input', { type: 'text', 'aria-label': 'Licence', placeholder: 'e.g. CC0 1.0, CC-BY 4.0 (author, URL), own work, commercial licence…', value: license, style: { width: '100%', padding: '5px 8px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '4px' } });
    const src = h('input', { type: 'text', 'aria-label': 'Source', placeholder: 'Where did these files come from? (URL, author, shop)', value: source === 'user import' ? '' : source, style: { width: '100%', padding: '5px 8px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '4px', marginTop: '6px' } });
    const ok = h('input', { type: 'checkbox', 'aria-label': 'I have the right to use these files', id: 'imp-ok' });
    const total = files.reduce((n, f) => n + f.file.size, 0);
    const body = h('div', {},
      h('div', { style: { marginBottom: '8px' } }, `${files.length} file(s), ${formatBytes(total)}`),
      h('div', { class: 'kv', style: { marginBottom: '10px' } }, Object.entries(groups).flatMap(([k, v]) => [h('span', {}, k), h('span', {}, v.slice(0, 4).join(', ') + (v.length > 4 ? ` … +${v.length - 4}` : ''))])),
      h('div', { style: { color: 'var(--dim)', marginBottom: '4px' } }, 'Licence (stored with each asset)'), lic, src,
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' } }, ok, 'I have the right to use these files in this project.'),
      h('div', { class: 'note', style: { margin: '10px 0 0' } }, 'Files are read and validated in your browser. Nothing is executed or uploaded; model files are only parsed as data.'));
    const go = await modal({ title: 'Import assets', body, width: 600, buttons: [{ label: 'Cancel', value: false }, { label: 'Import', value: () => (ok.checked ? { license: lic.value.trim(), source: src.value.trim() || 'user import' } : (ok.focus(), null)), primary: true }] });
    if (!go) return null;
    license = go.license; source = go.source;
  }
  const bar = h('div', { style: { height: '8px', background: 'var(--bg)', borderRadius: '4px', overflow: 'hidden' } }, h('div', { id: 'imp-bar', style: { height: '100%', width: '0%', background: 'var(--accent)' } }));
  const label = h('div', { style: { marginTop: '6px', color: 'var(--dim)' } }, 'Starting…');
  let closeProg;
  modal({ title: 'Importing…', body: h('div', {}, bar, label), buttons: [], dismissable: false, onMount: (_, c) => { closeProg = c; } });
  let res;
  try {
    res = await app.importer.importFiles(files, { license, source, onProgress: (f, name) => { bar.firstChild.style.width = Math.round(f * 100) + '%'; label.textContent = name; } });
  } catch (e) {
    closeProg(); app.log('error', 'Import failed: ' + e.message);
    await modal({ title: 'Import failed', body: h('div', { class: 'note err', style: { margin: 0 } }, e.message) });
    return null;
  }
  closeProg();
  app.emit('assets');
  for (const e of res.errors) app.log('error', e.message);
  for (const w of res.warnings) app.log('warn', w.message);
  app.log(res.added.length ? 'ok' : 'warn', `Imported ${res.added.length} asset(s)${res.errors.length ? `, ${res.errors.length} error(s)` : ''}`);
  await importReportDialog(app, res);
  return res;
}

export function importReportDialog(app, res) {
  const list = (items, cls) => items.length ? h('div', { style: { margin: '6px 0' } }, items.map((i) => h('div', { class: 'note ' + cls, style: { margin: '0 0 4px' } }, i.message || i))) : null;
  const added = res.added.map((id) => app.assets.meta(id)).filter(Boolean);
  const body = h('div', {},
    h('div', { class: 'kv', style: { marginBottom: '8px' } }, h('span', {}, 'Imported'), h('b', { 'data-testid': 'imp-added' }, String(res.added.length)), h('span', {}, 'Skipped (duplicates)'), h('span', {}, String(res.skipped.length)), h('span', {}, 'Warnings'), h('span', {}, String(res.warnings.length)), h('span', {}, 'Errors'), h('span', {}, String(res.errors.length))),
    added.length ? h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Name', 'Kind', 'Details'].map((t) => h('th', {}, t)))), h('tbody', {}, added.map((m) => h('tr', {}, h('td', {}, m.name), h('td', {}, m.kind), h('td', {}, m.kind === 'model' ? `${m.triangles.toLocaleString()} tris · ${m.animations?.length || 0} clip(s)` : m.kind === 'image' ? `${m.width}×${m.height}` : m.kind === 'audio' ? `${m.duration}s ${m.channels}ch ${m.sampleRate} Hz` : m.format))))) : null,
    list(res.errors, 'err'), list(res.warnings, 'warn'));
  return modal({ title: res.errors.length && !res.added.length ? 'Nothing could be imported' : 'Import report', body, width: 680 });
}

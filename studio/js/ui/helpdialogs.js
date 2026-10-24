import { h } from './dom.js';
import { modal } from './dialogs.js';
import { STUDIO_VERSION, FORMAT_VERSION } from '../core/project.js';

export function shortcutsDialog(app) {
  const rows = [...app.actions.values()].filter((a) => a.shortcut).map((a) => [a.menu?.split('/')[0] || '', a.label, [].concat(a.shortcut).join(' / ')]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  rows.push(['View', 'Orbit', 'MMB drag  ·  Alt + LMB drag'], ['View', 'Pan', 'Shift + MMB drag'], ['View', 'Zoom', 'Mouse wheel (toward cursor)'], ['View', 'Fly', 'Hold RMB, then W A S D, Q / E (Shift = fast, wheel = speed)'], ['Selection', 'Add to selection', 'Shift / Ctrl + click'], ['Selection', 'Marquee', 'Drag on empty space'], ['Gizmo', 'Invert snapping', 'Hold Ctrl while dragging']);
  return modal({ title: 'Keyboard & mouse', width: 640, body: h('table', { class: 't' }, h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { style: { color: 'var(--faint)' } }, r[0]), h('td', {}, r[1]), h('td', {}, h('code', {}, r[2])))))) });
}

export function aboutDialog(app) {
  return modal({ title: 'About Saint Marrow Studio', body: h('div', {},
    h('p', {}, `Saint Marrow Studio ${STUDIO_VERSION} (project format v${FORMAT_VERSION}).`),
    h('p', {}, 'A separate developer environment for building and testing maps, assets, cutscenes, audio and AI for Saint Marrow. It never modifies the playable game; it reads the game’s source and assets read-only.'),
    h('p', { style: { color: 'var(--dim)' } }, 'Built-in props and textures are CC0 (Poly Haven), reused from the game’s assets folder. Libraries: three.js (MIT), fflate (MIT), acorn (MIT), meshoptimizer (MIT), Draco (Apache-2.0), Basis Universal (Apache-2.0).')) });
}

/** Tiny Markdown renderer (headings, lists, tables as text, code blocks, bold/inline code) — enough for our own docs. */
export function renderMarkdown(src) {
  const out = h('div', { class: 'md', style: { lineHeight: 1.5 } });
  let code = null, list = null;
  const inline = (t) => {
    const frag = document.createDocumentFragment();
    t.split(/(`[^`]+`|\*\*[^*]+\*\*)/).forEach((part) => {
      if (part.startsWith('`')) frag.appendChild(h('code', {}, part.slice(1, -1)));
      else if (part.startsWith('**')) frag.appendChild(h('b', {}, part.slice(2, -2)));
      else frag.appendChild(document.createTextNode(part));
    });
    return frag;
  };
  for (const line of src.split('\n')) {
    if (line.startsWith('```')) { if (code) { out.appendChild(code); code = null; } else { code = h('pre', { style: { background: 'var(--bg)', padding: '8px', borderRadius: '4px', overflow: 'auto', font: 'var(--mono)' } }); } list = null; continue; }
    if (code) { code.appendChild(document.createTextNode(line + '\n')); continue; }
    const m = /^(#{1,4})\s+(.*)/.exec(line);
    if (m) { out.appendChild(h('h' + (m[1].length + 1), { style: { margin: '14px 0 6px' } }, inline(m[2]))); list = null; continue; }
    if (/^\s*[-*]\s+/.test(line)) { if (!list) { list = h('ul', { style: { margin: '4px 0', paddingLeft: '22px' } }); out.appendChild(list); } list.appendChild(h('li', {}, inline(line.replace(/^\s*[-*]\s+/, '')))); continue; }
    list = null;
    if (line.startsWith('|')) { out.appendChild(h('div', { style: { font: 'var(--mono)', whiteSpace: 'pre', overflow: 'auto' } }, line)); continue; }
    if (line.trim()) out.appendChild(h('p', { style: { margin: '6px 0' } }, inline(line)));
  }
  return out;
}

export async function docDialog(app, title, path) {
  let body;
  try {
    const r = await fetch(new URL(path, app.baseUrl));
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    body = renderMarkdown(await r.text());
  } catch (e) { body = h('div', { class: 'note err' }, `Could not load ${path}: ${e.message}`); }
  return modal({ title, body, width: 820 });
}

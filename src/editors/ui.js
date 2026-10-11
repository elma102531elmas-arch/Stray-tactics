// Small UI kit shared by the editors.
import { el, copyText, downloadText, pickFile, readFileText } from '../core/util.js';
import { materials } from '../gfx/materials.js';
import { texGen } from '../gfx/texgen.js';

export function toast(msg, ms = 1600) {
  const t = el('div', { class: 'toast' }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function num(value, onChange, step = 0.1, opts = {}) {
  const i = el('input', { type: 'number', step, value: +(+value).toFixed(opts.dec ?? 3) });
  if (opts.min !== undefined) i.min = opts.min;
  if (opts.max !== undefined) i.max = opts.max;
  i.addEventListener('change', () => onChange(parseFloat(i.value) || 0));
  i.addEventListener('keydown', (e) => e.stopPropagation());
  return i;
}
export function vec3(arr, onChange, step = 0.1) {
  const w = el('div', { class: 'v3' });
  arr.forEach((v, k) => w.appendChild(num(v, (nv) => { const a = arr.slice(); a[k] = nv; onChange(a); }, step)));
  return w;
}
export function prop(label, ctrl) { return el('div', { class: 'prop' }, el('span', {}, label), ctrl); }
export function select(options, value, onChange) {
  const s = el('select', {}, ...options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return el('option', { value: v }, l); }));
  s.value = value; s.addEventListener('change', () => onChange(s.value)); s.addEventListener('keydown', (e) => e.stopPropagation());
  return s;
}
export function color(value, onChange) { const c = el('input', { type: 'color', value }); c.addEventListener('input', () => onChange(c.value)); return c; }
export function range(min, max, step, value, onChange) {
  const r = el('input', { type: 'range', min, max, step, value });
  const out = el('span', { style: { minWidth: '36px', textAlign: 'right', color: 'var(--accent)' } }, (+value).toFixed(step < 1 ? 2 : 0));
  r.addEventListener('input', () => { out.textContent = (+r.value).toFixed(step < 1 ? 2 : 0); onChange(+r.value); });
  return el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, r, out);
}
export function text(value, onChange) { const i = el('input', { type: 'text', value }); i.addEventListener('change', () => onChange(i.value)); i.addEventListener('keydown', (e) => e.stopPropagation()); return i; }

// material thumbnails (rendered from the generated GPU textures)
const thumbs = new Map();
export async function matThumb(id) {
  const key = id + (materials.isCustom(id) ? JSON.stringify(materials.recipe(id)).length : '');
  if (thumbs.has(key)) return thumbs.get(key);
  const t = await materials.textures(id, 128);
  const src = texGen().toCanvas(t.rts[0]);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  c.getContext('2d').drawImage(src, 0, 0, 64, 64);
  const url = c.toDataURL();
  thumbs.set(key, url);
  return url;
}
export function clearThumb() { thumbs.clear(); }

export function palette(ids, current, onPick) {
  const w = el('div', { class: 'palette' });
  for (const id of ids) {
    const img = el('img', { alt: '' });
    matThumb(id).then((u) => { img.src = u; });
    const b = el('button', { class: id === current ? 'on' : '', title: materials.recipe(id).name || id, onclick: () => { [...w.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); onPick(id); } }, img, (materials.recipe(id).name || id).slice(0, 14));
    w.appendChild(b);
  }
  return w;
}

// JSON export / import dialog
export function jsonDialog(title, obj, filename, onImport) {
  const json = JSON.stringify(obj, null, 1);
  const ta = el('textarea', { class: 'json' }); ta.value = json;
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  const box = el('div', { class: 'modal show' }, el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, title), el('button', { class: 'x', onclick: () => box.remove() }, '✕')),
    el('p', { class: 'hint' }, 'Copy or download this JSON and send it. To import, paste JSON here (or load a file) and press IMPORT.'),
    ta,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn sm primary', onclick: async (e) => { const ok = await copyText(ta.value); e.currentTarget.textContent = ok ? 'COPIED!' : 'COPY FAILED'; } }, 'COPY'),
      el('button', { class: 'btn sm', onclick: () => downloadText(filename, ta.value) }, 'DOWNLOAD'),
      onImport ? el('button', { class: 'btn sm', onclick: async () => { const f = await pickFile('.json,application/json'); if (f) ta.value = await readFileText(f); } }, 'LOAD FILE') : '',
      onImport ? el('button', { class: 'btn sm', onclick: () => { try { onImport(JSON.parse(ta.value)); box.remove(); } catch (err) { toast('Invalid JSON: ' + err.message, 3000); } } }, 'IMPORT') : '')));
  document.getElementById('ui').appendChild(box);
  return box;
}

export function confirmBox(msg) { return window.confirm(msg); }

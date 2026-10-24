// Reusable property widgets. Every widget returns { el, set(value), get() } and reports edits through onChange(value, {live}).
// `live` is true while the user is dragging/typing (callers use it to coalesce undo steps).
import { h } from './dom.js';

const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v);

function row(label, ctl, { hint, unit, className = '' } = {}) {
  const lab = h('label', { title: label }, label);
  const wrap = h('div', { class: 'ctl' }, ctl, unit ? h('span', { class: 'unit' }, unit) : null);
  const el = h('div', { class: 'field ' + className }, lab, wrap, hint ? h('div', { class: 'hint' }, hint) : null);
  return { el, lab, wrap };
}

/** Drag the label sideways to scrub a numeric input (Shift = coarse, Alt = fine).
 *  Listeners live on window so the drag keeps working when the panel re-renders (and removes this label) after each live edit. */
function scrub(lab, input, step, apply) {
  lab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || input.disabled) return;
    const sx = e.clientX, start = parseFloat(input.value) || 0; let moved = false;
    e.preventDefault();
    const move = (ev) => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = r4(start + Math.round((ev.clientX - sx) / 3) * step * mult);
      moved = true; input.value = v; apply(v, true);
    };
    const end = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      if (moved) apply(parseFloat(input.value), false);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  });
}

export function numberField(label, { value = 0, step = 0.05, min, max, unit, int = false, hint, onChange }) {
  const input = h('input', { type: 'number', step: int ? 1 : 'any', 'aria-label': label });
  if (min !== undefined) input.min = min; if (max !== undefined) input.max = max;
  const { el, lab } = row(label, input, { unit, hint });
  const err = h('div', { class: 'err' });
  const commit = (v, live) => {
    if (!Number.isFinite(v)) { input.classList.add('invalid'); return; }
    input.classList.remove('invalid');
    onChange?.(int ? Math.round(v) : v, { live });
  };
  input.addEventListener('change', () => commit(input.valueAsNumber, false));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); });
  scrub(lab, input, int ? 1 : step, commit);
  const api = { el, input, set(v) { if (document.activeElement !== input) input.value = v === null || v === undefined ? '' : r4(v); }, get: () => input.valueAsNumber, setError(msg) { err.textContent = msg || ''; input.classList.toggle('invalid', !!msg); if (msg && !err.isConnected) el.appendChild(err); } };
  api.set(value);
  return api;
}

export function vec3Field(label, { value = [0, 0, 0], step = 0.05, unit, min, hint, onChange }) {
  const cur = [...value];
  const inputs = ['x', 'y', 'z'].map((ax, i) => {
    const input = h('input', { type: 'number', step: 'any', class: 'ax-' + ax, 'aria-label': `${label} ${ax.toUpperCase()}`, title: ax.toUpperCase() });
    if (min !== undefined) input.min = min;
    input.addEventListener('change', () => { const v = input.valueAsNumber; if (!Number.isFinite(v)) { input.classList.add('invalid'); return; } input.classList.remove('invalid'); cur[i] = v; onChange?.([...cur], { live: false }); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); });
    return input;
  });
  const { el, lab } = row(label, h('div', { class: 'vec' }, inputs), { unit, hint });
  // scrub all three by dragging the label: affects the axis under the first drag direction? keep simple: no scrub on vec labels
  lab.style.cursor = 'default';
  const api = { el, inputs, set(v) { v.forEach((x, i) => { cur[i] = x; if (document.activeElement !== inputs[i]) inputs[i].value = r4(x); }); }, get: () => [...cur] };
  api.set(value);
  return api;
}

export function boolField(label, { value, hint, onChange }) {
  const input = h('input', { type: 'checkbox', 'aria-label': label });
  const { el } = row(label, input, { hint });
  input.addEventListener('change', () => onChange?.(input.checked, { live: false }));
  input.checked = !!value;
  return { el, input, set(v) { input.checked = !!v; }, get: () => input.checked };
}

export function selectField(label, { value, options, hint, onChange, optionLabel }) {
  const input = h('select', { 'aria-label': label }, options.map((o) => h('option', { value: o }, optionLabel ? optionLabel(o) : (o === '' ? '(none)' : o))));
  const { el } = row(label, input, { hint });
  input.addEventListener('change', () => onChange?.(input.value, { live: false }));
  input.value = value;
  return { el, input, set(v) { if (![...input.options].some((o) => o.value === v)) input.appendChild(h('option', { value: v }, String(v) + ' (unknown)')); input.value = v; }, get: () => input.value };
}

export function textField(label, { value = '', multiline = false, placeholder = '', hint, onChange, validate }) {
  const input = multiline ? h('textarea', { 'aria-label': label, placeholder }) : h('input', { type: 'text', 'aria-label': label, placeholder });
  const { el } = row(label, input, { hint });
  const err = h('div', { class: 'err' });
  input.addEventListener('change', () => {
    const msg = validate?.(input.value);
    if (msg) { input.classList.add('invalid'); err.textContent = msg; if (!err.isConnected) el.appendChild(err); return; }
    input.classList.remove('invalid'); err.remove();
    onChange?.(input.value, { live: false });
  });
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !multiline) input.blur(); });
  input.value = value;
  return { el, input, set(v) { if (document.activeElement !== input) input.value = v ?? ''; }, get: () => input.value };
}

export function colorField(label, { value = '#ffffff', hint, onChange }) {
  const color = h('input', { type: 'color', 'aria-label': label });
  const text = h('input', { type: 'text', 'aria-label': label + ' (hex)', style: { width: '80px' } });
  const { el } = row(label, [color, text], { hint });
  color.addEventListener('input', () => { text.value = color.value; onChange?.(color.value, { live: true }); });
  color.addEventListener('change', () => onChange?.(color.value, { live: false }));
  text.addEventListener('change', () => { if (/^#[0-9a-fA-F]{6}$/.test(text.value)) { color.value = text.value; onChange?.(text.value, { live: false }); } else text.classList.add('invalid'); });
  text.addEventListener('keydown', (e) => e.stopPropagation());
  const set = (v) => { color.value = /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#ffffff'; text.value = v; text.classList.remove('invalid'); };
  set(value);
  return { el, set, get: () => color.value };
}

export function jsonField(label, { value, hint, onChange }) {
  return textField(label, {
    value: JSON.stringify(value ?? null, null, 1), multiline: true, hint,
    validate: (s) => { try { JSON.parse(s); return null; } catch (e) { return 'Invalid JSON: ' + e.message; } },
    onChange: (s, o) => onChange?.(JSON.parse(s), o),
  });
}

export function button(label, onclick, { primary = false, small = true, title = '' } = {}) {
  return h('button', { class: 'btn' + (primary ? ' primary' : '') + (small ? ' small' : ''), onclick, title }, label);
}
export function section(title, body, { open = true, key, prefs } = {}) {
  const closedKey = key && prefs ? 'sec.' + key : null;
  const isOpen = closedKey ? prefs.pref(closedKey, open) : open;
  const el = h('div', { class: 'sec' + (isOpen ? '' : ' closed') });
  const car = h('span', { class: 'car' }, isOpen ? '▼' : '▶');
  const head = h('div', { class: 'sec-h', role: 'button', tabindex: '0', 'aria-expanded': String(isOpen), onclick: () => {
    const now = el.classList.toggle('closed');
    car.textContent = now ? '▶' : '▼'; head.setAttribute('aria-expanded', String(!now));
    if (closedKey) prefs.setPref(closedKey, !now);
  }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); head.click(); } } }, car, title);
  el.append(head, h('div', { class: 'sec-b' }, body));
  return el;
}
export { row };

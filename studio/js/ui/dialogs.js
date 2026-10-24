// Modal dialogs, toasts and context menus. Everything returns promises so callers read top-to-bottom.
import { h, clear } from './dom.js';

let openCount = 0;
/** Return this from a button's value() to keep the dialog open (e.g. validation failed). */
export const KEEP_OPEN = Symbol('keep-open');
export const isModalOpen = () => openCount > 0;
const root = () => document.getElementById('overlay-root');

/** buttons: [{label, value, primary, danger}] ; body: Node|string ; resolves with button value (or undefined on Esc). */
export function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], width = 520, onMount, dismissable = true }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (v) => { back.remove(); openCount--; window.removeEventListener('keydown', onKey, true); prevFocus?.focus?.(); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(undefined); }
      else if (e.key === 'Enter' && !(e.target.tagName === 'TEXTAREA') && !(e.target.tagName === 'BUTTON')) { const p = buttons.find((b) => b.primary); if (p) { e.preventDefault(); const v = typeof p.value === 'function' ? p.value() : p.value; if (v !== KEEP_OPEN) close(v); } }
    };
    const content = h('div', { class: 'modal-b' }, typeof body === 'string' ? h('div', { html: undefined }, body) : body);
    const modalEl = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { '--w': width + 'px' } },
      h('div', { class: 'modal-h' }, title), content,
      h('div', { class: 'modal-f' }, buttons.map((b) => h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), 'data-value': String(b.label), onclick: () => { const v = typeof b.value === 'function' ? b.value() : b.value; if (v !== KEEP_OPEN) close(v); } }, b.label))));
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back && dismissable) close(undefined); } }, modalEl);
    openCount++;
    root().appendChild(back);
    window.addEventListener('keydown', onKey, true);
    onMount?.(content, close);
    const first = content.querySelector('input,select,textarea') || modalEl.querySelector('.btn.primary') || modalEl.querySelector('button');
    first?.focus();
    if (first?.select && first.tagName === 'INPUT') first.select();
  });
}

export const alertBox = (title, message, kind) => modal({ title, body: h('div', { class: kind === 'error' ? 'note err' : '' , style: { whiteSpace: 'pre-wrap' } }, message) });
export const confirmBox = (title, message, { ok = 'OK', danger = false } = {}) =>
  modal({ title, body: h('div', { style: { whiteSpace: 'pre-wrap' } }, message), buttons: [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: !danger, danger }] }).then((v) => !!v);
export function promptBox(title, label, value = '', { placeholder = '' } = {}) {
  const input = h('input', { type: 'text', value, placeholder, style: { width: '100%', padding: '5px 8px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '4px' } });
  return modal({ title, body: h('div', {}, h('div', { style: { marginBottom: '6px', color: 'var(--dim)' } }, label), input),
    buttons: [{ label: 'Cancel', value: undefined }, { label: 'OK', value: () => input.value, primary: true }] });
}

export function toast(msg, kind = 'info', ms = 3800) {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts', 'aria-live': 'polite' }); root().appendChild(box); }
  const t = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status' }, msg);
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? ms * 2 : ms);
}

/** items: [{label, run, disabled, shortcut, sep, checked, header}] */
export function contextMenu(x, y, items) {
  closeContextMenu();
  const el = h('div', { class: 'menu-pop ctx' }, items.map((it) => {
    if (it.sep) return h('div', { class: 'menu-sep' });
    if (it.header) return h('div', { class: 'menu-head' }, it.header);
    return h('div', { class: 'menu-item' + (it.disabled ? ' disabled' : ''), role: 'menuitem', onclick: () => { if (it.disabled) return; closeContextMenu(); it.run?.(); } },
      it.checked ? h('span', { class: 'chk' }, '✓') : null, it.label, it.shortcut ? h('span', { class: 'kbd' }, it.shortcut) : null);
  }));
  root().style.pointerEvents = 'none';
  root().appendChild(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
  el.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
  el.style.pointerEvents = 'auto';
  const off = (e) => { if (!el.contains(e.target)) closeContextMenu(); };
  setTimeout(() => window.addEventListener('mousedown', off, { once: true, capture: true }), 0);
  el._off = off;
}
export function closeContextMenu() { document.querySelectorAll('.ctx').forEach((e) => { window.removeEventListener('mousedown', e._off, true); e.remove(); }); }

// Keyboard shortcuts. "Ctrl+Shift+Z", "Delete", "F2", "1" ... Ctrl also matches the Meta key on macOS.
import { isModalOpen } from './dialogs.js';

export function parseCombo(str) {
  const parts = str.split('+').map((s) => s.trim());
  const key = parts.pop();
  return { ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt'), key: key.length === 1 ? key.toLowerCase() : key };
}

function matches(c, e) {
  if (c.ctrl !== (e.ctrlKey || e.metaKey) || c.shift !== e.shiftKey || c.alt !== e.altKey) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === c.key) return true;
  if (c.key.length === 1 && /^[a-z]$/.test(c.key)) return e.code === 'Key' + c.key.toUpperCase();
  if (/^[0-9]$/.test(c.key)) return e.code === 'Digit' + c.key;
  return false;
}

export function installShortcuts(app, { isBlocked } = {}) {
  const table = () => [...app.actions.values()].filter((a) => a.shortcut).map((a) => ({ a, combos: [].concat(a.shortcut).map(parseCombo) }));
  let cache = null;
  app.on('actions', () => { cache = null; });
  window.addEventListener('keydown', (e) => {
    if (isModalOpen() || e.defaultPrevented) return;
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (isBlocked?.(e)) return;
    cache = cache || table();
    for (const { a, combos } of cache) {
      if (!combos.some((c) => matches(c, e))) continue;
      // while typing only global save/undo-style chords with Ctrl pass through (and never plain keys)
      if (typing && !(a.global)) return;
      if (a.enabled && !a.enabled(app)) continue;     // another action may own the same key in the current context
      e.preventDefault();
      app.run(a.id);
      return;
    }
  });
}

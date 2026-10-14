// Player settings + quality presets, persisted in localStorage.

const KEY = 'strikepoint.settings.v1';

export const QUALITY_PRESETS = {
  low: { label: 'Low', renderScale: 0.75, shadows: 'static', shadowSize: 1024, softShadows: false, texSize: 256, aoCell: 1.0, bloom: false, aniso: 2, maxDpr: 1, propDetail: 0 },
  medium: { label: 'Medium', renderScale: 1, shadows: 'static', shadowSize: 2048, softShadows: false, texSize: 512, aoCell: 0.7, bloom: false, aniso: 4, maxDpr: 1.5, propDetail: 1 },
  high: { label: 'High', renderScale: 1, shadows: 'dynamic', shadowSize: 2048, softShadows: true, texSize: 512, aoCell: 0.5, bloom: true, aniso: 8, maxDpr: 2, propDetail: 1 },
  ultra: { label: 'Ultra', renderScale: 1, shadows: 'dynamic', shadowSize: 4096, softShadows: true, texSize: 1024, aoCell: 0.4, bloom: true, aniso: 16, maxDpr: 3, propDetail: 1 },
};

const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

export const DEFAULTS = {
  name: '',
  quality: isTouch ? 'medium' : 'high',
  renderScale: 1, // multiplier on top of preset
  dynamicRes: true,
  fpsCap: 120, // 0 = unlimited (display refresh)
  showFps: true,
  bloomOverride: null, // null = from preset
  fov: 78,
  vmFov: 56,
  vmOffsetX: 0,
  sens: 1.0,
  scopeSens: 0.8,
  touchSens: 1.0,
  invertY: false,
  volume: 0.8,
  crosshair: { color: '#3dff8b', size: 7, gap: 4, thick: 2, dot: false, outline: true, dynamic: true },
  botDifficulty: 'normal',
  primary: 'rifle',
  touchLayout: null,
};

function deepMerge(a, b) {
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const k in b) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') out[k] = deepMerge(a[k], b[k]);
    else if (b[k] !== undefined) out[k] = b[k];
  }
  return out;
}

export const settings = (() => {
  let s = JSON.parse(JSON.stringify(DEFAULTS));
  try { const raw = localStorage.getItem(KEY); if (raw) s = deepMerge(s, JSON.parse(raw)); } catch (e) { /* storage blocked */ }
  if (!QUALITY_PRESETS[s.quality]) s.quality = DEFAULTS.quality;
  return s;
})();
settings.isTouch = isTouch;

const listeners = new Set();
export function saveSettings() {
  try { const { isTouch: _, ...rest } = settings; localStorage.setItem(KEY, JSON.stringify(rest)); } catch (e) { /* ignore */ }
  listeners.forEach((f) => f(settings));
}
export function onSettings(f) { listeners.add(f); return () => listeners.delete(f); }
export function preset() { return QUALITY_PRESETS[settings.quality] || QUALITY_PRESETS.high; }

// --- generic library storage for user content (maps, textures, anims) ---
export const store = {
  get(key, fallback) { try { const r = localStorage.getItem('strikepoint.' + key); return r ? JSON.parse(r) : fallback; } catch (e) { return fallback; } },
  set(key, val) {
    try { localStorage.setItem('strikepoint.' + key, JSON.stringify(val)); return true; } catch (e) {
      console.warn('storage full', e); return false;
    }
  },
  del(key) { try { localStorage.removeItem('strikepoint.' + key); } catch (e) { /* ignore */ } },
};

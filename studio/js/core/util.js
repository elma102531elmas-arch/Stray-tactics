// Small dependency-free helpers shared by every core module (runs in browsers and Node).

export class Emitter {
  constructor() { this._h = new Map(); }
  on(type, fn) {
    if (!this._h.has(type)) this._h.set(type, new Set());
    this._h.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) { this._h.get(type)?.delete(fn); }
  emit(type, ...args) {
    const set = this._h.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(...args); } catch (e) { console.error(`[emitter] handler for "${type}" threw`, e); }
    }
  }
}

let _counter = 0;
let _gen = null;
/** Replace id generation (tests use this for deterministic ids). */
export function setIdGenerator(fn) { _gen = fn; }
export function uid(prefix = 'n') {
  if (_gen) return _gen(prefix);
  _counter++;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}${_counter.toString(36)}`;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const round = (v, d = 4) => { const k = 10 ** d; return Math.round(v * k) / k; };

/** get/set by array path on plain objects/arrays. */
export function getPath(obj, path) {
  let o = obj;
  for (const k of path) { if (o == null) return undefined; o = o[k]; }
  return o;
}
export function setPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (o[k] == null || typeof o[k] !== 'object') o[k] = typeof path[i + 1] === 'number' ? [] : {};
    o = o[k];
  }
  const last = path[path.length - 1];
  if (value === undefined) { if (Array.isArray(o)) o.splice(last, 1); else delete o[last]; } else o[last] = value;
}

export function sha256Hex(bytes) {
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
  if (!subtle) return Promise.resolve('nohash-' + bytes.byteLength);
  return subtle.digest('SHA-256', bytes).then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''));
}

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/** Stable, readable unique name within a set. */
export function uniqueName(base, taken) {
  if (!taken.has(base)) return base;
  const m = base.match(/^(.*?)(?:[ _](\d+))?$/);
  const stem = m[1];
  let n = m[2] ? +m[2] + 1 : 2;
  while (taken.has(`${stem} ${n}`)) n++;
  return `${stem} ${n}`;
}

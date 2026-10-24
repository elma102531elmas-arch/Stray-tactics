// Cinematic sequences (timeline). Data model, deterministic evaluation, and a player with cancel / skip / restore semantics.
// DOM-free: the editor preview, the playtest and the unit tests all use the same evaluate() and SequencePlayer.
//
// sequence = { id, name, duration, loop, skippable, reduceFlashing, tracks:[track] }
// track    = { id, type, name, target?, prop?, mute?, keys:[...] }            (keys sorted by t)
//   camera    key {t, p:[x,y,z], r:[yaw,pitch,roll] deg, fov, ease}   (replaces the player's view while it plays)
//   fov       key {t, d, ease}       field-of-view offset in degrees added to whatever camera is active
//   transform key {t, p?, r?, s?, ease}              target = node name/id
//   property  key {t, v: number|'#rrggbb'|boolean, ease}  target = node, prop = props key (light intensity, door state...)
//   audio     clip {t, asset, volume, at?}           one-shot sound
//   event     clip {t, name}                         emits an event
//   text      clip {t, dur, text}                    subtitle (authored by you; nothing is generated)
//   fade      clip {t, dur, from, to, color}
//   shake     clip {t, dur, amp, freq}
//   flash     clip {t, dur, color, intensity}
//   anim      clip {t, target, clip, loop, speed}

import { uid, deepClone } from './util.js';

export const TRACK_TYPES = {
  camera: { label: 'Camera (takes over the view)', color: '#4aa3ff', kind: 'keys' },
  fov: { label: 'Field of view (relative)', color: '#4aa3ff', kind: 'keys' },
  transform: { label: 'Object transform', color: '#5bd18b', kind: 'keys' },
  property: { label: 'Property', color: '#c78a2b', kind: 'keys' },
  audio: { label: 'Sound', color: '#c060ff', kind: 'clips' },
  event: { label: 'Event', color: '#ffe060', kind: 'clips' },
  text: { label: 'Subtitle', color: '#e0e0e0', kind: 'clips' },
  fade: { label: 'Fade', color: '#8a8f96', kind: 'clips' },
  shake: { label: 'Camera shake', color: '#ff9a2a', kind: 'clips' },
  flash: { label: 'Flash', color: '#ffffff', kind: 'clips' },
  anim: { label: 'Animation clip', color: '#40d0d0', kind: 'clips' },
};
export const EASINGS = ['linear', 'in', 'out', 'inOut', 'step'];
const ease = (name, x) => { x = Math.min(1, Math.max(0, x)); switch (name) { case 'in': return x * x; case 'out': return 1 - (1 - x) * (1 - x); case 'inOut': return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; case 'step': return x >= 1 ? 1 : 0; default: return x; } };
export const MAX_FLASH_REDUCED = 0.3;

export function newSequence(name = 'New sequence') { return { id: uid('seq'), name, duration: 5, loop: false, skippable: true, reduceFlashing: true, tracks: [] }; }
export function newTrack(type, extra = {}) { if (!TRACK_TYPES[type]) throw new Error(`Unknown track type "${type}"`); return { id: uid('trk'), type, name: TRACK_TYPES[type].label, mute: false, keys: [], ...extra }; }

const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const lerpAngle = (a, b, t) => { let d = ((b - a + 540) % 360) - 180; return a + d * t; };
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** Interpolate a keyed track at time t. fields: names of vector/number fields to blend. Returns an object or null if no keys. */
export function sampleKeys(keys, t, fields, angleFields = []) {
  if (!keys.length) return null;
  if (t <= keys[0].t) return pick(keys[0], fields);
  const last = keys[keys.length - 1];
  if (t >= last.t) return pick(last, fields);
  let i = 0; while (keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  const u = ease(a.ease || 'linear', (t - a.t) / Math.max(1e-9, b.t - a.t));
  const out = {};
  for (const f of fields) {
    const va = a[f] ?? b[f], vb = b[f] ?? a[f];
    if (va === undefined) continue;
    if (Array.isArray(va)) out[f] = angleFields.includes(f) ? va.map((x, k) => lerpAngle(x, vb[k], u)) : lerpV(va, vb, u);
    else if (typeof va === 'number') out[f] = lerp(va, vb, u);
    else if (typeof va === 'string' && /^#[0-9a-f]{6}$/i.test(va)) out[f] = rgbToHex(lerpV(hexToRgb(va), hexToRgb(vb), u));
    else out[f] = u >= 1 ? vb : va;                         // booleans / strings switch at the key
  }
  return out;
}
const pick = (k, fields) => { const o = {}; for (const f of fields) if (k[f] !== undefined) o[f] = deepClone(k[f]); return o; };

function noise(t, seed) { return Math.sin(t * 12.9898 + seed * 78.233) * 0.5 + Math.sin(t * 7.13 + seed * 3.7) * 0.5; }

/**
 * Evaluate the visual state of a sequence at time t.
 * Returns { camera, nodes:{key:{p,r,s}}, props:[{target,prop,value}], fade, flash, shake, subtitles:[text], anims:[{target,clip,t,...}] }.
 * One-shot things (audio, events) are NOT part of the state: see crossings().
 */
export function evaluate(seq, t, { reduceFlashing = seq.reduceFlashing } = {}) {
  const out = { camera: null, fovDelta: 0, nodes: {}, props: [], fade: null, flash: null, shake: null, subtitles: [], anims: [] };
  for (const tr of seq.tracks) {
    if (tr.mute) continue;
    switch (tr.type) {
      case 'camera': { const s = sampleKeys(tr.keys, t, ['p', 'r', 'fov'], ['r']); if (s) out.camera = { p: s.p, r: s.r || [0, 0, 0], fov: s.fov ?? 60 }; break; }
      case 'fov': { const s = sampleKeys(tr.keys, t, ['d']); if (s) out.fovDelta = (out.fovDelta || 0) + (s.d || 0); break; }
      case 'transform': { const s = sampleKeys(tr.keys, t, ['p', 'r', 's'], ['r']); if (s && tr.target) out.nodes[tr.target] = { ...(out.nodes[tr.target] || {}), ...s }; break; }
      case 'property': { const s = sampleKeys(tr.keys, t, ['v']); if (s && tr.target && tr.prop) out.props.push({ target: tr.target, prop: tr.prop, value: s.v }); break; }
      case 'fade': for (const c of tr.keys) if (t >= c.t && t <= c.t + c.dur) { const u = ease('linear', (t - c.t) / Math.max(1e-9, c.dur)); out.fade = { alpha: lerp(c.from, c.to, u), color: c.color || '#000000' }; } else if (t > c.t + c.dur && !tr.keys.some((d) => d.t > c.t && t >= d.t)) out.fade = { alpha: c.to, color: c.color || '#000000' }; break;
      case 'shake': for (const c of tr.keys) if (t >= c.t && t <= c.t + c.dur) { const fall = 1 - (t - c.t) / Math.max(1e-9, c.dur); const f = c.freq || 18, a = (c.amp ?? 0.05) * fall; const seed = c.t * 31; out.shake = { p: [noise(t * f, seed) * a, noise(t * f, seed + 1) * a, 0], r: [0, 0, noise(t * f, seed + 2) * a * 30] }; } break;
      case 'flash': for (const c of tr.keys) if (t >= c.t && t <= c.t + c.dur) { const fall = 1 - (t - c.t) / Math.max(1e-9, c.dur); let a = (c.intensity ?? 1) * fall; if (reduceFlashing) a = Math.min(a, MAX_FLASH_REDUCED); out.flash = { alpha: Math.max(out.flash?.alpha || 0, a), color: c.color || '#ffffff' }; } break;
      case 'text': for (const c of tr.keys) if (t >= c.t && t < c.t + c.dur) out.subtitles.push(c.text); break;
      case 'anim': for (const c of tr.keys) if (t >= c.t) out.anims.push({ target: c.target, clip: c.clip, time: (t - c.t) * (c.speed || 1), loop: c.loop !== false }); break;
      default: break;
    }
  }
  return out;
}

/** One-shot clips (sounds, events) whose start time lies in (from, to]. */
export function crossings(seq, from, to) {
  const out = [];
  for (const tr of seq.tracks) {
    if (tr.mute || (tr.type !== 'audio' && tr.type !== 'event')) continue;
    for (const c of tr.keys) if (c.t > from && c.t <= to) out.push({ type: tr.type, t: c.t, ...(tr.type === 'audio' ? { asset: c.asset, volume: c.volume ?? 1, at: c.at || null } : { name: c.name }) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Sequence length considering clips that run past `duration` (reported by validation). */
export function contentEnd(seq) {
  let end = 0;
  for (const tr of seq.tracks) for (const c of tr.keys) end = Math.max(end, c.t + (c.dur || 0));
  return end;
}

export function validateSequence(seq, project) {
  const issues = [];
  const add = (severity, message) => issues.push({ severity, message });
  if (!(seq.duration > 0)) add('error', 'The sequence has no duration.');
  if (contentEnd(seq) > seq.duration + 1e-6) add('warn', `Something runs until ${contentEnd(seq).toFixed(2)} s but the sequence ends at ${seq.duration} s — it will be cut off.`);
  const has = (id) => id && (project.scene.has(id) || project.scene.byName(id));
  for (const tr of seq.tracks) {
    if (['transform', 'property', 'anim'].includes(tr.type) && !has(tr.target) && !tr.keys.every((k) => has(k.target))) add('warn', `Track “${tr.name}” animates “${tr.target || '?'}” which does not exist.`);
    if (tr.type === 'audio') for (const c of tr.keys) if (!c.asset) add('warn', `A sound clip at ${c.t.toFixed(2)} s has no sound chosen.`); else if (!c.asset.startsWith('builtin:') && !project.data.assets[c.asset]) add('warn', `Sound “${c.asset}” is not in the project.`);
    if (tr.type === 'camera' && tr.keys.length < 2) add('info', `Camera track “${tr.name}” has ${tr.keys.length} key(s); add at least two to animate.`);
    for (const k of tr.keys) if (k.t < 0) add('error', `A key in “${tr.name}” is before time 0.`);
  }
  const flashes = seq.tracks.filter((t) => t.type === 'flash' && !t.mute).flatMap((t) => t.keys).sort((a, b) => a.t - b.t);
  for (let i = 1; i < flashes.length; i++) if (flashes[i].t - flashes[i - 1].t < 0.33 && !seq.reduceFlashing) add('warn', 'Flashes closer than 1/3 s apart can trigger photosensitive reactions. Enable “Reduce flashing” or space them out.');
  if (!seq.tracks.length) add('info', 'The sequence is empty.');
  return issues;
}

// ---------------------------------------------------------------------------------------------- player
/**
 * Plays a sequence over time. The host supplies an adapter that APPLIES state:
 *   adapter.apply(state)          visual state each frame
 *   adapter.audio(clip)           play a sound
 *   adapter.event(name)           emit a game event
 *   adapter.begin()/end(reason)   take / release control (camera, input); reason: 'finished' | 'skipped' | 'cancelled'
 *   adapter.capture(targets)      returns an opaque snapshot of the animated nodes;  adapter.restore(snapshot)
 */
export class SequencePlayer {
  constructor(seq, adapter, { reduceFlashing } = {}) {
    this.seq = seq; this.adapter = adapter;
    this.opts = { reduceFlashing: reduceFlashing ?? seq.reduceFlashing };
    this.time = 0; this.playing = false; this.finished = false;
    this.snapshot = null;
  }

  targets() { return [...new Set(this.seq.tracks.filter((t) => t.target && ['transform', 'property', 'anim'].includes(t.type)).map((t) => t.target))]; }

  start() {
    this.snapshot = this.adapter.capture?.(this.targets()) ?? null;
    this.adapter.begin?.();
    this.time = 0; this.playing = true; this.finished = false;
    this.adapter.apply?.(evaluate(this.seq, 0, this.opts));
    for (const c of crossings(this.seq, -1, 0)) this._fire(c);
    return this;
  }

  _fire(c) { if (c.type === 'audio') this.adapter.audio?.(c); else this.adapter.event?.(c.name); }

  update(dt) {
    if (!this.playing) return;
    const prev = this.time;
    let t = prev + dt;
    if (t >= this.seq.duration) {
      for (const c of crossings(this.seq, prev, this.seq.duration)) this._fire(c);
      if (this.seq.loop) { t -= this.seq.duration; for (const c of crossings(this.seq, -1, t)) this._fire(c); this.time = t; this.adapter.apply?.(evaluate(this.seq, t, this.opts)); return; }
      this.time = this.seq.duration;
      this.adapter.apply?.(evaluate(this.seq, this.time, this.opts));
      this._finish('finished');
      return;
    }
    for (const c of crossings(this.seq, prev, t)) this._fire(c);
    this.time = t;
    this.adapter.apply?.(evaluate(this.seq, t, this.opts));
  }

  /** Jump to the end: skip visual/audio fluff but still fire the remaining EVENTS so game state stays consistent. */
  skip() {
    if (!this.playing || !this.seq.skippable) return false;
    for (const c of crossings(this.seq, this.time, this.seq.duration)) if (c.type === 'event') this._fire(c);
    this.time = this.seq.duration;
    this._finish('skipped');
    return true;
  }

  /** Abort immediately and put everything back the way it was (no events fired). */
  cancel() { if (this.playing) this._finish('cancelled'); }

  _finish(reason) {
    this.playing = false; this.finished = true;
    if (reason === 'cancelled' || (reason === 'finished' && this.restoreOnEnd) || this.seq.restore === true) this.adapter.restore?.(this.snapshot);
    this.adapter.end?.(reason);
  }
}

/** Build a jumpscare skeleton (all values editable afterwards). Parameters are explicit user choices — nothing is generated beyond timing/shape. */
export function jumpscarePreset({ name = 'Jumpscare', duration = 2.4, shake = 0.08, flash = false, flashIntensity = 0.8, fovPunch = 14, blackout = true, sting = '', enemy = '', enemyFrom = null, enemyTo = null, lights = '', lightsOn = 20 } = {}) {
  const seq = newSequence(name); seq.duration = duration; seq.reduceFlashing = true;
  const T = (type, extra) => { const tr = newTrack(type, extra); seq.tracks.push(tr); return tr; };
  if (blackout) T('fade', { name: 'Blackout', keys: [{ t: duration * 0.62, dur: 0.08, from: 0, to: 1, color: '#000000' }, { t: duration - 0.3, dur: 0.3, from: 1, to: 0, color: '#000000' }] });
  T('shake', { keys: [{ t: 0.15, dur: Math.min(1.2, duration * 0.5), amp: shake, freq: 22 }] });
  T('fov', { name: 'FOV punch', keys: [{ t: 0, d: 0, ease: 'out' }, { t: 0.18, d: fovPunch, ease: 'inOut' }, { t: duration * 0.6, d: 0 }] });
  if (flash) T('flash', { keys: [{ t: 0.15, dur: 0.12, color: '#ffffff', intensity: flashIntensity }] });
  if (sting) T('audio', { name: 'Sting', keys: [{ t: 0.1, asset: sting, volume: 1 }] }); else T('audio', { name: 'Sting (choose a sound)', keys: [{ t: 0.1, asset: '', volume: 1 }] });
  if (enemy && enemyFrom && enemyTo) T('transform', { name: 'Enemy lunge', target: enemy, keys: [{ t: 0, p: enemyFrom, ease: 'in' }, { t: 0.35, p: enemyTo }] });
  if (lights) T('property', { name: 'Lights out', target: lights, prop: 'intensity', keys: [{ t: duration * 0.6, v: lightsOn }, { t: duration * 0.62, v: 0, ease: 'step' }] });
  T('event', { name: 'Events', keys: [{ t: duration, name: `${name.toLowerCase().replace(/\W+/g, '-')}-done` }] });
  return seq;
}

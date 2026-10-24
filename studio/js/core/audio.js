// Audio rules shared by the Audio Studio, the playtest and validation. DOM-free (no Web Audio here) so everything is unit-tested:
// bus mixing, distance models, wall occlusion, audio zones, footstep surfaces, reverb impulse generation and sound analysis.
//
// The game's own audio code is NOT imported; these are the editor's own, documented rules (see docs/KNOWN_LIMITATIONS.md):
//   * attenuation follows the Web Audio distance-model formulas, then fades to silence over the last 10 % before "max distance"
//   * every solid wall / closed door between listener and source steps the sound down (gain × low-pass), see OCCLUSION_STEPS
//   * of several overlapping zones of one kind, the highest priority wins; a tie goes to the smaller volume

import * as THREE from '../../lib/three.module.js';
import { propsOf, worldColliders, nodeWorldAABB } from './geometry.js';
import { pointInCollider } from './collision.js';
import { SURFACES } from './schema.js';
import { getMaterialDef } from './materials.js';

export const BUS_IDS = ['sfx', 'ambience', 'music', 'voice'];
export const DISTANCE_MODELS = ['inverse', 'linear', 'exponential'];
export { SURFACES };

const num = (v, d) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const toDb = (g) => (g > 1e-5 ? 20 * Math.log10(g) : -Infinity);
export const fromDb = (db) => 10 ** (db / 20);

// ------------------------------------------------------------------ mixer settings (project.data.audio)
export function defaultAudioData() { return { master: 1, buses: Object.fromEntries(BUS_IDS.map((b) => [b, 1])), mute: {}, solo: '', footsteps: {}, reverbs: {} }; }

/** Normalised copy of project.data.audio; tolerant of older / partial data. */
export function audioSettings(data) {
  const a = data?.audio || {};
  const out = defaultAudioData();
  out.master = clamp(num(a.master, 1), 0, 2);
  for (const b of BUS_IDS) { out.buses[b] = clamp(num(a.buses?.[b], 1), 0, 2); out.mute[b] = !!a.mute?.[b]; }
  out.solo = BUS_IDS.includes(a.solo) ? a.solo : '';
  for (const [s, list] of Object.entries(a.footsteps || {})) if (Array.isArray(list)) out.footsteps[s] = list.filter((x) => typeof x === 'string' && x);
  for (const [k, v] of Object.entries(a.reverbs || {})) if (v && typeof v === 'object') out.reverbs[k] = { ...v };
  return out;
}

/** Effective linear gain of every bus after mute / solo (master NOT included). */
export function busLevels(settings) {
  const out = {};
  for (const b of BUS_IDS) out[b] = settings.mute[b] || (settings.solo && settings.solo !== b) ? 0 : settings.buses[b];
  return out;
}

// ------------------------------------------------------------------ distance & occlusion
/** The three Web Audio distance models. d, ref, max in metres. */
export function distanceGain(model, d, ref, max, rolloff) {
  ref = Math.max(ref, 1e-3); d = Math.max(d, ref);
  switch (model) {
    case 'linear': return clamp(1 - rolloff * (Math.min(d, max) - ref) / Math.max(max - ref, 1e-6), 0, 1);
    case 'exponential': return d / ref > 0 ? (d / ref) ** -rolloff : 1;
    default: return ref / (ref + rolloff * (d - ref));
  }
}

/** Gain of an audio source at distance d: the model's curve, 0 beyond maxDistance, smoothly faded over the last 10 % so it never clicks. */
export function sourceGain(props, d) {
  const p = { refDistance: 2, maxDistance: 30, rolloff: 1.2, distanceModel: 'inverse', ...props };
  if (d > p.maxDistance) return 0;
  const fade = clamp((p.maxDistance - d) / (0.1 * p.maxDistance), 0, 1);
  return distanceGain(p.distanceModel, d, p.refDistance, p.maxDistance, p.rolloff) * fade;
}

/** Each blocker between listener and source steps the sound down. Index = number of walls/closed doors (capped). */
export const OCCLUSION_STEPS = [{ gain: 1, cutoff: 20000 }, { gain: 0.5, cutoff: 2200 }, { gain: 0.35, cutoff: 1100 }, { gain: 0.25, cutoff: 600 }];

export function occlusion(world, from, to) {
  const v = to.clone().sub(from), dist = v.length();
  if (!world || dist < 0.1) return { blockers: 0, ...OCCLUSION_STEPS[0] };
  const hits = world.raycastAll(from, v, dist - 0.05, { doors: true });
  const blockers = new Set(hits.map((h) => h.collider.nodeId)).size;
  return { blockers, ...OCCLUSION_STEPS[Math.min(blockers, OCCLUSION_STEPS.length - 1)] };
}

/** Everything the mixer needs to know about one source heard from one listener position. */
export function hearSource(src, listener, world, settings) {
  const p = { volume: 1, bus: 'sfx', occlusion: true, ...src.props };
  const pos = new THREE.Vector3(src.pos.x, src.pos.y, src.pos.z);
  const distance = pos.distanceTo(listener);
  const att = sourceGain(p, distance);
  const occ = p.occlusion && att > 0 ? occlusion(world, listener, pos) : { blockers: 0, ...OCCLUSION_STEPS[0] };
  const levels = busLevels(settings), busGain = levels[p.bus] ?? 1;
  const final = att * occ.gain * p.volume * busGain * settings.master;
  let state = 'audible';
  if (!p.asset) state = 'no sound'; else if (busGain === 0 || settings.master === 0) state = 'bus muted'; else if (att === 0) state = 'out of range';
  return { id: src.id, name: src.name, bus: p.bus, distance, attenuation: att, blockers: occ.blockers, occlusionGain: occ.gain, cutoff: occ.cutoff, volume: p.volume, busGain, final, db: toDb(final), state, audible: state === 'audible' && final > 0.001 };
}

// ------------------------------------------------------------------ scene audio objects
/** Sources, zones and footstep zones of a project, in world space. Hidden / disabled nodes are left out. */
export function collectAudio(project, { colliders = null } = {}) {
  const scene = project.scene;
  const cols = colliders || worldColliders(scene, project.geoCtx);
  const sources = [], zones = [], footZones = [];
  for (const n of scene.all()) {
    if (!scene.isVisible(n.id)) continue;
    const p = propsOf(n);
    if (p.enabled === false) continue;
    if (n.type === 'audioSource') { const w = scene.worldPosition(n.id); sources.push({ id: n.id, name: n.name, node: n, pos: { x: w.x, y: w.y, z: w.z }, props: p }); continue; }
    if (n.type === 'audioZone' || n.type === 'footstepZone') {
      const c = cols.find((x) => x.nodeId === n.id); if (!c) continue;
      const size = c.shape === 'sphere' ? Math.PI : (c.max[0] - c.min[0]) * (c.max[1] - c.min[1]) * (c.max[2] - c.min[2]);
      (n.type === 'audioZone' ? zones : footZones).push({ id: n.id, name: n.name, node: n, c, props: p, volume: size });
    }
  }
  return { sources, zones, footZones, colliders: cols };
}

const better = (a, b) => !b || (a.props.priority || 0) > (b.props.priority || 0) || ((a.props.priority || 0) === (b.props.priority || 0) && (a.volume < b.volume || (a.volume === b.volume && a.id < b.id)));

/** Which zones the listener is in and which one wins for each purpose. */
export function zonesAt(zones, pos) {
  const inside = zones.filter((z) => pointInCollider(z.c, pos));
  const pick = (pred) => inside.filter(pred).reduce((best, z) => (better(z, best) ? z : best), null);
  return {
    inside,
    ambience: pick((z) => z.props.kind === 'ambience' && z.props.asset),
    music: pick((z) => z.props.kind === 'music' && z.props.asset),
    reverb: pick((z) => !!z.props.reverb),             // any zone can set the reverb; the highest priority wins
    muffle: pick((z) => (z.props.muffle || 0) > 0),
  };
}

/** Reverb preset heard at the listener: the winning zone's, else the map's environment setting. */
export function reverbAt(project, zr) { return zr.reverb?.props.reverb || project.data.environment?.reverb || 'none'; }

// ------------------------------------------------------------------ footsteps
/** Surface under a point: a footstep zone wins (smaller volume = more specific), otherwise the floor/material below. */
export function surfaceAt(project, audio, world, pos) {
  const probe = new THREE.Vector3(pos.x, pos.y + 0.5, pos.z);
  let zone = null;
  for (const z of audio.footZones) if (pointInCollider(z.c, probe) && (!zone || z.volume < zone.volume)) zone = z;
  if (zone) return { surface: zone.props.surface || 'tile', from: `zone “${zone.name}”` };
  const hit = world.raycast(new THREE.Vector3(pos.x, pos.y + 0.4, pos.z), new THREE.Vector3(0, -1, 0), 2.5);
  const node = hit && project.scene.get(hit.collider.nodeId);
  if (node) {
    const p = propsOf(node);
    if ((node.type === 'floor' || node.type === 'terrain') && p.surface) return { surface: p.surface, from: `${node.type} “${node.name}”` };
    const m = p.material && getMaterialDef(project, p.material);
    if (m?.surface) return { surface: m.surface, from: `material “${m.name || p.material}”` };
    if (p.surface) return { surface: p.surface, from: `“${node.name}”` };
  }
  return { surface: 'concrete', from: 'default (nothing mapped under the player)' };
}

/** Pick a footstep sound for a surface from the project mapping, never the same one twice in a row when there is a choice. */
export function pickFootstep(settings, surface, rng = Math.random, last = null) {
  const list = settings.footsteps[surface] || [];
  if (!list.length) return null;
  const pool = list.length > 1 ? list.filter((x) => x !== last) : list;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}
export const STEP_DISTANCE = { walk: 1.5, sprint: 2.3, crouch: 0.95 };

// ------------------------------------------------------------------ reverb
/** decay = RT60 in seconds, predelay in seconds, wet = send level 0–1, damp = low-pass of the tail in Hz. */
export const REVERB_PRESETS = {
  none: { decay: 0, predelay: 0, wet: 0, damp: 20000 },
  room: { decay: 0.6, predelay: 0.008, wet: 0.25, damp: 7000 },
  hall: { decay: 2.2, predelay: 0.025, wet: 0.35, damp: 5500 },
  basement: { decay: 1.4, predelay: 0.012, wet: 0.4, damp: 2600 },
  chapel: { decay: 4, predelay: 0.04, wet: 0.45, damp: 4500 },
  outdoor: { decay: 0.35, predelay: 0.06, wet: 0.12, damp: 9000 },
};
export function reverbParams(settings, preset) {
  const base = REVERB_PRESETS[preset] || REVERB_PRESETS.none;
  const o = settings?.reverbs?.[preset] || {};
  return { decay: clamp(num(o.decay, base.decay), 0, 12), predelay: clamp(num(o.predelay, base.predelay), 0, 0.5), wet: clamp(num(o.wet, base.wet), 0, 1), damp: clamp(num(o.damp, base.damp), 500, 20000) };
}

/** Seeded generator so the same settings always give the same impulse (and tests are exact). */
export function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Synthetic room impulse: silence for the predelay, then noise with an exponential envelope that falls 60 dB at `decay`, low-passed by `damp`. */
export function impulseResponse(params, sampleRate = 44100, seed = 1) {
  if (!(params.decay > 0)) return { channels: [new Float32Array(1), new Float32Array(1)], sampleRate, length: 1 };
  const pre = Math.round(params.predelay * sampleRate), len = pre + Math.max(1, Math.round(params.decay * 1.25 * sampleRate));
  const a = Math.exp((-2 * Math.PI * params.damp) / sampleRate);
  const channels = [0, 1].map((ch) => {
    const rng = mulberry32(seed * 7919 + ch * 104729), out = new Float32Array(len); let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate, env = 10 ** (-3 * t / params.decay);
      const noise = rng() * 2 - 1;
      lp = (1 - a) * noise + a * lp;
      out[i] = lp * env;
    }
    return out;
  });
  return { channels, sampleRate, length: len };
}

// ------------------------------------------------------------------ sound analysis
/** Peak, RMS, clipping and leading/trailing silence of decoded audio (array of Float32Array channels). */
export function analyzeSamples(channels, sampleRate, { silence = 0.001, clipAt = 0.999 } = {}) {
  const n = channels[0]?.length || 0;
  let peak = 0, sum = 0, clipped = 0, first = -1, last = -1;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const ch of channels) { const v = Math.abs(ch[i]); if (v > m) m = v; sum += ch[i] * ch[i]; }
    if (m > peak) peak = m;
    if (m >= clipAt) clipped++;
    if (m > silence) { if (first < 0) first = i; last = i; }
  }
  const rms = n ? Math.sqrt(sum / (n * channels.length)) : 0;
  return { duration: n / sampleRate, samples: n, channels: channels.length, peak, peakDb: toDb(peak), rms, rmsDb: toDb(rms), clipped, silent: first < 0, leadingSilence: first < 0 ? n / sampleRate : first / sampleRate, trailingSilence: first < 0 ? 0 : (n - 1 - last) / sampleRate };
}

/** [min,max] per column for drawing a waveform. */
export function waveformPeaks(channels, columns) {
  const n = channels[0]?.length || 0, out = new Float32Array(columns * 2);
  for (let c = 0; c < columns; c++) {
    const a = Math.floor((c * n) / columns), b = Math.max(a + 1, Math.floor(((c + 1) * n) / columns));
    let lo = 0, hi = 0;
    for (let i = a; i < b && i < n; i++) for (const ch of channels) { const v = ch[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    out[c * 2] = lo; out[c * 2 + 1] = hi;
  }
  return out;
}

// ------------------------------------------------------------------ validation
const aabbOverlap = (a, b) => a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y && a.min.z < b.max.z && a.max.z > b.min.z;

export function analyzeAudio(project, ctx = {}) {
  const out = [];
  const add = (code, severity, message, nodes = []) => out.push({ code, severity, message, nodes });
  const scene = project.scene, assets = project.data.assets, settings = audioSettings(project.data);
  const known = (id) => !!id && (assets[id] || String(id).startsWith('builtin:'));
  const isAudio = (id) => String(id).startsWith('builtin:') || assets[id]?.kind === 'audio';
  const zones = [];
  for (const n of scene.all()) {
    const p = propsOf(n);
    if (n.type === 'audioSource') {
      if (!p.asset) add('audio-no-asset', 'warn', `Audio source "${n.name}" has no sound assigned.`, [n.id]);
      else if (!known(p.asset)) add('audio-missing-asset', 'error', `Audio source "${n.name}" uses sound "${p.asset}", which is not in the project.`, [n.id]);
      else if (!isAudio(p.asset)) add('audio-wrong-kind', 'error', `Audio source "${n.name}" points at "${assets[p.asset]?.name || p.asset}", which is not a sound.`, [n.id]);
      if (p.maxDistance <= p.refDistance) add('audio-range', 'warn', `Audio source "${n.name}": max distance (${p.maxDistance} m) must be larger than the full-volume distance (${p.refDistance} m), otherwise it never fades.`, [n.id]);
      if (!p.autoplay && !p.playOnEvent && !(p.interval > 0)) add('audio-never-plays', 'warn', `Audio source "${n.name}" is not autoplay and has no "play on event", so nothing can start it.`, [n.id]);
      if (p.loop && p.interval > 0) add('audio-loop-interval', 'info', `Audio source "${n.name}" has both Loop and a random interval; the interval is ignored while it loops.`, [n.id]);
    } else if (n.type === 'audioZone') {
      if (p.kind !== 'reverb' && !p.asset) add('audio-no-asset', 'warn', `Audio zone "${n.name}" (${p.kind}) has no sound assigned.`, [n.id]);
      else if (p.asset && !known(p.asset)) add('audio-missing-asset', 'error', `Audio zone "${n.name}" uses sound "${p.asset}", which is not in the project.`, [n.id]);
      if (p.kind === 'reverb' && (!p.reverb || p.reverb === 'none')) add('audio-reverb-none', 'info', `Reverb zone "${n.name}" has preset “none”, so it only cancels the reverb of other zones.`, [n.id]);
      zones.push({ n, p });
    } else if (n.type === 'footstepZone') {
      if (!(settings.footsteps[p.surface] || []).length) add('audio-footstep-unmapped', 'info', `Footstep zone "${n.name}" uses surface “${p.surface}”, which has no footstep sounds assigned (Audio tab → Footsteps).`, [n.id]);
    }
  }
  // overlapping zones of one kind with the same priority: the playtest picks the smaller one, which is easy to forget
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    const a = zones[i], b = zones[j];
    if (a.p.kind !== b.p.kind || (a.p.priority || 0) !== (b.p.priority || 0)) continue;
    let overlap = false; try { overlap = aabbOverlap(nodeWorldAABB(scene, a.n.id, project.geoCtx), nodeWorldAABB(scene, b.n.id, project.geoCtx)); } catch { /* no box */ }
    if (overlap) add('audio-zone-tie', 'info', `Audio zones "${a.n.name}" and "${b.n.name}" overlap with the same priority; where they overlap the smaller one wins. Give one a higher priority to make it explicit.`, [a.n.id, b.n.id]);
  }
  for (const [surface, list] of Object.entries(settings.footsteps)) for (const id of list) if (!known(id)) add('audio-missing-asset', 'error', `Footstep sound "${id}" (surface “${surface}”) is not in the project.`, []);
  if (settings.solo) add('audio-solo', 'info', `The “${settings.solo}” bus is soloed, so every other bus is silent in the playtest.`, []);
  const muted = BUS_IDS.filter((b) => settings.mute[b]);
  if (muted.length) add('audio-muted', 'info', `Muted bus${muted.length > 1 ? 'es' : ''}: ${muted.join(', ')}.`, []);
  return out;
}

/** Ids of every sound the project's audio settings use (so bundles keep them and unused-asset reports are right). */
export function audioSettingsAssets(data) {
  const s = audioSettings(data), out = [];
  for (const [surface, list] of Object.entries(s.footsteps)) for (const id of list) out.push([id, `footsteps.${surface}`]);
  return out;
}

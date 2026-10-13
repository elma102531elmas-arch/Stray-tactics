// Keyframe animation clips for the first-person viewmodel.
//
// Clip JSON (what the Animation Studio edits / exports):
// {
//   name, weapon, duration,
//   tracks: {
//     gun:   [{t, p:[x,y,z], r:[x,y,z], e}]   offset from hip pose (camera space m, local deg)
//     lhand: [{t, p, r, e}]                   offset from the weapon's left-hand socket
//     rhand: [{t, p, r, e}]                   offset from the grip socket
//     mag:   [{t, p, r, e}]                   offset from the mag socket (while in the gun)
//     cam:   [{t, r, e}]                      camera rotation offset (deg)
//     model: [{t, p, r, e}]                   weapon model offset around its spin pivot (hands stay):
//                                             karambit finger spins, balisong flips
//     bolt:  [{t, v, e}]  boltRot: [{t, v}]   bolt/slide travel (m), bolt rotation (deg)
//     lgrip: [{t, v}]     rgrip:   [{t, v}]   finger curl 0 (open) .. 1 (pose)
//     hA:    [{t, v}]     hB:      [{t, v}]   balisong handle angles (0 open, 180 closed)
//   },
//   events: [{t, type:'sound'|'magToHand'|'magToGun'|'dropMag'|'newMag'|'ammo'|'kick'|'shell'|'lpose'|'rpose', ...}]
// }
// Interpolation per key `e`: 'smooth' (default, cubic Hermite through neighbours),
// 'linear', 'step', 'in', 'out', 'inout'.

export const VEC_TRACKS = ['gun', 'lhand', 'rhand', 'mag', 'cam', 'model'];
export const SCALAR_TRACKS = ['bolt', 'boltRot', 'lgrip', 'rgrip', 'trigger', 'hA', 'hB'];
export const SCALAR_REST = { bolt: 0, boltRot: 0, lgrip: 1, rgrip: 1, trigger: 0, hA: 0, hB: 0 };
export const EASES = ['smooth', 'linear', 'step', 'in', 'out', 'inout'];
export const EVENT_TYPES = ['sound', 'kick', 'magToHand', 'magToGun', 'dropMag', 'newMag', 'ammo', 'ammo1', 'shell', 'lpose', 'rpose', 'shellShow', 'shellHide'];

export function makePose() {
  const v = () => ({ p: [0, 0, 0], r: [0, 0, 0] });
  return { gun: v(), lhand: v(), rhand: v(), mag: v(), cam: v(), model: v(), bolt: 0, boltRot: 0, lgrip: 1, rgrip: 1, trigger: 0, hA: 0, hB: 0 };
}
export function copyPose(src, dst) {
  for (const k of VEC_TRACKS) { for (let i = 0; i < 3; i++) { dst[k].p[i] = src[k].p[i]; dst[k].r[i] = src[k].r[i]; } }
  for (const k of SCALAR_TRACKS) dst[k] = src[k];
  return dst;
}
// wrap rotation channels into (-180, 180] so blends never spin the long way
export function wrapPose(p) {
  for (const k of VEC_TRACKS) for (let i = 0; i < 3; i++) { let a = p[k].r[i] % 360; if (a > 180) a -= 360; else if (a <= -180) a += 360; p[k].r[i] = a; }
  return p;
}
export function lerpPose(a, b, w, out) {
  for (const k of VEC_TRACKS) for (let i = 0; i < 3; i++) {
    out[k].p[i] = a[k].p[i] + (b[k].p[i] - a[k].p[i]) * w;
    out[k].r[i] = a[k].r[i] + (b[k].r[i] - a[k].r[i]) * w;
  }
  for (const k of SCALAR_TRACKS) out[k] = a[k] + (b[k] - a[k]) * w;
  return out;
}

function ease(e, u) {
  switch (e) {
    case 'linear': return u;
    case 'step': return 0;
    case 'in': return u * u * u;
    case 'out': { const v = 1 - u; return 1 - v * v * v; }
    case 'inout': return u * u * (3 - 2 * u);
    default: return u;
  }
}

// value accessor for a key: channel 'p' | 'r' | 'v', component i
const getv = (k, ch, i, def) => {
  if (ch === 'v') return k.v ?? def;
  const a = k[ch]; return a ? a[i] : def;
};

// sample one channel component of a track at time t
function sampleChannel(keys, t, ch, i, def) {
  const n = keys.length;
  if (!n) return def;
  if (t <= keys[0].t) return getv(keys[0], ch, i, def);
  if (t >= keys[n - 1].t) return getv(keys[n - 1], ch, i, def);
  let j = 0;
  while (j < n - 2 && keys[j + 1].t < t) j++;
  const k0 = keys[j], k1 = keys[j + 1];
  const t0 = k0.t, t1 = k1.t, dtk = Math.max(1e-6, t1 - t0);
  const u = (t - t0) / dtk;
  const v0 = getv(k0, ch, i, def), v1 = getv(k1, ch, i, def);
  const e = k0.e || 'smooth';
  if (e !== 'smooth') return v0 + (v1 - v0) * ease(e, u);
  // cubic Hermite with time-aware Catmull-Rom tangents; zero slope at ends
  const km = keys[j - 1], kp = keys[j + 2];
  let m0 = 0, m1 = 0;
  if (km) m0 = ((v1 - getv(km, ch, i, def)) / Math.max(1e-6, t1 - km.t)) * dtk;
  if (kp) m1 = ((getv(kp, ch, i, def) - v0) / Math.max(1e-6, kp.t - t0)) * dtk;
  // flatten tangent at local extrema to avoid overshoot on holds
  if (km && (v0 - getv(km, ch, i, def)) * (v1 - v0) <= 0) m0 = 0;
  if (kp && (v1 - v0) * (getv(kp, ch, i, def) - v1) <= 0) m1 = 0;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * m1;
}

export function sampleClip(clip, t, out) {
  const tr = clip.tracks || {};
  for (const k of VEC_TRACKS) {
    const keys = tr[k];
    for (let i = 0; i < 3; i++) {
      out[k].p[i] = keys && keys.length ? sampleChannel(keys, t, 'p', i, 0) : 0;
      out[k].r[i] = keys && keys.length ? sampleChannel(keys, t, 'r', i, 0) : 0;
    }
  }
  for (const k of SCALAR_TRACKS) {
    const keys = tr[k];
    out[k] = keys && keys.length ? sampleChannel(keys, t, 'v', 0, SCALAR_REST[k]) : SCALAR_REST[k];
  }
  return out;
}

export function sortClip(clip) {
  for (const k in clip.tracks) clip.tracks[k].sort((a, b) => a.t - b.t);
  if (clip.events) clip.events.sort((a, b) => a.t - b.t);
  return clip;
}

// Plays clips with event dispatch and short cross-fades between poses.
export class ClipPlayer {
  constructor() {
    this.clip = null; this.t = 0; this.speed = 1;
    this.pose = makePose(); this._tmp = makePose(); this._from = makePose();
    this.blendT = 0; this.blendDur = 0;
    this.onEvent = null; this.onEnd = null;
  }
  get playing() { return !!this.clip; }
  get name() { return this.clip ? this.clip.name : null; }
  play(clip, opts = {}) {
    copyPose(this.pose, this._from); wrapPose(this._from);
    this.blendDur = opts.blend ?? 0.1; this.blendT = 0;
    this.clip = clip; this.t = opts.startAt || 0; this.speed = opts.speed || 1;
    const evs = clip.events || [];
    this._ev = 0; while (this._ev < evs.length && evs[this._ev].t < this.t) this._ev++;
    this.endCb = opts.onEnd || null;
  }
  stop(blend = 0.12) {
    copyPose(this.pose, this._from); wrapPose(this._from);
    this.blendDur = blend; this.blendT = 0;
    this.clip = null;
  }
  seek(t) {
    this.t = t;
    const evs = (this.clip && this.clip.events) || [];
    this._ev = 0; while (this._ev < evs.length && evs[this._ev].t <= t) this._ev++;
  }
  update(dt) {
    if (this.blendDur > 0) this.blendT += dt;
    if (!this.clip) return;
    this.t += dt * this.speed;
    const clip = this.clip, evs = clip.events || [];
    while (this.clip === clip && this._ev < evs.length && evs[this._ev].t <= this.t) { const e = evs[this._ev++]; this.onEvent && this.onEvent(e, clip); }
    if (this.clip !== clip) return; // an event handler switched clips
    if (this.t >= this.clip.duration) {
      const c = this.clip;
      this.t = c.duration;
      sampleClip(c, c.duration, this.pose);
      copyPose(this.pose, this._from); wrapPose(this._from);
      this.clip = null; this.blendDur = 0.08; this.blendT = 0;
      const cb = this.endCb; this.endCb = null;
      cb && cb(c);
      this.onEnd && this.onEnd(c);
    }
  }
  sample() {
    const target = this._tmp;
    if (this.clip) sampleClip(this.clip, this.t, target);
    else copyPose(REST, target);
    if (this.blendDur > 0 && this.blendT < this.blendDur) {
      let w = this.blendT / this.blendDur; w = w * w * (3 - 2 * w);
      lerpPose(this._from, target, w, this.pose);
    } else copyPose(target, this.pose);
    return this.pose;
  }
}
const REST = makePose();

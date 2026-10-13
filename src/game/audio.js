// Procedural audio: every sound is synthesized into an AudioBuffer at start
// (gunshots, mechanical reload clicks, footsteps, impacts, UI). Played through
// a master bus with a generated convolution reverb send. 3D sounds use simple
// distance attenuation + stereo pan + distance low-pass (cheap on mobile).
import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { decodeSfx, sfxNames } from '../assets/loader.js';

const SR = 44100;

// ---------------------------------------------------------------- DSP utils
function buf(len) { return new Float32Array(Math.max(1, Math.floor(len * SR))); }
let seed = 1234567;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; }
function noise(a) { for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; }
function biquad(a, type, f, q = 0.707, gainDb = 0) {
  const w = 2 * Math.PI * f / SR, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; } // peak
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i]; const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; a[i] = y; }
  return a;
}
function env(a, attack, decay, curve = 1) {
  const at = attack * SR;
  for (let i = 0; i < a.length; i++) {
    const t = i / SR;
    const e = i < at ? i / at : Math.exp(-(t - attack) / decay);
    a[i] *= curve === 1 ? e : Math.pow(e, curve);
  }
  return a;
}
function mix(out, src, gain = 1, offset = 0) { const o = Math.floor(offset * SR); for (let i = 0; i < src.length && i + o < out.length; i++) out[i + o] += src[i] * gain; return out; }
function sine(len, f0, f1, decay, phase = 0) {
  const a = buf(len); let ph = phase;
  for (let i = 0; i < a.length; i++) { const t = i / a.length; const f = f0 + (f1 - f0) * Math.pow(t, 0.5); ph += 2 * Math.PI * f / SR; a[i] = Math.sin(ph) * Math.exp(-i / SR / decay); }
  return a;
}
// metallic ring: sum of inharmonic damped partials
function ring(len, f, decay, partials = [1, 2.76, 5.4, 8.93], amps = [1, 0.5, 0.25, 0.12]) {
  const a = buf(len);
  partials.forEach((p, k) => { const s = sine(len, f * p, f * p, decay / (1 + k * 0.6), rnd() * 3); mix(a, s, amps[k] || 0.1); });
  return a;
}
function click(len, f, decay, gain = 1) { const a = noise(buf(len)); biquad(a, 'bp', f, 3); env(a, 0.0005, decay); return mix(a, ring(len, f * 0.9, decay * 2), 0.6).map((v) => v * gain); }
function softclip(a, drive = 1.5) { for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * drive) / Math.tanh(drive); return a; }
function normalize(a, peak = 0.95) { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m; return a; }

// ---------------------------------------------------------------- recipes
function gunshot(kind) {
  const P = {
    rifle: { len: 0.55, crack: 1.0, crackHp: 2500, bodyF: 700, bodyQ: 0.8, bodyDecay: 0.07, thump: [140, 42], thumpDecay: 0.09, tail: 0.35, tailLp: 1800 },
    pistol: { len: 0.4, crack: 1.1, crackHp: 3000, bodyF: 1100, bodyQ: 0.9, bodyDecay: 0.045, thump: [190, 70], thumpDecay: 0.06, tail: 0.22, tailLp: 2400 },
    sniper: { len: 1.1, crack: 1.25, crackHp: 1800, bodyF: 520, bodyQ: 0.7, bodyDecay: 0.12, thump: [100, 30], thumpDecay: 0.16, tail: 0.7, tailLp: 1200 },
    m4: { len: 0.5, crack: 1.15, crackHp: 3200, bodyF: 900, bodyQ: 0.9, bodyDecay: 0.055, thump: [160, 50], thumpDecay: 0.07, tail: 0.3, tailLp: 2200 },
    smg: { len: 0.35, crack: 1.0, crackHp: 2800, bodyF: 1000, bodyQ: 1.0, bodyDecay: 0.04, thump: [170, 60], thumpDecay: 0.05, tail: 0.2, tailLp: 2000 },
    shotgun: { len: 0.9, crack: 1.3, crackHp: 1500, bodyF: 420, bodyQ: 0.6, bodyDecay: 0.11, thump: [90, 28], thumpDecay: 0.14, tail: 0.6, tailLp: 1100 },
    deagle: { len: 0.7, crack: 1.25, crackHp: 2200, bodyF: 640, bodyQ: 0.7, bodyDecay: 0.09, thump: [120, 36], thumpDecay: 0.12, tail: 0.45, tailLp: 1500 },
    distant: { len: 1.2, crack: 0.2, crackHp: 1200, bodyF: 380, bodyQ: 0.6, bodyDecay: 0.18, thump: [80, 30], thumpDecay: 0.25, tail: 0.9, tailLp: 700 },
  }[kind === 'ak' ? 'rifle' : kind];
  const out = buf(P.len);
  const cr = noise(buf(0.03)); biquad(cr, 'hp', P.crackHp, 0.7); env(cr, 0.0003, 0.006); mix(out, cr, P.crack);
  const body = noise(buf(P.len)); biquad(body, 'bp', P.bodyF, P.bodyQ); biquad(body, 'lp', 4000); env(body, 0.001, P.bodyDecay); mix(out, body, 2.2);
  const th = sine(P.len, P.thump[0], P.thump[1], P.thumpDecay); mix(out, th, 1.3);
  const tail = noise(buf(P.len)); biquad(tail, 'lp', P.tailLp); env(tail, 0.01, P.tail * 0.45); mix(out, tail, 0.35);
  softclip(out, 2.2);
  return normalize(out);
}
function mech(name) {
  const out = buf(0.35);
  switch (name) {
    case 'magOut': { const s = noise(buf(0.09)); biquad(s, 'bp', 2600, 1.2); env(s, 0.02, 0.03); mix(out, s, 0.5); mix(out, click(0.08, 2200, 0.012), 1, 0.07); break; }
    case 'magIn': { mix(out, click(0.1, 1500, 0.018), 1); mix(out, click(0.1, 2900, 0.01), 0.8, 0.04); const s = noise(buf(0.05)); biquad(s, 'bp', 1800, 1); env(s, 0.005, 0.015); mix(out, s, 0.4); break; }
    case 'magRelease': mix(out, click(0.05, 3400, 0.006), 0.7); break;
    case 'boltBack': case 'slideBack': { const s = noise(buf(0.12)); biquad(s, 'bp', 3000, 1.4); env(s, 0.03, 0.03); mix(out, s, 0.6); mix(out, click(0.08, 2600, 0.01), 0.9, 0.09); break; }
    case 'boltForward': case 'slideForward': case 'slideRelease': { mix(out, click(0.15, 1900, 0.03), 1.2); mix(out, click(0.08, 3800, 0.012), 0.6, 0.004); break; }
    case 'boltUp': mix(out, click(0.06, 2400, 0.008), 0.8); break;
    case 'pumpBack': { const s = noise(buf(0.14)); biquad(s, 'bp', 2200, 1.2); env(s, 0.02, 0.04); mix(out, s, 0.6); mix(out, click(0.1, 1500, 0.02), 1, 0.1); break; }
    case 'pumpForward': { mix(out, click(0.15, 1300, 0.035), 1.2); mix(out, click(0.08, 3000, 0.012), 0.6, 0.006); break; }
    case 'shellInsert': { mix(out, click(0.08, 2600, 0.012), 0.8); const s = noise(buf(0.06)); biquad(s, 'bp', 1800, 1); env(s, 0.003, 0.02); mix(out, s, 0.4, 0.02); break; }
    case 'balisong': { for (let i = 0; i < 3; i++) mix(out, click(0.05, 3600 + i * 400, 0.006), 0.7, i * 0.07); break; }
    case 'knifeHit': { const s = noise(buf(0.15)); biquad(s, 'lp', 1200); env(s, 0.001, 0.04); mix(out, s, 1); mix(out, sine(0.12, 180, 70, 0.05), 0.6); break; }
    case 'knifeWall': { mix(out, ring(0.25, 2400, 0.06), 0.7); mix(out, click(0.04, 4200, 0.004), 0.8); break; }
    case 'boltDown': mix(out, click(0.08, 1700, 0.014), 0.9); break;
    case 'dry': mix(out, click(0.05, 3200, 0.006), 0.8); break;
    case 'pouch': case 'gear': case 'draw': {
      const s = noise(buf(0.25)); biquad(s, 'lp', name === 'pouch' ? 1200 : 2000); biquad(s, 'hp', 300);
      for (let i = 0; i < s.length; i++) s[i] *= 0.5 + 0.5 * Math.sin(i / SR * 40 + Math.sin(i / SR * 13) * 3);
      env(s, 0.03, 0.08); mix(out, s, 0.5);
      if (name !== 'pouch') mix(out, click(0.05, 2800, 0.006), 0.35, 0.05);
      break;
    }
    case 'knifeDraw': {
      const s = noise(buf(0.3)); biquad(s, 'hp', 3000); env(s, 0.02, 0.08);
      const r = buf(0.3); let ph = 0; for (let i = 0; i < r.length; i++) { const f = 3000 + 3000 * i / r.length; ph += 2 * Math.PI * f / SR; r[i] = Math.sin(ph) * Math.exp(-i / SR / 0.1); }
      mix(out, s, 0.5); mix(out, r, 0.25); break;
    }
    case 'swing': case 'knifeFlip': {
      const s = noise(buf(0.3)); const f0 = name === 'swing' ? 500 : 900;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < s.length; i++) {
        const t = i / s.length; const f = f0 + 1800 * Math.sin(t * Math.PI);
        const w = 2 * Math.PI * f / SR, al = Math.sin(w) / 2, cw = Math.cos(w);
        const b0 = al / (1 + al), a1 = -2 * cw / (1 + al), a2 = (1 - al) / (1 + al);
        const y = b0 * s[i] - b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = s[i]; y2 = y1; y1 = y; s[i] = y * Math.sin(t * Math.PI);
      }
      mix(out, s, name === 'swing' ? 1.4 : 0.8); break;
    }
    default: break;
  }
  return normalize(out, 0.8);
}
function impact(kind) {
  const out = buf(0.3);
  if (kind === 'metal') { mix(out, ring(0.3, 1800 + rnd() * 400, 0.08), 0.8); mix(out, click(0.03, 4000, 0.004), 0.8); }
  else if (kind === 'wood') { mix(out, click(0.12, 700, 0.03), 1); const s = noise(buf(0.08)); biquad(s, 'bp', 1200, 1); env(s, 0.001, 0.02); mix(out, s, 0.6); }
  else if (kind === 'flesh') { const s = noise(buf(0.12)); biquad(s, 'lp', 900); env(s, 0.001, 0.03); mix(out, s, 1); mix(out, sine(0.12, 160, 60, 0.04), 0.7); }
  else if (kind === 'sand') { const s = noise(buf(0.2)); biquad(s, 'lp', 2500); env(s, 0.002, 0.05); mix(out, s, 0.7); }
  else { const s = noise(buf(0.15)); biquad(s, 'hp', 1200); env(s, 0.0005, 0.012); mix(out, s, 1); const d = noise(buf(0.25)); biquad(d, 'bp', 2600, 0.8); env(d, 0.01, 0.06); mix(out, d, 0.3, 0.02); }
  return normalize(out, 0.8);
}
function ui(name) {
  const out = buf(0.6);
  switch (name) {
    case 'hit': mix(out, click(0.04, 2400, 0.004), 0.7); break;
    case 'headshot': mix(out, ring(0.25, 2600, 0.06, [1, 1.51, 2.3], [1, 0.6, 0.3]), 0.9); mix(out, click(0.03, 5000, 0.003), 0.5); break;
    case 'kill': mix(out, sine(0.15, 880, 880, 0.06), 0.4); mix(out, sine(0.25, 1320, 1320, 0.08), 0.4, 0.07); break;
    case 'hurt': { mix(out, sine(0.2, 120, 50, 0.06), 1); const s = noise(buf(0.1)); biquad(s, 'lp', 600); env(s, 0.001, 0.03); mix(out, s, 0.6); break; }
    case 'step': { const s = noise(buf(0.12)); biquad(s, 'lp', 1500 + rnd() * 500); env(s, 0.003, 0.025); mix(out, s, 0.8); mix(out, sine(0.08, 90, 50, 0.02), 0.5); const g = noise(buf(0.06)); biquad(g, 'hp', 3000); env(g, 0.002, 0.012); mix(out, g, 0.25, 0.01); break; }
    case 'land': { mix(out, sine(0.2, 80, 40, 0.06), 1); const s = noise(buf(0.18)); biquad(s, 'lp', 1100); env(s, 0.002, 0.04); mix(out, s, 0.8); break; }
    case 'shell': { mix(out, ring(0.25, 5200 + rnd() * 600, 0.05, [1, 1.7, 2.9]), 0.5); mix(out, ring(0.2, 5600, 0.03, [1, 1.7]), 0.3, 0.12); break; }
    case 'magDrop': { mix(out, click(0.15, 900, 0.03), 0.9); mix(out, click(0.1, 1300, 0.02), 0.5, 0.09); break; }
    case 'uiClick': mix(out, click(0.03, 3000, 0.003), 0.5); break;
    case 'uiHover': mix(out, sine(0.05, 2200, 2200, 0.01), 0.15); break;
    case 'go': mix(out, sine(0.15, 660, 660, 0.06), 0.5); mix(out, sine(0.3, 990, 990, 0.1), 0.5, 0.18); break;
    case 'death': { mix(out, sine(0.5, 140, 40, 0.15), 0.8); const s = noise(buf(0.4)); biquad(s, 'lp', 500); env(s, 0.01, 0.1); mix(out, s, 0.6); break; }
    default: break;
  }
  return normalize(out, 0.8);
}

// ---------------------------------------------------------------- engine
class AudioEngine {
  constructor() { this.ctx = null; this.buffers = new Map(); this.listener = { pos: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0), fwd: new THREE.Vector3(0, 0, -1) }; this.voices = 0; }
  // must be called from a user gesture
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = settings.volume;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.15;
    this.master.connect(comp); comp.connect(c.destination);
    this.reverb = c.createConvolver(); this.reverb.buffer = this._ir(1.6);
    this.revGain = c.createGain(); this.revGain.gain.value = 0.55;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this._build();
  }
  setVolume(v) { if (this.master) this.master.gain.value = v; }
  _ir(len) {
    const c = this.ctx, n = Math.floor(len * c.sampleRate), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) { const t = i / c.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2) * Math.exp(-t * 2.2) * (t < 0.008 ? t / 0.008 : 1); }
      // a few early reflections (walls)
      for (let k = 0; k < 6; k++) { const at = Math.floor((0.012 + Math.random() * 0.07) * c.sampleRate); d[at] += (Math.random() * 0.6 + 0.3) * (Math.random() < 0.5 ? -1 : 1); }
    }
    return b;
  }
  _add(name, data) {
    const b = this.ctx.createBuffer(1, data.length, SR); b.copyToChannel(data, 0); this.buffers.set(name, b);
  }
  _build() {
    for (const k of ['ak', 'm4', 'smg', 'shotgun', 'sniper', 'pistol', 'deagle', 'distant']) this._add('shot_' + k, gunshot(k));
    for (const k of ['magOut', 'magIn', 'magRelease', 'boltBack', 'boltForward', 'slideBack', 'slideForward', 'slideRelease', 'boltUp', 'boltDown', 'dry', 'pouch', 'gear', 'draw', 'knifeDraw', 'swing', 'knifeFlip',
      'pumpBack', 'pumpForward', 'shellInsert', 'balisong', 'knifeHit', 'knifeWall']) this._add(k, mech(k));
    for (const k of ['stone', 'metal', 'wood', 'flesh', 'sand']) this._add('impact_' + k, impact(k));
    for (const k of ['hit', 'headshot', 'kill', 'hurt', 'step', 'land', 'shell', 'magDrop', 'uiClick', 'uiHover', 'go', 'death']) this._add(k, ui(k));
    for (let i = 0; i < 3; i++) this._add('step' + i, ui('step'));
    this._loadRecorded();
  }
  // recorded CC0 sounds (assets/sfx) replace the synthesized ones as they decode
  async _loadRecorded() {
    if (!sfxNames().length) return;
    try {
      const bufs = await decodeSfx(this.ctx);
      for (const [k, b] of Object.entries(bufs)) this.buffers.set(k, b);
      this.recorded = new Set(Object.keys(bufs));
    } catch (e) { console.warn('sfx', e); }
  }
  has(name) { return this.buffers.has(name); }
  // first existing name of a list (weapon specific -> generic fallbacks)
  pick(...names) { for (const n of names) if (n && this.buffers.has(n)) return n; return names[names.length - 1]; }
  setListener(camera) {
    this.listener.pos.copy(camera.position);
    this.listener.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.listener.fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  }
  // opts: {vol, pos (Vector3 world, optional => 2D), rate, reverb, lp, occluded}
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const b = this.buffers.get(name); if (!b) return;
    if (this.voices > 40) return;
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = b;
    src.playbackRate.value = (opts.rate || 1) * (opts.pitchVar ? 1 + (Math.random() - 0.5) * opts.pitchVar : 1);
    const g = c.createGain();
    let vol = opts.vol ?? 1, pan = 0, lp = opts.lp || 20000, rev = opts.reverb ?? 0.15;
    if (opts.pos) {
      const d = this.listener.pos.distanceTo(opts.pos);
      const rel = opts.pos.clone().sub(this.listener.pos).normalize();
      pan = Math.max(-1, Math.min(1, rel.dot(this.listener.right))) * 0.8;
      vol *= 1 / (1 + d * d * 0.0012 + d * 0.03);
      lp = Math.min(lp, 18000 / (1 + d * 0.06));
      if (opts.occluded) { vol *= 0.55; lp = Math.min(lp, 1400); }
      rev = Math.min(0.9, rev + d * 0.012);
    }
    if (vol < 0.003) return;
    g.gain.value = vol;
    let node = src;
    if (lp < 19000) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
    node.connect(g);
    let out = g;
    if (c.createStereoPanner && pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(this.master);
    if (rev > 0) { const rg = c.createGain(); rg.gain.value = rev; out.connect(rg); rg.connect(this.reverb); }
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start();
  }
}

export const audio = new AudioEngine();

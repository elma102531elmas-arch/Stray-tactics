// Fully synthesized sound: every effect is generated into AudioBuffers at load, then played through
// HRTF panners, a convolution reverb sized to the current space, and a master "hurt" muffle filter.
import { CFG } from '../settings.js';

const TAU = Math.PI * 2;

// ---------- tiny DSP toolkit ----------
function biq(type, f, Q, sr, gain = 0) {
  const w = TAU * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w), sn = Math.sin(w), a = sn / (2 * Q), A = Math.pow(10, gain / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lp': b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; break;
    case 'hp': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; break;
    case 'bp': b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; break;
    case 'peak': b0 = 1 + a * A; b1 = -2 * cs; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * cs; a2 = 1 - a / A; break;
    default: b0 = 1; b1 = b2 = a1 = a2 = 0; a0 = 1;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function filt(x, c) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const [b0, b1, b2, a1, a2] = c;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}
// time-varying filter: fn(i) returns [type,f,Q]
function sweep(x, sr, fn, every = 32) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c = null;
  for (let i = 0; i < x.length; i++) {
    if (i % every === 0) { const [t, f, q] = fn(i / sr); c = biq(t, f, q, sr); }
    const xi = x[i];
    const y = c[0] * xi + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}
const rnd = () => Math.random() * 2 - 1;
function noise(n) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = rnd(); return a; }
function brown(n) { const a = new Float32Array(n); let v = 0; for (let i = 0; i < n; i++) { v = (v + rnd() * 0.02) * 0.998; a[i] = v * 8; } return a; }
function env(n, sr, att, dec, curve = 1) {
  const a = new Float32Array(n), na = Math.max(1, att * sr);
  for (let i = 0; i < n; i++) { const t = i / sr; a[i] = i < na ? i / na : Math.exp(-(t - att) / Math.max(1e-4, dec)) ** curve; }
  return a;
}
function mul(x, e) { for (let i = 0; i < x.length; i++) x[i] *= e[i]; return x; }
function add(dst, src, g = 1, off = 0) { for (let i = 0; i < src.length && i + off < dst.length; i++) dst[i + off] += src[i] * g; return dst; }
function norm(x, peak = 0.9) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m; return x; }
function sat(x, k = 2) { const t = Math.tanh(k); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * k) / t; return x; }
function sine(n, sr, f0, f1 = f0, curve = 1) {
  const a = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / n; const f = f0 + (f1 - f0) * Math.pow(t, curve); ph += f / sr; a[i] = Math.sin(ph * TAU); }
  return a;
}
// glottal pulse train with jitter: base frequency curve fn(t)
function voice(n, sr, fFn, breath = 0.2, jitter = 0.03) {
  const a = new Float32Array(n); let ph = 0, j = 0;
  for (let i = 0; i < n; i++) {
    if (i % 200 === 0) j = rnd() * jitter;
    const f = fFn(i / sr) * (1 + j);
    ph += f / sr; if (ph > 1) ph -= 1;
    const g = ph < 0.65 ? Math.sin(Math.PI * ph / 0.65) ** 2 : 0;
    a[i] = (g - 0.35) + rnd() * breath;
  }
  return a;
}
const VOWELS = { a: [730, 1090, 2440], o: [570, 840, 2410], u: [300, 870, 2240], e: [530, 1840, 2480], i: [270, 2290, 3010], uh: [520, 1190, 2390] };
function formant(src, sr, vowel, scale = 1, q = 8) {
  const out = new Float32Array(src.length);
  const F = VOWELS[vowel];
  const gains = [1, 0.6, 0.3];
  for (let k = 0; k < 3; k++) add(out, filt(Float32Array.from(src), biq('bp', F[k] * scale, q, sr)), gains[k]);
  return out;
}
function formantMorph(src, sr, v0, v1, scale = 1, q = 8) {
  const out = new Float32Array(src.length);
  const A = VOWELS[v0], B = VOWELS[v1];
  const gains = [1, 0.6, 0.3];
  const n = src.length;
  for (let k = 0; k < 3; k++) add(out, sweep(Float32Array.from(src), sr, (t) => ['bp', (A[k] + (B[k] - A[k]) * Math.min(1, t * sr / n)) * scale, q]), gains[k]);
  return out;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.loops = new Set();
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0 };
    this.occlude = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.sr = c.sampleRate;
    this.master = c.createGain();
    this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.003; this.comp.release.value = 0.25;
    this.master.connect(this.muffle); this.muffle.connect(this.comp); this.comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.connect(this.master);
    this.music = c.createGain(); this.music.connect(this.master);
    this.reverb = c.createConvolver();
    this.revGain = c.createGain(); this.revGain.gain.value = 0.9;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this.setVolumes();
    this.setReverb('hall');
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }

  setVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = CFG.volume;
    this.music.gain.value = CFG.music * 0.8;
  }

  setReverb(kind) {
    if (!this.ctx) return;
    const sr = this.sr;
    const P = { hall: [2.6, 0.5, 3500], room: [1.2, 0.45, 5000], basement: [3.4, 0.6, 2400], outdoor: [1.6, 0.25, 2200], chapel: [4.2, 0.55, 3000] }[kind] || [2, 0.4, 3000];
    const [dur, early, lp] = P;
    const n = Math.floor(dur * sr);
    const b = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = noise(n);
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] *= Math.exp(-t * 6.9 / dur) * (i < sr * 0.004 ? i / (sr * 0.004) : 1); }
      // sparse early reflections
      for (let k = 0; k < 14; k++) { const i = Math.floor((0.008 + Math.random() * 0.07) * sr); d[i] += rnd() * early * 6; }
      sweep(d, sr, (t) => ['lp', lp * Math.exp(-t * 0.9) + 300, 0.7], 64);
      b.copyToChannel(d, ch);
    }
    this.reverb.buffer = b;
    this.revKind = kind;
  }

  buf(name, dur, fn, ch = 1) {
    const sr = this.sr, n = Math.max(1, Math.floor(dur * sr));
    const b = this.ctx.createBuffer(ch, n, sr);
    const out = fn(n, sr);
    if (Array.isArray(out)) out.forEach((d, i) => b.copyToChannel(d, i)); else { b.copyToChannel(out, 0); if (ch === 2) b.copyToChannel(out, 1); }
    this.buffers[name] = b;
  }

  // Generate all sounds, yielding between groups so the loading bar stays alive.
  async generate(onProgress) {
    if (!this.ctx) return;
    const groups = this.recipes();
    let i = 0;
    for (const g of groups) {
      try { g(); } catch (e) { console.warn('sound gen failed', e); }
      i++;
      onProgress && onProgress(i / groups.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    this.ready = true;
  }

  recipes() {
    const R = [];
    // ---- footsteps ----
    R.push(() => {
      for (let v = 0; v < 4; v++) {
        this.buf('step_tile_' + v, 0.25, (n, sr) => {
          const o = new Float32Array(n);
          const click = filt(noise(n), biq('hp', 1800 + v * 300, 0.7, sr)); mul(click, env(n, sr, 0.001, 0.012));
          const body = filt(noise(n), biq('bp', 450 + v * 60, 2, sr)); mul(body, env(n, sr, 0.002, 0.03));
          const th = sine(n, sr, 110, 70); mul(th, env(n, sr, 0.002, 0.03));
          add(o, click, 0.8); add(o, body, 0.6); add(o, th, 0.5);
          const grit = filt(noise(n), biq('hp', 3000, 0.5, sr)); mul(grit, env(n, sr, 0.04, 0.05)); add(o, grit, 0.06, Math.floor(0.03 * sr));
          return norm(o, 0.8);
        });
        this.buf('step_concrete_' + v, 0.3, (n, sr) => {
          const o = new Float32Array(n);
          const b = filt(noise(n), biq('bp', 700 + v * 90, 1.2, sr)); mul(b, env(n, sr, 0.002, 0.04));
          const th = sine(n, sr, 95, 55); mul(th, env(n, sr, 0.002, 0.045));
          const sc = filt(noise(n), biq('bp', 2500, 0.8, sr)); mul(sc, env(n, sr, 0.03, 0.06));
          add(o, b, 0.9); add(o, th, 0.6); add(o, sc, 0.15, Math.floor(0.02 * sr));
          return norm(o, 0.8);
        });
        this.buf('step_wood_' + v, 0.35, (n, sr) => {
          const o = new Float32Array(n);
          const ex = noise(n); mul(ex, env(n, sr, 0.001, 0.008));
          const r1 = filt(Float32Array.from(ex), biq('bp', 180 + v * 25, 10, sr));
          const r2 = filt(Float32Array.from(ex), biq('bp', 420 + v * 40, 8, sr));
          add(o, r1, 3); add(o, r2, 1.5); add(o, filt(noise(n), biq('hp', 2000, 0.7, sr)).map((s, i) => s * Math.exp(-i / sr / 0.01)), 0.3);
          if (v % 2 === 0) { const cr = sine(n, sr, 520, 380); mul(cr, env(n, sr, 0.04, 0.08)); add(o, sat(cr, 3), 0.05, Math.floor(0.05 * sr)); }
          return norm(o, 0.8);
        });
        this.buf('step_mud_' + v, 0.4, (n, sr) => {
          const o = noise(n);
          sweep(o, sr, (t) => ['bp', 300 + t * 2500, 2.5]);
          mul(o, env(n, sr, 0.02, 0.09));
          const s = filt(noise(n), biq('lp', 500, 0.7, sr)); mul(s, env(n, sr, 0.005, 0.05));
          add(o, s, 1.2);
          for (let k = 0; k < 3; k++) { const p = sine(Math.floor(0.03 * this.sr), this.sr, 900 + Math.random() * 800, 1600 + Math.random() * 600); mul(p, env(p.length, this.sr, 0.001, 0.008)); add(o, p, 0.15, Math.floor((0.05 + Math.random() * 0.15) * sr)); }
          return norm(o, 0.7);
        });
        this.buf('step_grass_' + v, 0.35, (n, sr) => {
          const o = filt(noise(n), biq('hp', 2500 + v * 200, 0.6, sr));
          const e = env(n, sr, 0.015, 0.07);
          for (let i = 0; i < n; i++) e[i] *= 0.6 + 0.4 * Math.abs(Math.sin(i / sr * 90 + v));
          mul(o, e);
          const th = sine(n, sr, 80, 50); mul(th, env(n, sr, 0.003, 0.03)); add(o, th, 0.4);
          return norm(o, 0.6);
        });
        this.buf('step_water_' + v, 0.5, (n, sr) => {
          const o = noise(n);
          sweep(o, sr, (t) => ['bp', 1200 + Math.sin(t * 60) * 600 + 800, 1.5]);
          const e = env(n, sr, 0.01, 0.12);
          for (let i = 0; i < n; i++) e[i] *= 0.5 + 0.5 * Math.abs(rnd());
          mul(o, e);
          const pl = sine(n, sr, 300, 140); mul(pl, env(n, sr, 0.003, 0.04)); add(o, pl, 0.5);
          return norm(o, 0.7);
        });
        this.buf('step_metal_' + v, 0.4, (n, sr) => {
          const o = new Float32Array(n);
          for (const f of [310, 523, 871, 1290]) { const s = sine(n, sr, f * (1 + v * 0.03)); mul(s, env(n, sr, 0.001, 0.08 + Math.random() * 0.05)); add(o, s, 0.3); }
          const b = filt(noise(n), biq('bp', 900, 1, sr)); mul(b, env(n, sr, 0.001, 0.02)); add(o, b, 0.8);
          return norm(o, 0.7);
        });
      }
    });
    // ---- body ----
    R.push(() => {
      for (const [nm, heavy] of [['breath_in', 0], ['breath_out', 0], ['breath_in_h', 1], ['breath_out_h', 1]]) {
        const out = nm.includes('out');
        this.buf(nm, heavy ? 0.55 : 0.8, (n, sr) => {
          const o = noise(n);
          sweep(o, sr, (t) => ['bp', (out ? 1100 : 1700) - t * (out ? 300 : -200), heavy ? 1.2 : 2]);
          const e = new Float32Array(n);
          for (let i = 0; i < n; i++) { const t = i / n; e[i] = Math.sin(Math.PI * Math.pow(t, out ? 0.6 : 1.4)) ** 2; }
          mul(o, e);
          if (heavy) { const v = voice(n, sr, () => out ? 140 : 180, 1.4, 0.1); mul(v, e); add(o, filt(formant(v, sr, out ? 'uh' : 'a', 1), biq('hp', 300, 0.7, sr)), 0.08); }
          return norm(o, heavy ? 0.6 : 0.35);
        });
      }
      this.buf('heart', 0.6, (n, sr) => {
        const o = new Float32Array(n);
        const a = sine(n, sr, 62, 42); mul(a, env(n, sr, 0.008, 0.07));
        const b = sine(n, sr, 55, 38); mul(b, env(n, sr, 0.008, 0.06));
        add(o, a, 1); add(o, b, 0.7, Math.floor(0.22 * sr));
        return sat(norm(o, 0.9), 1.5);
      });
      for (let v = 0; v < 3; v++) {
        this.buf('hurt_' + v, 0.45, (n, sr) => {
          const f0 = 150 + v * 25;
          const src = voice(n, sr, (t) => f0 * (1.2 - t * 0.8), 0.35, 0.05);
          const o = formantMorph(src, sr, v === 1 ? 'a' : 'uh', 'u', 1, 6);
          mul(o, env(n, sr, 0.015, 0.12));
          return sat(norm(o, 0.9), 2);
        });
      }
      this.buf('death', 1.6, (n, sr) => {
        const src = voice(n, sr, (t) => 170 - t * 70, 0.4, 0.08);
        const o = formantMorph(src, sr, 'a', 'u', 1, 5);
        mul(o, env(n, sr, 0.03, 0.6));
        return sat(norm(o, 0.9), 2.5);
      });
      this.buf('gasp', 0.5, (n, sr) => { const o = noise(n); sweep(o, sr, (t) => ['bp', 1400 + t * 800, 2]); mul(o, env(n, sr, 0.04, 0.12)); return norm(o, 0.5); });
      this.buf('ring', 3.0, (n, sr) => { const o = sine(n, sr, 4100, 3900); const e = env(n, sr, 0.05, 1.2); mul(o, e); return norm(o, 0.12); });
    });
    // ---- weapons ----
    R.push(() => {
      const shot = (nm, boomF, len, crackF, mech) => this.buf(nm, len, (n, sr) => {
        const L = new Float32Array(n), Rr = new Float32Array(n);
        const tr = noise(n); mul(tr, env(n, sr, 0.0002, 0.004));
        const cr = filt(noise(n), biq('bp', crackF, 0.8, sr)); mul(cr, env(n, sr, 0.0005, 0.03));
        const bm = sine(n, sr, boomF * 1.8, boomF * 0.6, 0.4); mul(bm, env(n, sr, 0.001, len * 0.22));
        const bn = filt(noise(n), biq('lp', 500, 0.7, sr)); mul(bn, env(n, sr, 0.002, len * 0.28));
        const tail = filt(noise(n), biq('bp', 1100, 0.6, sr)); mul(tail, env(n, sr, 0.01, len * 0.35));
        for (const [arr, g] of [[tr, 1.2], [cr, 1.0], [bm, 1.4], [bn, 1.3], [tail, 0.35]]) { add(L, arr, g); add(Rr, arr, g * (0.9 + Math.random() * 0.2)); }
        if (mech) { const m = filt(noise(Math.floor(0.03 * sr)), biq('bp', 3200, 3, sr)); mul(m, env(m.length, sr, 0.0005, 0.006)); add(L, m, 0.3, Math.floor(mech * sr)); add(Rr, m, 0.3, Math.floor(mech * sr)); }
        sat(L, 2.2); sat(Rr, 2.2);
        return [norm(L, 0.98), norm(Rr, 0.98)];
      }, 2);
      shot('shot_pistol', 90, 0.9, 2600, 0.06);
      shot('shot_rifle', 60, 1.6, 2000, 0);
      this.buf('dryfire', 0.12, (n, sr) => { const o = filt(noise(n), biq('bp', 3500, 4, sr)); mul(o, env(n, sr, 0.0005, 0.006)); const o2 = filt(noise(n), biq('bp', 1800, 5, sr)); mul(o2, env(n, sr, 0.0005, 0.01)); add(o, o2, 1, Math.floor(0.04 * sr)); return norm(o, 0.5); });
      const clack = (nm, f, dur, parts) => this.buf(nm, dur, (n, sr) => {
        const o = new Float32Array(n);
        for (const [t, g, ff] of parts) { const k = filt(noise(n), biq('bp', ff || f, 4, sr)); mul(k, env(n, sr, 0.0005, 0.012)); add(o, k, g, Math.floor(t * sr)); }
        const s = filt(noise(n), biq('bp', f * 0.6, 1.5, sr)); mul(s, env(n, sr, 0.005, 0.05)); add(o, s, 0.2);
        return norm(o, 0.6);
      });
      clack('mag_out', 2200, 0.25, [[0, 1], [0.05, 0.5, 1400]]);
      clack('mag_in', 1900, 0.25, [[0, 0.6, 2600], [0.03, 1, 1500]]);
      clack('slide', 2400, 0.35, [[0, 0.8], [0.12, 1, 1700], [0.15, 0.5, 3400]]);
      clack('bolt_open', 1700, 0.3, [[0, 0.7, 2500], [0.08, 1, 1200]]);
      clack('bolt_close', 1600, 0.3, [[0, 1, 1300], [0.1, 0.8, 2700]]);
      clack('round_in', 2800, 0.15, [[0, 1, 3000], [0.02, 0.5, 1800]]);
      this.buf('tink', 0.25, (n, sr) => { const o = new Float32Array(n); for (const f of [3200, 5150, 7300, 9100]) { const s = sine(n, sr, f * (0.95 + Math.random() * 0.1)); mul(s, env(n, sr, 0.0005, 0.03 + Math.random() * 0.04)); add(o, s, 0.25); } return norm(o, 0.35); });
      this.buf('swing', 0.35, (n, sr) => { const o = noise(n); sweep(o, sr, (t) => ['bp', 400 + Math.sin(Math.PI * t / 0.35) * 1600, 1.5]); const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = Math.sin(Math.PI * i / n) ** 2; mul(o, e); return norm(o, 0.5); });
      this.buf('flesh', 0.35, (n, sr) => {
        const o = filt(noise(n), biq('lp', 700, 0.8, sr)); mul(o, env(n, sr, 0.001, 0.05));
        const sq = noise(n); sweep(sq, sr, (t) => ['bp', 900 - t * 1500, 4]); mul(sq, env(n, sr, 0.01, 0.08));
        const th = sine(n, sr, 120, 50); mul(th, env(n, sr, 0.001, 0.04));
        add(o, sq, 0.5); add(o, th, 0.8);
        return sat(norm(o, 0.9), 1.5);
      });
      this.buf('crunch', 0.5, (n, sr) => {
        const o = new Float32Array(n);
        for (let k = 0; k < 9; k++) { const c = filt(noise(Math.floor(0.02 * sr)), biq('bp', 800 + Math.random() * 2500, 3, sr)); mul(c, env(c.length, sr, 0.0005, 0.005)); add(o, c, 0.6 + Math.random() * 0.4, Math.floor(Math.random() * 0.2 * sr)); }
        const th = sine(n, sr, 90, 40); mul(th, env(n, sr, 0.001, 0.08)); add(o, th, 1);
        return norm(o, 0.9);
      });
      this.buf('impact_wall', 0.4, (n, sr) => { const o = filt(noise(n), biq('bp', 2200, 1, sr)); mul(o, env(n, sr, 0.0005, 0.015)); const d = filt(noise(n), biq('hp', 3000, 0.6, sr)); mul(d, env(n, sr, 0.01, 0.08)); add(o, d, 0.25, Math.floor(0.01 * sr)); return norm(o, 0.7); });
      this.buf('impact_metal', 0.6, (n, sr) => { const o = new Float32Array(n); for (const f of [1250, 2030, 3480, 4920]) { const s = sine(n, sr, f); mul(s, env(n, sr, 0.0005, 0.12)); add(o, s, 0.3); } const c = filt(noise(n), biq('hp', 2500, 0.7, sr)); mul(c, env(n, sr, 0.0005, 0.008)); add(o, c, 0.8); return norm(o, 0.7); });
      this.buf('impact_wood', 0.3, (n, sr) => { const ex = noise(n); mul(ex, env(n, sr, 0.0005, 0.005)); const o = filt(Float32Array.from(ex), biq('bp', 600, 6, sr)); add(o, filt(ex, biq('bp', 1500, 5, sr)), 0.5); return norm(o, 0.7); });
      this.buf('melee_metal', 0.8, (n, sr) => { const o = new Float32Array(n); for (const f of [620, 1033, 1795, 2610]) { const s = sine(n, sr, f); mul(s, env(n, sr, 0.0005, 0.2)); add(o, s, 0.3); } const c = filt(noise(n), biq('bp', 1500, 1, sr)); mul(c, env(n, sr, 0.0005, 0.02)); add(o, c, 1); return norm(o, 0.85); });
    });
    // ---- world ----
    R.push(() => {
      this.buf('click', 0.08, (n, sr) => { const o = filt(noise(n), biq('bp', 4200, 3, sr)); mul(o, env(n, sr, 0.0003, 0.004)); const o2 = filt(noise(n), biq('bp', 2100, 4, sr)); mul(o2, env(n, sr, 0.0003, 0.006)); add(o, o2, 0.8, Math.floor(0.025 * sr)); return norm(o, 0.45); });
      const creak = (nm, dur, f0, f1, rough) => this.buf(nm, dur, (n, sr) => {
        const o = new Float32Array(n); let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const stick = Math.sin(i / sr * (25 + 15 * Math.sin(t * 7))) > 0.2 ? 1 : 0.3;
          const f = f0 + (f1 - f0) * t + Math.sin(i / sr * 13) * 15;
          ph += f / sr;
          o[i] = ((ph % 1) * 2 - 1) * stick * Math.sin(Math.PI * t) + rnd() * rough;
        }
        add(o, filt(Float32Array.from(o), biq('bp', 900, 6, sr)), 1.5);
        filt(o, biq('bp', 1300, 1.2, sr));
        return norm(o, 0.6);
      });
      creak('door_open', 1.1, 260, 150, 0.2);
      creak('door_creak2', 1.6, 180, 320, 0.3);
      creak('creak_far', 1.4, 140, 110, 0.15);
      this.buf('door_close', 0.6, (n, sr) => { const o = sine(n, sr, 85, 50); mul(o, env(n, sr, 0.002, 0.07)); const b = filt(noise(n), biq('lp', 800, 0.7, sr)); mul(b, env(n, sr, 0.002, 0.05)); add(o, b, 0.8); const l = filt(noise(n), biq('bp', 2800, 4, sr)); mul(l, env(n, sr, 0.0005, 0.01)); add(o, l, 0.6, Math.floor(0.03 * sr)); return norm(o, 0.85); });
      this.buf('door_slam', 1.0, (n, sr) => { const o = sine(n, sr, 75, 40); mul(o, env(n, sr, 0.001, 0.12)); const b = filt(noise(n), biq('lp', 1200, 0.7, sr)); mul(b, env(n, sr, 0.001, 0.1)); add(o, b, 1.2); for (let k = 0; k < 5; k++) { const r = filt(noise(n), biq('bp', 2000 + k * 300, 5, sr)); mul(r, env(n, sr, 0.0005, 0.01)); add(o, r, 0.3, Math.floor((0.08 + k * 0.05) * sr)); } return sat(norm(o, 0.95), 1.8); });
      this.buf('door_locked', 0.7, (n, sr) => { const o = new Float32Array(n); for (let k = 0; k < 4; k++) { const r = filt(noise(n), biq('bp', 1500 + (k % 2) * 900, 5, sr)); mul(r, env(n, sr, 0.0005, 0.02)); add(o, r, 0.8, Math.floor((0.02 + k * 0.12 + Math.random() * 0.03) * sr)); } const th = sine(n, sr, 110, 80); mul(th, env(n, sr, 0.001, 0.03)); add(o, th, 0.4, Math.floor(0.14 * sr)); return norm(o, 0.7); });
      this.buf('locker', 0.8, (n, sr) => { const o = new Float32Array(n); for (const f of [410, 690, 1130, 1680]) { const s = sine(n, sr, f); mul(s, env(n, sr, 0.001, 0.15)); add(o, s, 0.25); } const b = filt(noise(n), biq('bp', 700, 1.5, sr)); mul(b, env(n, sr, 0.001, 0.03)); add(o, b, 1); const sq = sine(n, sr, 900, 1300); mul(sq, env(n, sr, 0.05, 0.1)); add(o, sat(sq, 4), 0.05); return norm(o, 0.75); });
      this.buf('pickup', 0.4, (n, sr) => { const o = filt(noise(n), biq('bp', 2500, 1, sr)); const e = env(n, sr, 0.02, 0.08); for (let i = 0; i < n; i++) e[i] *= 0.6 + 0.4 * Math.sin(i / sr * 70); mul(o, e); const c = filt(noise(n), biq('bp', 3500, 4, sr)); mul(c, env(n, sr, 0.0005, 0.006)); add(o, c, 0.6, Math.floor(0.12 * sr)); return norm(o, 0.5); });
      this.buf('paper', 0.6, (n, sr) => { const o = filt(noise(n), biq('hp', 2500, 0.5, sr)); const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = Math.abs(rnd()) > 0.7 ? Math.sin(Math.PI * i / n) : 0.2 * Math.sin(Math.PI * i / n); mul(o, e); return norm(filt(o, biq('lp', 7000, 0.7, sr)), 0.4); });
      this.buf('tape_rip', 0.6, (n, sr) => { const o = filt(noise(n), biq('bp', 1800, 1.2, sr)); const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = (Math.sin(i / sr * 260) > 0 ? 1 : 0.3) * Math.sin(Math.PI * i / n); mul(o, e); return norm(o, 0.55); });
      this.buf('zip', 0.5, (n, sr) => { const o = filt(noise(n), biq('bp', 3000, 2, sr)); const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = (Math.sin(i / sr * (300 + i / n * 400)) > 0.3 ? 1 : 0.1) * Math.sin(Math.PI * i / n); mul(o, e); return norm(o, 0.45); });
      this.buf('pills', 0.5, (n, sr) => { const o = new Float32Array(n); for (let k = 0; k < 14; k++) { const c = filt(noise(Math.floor(0.01 * sr)), biq('bp', 3000 + Math.random() * 3000, 6, sr)); add(o, c, 0.5, Math.floor(Math.random() * 0.35 * sr)); } return norm(o, 0.4); });
      this.buf('battery', 0.4, (n, sr) => { const o = new Float32Array(n); for (const [t, f] of [[0, 2600], [0.12, 1800], [0.25, 3500]]) { const c = filt(noise(n), biq('bp', f, 4, sr)); mul(c, env(n, sr, 0.0005, 0.01)); add(o, c, 1, Math.floor(t * sr)); } return norm(o, 0.5); });
      this.buf('chain_cut', 1.0, (n, sr) => { const o = new Float32Array(n); const s = sine(n, sr, 2600, 2400); mul(s, env(n, sr, 0.0005, 0.08)); add(o, s, 0.5); const c = filt(noise(n), biq('hp', 2000, 0.7, sr)); mul(c, env(n, sr, 0.0005, 0.02)); add(o, c, 1); for (let k = 0; k < 8; k++) { const j = filt(noise(Math.floor(0.03 * sr)), biq('bp', 3000 + Math.random() * 3000, 8, sr)); add(o, j, 0.4, Math.floor((0.15 + Math.random() * 0.6) * sr)); } return norm(o, 0.8); });
      this.buf('gate', 3.0, (n, sr) => { const o = noise(n); sweep(o, sr, (t) => ['bp', 600 + Math.sin(t * 4) * 250, 12]); const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = Math.sin(Math.PI * i / n) * (0.6 + 0.4 * Math.sin(i / sr * 23)); mul(o, e); const b = sine(n, sr, 60, 45); mul(b, env(n, sr, 2.4, 0.2)); add(o, b, 0.3); return norm(sat(o, 3), 0.7); });
      this.buf('drip', 0.25, (n, sr) => { const o = sine(n, sr, 900, 2100, 0.5); mul(o, env(n, sr, 0.0005, 0.03)); return norm(o, 0.35); });
      this.buf('glass', 1.0, (n, sr) => { const o = new Float32Array(n); for (let k = 0; k < 30; k++) { const s = sine(Math.floor(0.15 * sr), sr, 2500 + Math.random() * 6000); mul(s, env(s.length, sr, 0.0005, 0.02 + Math.random() * 0.04)); add(o, s, 0.2, Math.floor(Math.random() * 0.4 * sr)); } const c = filt(noise(n), biq('hp', 3000, 0.7, sr)); mul(c, env(n, sr, 0.0005, 0.05)); add(o, c, 0.7); return norm(o, 0.7); });
      this.buf('static', 1.5, (n, sr) => { const o = filt(noise(n), biq('bp', 2200, 0.6, sr)); for (let i = 0; i < n; i++) o[i] *= 0.5 + 0.5 * (Math.random() < 0.002 ? 3 : 1); return norm(o, 0.35); });
      this.buf('radio_voice', 2.5, (n, sr) => {
        const src = voice(n, sr, (t) => 140 + Math.sin(t * 5) * 20, 0.3, 0.05);
        const vowels = ['a', 'e', 'o', 'i', 'uh'];
        const o = new Float32Array(n);
        const seg = Math.floor(0.12 * sr);
        for (let s = 0; s * seg < n; s++) { const part = src.slice(s * seg, (s + 1) * seg); const f = formant(part, sr, vowels[(Math.random() * 5) | 0], 1, 6); for (let i = 0; i < f.length; i++) f[i] *= Math.sin(Math.PI * i / f.length) * (Math.random() < 0.15 ? 0 : 1); add(o, f, 1, s * seg); }
        filt(o, biq('bp', 1500, 0.8, sr)); add(o, filt(noise(n), biq('bp', 2500, 0.8, sr)), 0.08);
        return sat(norm(o, 0.8), 3);
      });
      this.buf('thunder', 6.0, (n, sr) => { const o = brown(n); filt(o, biq('lp', 180, 0.7, sr)); const e = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / sr; e[i] = (t < 0.08 ? t / 0.08 : Math.exp(-(t - 0.08) / 1.6)) * (0.6 + 0.4 * Math.abs(Math.sin(t * 3.3))); } mul(o, e); const cr = filt(noise(n), biq('bp', 900, 0.7, sr)); mul(cr, env(n, sr, 0.005, 0.25)); add(o, cr, 0.25); return norm(o, 0.95); });
      this.buf('bang_far', 2.0, (n, sr) => { const o = new Float32Array(n); for (const f of [140, 233, 367, 512]) { const s = sine(n, sr, f); mul(s, env(n, sr, 0.001, 0.4)); add(o, s, 0.3); } const b = filt(noise(n), biq('lp', 400, 0.7, sr)); mul(b, env(n, sr, 0.001, 0.15)); add(o, b, 1); filt(o, biq('lp', 900, 0.7, sr)); return norm(o, 0.7); });
      this.buf('whisper', 1.6, (n, sr) => {
        const o = new Float32Array(n); const seg = Math.floor(0.09 * sr);
        for (let s = 0; s * seg < n; s++) { const part = filt(noise(seg), biq('hp', 900, 0.6, sr)); const f = formant(part, sr, ['i', 'e', 'a', 'u', 'o'][(Math.random() * 5) | 0], 1.1, 5); for (let i = 0; i < f.length; i++) f[i] *= Math.sin(Math.PI * i / f.length) * (Math.random() < 0.2 ? 0.1 : 1); add(o, f, 1, s * seg); }
        const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = Math.sin(Math.PI * i / n); mul(o, e);
        return norm(o, 0.5);
      });
      this.buf('rat', 0.6, (n, sr) => { const o = new Float32Array(n); for (let k = 0; k < 4; k++) { const s = sine(Math.floor(0.06 * sr), sr, 3500 + Math.random() * 1500, 5000 + Math.random() * 1500); mul(s, env(s.length, sr, 0.005, 0.02)); add(o, sat(s, 2), 0.5, Math.floor(Math.random() * 0.45 * sr)); } const sc = filt(noise(n), biq('hp', 4000, 0.6, sr)); for (let i = 0; i < n; i++) sc[i] *= Math.random() < 0.05 ? 1 : 0.05; add(o, sc, 0.3); return norm(o, 0.4); });
      this.buf('switch', 0.3, (n, sr) => { const o = filt(noise(n), biq('bp', 1200, 2, sr)); mul(o, env(n, sr, 0.0005, 0.02)); const h = sine(n, sr, 60, 60); mul(h, env(n, sr, 0.05, 0.15)); add(o, h, 0.6, Math.floor(0.03 * sr)); return norm(o, 0.7); });
      this.buf('power_on', 2.5, (n, sr) => { const o = new Float32Array(n); const h = sine(n, sr, 40, 120, 0.5); const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = Math.min(1, i / n * 3) * Math.exp(-Math.max(0, i / sr - 1.5) * 2); mul(h, e); add(o, h, 0.6); const h2 = sine(n, sr, 80, 240, 0.5); mul(h2, e); add(o, sat(h2, 3), 0.25); for (let k = 0; k < 6; k++) { const c = filt(noise(n), biq('bp', 1500, 3, sr)); mul(c, env(n, sr, 0.0005, 0.02)); add(o, c, 0.6, Math.floor((0.3 + k * 0.22) * sr)); } return norm(o, 0.75); });
      this.buf('elevator', 4.0, (n, sr) => { const o = brown(n); filt(o, biq('lp', 220, 0.7, sr)); const h = sine(n, sr, 55, 55); add(o, h, 0.2); const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = Math.min(1, i / sr * 2) * Math.min(1, (n - i) / sr * 2); mul(o, e); return norm(o, 0.7); });
      this.buf('flesh_tear', 0.9, (n, sr) => { const o = noise(n); sweep(o, sr, (t) => ['bp', 400 + Math.random() * 900, 3]); const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = Math.sin(Math.PI * i / n) * (0.5 + 0.5 * Math.abs(rnd())); mul(o, e); const th = sine(n, sr, 70, 40); mul(th, env(n, sr, 0.002, 0.15)); add(o, th, 0.5); return sat(norm(o, 0.85), 2); });
    });
    // ---- creatures ----
    R.push(() => {
      for (let v = 0; v < 3; v++) {
        this.buf('hollow_idle_' + v, 2.0, (n, sr) => {
          const src = voice(n, sr, (t) => 75 + v * 9 + Math.sin(t * 3 + v) * 12, 0.5, 0.12);
          const o = formantMorph(src, sr, ['u', 'o', 'a'][v], ['a', 'uh', 'u'][v], 0.8, 6);
          const e = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / n; e[i] = Math.sin(Math.PI * t) * (0.55 + 0.45 * Math.abs(Math.sin(i / sr * (7 + v * 3)))); }
          mul(o, e);
          const gur = filt(noise(n), biq('bp', 350, 3, sr)); for (let i = 0; i < n; i++) gur[i] *= Math.abs(Math.sin(i / sr * 31)) * e[i]; add(o, gur, 0.25);
          return sat(norm(o, 0.85), 2.5);
        });
      }
      this.buf('hollow_alert', 1.1, (n, sr) => {
        const src = voice(n, sr, (t) => 260 + t * 300 + Math.sin(t * 40) * 25, 0.6, 0.15);
        const o = formantMorph(src, sr, 'a', 'i', 0.95, 4);
        mul(o, env(n, sr, 0.04, 0.45));
        add(o, filt(noise(n), biq('bp', 2500, 1, sr)).map((s, i) => s * Math.exp(-i / sr / 0.4)), 0.25);
        return sat(norm(o, 0.9), 4);
      });
      this.buf('hollow_attack', 0.6, (n, sr) => { const src = voice(n, sr, (t) => 180 - t * 60, 0.7, 0.2); const o = formant(src, sr, 'a', 0.85, 4); mul(o, env(n, sr, 0.01, 0.2)); return sat(norm(o, 0.9), 5); });
      this.buf('hollow_pain', 0.5, (n, sr) => { const src = voice(n, sr, (t) => 300 - t * 200, 0.5, 0.1); const o = formant(src, sr, 'e', 0.9, 5); mul(o, env(n, sr, 0.005, 0.15)); return sat(norm(o, 0.9), 4); });
      this.buf('hollow_death', 1.8, (n, sr) => {
        const src = voice(n, sr, (t) => 120 - t * 60, 0.6, 0.2);
        const o = formantMorph(src, sr, 'a', 'u', 0.85, 5);
        mul(o, env(n, sr, 0.02, 0.5));
        const gur = filt(noise(n), biq('bp', 250, 4, sr)); for (let i = 0; i < n; i++) gur[i] *= (Math.sin(i / sr * 23) > 0.3 ? 1 : 0) * Math.exp(-i / sr / 0.9); add(o, gur, 0.5);
        return sat(norm(o, 0.9), 3);
      });
      this.buf('warden_breath', 3.0, (n, sr) => {
        const o = filt(noise(n), biq('bp', 500, 1.5, sr));
        const e = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / n; e[i] = Math.sin(Math.PI * Math.min(1, t * 2)) ** 2 * (t < 0.5 ? 1 : 0) + Math.sin(Math.PI * Math.max(0, t * 2 - 1)) ** 2 * (t >= 0.5 ? 0.8 : 0); }
        mul(o, e);
        const sub = voice(n, sr, () => 48, 0.8, 0.2); const sf = formant(sub, sr, 'u', 0.6, 4); mul(sf, e); add(o, sf, 0.6);
        return sat(norm(o, 0.8), 2);
      });
      this.buf('warden_scream', 2.6, (n, sr) => {
        const o = new Float32Array(n);
        for (let k = 0; k < 4; k++) {
          const src = voice(n, sr, (t) => (210 + k * 37) * (1.15 - t * 0.45) + Math.sin(t * 50 + k) * 18, 0.7, 0.2);
          add(o, formantMorph(src, sr, 'a', 'u', 0.7 + k * 0.08, 3), 0.6);
        }
        add(o, filt(noise(n), biq('bp', 1800, 0.7, sr)), 0.3);
        mul(o, env(n, sr, 0.06, 0.9));
        return sat(norm(o, 0.95), 6);
      });
      this.buf('warden_step', 0.8, (n, sr) => { const o = sine(n, sr, 60, 32); mul(o, env(n, sr, 0.003, 0.12)); const b = filt(noise(n), biq('lp', 400, 0.7, sr)); mul(b, env(n, sr, 0.002, 0.08)); add(o, b, 0.9); for (let k = 0; k < 3; k++) { const s = sine(Math.floor(0.2 * sr), sr, 1500 + Math.random() * 2000); mul(s, env(s.length, sr, 0.001, 0.05)); add(o, s, 0.06, Math.floor((0.04 + Math.random() * 0.1) * sr)); } return sat(norm(o, 0.95), 1.6); });
      this.buf('warden_drag', 2.0, (n, sr) => { const o = noise(n); sweep(o, sr, (t) => ['bp', 2200 + Math.sin(t * 9) * 600, 6]); const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = Math.sin(Math.PI * i / n) * (0.4 + 0.6 * Math.abs(Math.sin(i / sr * 17))); mul(o, e); return norm(o, 0.4); });
      this.buf('warden_hit', 0.9, (n, sr) => { const src = voice(n, sr, (t) => 120 - t * 30, 0.6, 0.2); const o = formant(src, sr, 'o', 0.65, 4); mul(o, env(n, sr, 0.01, 0.3)); return sat(norm(o, 0.95), 5); });
      this.buf('bare_step', 0.2, (n, sr) => { const o = filt(noise(n), biq('bp', 800, 1.2, sr)); mul(o, env(n, sr, 0.001, 0.025)); const s = filt(noise(n), biq('bp', 2500, 2, sr)); mul(s, env(n, sr, 0.005, 0.02)); add(o, s, 0.4); return norm(o, 0.6); });
    });
    // ---- ambience loops & music ----
    R.push(() => {
      const loop = (nm, dur, fn) => this.buf(nm, dur, (n, sr) => {
        const x = fn(n, sr);
        const fade = Math.floor(0.5 * sr);
        for (let i = 0; i < fade; i++) { const t = i / fade; x[i] = x[i] * t + x[n - fade + i] * (1 - t); }
        return x.slice(0, n - fade);
      });
      loop('amb_indoor', 10, (n, sr) => { const o = brown(n); filt(o, biq('lp', 260, 0.7, sr)); const h = sine(n, sr, 50, 50); add(o, h, 0.05); const h2 = sine(n, sr, 100, 100); add(o, h2, 0.025); const air = filt(noise(n), biq('bp', 600, 0.5, sr)); add(o, air, 0.04); return norm(o, 0.5); });
      loop('amb_basement', 10, (n, sr) => { const o = brown(n); filt(o, biq('lp', 140, 0.7, sr)); const h = sine(n, sr, 38, 38); add(o, h, 0.08); const air = filt(noise(n), biq('bp', 400, 0.5, sr)); add(o, air, 0.03); return norm(o, 0.6); });
      loop('amb_wind', 12, (n, sr) => { const o = noise(n); sweep(o, sr, (t) => ['bp', 350 + 250 * Math.sin(t * 0.6) + 120 * Math.sin(t * 1.7), 0.9], 128); const e = new Float32Array(n); for (let i = 0; i < n; i++) e[i] = 0.55 + 0.45 * Math.sin(i / sr * 0.5) * Math.sin(i / sr * 1.3); mul(o, e); add(o, filt(brown(n), biq('lp', 120, 0.7, sr)), 0.6); return norm(o, 0.55); });
      loop('amb_rain', 8, (n, sr) => { const o = filt(noise(n), biq('hp', 900, 0.5, sr)); filt(o, biq('lp', 7000, 0.5, sr)); for (let k = 0; k < 900; k++) { const d = Math.floor(Math.random() * n); const s = Math.floor(0.004 * sr); for (let i = 0; i < s && d + i < n; i++) o[d + i] += rnd() * Math.exp(-i / (s * 0.25)) * 1.5; } return norm(o, 0.45); });
      loop('buzz', 4, (n, sr) => { const o = new Float32Array(n); for (const [f, g] of [[120, 1], [240, 0.5], [360, 0.35], [480, 0.2], [600, 0.12]]) add(o, sine(n, sr, f, f), g); sat(o, 2); for (let i = 0; i < n; i++) o[i] *= 0.7 + 0.3 * (Math.sin(i / sr * 3.1) > 0.9 ? 0.2 : 1); filt(o, biq('bp', 900, 0.5, sr)); return norm(o, 0.3); });
      loop('generator', 4, (n, sr) => { const o = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { ph += 27 / sr; o[i] = Math.pow(Math.max(0, Math.sin(ph * TAU)), 6) - 0.2; } filt(o, biq('lp', 900, 0.7, sr)); add(o, filt(noise(n), biq('bp', 2200, 1, sr)), 0.08); return norm(sat(o, 2), 0.6); });
      loop('drone', 12, (n, sr) => { const o = new Float32Array(n); for (const f of [55, 58.3, 82.4, 87.3, 110.6]) { const s = sine(n, sr, f, f); add(o, s, 0.25); } const sw = noise(n); sweep(sw, sr, (t) => ['bp', 300 + 200 * Math.sin(t * 0.4), 3], 128); add(o, sw, 0.12); return norm(sat(o, 1.5), 0.55); });
      loop('chase', 8, (n, sr) => {
        const o = new Float32Array(n);
        const beat = 60 / 150;
        for (let k = 0; k * beat * sr < n; k++) {
          const at = Math.floor(k * beat * sr);
          const kick = sine(Math.floor(0.3 * sr), sr, 110, 40); mul(kick, env(kick.length, sr, 0.002, 0.08)); add(o, kick, k % 4 === 0 ? 1 : 0.6, at);
          if (k % 2 === 1) { const t = filt(noise(Math.floor(0.2 * sr)), biq('bp', 180, 2, sr)); mul(t, env(t.length, sr, 0.002, 0.05)); add(o, t, 0.9, at); }
        }
        let ph = 0; const strings = new Float32Array(n);
        for (let i = 0; i < n; i++) { const t = i / sr; const note = [146.8, 155.6, 146.8, 138.6][Math.floor(t / (beat * 2)) % 4]; ph += note / sr; strings[i] = ((ph % 1) * 2 - 1) * (0.6 + 0.4 * Math.sin(t * 45)); }
        filt(strings, biq('lp', 1400, 0.8, sr)); add(o, strings, 0.25);
        return norm(sat(o, 1.6), 0.8);
      });
      this.buf('sting_jump', 2.4, (n, sr) => {
        const o = new Float32Array(n);
        for (let k = 0; k < 9; k++) { let ph = 0; const f = 520 + k * 63 + Math.random() * 20; for (let i = 0; i < n; i++) { ph += f * (1 + Math.sin(i / sr * (6 + k)) * 0.01) / sr; o[i] += ((ph % 1) * 2 - 1) * 0.15; } }
        filt(o, biq('hp', 400, 0.7, sr));
        const e = env(n, sr, 0.01, 0.9); for (let i = 0; i < n; i++) e[i] *= 0.7 + 0.3 * Math.sin(i / sr * 70); mul(o, e);
        const hit = sine(n, sr, 80, 30); mul(hit, env(n, sr, 0.002, 0.4)); add(o, hit, 1.2);
        return sat(norm(o, 0.95), 2);
      });
      this.buf('sting_low', 4.0, (n, sr) => {
        const o = new Float32Array(n);
        for (const f of [41.2, 43.7, 61.7, 65.4, 92.5]) add(o, sine(n, sr, f, f * 0.97), 0.3);
        const sw = noise(n); sweep(sw, sr, (t) => ['bp', 200 + t * 300, 2], 128); add(o, sw, 0.15);
        const e = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / n; e[i] = Math.min(1, t * 4) * (1 - t); } mul(o, e);
        return norm(sat(o, 2), 0.9);
      });
      this.buf('objective', 1.8, (n, sr) => { const o = new Float32Array(n); for (const f of [220, 261.6, 329.6]) { const s = sine(n, sr, f, f); mul(s, env(n, sr, 0.05, 0.6)); add(o, s, 0.3); } const b = sine(n, sr, 55, 55); mul(b, env(n, sr, 0.02, 0.8)); add(o, b, 0.4); return norm(o, 0.4); });
      this.buf('ui', 0.1, (n, sr) => { const o = sine(n, sr, 1400, 900); mul(o, env(n, sr, 0.001, 0.02)); return norm(o, 0.25); });
    });
    return R;
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // play(name, {pos, vol, rate, loop, ref, max, reverb, bus, occl, detune})
  play(name, o = {}) {
    if (!this.ctx || !this.ready || this.ctx.state !== 'running') return null;
    const b = this.buffers[name];
    if (!b) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = b;
    src.loop = !!o.loop;
    src.playbackRate.value = (o.rate ?? 1) * (o.vary ? 1 + (Math.random() - 0.5) * o.vary : 1);
    const g = c.createGain();
    g.gain.value = o.vol ?? 1;
    let node = src;
    let lp = null;
    if (o.pos) {
      lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
      node.connect(lp); node = lp;
      const p = c.createPanner();
      p.panningModel = this.hrtf === false ? 'equalpower' : 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = o.ref ?? 1.5;
      p.maxDistance = o.max ?? 60;
      p.rolloffFactor = o.roll ?? 1.2;
      if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; }
      else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
      node.connect(p); node = p;
      // wall occlusion muffles sounds you cannot see
      if (this.occlude && o.occl !== false && this.occlude(o.pos)) { lp.frequency.value = 900; g.gain.value *= 0.55; }
      var panner = p;
    }
    node.connect(g);
    const bus = o.bus === 'amb' ? this.amb : o.bus === 'music' ? this.music : this.sfx;
    g.connect(bus);
    const rv = o.reverb ?? (o.pos ? 0.35 : 0.15);
    if (rv > 0) { const s = c.createGain(); s.gain.value = rv; g.connect(s); s.connect(this.reverb); }
    src.start(c.currentTime + (o.delay || 0));
    const h = {
      src, gain: g, panner, lp, name,
      stop: (fade = 0.05) => { try { const t = c.currentTime; g.gain.setTargetAtTime(0, t, fade / 3); src.stop(t + fade + 0.05); } catch (e) { /* already stopped */ } this.loops.delete(h); },
      setPos: (v) => { if (panner && panner.positionX) { const t = c.currentTime; panner.positionX.setTargetAtTime(v.x, t, 0.05); panner.positionY.setTargetAtTime(v.y, t, 0.05); panner.positionZ.setTargetAtTime(v.z, t, 0.05); } },
      setVol: (v, tc = 0.1) => { g.gain.setTargetAtTime(v, c.currentTime, tc); },
      setMuffle: (on) => { if (lp) lp.frequency.setTargetAtTime(on ? 900 : 20000, c.currentTime, 0.1); },
      setRate: (r) => { src.playbackRate.setTargetAtTime(r, c.currentTime, 0.1); },
    };
    if (o.loop) this.loops.add(h);
    return h;
  }

  stopAll() { for (const h of [...this.loops]) h.stop(0.3); this.loops.clear(); }

  setHurt(k) {
    if (!this.ctx) return;
    // k 0..1: muffle the world when badly hurt
    const f = 20000 * Math.pow(1 - k, 3) + 900;
    this.muffle.frequency.setTargetAtTime(Math.min(20000, f), this.ctx.currentTime, 0.2);
  }

  // Text-to-speech for tapes (if the browser has voices).
  speak(text, opts = {}) {
    try {
      if (!('speechSynthesis' in window)) return null;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opts.rate ?? 0.86;
      u.pitch = opts.pitch ?? 0.7;
      u.volume = Math.min(1, CFG.volume * 0.9);
      if (opts.lang) u.lang = opts.lang;
      const voices = speechSynthesis.getVoices();
      const want = opts.lang || 'en';
      const v = voices.find((x) => x.lang && x.lang.toLowerCase().startsWith(want) && /male|daniel|george|fred|google uk english male/i.test(x.name)) || voices.find((x) => x.lang && x.lang.toLowerCase().startsWith(want));
      if (v) u.voice = v;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      return u;
    } catch (e) { return null; }
  }
  stopSpeech() { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
}

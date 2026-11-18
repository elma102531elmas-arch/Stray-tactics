'use strict';
/* =========================================================
   MY PHONE FACTORY — core utilities
   ========================================================= */
const U = {};
U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
U.lerp = (a, b, t) => a + (b - a) * t;
U.rand = () => Math.random();
U.rf = (a, b) => a + Math.random() * (b - a);
U.ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
U.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
U.chance = (p) => Math.random() < p;
U.gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
U.sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
U.avg = (arr, f) => (arr.length ? U.sum(arr, f) / arr.length : 0);
U.maxBy = (arr, f) => arr.reduce((b, x) => (b === null || f(x) > f(b) ? x : b), null);
U.minBy = (arr, f) => arr.reduce((b, x) => (b === null || f(x) < f(b) ? x : b), null);
U.uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
U.deep = (o) => JSON.parse(JSON.stringify(o));
U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
U.sigmoid = (x) => 1 / (1 + Math.exp(-x));
U.log2 = (x) => Math.log(x) / Math.LN2;
U.shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
U.weighted = (items, wf) => { const t = U.sum(items, wf); let r = Math.random() * t; for (const it of items) { r -= wf(it); if (r <= 0) return it; } return items[items.length - 1]; };

U.money = (v, dec) => {
  if (v == null || isNaN(v)) return '$0';
  const neg = v < 0; v = Math.abs(v);
  let s;
  if (v >= 1e12) s = (v / 1e12).toFixed(dec ?? 2) + 'T';
  else if (v >= 1e9) s = (v / 1e9).toFixed(dec ?? 2) + 'B';
  else if (v >= 1e6) s = (v / 1e6).toFixed(dec ?? 2) + 'M';
  else if (v >= 1e4) s = (v / 1e3).toFixed(dec ?? 1) + 'K';
  else if (v >= 100) s = Math.round(v).toLocaleString('en-US');
  else s = v.toFixed(dec ?? (v < 10 ? 2 : 0));
  return (neg ? '-$' : '$') + s;
};
U.num = (v, dec) => {
  if (v == null || isNaN(v)) return '0';
  const neg = v < 0; v = Math.abs(v); let s;
  if (v >= 1e12) s = (v / 1e12).toFixed(dec ?? 2) + 'T';
  else if (v >= 1e9) s = (v / 1e9).toFixed(dec ?? 2) + 'B';
  else if (v >= 1e6) s = (v / 1e6).toFixed(dec ?? 2) + 'M';
  else if (v >= 1e4) s = (v / 1e3).toFixed(dec ?? 1) + 'K';
  else s = (dec != null ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US'));
  return (neg ? '-' : '') + s;
};
U.pct = (v, dec = 1) => (v * 100).toFixed(dec) + '%';
U.MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
U.dateStr = (t) => U.MONTHS[t % 12] + ' ' + (2010 + Math.floor(t / 12));
U.yearOf = (t) => 2010 + Math.floor(t / 12);
U.fyear = (t) => 2010 + t / 12; // fractional year
U.stars = (v100) => { const n = Math.round(U.clamp(v100, 0, 100) / 20); return '★'.repeat(n) + '☆'.repeat(5 - n); };
U.sign = (v, f = U.num) => (v >= 0 ? '+' : '') + f(v);
U.plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
U.hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// Small deterministic rng (used for visuals that must look the same in replays)
U.srng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

U.store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

/* ---------- tiny DOM helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- sound (procedural, optional) ---------- */
const SFX = {
  ctx: null, on: true,
  init() { if (this.ctx) return; try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } },
  noise(dur, vol, filt = 1200, q = 0.7) {
    if (!this.on) return; this.init(); const c = this.ctx; if (!c) return;
    const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) { const env = Math.min(1, i / (c.sampleRate * 0.15)) * Math.min(1, (len - i) / (c.sampleRate * 0.6)); d[i] = (Math.random() * 2 - 1) * env * (0.6 + 0.4 * Math.random() * (Math.random() < 0.02 ? 3 : 1)); }
    const src = c.createBufferSource(); src.buffer = buf; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filt; f.Q.value = q;
    const g = c.createGain(); g.gain.value = vol; src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  },
  tone(freq, dur, vol = 0.1, type = 'sine', slide = 0) {
    if (!this.on) return; this.init(); const c = this.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur + 0.05);
  },
  applause(strength) { this.noise(1.2 + strength * 2.5, 0.05 + strength * 0.22, 2500, 0.5); },
  cheer(strength) { this.applause(strength); this.noise(1.5 + strength, 0.03 + strength * 0.1, 900, 1.2); },
  boo() { this.tone(140, 1.4, 0.06, 'sawtooth', 0.8); this.noise(1.2, 0.04, 300, 2); },
  gasp() { this.noise(0.6, 0.08, 700, 1.5); },
  laugh() { for (let i = 0; i < 5; i++) setTimeout(() => this.noise(0.25, 0.06, 900 + Math.random() * 400, 3), i * 180); },
  boom() { this.tone(70, 1.4, 0.4, 'sine', 0.4); this.noise(0.9, 0.12, 200, 0.6); },
  whoosh() { this.noise(0.9, 0.12, 1800, 0.4); },
  click() { this.tone(900, 0.05, 0.04, 'square'); },
  ding() { this.tone(1320, 0.4, 0.06); setTimeout(() => this.tone(1760, 0.5, 0.05), 90); },
  error() { this.tone(220, 0.3, 0.08, 'square', 0.7); },
};

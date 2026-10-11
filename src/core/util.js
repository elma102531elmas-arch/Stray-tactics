// Small math + misc helpers shared by every module.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
export function dampAngle(a, b, lambda, dt) { return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt)); }

// Deterministic RNG so procedural textures/maps look identical every load.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Critically/under-damped spring on a Vector3. Used for weapon sway, recoil,
// landing bumps and animation "kick" events so motion feels physical.
export class Spring3 {
  constructor(stiffness = 140, damping = 13) {
    this.k = stiffness; this.d = damping;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.target = new THREE.Vector3();
  }
  impulse(x, y, z) { this.vel.x += x; this.vel.y += y; this.vel.z += z; }
  update(dt) {
    // semi-implicit euler with substeps for stability at low fps
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel.x += ((this.target.x - this.pos.x) * this.k - this.vel.x * this.d) * h;
      this.vel.y += ((this.target.y - this.pos.y) * this.k - this.vel.y * this.d) * h;
      this.vel.z += ((this.target.z - this.pos.z) * this.k - this.vel.z * this.d) * h;
      this.pos.x += this.vel.x * h; this.pos.y += this.vel.y * h; this.pos.z += this.vel.z * h;
    }
    return this.pos;
  }
  reset() { this.pos.set(0, 0, 0); this.vel.set(0, 0, 0); this.target.set(0, 0, 0); }
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  return e;
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
    ta.remove(); return ok;
  }
}
export function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept || '*';
    i.onchange = () => resolve(i.files[0] || null); i.click();
  });
}
export function readFileText(file) { return new Promise((r, j) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = j; fr.readAsText(file); }); }
export function readFileDataURL(file) { return new Promise((r, j) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = j; fr.readAsDataURL(file); }); }
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function round(v, d = 3) { const m = Math.pow(10, d); return Math.round(v * m) / m; }
export function roundArr(a, d = 3) { return a.map((v) => round(v, d)); }

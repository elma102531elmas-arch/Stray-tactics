// Procedurally painted textures: blood decals, lens blood, flashlight cookie, skin detail, sprites.
import * as THREE from '../../lib/three.module.js';
import { makeCanvas, mulberry32, noise2, fbm3, clamp, smooth as smoothstep } from '../util.js';

function tex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- Blood painting primitives ----------
function bloodColor(r, a = 1, dark = 0) {
  const base = [92 - dark * 40, 4, 6 - dark * 3];
  return `rgba(${Math.max(20, base[0] + r * 18) | 0},${base[1]},${Math.max(2, base[2]) | 0},${a})`;
}

function blob(ctx, cx, cy, R, rng, spikes = 0.35, pts = 64) {
  ctx.beginPath();
  const ph = rng() * 100;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    let r = R * (0.78 + 0.22 * noise2(Math.cos(a) * 1.7 + ph, Math.sin(a) * 1.7 + ph));
    r += R * spikes * Math.pow(Math.max(0, noise2(Math.cos(a) * 6 + ph * 2, Math.sin(a) * 6)), 3) * 2.2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function paintSplat(ctx, cx, cy, R, rng, opts = {}) {
  ctx.save();
  // satellites / spray first so main body overlaps them
  const nSat = opts.sat ?? 70;
  for (let i = 0; i < nSat; i++) {
    const a = rng() * Math.PI * 2;
    const d = R * (1.0 + Math.pow(rng(), 1.6) * 1.35);
    const s = (1 - (d / R - 1) / 1.5) * R * 0.09 * (0.3 + rng());
    if (s <= 0.3) continue;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    ctx.fillStyle = bloodColor(rng() * 0.6, 0.92);
    ctx.beginPath();
    ctx.ellipse(x, y, s * (1.6 + rng() * 2.4), s, a, 0, Math.PI * 2);
    ctx.fill();
  }
  blob(ctx, cx, cy, R, rng, opts.spikes ?? 0.35);
  const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.3);
  g.addColorStop(0, bloodColor(0.8, 0.97));
  g.addColorStop(0.6, bloodColor(0.4, 0.97));
  g.addColorStop(1, bloodColor(0, 0.98, 0.7));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, R * 0.035);
  ctx.strokeStyle = 'rgba(30,0,0,0.55)';
  ctx.stroke();
  // inner coagulated clots
  for (let i = 0; i < 6; i++) {
    blob(ctx, cx + (rng() - 0.5) * R * 0.8, cy + (rng() - 0.5) * R * 0.8, R * (0.08 + rng() * 0.18), rng, 0.1, 24);
    ctx.fillStyle = 'rgba(38,0,0,0.35)';
    ctx.fill();
  }
  ctx.restore();
}

function paintDrips(ctx, x0, y0, w, h, rng) {
  // splat at top, streaks running down
  paintSplat(ctx, x0 + w / 2, y0 + h * 0.2, w * 0.24, rng, { sat: 40 });
  const n = 5 + (rng() * 6) | 0;
  for (let i = 0; i < n; i++) {
    const x = x0 + w / 2 + (rng() - 0.5) * w * 0.5;
    const len = h * (0.25 + rng() * 0.7);
    const wd = 2 + rng() * 6;
    const y = y0 + h * 0.2;
    const g = ctx.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, bloodColor(0.6, 0.95));
    g.addColorStop(1, bloodColor(0.2, 0.9, 0.4));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - wd / 2, y);
    for (let t = 0; t <= 1.0001; t += 0.1) ctx.lineTo(x - wd / 2 * (1 - t * 0.55) + noise2(i * 3, t * 4) * 1.5, y + len * t);
    for (let t = 1; t >= -0.0001; t -= 0.1) ctx.lineTo(x + wd / 2 * (1 - t * 0.55) + noise2(i * 3, t * 4) * 1.5, y + len * t);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y + len, wd * 0.55, wd * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintPool(ctx, cx, cy, R, rng) {
  blob(ctx, cx, cy, R, rng, 0.05, 96);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.1);
  g.addColorStop(0, 'rgba(70,2,3,0.98)');
  g.addColorStop(0.75, 'rgba(58,1,2,0.98)');
  g.addColorStop(1, 'rgba(30,0,0,0.98)');
  ctx.fillStyle = g;
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    blob(ctx, cx + (rng() - 0.5) * R, cy + (rng() - 0.5) * R, R * (0.25 + rng() * 0.3), rng, 0.05, 48);
    ctx.fillStyle = 'rgba(70,2,3,0.95)';
    ctx.fill();
  }
}

function paintSmear(ctx, x0, y0, w, h, rng) {
  // drag trail running along x
  for (let s = 0; s < 9; s++) {
    const yy = y0 + h * 0.5 + (rng() - 0.5) * h * 0.45;
    const wd = 2 + rng() * 9;
    ctx.strokeStyle = bloodColor(rng() * 0.5, 0.35 + rng() * 0.45);
    ctx.lineWidth = wd;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const xs = x0 + w * (0.02 + rng() * 0.1), xe = x0 + w * (0.75 + rng() * 0.22);
    ctx.moveTo(xs, yy);
    for (let t = 0; t <= 1; t += 0.05) ctx.lineTo(xs + (xe - xs) * t, yy + noise2(s * 7.1, t * 3) * h * 0.08);
    ctx.stroke();
  }
  paintSplat(ctx, x0 + w * 0.12, y0 + h * 0.5, h * 0.22, rng, { sat: 20 });
}

function paintHand(ctx, cx, cy, S, rng, rot) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.fillStyle = bloodColor(0.5, 0.85);
  ctx.beginPath(); ctx.ellipse(0, S * 0.18, S * 0.27, S * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  const fingers = [[-0.22, -0.16, 0.32, -0.25], [-0.08, -0.25, 0.4, -0.06], [0.06, -0.26, 0.42, 0.04], [0.19, -0.2, 0.34, 0.14]];
  for (const [fx, fy, len, ang] of fingers) {
    ctx.save(); ctx.translate(fx * S, fy * S); ctx.rotate(ang);
    ctx.beginPath(); ctx.ellipse(0, -len * S * 0.5, S * 0.055, len * S * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.save(); ctx.translate(S * 0.3, S * 0.18); ctx.rotate(1.0);
  ctx.beginPath(); ctx.ellipse(0, -S * 0.12, S * 0.06, S * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // smudge drag
  ctx.globalAlpha = 0.5;
  ctx.fillRect(-S * 0.22, S * 0.3, S * 0.44, S * (0.2 + rng() * 0.4));
  ctx.restore();
  // break up with eraser noise
}

function paintBulletHole(ctx, cx, cy, R, rng) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, 'rgba(5,5,5,1)');
  g.addColorStop(0.18, 'rgba(10,9,8,1)');
  g.addColorStop(0.3, 'rgba(40,36,32,0.85)');
  g.addColorStop(0.65, 'rgba(70,64,58,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(20,18,16,0.7)';
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2; ctx.lineWidth = 1 + rng();
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2);
    ctx.lineTo(cx + Math.cos(a + 0.2) * R * (0.5 + rng() * 0.4), cy + Math.sin(a + 0.2) * R * (0.5 + rng() * 0.4));
    ctx.stroke();
  }
}

function erodeAlpha(ctx, x0, y0, w, h, seed, amt = 0.35) {
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3] === 0) continue;
    const n = fbm3(x / 9 + seed, y / 9, seed, 3);
    const k = clamp(1 - amt * Math.max(0, n * 2.2 + 0.1), 0, 1);
    d[i + 3] = d[i + 3] * k;
    const v = 1 + n * 0.18;
    d[i] = clamp(d[i] * v, 0, 255);
  }
  ctx.putImageData(img, x0, y0);
}

// Atlas layout: 4x4 cells of 256px.
export const DECAL = {
  splat: [0, 1, 2, 3], drip: [4, 5], pool: [6, 7], smear: [8, 9], hand: [10, 11], spray: [12, 13], bullet: [14], scorch: [15],
};

export function makeBloodAtlas() {
  const S = 1024, C = 256;
  const cv = makeCanvas(S, S);
  const ctx = cv.getContext('2d');
  const rng = mulberry32(1337);
  const cell = (i) => [(i % 4) * C, Math.floor(i / 4) * C];
  for (const i of DECAL.splat) { const [x, y] = cell(i); paintSplat(ctx, x + C / 2, y + C / 2, C * (0.17 + rng() * 0.06), rng); erodeAlpha(ctx, x, y, C, C, i * 3.1, 0.25); }
  for (const i of DECAL.drip) { const [x, y] = cell(i); paintDrips(ctx, x, y, C, C, rng); erodeAlpha(ctx, x, y, C, C, i * 2.3, 0.2); }
  for (const i of DECAL.pool) { const [x, y] = cell(i); paintPool(ctx, x + C / 2, y + C / 2, C * 0.3, rng); }
  for (const i of DECAL.smear) { const [x, y] = cell(i); paintSmear(ctx, x, y, C, C, rng); erodeAlpha(ctx, x, y, C, C, i * 1.7, 0.45); }
  for (const i of DECAL.hand) {
    const [x, y] = cell(i);
    paintHand(ctx, x + C * 0.38, y + C * 0.45, C * 0.42, rng, -0.2 + rng() * 0.4);
    if (i === 11) paintHand(ctx, x + C * 0.68, y + C * 0.55, C * 0.38, rng, 0.3);
    erodeAlpha(ctx, x, y, C, C, i * 1.3, 0.55);
  }
  for (const i of DECAL.spray) {
    const [x, y] = cell(i);
    // directional spray: many droplets fanning to the right
    for (let k = 0; k < 220; k++) {
      const a = (rng() - 0.5) * 1.1;
      const d = Math.pow(rng(), 0.7) * C * 0.46;
      const s = (1 - d / (C * 0.5)) * (1.5 + rng() * 4.5);
      ctx.fillStyle = bloodColor(rng() * 0.6, 0.9);
      ctx.beginPath();
      ctx.ellipse(x + C * 0.1 + Math.cos(a) * d, y + C / 2 + Math.sin(a) * d, s * (1 + d / 60), s, a, 0, Math.PI * 2);
      ctx.fill();
    }
    paintSplat(ctx, x + C * 0.12, y + C / 2, C * 0.06, rng, { sat: 10 });
  }
  { const [x, y] = cell(14); paintBulletHole(ctx, x + C / 2, y + C / 2, C * 0.3, rng); }
  {
    const [x, y] = cell(15);
    const g = ctx.createRadialGradient(x + C / 2, y + C / 2, 0, x + C / 2, y + C / 2, C * 0.45);
    g.addColorStop(0, 'rgba(10,8,6,0.9)'); g.addColorStop(1, 'rgba(10,8,6,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, C, C); erodeAlpha(ctx, x, y, C, C, 9.1, 0.6);
  }
  const t = tex(cv);
  t.generateMipmaps = true;
  return t;
}

export function atlasUV(i) {
  const c = 0.25, pad = 0.004;
  return [(i % 4) * c + pad, 1 - (Math.floor(i / 4) + 1) * c + pad, c - pad * 2, c - pad * 2];
}

// Words written in blood on walls.
export function makeBloodWriting(text, w = 1024, h = 256, seed = 1) {
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const rng = mulberry32(seed);
  const fs = Math.min(h * 0.62, (w * 1.5) / Math.max(4, text.length));
  ctx.font = `bold ${fs}px "Reenie Beanie", "Caveat", "Comic Sans MS", cursive`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = bloodColor(0.6, 0.95);
  ctx.save();
  ctx.translate(w / 2, h * 0.45);
  ctx.rotate((rng() - 0.5) * 0.08);
  // draw letter by letter with jitter so it looks hand smeared
  const total = ctx.measureText(text).width;
  let x = -total / 2;
  for (const ch of text) {
    const cw = ctx.measureText(ch).width;
    ctx.save();
    ctx.translate(x + cw / 2, (rng() - 0.5) * fs * 0.12);
    ctx.rotate((rng() - 0.5) * 0.2);
    ctx.scale(1 + (rng() - 0.5) * 0.15, 1 + (rng() - 0.5) * 0.2);
    ctx.fillText(ch, 0, 0);
    ctx.lineWidth = fs * 0.05; ctx.strokeStyle = bloodColor(0.4, 0.8); ctx.strokeText(ch, 0, 0);
    ctx.restore();
    // drips from letters
    if (ch !== ' ' && rng() < 0.55) {
      const dx = x + cw * (0.3 + rng() * 0.4), len = fs * (0.3 + rng() * 1.1);
      ctx.fillRect(dx, fs * 0.15, 2 + rng() * 3, len);
      ctx.beginPath(); ctx.arc(dx + 2, fs * 0.15 + len, 3 + rng() * 2, 0, Math.PI * 2); ctx.fill();
    }
    x += cw;
  }
  ctx.restore();
  erodeAlpha(ctx, 0, 0, w, h, seed * 1.1, 0.4);
  return tex(cv);
}

// Blood on the "lens" (screen-space overlay used when hurt).
export function makeLensBlood() {
  const S = 512;
  const cv = makeCanvas(S, S);
  const ctx = cv.getContext('2d');
  const rng = mulberry32(77);
  const col = (a) => `rgba(${70 + (rng() * 30) | 0},${(rng() * 4) | 0},${(rng() * 4) | 0},${a})`;
  for (let i = 0; i < 18; i++) {
    // keep splats near the edges
    const side = (rng() * 4) | 0;
    let x = rng() * S, y = rng() * S;
    if (side === 0) x = rng() * S * 0.16; else if (side === 1) x = S - rng() * S * 0.16;
    else if (side === 2) y = rng() * S * 0.16; else y = S - rng() * S * 0.16;
    const R = 8 + rng() * 26;
    blob(ctx, x, y, R, rng, 0.3, 40);
    ctx.fillStyle = col(0.55 + rng() * 0.25);
    ctx.fill();
    for (let k = 0; k < 14; k++) {
      ctx.beginPath();
      ctx.arc(x + (rng() - 0.5) * R * 4, y + (rng() - 0.5) * R * 4, 1 + rng() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // drips from the top edge
  for (let i = 0; i < 7; i++) {
    const x = rng() * S, len = 20 + rng() * 110, wd = 2 + rng() * 6;
    ctx.fillStyle = col(0.6);
    ctx.fillRect(x - wd / 2, 0, wd, len);
    ctx.beginPath(); ctx.ellipse(x, len, wd * 0.7, wd, 0, 0, Math.PI * 2); ctx.fill();
  }
  const t = tex(cv);
  return t;
}

// Projected light pattern for the flashlight (bright core, ring, soft halo).
export function makeFlashlightCookie() {
  const S = 256;
  const cv = makeCanvas(S, S);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
    const r = Math.sqrt(dx * dx + dy * dy);
    // smooth hotspot + reflector falloff + wide soft spill (no hard steps)
    let v = Math.exp(-Math.pow(r / 0.26, 2)) * 0.75;
    v += 0.45 * (1 - smoothstep(0.22, 0.46, r));
    v += 0.1 * Math.exp(-Math.pow((r - 0.4) / 0.05, 2));
    v += 0.32 * (1 - smoothstep(0.3, 0.97, r));
    v *= 0.985 + 0.015 * Math.sin(r * 60);
    v *= 0.94 + 0.06 * noise2(dx * 6, dy * 6);                    // smudges on the lens
    v = clamp(v, 0, 1) * (r > 0.98 ? 0 : 1);
    const warm = 1 - r * 0.1;
    const i = (y * S + x) * 4;
    img.data[i] = 255 * v; img.data[i + 1] = 247 * v * warm; img.data[i + 2] = 225 * v * warm * warm; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(cv);
}

// Tileable skin / flesh detail used with triplanar mapping on creatures.
export function makeSkinDetail(seed = 3) {
  const S = 256;
  const height = new Float32Array(S * S);
  const T = (x, y, f, z) => {
    // tileable noise via torus mapping
    const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
    return fbm3(Math.cos(a) * f + seed, Math.sin(a) * f + Math.cos(b) * f * 0.7, Math.sin(b) * f + z, 4);
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const pores = T(x, y, 9, 1.1);
    const wrinkle = Math.abs(T(x, y, 2.2, 7.3));
    const vein = 1 - Math.min(1, Math.abs(T(x, y, 1.4, 3.7)) * 9);
    height[y * S + x] = pores * 0.35 - wrinkle * 0.6 + vein * 0.25;
  }
  const cv = makeCanvas(S, S), cn = makeCanvas(S, S);
  const c1 = cv.getContext('2d'), c2 = cn.getContext('2d');
  const a = c1.createImageData(S, S), n = c2.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const hx = height[y * S + ((x + 1) % S)] - height[y * S + ((x - 1 + S) % S)];
    const hy = height[((y + 1) % S) * S + x] - height[((y - 1 + S) % S) * S + x];
    const nx = -hx * 2.2, ny = -hy * 2.2, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    n.data[i * 4] = (nx / l * 0.5 + 0.5) * 255; n.data[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; n.data[i * 4 + 2] = (nz / l * 0.5 + 0.5) * 255; n.data[i * 4 + 3] = 255;
    const m = T(x, y, 1.5, 11.0);
    const v = clamp(0.82 + m * 0.35 + height[i] * 0.12, 0.4, 1.1);
    a.data[i * 4] = clamp(v * 255, 0, 255); a.data[i * 4 + 1] = clamp(v * 240, 0, 255); a.data[i * 4 + 2] = clamp(v * 236, 0, 255); a.data[i * 4 + 3] = 255;
  }
  c1.putImageData(a, 0, 0); c2.putImageData(n, 0, 0);
  const ta = tex(cv); ta.wrapS = ta.wrapT = THREE.RepeatWrapping;
  const tn = tex(cn, false); tn.wrapS = tn.wrapT = THREE.RepeatWrapping;
  return { map: ta, normal: tn };
}

export function makeSoftDot(size = 64, inner = 'rgba(255,255,255,1)') {
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return tex(cv);
}

export function makeMuzzleFlash() {
  const S = 128;
  const cv = makeCanvas(S, S);
  const ctx = cv.getContext('2d');
  ctx.translate(S / 2, S / 2);
  ctx.globalCompositeOperation = 'lighter';
  const rng = mulberry32(5);
  for (let i = 0; i < 7; i++) {
    ctx.save(); ctx.rotate(i / 7 * Math.PI * 2 + rng() * 0.4);
    const g = ctx.createLinearGradient(0, 0, S * 0.5, 0);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.4, 'rgba(255,170,60,0.8)'); g.addColorStop(1, 'rgba(255,90,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(S * (0.3 + rng() * 0.2), 0); ctx.lineTo(0, 5); ctx.fill();
    ctx.restore();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.3);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.5, 'rgba(255,190,80,0.6)'); g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, S * 0.3, 0, Math.PI * 2); ctx.fill();
  return tex(cv);
}

export function makeSmoke() {
  const S = 128;
  const cv = makeCanvas(S, S);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x / S * 2 - 1, dy = y / S * 2 - 1, r = Math.hypot(dx, dy);
    const n = fbm3(dx * 2.5, dy * 2.5, 4.4, 4) * 0.5 + 0.5;
    const a = clamp((1 - r) * 1.4, 0, 1) * n;
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 200; img.data[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(cv);
}

// Rain streak texture.
export function makeStreak() {
  const cv = makeCanvas(8, 64);
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(200,210,230,0)'); g.addColorStop(0.7, 'rgba(200,210,230,0.5)'); g.addColorStop(1, 'rgba(220,230,255,0.9)');
  ctx.fillStyle = g; ctx.fillRect(3, 0, 2, 64);
  return tex(cv);
}

// Grime gradient used on walls (darker toward floor).
export function makeLabelTexture(lines, w = 512, h = 256, opts = {}) {
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = opts.bg || '#d8d2c2';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = opts.fg || '#1b1b1b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = opts.size || 64;
  ctx.font = `bold ${fs}px ${opts.font || '"Barlow Condensed", "Arial Narrow", Arial, sans-serif'}`;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * fs * 1.1));
  // wear
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const p = i / 4, x = p % w, y = (p / w) | 0;
    const n = fbm3(x / 30, y / 30, 2.2, 3);
    const k = 0.75 + n * 0.35;
    img.data[i] *= k; img.data[i + 1] *= k * 0.97; img.data[i + 2] *= k * 0.9;
  }
  ctx.putImageData(img, 0, 0);
  return tex(cv);
}

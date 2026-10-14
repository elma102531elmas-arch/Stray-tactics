// Tileable (periodic) gradient noise + voronoi, used to synthesize seamless
// PBR textures on the CPU.

const GRAD = new Float32Array(512);
for (let i = 0; i < 256; i++) { const a = (i / 256) * Math.PI * 2; GRAD[i * 2] = Math.cos(a); GRAD[i * 2 + 1] = Math.sin(a); }

function ihash(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
export function hash01(x, y, s) { return (ihash(x, y, s) & 0xffffff) / 0xffffff; }

// Periodic Perlin noise. x,y in lattice units; px/py periods in lattice cells. Returns ~[-1,1].
export function perlin(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  let x0 = xi % px; if (x0 < 0) x0 += px;
  let y0 = yi % py; if (y0 < 0) y0 += py;
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const g00 = (ihash(x0, y0, seed) & 255) * 2, g10 = (ihash(x1, y0, seed) & 255) * 2;
  const g01 = (ihash(x0, y1, seed) & 255) * 2, g11 = (ihash(x1, y1, seed) & 255) * 2;
  const n00 = GRAD[g00] * fx + GRAD[g00 + 1] * fy;
  const n10 = GRAD[g10] * (fx - 1) + GRAD[g10 + 1] * fy;
  const n01 = GRAD[g01] * fx + GRAD[g01 + 1] * (fy - 1);
  const n11 = GRAD[g11] * (fx - 1) + GRAD[g11 + 1] * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.414;
}

// fbm over texture space u,v in [0,1). freq is rounded to an integer for tiling. Returns ~[0,1].
export function fbm(u, v, freq, octaves, seed, gain = 0.5) {
  return fbm2(u, v, freq, freq, octaves, seed, gain);
}
// anisotropic fbm (different frequency on u and v), e.g. wood grain / streaks
export function fbm2(u, v, freqU, freqV, octaves, seed, gain = 0.5) {
  let amp = 0.5, sum = 0, norm = 0;
  let fu = Math.max(1, Math.round(freqU)), fv = Math.max(1, Math.round(freqV));
  for (let o = 0; o < octaves; o++) {
    sum += amp * perlin(u * fu, v * fv, fu, fv, seed + o * 131);
    norm += amp; amp *= gain; fu *= 2; fv *= 2;
  }
  return sum / norm * 0.5 + 0.5;
}

// ridged noise for cracks / veins, ~[0,1]
export function ridged(u, v, freq, octaves, seed) {
  let amp = 0.5, sum = 0, norm = 0, f = Math.max(1, Math.round(freq));
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(perlin(u * f, v * f, f, f, seed + o * 71));
    sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

// Periodic voronoi. Returns into out = {f1, f2, id, cx, cy}
export function voronoi(u, v, cells, seed, jitter, out) {
  const x = u * cells, y = v * cells;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0, cx = 0, cy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = xi + i, gy = yi + j;
      let wx = gx % cells; if (wx < 0) wx += cells;
      let wy = gy % cells; if (wy < 0) wy += cells;
      const h = ihash(wx, wy, seed);
      const px = gx + 0.5 + (((h & 0xffff) / 0xffff) - 0.5) * jitter;
      const py = gy + 0.5 + ((((h >>> 16) & 0xffff) / 0xffff) - 0.5) * jitter;
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = h; cx = px; cy = py; } else if (d < f2) f2 = d;
    }
  }
  out.f1 = f1; out.f2 = f2; out.id = (id & 0xffffff) / 0xffffff; out.cx = cx; out.cy = cy;
  return out;
}

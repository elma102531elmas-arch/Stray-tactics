// Recipe -> PBR texture set (albedo / normal / ORM), synthesized on the GPU.
// A "recipe" is a small JSON object, so custom textures made in the Texture
// Studio are tiny and easy to copy-paste / send. Generation of a 1024² set
// takes a few milliseconds.
import * as THREE from 'three';

export const RECIPE_DEFAULTS = {
  name: 'New Texture',
  tile: 2,
  color1: '#b8a078', color2: '#8f7a58',
  noiseScale: 4, noiseAmt: 0.6, noiseOct: 5,
  detail: 0.25,
  pattern: 'none', // none | bricks | tiles | planks | cobble | panels
  rows: 4, cols: 2, offset: 0.5, gap: 0.015, gapColor: '#6e6252', bevel: 0.02, cellVar: 0.15, jitter: 0.85, chip: 0.35,
  depth: 1,
  grime: 0.25, grimeColor: '#4b3d2c', grimeScale: 3,
  streaks: 0,
  cracks: 0,
  spots: 0, spotColor: '#ffffff', spotScale: 12,
  edgeWear: 0, wearColor: '#d8d0c0',
  grain: 0,
  stripes: 0, stripeColor: '#f2efe6', stripeCount: 4,
  rough: 0.85, roughVar: 0.15, metal: 0,
  bump: 1.0,
  image: null,
  seed: 1,
};

export const PATTERNS = ['none', 'bricks', 'tiles', 'planks', 'cobble', 'panels'];
export function normalizeRecipe(r) { return { ...RECIPE_DEFAULTS, ...(r || {}) }; }

const VERT = /* glsl */`
out vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const GEN_FRAG = /* glsl */`
precision highp float; precision highp int;
uniform int uPass; // 0 albedo(linear for sRGB target), 1 data: h, rough, metal
uniform int pattern, noiseOct, rows, cols, seed, stripeCount;
uniform float noiseScale, noiseAmt, detail, offset_, gap, bevel, cellVar, jitter, chip, depth_;
uniform float grime, grimeScale, streaks, cracks, spots, spotScale, edgeWear, grain, stripes, rough, roughVar, metal;
uniform vec3 c1, c2, gapC, grimeC, spotC, wearC, stripeC;
uniform bool useImage; uniform sampler2D uImage;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

uint ihash(int x, int y, int s){
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 1442695041u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}
float hash01(int x, int y, int s){ return float(ihash(x, y, s) & 0xffffffu) / 16777215.0; }
vec2 grad(int x, int y, int s){ float a = float(ihash(x, y, s) & 255u) / 256.0 * 6.28318530718; return vec2(cos(a), sin(a)); }
int wrapi(int v, int p){ int r = v - (v / p) * p; return r < 0 ? r + p : r; }
float perlin(vec2 p, ivec2 per, int s){
  vec2 i = floor(p); vec2 f = p - i;
  int x0 = wrapi(int(i.x), per.x), y0 = wrapi(int(i.y), per.y);
  int x1 = wrapi(x0 + 1, per.x), y1 = wrapi(y0 + 1, per.y);
  float n00 = dot(grad(x0, y0, s), f);
  float n10 = dot(grad(x1, y0, s), f - vec2(1.0, 0.0));
  float n01 = dot(grad(x0, y1, s), f - vec2(0.0, 1.0));
  float n11 = dot(grad(x1, y1, s), f - vec2(1.0, 1.0));
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y) * 1.414;
}
float fbm2(vec2 uv, vec2 freq, int oct, int s, float gain){
  float amp = 0.5, sum = 0.0, norm = 0.0;
  ivec2 f = ivec2(max(vec2(1.0), floor(freq + 0.5)));
  for (int o = 0; o < 8; o++){
    if (o >= oct) break;
    sum += amp * perlin(uv * vec2(f), f, s + o * 131);
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm * 0.5 + 0.5;
}
float fbm(vec2 uv, float freq, int oct, int s){ return fbm2(uv, vec2(freq), oct, s, 0.5); }
float ridged(vec2 uv, float freq, int oct, int s){
  float amp = 0.5, sum = 0.0, norm = 0.0; int f = int(max(1.0, floor(freq + 0.5)));
  for (int o = 0; o < 6; o++){ if (o >= oct) break; float n = 1.0 - abs(perlin(uv * float(f), ivec2(f), s + o * 71)); sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
// periodic voronoi: x=f1, y=f2, z=id
vec3 voronoi(vec2 uv, int cells, int s, float jit){
  vec2 p = uv * float(cells); vec2 ip = floor(p);
  float f1 = 1e9, f2 = 1e9, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    int gx = int(ip.x) + i, gy = int(ip.y) + j;
    int wx = wrapi(gx, cells), wy = wrapi(gy, cells);
    uint h = ihash(wx, wy, s);
    vec2 c = vec2(float(gx), float(gy)) + 0.5 + (vec2(float(h & 0xffffu), float((h >> 16u) & 0xffffu)) / 65535.0 - 0.5) * jit;
    float d = length(c - p);
    if (d < f1){ f2 = f1; f1 = d; id = float(h & 0xffffffu) / 16777215.0; } else if (d < f2) f2 = d;
  }
  return vec3(f1, f2, id);
}
float sstep(float a, float b, float v){ return smoothstep(a, b, v); }
vec3 srgbToLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }

void main(){
  vec2 uv = vUv;
  float u = uv.x, v = 1.0 - uv.y; // v grows downward like the canvas version
  if (useImage){
    vec3 im = texture(uImage, uv).rgb;
    float lum = dot(im, vec3(0.299, 0.587, 0.114));
    if (uPass == 0) outColor = vec4(srgbToLinear(im), 1.0);
    else outColor = vec4(lum, rough + (0.5 - lum) * roughVar, metal, 1.0);
    return;
  }
  float g2 = gap * 0.5;
  float id = 0.5, edge = 1.0, ph = 1.0, gapMask = 0.0, lu = u;
  if (pattern == 1 || pattern == 2 || pattern == 5){
    float rr = floor(v * float(rows));
    float off = (pattern == 1 && mod(rr, 2.0) > 0.5) ? offset_ : 0.0;
    float x = u * float(cols) + off; float cc = floor(x);
    float fx = x - cc, fy = v * float(rows) - rr;
    lu = fx;
    float ex = min(fx, 1.0 - fx) / float(cols), ey = min(fy, 1.0 - fy) / float(rows);
    edge = min(ex, ey);
    if (chip > 0.0) edge += (fbm(uv, 24.0, 3, seed + 5) - 0.5) * chip * gap * 2.2;
    id = hash01(wrapi(int(cc), cols), int(rr), seed);
    gapMask = 1.0 - sstep(g2 * 0.7, g2, edge);
    ph = sstep(g2, g2 + bevel, edge);
    if (pattern == 5){
      vec2 rd = vec2(min(fx, 1.0 - fx) / float(cols), min(fy, 1.0 - fy) / float(rows)) - 0.0175;
      float dd = length(rd);
      if (dd < 0.012) ph += (1.0 - dd / 0.012) * 0.6;
    }
    ph *= 1.0 - cellVar * 0.6 * (id - 0.5);
  } else if (pattern == 3){
    float x = u * float(cols); float cc = floor(x); float fx = x - cc;
    int wci = wrapi(int(cc), cols);
    float boardOff = hash01(wci, 7, seed);
    float y = v * float(rows) + boardOff * float(rows); float rr = floor(y); float fy = y - rr;
    lu = fx;
    float ex = min(fx, 1.0 - fx) / float(cols), ey = min(fy, 1.0 - fy) / float(rows) * 0.6;
    edge = min(ex, ey);
    if (chip > 0.0) edge += (fbm(uv, 24.0, 3, seed + 5) - 0.5) * chip * gap * 2.0;
    id = hash01(wci, wrapi(int(rr), rows), seed);
    gapMask = 1.0 - sstep(g2 * 0.7, g2, edge);
    ph = sstep(g2, g2 + bevel, edge) * (1.0 - cellVar * (id - 0.5));
  } else if (pattern == 4){
    vec3 vo = voronoi(vec2(u, v), cols, seed, jitter);
    edge = (vo.y - vo.x) / float(cols) * 0.5;
    if (chip > 0.0) edge += (fbm(uv, 24.0, 3, seed + 5) - 0.5) * chip * gap * 2.0;
    id = vo.z;
    gapMask = 1.0 - sstep(g2 * 0.7, g2, edge);
    ph = sstep(g2, g2 + bevel, edge) * (1.0 - vo.x * 0.45) * (1.0 - cellVar * (id - 0.5));
  }
  vec2 tuv = vec2(u, v);
  float n = fbm(tuv, noiseScale, noiseOct, seed + 1);
  float t = clamp(0.5 + (n - 0.5) * 2.2 * noiseAmt, 0.0, 1.0);
  if (pattern != 0) t = clamp(t + (id - 0.5) * cellVar * 2.5, 0.0, 1.0);
  vec3 col = mix(c1, c2, t);
  float fine = detail > 0.0 ? fbm(tuv, 64.0, 2, seed + 2) : 0.5;
  float bright = 1.0 + (fine - 0.5) * detail * 0.9;
  float h = ph * 0.6 * depth_ + (n - 0.5) * 0.15 + (fine - 0.5) * 0.12 * detail * 2.0;
  if (grain > 0.0){
    float warp = fbm2(tuv, vec2(3.0, 1.0), 2, seed + 9, 0.5) * 2.5 + id * 3.0;
    float w = (lu * 3.2 + warp) * 4.0 + id * 7.0;
    float line = pow(0.5 + 0.5 * sin(w * 6.28318530718), 3.0);
    float fg = fbm2(tuv, vec2(64.0, 4.0), 2, seed + 10, 0.5);
    bright *= 1.0 - grain * (line * 0.28 + (fg - 0.5) * 0.3);
    h -= grain * line * 0.08;
  }
  if (stripes > 0.0){
    float st = mod(floor(u * float(stripeCount) * 2.0), 2.0);
    if (st > 0.5) col = mix(col, stripeC, stripes);
  }
  col *= bright;
  float r = rough + (n - 0.5) * roughVar * 2.0;
  if (edgeWear > 0.0 && pattern != 0){
    float wn = fbm(tuv, 16.0, 3, seed + 21);
    float wear = sstep(0.55, 0.75, (1.0 - sstep(g2, g2 + bevel * 2.5, edge)) * 0.8 + wn * 0.6) * edgeWear;
    col = mix(col, wearC, wear); r -= wear * 0.25;
  }
  if (spots > 0.0){
    vec3 vs = voronoi(tuv, int(max(2.0, floor(spotScale + 0.5))), seed + 31, 1.0);
    float sn = fbm(tuv, 8.0, 2, seed + 33);
    float s = (1.0 - sstep(0.08, 0.28, vs.x + (sn - 0.5) * 0.25)) * (vs.z < 0.6 ? 1.0 : 0.0) * spots;
    col = mix(col, spotC, s);
  }
  if (gapMask > 0.0){
    col = mix(col, gapC * (0.85 + fine * 0.3), gapMask);
    r += gapMask * 0.12;
  }
  if (grime > 0.0){
    float gn = fbm(tuv, grimeScale, 4, seed + 41);
    float g = sstep(0.45, 0.8, gn) * grime + (1.0 - ph) * grime * 0.6 * (pattern != 0 ? 1.0 : 0.0);
    if (streaks > 0.0){ float sn = fbm2(tuv, vec2(24.0, 2.0), 3, seed + 43, 0.5); g += sstep(0.55, 0.85, sn) * streaks * (0.6 + 0.4 * gn); }
    g = min(0.9, g);
    col = mix(col, grimeC, g); r += g * 0.05;
  }
  if (cracks > 0.0){
    float mask = sstep(0.5, 0.7, fbm(tuv, 3.0, 3, seed + 51));
    if (mask > 0.0){
      float rd = ridged(tuv, 6.0, 4, seed + 53);
      float cm = sstep(0.82, 0.95, rd) * mask * cracks;
      col *= 1.0 - cm * 0.55; h -= cm * 0.25;
    }
  }
  col = clamp(col, 0.0, 1.0);
  if (uPass == 0) outColor = vec4(srgbToLinear(col), 1.0);
  else outColor = vec4(h, clamp(r, 0.03, 1.0), metal * (1.0 - gapMask), 1.0);
}`;

const NORMAL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tData; uniform float strength; uniform float texel; uniform int mode; uniform float blur;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
float H(vec2 o){ return texture(tData, vUv + o * texel * blur).r; }
void main(){
  if (mode == 1){ vec4 d = texture(tData, vUv); outColor = vec4(1.0, d.g, d.b, 1.0); return; }
  float tl = H(vec2(-1, 1)), t = H(vec2(0, 1)), tr = H(vec2(1, 1));
  float l = H(vec2(-1, 0)), r = H(vec2(1, 0));
  float bl = H(vec2(-1, -1)), b = H(vec2(0, -1)), br = H(vec2(1, -1));
  float dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float dy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  vec3 n = normalize(vec3(-dx * strength, -dy * strength, 1.0));
  outColor = vec4(n * 0.5 + 0.5, 1.0);
}`;

const PATTERN_IDX = { none: 0, bricks: 1, tiles: 2, planks: 3, cobble: 4, panels: 5 };

function srgbColor(hex) {
  const c = new THREE.Color(); c.setStyle(hex || '#000', THREE.SRGBColorSpace);
  // keep raw sRGB components (we mix in sRGB space like an artist would)
  const s = c.clone().convertLinearToSRGB();
  return new THREE.Vector3(s.r, s.g, s.b);
}

class GpuTexGen {
  constructor(renderer) {
    this.r = renderer;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.genMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: GEN_FRAG,
      uniforms: {
        uPass: { value: 0 }, pattern: { value: 0 }, noiseOct: { value: 5 }, rows: { value: 4 }, cols: { value: 2 }, seed: { value: 1 }, stripeCount: { value: 4 },
        noiseScale: { value: 4 }, noiseAmt: { value: 0.5 }, detail: { value: 0.3 }, offset_: { value: 0.5 }, gap: { value: 0.01 }, bevel: { value: 0.02 }, cellVar: { value: 0.2 }, jitter: { value: 0.8 }, chip: { value: 0.3 }, depth_: { value: 1 },
        grime: { value: 0 }, grimeScale: { value: 3 }, streaks: { value: 0 }, cracks: { value: 0 }, spots: { value: 0 }, spotScale: { value: 10 }, edgeWear: { value: 0 }, grain: { value: 0 }, stripes: { value: 0 }, rough: { value: 0.8 }, roughVar: { value: 0.1 }, metal: { value: 0 },
        c1: { value: new THREE.Vector3() }, c2: { value: new THREE.Vector3() }, gapC: { value: new THREE.Vector3() }, grimeC: { value: new THREE.Vector3() }, spotC: { value: new THREE.Vector3() }, wearC: { value: new THREE.Vector3() }, stripeC: { value: new THREE.Vector3() },
        useImage: { value: false }, uImage: { value: null },
      },
      depthTest: false, depthWrite: false,
    });
    this.normMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: NORMAL_FRAG,
      uniforms: { tData: { value: null }, strength: { value: 1 }, texel: { value: 1 / 512 }, mode: { value: 0 }, blur: { value: 1 } },
      depthTest: false, depthWrite: false,
    });
  }

  _rt(S, srgb, mips) {
    const rt = new THREE.WebGLRenderTarget(S, S, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
      generateMipmaps: mips, minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
    return rt;
  }

  async generate(recipe, S, aniso = 4) {
    const r = normalizeRecipe(recipe);
    const U = this.genMat.uniforms;
    let imgTex = null;
    if (r.image) {
      imgTex = await new Promise((res) => {
        const im = new Image(); im.onload = () => { const t = new THREE.Texture(im); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; res(t); }; im.onerror = () => res(null); im.src = r.image;
      });
    }
    U.useImage.value = !!imgTex; U.uImage.value = imgTex;
    U.pattern.value = PATTERN_IDX[r.pattern] ?? 0;
    for (const k of ['noiseScale', 'noiseAmt', 'detail', 'gap', 'bevel', 'cellVar', 'jitter', 'chip', 'grime', 'grimeScale', 'streaks', 'cracks', 'spots', 'spotScale', 'edgeWear', 'grain', 'stripes', 'rough', 'roughVar', 'metal']) U[k].value = +r[k] || 0;
    U.offset_.value = +r.offset || 0; U.depth_.value = r.depth ?? 1;
    U.noiseOct.value = Math.max(1, Math.min(8, Math.round(r.noiseOct)));
    U.rows.value = Math.max(1, Math.round(r.rows)); U.cols.value = Math.max(1, Math.round(r.cols));
    U.seed.value = (r.seed | 0) * 977 + 13; U.stripeCount.value = Math.max(1, Math.round(r.stripeCount));
    U.c1.value.copy(srgbColor(r.color1)); U.c2.value.copy(srgbColor(r.color2)); U.gapC.value.copy(srgbColor(r.gapColor));
    U.grimeC.value.copy(srgbColor(r.grimeColor)); U.spotC.value.copy(srgbColor(r.spotColor)); U.wearC.value.copy(srgbColor(r.wearColor)); U.stripeC.value.copy(srgbColor(r.stripeColor));

    const renderer = this.r;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    const albedo = this._rt(S, true, true);
    const data = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: false });
    data.texture.wrapS = data.texture.wrapT = THREE.RepeatWrapping;
    const normal = this._rt(S, false, true);
    const orm = this._rt(S, false, true);
    this.quad.material = this.genMat;
    U.uPass.value = 0; renderer.setRenderTarget(albedo); renderer.render(this.scene, this.cam);
    U.uPass.value = 1; renderer.setRenderTarget(data); renderer.render(this.scene, this.cam);
    const N = this.normMat.uniforms;
    this.quad.material = this.normMat;
    N.tData.value = data.texture; N.texel.value = 1 / S; N.strength.value = (r.bump * (r.image ? 0.6 : 1)) * S / 400 / (r.image ? 2 : 1); N.blur.value = r.image ? 2 : 1;
    N.mode.value = 0; renderer.setRenderTarget(normal); renderer.render(this.scene, this.cam);
    N.mode.value = 1; renderer.setRenderTarget(orm); renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    data.dispose(); if (imgTex) imgTex.dispose();
    for (const t of [albedo.texture, normal.texture, orm.texture]) t.anisotropy = aniso;
    return { albedoRT: albedo, normalRT: normal, ormRT: orm, size: S };
  }

  // read a render target into a 2D canvas (for previews / PNG export)
  toCanvas(rt) {
    const S = rt.width;
    const px = new Uint8Array(S * S * 4);
    this.r.readRenderTargetPixels(rt, 0, 0, S, S, px);
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d'); const id = x.createImageData(S, S);
    // flip Y
    for (let y = 0; y < S; y++) id.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    x.putImageData(id, 0, 0);
    return c;
  }
}

let gen = null;
export function initTexGen(renderer) { gen = new GpuTexGen(renderer); return gen; }
export function texGen() { return gen; }
export async function generateTexture(recipe, S, aniso) { return gen.generate(recipe, S, aniso); }

import * as THREE from '../../lib/three.module.js';
import { QUALITY } from '../settings.js';

const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_FRAG = `
uniform sampler2D tSrc; uniform float uThreshold; varying vec2 vUv;
void main(){
  vec3 c = min(texture2D(tSrc, vUv).rgb, vec3(200.0));
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold * 2.5, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main(){
  vec3 s = texture2D(tSrc, vUv).rgb * 0.227027;
  s += texture2D(tSrc, vUv + uDir * 1.3846).rgb * 0.316216;
  s += texture2D(tSrc, vUv - uDir * 1.3846).rgb * 0.316216;
  s += texture2D(tSrc, vUv + uDir * 3.2308).rgb * 0.070270;
  s += texture2D(tSrc, vUv - uDir * 3.2308).rgb * 0.070270;
  gl_FragColor = vec4(s, 1.0);
}`;

const FINAL_FRAG = `
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tBlood;
uniform vec2 uRes; uniform float uTime, uExposure, uBloom, uVignette, uGrain, uCA, uBlood, uDesat, uFade, uFlash, uPulse, uTint, uBlur, uLift;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }
vec3 aces(vec3 c){
  const mat3 I = mat3(vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777));
  const mat3 O = mat3(vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602));
  c = I * (c / 0.6); c = RRTAndODTFit(c); c = O * c; return clamp(c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, pow(c, vec3(1.0/2.4)) * 1.055 - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main(){
  vec2 uv = vUv; vec2 d = uv - 0.5; float r = length(d * vec2(uRes.x/uRes.y, 1.0));
  float ca = uCA * (0.4 + r * r * 2.0) / uRes.x;
  vec2 dir = normalize(d + 1e-5);
  vec3 col;
  if (uBlur > 0.001) {
    vec2 px = 1.0 / uRes * uBlur * 3.0;
    col = texture2D(tScene, uv).rgb * 0.4;
    col += texture2D(tScene, uv + vec2(px.x, 0.0)).rgb * 0.15; col += texture2D(tScene, uv - vec2(px.x, 0.0)).rgb * 0.15;
    col += texture2D(tScene, uv + vec2(0.0, px.y)).rgb * 0.15; col += texture2D(tScene, uv - vec2(0.0, px.y)).rgb * 0.15;
  } else {
    col.r = texture2D(tScene, uv - dir * ca).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv + dir * ca).b;
  }
  col += texture2D(tBloom, uv).rgb * uBloom;
  col *= uExposure * (1.0 + uFlash * 6.0);
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // grade: cold shadows, slightly sick-green mids, desaturate when hurt
  vec3 shadowTint = vec3(0.86, 0.98, 1.10);
  col = mix(col * shadowTint, col, smoothstep(0.0, 0.55, l));
  col = mix(col, vec3(l), uDesat);
  col = mix(col, col * vec3(1.25, 0.55, 0.5), uTint);
  // vignette
  float vig = smoothstep(1.05, 0.25, r);
  col *= mix(1.0, vig, uVignette);
  // pulsing red edge when badly hurt
  col = mix(col, vec3(0.35, 0.0, 0.0), smoothstep(0.35, 1.0, r) * uPulse);
  col = toSRGB(clamp(col, 0.0, 1.0));
  col = pow(col, vec3(1.0 - uLift));
  // blood on the lens
  vec4 b = texture2D(tBlood, uv);
  float bm = b.a * clamp(uBlood * 1.1 - (1.0 - smoothstep(0.15, 0.75, r)) * 1.1, 0.0, 0.85);
  col = mix(col, b.rgb, bm);
  // film grain
  float n = hash(uv * uRes + fract(uTime * 7.13) * 91.7) - 0.5;
  col += n * uGrain * (1.15 - l * 0.6);
  col = mix(col, vec3(0.0), uFade);
  gl_FragColor = vec4(col, 1.0);
}`;

// Lights right next to a surface can push half-float render targets to Inf; clamp every lit
// material before it is written so one hot pixel can never turn the whole frame black via bloom.
let chunksPatched = false;
function patchChunks() {
  if (chunksPatched) return;
  chunksPatched = true;
  const c = THREE.ShaderChunk;
  c.opaque_fragment = c.opaque_fragment.replace(
    'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
    'outgoingLight = ( outgoingLight == outgoingLight ) ? min( outgoingLight, vec3( 20000.0 ) ) : vec3( 0.0 );\ngl_FragColor = vec4( outgoingLight, diffuseColor.a );');
}

export class Renderer {
  constructor(canvas) {
    patchChunks();
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.shadowMap.autoUpdate = false;
    this.gl.info.autoReset = false;
    this.scale = 1;          // adaptive resolution multiplier
    this.fx = { exposure: 1.0, bloom: 0.55, vignette: 0.75, grain: 0.06, ca: 1.2, blood: 0, desat: 0, fade: 0, flash: 0, pulse: 0, tint: 0, blur: 0, lift: 0.12 };
    const caps = this.gl.capabilities;
    const ext = this.gl.extensions;
    this.canHalf = caps.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.brightMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: BRIGHT_FRAG, uniforms: { tSrc: { value: null }, uThreshold: { value: 1.2 } }, depthTest: false, depthWrite: false });
    this.blurMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, tBlood: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 0 }, uVignette: { value: 0.7 }, uGrain: { value: 0.05 },
        uCA: { value: 1 }, uBlood: { value: 0 }, uDesat: { value: 0 }, uFade: { value: 0 }, uFlash: { value: 0 }, uPulse: { value: 0 }, uTint: { value: 0 }, uBlur: { value: 0 }, uLift: { value: 0.12 },
      },
    });
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.black.needsUpdate = true;
    this.finalMat.uniforms.tBloom.value = this.black;
    this.finalMat.uniforms.tBlood.value = this.black;
    this.setQuality('medium');
  }

  setBloodTexture(tex) { this.finalMat.uniforms.tBlood.value = tex; }

  setQuality(name) {
    this.qname = name;
    this.q = QUALITY[name] || QUALITY.medium;
    this.usePost = this.q.post && this.canHalf;
    this.gl.toneMapping = this.usePost ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.disposeTargets();
    this.resize(true);
  }

  disposeTargets() {
    for (const k of ['rtScene', 'rtA', 'rtB']) { if (this[k]) { this[k].dispose(); this[k] = null; } }
  }

  pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.max(0.5, Math.min(dpr * this.q.pr, this.q.maxPr) * this.scale);
  }

  resize(force) {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.pixelRatio();
    if (!force && w === this.w && h === this.h && pr === this.pr) return;
    this.w = w; this.h = h; this.pr = pr;
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const W = Math.max(2, Math.floor(w * pr)), H = Math.max(2, Math.floor(h * pr));
    if (this.usePost) {
      if (!this.rtScene) {
        this.rtScene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: this.q.msaa, depthBuffer: true });
        this.rtA = new THREE.WebGLRenderTarget(W >> 2, H >> 2, { type: THREE.HalfFloatType, depthBuffer: false });
        this.rtB = new THREE.WebGLRenderTarget(W >> 2, H >> 2, { type: THREE.HalfFloatType, depthBuffer: false });
      } else {
        this.rtScene.setSize(W, H); this.rtA.setSize(W >> 2, H >> 2); this.rtB.setSize(W >> 2, H >> 2);
      }
      this.finalMat.uniforms.uRes.value.set(W, H);
    }
  }

  setScale(s) {
    s = Math.max(0.55, Math.min(1, s));
    if (Math.abs(s - this.scale) < 0.01) return;
    this.scale = s;
    this.resize(true);
  }

  render(scene, camera, vmCamera, time) {
    const gl = this.gl;
    gl.info.reset();
    gl.shadowMap.needsUpdate = true;
    camera.layers.set(0);
    if (!this.usePost) {
      gl.setRenderTarget(null);
      gl.autoClear = true;
      gl.render(scene, camera);
      if (vmCamera) { gl.autoClear = false; gl.clearDepth(); gl.render(scene, vmCamera); gl.autoClear = true; }
      return;
    }
    gl.setRenderTarget(this.rtScene);
    gl.autoClear = true;
    gl.render(scene, camera);
    if (vmCamera) { gl.autoClear = false; gl.clearDepth(); gl.render(scene, vmCamera); gl.autoClear = true; }
    const fx = this.fx;
    let bloom = 0;
    if (this.q.bloom && fx.bloom > 0) {
      this.quad.material = this.brightMat;
      this.brightMat.uniforms.tSrc.value = this.rtScene.texture;
      gl.setRenderTarget(this.rtA); gl.render(this.postScene, this.postCam);
      this.quad.material = this.blurMat;
      const bw = this.rtA.width, bh = this.rtA.height;
      for (let i = 0; i < 2; i++) {
        this.blurMat.uniforms.tSrc.value = this.rtA.texture; this.blurMat.uniforms.uDir.value.set((1 + i) / bw, 0);
        gl.setRenderTarget(this.rtB); gl.render(this.postScene, this.postCam);
        this.blurMat.uniforms.tSrc.value = this.rtB.texture; this.blurMat.uniforms.uDir.value.set(0, (1 + i) / bh);
        gl.setRenderTarget(this.rtA); gl.render(this.postScene, this.postCam);
      }
      bloom = fx.bloom;
    }
    const u = this.finalMat.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloom.value = bloom > 0 ? this.rtA.texture : this.black;
    u.uTime.value = time;
    u.uExposure.value = fx.exposure; u.uBloom.value = bloom; u.uVignette.value = fx.vignette; u.uGrain.value = fx.grain;
    u.uCA.value = fx.ca; u.uBlood.value = fx.blood; u.uDesat.value = fx.desat; u.uFade.value = fx.fade; u.uFlash.value = fx.flash;
    u.uPulse.value = fx.pulse; u.uTint.value = fx.tint; u.uBlur.value = fx.blur; u.uLift.value = fx.lift;
    this.quad.material = this.finalMat;
    gl.setRenderTarget(null);
    gl.render(this.postScene, this.postCam);
  }
}

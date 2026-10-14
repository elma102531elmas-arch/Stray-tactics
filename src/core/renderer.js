// Renderer: owns the WebGLRenderer, the world + viewmodel two-pass render,
// optional bloom/grade post chain, frame limiter and dynamic resolution.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { settings, preset } from './settings.js';

// Final pass: exposure + ACES filmic + grading + vignette + sRGB, in one pass.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: 1.0 },
    saturation: { value: 1.08 },
    contrast: { value: 1.06 },
    vignette: { value: 0.28 },
    tint: { value: new THREE.Vector3(1.0, 0.99, 0.97) },
    damage: { value: 0 },
    flash: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float exposure, saturation, contrast, vignette, damage, flash; uniform vec3 tint;
    varying vec2 vUv;
    vec3 gRRT(vec3 v){ vec3 a=v*(v+0.0245786)-0.000090537; vec3 b=v*(0.983729*v+0.4329510)+0.238081; return a/b; }
    vec3 gAces(vec3 color){
      const mat3 i=mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
      const mat3 o=mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));
      color*=exposure/0.6; color=i*color; color=gRRT(color); color=o*color; return clamp(color,0.0,1.0);
    }
    vec3 gToSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(vec3(0.0031308),c)); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * tint;
      c = gAces(c);
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      c = mix(vec3(l), c, saturation);
      c = (c-0.5)*contrast+0.5;
      vec2 d = vUv-0.5; float v = 1.0 - dot(d,d)*vignette*2.2;
      c *= clamp(v,0.0,1.0);
      float edge = smoothstep(0.25,0.75,length(d)*1.4);
      c = mix(c, vec3(0.55,0.02,0.02), edge*damage);
      c += flash;
      gl_FragColor = vec4(gToSRGB(clamp(c,0.0,1.0)),1.0);
    }`,
};

export class Renderer {
  constructor(container) {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;
    container.appendChild(r.domElement);
    this.container = container; this.area = null;
    this.r = r;
    this.canvas = r.domElement;
    this.maxAniso = r.capabilities.getMaxAnisotropy();
    this.dynScale = 1; // dynamic-resolution multiplier
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    this.damage = 0; this.flash = 0;
    this.width = 1; this.height = 1;
    this.stats = { fps: 0, frameMs: 0, drawCalls: 0, tris: 0 };
    this._frames = 0; this._fpsT = 0; this._dtHist = [];
    this._dynTimer = 0; this._dynStable = 0;
    this.applySettings();
    window.addEventListener('resize', () => this.resize());
  }

  get usePost() { return settings.bloomOverride ?? preset().bloom; }

  applySettings() {
    const p = preset();
    this.r.shadowMap.type = p.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.r.shadowMap.needsUpdate = true;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, p.maxDpr) * p.renderScale * settings.renderScale;
    if (!settings.dynamicRes) this.dynScale = 1;
    this.setupPost();
    this.resize();
  }

  setupPost() {
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    if (!this.usePost) return;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    const c = new EffectComposer(this.r, rt);
    this.worldPass = new RenderPass(null, null);
    this.vmPass = new RenderPass(null, null);
    this.vmPass.clear = false; this.vmPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.92);
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.worldPass); c.addPass(this.vmPass); c.addPass(this.bloom); c.addPass(this.grade);
    this.composer = c;
  }

  // restrict rendering to a screen rectangle (editors), or null = full screen
  setArea(a) {
    this.area = a;
    const st = this.container.style;
    if (a) Object.assign(st, { left: a.x + 'px', top: a.y + 'px', width: a.w + 'px', height: a.h + 'px', right: 'auto', bottom: 'auto' });
    else Object.assign(st, { left: '0', top: '0', right: '0', bottom: '0', width: '', height: '' });
    this.resize();
  }

  resize() {
    const w = Math.max(1, Math.round(this.area ? this.area.w : window.innerWidth)), h = Math.max(1, Math.round(this.area ? this.area.h : window.innerHeight));
    this.width = w; this.height = h;
    const pr = Math.max(0.35, this.basePixelRatio * this.dynScale);
    this.r.setPixelRatio(pr);
    this.r.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      // bloom at reduced res is visually identical and much cheaper
      this.bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    }
    this.onResize && this.onResize(w, h);
  }

  // world: {scene,camera}; vm (optional): {scene,camera}
  render(world, vm) {
    const r = this.r;
    if (this.composer) {
      this.worldPass.scene = world.scene; this.worldPass.camera = world.camera;
      this.vmPass.enabled = !!vm;
      if (vm) { this.vmPass.scene = vm.scene; this.vmPass.camera = vm.camera; }
      this.grade.uniforms.damage.value = this.damage;
      this.grade.uniforms.flash.value = this.flash;
      this.composer.render();
    } else {
      r.setRenderTarget(null);
      r.clear(true, true, false);
      r.render(world.scene, world.camera);
      if (vm) { r.clearDepth(); r.render(vm.scene, vm.camera); }
    }
    this.stats.drawCalls = r.info.render.calls;
    this.stats.tris = r.info.render.triangles;
  }

  // called once per presented frame with the real frame interval (seconds)
  trackFrame(dt) {
    this._frames++; this._fpsT += dt;
    if (this._fpsT >= 0.5) { this.stats.fps = Math.round(this._frames / this._fpsT); this._frames = 0; this._fpsT = 0; }
    this.stats.frameMs = this.stats.frameMs * 0.9 + dt * 1000 * 0.1;
    if (!settings.dynamicRes) return;
    // Dynamic resolution: if we keep missing the target frame time, drop
    // render scale; if we are comfortably on target, slowly creep back up.
    const target = settings.fpsCap > 0 ? 1 / settings.fpsCap : 1 / 120;
    this._dtHist.push(dt); if (this._dtHist.length > 40) this._dtHist.shift();
    this._dynTimer += dt;
    if (this._dynTimer < 0.75 || this._dtHist.length < 40) return;
    this._dynTimer = 0;
    const sorted = this._dtHist.slice().sort((a, b) => a - b);
    const p50 = sorted[20];
    const disp = this.displayInterval || target;
    const goal = Math.max(target, disp);
    let next = this.dynScale;
    if (p50 > goal * 1.18) { next = Math.max(0.55, this.dynScale * 0.88); this._dynStable = 0; }
    else if (p50 < goal * 1.05) { this._dynStable++; if (this._dynStable >= 4) { next = Math.min(1, this.dynScale * 1.06); this._dynStable = 0; } }
    if (Math.abs(next - this.dynScale) > 0.01) { this.dynScale = next; this.resize(); }
  }
}

// Fixed-cap frame loop. rAF can only run up to the display refresh rate; on a
// 120/144 Hz screen we present every vsync, on faster screens we skip frames
// to respect the cap.
export function startLoop(tick) {
  let last = performance.now();
  let acc = 0;
  let lastRaf = last;
  const intervals = [];
  const loop = (now) => {
    requestAnimationFrame(loop);
    const rafDt = (now - lastRaf) / 1000; lastRaf = now;
    if (rafDt > 0 && rafDt < 0.1) { intervals.push(rafDt); if (intervals.length > 60) intervals.shift(); }
    const cap = settings.fpsCap;
    if (cap > 0) {
      acc += rafDt;
      const minDt = 1 / cap - 0.0015; // tolerance for vsync jitter
      if (acc < minDt) return;
      acc = Math.min(acc - 1 / cap, 1 / cap); if (acc < 0) acc = 0;
    }
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const sorted = intervals.slice().sort((a, b) => a - b);
    tick(dt, sorted.length ? sorted[sorted.length >> 1] : 1 / 60);
  };
  requestAnimationFrame(loop);
}

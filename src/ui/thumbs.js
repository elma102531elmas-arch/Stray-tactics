// Skin thumbnails for inventory / case cards: the real weapon model with the
// skin shader, rendered offscreen (MSAA HDR target -> ACES + sRGB pass) and
// cached as data URLs. Renders are queued so opening a big inventory never
// stalls a frame for long.
import * as THREE from 'three';
import { buildWeaponModel } from '../weapons/models.js';
import { applySkin, SKINS } from '../weapons/skins.js';

const W = 320, H = 168;
let R = null, ENV = null;
let hdr, ldr, scene, cam, quad, quadScene, quadCam;
const cache = new Map();
const models = new Map();
let chain = Promise.resolve();

export function initThumbs(renderer, environment) { R = renderer; ENV = environment; }

function setup() {
  hdr = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  ldr = new THREE.WebGLRenderTarget(W, H);
  scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xfff2e0, 2.6); key.position.set(1.5, 2.5, 1.2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 1.6); rim.position.set(-1.5, 0.6, -2); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7); fill.position.set(2, -0.5, 0.5); scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 0.55));
  cam = new THREE.PerspectiveCamera(16, W / H, 0.05, 20);
  quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tMap: { value: hdr.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tMap; varying vec2 vUv;
      vec3 rrt(vec3 v){ vec3 a=v*(v+0.0245786)-0.000090537; vec3 b=v*(0.983729*v+0.4329510)+0.238081; return a/b; }
      vec3 aces(vec3 c){
        const mat3 i=mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
        const mat3 o=mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));
        c *= 1.0 / 0.6; c = i * c; c = rrt(c); c = o * c; return clamp(c, 0.0, 1.0); }
      vec3 srgb(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(vec3(0.0031308),c)); }
      void main(){ vec4 t = texture2D(tMap, vUv); vec3 c = t.a > 0.0 ? t.rgb / t.a : vec3(0.0); gl_FragColor = vec4(srgb(aces(c)), t.a); }`,
    depthTest: false, depthWrite: false,
  }));
  quadScene = new THREE.Scene(); quadScene.add(quad);
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
}

async function model(kind) {
  if (!models.has(kind)) models.set(kind, buildWeaponModel(kind));
  return models.get(kind);
}

async function render(kind, skinId, wear, seed) {
  if (!R) return '';
  if (!hdr) setup();
  const m = await model(kind);
  const root = m.root;
  root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.setScalar(1);
  if (m.nodes.handleA) m.nodes.handleA.rotation.x = 0;
  if (m.nodes.handleB) m.nodes.handleB.rotation.x = 0;
  const holder = new THREE.Group(); holder.add(root);
  // 3/4 side view, muzzle to the right
  holder.rotation.set(0.06, Math.PI / 2 - 0.32, 0.04);
  scene.add(holder);
  holder.updateMatrixWorld(true);
  const undo = skinId ? applySkin(root, skinId, { wear, seed }) : null;
  const box = new THREE.Box3().setFromObject(holder), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  holder.position.sub(c);
  const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const dist = Math.max(size.y / (2 * tan), size.x / (2 * tan * cam.aspect)) * 1.12 + size.z / 2;
  cam.position.set(0, 0, dist); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
  scene.environment = ENV;
  // compile the skin shaders off the main thread where supported
  if (R.compileAsync) {
    const prev = R.getRenderTarget();
    R.setRenderTarget(hdr);
    const done = R.compileAsync(scene, cam);
    R.setRenderTarget(prev);
    await done;
  }
  const prevT = R.getRenderTarget(), prevC = R.getClearColor(new THREE.Color()), prevA = R.getClearAlpha();
  R.setRenderTarget(hdr); R.setClearColor(0x000000, 0); R.clear(); R.render(scene, cam);
  R.setRenderTarget(ldr); R.clear(); R.render(quadScene, quadCam);
  const px = new Uint8Array(W * H * 4); R.readRenderTargetPixels(ldr, 0, 0, W, H, px);
  R.setRenderTarget(prevT); R.setClearColor(prevC, prevA);
  if (undo) undo();
  scene.remove(holder); holder.remove(root);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d'), img = x.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  x.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

// thumbnail of a weapon (kind) with an optional skin -> Promise<dataURL>
// (one render per skin + pattern variant; wear is shown as factory new)
export function thumb(kind, skinId = null, seed = 0) {
  const v = skinId ? seed % 4 : 0, key = kind + '|' + (skinId || '') + '|' + v;
  if (!cache.has(key)) {
    const p = (chain = chain.then(() => new Promise((res) => requestAnimationFrame(() => res())))
      .then(() => render(kind, skinId && SKINS[skinId] && SKINS[skinId].p !== 'none' ? skinId : null, 0.02, v * 211))
      .catch((e) => { console.warn('thumb', e); return ''; }));
    cache.set(key, p);
  }
  return cache.get(key);
}

// <img> that fills in when the thumbnail is ready
export function thumbImg(kind, skinId, seed = 0, cls = 'thumb') {
  const img = document.createElement('img');
  img.className = cls; img.alt = ''; img.draggable = false;
  thumb(kind, skinId, seed).then((u) => { if (u) img.src = u; });
  return img;
}

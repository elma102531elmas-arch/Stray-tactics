import * as THREE from 'three';
import { Renderer, startLoop } from './core/renderer.js';
import { World } from './world/world.js';
import { makeKasbah } from './world/maps/kasbah.js';
import { materials } from './gfx/materials.js';
import { ViewModel } from './weapons/viewmodel.js';

import { settings } from './core/settings.js';

export async function runDebug() {
const qq = new URLSearchParams(location.search);
if (qq.get('model')) return modelViewer(qq);
if (new URLSearchParams(location.search).get('nopost')) settings.bloomOverride = false;
const renderer = new Renderer(document.getElementById('app'));
materials.init(renderer.r);
const world = new World(renderer);
const cam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 1000);
window.__T = { renderer, world, cam, THREE };
await (async () => {
  const q = new URLSearchParams(location.search);
  const b = await world.load(makeKasbah(), { fast: !!q.get('fast') });
  console.log('BUILT', JSON.stringify(b.stats));
  const v = (q.get('cam') || '0,1.7,26,0,0').split(',').map(Number);
  cam.position.set(v[0], v[1], v[2]); cam.rotation.set(v[4] * Math.PI / 180, v[3] * Math.PI / 180, 0, 'YXZ');
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  let vm = null;
  if (q.get('vm')) {
    vm = new ViewModel(); await vm.init(); window.__T.vm = vm;
    await vm.equip(q.get('vm'), { noDraw: true });
    if (q.get('pose')) {
      // static pose test: tracks JSON applied as a 1-key clip
      const tracks = JSON.parse(q.get('pose'));
      const clip = { name: 'test', duration: 100, tracks, events: [] };
      vm.player.play(clip, { blend: 0 }); vm.player.update(0);
      if (q.get('magstate')) { vm.magState = q.get('magstate'); vm.magBlend = 1; }
      if (q.get('lpose')) vm.lPoseName = q.get('lpose');
    }
    if (q.get('hip')) { const h = q.get('hip').split(',').map(Number); vm.def.vm.hip = { p: h.slice(0, 3), r: h.slice(3, 6) }; }
  }
  window.__ready = true;
  let rigCam = null;
  if (q.get('rig') && vm) {
    // debug: look at the viewmodel rig from an outside camera (vm space)
    const r = q.get('rig').split(',').map(Number);
    rigCam = new THREE.PerspectiveCamera(40, cam.aspect, 0.01, 10);
    rigCam.position.set(r[0], r[1], r[2]); rigCam.lookAt(r[3], r[4], r[5]);
    vm.scene.add(rigCam);
    const grid = new THREE.GridHelper(1, 20, 0x666666, 0x333333); grid.position.y = -0.3; vm.scene.add(grid);
    vm.scene.background = new THREE.Color(0x30343a);
  }
  const frame = () => {
    if (vm) { vm.sync(cam, world, cam.aspect); }
    if (rigCam) { renderer.r.setRenderTarget(null); renderer.r.clear(); renderer.r.render(vm.scene, rigCam); return; }
    renderer.render({ scene: world.scene, camera: cam }, vm ? { scene: vm.scene, camera: vm.camera } : null);
  };
  if (q.get('sheet') && vm) {
    // contact sheet: simulate the clip at 60fps, grab frames at given times
    const times = q.get('sheet').split(',').map(Number);
    const clip = q.get('clip');
    const cols = +(q.get('cols') || 4);
    const W = renderer.canvas.width, H = renderer.canvas.height;
    const sw = Math.floor(W / 2), sh = Math.floor(H / 2);
    const rows = Math.ceil(times.length / cols);
    const sheet = document.createElement('canvas'); sheet.width = sw * cols; sheet.height = sh * rows;
    const sx = sheet.getContext('2d');
    if (clip) vm.play(clip, { blend: 0 });
    let t = 0, i = 0; const dt = 1 / 60;
    while (i < times.length) {
      if (t >= times[i] - 1e-6) {
        vm.update(0, {}); frame();
        sx.drawImage(renderer.canvas, (i % cols) * sw, Math.floor(i / cols) * sh, sw, sh);
        sx.fillStyle = '#fff'; sx.font = '20px monospace'; sx.fillText(clip + ' t=' + times[i].toFixed(2), (i % cols) * sw + 8, Math.floor(i / cols) * sh + 24);
        i++; continue;
      }
      vm.update(dt, {}); t += dt;
    }
    window.__sheet = sheet.toDataURL('image/png');
    window.__shot = true; return;
  }
  if (q.get('once')) {
    if (vm) vm.update(1 / 60, {});
    frame(); window.__shot = true; return;
  }
  startLoop((dt) => { world.update(dt); if (vm) vm.update(dt, {}); frame(); });
})();
}

// ?dbg=1&model=<name>&view=x,y,z : inspect an embedded glTF (axes: X red, Y green, Z blue)
// ?dbg=1&model=a,b,c,... : grid of several models
async function modelViewer(q) {
  const { loadGLTF } = await import('./assets/loader.js');
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(innerWidth, innerHeight); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  document.getElementById('app').appendChild(r.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x505860);
  const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const l = new THREE.DirectionalLight(0xffffff, 2); l.position.set(2, 3, 2); scene.add(l);
  const names = q.get('model').split(',');
  if (names.length > 1) {
    const cols = Math.ceil(Math.sqrt(names.length * innerWidth / innerHeight * 0.75)), rows = Math.ceil(names.length / cols);
    const tw = Math.floor(innerWidth / cols), th = Math.floor(innerHeight / rows);
    const v = (q.get('view') || '1,0.6,1.4').split(',').map(Number);
    r.setScissorTest(true); r.autoClear = false;
    for (let i = 0; i < names.length; i++) {
      const g = await loadGLTF(names[i]);
      const root = g.scene.clone(); scene.add(root);
      const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const cam = new THREE.PerspectiveCamera(35, tw / th, 0.001, 100);
      cam.position.copy(c).add(new THREE.Vector3(v[0], v[1], v[2]).normalize().multiplyScalar(Math.max(size.x, size.y, size.z) * 1.9)); cam.lookAt(c);
      const x = (i % cols) * tw, y = innerHeight - (Math.floor(i / cols) + 1) * th;
      r.setViewport(x, y, tw, th); r.setScissor(x, y, tw, th); r.clear(); r.render(scene, cam);
      scene.remove(root);
      console.log('MODEL', names[i], size.toArray().map((s) => s.toFixed(2)).join('x'));
    }
    window.__shot = true; return;
  }
  const g = await loadGLTF(names[0]);
  const root = g.scene; scene.add(root);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const info = { size: size.toArray().map((v) => +v.toFixed(3)), center: c.toArray().map((v) => +v.toFixed(3)), nodes: [] };
  root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { const b = new THREE.Box3().setFromObject(o); info.nodes.push([o.name, o.isSkinnedMesh ? 'skinned' : 'mesh', b.min.toArray().map((v) => +v.toFixed(3)), b.max.toArray().map((v) => +v.toFixed(3)), o.material.name]); } });
  info.anims = g.animations.map((a) => a.name);
  console.log('MODEL', JSON.stringify(info));
  const axes = new THREE.AxesHelper(Math.max(size.x, size.y, size.z) * 0.6); axes.position.copy(c); scene.add(axes);
  const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.001, 100);
  const v = (q.get('view') || '1,0.6,1.4').split(',').map(Number);
  const dist = Math.max(size.x, size.y, size.z) * 1.6;
  cam.position.copy(c).add(new THREE.Vector3(v[0], v[1], v[2]).normalize().multiplyScalar(dist)); cam.lookAt(c);
  r.render(scene, cam);
  window.__shot = true;
}

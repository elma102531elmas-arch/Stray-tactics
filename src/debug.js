import * as THREE from 'three';
import { Renderer, startLoop } from './core/renderer.js';
import { World } from './world/world.js';
import { makeKasbah } from './world/maps/kasbah.js';
import { materials } from './gfx/materials.js';
import { ViewModel } from './weapons/viewmodel.js';

import { settings } from './core/settings.js';

export async function runDebug() {
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

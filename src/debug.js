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
if (qq.get('hand')) return handViewer(qq);
if (qq.get('ortho')) return orthoViewer(qq);
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
    // &grip=x,y,z : override the right-hand socket position (gun space) for tuning
    // &grip=x,y,z[,yx,yy,yz,zx,zy,zz] : override the right-hand socket (gun space) for tuning
    if (q.get('grip')) {
      const g = q.get('grip').split(',').map(Number);
      const so = { ...vm.active.sockets.grip, p: g.slice(0, 3) };
      if (g.length >= 9) { so.y = g.slice(3, 6); so.z = g.slice(6, 9); }
      vm.active.sockets = { ...vm.active.sockets, grip: so };
      vm.active.gripQ = (await import('./weapons/models.js')).socketQuat(so);
    }
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
  if (q.get('anim')) {
    const mixer = new THREE.AnimationMixer(root);
    const clip = g.animations.find((a) => a.name === q.get('anim'));
    if (clip) { mixer.clipAction(clip).play(); mixer.update(+(q.get('t') || 0)); }
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  if (q.get('focus')) {
    // frame a bone: &focus=mixamorig:RightHand&dist=0.4
    const b = root.getObjectByName(q.get('focus'));
    if (b) { b.getWorldPosition(c); size.setScalar(+(q.get('dist') || 0.4)); }
  }
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

// ?dbg=1&hand=grip&side=1&views=4 : first-person hand rig close-up (pose test)
async function handViewer(q) {
  const { buildArms } = await import('./weapons/arms.js');
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(innerWidth, innerHeight); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  document.getElementById('app').appendChild(r.domElement);
  materials.init(r);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x505860);
  const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const l = new THREE.DirectionalLight(0xffffff, 2.5); l.position.set(1, 3, 2); scene.add(l);
  const arms = await buildArms({ procedural: !!q.get('proc') });
  const side = +(q.get('side') || 1);
  const arm = side > 0 ? arms.right : arms.left;
  scene.add(arm.mesh);
  // forearm along +Y ending at the origin, hand frame = identity
  arm.solve(new THREE.Vector3(0.05 * side, -0.55, 0.12), new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, 1));
  arm.setHandPose(q.get('hand'), 1);
  arm.mesh.updateMatrixWorld(true);
  const views = [[0.0, 0.08, 0.32], [0.3, 0.08, 0.0], [0.0, 0.08, -0.32], [-0.3, 0.12, 0.05]].slice(0, +(q.get('views') || 4));
  r.setScissorTest(true); r.autoClear = false;
  const tw = Math.floor(innerWidth / views.length);
  views.forEach((v, i) => {
    const cam = new THREE.PerspectiveCamera(40, tw / innerHeight, 0.005, 10);
    cam.position.set(v[0], v[1], v[2]); cam.lookAt(0, 0.07, 0);
    r.setViewport(i * tw, 0, tw, innerHeight); r.setScissor(i * tw, 0, tw, innerHeight); r.clear(); r.render(scene, cam);
  });
  window.__shot = true;
}

// ?dbg=1&ortho=gun_ak[&side=1|-1][&top=1] : orthographic side view with a 1 cm grid
// (labels every 5 cm) and part boxes, to read gun-space coordinates for sockets.
async function orthoViewer(q) {
  const { loadGLTF } = await import('./assets/loader.js');
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(innerWidth, innerHeight); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  document.getElementById('app').appendChild(r.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x3a4048);
  const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const g = await loadGLTF(q.get('ortho'));
  const root = g.scene.clone(); scene.add(root);
  const off = (q.get('off') || '0,0,0').split(',').map(Number); root.position.set(...off);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const top = !!q.get('top');
  // camera looks from +X (right side: muzzle to the right since -Z is forward) or from above
  const span = Math.max(box.max.z - box.min.z, (box.max.y - box.min.y) * innerWidth / innerHeight) * 0.56;
  const cam = new THREE.OrthographicCamera(-span, span, span * innerHeight / innerWidth, -span * innerHeight / innerWidth, 0.01, 10);
  const c = box.getCenter(new THREE.Vector3());
  if (top) { cam.position.set(c.x, 3, c.z); cam.up.set(-1, 0, 0); cam.lookAt(c.x, 0, c.z); } else { cam.position.set(3, c.y, c.z); cam.lookAt(0, c.y, c.z); }
  cam.updateMatrixWorld();
  r.render(scene, cam);
  // overlay grid + labels with a 2D canvas
  const cv = document.createElement('canvas'); cv.width = innerWidth; cv.height = innerHeight;
  cv.style.cssText = 'position:fixed;inset:0;pointer-events:none'; document.body.appendChild(cv);
  const x = cv.getContext('2d');
  const toScr = (v) => { const p = v.clone().project(cam); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; };
  const a = top ? 'x' : 'y';
  const lo = Math.floor(Math.min(box.min.z, box.min[a]) * 100) - 4, hi = Math.ceil(Math.max(box.max.z, box.max[a]) * 100) + 4;
  for (let i = lo; i <= hi; i++) {
    const strong = i % 5 === 0;
    x.strokeStyle = i === 0 ? 'rgba(255,80,80,0.9)' : strong ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)';
    x.lineWidth = i === 0 ? 2 : 1;
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    // vertical lines: constant z
    v1.set(0, 0, i / 100); v1[a] = -1; v2.set(0, 0, i / 100); v2[a] = 1;
    let p1 = toScr(v1), p2 = toScr(v2); x.beginPath(); x.moveTo(p1[0], p1[1]); x.lineTo(p2[0], p2[1]); x.stroke();
    if (strong) { x.fillStyle = '#fff'; x.font = '11px monospace'; x.fillText('z' + i, p1[0] + 2, 12); }
    // horizontal lines: constant y (or x when top view)
    v1.set(0, 0, -2); v1[a] = i / 100; v2.set(0, 0, 2); v2[a] = i / 100;
    p1 = toScr(v1); p2 = toScr(v2); x.beginPath(); x.moveTo(p1[0], p1[1]); x.lineTo(p2[0], p2[1]); x.stroke();
    if (strong) { x.fillStyle = '#fff'; x.fillText(a + i, 2, p1[1] - 2); }
  }
  // part boxes
  const cols = ['#ff5a5a', '#5aff7a', '#5ab4ff', '#ffd25a', '#ff5af0', '#5afff0', '#ffa05a'];
  let k = 0; const info = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    const p1 = toScr(top ? new THREE.Vector3(b.min.x, 0, b.min.z) : new THREE.Vector3(0, b.min.y, b.min.z));
    const p2 = toScr(top ? new THREE.Vector3(b.max.x, 0, b.max.z) : new THREE.Vector3(0, b.max.y, b.max.z));
    x.strokeStyle = cols[k % cols.length]; x.lineWidth = 1; x.setLineDash([4, 3]);
    x.strokeRect(Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1]));
    x.setLineDash([]); x.fillStyle = cols[k % cols.length]; x.font = '12px monospace';
    x.fillText(o.name, Math.min(p1[0], p2[0]) + 2, Math.max(p1[1], p2[1]) + 13);
    info.push([o.name, b.min.toArray().map((v) => +v.toFixed(3)), b.max.toArray().map((v) => +v.toFixed(3))]);
    k++;
  });
  console.log('PARTS ' + JSON.stringify(info));
  // composite the overlay onto the GL canvas for the screenshot
  window.__shot = true;
}

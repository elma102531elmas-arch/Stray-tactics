// World effects with fixed pools (no allocations while playing, few draw
// calls): particles (2 draw calls), decals (instanced), tracers, brass
// shells (instanced, with bounce physics), dropped magazines.
import * as THREE from 'three';
import { audio } from './audio.js';

const PVERT = /* glsl */`
attribute float psize; attribute vec4 pcolor; uniform float scale; varying vec4 vColor;
#include <common>
#include <fog_pars_vertex>
void main(){ vColor = pcolor; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_PointSize = psize * scale / max(0.05, -mvPosition.z); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const PFRAG = /* glsl */`
uniform float soft; varying vec4 vColor;
#include <common>
#include <fog_pars_fragment>
void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard;
  float a = soft > 0.5 ? (1.0 - r) * (1.0 - r) : smoothstep(1.0, 0.15, r);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
}`;

class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0; this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 500 }, soft: { value: additive ? 0 : 1 } }]),
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    // per particle state
    this.p = []; for (let i = 0; i < max; i++) this.p.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0.1, s1: 0.1, r: 1, g: 1, b: 1, a0: 1, a1: 0, grav: 0, drag: 0 });
  }
  emit(o) {
    const p = this.p[this.cursor]; this.cursor = (this.cursor + 1) % this.max;
    p.alive = true; p.x = o.x; p.y = o.y; p.z = o.z; p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = 0; p.max = o.life || 1; p.s0 = o.s0 ?? 0.1; p.s1 = o.s1 ?? p.s0; p.r = o.r ?? 1; p.g = o.g ?? 1; p.b = o.b ?? 1;
    p.a0 = o.a0 ?? 1; p.a1 = o.a1 ?? 0; p.grav = o.grav || 0; p.drag = o.drag || 0;
  }
  update(dt) {
    const P = this.pos, C = this.col, S = this.size;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (!p.alive) { S[i] = 0; continue; }
      p.life += dt;
      if (p.life >= p.max) { p.alive = false; S[i] = 0; continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.01 && p.grav > 0) { p.y = 0.01; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const t = p.life / p.max;
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      C[i * 4] = p.r; C[i * 4 + 1] = p.g; C[i * 4 + 2] = p.b; C[i * 4 + 3] = p.a0 + (p.a1 - p.a0) * t;
      S[i] = p.s0 + (p.s1 - p.s0) * t;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.pcolor.needsUpdate = true; g.attributes.psize.needsUpdate = true;
  }
}

function decalTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  if (kind === 'blood') {
    for (let i = 0; i < 14; i++) {
      const r = 4 + Math.random() * 12, a = Math.random() * Math.PI * 2, d = Math.random() * 18;
      x.fillStyle = `rgba(${90 + Math.random() * 30},${5 + Math.random() * 8},${5 + Math.random() * 8},${0.6 + Math.random() * 0.35})`;
      x.beginPath(); x.arc(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, r, 0, Math.PI * 2); x.fill();
    }
  } else {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(8,6,5,1)'); g.addColorStop(0.18, 'rgba(15,12,10,0.95)'); g.addColorStop(0.3, 'rgba(60,50,40,0.55)'); g.addColorStop(0.6, 'rgba(70,60,48,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = 'rgba(20,16,12,0.5)'; x.lineWidth = 1;
    for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2; x.beginPath(); x.moveTo(32, 32); x.lineTo(32 + Math.cos(a) * (10 + Math.random() * 12), 32 + Math.sin(a) * (10 + Math.random() * 12)); x.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class Decals {
  constructor(scene, max, kind) {
    this.max = max; this.cursor = 0;
    const m = new THREE.MeshStandardMaterial({ map: decalTexture(kind), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: kind === 'blood' ? 0.35 : 1, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 2;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
  }
  add(point, normal, size) {
    this._q.setFromUnitVectors(_Z, normal);
    this._q2.setFromAxisAngle(_Z, Math.random() * Math.PI * 2);
    this._q.multiply(this._q2);
    this._p.copy(point).addScaledVector(normal, 0.004);
    this._s.set(size, size, size);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(this.cursor, this._m);
    this.cursor = (this.cursor + 1) % this.max;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { const zero = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, zero); this.mesh.instanceMatrix.needsUpdate = true; }
}
const _Z = new THREE.Vector3(0, 0, 1);

export class Effects {
  constructor(world) {
    this.world = world;
    const scene = world.scene;
    this.group = new THREE.Group(); this.group.name = 'fx'; scene.add(this.group);
    this.soft = new Particles(this.group, 900, false);
    this.glow = new Particles(this.group, 500, true);
    this.holes = new Decals(this.group, 220, 'hole');
    this.blood = new Decals(this.group, 60, 'blood');
    // tracers
    const tg = new THREE.PlaneGeometry(1, 1); tg.translate(0, 0.5, 0);
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.tracers = [];
    for (let i = 0; i < 24; i++) {
      const g = new THREE.Group();
      const a = new THREE.Mesh(tg, tm); const b = new THREE.Mesh(tg, tm); b.rotation.y = Math.PI / 2;
      g.add(a, b); g.visible = false; this.group.add(g);
      this.tracers.push({ obj: g, t: 0, len: 0, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, speed: 0 });
    }
    // shells
    const sg = new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 8); sg.rotateZ(Math.PI / 2);
    this.shellMesh = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 }), 80);
    this.shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.shellMesh.frustumCulled = false; this.shellMesh.castShadow = false;
    this.group.add(this.shellMesh);
    this.shells = []; for (let i = 0; i < 80; i++) this.shells.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), t: 0, bounced: 0, scale: 1 });
    this.shellCursor = 0;
    this.mags = [];
    this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(1, 1, 1);
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 80; i++) this.shellMesh.setMatrixAt(i, this.zero);
  }

  setViewport(height, fov) {
    const s = height / (2 * Math.tan((fov * Math.PI / 180) / 2));
    this.soft.mat.uniforms.scale.value = s; this.glow.mat.uniforms.scale.value = s;
  }

  // ------------------------------------------------------------ emitters
  impact(point, normal, mat, opts = {}) {
    const kind = matKind(mat);
    const n = normal;
    if (!opts.noDecal && kind !== 'flesh') this.holes.add(point, n, kind === 'sand' ? 0.09 : 0.065 + Math.random() * 0.02);
    const col = kind === 'sand' ? [0.78, 0.66, 0.48] : kind === 'wood' ? [0.45, 0.32, 0.2] : kind === 'metal' ? [0.5, 0.5, 0.52] : [0.72, 0.64, 0.52];
    // dust puff
    const puffs = kind === 'sand' ? 7 : 4;
    for (let i = 0; i < puffs; i++) {
      const s = 0.6 + Math.random() * 1.6;
      this.soft.emit({ x: point.x + n.x * 0.03, y: point.y + n.y * 0.03, z: point.z + n.z * 0.03, vx: (n.x + (Math.random() - 0.5) * 0.8) * s, vy: (n.y + Math.random() * 0.6) * s, vz: (n.z + (Math.random() - 0.5) * 0.8) * s,
        life: 0.6 + Math.random() * 0.9, s0: 0.06, s1: 0.35 + Math.random() * 0.4, r: col[0], g: col[1], b: col[2], a0: 0.55, a1: 0, drag: 3, grav: -0.15 });
    }
    // debris chips
    for (let i = 0; i < (kind === 'sand' ? 3 : 6); i++) {
      this.soft.emit({ x: point.x, y: point.y, z: point.z, vx: n.x * 3 + (Math.random() - 0.5) * 3, vy: n.y * 3 + Math.random() * 3, vz: n.z * 3 + (Math.random() - 0.5) * 3,
        life: 0.6 + Math.random() * 0.5, s0: 0.022, s1: 0.018, r: col[0] * 0.6, g: col[1] * 0.6, b: col[2] * 0.6, a0: 1, a1: 1, grav: 9, drag: 0.5 });
    }
    // sparks
    if (kind === 'metal' || kind === 'stone') {
      const ns = kind === 'metal' ? 10 : 3;
      for (let i = 0; i < ns; i++) {
        const sp = 4 + Math.random() * 7;
        this.glow.emit({ x: point.x, y: point.y, z: point.z, vx: (n.x + (Math.random() - 0.5)) * sp, vy: (n.y + Math.random() * 0.8) * sp, vz: (n.z + (Math.random() - 0.5)) * sp,
          life: 0.12 + Math.random() * 0.25, s0: 0.03, s1: 0.01, r: 3, g: 1.8, b: 0.6, a0: 1, a1: 0, grav: 12 });
      }
    }
    if (!opts.silent) audio.play('impact_' + (kind === 'flesh' ? 'flesh' : kind), { pos: point, vol: 0.55, pitchVar: 0.3, reverb: 0.1 });
  }

  bloodHit(point, dir) {
    for (let i = 0; i < 10; i++) {
      const s = 0.5 + Math.random() * 2.5;
      this.soft.emit({ x: point.x, y: point.y, z: point.z, vx: (dir.x + (Math.random() - 0.5) * 0.9) * s, vy: (dir.y + Math.random() * 0.7) * s, vz: (dir.z + (Math.random() - 0.5) * 0.9) * s,
        life: 0.35 + Math.random() * 0.4, s0: 0.05, s1: 0.22, r: 0.42, g: 0.02, b: 0.02, a0: 0.85, a1: 0, drag: 4, grav: 2 });
    }
    // splatter on the wall behind the target
    const hit = this.world.collision && this.world.collision.raycast(point, dir, 2.5, {});
    if (hit) this.blood.add(hit.point, hit.normal, 0.35 + Math.random() * 0.4);
    audio.play('impact_flesh', { pos: point, vol: 0.7, pitchVar: 0.2 });
  }

  muzzleSmoke(pos, dir) {
    for (let i = 0; i < 2; i++) {
      this.soft.emit({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * 1.5 + (Math.random() - 0.5) * 0.4, vy: dir.y * 1.5 + 0.3 + Math.random() * 0.3, vz: dir.z * 1.5 + (Math.random() - 0.5) * 0.4,
        life: 0.7 + Math.random() * 0.6, s0: 0.05, s1: 0.32, r: 0.75, g: 0.74, b: 0.72, a0: 0.18, a1: 0, drag: 2.5, grav: -0.25 });
    }
  }
  muzzleFlash(pos, dir) {
    for (let i = 0; i < 3; i++) this.glow.emit({ x: pos.x + dir.x * i * 0.06, y: pos.y + dir.y * i * 0.06, z: pos.z + dir.z * i * 0.06, life: 0.05, s0: 0.28 - i * 0.06, s1: 0.1, r: 4, g: 2.6, b: 1.1, a0: 1, a1: 0 });
    this.world.flash(pos, 5);
  }

  tracer(from, to, speed = 380) {
    const t = this.tracers.find((x) => !x.obj.visible) || this.tracers[0];
    t.from.copy(from); t.dir.subVectors(to, from); t.dist = t.dir.length(); if (t.dist < 1) return; t.dir.multiplyScalar(1 / t.dist);
    t.t = 0; t.speed = speed; t.len = Math.min(3.5, t.dist * 0.5);
    t.obj.visible = true;
    t.obj.quaternion.setFromUnitVectors(_Y, t.dir);
    t.obj.scale.set(0.012, t.len, 0.012);
  }

  shell(pos, vel, scale = 1) {
    const s = this.shells[this.shellCursor]; this.shellCursor = (this.shellCursor + 1) % this.shells.length;
    s.alive = true; s.p.copy(pos); s.v.copy(vel); s.t = 0; s.bounced = 0; s.scale = scale;
    s.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    s.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
  }

  // drop a copy of a magazine node (viewmodel) into the world with physics
  dropMag(node, worldMatrix, vel) {
    const obj = node.clone(true);
    obj.matrixAutoUpdate = true;
    worldMatrix.decompose(obj.position, obj.quaternion, obj.scale);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = true; } });
    this.group.add(obj);
    const m = { obj, v: vel.clone(), w: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8), t: 0, rest: false, played: false };
    this.mags.push(m);
    if (this.mags.length > 6) { const o = this.mags.shift(); this.group.remove(o.obj); }
  }

  clear() {
    this.holes.clear(); this.blood.clear();
    for (const m of this.mags) this.group.remove(m.obj); this.mags.length = 0;
    for (const s of this.shells) s.alive = false;
  }

  update(dt, camera) {
    this.soft.update(dt); this.glow.update(dt);
    for (const t of this.tracers) {
      if (!t.obj.visible) continue;
      t.t += dt;
      const head = t.t * t.speed;
      if (head - t.len > t.dist) { t.obj.visible = false; continue; }
      const tail = Math.max(0, head - t.len), hd = Math.min(head, t.dist);
      t.obj.position.copy(t.from).addScaledVector(t.dir, tail);
      t.obj.scale.y = Math.max(0.01, hd - tail);
    }
    const col = this.world.collision;
    let any = false;
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (!s.alive) continue;
      any = true;
      s.t += dt;
      if (s.t > 5) { s.alive = false; this.shellMesh.setMatrixAt(i, this.zero); continue; }
      s.v.y -= 11 * dt; s.p.addScaledVector(s.v, dt);
      const gy = col ? col.groundHeight(s.p.x, s.p.z, s.p.y + 0.1, 0) : 0;
      if (s.p.y < gy + 0.005) {
        s.p.y = gy + 0.005;
        if (s.v.y < -0.6) { if (s.bounced < 2 && camera && s.p.distanceTo(camera.position) < 12) audio.play('shell', { pos: s.p, vol: 0.35, pitchVar: 0.4, reverb: 0.05 }); s.bounced++; }
        s.v.y = -s.v.y * 0.35; s.v.x *= 0.5; s.v.z *= 0.5; s.w.multiplyScalar(0.5);
        if (Math.abs(s.v.y) < 0.3) s.v.y = 0;
      }
      if (s.v.lengthSq() > 0.01) { this._q.setFromEuler(new THREE.Euler(s.w.x * dt, s.w.y * dt, s.w.z * dt)); s.q.multiply(this._q); }
      this._s.setScalar(s.scale);
      this._m.compose(s.p, s.q, this._s);
      this.shellMesh.setMatrixAt(i, this._m);
    }
    if (any) this.shellMesh.instanceMatrix.needsUpdate = true;
    for (const m of this.mags) {
      m.t += dt;
      if (m.rest) continue;
      m.v.y -= 10 * dt; m.obj.position.addScaledVector(m.v, dt);
      m.obj.rotation.x += m.w.x * dt; m.obj.rotation.y += m.w.y * dt; m.obj.rotation.z += m.w.z * dt;
      const gy = col ? col.groundHeight(m.obj.position.x, m.obj.position.z, m.obj.position.y + 0.2, 0) : 0;
      if (m.obj.position.y < gy + 0.02) {
        m.obj.position.y = gy + 0.02;
        if (!m.played) { audio.play('magDrop', { pos: m.obj.position, vol: 0.6 }); m.played = true; }
        m.v.y *= -0.25; m.v.x *= 0.4; m.v.z *= 0.4; m.w.multiplyScalar(0.4);
        if (Math.abs(m.v.y) < 0.4) { m.rest = true; m.obj.rotation.x = Math.round(m.obj.rotation.x / (Math.PI / 2)) * Math.PI / 2; m.obj.rotation.z = Math.round(m.obj.rotation.z / (Math.PI / 2)) * Math.PI / 2; }
      }
    }
  }
}
const _Y = new THREE.Vector3(0, 1, 0);

export function matKind(mat) {
  if (!mat) return 'stone';
  if (mat === 'flesh') return 'flesh';
  if (mat.includes('sand') && mat !== 'sandstone' && mat !== 'sandbag') return 'sand';
  if (mat.includes('sandbag')) return 'sand';
  if (mat.includes('wood') || mat.includes('crate') || mat.includes('door') || mat.includes('bark')) return 'wood';
  if (mat.includes('metal') || mat.includes('rust') || mat.includes('glass')) return 'metal';
  return 'stone';
}

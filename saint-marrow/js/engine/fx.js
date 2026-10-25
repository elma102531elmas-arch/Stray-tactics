// Decals (blood, bullet holes) in a single batched mesh, particle systems, shell casings, rain, dust motes.
import * as THREE from '../../lib/three.module.js';
import { atlasUV, DECAL, makeSoftDot, makeSmoke } from './textures.js';
import { rand, pick } from '../util.js';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();

export class DecalBatch {
  constructor(scene, atlas, cap, rough) {
    this.cap = cap;
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 4 * 3);
    this.nor = new Float32Array(cap * 4 * 3);
    this.uv = new Float32Array(cap * 4 * 2);
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.MeshStandardMaterial({
      map: atlas, transparent: true, depthWrite: false, roughness: rough, metalness: 0, envMapIntensity: 0.6,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.receiveShadow = true;
    this.count = 0;
    scene.add(this.mesh);
  }
  clear() { this.next = 0; this.count = 0; this.geo.setDrawRange(0, 0); }
  // point, normal (unit), size (m), atlas cell, rotation (rad), aspect
  add(p, n, size, cell, rot = Math.random() * 6.28, aspect = 1, lift = 0.004) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.count = Math.min(this.cap, this.count + 1);
    _n.copy(n).normalize();
    // tangent frame
    if (Math.abs(_n.y) > 0.9) _t.set(1, 0, 0); else _t.set(0, 1, 0);
    _b.crossVectors(_n, _t).normalize();
    _t.crossVectors(_b, _n).normalize();
    _q.setFromAxisAngle(_n, rot);
    _t.applyQuaternion(_q); _b.applyQuaternion(_q);
    const hw = size / 2 * aspect, hh = size / 2;
    const c = _v.copy(p).addScaledVector(_n, lift);
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const [u0, v0, du, dv] = atlasUV(cell);
    const uvs = [[u0, v0], [u0 + du, v0], [u0 + du, v0 + dv], [u0, v0 + dv]];
    for (let k = 0; k < 4; k++) {
      const [a, b] = corners[k];
      const o = (i * 4 + k) * 3;
      // keep winding facing the normal
      this.pos[o] = c.x + _b.x * a + _t.x * b; this.pos[o + 1] = c.y + _b.y * a + _t.y * b; this.pos[o + 2] = c.z + _b.z * a + _t.z * b;
      this.nor[o] = _n.x; this.nor[o + 1] = _n.y; this.nor[o + 2] = _n.z;
      this.uv[(i * 4 + k) * 2] = uvs[k][0]; this.uv[(i * 4 + k) * 2 + 1] = uvs[k][1];
    }
    // flip winding if needed: check (corner1-corner0)x(corner2-corner0) · n
    const o0 = i * 12;
    const ax = this.pos[o0 + 3] - this.pos[o0], ay = this.pos[o0 + 4] - this.pos[o0 + 1], az = this.pos[o0 + 5] - this.pos[o0 + 2];
    const bx = this.pos[o0 + 6] - this.pos[o0], by = this.pos[o0 + 7] - this.pos[o0 + 1], bz = this.pos[o0 + 8] - this.pos[o0 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * _n.x + cy * _n.y + cz * _n.z < 0) {
      // swap corners 1 and 3
      for (let a = 0; a < 3; a++) { const t = this.pos[o0 + 3 + a]; this.pos[o0 + 3 + a] = this.pos[o0 + 9 + a]; this.pos[o0 + 9 + a] = t; }
      const u = i * 8;
      for (let a = 0; a < 2; a++) { const t = this.uv[u + 2 + a]; this.uv[u + 2 + a] = this.uv[u + 6 + a]; this.uv[u + 6 + a] = t; }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.setDrawRange(0, this.count * 6);
  }
}

const PVERT = `
attribute float aSize; attribute vec4 aCol;
varying vec4 vCol;
uniform float uScale;
void main(){
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.05, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = `
uniform sampler2D tMap; varying vec4 vCol;
void main(){
  vec4 t = texture2D(tMap, gl_PointCoord);
  gl_FragColor = vec4(vCol.rgb * t.rgb, vCol.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
  #include <colorspace_fragment>
}`;

export class Particles {
  constructor(scene, cap, opts) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.size0 = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.col = new Float32Array(cap * 4);
    this.a0 = new Float32Array(cap);
    this.flags = new Uint8Array(cap);
    this.gravity = opts.gravity ?? -9.8;
    this.drag = opts.drag ?? 0.5;
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { tMap: { value: opts.map }, uScale: { value: 400 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.onLand = null;
  }
  setScale(h) { this.mat.uniforms.uScale.value = h * 0.6; }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a, grow = 0, flag = 0) {
    const i = this.next; this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size0[i] = size; this.size[i] = size; this.grow[i] = grow;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a; this.a0[i] = a;
    this.flags[i] = flag;
  }
  clear() { this.life.fill(0); this.size.fill(0); }
  update(dt, grid) {
    const P = this.pos, V = this.vel;
    const drag = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      V[k + 1] += this.gravity * dt;
      V[k] *= drag; V[k + 1] *= drag; V[k + 2] *= drag;
      P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
      const f = this.life[i] / this.max[i];
      this.size[i] = this.size0[i] * (1 + this.grow[i] * (1 - f));
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, f * 3);
      if (P[k + 1] < 0.01 && this.gravity < 0) {
        if (this.onLand && this.flags[i]) this.onLand(P[k], P[k + 2], this.size0[i]);
        this.life[i] = 0; this.size[i] = 0;
      } else if (grid && this.flags[i] && grid.solidForMove(Math.floor(P[k]), Math.floor(P[k + 2]))) {
        this.life[i] = 0; this.size[i] = 0;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aCol.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, renderer, atlas, getGrid) {
    this.scene = scene;
    this.getGrid = getGrid;
    this.wet = new DecalBatch(scene, atlas, 260, 0.22);
    this.dry = new DecalBatch(scene, atlas, 160, 0.85);
    this.old = new DecalBatch(scene, atlas, 420, 0.7);
    this.old.mat.color.setRGB(0.62, 0.46, 0.42);
    const dot = makeSoftDot(64);
    this.dot = dot;
    this.smokeTex = makeSmoke();
    this.blood = new Particles(scene, 700, { map: dot, gravity: -9.8, drag: 0.6 });
    this.mist = new Particles(scene, 120, { map: this.smokeTex, gravity: 0.2, drag: 2.5 });
    this.sparks = new Particles(scene, 200, { map: dot, gravity: -9.8, drag: 1.2, additive: true });
    this.dust = new Particles(scene, 200, { map: this.smokeTex, gravity: -0.3, drag: 3.0 });
    this.landBudget = 0;
    this.blood.onLand = (x, z, s) => {
      if (this.landBudget <= 0) return;
      this.landBudget--;
      _v.set(x, 0, z); _n.set(0, 1, 0);
      this.wet.add(_v, _n, 0.04 + s * 1.6 + Math.random() * 0.06, pick(DECAL.splat), undefined, 1, 0.003 + Math.random() * 0.001);
    };
    this.casings = [];
    this.bloodLevel = 1;
    this.flames = new Particles(scene, 400, { map: dot, gravity: 1.6, drag: 1.4, additive: true });
    this.fires = [];
  }

  // a burning patch on the floor (chapter 6): flames, smoke and a flickering light, until clear().
  // The light is a fixture in the level's light pool (game sets fx.lightSys), not a PointLight of its own: every extra
  // real light is per-pixel cost on every surface and a shader recompile.
  fire(p) {
    this.lightSys?.add('virtual', p.x, 0.8, p.z, { color: 0xff6a20, intensity: 40, range: 9, state: 'fire' });
    this.fires.push({ p: p.clone(), t: 0 });
  }

  // a chunk of ceiling coming down: falling grit, then a dust burst where it lands
  debris(p) {
    for (let i = 0; i < 16; i++) this.dust.emit(p.x + rand(-0.4, 0.4), p.y, p.z + rand(-0.4, 0.4), rand(-0.3, 0.3), rand(-3, -1), rand(-0.3, 0.3), rand(0.6, 1.2), rand(0.1, 0.25), 0.5, 0.48, 0.45, 0.6, 2);
    for (let i = 0; i < 10; i++) this.sparks.emit(p.x, p.y, p.z, rand(-1, 1), rand(-4, -2), rand(-1, 1), rand(0.4, 0.8), 0.02, 0.5, 0.48, 0.45, 1);
    setTimeout(() => { for (let i = 0; i < 14; i++) this.dust.emit(p.x, 0.1, p.z, rand(-1.5, 1.5), rand(0.2, 1.2), rand(-1.5, 1.5), rand(0.8, 1.6), rand(0.2, 0.4), 0.55, 0.52, 0.48, 0.55, 2.5); }, 350);
  }

  clear() {
    this.wet.clear(); this.dry.clear(); this.old.clear();
    this.blood.clear(); this.mist.clear(); this.sparks.clear(); this.dust.clear(); this.flames.clear();
    this.fires = [];
    for (const c of this.casings) this.scene.remove(c.m);
    this.casings = [];
  }

  setScreen(h) { for (const p of [this.blood, this.mist, this.sparks, this.dust, this.flames]) p.setScale(h); }

  // Blood burst at hit point along direction (bullet travel)
  bloodHit(p, dir, power = 1) {
    const amt = this.bloodLevel;
    if (amt <= 0) return;
    this.landBudget += 3 * amt;
    const n = Math.floor((24 + power * 26) * amt);
    for (let i = 0; i < n; i++) {
      const s = rand(1.5, 5.5) * power;
      // exit spray continues along the bullet, some splashes back
      const back = Math.random() < 0.3 ? -0.5 : 1;
      this.blood.emit(p.x, p.y, p.z,
        dir.x * s * back + rand(-1.4, 1.4), dir.y * s * back + rand(-0.6, 2.2), dir.z * s * back + rand(-1.4, 1.4),
        rand(0.5, 1.3), rand(0.012, 0.035), rand(0.28, 0.42), 0.01, 0.012, 0.95, 0, 1);
    }
    for (let i = 0; i < 5; i++) {
      this.mist.emit(p.x, p.y, p.z, dir.x * rand(0.5, 1.5) + rand(-0.3, 0.3), rand(-0.1, 0.4), dir.z * rand(0.5, 1.5) + rand(-0.3, 0.3),
        rand(0.25, 0.5), rand(0.12, 0.25), 0.35, 0.02, 0.02, 0.55 * amt, 2.5);
    }
    // splatter on the wall/floor behind the target
    const grid = this.getGrid();
    if (grid) {
      const h = grid.raycast(p.x, p.y, p.z, dir.x, dir.y, dir.z, 2.6, { ceil: 3.2 });
      if (h) {
        _v.set(h.x, h.y, h.z); _n.set(h.nx, h.ny, h.nz);
        const big = (0.35 + Math.random() * 0.35) * power;
        this.wet.add(_v, _n, big, h.ny ? pick(DECAL.splat) : pick([...DECAL.splat, ...DECAL.spray, ...DECAL.drip]), Math.random() * 6.28);
      }
      // drops on the floor beneath
      _v.set(p.x + dir.x * 0.4, 0, p.z + dir.z * 0.4); _n.set(0, 1, 0);
      this.wet.add(_v, _n, 0.25 + Math.random() * 0.25, pick(DECAL.splat));
    }
  }

  bloodPool(x, z, size) {
    _v.set(x, 0, z); _n.set(0, 1, 0);
    this.wet.add(_v, _n, size, pick(DECAL.pool), Math.random() * 6.28, 1, 0.0035);
  }

  bloodDrip(p) {
    // player bleeding drops
    this.blood.emit(p.x, p.y, p.z, rand(-0.1, 0.1), 0, rand(-0.1, 0.1), 2, 0.02, 0.3, 0.01, 0.01, 0.9, 0, 1);
    this.landBudget += 1;
  }

  impact(h, dir, surface) {
    _v.set(h.x, h.y, h.z); _n.set(h.nx, h.ny, h.nz);
    this.dry.add(_v, _n, 0.06 + Math.random() * 0.02, DECAL.bullet[0], Math.random() * 6.28, 1, 0.003);
    const metal = surface === 'metal';
    const nS = metal ? 14 : 5;
    for (let i = 0; i < nS; i++) {
      this.sparks.emit(h.x, h.y, h.z, h.nx * rand(1, 4) + rand(-1.5, 1.5), h.ny * rand(1, 4) + rand(0, 2.5), h.nz * rand(1, 4) + rand(-1.5, 1.5),
        rand(0.08, 0.3), rand(0.008, 0.02), 1.0, 0.75, 0.4, 1);
    }
    const c = surface === 'wood' ? [0.35, 0.27, 0.18] : [0.55, 0.53, 0.5];
    for (let i = 0; i < 6; i++) {
      this.dust.emit(h.x, h.y, h.z, h.nx * rand(0.3, 1.2) + rand(-0.3, 0.3), h.ny * rand(0.3, 1) + rand(0, 0.5), h.nz * rand(0.3, 1.2) + rand(-0.3, 0.3),
        rand(0.5, 1.1), rand(0.08, 0.16), c[0], c[1], c[2], 0.5, 3);
    }
  }

  muzzleSmoke(p, dir) {
    for (let i = 0; i < 4; i++) this.dust.emit(p.x, p.y, p.z, dir.x * rand(0.2, 0.8), rand(0.1, 0.4), dir.z * rand(0.2, 0.8), rand(0.6, 1.2), rand(0.05, 0.1), 0.6, 0.6, 0.6, 0.18, 4);
  }

  casing(p, vel, assets) {
    if (!this.casingGeo) {
      this.casingGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.019, 8);
      this.casingMat = new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.3, envMapIntensity: 0.8 });
    }
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    m.position.copy(p);
    m.castShadow = false;
    this.scene.add(m);
    this.casings.push({ m, v: vel.clone(), w: new THREE.Vector3(rand(-20, 20), rand(-20, 20), rand(-20, 20)), t: 0, rest: false, bounces: 0 });
    if (this.casings.length > 40) { const c = this.casings.shift(); this.scene.remove(c.m); }
  }

  update(dt, onCasingHit) {
    this.landBudget = Math.min(this.landBudget, 30);
    const grid = this.getGrid();
    this.blood.update(dt, grid);
    this.mist.update(dt);
    this.sparks.update(dt);
    this.dust.update(dt);
    this.flames.update(dt);
    for (const f of this.fires) {
      f.t += dt;
      for (let i = 0; i < 2; i++) this.flames.emit(f.p.x + rand(-0.5, 0.5), 0.05, f.p.z + rand(-0.5, 0.5), rand(-0.2, 0.2), rand(0.8, 1.8), rand(-0.2, 0.2), rand(0.35, 0.7), rand(0.18, 0.4), 1.0, rand(0.35, 0.55), 0.12, 0.85, -0.3);
      if (Math.random() < 0.3) this.dust.emit(f.p.x, 1.2, f.p.z, rand(-0.2, 0.2), rand(0.4, 0.9), rand(-0.2, 0.2), rand(1.2, 2.2), rand(0.3, 0.5), 0.12, 0.11, 0.1, 0.5, 1.2);
    }
    for (const c of this.casings) {
      if (c.rest) continue;
      c.t += dt;
      c.v.y -= 9.8 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt;
      if (c.m.position.y < 0.005) {
        c.m.position.y = 0.005;
        if (c.bounces < 3 && Math.abs(c.v.y) > 0.6) {
          c.v.y *= -0.35; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.5); c.bounces++;
          onCasingHit && onCasingHit(c.m.position, c.bounces);
        } else {
          c.rest = true; c.m.rotation.set(Math.PI / 2, Math.random() * 6, 0);
        }
      }
    }
  }
}

// Falling rain around the camera.
export class Rain {
  constructor(scene, count = 1400) {
    this.count = count;
    const pos = new Float32Array(count * 2 * 3);
    const col = new Float32Array(count * 2 * 3);
    this.seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.seed[i * 3] = Math.random() * 30 - 15; this.seed[i * 3 + 1] = Math.random() * 14; this.seed[i * 3 + 2] = Math.random() * 30 - 15;
      col.set([0.0, 0.0, 0.0, 0.42, 0.45, 0.5], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo = g;
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    this.lines.frustumCulled = false;
    this.splash = new Particles(scene, 300, { map: makeSoftDot(32), gravity: -6, drag: 1 });
    scene.add(this.lines);
    this.t = 0;
    this.enabled = true;
  }
  setEnabled(on) { this.enabled = on; this.lines.visible = on; this.splash.points.visible = on; }
  update(dt, cam, isOutdoorAt) {
    if (!this.enabled) return;
    this.t += dt;
    const p = this.geo.attributes.position.array;
    const cx = cam.x, cz = cam.z;
    const speed = 11, wind = 1.6;
    for (let i = 0; i < this.count; i++) {
      let y = (this.seed[i * 3 + 1] - this.t * speed) % 14; if (y < 0) y += 14;
      let x = ((this.seed[i * 3] + this.t * wind - cx) % 30 + 45) % 30 - 15 + cx;
      let z = ((this.seed[i * 3 + 2] - cz) % 30 + 45) % 30 - 15 + cz;
      const ok = !isOutdoorAt || isOutdoorAt(x, z);
      const k = i * 6;
      if (!ok) { p[k] = p[k + 3] = x; p[k + 1] = p[k + 4] = -50; p[k + 2] = p[k + 5] = z; continue; }
      p[k] = x - wind * 0.04; p[k + 1] = y + 0.45; p[k + 2] = z;
      p[k + 3] = x; p[k + 4] = y; p[k + 5] = z;
      if (y < 0.25 && Math.random() < 0.08) this.splash.emit(x, 0.02, z, rand(-0.4, 0.4), rand(0.6, 1.3), rand(-0.4, 0.4), 0.25, 0.012, 0.6, 0.65, 0.7, 0.45);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.splash.update(dt);
  }
}

// Floating dust lit by the flashlight (shader fades motes outside the beam).
export class DustMotes {
  constructor(scene, count = 260) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) pos.set([Math.random() * 8 - 4, Math.random() * 3, Math.random() * 8 - 4], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uOrigin: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, 0, -1) }, uCenter: { value: new THREE.Vector3() }, uTime: { value: 0 }, uOn: { value: 1 }, uScale: { value: 300 } },
      vertexShader: `uniform vec3 uOrigin, uDir, uCenter; uniform float uTime, uOn, uScale; varying float vA;
        void main(){
          vec3 p = position;
          p += vec3(sin(uTime*0.3 + p.y*3.0), sin(uTime*0.2 + p.x*2.0)*0.5, cos(uTime*0.25 + p.z*3.0)) * 0.15;
          p = uCenter + mod(p - uCenter + 4.0, 8.0) - 4.0;
          p.y = mod(position.y + uTime * 0.03, 3.0);
          vec3 d = p - uOrigin; float L = length(d);
          float c = dot(d / max(L, 1e-3), uDir);
          vA = smoothstep(0.86, 0.97, c) * smoothstep(7.0, 1.0, L) * smoothstep(0.2, 0.6, L) * uOn;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uScale * 0.012 / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)) * vA * 0.5; if (a < 0.003) discard; gl_FragColor = vec4(vec3(1.0, 0.96, 0.88) * a, a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  update(t, origin, dir, on, screenH) {
    const u = this.mat.uniforms;
    u.uOrigin.value.copy(origin); u.uDir.value.copy(dir); u.uCenter.value.set(origin.x, 0, origin.z);
    u.uTime.value = t; u.uOn.value = on ? 1 : 0; u.uScale.value = screenH;
  }
}

// Third-person soldier: one SkinnedMesh (rigid skinning, vertex colors) +
// weapon mesh. Procedural locomotion (walk cycle, crouch, aim pitch), a
// physics-ish death fall, and analytic hitboxes (head/chest/stomach/limbs).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildWorldWeapon, WEAPON_MODEL_DEFS, socketQuat } from '../weapons/models.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clamp, damp, DEG } from '../core/util.js';
import { clsOf } from '../weapons/weapons.js';

export const TEAMS = [
  { name: 'RAIDERS', color: '#e0a64a', shirt: 0xb59a6e, pants: 0x8a7556, vest: 0x5e4a33, accent: 0xa8382c, skin: 0xc58f6a, head: 'wrap' },
  { name: 'GUARDIANS', color: '#4aa3e0', shirt: 0x46566a, pants: 0x3a4452, vest: 0x2b3440, accent: 0x2f6fb0, skin: 0xd2a07e, head: 'helmet' },
];

const SKEL = {
  hips: { parent: null, pos: [0, 0.98, 0] },
  spine: { parent: 'hips', pos: [0, 0.1, 0] },
  chest: { parent: 'spine', pos: [0, 0.2, 0] },
  neck: { parent: 'chest', pos: [0, 0.3, 0] },
  head: { parent: 'neck', pos: [0, 0.08, 0] },
  shoulderR: { parent: 'chest', pos: [0.2, 0.25, 0] },
  shoulderL: { parent: 'chest', pos: [-0.2, 0.25, 0] },
  upperArmR: { parent: 'shoulderR', pos: [0, 0, 0], down: true },
  upperArmL: { parent: 'shoulderL', pos: [0, 0, 0], down: true },
  foreArmR: { parent: 'upperArmR', pos: [0, 0.28, 0] },
  foreArmL: { parent: 'upperArmL', pos: [0, 0.28, 0] },
  handR: { parent: 'foreArmR', pos: [0, 0.25, 0] },
  handL: { parent: 'foreArmL', pos: [0, 0.25, 0] },
  thighR: { parent: 'hips', pos: [0.1, -0.04, 0], down: true },
  thighL: { parent: 'hips', pos: [-0.1, -0.04, 0], down: true },
  shinR: { parent: 'thighR', pos: [0, 0.44, 0] },
  shinL: { parent: 'thighL', pos: [0, 0.44, 0] },
  footR: { parent: 'shinR', pos: [0, 0.43, 0] },
  footL: { parent: 'shinL', pos: [0, 0.43, 0] },
};
const L_UP = 0.28, L_FORE = 0.25;

function limb(r0, r1, len, seg = 8) {
  // tapered, rounded limb along +Y (lathe profile)
  const pts = [[0, -r0 * 0.6], [r0 * 0.75, -r0 * 0.45], [r0, -r0 * 0.05], [(r0 + r1) / 2 * 1.04, len * 0.45], [r1, len], [r1 * 0.75, len + r1 * 0.45], [0, len + r1 * 0.6]];
  return new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
}
function rbox(w, h, d, r = 0.02) { return new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.2, h / 2.2, d / 2.2)); }
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

const MATS = new Map();
async function teamMaterial(team) {
  if (MATS.has(team)) return MATS.get(team);
  const camo = team === 0
    ? { color1: '#a89470', color2: '#7e6c4e', noiseScale: 3, noiseAmt: 1, spots: 0.85, spotColor: '#5b4f3a', spotScale: 5, detail: 0.6, grime: 0.15, grimeColor: '#5a4c38', grimeScale: 3, rough: 0.9, bump: 1.4, seed: 201 }
    : { color1: '#5d6876', color2: '#434c58', noiseScale: 3, noiseAmt: 1, spots: 0.85, spotColor: '#262b32', spotScale: 5, detail: 0.6, grime: 0.15, grimeColor: '#2a2e33', grimeScale: 3, rough: 0.9, bump: 1.4, seed: 202 };
  const id = 'camo_' + team;
  const { generateTexture } = await import('../gfx/texgen.js');
  const g = await generateTexture(camo, 256, 4);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, map: g.albedoRT.texture, normalMap: g.normalRT.texture, normalScale: new THREE.Vector2(0.9, 0.9) });
  // camo only where the 'camo' attribute is set (clothes); skin/gear use plain vertex color
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float camo;\nvarying float vCamo;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamo = camo;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCamo;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        diffuseColor.rgb *= mix(vec3(1.0), sampledDiffuseColor.rgb * 1.25, vCamo);
      #endif`);
  };
  m.customProgramCacheKey = () => 'camoChar';
  MATS.set(team, m); void id;
  return m;
}

export class Character {
  constructor(team) {
    this.team = team; this.T = TEAMS[team];
    this.group = new THREE.Group(); this.group.name = 'character';
    this.bones = {}; this.rest = {};
    this.walkPhase = Math.random() * 6; this.moveAmt = 0; this.crouchAmt = 0; this.pitch = 0;
    this.dead = false; this.deathT = 0; this.visibleT = 1;
    this.hitboxes = [];
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
  }

  async build(weaponKind) {
    const mat = await teamMaterial(this.team);
    const T = this.T;
    const list = [];
    for (const name in SKEL) {
      const d = SKEL[name]; const b = new THREE.Bone(); b.name = name; b.position.set(...d.pos);
      if (d.down) b.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
      if (d.parent) this.bones[d.parent].add(b);
      this.bones[name] = b; list.push(b);
    }
    for (const n in this.bones) this.rest[n] = this.bones[n].quaternion.clone();
    this.bones.hips.updateMatrixWorld(true);
    const pieces = [];
    // camo: 1 = uniform fabric (camo textured), 0 = plain color
    const add = (bone, geo, color, m4, camo = 0) => { if (m4) geo.applyMatrix4(m4); pieces.push({ bone, geo, color, camo }); };
    const M = (p = [0, 0, 0], r = [0, 0, 0], sc = [1, 1, 1]) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG)), new THREE.Vector3(...sc));
    const B = this.bones, G = 0x2a2b2d, D = 0x1d1e20;
    const uni = 0xffffff, uni2 = 0xe6e6e6; // tinted by camo texture
    // ---- pelvis, belt
    add(B.hips, rbox(0.36, 0.22, 0.25, 0.07), uni2, M([0, 0.0, 0]), 1);
    add(B.hips, rbox(0.385, 0.06, 0.27, 0.02), T.vest, M([0, 0.1, 0]));
    add(B.hips, rbox(0.08, 0.09, 0.05, 0.015), T.vest, M([0.15, 0.06, -0.12]));
    add(B.hips, rbox(0.08, 0.09, 0.05, 0.015), T.vest, M([-0.15, 0.06, -0.12]));
    add(B.hips, rbox(0.12, 0.1, 0.06, 0.02), T.vest, M([0, 0.06, 0.14]));
    // ---- torso
    add(B.spine, rbox(0.33, 0.26, 0.22, 0.08), uni, M([0, 0.11, 0]), 1);
    add(B.chest, rbox(0.42, 0.3, 0.25, 0.09), uni, M([0, 0.15, 0]), 1);
    add(B.chest, rbox(0.38, 0.12, 0.2, 0.05), uni, M([0, 0.27, 0.0]), 1); // shoulders/traps
    // plate carrier
    add(B.chest, rbox(0.36, 0.31, 0.07, 0.025), T.vest, M([0, 0.12, -0.13]));
    add(B.chest, rbox(0.36, 0.31, 0.07, 0.025), T.vest, M([0, 0.12, 0.13]));
    add(B.chest, rbox(0.06, 0.24, 0.27, 0.02), T.vest, M([0.19, 0.08, 0]));
    add(B.chest, rbox(0.06, 0.24, 0.27, 0.02), T.vest, M([-0.19, 0.08, 0]));
    for (const x of [-0.12, 0.12]) add(B.chest, rbox(0.06, 0.03, 0.3, 0.012), T.vest, M([x, 0.29, 0])); // shoulder straps
    for (let i = -1; i <= 1; i++) add(B.chest, rbox(0.085, 0.13, 0.055, 0.015), T.vest, M([i * 0.1, 0.02, -0.18])); // mag pouches
    add(B.chest, rbox(0.07, 0.1, 0.045, 0.015), G, M([0.12, 0.2, -0.17])); // radio
    add(B.chest, new THREE.CylinderGeometry(0.006, 0.006, 0.18, 5), D, M([0.15, 0.32, -0.15], [0, 0, 8])); // antenna
    add(B.chest, rbox(0.28, 0.34, 0.11, 0.035), T.vest, M([0, 0.12, 0.2])); // back pack
    add(B.chest, rbox(0.1, 0.04, 0.04, 0.01), T.accent, M([0.22, 0.24, 0.0], [0, 0, 0])); // team band on shoulder
    // ---- neck + head
    add(B.neck, new THREE.CylinderGeometry(0.05, 0.058, 0.11, 12), T.skin, M([0, 0.03, 0]));
    add(B.head, new THREE.SphereGeometry(0.102, 14, 10), T.skin, M([0, 0.1, 0.005], [0, 0, 0], [0.93, 1.1, 1.02]));
    add(B.head, rbox(0.05, 0.05, 0.03, 0.012), T.skin, M([0, 0.085, -0.1])); // nose/brow
    if (T.head === 'helmet') {
      add(B.head, new THREE.SphereGeometry(0.13, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.52), 0x3e4855, M([0, 0.135, 0.008], [-6, 0, 0], [1, 0.92, 1.06]));
      add(B.head, new THREE.TorusGeometry(0.128, 0.008, 4, 16), 0x323a44, M([0, 0.135, 0.008], [96, 0, 0], [1, 1.06, 1]));
      add(B.head, rbox(0.05, 0.04, 0.035, 0.008), D, M([0, 0.2, -0.125])); // NVG mount
      add(B.head, rbox(0.17, 0.045, 0.05, 0.012), D, M([0, 0.17, -0.12])); // goggles
      for (const x of [-0.105, 0.105]) add(B.head, new THREE.CylinderGeometry(0.04, 0.04, 0.035, 10), G, M([x, 0.09, 0.0], [0, 0, 90])); // ear protection
      add(B.head, rbox(0.17, 0.08, 0.17, 0.04), 0x2b3138, M([0, 0.035, 0.005])); // balaclava
      add(B.head, rbox(0.12, 0.035, 0.03, 0.01), 0x202428, M([0, 0.115, -0.1])); // eye shadow band
    } else {
      add(B.head, new THREE.SphereGeometry(0.117, 12, 8), 0xcdb68d, M([0, 0.14, 0.008], [0, 0, 0], [1, 0.86, 1.04]), 0);
      add(B.head, rbox(0.2, 0.1, 0.2, 0.045), 0xcdb68d, M([0, 0.045, 0.0])); // face wrap
      add(B.head, rbox(0.12, 0.13, 0.05, 0.02), 0xcdb68d, M([0.03, 0.16, 0.11], [18, 0, 12])); // tail
      add(B.head, rbox(0.15, 0.035, 0.03, 0.012), 0x121315, M([0, 0.115, -0.1])); // sunglasses
    }
    // ---- arms
    for (const sd of ['R', 'L']) {
      add(B['upperArm' + sd], limb(0.062, 0.05, L_UP - 0.02), uni, M([0, 0.0, 0]), 1);
      add(B['upperArm' + sd], new THREE.SphereGeometry(0.072, 8, 6), uni, M([0, 0.02, 0]), 1);
      add(B['foreArm' + sd], limb(0.05, 0.04, L_FORE - 0.03), uni2, M([0, 0.0, 0]), 1);
      add(B['foreArm' + sd], rbox(0.07, 0.06, 0.06, 0.02), G, M([0, -0.01, 0.0])); // elbow pad
      add(B['hand' + sd], rbox(0.08, 0.1, 0.045, 0.018), 0x1e1f21, M([0, 0.05, 0]));
      add(B['hand' + sd], rbox(0.07, 0.05, 0.05, 0.02), 0x1e1f21, M([0, 0.105, -0.01], [30, 0, 0]));
    }
    // ---- legs
    for (const sd of ['R', 'L']) {
      const side = sd === 'R' ? 1 : -1;
      add(B['thigh' + sd], limb(0.098, 0.072, 0.42, 9), uni2, M([0, 0.0, 0]), 1);
      add(B['thigh' + sd], rbox(0.07, 0.12, 0.1, 0.02), uni2, M([0.075 * side, 0.2, 0], [0, 0, 0]), 1); // cargo pocket (note: bone x is mirrored)
      add(B['shin' + sd], limb(0.07, 0.055, 0.41, 9), uni2, M([0, 0.0, 0]), 1);
      add(B['shin' + sd], rbox(0.1, 0.12, 0.07, 0.03), G, M([0, 0.03, -0.055])); // knee pad
      add(B['foot' + sd], rbox(0.115, 0.11, 0.28, 0.035), 0x2b241c, M([0, 0.0, -0.06]));
      add(B['foot' + sd], rbox(0.12, 0.03, 0.29, 0.012), 0x161412, M([0, -0.05, -0.06]));
    }
    if (true) add(B.thighR, rbox(0.06, 0.16, 0.12, 0.02), G, M([-0.09, 0.14, -0.02])); // holster
    // ---- skin
    const geos = [];
    for (const pc of pieces) {
      let g = pc.geo.index ? pc.geo.toNonIndexed() : pc.geo;
      g.applyMatrix4(pc.bone.matrixWorld);
      const n = g.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3), cm = new Float32Array(n);
      const bi = list.indexOf(pc.bone), c = new THREE.Color(pc.color);
      for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; cm[i] = pc.camo; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('camo', new THREE.Float32BufferAttribute(cm, 1));
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < n; i++) uv.setXY(i, (p.getX(i) * 0.8 + p.getZ(i)) * 3.2, p.getY(i) * 3.2);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color', 'camo'].includes(k)) g.deleteAttribute(k);
      geos.push(g);
    }
    const geo = mergeGeometries(geos);
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.add(this.bones.hips);
    mesh.bind(new THREE.Skeleton(list));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.mesh = mesh;
    this.group.add(mesh);
    await this.setWeapon(weaponKind);
    return this;
  }

  async setWeapon(kind) {
    if (this.weapon) this.bones.chest.remove(this.weapon);
    this.weaponKind = kind;
    const w = await buildWorldWeapon(kind);
    const def = WEAPON_MODEL_DEFS[kind];
    // shouldered weapon in chest space (character faces -Z)
    const cls = clsOf(kind), isPistol = cls === 'pistol', isKnife = cls === 'knife';
    w.position.set(isPistol ? 0.05 : 0.09, isPistol ? 0.2 : 0.2, isPistol ? -0.42 : isKnife ? -0.35 : -0.3);
    w.rotation.set(0, 0, 0);
    this.bones.chest.add(w);
    this.weapon = w;
    this.muzzleLocal = new THREE.Vector3(...def.sockets.muzzle);
    // solve arm IK once (pose is constant relative to the chest)
    this.bones.hips.updateMatrixWorld(true);
    const toChest = (p) => p.clone().applyMatrix4(w.matrix);
    const gq = w.quaternion.clone();
    const grip = toChest(new THREE.Vector3(...def.sockets.grip.p));
    const gripQ = gq.clone().multiply(socketQuat(def.sockets.grip));
    this._ik('R', grip, gripQ, new THREE.Vector3(0.6, -0.6, 0.3));
    if (def.sockets.fore && !isKnife && !isPistol) {
      const fore = toChest(new THREE.Vector3(...def.sockets.fore.p));
      this._ik('L', fore, gq.clone().multiply(socketQuat(def.sockets.fore)), new THREE.Vector3(-0.8, -0.6, 0.2));
    } else if (isPistol) {
      this._ik('L', grip.clone().add(new THREE.Vector3(-0.05, -0.01, 0.02)), gripQ, new THREE.Vector3(-0.8, -0.6, 0.2));
    } else {
      // knife: left arm relaxed
      this.bones.upperArmL.quaternion.copy(this.rest.upperArmL).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, -0.15)));
      this.bones.foreArmL.quaternion.setFromEuler(new THREE.Euler(-0.6, 0, 0));
    }
    this.armPose = { uR: this.bones.upperArmR.quaternion.clone(), fR: this.bones.foreArmR.quaternion.clone(), hR: this.bones.handR.quaternion.clone(), uL: this.bones.upperArmL.quaternion.clone(), fL: this.bones.foreArmL.quaternion.clone(), hL: this.bones.handL.quaternion.clone() };
  }

  // 2-bone IK in chest space; sets upperArm/foreArm/hand local rotations
  _ik(side, target, handQ, pole) {
    const sh = this.bones['shoulder' + side].position.clone();
    const dir = target.clone().sub(sh); let d = dir.length();
    const maxR = (L_UP + L_FORE) * 0.99; if (d > maxR) d = maxR; dir.normalize();
    const a = (L_UP * L_UP - L_FORE * L_FORE + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L_UP * L_UP - a * a));
    const bend = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = sh.clone().addScaledVector(dir, a).addScaledVector(bend, h);
    const wrist = sh.clone().addScaledVector(dir, d);
    const yU = elbow.clone().sub(sh).normalize();
    const qU = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), yU);
    const yF = wrist.clone().sub(elbow).normalize();
    const qF = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), yF);
    // bones: shoulder has identity rotation in chest space
    this.bones['upperArm' + side].quaternion.copy(qU);
    this.bones['foreArm' + side].quaternion.copy(qU.clone().invert().multiply(qF));
    this.bones['hand' + side].quaternion.copy(qF.clone().invert().multiply(handQ));
  }

  // state: {speed (m/s), fwd (-1..1), side (-1..1), crouch (bool), pitch (rad), onGround}
  update(dt, st) {
    const B = this.bones;
    if (this.dead) { this._updateDeath(dt); return; }
    const spd = st.speed || 0;
    this.moveAmt = damp(this.moveAmt, Math.min(1, spd / 5), 10, dt);
    this.crouchAmt = damp(this.crouchAmt, st.crouch ? 1 : 0, 10, dt);
    this.pitch = damp(this.pitch, st.pitch || 0, 14, dt);
    this.walkPhase += dt * spd * (Math.PI * 2 / 1.5) * (st.fwd < -0.2 ? -1 : 1);
    const ph = this.walkPhase, m = this.moveAmt, c = this.crouchAmt;
    const swing = 0.55 * m, air = st.onGround === false ? 1 : 0;
    // legs
    const legs = (s, off) => {
      const p = ph + off;
      const idle = 1 - m;
      const thigh = Math.sin(p) * swing - c * 1.2 - air * 0.5 - idle * 0.07;
      const knee = Math.max(0, Math.sin(p - 1.2)) * 0.9 * m + c * 2.0 + air * 0.9 + 0.06 + idle * 0.12;
      const spread = (s === 'R' ? -1 : 1) * 0.07 * idle;
      B['thigh' + s].quaternion.copy(this.rest['thigh' + s]).multiply(_q.setFromEuler(_e.set(-thigh, 0, (st.side || 0) * 0.08 * m + spread)));
      B['shin' + s].quaternion.setFromEuler(_e.set(knee, 0, 0));
      B['foot' + s].quaternion.setFromEuler(_e.set(-knee * 0.4 + thigh * 0.3, 0, 0));
    };
    legs('R', 0); legs('L', Math.PI);
    // hips height + bob
    const bob = Math.abs(Math.sin(ph)) * 0.04 * m;
    B.hips.position.y = 0.98 - c * 0.38 + bob - m * 0.02;
    B.hips.rotation.set(0, Math.sin(ph) * 0.08 * m, 0);
    // upper body aim: spine/chest pitch, lean forward when crouching/running
    const lean = c * 0.25 + m * 0.08;
    B.spine.rotation.set(this.pitch * 0.35 - lean * 0.5, -Math.sin(ph) * 0.06 * m, 0);
    B.chest.rotation.set(this.pitch * 0.55 - lean * 0.3, 0, 0);
    B.neck.rotation.set(this.pitch * 0.1, 0, 0);
    // arms fixed to weapon (solved at equip)
    const a = this.armPose;
    B.upperArmR.quaternion.copy(a.uR); B.foreArmR.quaternion.copy(a.fR); B.handR.quaternion.copy(a.hR);
    B.upperArmL.quaternion.copy(a.uL); B.foreArmL.quaternion.copy(a.fL); B.handL.quaternion.copy(a.hL);
    // recoil kick
    if (this.recoil > 0) { this.recoil = Math.max(0, this.recoil - dt * 6); B.chest.rotation.x += this.recoil * 0.12; }
  }

  fired() { this.recoil = 1; }

  die(fromDir) {
    if (this.dead) return;
    this.dead = true; this.deathT = 0;
    // fall away from the shot
    const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(_Y, this.group.rotation.y);
    this.deathSign = fromDir && fwd.dot(fromDir) > 0 ? 1 : -1;
    this.deathTwist = (Math.random() - 0.5) * 0.8;
    this.deathStart = { y: this.bones.hips.position.y };
  }
  revive() { this.dead = false; this.deathT = 0; this.group.visible = true; this.bones.hips.rotation.set(0, 0, 0); this.mesh.position.set(0, 0, 0); }

  _updateDeath(dt) {
    this.deathT += dt;
    const B = this.bones, t = Math.min(1, this.deathT / 0.75);
    const e = t * t * (3 - 2 * t);
    const fall = e * Math.PI / 2 * 0.98 * this.deathSign;
    B.hips.rotation.set(fall, this.deathTwist * e, 0);
    B.hips.position.y = this.deathStart.y + (0.16 - this.deathStart.y) * Math.pow(t, 1.5);
    B.spine.rotation.x = -0.2 * e * this.deathSign; B.chest.rotation.x = -0.2 * e * this.deathSign;
    for (const s of ['R', 'L']) {
      B['thigh' + s].quaternion.copy(this.rest['thigh' + s]).multiply(_q.setFromEuler(_e.set(0.4 * e * this.deathSign, 0, 0)));
      B['shin' + s].quaternion.setFromEuler(_e.set(0.9 * e, 0, 0));
      B['upperArm' + s].quaternion.slerp(this.rest['upperArm' + s].clone().multiply(_q.setFromEuler(_e.set(-0.9 * this.deathSign, 0, s === 'R' ? 0.6 : -0.6))), Math.min(1, dt * 6));
      B['foreArm' + s].quaternion.slerp(_q2.setFromEuler(_e.set(-0.3, 0, 0)), Math.min(1, dt * 6));
    }
    if (this.deathT > 0.75 && !this.bounced) { this.bounced = true; }
  }

  // world-space hitboxes from bone positions
  updateHitboxes() {
    const B = this.bones;
    this.mesh.updateMatrixWorld(true);
    const P = (b, out, off) => { out.set(off ? off[0] : 0, off ? off[1] : 0, off ? off[2] : 0); return b.localToWorld(out); };
    if (!this.hitboxes.length) {
      const mk = (zone, r) => ({ zone, r, a: new THREE.Vector3(), b: new THREE.Vector3() });
      this.hitboxes = [mk('head', 0.13), mk('chest', 0.2), mk('stomach', 0.18), mk('arms', 0.065), mk('arms', 0.065), mk('legs', 0.09), mk('legs', 0.09), mk('legs', 0.075), mk('legs', 0.075)];
    }
    const h = this.hitboxes;
    P(B.head, h[0].a, [0, 0.1, 0]); h[0].b.copy(h[0].a); h[0].b.y += 0.05;
    P(B.chest, h[1].a, [0, 0.05, 0]); P(B.chest, h[1].b, [0, 0.27, 0]);
    P(B.hips, h[2].a, [0, 0.0, 0]); P(B.spine, h[2].b, [0, 0.15, 0]);
    P(B.upperArmR, h[3].a); P(B.handR, h[3].b);
    P(B.upperArmL, h[4].a); P(B.handL, h[4].b);
    P(B.thighR, h[5].a); P(B.shinR, h[5].b);
    P(B.thighL, h[6].a); P(B.shinL, h[6].b);
    P(B.shinR, h[7].a); P(B.footR, h[7].b);
    P(B.shinL, h[8].a); P(B.footL, h[8].b);
  }

  // ray vs capsules; returns {t, zone} or null
  raycast(o, d, maxT) {
    let best = maxT, zone = null;
    for (const hb of this.hitboxes) {
      const t = rayCapsule(o, d, hb.a, hb.b, hb.r);
      if (t < best) { best = t; zone = hb.zone; }
    }
    return zone ? { t: best, zone } : null;
  }

  muzzleWorld(out) {
    out.copy(this.muzzleLocal); return this.weapon.localToWorld(out);
  }
  headWorld(out) { return this.bones.head.localToWorld(out.set(0, 0.1, 0)); }
  chestWorld(out) { return this.bones.chest.localToWorld(out.set(0, 0.15, 0)); }
}
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _Y = new THREE.Vector3(0, 1, 0);

// ray vs capsule segment ab radius r (d normalized). Returns t or Infinity.
const _ba = new THREE.Vector3(), _oa = new THREE.Vector3();
export function rayCapsule(o, d, a, b, r) {
  _ba.subVectors(b, a); _oa.subVectors(o, a);
  const baba = _ba.dot(_ba), bard = _ba.dot(d), baoa = _ba.dot(_oa), rdoa = d.dot(_oa), oaoa = _oa.dot(_oa);
  const A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h >= 0 && A > 1e-9) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t > 0) return t;
  }
  // caps
  let best = Infinity;
  for (const c of [a, b]) {
    _oa.subVectors(o, c);
    const bb = _oa.dot(d), cc = _oa.dot(_oa) - r * r; h = bb * bb - cc;
    if (h > 0) { const t = -bb - Math.sqrt(h); if (t > 0 && t < best) best = t; }
  }
  return best;
}
void clamp;

// Teammates seen over the network: suited body with gas mask, their own flashlight beam, name tag.
import * as THREE from '../../lib/three.module.js';
import { buildCreatureTemplate, instantiate, animate, deadPose, crawlPose } from './creatures.js';
import { damp, dampAngle, clamp } from '../util.js';
import { makeCanvas } from '../util.js';

const SUITS = [[0.07, 0.09, 0.07], [0.14, 0.07, 0.03], [0.04, 0.07, 0.12], [0.11, 0.11, 0.1]];

export class RemotePlayer {
  constructor(game, slot, name) {
    this.game = game;
    this.slot = slot;
    this.name = name;
    this.pos = new THREE.Vector3(); this.netPos = new THREE.Vector3();
    this.yaw = 0; this.netYaw = 0; this.pitch = 0;
    this.p = { flashOn: true, crouch: false, downed: false, hidden: false, dead: false, sprinting: false, weapon: 'none', hp: 100 };
    this.speed = 0; this.phase = 0; this.stepAcc = 0;
    const tpl = buildCreatureTemplate('human', game.assets, game.skinDetail, game.renderer.qname, { suit: SUITS[slot % 4] });
    this.inst = instantiate(tpl, game.assets);
    this.root = this.inst.root;
    game.scene.add(this.root);
    // flashlight held in the right hand
    this.torch = game.assets.model('small_plastic_torch');
    this.torch.scale.setScalar(1.0);
    this.torch.rotation.set(Math.PI / 2, 0, 0);
    this.torch.position.set(0, -0.08, 0.03);
    this.inst.bones.handR.add(this.torch);
    this.spot = new THREE.SpotLight(0xfff1dc, 0, 22, 0.45, 0.6, 2);
    this.spot.layers.enableAll();
    game.scene.add(this.spot, this.spot.target);
    this.beam = makeBeam();
    game.scene.add(this.beam);
    this.tag = makeTag(name);
    this.root.add(this.tag);
    this.tag.position.y = 2.05;
    this.lastUpdate = performance.now();
  }

  dispose() {
    this.game.scene.remove(this.root, this.spot, this.spot.target, this.beam);
  }

  applyState(s) {
    // s: [x, z, yaw, pitch, flags, weapon, hp]
    this.netPos.set(s[0], 0, s[1]);
    this.netYaw = s[2]; this.pitch = s[3];
    const f = s[4];
    this.p.flashOn = !!(f & 1); this.p.crouch = !!(f & 2); this.p.downed = !!(f & 4); this.p.hidden = !!(f & 8); this.p.dead = !!(f & 16); this.p.sprinting = !!(f & 32);
    this.p.weapon = s[5]; this.p.hp = s[6];
    this.lastUpdate = performance.now();
  }

  update(dt, t, camPos) {
    const g = this.game;
    if (this.pos.distanceTo(this.netPos) > 5) this.pos.copy(this.netPos);
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x = damp(this.pos.x, this.netPos.x, 12, dt);
    this.pos.z = damp(this.pos.z, this.netPos.z, 12, dt);
    this.yaw = dampAngle(this.yaw, this.netYaw, 12, dt);
    const v = Math.hypot(this.pos.x - ox, this.pos.z - oz) / Math.max(dt, 1e-4);
    this.speed = damp(this.speed, v, 8, dt);
    this.phase += dt * this.speed * 2.6;
    const hide = this.p.hidden || this.p.dead && false;
    this.root.visible = !this.p.hidden;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw + Math.PI; // body faces +Z, players face -Z
    if (this.p.downed) crawlPose(this.inst, this.phase, 0.8, t);
    else if (this.p.dead) deadPose(this.inst, 1, 1);
    else animate(this.inst, { phase: this.phase, speed: this.speed / 2.4, t, crouch: this.p.crouch ? 0.7 : 0, pitch: -this.pitch * 0.8, reach: 0, hunch: 0.05 });
    // aim the torch arm forward
    if (!this.p.downed && !this.p.dead) {
      this.inst.bones.armR.rotation.x = -1.25 - this.pitch * 0.9;
      this.inst.bones.foreR.rotation.x = -0.25;
    }
    // light
    const on = this.p.flashOn && !this.p.hidden && !this.p.dead;
    this.root.updateMatrixWorld(true);
    this.torch.getWorldPosition(this.spot.position);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    // emit a little in front of the torch so the teammate's own arm is not inside the hot spot
    this.spot.position.addScaledVector(fwd, 0.25);
    this.spot.target.position.copy(this.spot.position).addScaledVector(fwd, 5);
    this.spot.target.updateMatrixWorld();
    this.spot.intensity = on ? 500 : 0;
    this.beam.visible = on;
    if (on) {
      this.beam.position.copy(this.spot.position);
      this.beam.lookAt(this.spot.target.position);
    }
    this.tag.visible = !this.p.hidden && camPos.distanceTo(this.pos) < 20;
    // footsteps
    if (this.speed > 0.5 && !this.p.hidden) {
      this.stepAcc += this.speed * dt;
      if (this.stepAcc > (this.p.sprinting ? 1.9 : 1.4)) {
        this.stepAcc = 0;
        const surf = g.level.surfaceAt(this.pos.x, this.pos.z);
        g.audio.play(`step_${surf}_${(Math.random() * 4) | 0}`, { pos: this.pos.clone().setY(0.1), vol: this.p.sprinting ? 0.7 : 0.4, ref: 2 });
      }
    }
  }
}

function makeBeam() {
  // faint volumetric cone so you can see where teammates point their light
  const geo = new THREE.ConeGeometry(1.4, 7, 24, 1, true);
  geo.translate(0, -3.5, 0);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {},
    vertexShader: `varying float vL; varying vec3 vN; varying vec3 vV; void main(){ vL = -position.z / 7.0; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vL; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(abs(dot(vN, vV)), 2.0); float a = (1.0 - vL) * f * 0.05; gl_FragColor = vec4(vec3(1.0,0.95,0.85) * a, a); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

function makeTag(name) {
  const cv = makeCanvas(256, 64);
  const ctx = cv.getContext('2d');
  ctx.font = '600 30px "Barlow Condensed", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  const w = Math.min(250, ctx.measureText(name).width + 24);
  ctx.fillRect(128 - w / 2, 12, w, 40);
  ctx.fillStyle = '#e8e2d0';
  ctx.fillText(name, 128, 43);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true, fog: false }));
  s.scale.set(0.8, 0.2, 1);
  return s;
}

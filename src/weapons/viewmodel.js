// First-person viewmodel: weapon + IK arms rendered in a separate pass with
// their own FOV. Keyframe clips (reload, inspect, draw...) are layered with
// procedural springs (sway, bob, recoil, landing, clip "kick" events).
import * as THREE from 'three';
import { buildWeaponModel, socketQuat } from './models.js';
import { applySkin } from './skins.js';
import { buildArms } from './arms.js';
import { WEAPONS } from './weapons.js';
import { ClipPlayer } from '../anim/clip.js';
import { anims } from '../anim/library.js';
import { settings } from '../core/settings.js';
import { DEG, Spring3, clamp, damp } from '../core/util.js';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();

function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,230,1)'); g.addColorStop(0.18, 'rgba(255,200,110,0.95)'); g.addColorStop(0.45, 'rgba(255,120,30,0.35)'); g.addColorStop(1, 'rgba(255,80,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.3;
    const len = 40 + Math.random() * 22;
    const gr = x.createLinearGradient(64, 64, 64 + Math.cos(a) * len, 64 + Math.sin(a) * len);
    gr.addColorStop(0, 'rgba(255,230,170,0.9)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
    x.strokeStyle = gr; x.lineWidth = 6 + Math.random() * 4; x.lineCap = 'round';
    x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.name = 'viewmodel';
    this.camera = new THREE.PerspectiveCamera(settings.vmFov, innerWidth / innerHeight, 0.01, 10);
    this.scene.add(this.camera);
    this.root = new THREE.Group(); this.camera.add(this.root);
    this.gunPivot = new THREE.Group(); this.root.add(this.gunPivot);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sunTarget = new THREE.Object3D(); this.scene.add(this.sunTarget); this.sun.target = this.sunTarget;
    this.scene.add(this.sun);
    this.fill = new THREE.HemisphereLight(0xbfd8ff, 0x9a7b55, 0.25); this.scene.add(this.fill);
    // camera-relative key light keeps the weapon readable in any lighting
    this.key = new THREE.DirectionalLight(0xfff1e0, 0.9);
    this.key.position.set(-0.6, 1.0, 0.7); this.keyTarget = new THREE.Object3D(); this.keyTarget.position.set(0.1, -0.15, -0.4);
    this.camera.add(this.key, this.keyTarget); this.key.target = this.keyTarget;
    this.flashLight = new THREE.PointLight(0xffa850, 0, 2.2, 2); this.root.add(this.flashLight);
    this.player = new ClipPlayer();
    this.player.onEvent = (e) => this._event(e);
    this.models = {};
    this.active = null;
    this.kind = null;
    this.posSpring = new Spring3(170, 15);
    this.rotSpring = new Spring3(150, 13);
    this.swayRot = new Spring3(90, 12);
    this.bobPhase = 0; this.bobAmt = 0; this.time = 0;
    this.camOffset = new THREE.Euler(0, 0, 0, 'YXZ');
    this.camKick = new Spring3(220, 16);
    this.onEvent = null;
    this.magState = 'gun'; this.magBlend = 1; this.magFrom = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.lPoseName = 'grip'; this.rPoseName = 'trigger';
    this.sunVis = 1; this.envScale = 1;
    this.crouch = 0; this.strafe = 0;
    this.visible = true;
    const fm = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const fg = new THREE.PlaneGeometry(1, 1);
    this.flash = new THREE.Group();
    const a = new THREE.Mesh(fg, fm); const b = new THREE.Mesh(fg, fm); b.rotation.y = Math.PI / 2; b.scale.set(1.0, 0.45, 1); b.position.z = -0.25;
    const c = new THREE.Mesh(fg, fm); c.rotation.x = Math.PI / 2; c.scale.set(0.45, 1.0, 1); c.position.z = -0.25;
    this.flash.add(a, b, c); this.flash.visible = false; this.flashT = 0;
    this.flash.traverse((o) => { o.renderOrder = 10; o.frustumCulled = false; });
  }

  async init() {
    const arms = await buildArms();
    this.arms = arms;
    this.root.add(arms.right.mesh, arms.left.mesh);
    // shotgun shell held by the left hand while loading (hand frame: y = fingers, z = back of hand)
    const shell = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.055, 14), new THREE.MeshStandardMaterial({ color: 0x8a1b16, roughness: 0.45, metalness: 0.0 }));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.0112, 0.0112, 0.016, 14), new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.3, metalness: 1 }));
    base.position.y = -0.034; shell.add(hull, base);
    shell.position.set(-0.012, 0.105, -0.028); shell.rotation.set(0, 0, -1.2);
    shell.visible = false;
    arms.left.bones.hand.add(shell);
    this.handShell = shell;
  }

  async preload(kinds) { for (const k of kinds) await this._model(k); }
  async _model(kind) {
    if (!this.models[kind]) {
      const m = await buildWeaponModel(kind);
      const s = m.sockets;
      m.gripQ = socketQuat(s.grip); m.foreQ = socketQuat(s.fore);
      m.magQ = s.mag ? socketQuat(s.mag) : new THREE.Quaternion();
      m.magHoldQ = s.magHold ? socketQuat(s.magHold) : new THREE.Quaternion();
      m.slideNode = m.nodes.bolt || m.nodes.slide || null;
      m.slideOrigin = m.slideNode ? m.slideNode.position.clone() : null;
      m.triggerNode = m.nodes.trigger || null;
      this.models[kind] = m;
    }
    return this.models[kind];
  }

  // skin: {id, wear, seed} or null
  setSkin(m, skin) {
    const key = skin ? skin.id + ':' + (skin.wear ?? 0) + ':' + (skin.seed ?? 0) : '';
    if (m.skinKey === key) return;
    if (m.skinUndo) { m.skinUndo(); m.skinUndo = null; }
    // the muzzle flash is parented to the active gun while equipped
    const flashParent = this.flash.parent; if (flashParent) flashParent.remove(this.flash);
    if (skin) m.skinUndo = applySkin(m.root, skin.id, { wear: skin.wear, seed: skin.seed });
    if (flashParent) flashParent.add(this.flash);
    m.skinKey = key;
  }

  async equip(kind, opts = {}) {
    const seq = (this._equipSeq = (this._equipSeq || 0) + 1);
    const m = await this._model(kind);
    if (seq !== this._equipSeq) return 0; // superseded by a newer equip
    this.setSkin(m, opts.skin || null);
    if (this.active) this.gunPivot.remove(this.active.root);
    this.active = m; this.kind = kind; this.def = WEAPONS[kind];
    this.gunPivot.add(m.root);
    m.root.add(this.flash);
    const mz = m.sockets.muzzle; this.flash.position.set(mz[0], mz[1], mz[2] - 0.03);
    this.flashLight.position.set(0.05, -0.05, -0.6);
    this.magState = 'gun'; this.magBlend = 1; this.magHoldRel = null; this.slideLocked = false;
    if (this.handShell) this.handShell.visible = false;
    if (m.nodes.mag) m.nodes.mag.visible = true;
    this.lPoseName = this.def.vm.lPose; this.rPoseName = this.def.vm.rPose;
    this.posSpring.reset(); this.rotSpring.reset();
    if (opts.noDraw) { this.player.stop(0); return 0; }
    return this.play('draw', { blend: 0 });
  }

  clip(name) { return anims.get(this.kind, name); }
  has(name) { return !!this.clip(name); }
  play(name, opts = {}) {
    const c = this.clip(name);
    if (!c) return 0;
    this.lPoseName = this.def.vm.lPose; this.rPoseName = this.def.vm.rPose;
    if (name !== 'fire' && this.magState !== 'gun') { this.magState = 'gun'; this.magBlend = 1; }
    if (this.active && this.active.nodes.mag && name !== 'fire') this.active.nodes.mag.visible = true;
    this.player.play(c, { blend: opts.blend ?? 0.1, speed: opts.speed || 1, onEnd: opts.onEnd });
    this.player.update(0);
    return c.duration / (opts.speed || 1);
  }
  get current() { return this.player.name; }
  stopClip(blend = 0.15) { this.player.stop(blend); this.magState = 'gun'; this.magBlend = 1; if (this.active?.nodes.mag) this.active.nodes.mag.visible = true; this.lPoseName = this.def.vm.lPose; this.rPoseName = this.def.vm.rPose; }

  // procedural recoil when a shot is fired (plus optional 'fire' clip)
  fire() {
    const vm = this.def.vm;
    const k = vm.kickBack || 0.03, up = vm.kickUp || 4;
    this.posSpring.impulse((Math.random() - 0.5) * 0.08, 0.06 + Math.random() * 0.04, k * 26);
    this.rotSpring.impulse(up * (5 + Math.random() * 2), (Math.random() - 0.5) * up * 3, (Math.random() - 0.5) * up * 5);
    this.camKick.impulse(-up * 0.9, (Math.random() - 0.5) * up * 0.5, 0);
    this.flashT = 0.045; this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    const cls = this.def.cls;
    const s = (cls === 'pistol' ? 0.13 : cls === 'shotgun' ? 0.3 : cls === 'smg' ? 0.16 : 0.2) * (0.85 + Math.random() * 0.35);
    this.flash.scale.set(s, s, s);
    this.flashLight.intensity = 4;
    if (this.player.name === 'inspect') this.player.stop(0.08);
    if (this.has('fire') && (!this.player.playing || this.player.name === 'fire')) this.play('fire', { blend: 0.02 });
  }

  _event(e) {
    const m = this.active;
    switch (e.type) {
      case 'kick':
        if (e.p) this.posSpring.impulse(e.p[0] || 0, e.p[1] || 0, e.p[2] || 0);
        if (e.r) this.rotSpring.impulse(e.r[0] || 0, e.r[1] || 0, e.r[2] || 0);
        if (e.cam) this.camKick.impulse(e.cam[0] || 0, e.cam[1] || 0, e.cam[2] || 0);
        break;
      case 'magToHand': this._magSwitch('hand'); break;
      case 'magToGun': this._magSwitch('gun'); break;
      case 'dropMag':
        if (m && m.nodes.mag) {
          m.nodes.mag.updateWorldMatrix(true, false);
          this.onEvent && this.onEvent({ type: 'dropMag', matrix: m.nodes.mag.matrixWorld.clone(), kind: this.kind, vel: e.v || [0, -1, 0] });
          m.nodes.mag.visible = false;
        }
        break;
      case 'newMag':
        if (m && m.nodes.mag) { m.nodes.mag.visible = true; this.magState = 'hand'; this.magBlend = 1; }
        break;
      case 'lpose': this.lPoseName = e.pose || this.def.vm.lPose; break;
      case 'shellShow': if (this.handShell) this.handShell.visible = true; break;
      case 'shellHide': if (this.handShell) this.handShell.visible = false; break;
      case 'rpose': this.rPoseName = e.pose || this.def.vm.rPose; break;
      default: break;
    }
    if (e.type === 'shell') this._ejectShell();
    this.onEvent && e.type !== 'dropMag' && this.onEvent(e);
  }
  _ejectShell() {
    const m = this.active; if (!m) return;
    const ej = m.sockets.eject;
    _v.set(ej[0], ej[1], ej[2]);
    m.root.localToWorld(_v);
    this.onEvent && this.onEvent({ type: 'ejectShell', pos: _v.clone(), kind: this.kind });
  }
  ejectShell() { this._ejectShell(); }

  _magSwitch(state) {
    const m = this.active; if (!m || !m.nodes.mag) return;
    const mag = m.nodes.mag;
    this.magFrom.p.copy(mag.position); this.magFrom.q.copy(mag.quaternion);
    if (state === 'hand' && this._lHand) {
      // capture the grab: mag stays exactly where the hand took it (no pop)
      const inv = _q.copy(this._lHand.q).invert();
      this.magHoldRel = { p: mag.position.clone().sub(this._lHand.p).applyQuaternion(inv), q: inv.clone().multiply(mag.quaternion) };
      this.magState = state; this.magBlend = 1;
      return;
    }
    this.magState = state; this.magBlend = 0;
  }

  // ctx: {dt, lookDX, lookDY (radians this frame), speed (0..1 of run), onGround, landSpeed, crouch, strafe, aiming}
  update(dt, ctx = {}) {
    this.time += dt;
    this.player.update(dt);
    const pose = this.player.sample();
    const m = this.active;
    if (!m) return;
    const def = this.def, vm = def.vm;

    // ---- gun pivot (hip pose + clip offset)
    const hip = vm.hip;
    this.gunPivot.position.set(hip.p[0] + pose.gun.p[0] + settings.vmOffsetX * 0.04, hip.p[1] + pose.gun.p[1], hip.p[2] + pose.gun.p[2]);
    _q.setFromEuler(_e.set(hip.r[0] * DEG, hip.r[1] * DEG, hip.r[2] * DEG));
    _q2.setFromEuler(_e.set(pose.gun.r[0] * DEG, pose.gun.r[1] * DEG, pose.gun.r[2] * DEG));
    this.gunPivot.quaternion.copy(_q).multiply(_q2);

    // ---- moving parts
    const clipHasBolt = this.player.clip && this.player.clip.tracks && this.player.clip.tracks.bolt && this.player.name !== 'fire';
    const bolt = this.slideLocked && !clipHasBolt ? Math.max(pose.bolt, this.def.slideLock || 0.045) : pose.bolt;
    if (m.slideNode) {
      m.slideNode.position.set(m.slideOrigin.x, m.slideOrigin.y, m.slideOrigin.z + bolt);
      m.slideNode.rotation.set(0, 0, pose.boltRot * DEG);
    }
    if (m.triggerNode) m.triggerNode.rotation.x = -pose.trigger * 18 * DEG;
    // balisong handles (0 = open, 180 = closed): A swings on the edge side, B over the spine
    if (m.nodes.handleA) m.nodes.handleA.rotation.x = pose.hA * DEG;
    if (m.nodes.handleB) m.nodes.handleB.rotation.x = -pose.hB * DEG;
    // model track: rotate the weapon around its spin pivot while the hands stay
    {
      const sp = m.sockets.spin || ZERO3, mr = pose.model.r, mp = pose.model.p;
      if (mr[0] || mr[1] || mr[2] || mp[0] || mp[1] || mp[2]) {
        _q3.setFromEuler(_e.set(mr[0] * DEG, mr[1] * DEG, mr[2] * DEG));
        m.root.quaternion.copy(_q3);
        m.root.position.set(-sp[0], -sp[1], -sp[2]).applyQuaternion(_q3).add(_v3.set(sp[0] + mp[0], sp[1] + mp[1], sp[2] + mp[2]));
      } else if (m.root.position.lengthSq() || m.root.quaternion.w < 1) { m.root.position.set(0, 0, 0); m.root.quaternion.identity(); }
    }

    // ---- hand targets in gun space
    const s = m.sockets;
    const rPos = _rp.set(s.grip.p[0] + pose.rhand.p[0], s.grip.p[1] + pose.rhand.p[1], s.grip.p[2] + pose.rhand.p[2]);
    const rQ = _rq.copy(m.gripQ).multiply(_q.setFromEuler(_e.set(pose.rhand.r[0] * DEG, pose.rhand.r[1] * DEG, pose.rhand.r[2] * DEG)));
    const lPos = _lp.set(s.fore.p[0] + pose.lhand.p[0], s.fore.p[1] + pose.lhand.p[1], s.fore.p[2] + pose.lhand.p[2]);
    const lQ = _lq.copy(m.foreQ).multiply(_q.setFromEuler(_e.set(pose.lhand.r[0] * DEG, pose.lhand.r[1] * DEG, pose.lhand.r[2] * DEG)));

    // ---- magazine
    const mag = m.nodes.mag;
    if (mag) {
      const tp = _v.set(0, 0, 0), tq = _q2;
      if (this.magState === 'hand') {
        if (this.magHoldRel) { tp.copy(this.magHoldRel.p).applyQuaternion(lQ).add(lPos); tq.copy(lQ).multiply(this.magHoldRel.q); }
        else { const h = s.magHold; tp.set(h.p[0], h.p[1], h.p[2]).applyQuaternion(lQ).add(lPos); tq.copy(lQ).multiply(m.magHoldQ); }
      } else {
        tp.set(s.mag.p[0] + pose.mag.p[0], s.mag.p[1] + pose.mag.p[1], s.mag.p[2] + pose.mag.p[2]);
        tq.copy(m.magQ).multiply(_q.setFromEuler(_e.set(pose.mag.r[0] * DEG, pose.mag.r[1] * DEG, pose.mag.r[2] * DEG)));
      }
      if (this.magBlend < 1) {
        this.magBlend = Math.min(1, this.magBlend + dt / 0.09);
        const w = this.magBlend * this.magBlend * (3 - 2 * this.magBlend);
        mag.position.copy(this.magFrom.p).lerp(tp, w);
        mag.quaternion.copy(this.magFrom.q).slerp(tq, w);
      } else { mag.position.copy(tp); mag.quaternion.copy(tq); }
    }

    if (!this._lHand) { this._lHand = { p: new THREE.Vector3(), q: new THREE.Quaternion() }; this._rHand = { p: new THREE.Vector3(), q: new THREE.Quaternion() }; }
    this._lHand.p.copy(lPos); this._lHand.q.copy(lQ); this._rHand.p.copy(rPos); this._rHand.q.copy(rQ);

    // ---- procedural layers on root
    const look = ctx.lookDX || 0, lookY = ctx.lookDY || 0;
    const swayK = 1 / Math.max(dt, 1 / 240);
    this.swayRot.target.set(clamp(-lookY * swayK * 0.9, -6, 6), clamp(-look * swayK * 1.1, -7, 7), clamp(-look * swayK * 0.6, -5, 5));
    this.swayRot.update(dt);
    this.posSpring.update(dt); this.rotSpring.update(dt); this.camKick.update(dt);
    if (ctx.landSpeed > 1) { this.posSpring.impulse(0, -Math.min(0.35, ctx.landSpeed * 0.04), 0); this.rotSpring.impulse(-ctx.landSpeed * 4, 0, 0); this.camKick.impulse(ctx.landSpeed * 1.5, 0, 0); }
    const spd = ctx.speed || 0;
    this.bobAmt = damp(this.bobAmt, ctx.onGround === false ? 0 : spd, 8, dt);
    this.bobPhase += dt * (5.5 + spd * 4.0) * (this.bobAmt > 0.02 ? 1 : 0);
    const ba = this.bobAmt;
    const bx = Math.sin(this.bobPhase) * 0.011 * ba, by = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * ba + 0.006 * ba;
    const breathe = Math.sin(this.time * 1.7) * 0.0012;
    this.crouch = damp(this.crouch, ctx.crouch ? 1 : 0, 9, dt);
    this.strafe = damp(this.strafe, ctx.strafe || 0, 6, dt);
    const air = ctx.onGround === false ? 1 : 0;
    this.air = damp(this.air || 0, air, 6, dt);
    const P = this.posSpring.pos, R = this.rotSpring.pos, S = this.swayRot.pos;
    this.root.position.set(bx + P.x - this.crouch * 0.004 + S.y * 0.0012, by + P.y + breathe - this.crouch * 0.008 - this.air * 0.012, P.z + this.crouch * 0.006);
    this.root.rotation.set((R.x + S.x + Math.cos(this.bobPhase * 2) * 0.5 * ba + this.air * 2.5) * DEG,
      (R.y + S.y) * DEG, (R.z + S.z + Math.sin(this.bobPhase) * 1.2 * ba - this.strafe * 2.5 + this.crouch * 4) * DEG, 'YXZ');

    // ---- IK arms (targets to root space)
    this.gunPivot.updateMatrix();
    const piv = this.gunPivot;
    const rRoot = _v2.copy(rPos).applyMatrix4(piv.matrix);
    const rRootQ = _q.copy(piv.quaternion).multiply(rQ);
    this.arms.right.solve(_shR.set(...vm.shoulderR), rRoot, rRootQ, _poleR.set(...vm.poleR));
    // weapons with a free left hand (knife) keep it in camera space instead of gun space
    const lRoot = vm.lhandFree ? _v.copy(lPos) : _v.copy(lPos).applyMatrix4(piv.matrix);
    const lRootQ = vm.lhandFree ? _q2.copy(lQ) : _q2.copy(piv.quaternion).multiply(lQ);
    this.arms.left.solve(_shL.set(...vm.shoulderL), lRoot, lRootQ, _poleL.set(...vm.poleL));
    this.arms.right.setHandPose(this.rPoseName, pose.rgrip);
    this.arms.left.setHandPose(this.lPoseName, pose.lgrip);

    // ---- camera offset (clip cam track + kick spring)
    const K = this.camKick.pos;
    this.camOffset.set((pose.cam.r[0] + K.x) * DEG, (pose.cam.r[1] + K.y) * DEG, (pose.cam.r[2] + K.z) * DEG, 'YXZ');

    // ---- muzzle flash
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 90);
  }

  // match main camera orientation / lighting
  sync(mainCamera, world, aspect) {
    this.camera.quaternion.copy(mainCamera.quaternion);
    if (this.camera.fov !== settings.vmFov || this.camera.aspect !== aspect) { this.camera.fov = settings.vmFov; this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    if (world) {
      this.sun.position.copy(world.sunDir).multiplyScalar(10);
      this.sun.color.copy(world.sun.color);
      this.sun.intensity = world.sun.intensity * (0.12 + 0.88 * this.sunVis);
      this.scene.environment = world.scene.environment;
      this.scene.environmentIntensity = (world.scene.environmentIntensity || 1) * this.envScale;
      this.fill.color.copy(world.fill.color); this.fill.groundColor.copy(world.fill.groundColor);
    }
  }
}

const _rp = new THREE.Vector3(), _lp = new THREE.Vector3(), _rq = new THREE.Quaternion(), _lq = new THREE.Quaternion();
const _q3 = new THREE.Quaternion(), _v3 = new THREE.Vector3(), ZERO3 = [0, 0, 0];
const _shR = new THREE.Vector3(), _shL = new THREE.Vector3(), _poleR = new THREE.Vector3(), _poleL = new THREE.Vector3();
void _m;

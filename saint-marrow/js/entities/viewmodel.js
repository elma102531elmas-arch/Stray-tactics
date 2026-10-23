// First-person arms, flashlight and weapons, rendered in a second pass on layer 1.
import * as THREE from '../../lib/three.module.js';
import { makeHand, mirrorX } from './hands.js';
import { makeMuzzleFlash, makeFlashlightCookie } from '../engine/textures.js';
import { clamp, damp, lerp } from '../util.js';

const D2R = Math.PI / 180;

function onLayer1(obj) { obj.traverse((o) => { o.layers.set(1); if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } }); }

// Calibrated transforms (camera space: -Z forward, +X right, +Y up)
export const VM = {
  pistol: { hip: [0.145, -0.145, -0.34], ads: [0.0, -0.0855, -0.26], rot: [0, Math.PI / 2 + 0.06, 0], scale: 1.0, muzzle: [0.176, 0.062, 0], hand: [-0.016, -0.012, 0.0], handRot: [0, -Math.PI / 2, -27 * D2R] },
  rifle: { hip: [0.12, -0.165, -0.56], ads: [0.007, -0.071, -0.33], rot: [0, Math.PI / 2 + 0.04, 0], scale: 1.0, muzzle: [0.6, 0.055, 0], hand: [-0.36, -0.04, 0.0], handRot: [0, -Math.PI / 2, -20 * D2R], hand2: [0.05, -0.012, 0.0] },
  crowbar: { hip: [0.2, -0.24, -0.36], rot: [0.25, 0, -0.35], scale: 1.0, hand: [0.005, -0.12, 0.03], handRot: [0, 0, 0] },
  flash: { pos: [-0.2, -0.19, -0.36], rot: [0, Math.PI, 0], hand: [0.0, -0.002, 0.02], handRot: [Math.PI / 2, 0, Math.PI / 2] },
};

export class Viewmodel {
  constructor(game) {
    this.game = game;
    const A = game.assets;
    this.root = new THREE.Group();
    this.sway = new THREE.Group();
    this.root.add(this.sway);
    this.right = new THREE.Group();
    this.left = new THREE.Group();
    this.sway.add(this.right, this.left);
    const detail = game.skinDetail;
    const q = game.renderer.qname;

    // ---- flashlight + left hand
    this.flashObj = new THREE.Group();
    const torch = A.model('small_plastic_torch');
    torch.rotation.set(...VM.flash.rot);
    torch.scale.setScalar(1.05);
    this.flashObj.add(torch);
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 20), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff4e0, emissiveIntensity: 0 }));
    this.lens.position.set(0, 0, -0.121);
    this.lens.rotation.y = Math.PI;
    this.flashObj.add(this.lens);
    const lh = mirrorX(makeHand('flash', A, detail, q));
    lh.position.set(...VM.flash.hand);
    lh.rotation.set(...VM.flash.handRot);
    this.flashObj.add(lh);
    this.leftHand = lh;
    this.left.add(this.flashObj);
    this.left.position.set(...VM.flash.pos);

    // ---- weapons (right side)
    this.weapons = {};
    const pistol = new THREE.Group();
    const pm = A.model('service_pistol');
    const keep = ['service_pistol_pistol_a', 'service_pistol_slide_a', 'service_pistol_hammer_a', 'service_pistol_trigger_a'];
    let slide = null, mag = null;
    pm.traverse((o) => {
      if (!o.isMesh) return;
      const nm = o.name + ' ' + (o.parent?.name || '');
      if (nm.includes('slide_a')) slide = o;
      if (nm.includes('magazine_loaded')) mag = o;
      if (!keep.some((k) => nm.includes(k))) o.visible = false;
    });
    pm.rotation.set(...VM.pistol.rot);
    pistol.add(pm);
    const ph = makeHand('pistol', A, detail, q);
    ph.position.set(...VM.pistol.hand);
    ph.rotation.set(VM.pistol.handRot[0], VM.pistol.handRot[1], VM.pistol.handRot[2], 'ZYX');
    pm.add(ph);
    if (mag) { mag.visible = false; }
    this.weapons.pistol = { obj: pistol, model: pm, slide, slide0: slide ? slide.position.clone() : null, mag, cfg: VM.pistol };

    const rifle = new THREE.Group();
    const rm = A.model('bolt_action_rifle_7_62');
    let boltA = null;
    rm.traverse((o) => {
      if (!o.isMesh) return;
      const nm = o.name + ' ' + (o.parent?.name || '');
      if (nm.includes('bolt_b') || nm.includes('bullet')) o.visible = false;
      if (nm.includes('bolt_a')) boltA = o;
    });
    rm.rotation.set(...VM.rifle.rot);
    rifle.add(rm);
    const rh = makeHand('pistol', A, detail, q);
    rh.position.set(...VM.rifle.hand);
    rh.rotation.set(VM.rifle.handRot[0], VM.rifle.handRot[1], VM.rifle.handRot[2], 'ZYX');
    rm.add(rh);
    // taped flashlight under the barrel
    const tl = A.model('small_plastic_torch');
    tl.rotation.set(0, Math.PI / 2, 0);
    tl.position.set(0.22, -0.035, 0.0);
    tl.scale.setScalar(0.9);
    rm.add(tl);
    const lh2 = mirrorX(makeHand('flash', A, detail, q));
    lh2.position.set(0.1, -0.032, 0.0);
    lh2.rotation.set(-Math.PI / 2, 0, -Math.PI / 2, 'ZYX');
    rm.add(lh2);
    this.weapons.rifle = { obj: rifle, model: rm, bolt: boltA, bolt0: boltA ? boltA.position.clone() : null, cfg: VM.rifle };

    const crow = new THREE.Group();
    const cm = A.model('crowbar_01');
    cm.rotation.set(...VM.crowbar.rot);
    crow.add(cm);
    const ch = makeHand('crowbar', A, detail, q);
    ch.position.set(...VM.crowbar.hand);
    cm.add(ch);
    this.weapons.crowbar = { obj: crow, model: cm, cfg: VM.crowbar };

    for (const k in this.weapons) { this.weapons[k].obj.visible = false; this.right.add(this.weapons[k].obj); }

    // muzzle flash sprite
    this.flashTex = makeMuzzleFlash();
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.muzzle.scale.setScalar(0.18);
    this.muzzle.visible = false;
    this.right.add(this.muzzle);

    onLayer1(this.root);

    // the flashlight beam (real shadow-casting light)
    this.spot = new THREE.SpotLight(0xfff1dc, 1100, 36, 0.62, 0.45, 2);
    this.spot.map = makeFlashlightCookie();
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(game.renderer.q.shadow, game.renderer.q.shadow);
    this.spot.shadow.camera.near = 0.15;
    this.spot.shadow.camera.far = 22;
    this.spot.shadow.bias = -0.0004;
    this.spot.shadow.normalBias = 0.02;
    this.spot.layers.enableAll();
    game.scene.add(this.spot);
    game.scene.add(this.spot.target);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    this.muzzleLight.layers.enableAll();
    game.scene.add(this.muzzleLight);

    this.cur = null;
    this.state = { equip: 0, ads: 0, sprint: 0, recoil: 0, recoilRot: 0, reload: 0, reloadDur: 1, reloadKind: '', melee: 0, use: 0, flashDip: 0, crouch: 0 };
    this.bobT = 0;
    this.swayX = 0; this.swayY = 0;
    this.lag = new THREE.Vector2();
    this.muzzleT = 0;
    this.flashOn = true;
    this.lowered = false;
    this.v = new THREE.Vector3();
  }

  setShadowSize(n) { this.spot.shadow.mapSize.set(n, n); if (this.spot.shadow.map) { this.spot.shadow.map.dispose(); this.spot.shadow.map = null; } }

  setWeapon(id) {
    if (this.cur === id) return;
    for (const k in this.weapons) this.weapons[k].obj.visible = false;
    this.cur = id;
    this.state.equip = 0;
    if (id && this.weapons[id]) this.weapons[id].obj.visible = true;
    // rifle carries the flashlight on the barrel, so the left hand goes to the fore-end
    this.left.visible = id !== 'rifle';
  }

  fire(kind) {
    const s = this.state;
    s.recoil = kind === 'rifle' ? 1.3 : 1;
    s.recoilRot = kind === 'rifle' ? 1.4 : 1;
    this.muzzleT = 0.05;
    this.muzzle.material.rotation = Math.random() * Math.PI * 2;
    this.muzzle.scale.setScalar(kind === 'rifle' ? 0.32 : 0.2);
    if (kind === 'pistol') this.slideT = 0.09;
    if (kind === 'rifle') this.boltT = 0.9;
  }
  reload(kind, dur) { this.state.reload = 0.0001; this.state.reloadDur = dur; this.state.reloadKind = kind; }
  melee() { this.state.melee = 0.0001; }
  use(dur = 1.5) { this.state.use = 0.0001; this.useDur = dur; }
  flashToggle() { this.state.flashDip = 1; }

  muzzleWorld(out) {
    const w = this.weapons[this.cur];
    if (!w || !w.cfg.muzzle) return out.setFromMatrixPosition(this.game.camera.matrixWorld);
    out.set(...w.cfg.muzzle);
    w.model.localToWorld(out);
    // the viewmodel is drawn with its own camera; map it back near the real camera
    return out;
  }

  update(dt, P, cam) {
    const s = this.state;
    const g = this.game;
    // look sway (inertia)
    this.lag.x = damp(this.lag.x, clamp(-P.lookDX * 2.2, -0.06, 0.06), 10, dt);
    this.lag.y = damp(this.lag.y, clamp(-P.lookDY * 2.2, -0.06, 0.06), 10, dt);
    // bob
    const speed = P.speed;
    this.bobT += dt * (speed > 0.1 ? (P.sprint ? 13 : 8.5) : 1.4);
    const bobA = speed > 0.1 ? (P.sprint ? 0.022 : 0.011) * (P.crouch ? 0.6 : 1) : 0.0025;
    const bx = Math.sin(this.bobT) * bobA, by = -Math.abs(Math.cos(this.bobT)) * bobA * 1.2;
    s.ads = damp(s.ads, P.aim && !P.sprint && s.reload === 0 ? 1 : 0, 14, dt);
    s.sprint = damp(s.sprint, P.sprint && speed > 0.1 ? 1 : 0, 8, dt);
    s.equip = Math.min(1, s.equip + dt * 2.8);
    s.recoil = damp(s.recoil, 0, 16, dt);
    s.recoilRot = damp(s.recoilRot, 0, 12, dt);
    s.flashDip = damp(s.flashDip, 0, 10, dt);
    s.crouch = damp(s.crouch, P.crouch ? 1 : 0, 8, dt);
    const lower = (this.lowered ? 1 : 0);
    // ---- right side
    const w = this.weapons[this.cur];
    if (w) {
      const c = w.cfg;
      const hip = c.hip, ads = c.ads || c.hip;
      const a = s.ads * (1 - s.sprint);
      const eq = 1 - Math.pow(1 - s.equip, 3);
      let x = lerp(hip[0], ads[0], a) + bx * (1 - a * 0.85) + this.lag.x * (1 - a * 0.7);
      let y = lerp(hip[1], ads[1], a) + by * (1 - a * 0.85) + this.lag.y * (1 - a * 0.7) - (1 - eq) * 0.3 - s.sprint * 0.05 - lower * 0.35;
      let z = lerp(hip[2], ads[2], a) + s.recoil * (this.cur === 'rifle' ? 0.06 : 0.035);
      let rx = s.recoilRot * (this.cur === 'rifle' ? 0.14 : 0.2) - (1 - eq) * 0.8 - s.sprint * 0.35;
      let ry = s.sprint * 0.55 + this.lag.x * 2;
      let rz = s.sprint * 0.25 + Math.sin(this.bobT * 0.5) * 0.01;
      // reload choreography
      if (s.reload > 0) {
        s.reload += dt / s.reloadDur;
        const r = s.reload;
        const env = Math.sin(Math.min(1, r) * Math.PI);
        if (this.cur === 'pistol') {
          rz += env * 0.55; rx += env * 0.25; y -= env * 0.05; x -= env * 0.04;
          if (w.mag) {
            w.mag.visible = r > 0.1 && r < 0.75;
            const mt = r < 0.4 ? (r - 0.1) / 0.3 : 1 - (r - 0.4) / 0.35;
            w.mag.position.set(-0.012, -0.012 - Math.max(0, mt) * 0.18, 0);
            w.mag.rotation.z = -0.47;
          }
          if (w.slide && r > 0.8 && r < 0.95) w.slide.position.x = w.slide0.x - Math.sin((r - 0.8) / 0.15 * Math.PI) * 0.04;
        } else if (this.cur === 'rifle') {
          rz += env * 0.4; ry -= env * 0.25; y -= env * 0.03; x -= env * 0.05;
          if (w.bolt) {
            const open = r < 0.15 ? r / 0.15 : r > 0.85 ? 1 - (r - 0.85) / 0.15 : 1;
            w.bolt.position.x = w.bolt0.x - open * 0.07;
            w.bolt.rotation.x = -open * 1.2;
          }
        }
        if (s.reload >= 1) { s.reload = 0; if (w.mag) w.mag.visible = false; if (w.slide) w.slide.position.copy(w.slide0); }
      }
      if (this.slideT > 0 && w.slide) { this.slideT -= dt; w.slide.position.x = w.slide0.x - Math.max(0, this.slideT / 0.09) * 0.035; }
      if (this.boltT > 0 && w.bolt) {
        this.boltT -= dt;
        const k = this.boltT > 0.6 ? 0 : Math.sin((1 - this.boltT / 0.6) * Math.PI);
        w.bolt.position.x = w.bolt0.x - k * 0.07; w.bolt.rotation.x = -k * 1.2;
        rz += k * 0.15;
      }
      if (s.melee > 0) {
        s.melee += dt / 0.55;
        const m = s.melee;
        const wind = m < 0.25 ? m / 0.25 : 0;
        const strike = m >= 0.25 && m < 0.6 ? (m - 0.25) / 0.35 : m >= 0.6 ? 1 : 0;
        const back = m > 0.6 ? (m - 0.6) / 0.4 : 0;
        rx += wind * 0.6 - strike * 1.4 + back * 1.4;
        rz += wind * -0.5 + strike * 1.2 - back * 1.2;
        x += wind * 0.08 - strike * 0.2 + back * 0.2;
        y += wind * 0.08;
        if (s.melee >= 1) s.melee = 0;
      }
      w.obj.position.set(x, y, z);
      w.obj.rotation.set(rx, ry, rz);
      // muzzle sprite
      if (this.muzzleT > 0 && c.muzzle) {
        this.muzzleT -= dt;
        this.muzzle.visible = true;
        this.v.set(...c.muzzle);
        w.model.localToWorld(this.v);
        this.right.worldToLocal(this.v);
        this.muzzle.position.copy(this.v);
      } else this.muzzle.visible = false;
    } else this.muzzle.visible = false;

    // ---- left: flashlight
    if (this.left.visible) {
      const a = s.ads * (1 - s.sprint);
      const lp = VM.flash.pos;
      this.left.position.set(lp[0] - a * 0.04 + bx * 0.8 + this.lag.x, lp[1] + by * 0.8 + this.lag.y - s.sprint * 0.06 - s.flashDip * 0.02 - lower * 0.3 - a * 0.02, lp[2] + a * 0.02);
      this.left.rotation.set(-s.sprint * 0.3 + s.flashDip * 0.1, -0.06 + this.lag.x * 1.5 + s.sprint * 0.2, Math.sin(this.bobT * 0.5) * 0.02);
    }
    // use item: both hands dip
    if (s.use > 0) {
      s.use += dt / (this.useDur || 1.5);
      const k = Math.sin(Math.min(1, s.use) * Math.PI);
      this.right.position.y = -k * 0.35; this.left.position.y -= k * 0.25;
      if (s.use >= 1) { s.use = 0; this.right.position.y = 0; }
    }
    this.sway.rotation.z = Math.sin(this.bobT * 0.5) * bobA * 0.6 + P.lean * 0.02;

    // ---- flashlight beam follows the lens (or the rifle-mounted torch)
    const sp = this.spot;
    const camM = cam.matrixWorld;
    if (this.cur === 'rifle') {
      // the torch taped under the barrel: emit from just in front of its lens
      this.v.set(this.weapons.rifle.obj.position.x, this.weapons.rifle.obj.position.y - 0.04, this.weapons.rifle.obj.position.z - 0.42);
    } else {
      this.v.set(this.left.position.x + 0.02, this.left.position.y + 0.03, this.left.position.z - 0.12);
    }
    this.v.z -= 0.03;
    sp.position.copy(this.v).applyMatrix4(camM);
    const aim = new THREE.Vector3(this.lag.x * 0.4 + (this.cur === 'rifle' ? -0.02 : 0.035), this.lag.y * 0.4 - 0.02, -1);
    sp.target.position.copy(aim.multiplyScalar(6)).add(new THREE.Vector3(0, 0, 0)).applyMatrix4(camM);
    sp.target.updateMatrixWorld();
    const on = P.flashOn;
    const pow = P.battery;
    const flick = pow < 0.15 ? (Math.random() < 0.1 + (0.15 - pow) * 3 ? 0.15 : 1) * (0.5 + pow * 3) : 1;
    sp.intensity = on ? 1100 * flick * g.flashMul : 0;
    this.lens.material.emissiveIntensity = on ? 1.5 * flick : 0;
    // muzzle light
    this.muzzleLight.intensity = this.muzzleT > 0 ? 60 : 0;
    if (this.muzzleT > 0) this.muzzleLight.position.copy(sp.position);
  }
}

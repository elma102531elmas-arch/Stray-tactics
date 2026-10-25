// First-person arms, flashlight and weapons, rendered in a second pass on layer 1 (viewmodel camera space: -Z forward).
//
// The weapons are posed by keyframed clips (equip, fire, reload, bolt cycle, melee, use); the arms are solved with
// two-bone IK every frame so the gloves stay on the grip, the fore-end, the magazine or the bolt handle.
// Sounds that belong to an animation (magazine out/in, slide, bolt, rounds) are fired by the clip's events, so they
// always match what you see and stop if the reload is interrupted.
import * as THREE from '../../lib/three.module.js';
import { Arm, makeArmMaterials, basisQuat } from './arms.js';
import { makeMuzzleFlash, makeFlashlightCookie } from '../engine/textures.js';
import { clamp, damp, lerp } from '../util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (t) => t * t * (3 - 2 * t);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();

function onLayer1(obj) { obj.traverse((o) => { o.layers.set(1); if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } }); }

/** Keyframed channel: keys [[t, value]] (value number or array), eased with smoothstep between keys. */
function track(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i];
      if (t <= t1) {
        const [t0, v0] = keys[i - 1];
        const k = smooth((t - t0) / Math.max(1e-6, t1 - t0));
        if (Array.isArray(v0)) return v0.map((a, j) => a + (v1[j] - a) * k);
        return v0 + (v1 - v0) * k;
      }
    }
    return keys[keys.length - 1][1];
  };
}

/**
 * A weapon rig. Points are measured on the Poly Haven models (model space: +X toward the muzzle, +Y up, +Z = right side)
 * and converted to the weapon frame (origin at the right hand's grip, -Z toward the muzzle).
 */
class Rig {
  constructor(model, grip, rot = new THREE.Euler(0, Math.PI / 2, 0)) {
    this.obj = new THREE.Group();
    this.model = model;
    this.rot = new THREE.Quaternion().setFromEuler(rot);
    this.grip = grip.clone();
    model.quaternion.copy(this.rot);
    model.position.copy(grip).negate().applyQuaternion(this.rot);
    this.obj.add(model);
  }
  /** model-space point → weapon frame */
  p(x, y, z) { return V(x, y, z).sub(this.grip).applyQuaternion(this.rot); }
  /** model-space direction → weapon frame */
  d(x, y, z) { return V(x, y, z).normalize().applyQuaternion(this.rot); }
  /**
   * A hand socket: where the hand's grip centre must be (model space), the hand's X axis (toward the pinky for the
   * right hand, toward the thumb for the left) and its Y axis (back of the hand), both in model space.
   * gripLocal is the point inside the closed hand that wraps the object (hand frame).
   */
  socket(center, xAxis, yAxis, gripLocal = V(-0.008, -0.036, -0.088)) {
    const q = basisQuat(this.d(...xAxis), this.d(...yAxis));
    const c = this.p(...center);
    const pos = c.sub(gripLocal.clone().applyQuaternion(q));
    return { pos, quat: q };
  }
}

export class Viewmodel {
  constructor(game) {
    this.game = game;
    const A = game.assets;
    this.root = new THREE.Group();
    this.sway = new THREE.Group();
    this.root.add(this.sway);
    this.mats = makeArmMaterials(game.skinDetail);
    this.armR = new Arm(this.mats, 1);
    this.armL = new Arm(this.mats, -1);
    this.sway.add(this.armR.group, this.armL.group);
    this.armR.group.visible = false;
    this.shoulderR = V(0.21, -0.4, 0.14);
    this.shoulderL = V(-0.22, -0.4, 0.14);
    this.poleR = V(0.55, -1, 0.15);
    this.poleL = V(-0.6, -1, 0.1);

    // ---- flashlight (held in the left hand, or set down on the chest during a pistol reload)
    this.torch = this.buildTorch(A);
    this.sway.add(this.torch.obj);
    this.chest = new THREE.Group();     // where the torch rests while the left hand is busy
    this.chest.position.set(-0.17, -0.26, -0.2);
    this.chest.rotation.set(0.08, -0.05, 0);
    this.sway.add(this.chest);

    // ---- weapons
    this.weapons = { pistol: this.buildPistol(A), rifle: this.buildRifle(A), crowbar: this.buildCrowbar(A) };
    for (const k in this.weapons) { this.weapons[k].obj.visible = false; this.sway.add(this.weapons[k].obj); }

    // muzzle flash sprite
    this.flashTex = makeMuzzleFlash();
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.muzzle.scale.setScalar(0.18);
    this.muzzle.visible = false;
    this.sway.add(this.muzzle);

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
    this.state = { equip: 1, ads: 0, sprint: 0, recoil: 0, recoilRot: 0, reload: 0, reloadDur: 1, reloadKind: '', melee: 0, use: 0, flashDip: 0, crouch: 0 };
    this.clip = null;              // the action playing on the current weapon
    this.bobT = 0;
    this.lag = new THREE.Vector2();
    this.muzzleT = 0;
    this.lowered = false;
    this.torchHeld = true;
    this.attachTorchToHand();
  }

  // ================================================================= construction
  buildTorch(A) {
    const obj = new THREE.Group();
    const m = A.model('small_plastic_torch');
    // lens is at +Z in the model; turn it to face -Z and put the grip (middle of the body) at the origin
    m.rotation.y = Math.PI;
    m.position.set(0.02, 0, 0.0);
    obj.add(m);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 20), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff4e0, emissiveIntensity: 0 }));
    lens.position.set(0.0, 0, -0.114);
    lens.rotation.y = Math.PI;
    obj.add(lens);
    // left hand around the body, thumb forward along the top (on the switch), fingers wrapping underneath
    // the torch runs through the fist (hand X, index side forward); the forearm leaves the hand down and to the left
    const X = V(0, 0.12, -1).normalize(), Zw = V(-0.62, -0.79, 0.12);
    Zw.addScaledVector(X, -Zw.dot(X)).normalize();
    const q = basisQuat(X, new THREE.Vector3().crossVectors(Zw, X));
    const grip = V(0, 0, 0.025);
    const pos = grip.clone().sub(V(0.006, -0.036, -0.09).applyQuaternion(q));
    return { obj, lens, socket: { pos, quat: q }, lensPos: V(0, 0, -0.12) };
  }

  buildPistol(A) {
    const m = A.model('service_pistol');
    let slide = null, mag = null, hammer = null, trigger = null;
    m.traverse((o) => {
      if (!o.isMesh) return;
      const nm = o.name + ' ' + (o.parent?.name || '');
      if (nm.includes('_b') || nm.includes('magazine_empty') || nm.includes('bullet')) { o.visible = false; return; }
      if (nm.includes('slide_a')) slide = o;
      if (nm.includes('magazine_loaded')) mag = o;
      if (nm.includes('hammer_a')) hammer = o;
      if (nm.includes('trigger_a')) trigger = o;
    });
    const r = new Rig(m, V(-0.007, 0.0, 0));
    r.kind = 'pistol';
    r.slide = slide; r.slide0 = slide?.position.clone();
    r.hammer = hammer; r.hammer0 = hammer ? hammer.rotation.z : 0;
    // the magazine model sits beside the gun in the source file; move it into the grip
    if (mag) {
      mag.position.x += 0.092;
      r.mag = mag; r.mag0 = mag.position.clone(); r.magParent = mag.parent;
      r.magDown = V(-0.119, -0.993, 0);          // grip axis (model space), pointing out of the magazine well
      // a second magazine for the left hand (the fresh one)
      const fresh = mag.clone();
      fresh.visible = false;
      r.fresh = fresh;
    }
    r.muzzle = r.p(0.178, 0.062, 0);
    r.sight = r.p(0.04, 0.0795, 0);
    r.eject = r.p(0.05, 0.072, 0.012);
    const down = [-0.119, -0.993, 0];
    r.R = r.socket([-0.009, -0.006, 0], down, [0, 0.12, 1]);
    // left hand holding the fresh magazine by its base, fingers around the body
    r.magHold = { gripLocal: V(-0.004, -0.024, -0.062) };
    r.hip = V(0.105, -0.12, -0.26);
    r.ads = r.sight.clone().negate().add(V(0, 0, -0.3));
    r.handPose = 'trigger';
    return r;
  }

  buildRifle(A) {
    const m = A.model('bolt_action_rifle_7_62');
    let bolt = null, round = null;
    m.traverse((o) => {
      if (!o.isMesh) return;
      const nm = o.name + ' ' + (o.parent?.name || '');
      if (nm.includes('bolt_b')) o.visible = false;
      if (nm.includes('bolt_a')) bolt = o;
      if (nm.includes('bullet')) { round = o; o.visible = false; }
    });
    const r = new Rig(m, V(-0.345, 0.004, 0));
    r.kind = 'rifle';
    // the bolt turns about the bore axis: wrap it in a pivot on that axis
    if (bolt) {
      const pivot = new THREE.Group();
      const axis = V(bolt.position.x, 0.049, 0);
      pivot.position.copy(axis);
      bolt.parent.add(pivot);
      bolt.position.sub(axis);
      pivot.add(bolt);
      r.bolt = pivot; r.bolt0 = pivot.position.clone();
      r.boltKnob = V(-0.226, 0.02, 0.05);          // handle ball, model space (bolt closed)
    }
    if (round) { r.roundTpl = round; }
    // a torch taped under the barrel, lens forward
    const tl = A.model('small_plastic_torch');
    tl.rotation.set(0, Math.PI / 2, 0);
    tl.position.set(0.17 - r.grip.x * 0, -0.02, -0.035);
    tl.scale.setScalar(0.8);
    m.add(tl);
    const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.035, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x3b3a36, roughness: 0.8, side: THREE.DoubleSide }));
    tape.rotation.z = Math.PI / 2;
    tape.position.set(0.17, 0.0, -0.02);
    tape.scale.set(1, 1, 0.8);
    m.add(tape);
    r.lens = r.p(0.265, -0.02, -0.035);
    r.muzzle = r.p(0.6, 0.047, 0);
    r.eye = r.p(-0.33, 0.085, 0);
    r.eject = r.p(-0.2, 0.065, 0.02);
    r.R = r.socket([-0.345, 0.004, 0], [-0.33, -1, 0], [0, 0.15, 1]);
    // support hand under the fore-end: thumb toward the muzzle, palm up
    r.L = r.socket([0.035, 0.026, 0], [1, 0.05, 0], [0, -0.92, -0.38], V(0.008, -0.04, -0.09));
    // right hand on the bolt knob (thumb and index around the ball)
    r.boltHand = { gripLocal: V(-0.03, -0.02, -0.095) };
    r.hip = V(0.14, -0.15, -0.3);
    r.rest = new THREE.Euler(-0.04, 0.05, 0.1);
    r.ads = r.eye.clone().negate().add(V(0, 0, 0));
    r.handPose = 'trigger';
    return r;
  }

  buildCrowbar(A) {
    const m = A.model('crowbar_01');
    // model: bar along +Y, the hook at the top curling toward +Z. Turn it so the hook points forward.
    const r = new Rig(m, V(0.004, -0.18, 0.03), new THREE.Euler(0, Math.PI, 0));
    r.kind = 'crowbar';
    r.R = r.socket([0.004, -0.18, 0.03], [0, -1, 0], [-1, 0, 0], V(-0.004, -0.026, -0.088));
    r.hip = V(0.16, -0.165, -0.32);
    r.rest = new THREE.Euler(-0.75, 0.1, 0.55);
    r.handPose = 'fist';
    return r;
  }

  setShadowSize(n) { this.spot.shadow.mapSize.set(n, n); if (this.spot.shadow.map) { this.spot.shadow.map.dispose(); this.spot.shadow.map = null; } }

  // ================================================================= torch hand-over
  attachTorchToHand() {
    const t = this.torch.obj;
    const h = this.armL.hand.group;
    h.add(t);
    // place the torch so the hand's socket is where the hand is: torch = inverse(socket)
    _m.compose(this.torch.socket.pos, this.torch.socket.quat, V(1, 1, 1)).invert();
    _m.decompose(t.position, t.quaternion, t.scale);
    this.torchHeld = true;
  }
  setTorchOnChest() {
    const t = this.torch.obj;
    this.chest.add(t);
    t.position.set(0, 0, 0); t.quaternion.identity();
    this.torchHeld = false;
  }

  // ================================================================= actions (API used by player/game)
  setWeapon(id) {
    if (this.cur === id) return;
    for (const k in this.weapons) this.weapons[k].obj.visible = false;
    this.endClip();
    this.cur = id;
    this.state.equip = 0;
    if (id && this.weapons[id]) this.weapons[id].obj.visible = true;
    this.torch.obj.visible = id !== 'rifle';
    this.armR.group.visible = !!(id && this.weapons[id]);
  }

  fire(kind, lastRound = false) {
    const s = this.state;
    s.recoil = kind === 'rifle' ? 1.3 : 1;
    s.recoilRot = kind === 'rifle' ? 1.4 : 1;
    this.muzzleT = 0.05;
    this.muzzle.material.rotation = Math.random() * Math.PI * 2;
    this.muzzle.scale.setScalar(kind === 'rifle' ? 0.32 : 0.2);
    if (kind === 'pistol') { this.slideT = 0.07; this.slideLocked = lastRound; }
    if (kind === 'rifle') this.play(this.boltCycleClip(), 1.05);
  }
  reload(kind, dur, opts = {}) {
    this.state.reload = 0.0001; this.state.reloadDur = dur; this.state.reloadKind = kind;
    if (kind === 'pistol') this.play(this.pistolReloadClip(!!opts.empty), dur);
    else if (kind === 'rifle') this.play(this.rifleReloadClip(opts.rounds || Math.max(1, Math.round((dur - 0.6) / 0.6))), dur);
  }
  melee() { this.state.melee = 0.0001; this.play(this.meleeClip(), 0.55); }
  use(dur = 1.5) { this.state.use = 0.0001; this.useDur = dur; this.play(this.useClip(), dur); }
  flashToggle() { this.state.flashDip = 1; }

  play(clip, dur) {
    this.endClip();
    clip.dur = dur;
    clip.t = 0;
    clip.fired = new Set();
    this.clip = clip;
  }
  endClip() {
    const c = this.clip;
    this.clip = null;
    this.state.reload = 0; this.state.melee = 0; this.state.use = 0;
    const p = this.weapons.pistol;
    if (p.mag) { p.mag.visible = true; p.mag.position.copy(p.mag0); p.mag.rotation.set(0, 0, 0); if (p.mag.parent !== p.magParent) p.magParent.add(p.mag); }
    if (p.fresh) { p.fresh.visible = false; }
    if (p.slide) { p.slide.position.copy(p.slide0); if (this.slideLocked) p.slide.position.x -= 0.03; }
    const r = this.weapons.rifle;
    if (r.bolt) { r.bolt.position.copy(r.bolt0); r.bolt.rotation.set(0, 0, 0); }
    if (this.heldRound) this.heldRound.visible = false;
    if (!this.torchHeld) this.attachTorchToHand();
    if (this.dropMag) { this.dropMag.parent?.remove(this.dropMag); this.dropMag = null; }
    return c;
  }
  sound(name, vol = 0.6) { this.game.audio?.play(name, { vol }); }

  // ================================================================= clips
  // Each clip returns per-frame channels for normalized time u (0..1):
  //   gun: [dx, dy, dz, drx, dry, drz] added to the weapon pose
  //   left: { w, pos, rot, pose } — weight toward a free left-hand target in camera space (else the default socket)
  //   right: { w, pos, quat, pose } — same for the right hand (e.g. working a bolt)
  // and `events` [[u, fn]] that run once when u passes them.
  pistolReloadClip(empty) {
    const w = this.weapons.pistol;
    const T = empty
      ? { out: 0.1, down: 0.3, up: 0.52, seat: 0.66, release: 0.76, back: 0.92 }
      : { out: 0.12, down: 0.32, up: 0.55, seat: 0.7, release: 0.7, back: 0.9 };
    // the gun comes to the middle, muzzle up and canted so the magazine well faces the left hand
    const P0 = [0, 0, 0, 0, 0, 0], Pr = [-0.05, 0.1, -0.03, 0.2, 0.4, 0.3], Ps = [-0.05, 0.115, -0.03, 0.18, 0.4, 0.28];
    const gun = track([[0, P0], [0.1, Pr], [T.seat - 0.02, Pr], [T.seat, Ps], [T.seat + 0.04, Pr],
      ...(empty ? [[T.release - 0.02, Pr], [T.release, [-0.05, 0.125, -0.02, 0.26, 0.38, 0.32]], [T.release + 0.04, Pr]] : []),
      [T.back, P0], [1, P0]]);
    const belt = V(-0.1, -0.42, -0.2);
    const gl = V(0, -0.03, -0.07);                 // the point inside the left fist that holds the magazine base
    const up = w.magDown.clone().negate();         // model space, along the grip toward the slide
    return {
      kind: 'reload',
      sample: (u, ctx) => {
        const out = { gun: gun(u) };
        // the hand that seats the magazine: thumb up along the magazine, palm toward the gun, fingers forward
        const magQ = ctx.gunQuat(basisQuat(w.d(up.x, up.y, up.z), w.d(0, -0.15, -1)));
        const seatC = ctx.gunPoint(w.p(-0.012 - up.x * 0.035, -0.052 - up.y * 0.035, 0));    // fist centre just under the grip
        const upCam = ctx.gunDir(w.d(up.x, up.y, up.z));
        const wristAt = (c) => c.clone().sub(gl.clone().applyQuaternion(magQ));
        const L = { w: 0, pose: 'mag' };
        if (u < 0.08) { L.w = smooth(u / 0.075); L.pos = this.chestHandPos(); L.quat = this.chestHandQuat(); L.pose = 'torch'; }
        else if (u < T.down) { const k = smooth((u - 0.08) / (T.down - 0.08)); L.w = 1; L.pos = this.chestHandPos().lerp(belt, k); L.quat = this.chestHandQuat().slerp(magQ, k); L.pose = k > 0.6 ? 'mag' : 'open'; }
        else if (u < T.up) { const k = smooth((u - T.down) / (T.up - T.down)); L.w = 1; L.pos = belt.clone().lerp(wristAt(seatC.clone().addScaledVector(upCam, -0.075)), k); L.quat = magQ; }
        else if (u < T.seat) { const k = smooth((u - T.up) / (T.seat - T.up)); L.w = 1; L.pos = wristAt(seatC.clone().addScaledVector(upCam, -0.075 * (1 - k))); L.quat = magQ; }
        else { const k = smooth(clamp((u - T.seat) / (T.back - T.seat), 0, 1)); L.w = 1 - smooth(clamp((u - T.back) / (1 - T.back), 0, 1)); L.pos = wristAt(seatC).lerp(this.chestHandPos(), k); L.quat = magQ.clone().slerp(this.chestHandQuat(), k); L.pose = k > 0.7 ? 'torch' : 'open'; }
        out.left = L;
        if (w.slide && empty) w.slide.position.x = w.slide0.x - (u < T.release ? 0.03 : 0);
        if (empty && u >= T.release) this.slideLocked = false;
        // the gun's own magazine is gone between release and seating; the fresh one rides in the left hand
        if (w.mag) w.mag.visible = u < T.out || u >= T.seat;
        if (w.fresh) {
          const held = u >= T.down - 0.06 && u < T.seat;
          w.fresh.visible = held;
          if (held) {
            if (w.fresh.parent !== this.armL.hand.group) { this.armL.hand.group.add(w.fresh); onLayer1(w.fresh); }
            // place it as it will be when seated: inverse(hand at the seat) * magazine-in-grip
            w.mag.updateWorldMatrix(true, false);
            const magInSway = _m.copy(this.sway.matrixWorld).invert().multiply(w.mag.matrixWorld);
            const handSeat = new THREE.Matrix4().compose(wristAt(seatC), magQ, V(1, 1, 1)).invert();
            handSeat.multiply(magInSway).decompose(w.fresh.position, w.fresh.quaternion, w.fresh.scale);
          }
        }
        return out;
      },
      events: [
        [T.out, () => { this.sound('mag_out'); this.ejectMag(); }],
        [0.08, () => this.setTorchOnChest()],
        [T.seat - 0.015, () => this.sound('mag_in')],
        ...(empty ? [[T.release, () => this.sound('slide')]] : []),
        [T.back - 0.04, () => this.attachTorchToHand()],
      ],
    };
  }

  rifleReloadClip(n) {
    const w = this.weapons.rifle;
    const open = 0.35, per = 0.6, close = 0.25;
    const total = open + n * per + close;
    const tOpen = open / total, tClose = (open + n * per) / total;
    const R1 = [0.0, -0.045, 0.02, 0.12, 0.12, 0.55];
    const gun = track([[0, [0, 0, 0, 0, 0, 0]], [tOpen, R1], [tClose, R1], [1, [0, 0, 0, 0, 0, 0]]]);
    const belt = V(-0.05, -0.5, -0.2);
    return {
      kind: 'reload',
      sample: (u, ctx) => {
        const out = { gun: gun(u) };
        const s = u * total;
        // bolt: 0..1 lift, then 0..1 travel
        let lift = 0, travel = 0;
        if (s < open) { lift = smooth(clamp(s / 0.13, 0, 1)); travel = smooth(clamp((s - 0.13) / 0.18, 0, 1)); }
        else if (s < open + n * per) { lift = 1; travel = 1; }
        else { const c = s - open - n * per; travel = 1 - smooth(clamp(c / 0.13, 0, 1)); lift = 1 - smooth(clamp((c - 0.13) / 0.09, 0, 1)); }
        this.setBolt(lift, travel);
        out.right = this.boltHandTarget(ctx, s < 0.06 ? s / 0.06 : s > total - 0.05 ? (total - s) / 0.05 : 1);
        // left hand: fetch rounds one by one and press them into the open action
        const L = { w: 0, pose: 'support' };
        if (s >= open && s < open + n * per) {
          const k = (s - open) % per / per;
          const port = ctx.gunPoint(w.p(-0.205, 0.075, 0.0));
          const q = ctx.gunQuat(basisQuat(w.d(1, 0, 0.2), w.d(0, 0.2, -1)));
          if (k < 0.3) { L.w = smooth(k / 0.3); L.pos = belt.clone(); L.quat = q; L.pose = 'open'; }
          else if (k < 0.7) { const kk = smooth((k - 0.3) / 0.4); L.w = 1; L.pos = belt.clone().lerp(port.clone().add(V(-0.01, 0.06, 0)), kk); L.quat = q; L.pose = 'pinch'; }
          else if (k < 0.85) { const kk = smooth((k - 0.7) / 0.15); L.w = 1; L.pos = port.clone().add(V(-0.01, 0.06 - kk * 0.045, 0)); L.quat = q; L.pose = 'pinch'; }
          else { const kk = smooth((k - 0.85) / 0.15); L.w = 1 - kk * 0.4; L.pos = port.clone().add(V(-0.02, 0.03, 0.02)); L.quat = q; L.pose = 'open'; }
          this.showRound(k > 0.25 && k < 0.82);
        } else this.showRound(false);
        out.left = L;
        return out;
      },
      events: [
        [0.02, () => this.sound('bolt_open')],
        ...Array.from({ length: n }, (_, i) => [(open + i * per + per * 0.8) / total, () => this.sound('round_in', 0.5)]),
        [(total - 0.12) / total, () => this.sound('bolt_close')],
      ],
    };
  }

  boltCycleClip() {
    // after the shot: work the bolt (up, back — casing out — forward, down)
    return {
      kind: 'bolt',
      sample: (u, ctx) => {
        const s = u * 1.05;
        let lift = 0, travel = 0;
        if (s > 0.3 && s < 0.95) {
          const c = s - 0.3;
          lift = smooth(clamp(c / 0.1, 0, 1)) * (1 - smooth(clamp((c - 0.55) / 0.1, 0, 1)));
          travel = smooth(clamp((c - 0.1) / 0.15, 0, 1)) * (1 - smooth(clamp((c - 0.3) / 0.2, 0, 1)));
        }
        this.setBolt(lift, travel);
        const handK = s < 0.18 ? 0 : s < 0.3 ? smooth((s - 0.18) / 0.12) : s < 0.95 ? 1 : 1 - smooth((s - 0.95) / 0.1);
        const out = { gun: [0, 0, 0, 0.03 * handK, 0.1 * handK, 0.12 * handK], right: this.boltHandTarget(ctx, handK) };
        return out;
      },
      events: [[0.3, () => this.sound('bolt_open', 0.45)], [0.5, () => this.ejectCasing()], [0.75, () => this.sound('bolt_close', 0.45)]],
    };
  }

  meleeClip() {
    const gun = track([[0, [0, 0, 0, 0, 0, 0]], [0.25, [0.08, 0.1, 0.05, 0.6, -0.35, -0.6]], [0.55, [-0.22, -0.04, -0.08, -0.95, 0.55, 0.9]], [0.7, [-0.22, -0.06, -0.06, -1.0, 0.6, 0.95]], [1, [0, 0, 0, 0, 0, 0]]]);
    return { kind: 'melee', sample: (u) => ({ gun: gun(u) }), events: [] };
  }

  useClip() {
    const gun = track([[0, [0, 0, 0, 0, 0, 0]], [0.2, [0, -0.35, 0.05, -0.6, 0, 0]], [0.8, [0, -0.35, 0.05, -0.6, 0, 0]], [1, [0, 0, 0, 0, 0, 0]]]);
    const dip = track([[0, 0], [0.2, 1], [0.8, 1], [1, 0]]);
    return { kind: 'use', sample: (u) => ({ gun: gun(u), leftDip: dip(u) }), events: [] };
  }

  // ================================================================= part helpers
  setBolt(lift, travel) {
    const r = this.weapons.rifle;
    if (!r.bolt) return;
    r.bolt.rotation.x = -lift * 1.35;
    r.bolt.position.x = r.bolt0.x - travel * 0.085;
  }
  boltKnobModel() {
    const r = this.weapons.rifle;
    // knob position follows the bolt pivot (model space)
    _v.copy(r.boltKnob).sub(r.bolt0);
    _v.applyEuler(_e.set(r.bolt.rotation.x, 0, 0));
    return _v.add(r.bolt.position).clone();
  }
  boltHandTarget(ctx, k) {
    const r = this.weapons.rifle;
    if (!r.bolt || k <= 0) return { w: 0 };
    const knob = this.boltKnobModel();
    const pos = ctx.gunPoint(r.p(knob.x, knob.y, knob.z));
    const q = ctx.gunQuat(basisQuat(r.d(0.2, -1, 0.3), r.d(0.1, 0.3, 1)));
    return { w: clamp(k, 0, 1), pos: pos.sub(r.boltHand.gripLocal.clone().applyQuaternion(q)), quat: q, pose: 'pinch' };
  }
  showRound(on) {
    if (!this.heldRound) {
      const tpl = this.weapons.rifle.roundTpl;
      if (!tpl) return;
      const g = new THREE.Group();
      const m = tpl.clone();
      m.visible = true;
      m.position.set(0, 0, 0);
      g.add(m);
      m.rotation.set(0, Math.PI / 2, 0);
      g.position.set(-0.026, -0.012, -0.11);
      onLayer1(g);
      this.armL.hand.group.add(g);
      this.heldRound = g;
    }
    this.heldRound.visible = on;
  }
  ejectMag() {
    const w = this.weapons.pistol;
    if (!w.mag) return;
    // a copy of the magazine drops out of the grip and falls away
    const m = w.mag.clone();
    m.visible = true;
    const holder = new THREE.Group();
    w.mag.updateWorldMatrix(true, false);
    this.sway.updateWorldMatrix(true, false);
    _m.copy(this.sway.matrixWorld).invert().multiply(w.mag.matrixWorld);
    _m.decompose(holder.position, holder.quaternion, holder.scale);
    m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1);
    holder.add(m);
    onLayer1(holder);
    this.sway.add(holder);
    const dir = w.magDown.clone().applyQuaternion(w.rot).applyQuaternion(w.obj.quaternion);
    this.dropMag = holder;
    holder.userData.v = dir.multiplyScalar(0.9);
    holder.userData.spin = (Math.random() - 0.5) * 6;
    holder.userData.t = 0;
  }
  ejectCasing() {
    const g = this.game;
    if (!g.fx?.casing || !g.camera) return;
    const r = this.weapons.rifle;
    _v.copy(r.eject).applyMatrix4(r.obj.matrixWorld);
    // viewmodel space → near the real camera
    const cam = g.camera;
    _w.copy(_v).applyMatrix4(_m.copy(this.root.parent?.matrixWorld || new THREE.Matrix4()).invert()).applyMatrix4(cam.matrixWorld);
    const right = V(1, 0, 0).transformDirection(cam.matrixWorld);
    g.fx.casing(_w.clone(), right.multiplyScalar(1.8).add(V(0, 2.2, 0)), g.assets, 'rifle');
  }
  chestHandPos() { return V(-0.17, -0.26, -0.2).add(this.torch.socket.pos.clone().applyQuaternion(this.chest.quaternion)); }
  chestHandQuat() { return this.chest.quaternion.clone().multiply(this.torch.socket.quat); }

  muzzleWorld(out) {
    const w = this.weapons[this.cur];
    if (!w || !w.muzzle) return out.setFromMatrixPosition(this.game.camera.matrixWorld);
    out.copy(w.muzzle);
    w.obj.localToWorld(out);
    return out;
  }

  // ================================================================= per frame
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
    const busy = this.clip && (this.clip.kind === 'reload' || this.clip.kind === 'use');
    s.ads = damp(s.ads, P.aim && !P.sprint && !busy ? 1 : 0, 14, dt);
    s.sprint = damp(s.sprint, P.sprint && speed > 0.1 && !busy ? 1 : 0, 8, dt);
    s.equip = Math.min(1, s.equip + dt * 2.6);
    s.recoil = damp(s.recoil, 0, 16, dt);
    s.recoilRot = damp(s.recoilRot, 0, 12, dt);
    s.flashDip = damp(s.flashDip, 0, 10, dt);
    s.crouch = damp(s.crouch, P.crouch ? 1 : 0, 8, dt);
    const lower = this.lowered ? 1 : 0;
    this.sway.position.set(0, 0, 0);
    this.sway.rotation.set(0, 0, Math.sin(this.bobT * 0.5) * bobA * 0.6 + (P.lean || 0) * 0.02);
    this.sway.updateMatrixWorld(true);

    // ---- clip: sampled once for the weapon offset, and again for the hands once the weapon is posed this frame
    let ch = null, clipU = -1;
    if (this.clip) {
      const c = this.clip;
      c.t += dt;
      clipU = Math.min(1, c.t / c.dur);
      ch = c.sample(clipU, this.clipCtx());
      if (c.kind === 'reload') s.reload = clipU;
    }
    if (this.dropMag) {
      const d = this.dropMag, ud = d.userData;
      ud.t += dt; ud.v.y -= 9.8 * dt * 0.6;
      d.position.addScaledVector(ud.v, dt);
      d.rotation.z += ud.spin * dt;
      if (ud.t > 0.8) { d.parent?.remove(d); this.dropMag = null; }
    }

    // ---- weapon pose
    const w = this.weapons[this.cur];
    if (w) {
      const a = s.ads * (1 - s.sprint);
      const eq = 1 - Math.pow(1 - s.equip, 3);
      const hip = w.hip, ads = w.ads || w.hip;
      let x = lerp(hip.x, ads.x, a) + bx * (1 - a * 0.85) + this.lag.x * (1 - a * 0.7) - s.sprint * 0.03;
      let y = lerp(hip.y, ads.y, a) + by * (1 - a * 0.85) + this.lag.y * (1 - a * 0.7) - (1 - eq) * 0.3 - s.sprint * 0.06 - lower * 0.4 - s.crouch * 0.01;
      let z = lerp(hip.z, ads.z, a) + s.recoil * (this.cur === 'rifle' ? 0.06 : 0.035);
      let rx = s.recoilRot * (this.cur === 'rifle' ? 0.12 : 0.22) * (1 - a * 0.5) - (1 - eq) * 0.9 - s.sprint * 0.45;
      let ry = s.sprint * (this.cur === 'pistol' ? 0.7 : 0.5) + this.lag.x * 2;
      let rz = s.sprint * 0.25 + Math.sin(this.bobT * 0.5) * 0.01;
      if (w.rest) { rx += w.rest.x * (1 - s.sprint * 0.5); ry += w.rest.y; rz += w.rest.z; }
      if (ch?.gun) { const G = ch.gun; x += G[0]; y += G[1]; z += G[2]; rx += G[3]; ry += G[4]; rz += G[5]; }
      w.obj.position.set(x, y, z);
      w.obj.rotation.set(rx, ry, rz, 'YXZ');
      w.obj.updateMatrixWorld(true);
      if (ch) ch = this.clip.sample(clipU, this.clipCtx());
      // slide blowback / hammer
      if (this.slideT > 0 && w.slide) { this.slideT -= dt; w.slide.position.x = w.slide0.x - Math.max(0, this.slideT / 0.07) * 0.03; if (this.slideT <= 0) w.slide.position.x = w.slide0.x - (this.slideLocked ? 0.03 : 0); }
      // muzzle sprite
      if (this.muzzleT > 0 && w.muzzle) {
        this.muzzleT -= dt;
        this.muzzle.visible = true;
        this.muzzle.position.copy(w.muzzle).applyMatrix4(w.obj.matrix);
      } else this.muzzle.visible = false;
      // right arm on the grip (or wherever the clip wants it)
      const R = w.R;
      _v.copy(R.pos).applyMatrix4(w.obj.matrix);
      _q.copy(w.obj.quaternion).multiply(R.quat);
      let poseR = w.handPose;
      if (ch?.right?.w > 0) { _v.lerp(ch.right.pos, ch.right.w); _q.slerp(ch.right.quat, ch.right.w); if (ch.right.w > 0.5) poseR = ch.right.pose; }
      this.armR.solve(this.shoulderR, _v, _q, this.poleR);
      this.armR.hand.setPose(poseR, 0);
      this.armR.hand.update(dt, 22);
    } else { this.muzzle.visible = false; this.armR.group.visible = false; }
    if (this.clip && clipU >= 0) {
      const c = this.clip;
      for (const [eu, fn] of c.events) if (clipU >= eu && !c.fired.has(eu)) { c.fired.add(eu); fn(); }
    }

    // ---- left arm: rifle fore-end, or the torch
    const L = this.armL;
    let lp, lq, poseL;
    if (this.cur === 'rifle') {
      const r = this.weapons.rifle;
      lp = r.L.pos.clone().applyMatrix4(r.obj.matrix);
      lq = r.obj.quaternion.clone().multiply(r.L.quat);
      poseL = 'support';
    } else {
      const a = s.ads * (1 - s.sprint);
      const lean = this.cur === 'pistol' ? a : 0;
      // torch hand: low left, swinging with the walk; with the pistol aimed it tucks under the gun (Harries-style)
      const tp = V(-0.17 + lean * 0.1 + bx * 0.8 + this.lag.x, -0.165 + by * 0.8 + this.lag.y - s.sprint * 0.07 - s.flashDip * 0.02 - lower * 0.35 - lean * 0.01, -0.38 + lean * 0.06);
      const tq = _q2.setFromEuler(_e.set(-s.sprint * 0.35 + s.flashDip * 0.12 + lean * 0.05, -0.05 + this.lag.x * 1.5 + s.sprint * 0.25 - lean * 0.1, Math.sin(this.bobT * 0.5) * 0.02 + lean * 0.25, 'YXZ'));
      // the hand holds the torch through the socket: wrist = torchPose * socket
      lp = this.torch.socket.pos.clone().applyQuaternion(tq).add(tp);
      lq = tq.clone().multiply(this.torch.socket.quat);
      poseL = 'torch';
      if (ch?.leftDip) { lp.y -= ch.leftDip * 0.3; }
    }
    if (ch?.left?.w > 0) {
      lp.lerp(ch.left.pos, ch.left.w);
      if (ch.left.quat) lq.slerp(ch.left.quat, ch.left.w);
      if (ch.left.w > 0.5 && ch.left.pose) poseL = ch.left.pose;
    }
    if (!this.torchHeld && poseL === 'torch') poseL = 'open';
    L.solve(this.shoulderL, lp, lq, this.poleL);
    L.hand.setPose(poseL, 0);
    L.hand.update(dt, 20);
    L.group.visible = true;
    if (this.clip && clipU >= 1) this.endClip();
    this.root.updateMatrixWorld(true);

    // ---- flashlight beam from the torch lens (or the rifle's taped torch)
    const sp = this.spot;
    let lens, dir;
    if (this.cur === 'rifle') {
      const r = this.weapons.rifle;
      lens = r.lens.clone().applyMatrix4(r.obj.matrixWorld);
      dir = V(0, 0, -1).transformDirection(r.obj.matrixWorld);
    } else {
      lens = this.torch.lensPos.clone().applyMatrix4(this.torch.obj.matrixWorld);
      dir = V(0, 0, -1).transformDirection(this.torch.obj.matrixWorld);
    }
    // aim converges a little toward the crosshair so the beam lights what you look at
    const ahead = V(0, 0, -6).applyMatrix4(cam.matrixWorld);
    sp.position.copy(lens);
    sp.target.position.copy(dir).multiplyScalar(6).add(lens).lerp(ahead, 0.45);
    sp.target.updateMatrixWorld();
    const on = P.flashOn;
    const pow = P.battery;
    const flick = pow < 0.15 ? (Math.random() < 0.1 + (0.15 - pow) * 3 ? 0.15 : 1) * (0.5 + pow * 3) : 1;
    sp.intensity = on ? 1100 * flick * (g.flashMul ?? 1) : 0;
    this.torch.lens.material.emissiveIntensity = on ? 1.5 * flick : 0;
    this.muzzleLight.intensity = this.muzzleT > 0 ? 60 : 0;
    if (this.muzzleT > 0) this.muzzleLight.position.copy(sp.position);
  }

  /** helpers the clips use to turn weapon-frame points and directions into camera space */
  clipCtx() {
    const w = this.weapons[this.cur];
    const obj = w ? w.obj : null;
    if (obj) obj.updateMatrix();
    const inv = obj ? new THREE.Quaternion().copy(obj.quaternion).invert() : new THREE.Quaternion();
    return {
      gunPoint: (p) => (obj ? p.clone().applyMatrix4(obj.matrix) : p.clone()),
      gunDir: (d) => (obj ? d.clone().applyQuaternion(obj.quaternion) : d.clone()),
      gunQuat: (q) => (obj ? obj.quaternion.clone().multiply(q) : q.clone()),
      gunWorldInv: inv,
    };
  }
}

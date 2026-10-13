// Built-in animation clips (same JSON format the Animation Studio exports).
// Hand/mag tracks are offsets from the weapon sockets; gun is an offset from
// the hip pose. Rotations in degrees, positions in meters.

const K = (t, p, r, e) => (e ? { t, p, r, e } : { t, p, r });
// anchored key: position follows a weapon feature ('mag', 'charge', 'port') when
// the clip is retargeted to another gun (see anim/library.js)
const KA = (a, t, p, r, e) => ({ ...K(t, p, r, e), a });
const V = (t, v, e) => (e ? { t, v, e } : { t, v });
const Z = [0, 0, 0];
const S = (t, name) => ({ t, type: 'sound', name });
const KICK = (t, p, r, cam) => ({ t, type: 'kick', p, r, cam });
const EV = (t, type, extra) => ({ t, type, ...(extra || {}) });
const add = (a, b) => a.map((v, i) => +(v + b[i]).toFixed(4));

// ====================================================================== RIFLE
const R_LH_MAG = [0.02, -0.059, 0.289], R_LH_MAG_R = [112, 0, -72];
const R_RH_CH = [0.036, 0.072, -0.145], R_RH_CH_R = [0, 0, 41];

const rifleDraw = {
  name: 'draw', weapon: 'rifle', duration: 0.8,
  tracks: {
    gun: [K(0, [0.03, -0.24, 0.1], [-50, 25, 40]), K(0.32, [0.0, 0.012, -0.01], [5, -2, -4]), K(0.5, [0, -0.004, 0.003], [-1.5, 0.6, 1.2]), K(0.8, Z, Z)],
    lhand: [K(0, [-0.06, -0.16, 0.12], [0, 0, 30]), K(0.18, [-0.04, -0.08, 0.07], [0, 0, 15]), K(0.42, Z, Z)],
    lgrip: [V(0, 0.2), V(0.3, 0.3), V(0.42, 1)],
    cam: [K(0, Z, Z), K(0.25, Z, [-1.2, 0.4, 0.8]), K(0.8, Z, Z)],
  },
  events: [S(0.02, 'draw'), KICK(0.33, [0, -0.06, 0.06], [-10, 0, 3]), S(0.42, 'gear')],
};

const rifleFire = {
  name: 'fire', weapon: 'rifle', duration: 0.1,
  tracks: { bolt: [V(0, 0), V(0.022, 0.075, 'out'), V(0.07, 0, 'in'), V(0.1, 0)], trigger: [V(0, 1), V(0.07, 0.2), V(0.1, 0)] },
  events: [EV(0.015, 'shell')],
};

function rifleReload(empty) {
  // reload stance: gun lifted toward the centre and canted so the mag well is visible
  const T = (dp, dr, t, e) => K(t, [-0.062 + dp[0], 0.105 + dp[1], 0.03 + dp[2]], [16 + dr[0], -6 + dr[1], -34 + dr[2]], e);
  const g = [
    K(0, Z, Z),
    T([0.01, -0.02, 0], [-6, 2, 8], 0.2),
    T([0, 0, 0], [0, 0, 0], 0.3),
    T([-0.004, -0.008, 0.004], [-2, -1, -3], 0.37), // mag release tug
    T([0, 0.004, 0], [1, 0, 1], 0.5),
    T([-0.004, 0.01, 0], [2, -1, -2], 1.05),
    T([0, -0.006, 0.002], [-2, 1, 2], 1.24), // mag seated
    T([-0.002, 0.004, 0], [1, 0, 0], 1.34),
  ];
  const lh = [
    K(0, Z, Z),
    K(0.1, [0.0, -0.04, 0.1], [40, 0, -30]),
    KA('mag', 0.24, R_LH_MAG, R_LH_MAG_R),
    KA('mag', 0.3, R_LH_MAG, R_LH_MAG_R),
    KA('mag', 0.42, [0.03, -0.16, 0.24], [95, 0, -70]), // pull mag down & forward
    KA('mag', 0.52, [-0.02, -0.3, 0.3], [70, 0, -50]), // toss
    K(0.72, [-0.12, -0.42, 0.42], [60, 0, -40]), // pouch (off screen)
    K(0.8, [-0.12, -0.42, 0.42], [60, 0, -40]),
    KA('mag', 1.0, [0.01, -0.17, 0.26], [100, 0, -66]), // new mag coming up
    KA('mag', 1.14, [0.02, -0.075, 0.282], [118, 0, -73]), // hooking the front lip
    KA('mag', 1.24, R_LH_MAG, R_LH_MAG_R), // rock in
  ];
  const lg = [V(0, 1), V(0.12, 0.25), V(0.24, 1), V(0.6, 1), V(0.66, 0.3), V(0.78, 1), V(1.3, 1)];
  const mag = [K(0, Z, Z), K(0.28, Z, Z), K(0.36, [0, -0.004, -0.004], [-6, 0, 0]),
    K(1.14, [0, -0.012, -0.012], [-14, 0, 0]), K(1.24, Z, Z)];
  const ev = [
    S(0.05, 'gear'), EV(0.26, 'lpose', { pose: 'mag' }), S(0.3, 'magRelease'), EV(0.31, 'magToHand'), S(0.38, 'magOut'),
    KICK(0.38, [0, -0.04, 0], [-4, 0, 2]),
    EV(0.5, 'dropMag', { v: [-1.2, -1.5, 0.6] }),
    EV(0.78, 'newMag'), S(0.8, 'pouch'),
    EV(1.14, 'magToGun'), S(1.2, 'magIn'),
    KICK(1.24, [0, 0.1, 0.02], [9, 0, -4], [1.2, 0, 0]),
    EV(1.25, 'ammo'),
  ];
  const cam = [K(0, Z, Z), K(0.3, Z, [-0.8, 0.6, 0.6]), K(0.52, Z, [0.4, 0.2, 0.2]), K(1.0, Z, [-0.5, 0.3, 0.8]), K(1.3, Z, [0.6, 0, 0])];
  const tracks = { gun: g, lhand: lh, lgrip: lg, mag, cam };
  if (!empty) {
    g.push(K(1.6, [-0.006, 0.006, 0.004], [-1, -2, -4]), K(1.85, [0, -0.002, 0], [0.6, 0.2, 0.8]), K(2.15, Z, Z));
    lh.push(K(1.38, [0.0, -0.04, 0.16], [60, 0, -36]), K(1.62, [0, 0.008, -0.004], [-6, 0, 4]), K(1.85, Z, Z));
    lg.push(V(1.4, 0.4), V(1.62, 1));
    ev.push(EV(1.3, 'lpose', { pose: 'grip' }), S(1.66, 'gear'));
    cam.push(K(1.9, Z, Z));
    return { name: 'reload', weapon: 'rifle', duration: 2.15, tracks, events: ev };
  }
  // empty: cant the rifle to show its right side, right hand racks the charging handle
  const C = (dp, dr, t, e) => K(t, [-0.04 + dp[0], 0.06 + dp[1], 0.0 + dp[2]], [8 + dr[0], 4 + dr[1], 24 + dr[2]], e);
  g.push(C([0, 0, 0], [0, 0, 0], 1.55), C([0, 0.004, 0], [1, 0, 1], 1.72), C([0.002, -0.006, 0.006], [-2, 0, -2], 1.8), C([0, 0.003, 0], [1, 0, 1], 1.88),
    K(2.15, [-0.004, 0.006, 0.004], [-1, -1, -3]), K(2.4, [0, -0.002, 0], [0.5, 0.2, 0.6]), K(2.7, Z, Z));
  lh.push(K(1.38, [0.0, -0.04, 0.16], [60, 0, -36]), K(1.58, [0, 0.008, -0.004], [-6, 0, 4]), K(1.75, Z, Z));
  lg.push(V(1.4, 0.4), V(1.58, 1));
  tracks.rhand = [K(0, Z, Z), K(1.4, Z, Z), K(1.52, [0.04, 0.02, -0.04], [0, 0, 20]), KA('charge', 1.62, R_RH_CH, R_RH_CH_R), KA('charge', 1.66, R_RH_CH, R_RH_CH_R),
    KA('charge', 1.76, add(R_RH_CH, [0, 0.004, 0.09]), R_RH_CH_R, 'out'), KA('charge', 1.8, add(R_RH_CH, [0.02, 0.03, 0.1]), [0, 0, 30]),
    K(1.98, [0.03, 0.01, 0.0], [0, 0, 10]), K(2.15, Z, Z)];
  tracks.rgrip = [V(1.4, 1), V(1.52, 0.2), V(1.62, 0.9), V(1.76, 1), V(1.8, 0.15), V(2.05, 0.4), V(2.15, 1)];
  tracks.bolt = [V(1.66, 0), V(1.76, 0.09, 'out'), V(1.8, 0.09, 'linear'), V(1.84, 0, 'in')];
  ev.push(EV(1.3, 'lpose', { pose: 'grip' }), EV(1.5, 'rpose', { pose: 'grip' }), S(1.7, 'boltBack'), S(1.83, 'boltForward'),
    KICK(1.85, [0, 0.03, 0.06], [6, 1, -3], [0.8, 0, 0]), EV(2.1, 'rpose', { pose: 'trigger' }), S(2.2, 'gear'));
  cam.push(K(1.7, Z, [-0.6, 0.4, 0.5]), K(1.86, Z, [0.6, 0, 0]), K(2.4, Z, Z));
  return { name: 'reloadEmpty', weapon: 'rifle', duration: 2.7, tracks, events: ev };
}

const rifleInspect = {
  name: 'inspect', weapon: 'rifle', duration: 4.6,
  tracks: {
    gun: [
      K(0, Z, Z),
      K(0.18, [0.01, -0.012, 0.01], [-3, -4, 4]), // anticipation
      K(0.62, [-0.075, 0.05, -0.05], [4, 52, -12]), // swing: left side towards camera
      K(0.75, [-0.078, 0.052, -0.052], [5, 55, -13]),
      K(1.65, [-0.07, 0.058, -0.045], [2, 50, -8]),
      K(2.2, [-0.06, 0.07, -0.03], [-6, 40, 62]), // roll: show the top & right side
      K(2.32, [-0.062, 0.072, -0.032], [-7, 42, 66]),
      K(3.3, [-0.058, 0.066, -0.028], [-4, 38, 58]),
      K(3.78, [-0.01, 0.006, 0.0], [2, -3, -5]),
      K(3.98, [0.004, -0.006, 0.0], [-1.2, 0.8, 1.6]),
      K(4.6, Z, Z),
    ],
    lhand: [K(0, Z, Z), K(0.7, Z, Z), K(1.2, [0, 0, -0.035], [0, 0, -5]), K(1.7, [0, 0, -0.01], Z), K(2.7, [0, -0.005, 0.025], [0, 0, 4]), K(3.4, Z, Z)],
    lgrip: [V(0, 1), V(1.0, 0.7), V(1.25, 1), V(2.6, 0.75), V(2.85, 1)],
    cam: [K(0, Z, Z), K(0.65, Z, [-0.6, 0.8, 0.5]), K(2.25, Z, [0.4, -0.4, -0.6]), K(3.85, Z, [0.2, 0, 0]), K(4.6, Z, Z)],
  },
  events: [S(0.15, 'gear'), S(1.95, 'gear'), S(3.6, 'gear')],
};

// ====================================================================== PISTOL
const P_LH_MAG = [0.051, -0.094, 0.053], P_LH_MAG_R = [-69.5, -67.2, -96.7];
const P_MAG_IN = [0, -0.038, 0.012];

const pistolDraw = {
  name: 'draw', weapon: 'pistol', duration: 0.6,
  tracks: {
    gun: [K(0, [0.02, -0.2, 0.08], [-55, -10, 30]), K(0.26, [0, 0.01, -0.01], [6, 0, -3]), K(0.4, [0, -0.003, 0.003], [-1.5, 0, 1]), K(0.6, Z, Z)],
    lhand: [K(0, [-0.08, -0.15, 0.1], [0, 0, 20]), K(0.32, Z, Z)],
    lgrip: [V(0, 0.3), V(0.2, 0.4), V(0.32, 1)],
  },
  events: [S(0.02, 'draw'), KICK(0.27, [0, -0.05, 0.04], [-8, 0, 2])],
};

const pistolFire = {
  name: 'fire', weapon: 'pistol', duration: 0.12,
  tracks: { bolt: [V(0, 0), V(0.02, 0.042, 'out'), V(0.075, 0, 'in'), V(0.12, 0)], trigger: [V(0, 1), V(0.08, 0.2), V(0.12, 0)] },
  events: [EV(0.012, 'shell')],
};

function pistolReload(empty) {
  // lift the pistol and cant it so the mag well is in view
  const T = (dp, dr, t) => K(t, [-0.035 + dp[0], 0.085 + dp[1], 0.01 + dp[2]], [14 + dr[0], 8 + dr[1], -26 + dr[2]]);
  const g = [K(0, Z, Z), T([0.006, -0.02, 0], [-4, 0, 8], 0.12), T(Z, Z, 0.22), T([0, 0.004, 0], [1, 0, -1], 0.8), T([0, -0.008, 0], [-3, 0, 2], 0.93), T([0, 0.003, 0], [1, 0, 0], 1.02)];
  const mag = [K(0.0, Z, Z), K(0.86, P_MAG_IN, Z), K(0.93, Z, Z)];
  const lh = [K(0, Z, Z), K(0.1, [-0.03, -0.06, 0.05], [0, 0, 10]), K(0.38, [-0.15, -0.34, 0.2], [-40, -40, -60]), K(0.48, [-0.15, -0.34, 0.2], [-40, -40, -60]),
    KA('mag', 0.75, add(P_LH_MAG, [-0.01, -0.06, 0.02]), P_LH_MAG_R), KA('mag', 0.86, P_LH_MAG, P_LH_MAG_R), KA('mag', 0.93, add(P_LH_MAG, [0, 0.04, -0.012]), P_LH_MAG_R)];
  const lg = [V(0, 1), V(0.1, 0.3), V(0.4, 0.3), V(0.5, 0.9), V(0.86, 0.9), V(0.9, 0.4)];
  const ev = [S(0.04, 'gear'), S(0.1, 'magRelease'), EV(0.12, 'dropMag', { v: [0, -2.2, 0.4] }), S(0.14, 'magOut'),
    EV(0.48, 'newMag'), EV(0.47, 'lpose', { pose: 'mag' }), S(0.5, 'pouch'),
    EV(0.86, 'magToGun'), S(0.92, 'magIn'), KICK(0.93, [0, 0.12, 0], [10, 0, -3], [1.0, 0, 0]), EV(0.94, 'ammo')];
  const cam = [K(0, Z, Z), K(0.2, Z, [-0.5, 0.3, 0.4]), K(0.95, Z, [0.5, 0, 0]), K(1.3, Z, Z)];
  const tracks = { gun: g, mag, lhand: lh, lgrip: lg, cam };
  if (!empty) {
    g.push(K(1.3, [0.004, -0.004, 0], [-1, 0, 2]), K(1.6, Z, Z));
    lh.push(K(1.12, [-0.03, -0.05, 0.04], [0, 0, 8]), K(1.35, Z, Z));
    lg.push(V(1.1, 0.4), V(1.35, 1));
    ev.push(EV(1.0, 'lpose', { pose: 'grip' }));
    return { name: 'reload', weapon: 'pistol', duration: 1.6, tracks, events: ev };
  }
  // empty: slide stays locked back until the thumb drops the slide release
  tracks.bolt = [V(0, 0.045), V(1.1, 0.045), V(1.14, 0, 'in')];
  g.push(T([0, 0.004, 0], [2, 0, 0], 1.08), T([0.002, -0.008, 0.006], [-4, 0, 3], 1.16), K(1.45, [0.004, -0.004, 0], [-1, 0, 2]), K(1.75, Z, Z));
  lh.push(K(1.12, [-0.03, -0.05, 0.04], [0, 0, 8]), K(1.35, Z, Z));
  lg.push(V(1.1, 0.4), V(1.35, 1));
  ev.push(EV(1.0, 'lpose', { pose: 'grip' }), S(1.12, 'slideRelease'), KICK(1.15, [0, 0.06, 0.06], [7, 0, -2], [0.7, 0, 0]));
  return { name: 'reloadEmpty', weapon: 'pistol', duration: 1.75, tracks, events: ev };
}

const pistolInspect = {
  name: 'inspect', weapon: 'pistol', duration: 3.6,
  tracks: {
    gun: [K(0, Z, Z), K(0.16, [0.006, -0.01, 0.006], [-3, -3, 3]), K(0.55, [-0.05, 0.04, -0.02], [6, 58, -10]), K(0.66, [-0.052, 0.042, -0.022], [7, 61, -11]),
      K(1.45, [-0.046, 0.046, -0.02], [4, 55, -6]), K(1.62, [-0.03, 0.05, -0.03], [10, 20, 0]),
      K(1.95, [-0.035, 0.05, -0.05], [8, -76, 12]), K(2.05, [-0.036, 0.051, -0.051], [7, -79, 14]),
      K(2.85, [-0.034, 0.049, -0.048], [6, -72, 10]), K(3.15, [0.0, 0.0, 0.0], [2, 4, -6]), K(3.3, [0.002, -0.004, 0], [-1, -1, 1.5]), K(3.6, Z, Z)],
    lhand: [K(0, Z, Z), K(0.25, [-0.05, -0.08, 0.06], [0, 0, 20]), K(0.5, [-0.08, -0.2, 0.12], [0, 0, 30]), K(2.9, [-0.08, -0.2, 0.12], [0, 0, 30]), K(3.25, Z, Z)],
    lgrip: [V(0, 1), V(0.25, 0.4), V(3.0, 0.4), V(3.25, 1)],
    bolt: [V(0.85, 0), V(1.0, 0.012, 'out'), V(1.15, 0.012), V(1.25, 0, 'in')],
    cam: [K(0, Z, Z), K(0.6, Z, [-0.4, 0.6, 0.4]), K(1.95, Z, [0.3, -0.3, -0.4]), K(3.6, Z, Z)],
  },
  events: [S(0.12, 'gear'), S(0.95, 'slideBack'), S(1.24, 'slideForward'), S(1.7, 'gear'), S(3.1, 'gear')],
};

// ====================================================================== SNIPER
const N_RH_BOLT = [0.046, 0.071, 0.034], N_RH_BOLT_R = [0, 0, 48];
const N_LH_MAG = [0.024, 0.006, 0.204], N_LH_MAG_R = [112, 0, -72];

function boltCycle(t0, scale = 1) {
  // right hand works the bolt: up, back, forward, down
  const t = (x) => +(t0 + x * scale).toFixed(3);
  const up = add(N_RH_BOLT, [-0.02, 0.051, 0]);
  return {
    rhand: [K(t(0), Z, Z), KA('charge', t(0.12), add(N_RH_BOLT, [0.02, -0.02, 0.02]), [0, 0, 30]), KA('charge', t(0.2), N_RH_BOLT, N_RH_BOLT_R),
      KA('charge', t(0.3), up, [0, 0, 70], 'out'), KA('charge', t(0.46), add(up, [0, 0, 0.09]), [0, 0, 70], 'out'), KA('charge', t(0.5), add(up, [0, 0, 0.09]), [0, 0, 70]),
      KA('charge', t(0.62), up, [0, 0, 70], 'in'), KA('charge', t(0.7), N_RH_BOLT, N_RH_BOLT_R, 'in'), KA('charge', t(0.76), N_RH_BOLT, N_RH_BOLT_R), K(t(0.98), Z, Z)],
    rgrip: [V(t(0), 1), V(t(0.1), 0.3), V(t(0.2), 0.85), V(t(0.76), 0.85), V(t(0.86), 0.3), V(t(0.98), 1)],
    boltRot: [V(t(0.2), 0), V(t(0.3), 60, 'out'), V(t(0.62), 60), V(t(0.7), 0, 'in')],
    bolt: [V(t(0.3), 0), V(t(0.46), 0.09, 'out'), V(t(0.5), 0.09), V(t(0.62), 0, 'in')],
    gun: [K(t(0), Z, Z), K(t(0.2), [-0.035, 0.015, -0.07], [6, 4, 24]), K(t(0.46), [-0.037, 0.019, -0.064], [7, 4, 26]), K(t(0.62), [-0.035, 0.013, -0.074], [5, 4, 23]),
      K(t(0.72), [-0.036, 0.017, -0.07], [7, 4, 25]), K(t(0.95), [0.002, -0.003, 0], [-1, 0, -1]), K(t(1.15), Z, Z)],
    events: [EV(t(0.1), 'rpose', { pose: 'grip' }), S(t(0.28), 'boltUp'), S(t(0.42), 'boltBack'), EV(t(0.44), 'shell'), S(t(0.6), 'boltForward'), S(t(0.69), 'boltDown'),
      KICK(t(0.62), [0, 0.02, -0.04], [-3, 0, 2]), KICK(t(0.7), [0, -0.02, 0], [2, 0, -2]), EV(t(0.9), 'rpose', { pose: 'trigger' })],
  };
}

const sniperFire = (() => {
  const c = boltCycle(0.32, 1);
  return {
    name: 'fire', weapon: 'sniper', duration: 1.5,
    tracks: { rhand: c.rhand, rgrip: c.rgrip, boltRot: c.boltRot, bolt: c.bolt, gun: [K(0, Z, Z), K(0.32, Z, Z), ...c.gun.slice(1)], trigger: [V(0, 1), V(0.12, 0)],
      cam: [K(0.3, Z, Z), K(0.62, Z, [-0.4, 0.3, 0.6]), K(1.1, Z, Z)] },
    events: c.events,
  };
})();

const sniperDraw = {
  name: 'draw', weapon: 'sniper', duration: 0.95,
  tracks: {
    gun: [K(0, [0.03, -0.26, 0.12], [-55, 30, 35]), K(0.4, [0.0, 0.012, -0.012], [5, -2, -4]), K(0.58, [0, -0.004, 0.003], [-1.5, 0.6, 1.2]), K(0.95, Z, Z)],
    lhand: [K(0, [-0.06, -0.16, 0.12], [0, 0, 30]), K(0.22, [-0.04, -0.08, 0.07], [0, 0, 15]), K(0.5, Z, Z)],
    lgrip: [V(0, 0.2), V(0.35, 0.3), V(0.5, 1)],
  },
  events: [S(0.02, 'draw'), KICK(0.41, [0, -0.06, 0.06], [-10, 0, 3]), S(0.5, 'gear')],
};

function sniperReload(empty) {
  const T = (dp, dr, t) => K(t, [-0.06 + dp[0], 0.1 + dp[1], 0.03 + dp[2]], [14 + dr[0], -6 + dr[1], -30 + dr[2]]);
  const g = [K(0, Z, Z), T([0.01, -0.02, 0], [-5, 2, 8], 0.22), T(Z, Z, 0.32), T([-0.003, -0.008, 0.003], [-2, -1, -3], 0.4), T([0, 0.004, 0], [1, 0, 1], 0.55),
    T([-0.004, 0.01, 0], [2, -1, -2], 1.1), T([0, -0.007, 0.002], [-2, 1, 2], 1.26), T([-0.002, 0.004, 0], [1, 0, 0], 1.36)];
  const lh = [K(0, Z, Z), K(0.12, [0, -0.05, 0.08], [40, 0, -30]), KA('mag', 0.28, N_LH_MAG, N_LH_MAG_R), KA('mag', 0.34, N_LH_MAG, N_LH_MAG_R),
    KA('mag', 0.46, add(N_LH_MAG, [0, -0.08, 0]), N_LH_MAG_R), KA('mag', 0.56, [-0.04, -0.3, 0.2], [70, 0, -50]), K(0.76, [-0.12, -0.42, 0.34], [60, 0, -40]),
    K(0.84, [-0.12, -0.42, 0.34], [60, 0, -40]), KA('mag', 1.04, add(N_LH_MAG, [0, -0.1, 0]), N_LH_MAG_R), KA('mag', 1.18, add(N_LH_MAG, [0, -0.025, 0]), N_LH_MAG_R), KA('mag', 1.26, N_LH_MAG, N_LH_MAG_R)];
  const lg = [V(0, 1), V(0.14, 0.25), V(0.28, 1), V(0.64, 1), V(0.7, 0.3), V(0.82, 1)];
  const mag = [K(0, Z, Z), K(0.34, Z, Z), K(1.18, [0, -0.025, 0], Z), K(1.26, Z, Z)];
  const ev = [S(0.05, 'gear'), EV(0.3, 'lpose', { pose: 'mag' }), S(0.33, 'magRelease'), EV(0.35, 'magToHand'), S(0.42, 'magOut'),
    EV(0.55, 'dropMag', { v: [-1.0, -1.5, 0.5] }), EV(0.82, 'newMag'), S(0.84, 'pouch'), EV(1.18, 'magToGun'), S(1.22, 'magIn'),
    KICK(1.26, [0, 0.1, 0.02], [8, 0, -4], [1.0, 0, 0]), EV(1.27, 'ammo')];
  const cam = [K(0, Z, Z), K(0.32, Z, [-0.8, 0.6, 0.6]), K(1.3, Z, [0.6, 0, 0]), K(1.9, Z, Z)];
  const tracks = { gun: g, lhand: lh, lgrip: lg, mag, cam };
  lh.push(K(1.42, [0.0, -0.04, 0.14], [60, 0, -36]), K(1.66, [0, 0.008, -0.004], [-6, 0, 4]), K(1.9, Z, Z));
  lg.push(V(1.44, 0.4), V(1.66, 1));
  ev.push(EV(1.34, 'lpose', { pose: 'grip' }));
  if (!empty) {
    g.push(K(1.65, [-0.006, 0.006, 0.004], [-1, -2, -4]), K(1.9, [0, -0.002, 0], [0.6, 0.2, 0.8]), K(2.2, Z, Z));
    return { name: 'reload', weapon: 'sniper', duration: 2.2, tracks, events: ev };
  }
  g.push(K(1.6, [-0.01, 0.01, 0.0], [0, -1, -2]));
  const c = boltCycle(1.6, 1);
  Object.assign(tracks, { rhand: c.rhand, rgrip: c.rgrip, boltRot: c.boltRot, bolt: c.bolt });
  g.push(...c.gun.slice(1));
  ev.push(...c.events.filter((e) => e.type !== 'shell'));
  return { name: 'reloadEmpty', weapon: 'sniper', duration: 2.85, tracks, events: ev };
}

const sniperInspect = {
  name: 'inspect', weapon: 'sniper', duration: 4.4,
  tracks: {
    gun: [K(0, Z, Z), K(0.2, [0.01, -0.012, 0.01], [-3, -4, 4]), K(0.65, [-0.06, 0.05, -0.06], [4, 48, -10]), K(0.78, [-0.062, 0.052, -0.062], [5, 51, -11]),
      K(1.7, [-0.056, 0.056, -0.055], [2, 46, -6]), K(2.25, [-0.05, 0.07, -0.04], [-6, 36, 58]), K(2.36, [-0.052, 0.072, -0.042], [-7, 38, 62]),
      K(3.2, [-0.048, 0.066, -0.038], [-4, 34, 55]), K(3.68, [-0.01, 0.006, 0.0], [2, -3, -5]), K(3.88, [0.004, -0.006, 0.0], [-1.2, 0.8, 1.6]), K(4.4, Z, Z)],
    lhand: [K(0, Z, Z), K(1.0, [0, 0, -0.03], [0, 0, -4]), K(1.7, Z, Z), K(2.7, [0, 0, 0.02], [0, 0, 4]), K(3.3, Z, Z)],
    cam: [K(0, Z, Z), K(0.7, Z, [-0.6, 0.8, 0.5]), K(2.3, Z, [0.4, -0.4, -0.6]), K(4.4, Z, Z)],
  },
  events: [S(0.15, 'gear'), S(2.0, 'gear'), S(3.5, 'gear')],
};

// ====================================================================== KNIFE
const LH_AWAY = [0, 0, 0];
const knifeDraw = {
  name: 'draw', weapon: 'knife', duration: 0.62,
  tracks: {
    gun: [K(0, [0.03, -0.22, 0.06], [-40, 20, -210]), K(0.2, [0.01, -0.06, 0.0], [-12, 6, -60], 'out'), K(0.34, [0, 0.01, -0.01], [4, -2, 6]), K(0.46, [0, -0.003, 0.002], [-1, 0.5, -1.5]), K(0.62, Z, Z)],
    lhand: [K(0, LH_AWAY, Z)],
  },
  events: [S(0.04, 'knifeDraw'), KICK(0.34, [0, -0.04, 0.03], [-6, 0, 3])],
};
const knifeSlash1 = {
  name: 'slash1', weapon: 'knife', duration: 0.55,
  tracks: {
    gun: [K(0, Z, Z), K(0.08, [0.06, 0.11, 0.05], [22, 30, -55]), K(0.19, [-0.2, 0.02, -0.12], [-8, -50, 75], 'out'), K(0.27, [-0.25, -0.03, -0.1], [-12, -58, 80]), K(0.55, Z, Z)],
    lhand: [K(0, LH_AWAY, Z)],
    cam: [K(0, Z, Z), K(0.12, Z, [0.8, -1.5, -1.2]), K(0.24, Z, [-0.6, 1.8, 1.5]), K(0.55, Z, Z)],
  },
  events: [S(0.1, 'swing'), EV(0.17, 'hit')],
};
const knifeSlash2 = {
  name: 'slash2', weapon: 'knife', duration: 0.55,
  tracks: {
    gun: [K(0, Z, Z), K(0.08, [-0.14, 0.1, 0.03], [14, -30, 70]), K(0.19, [0.06, -0.02, -0.12], [-12, 40, -70], 'out'), K(0.27, [0.09, -0.06, -0.1], [-14, 44, -74]), K(0.55, Z, Z)],
    lhand: [K(0, LH_AWAY, Z)],
    cam: [K(0, Z, Z), K(0.12, Z, [0.8, 1.5, 1.2]), K(0.24, Z, [-0.6, -1.8, -1.5]), K(0.55, Z, Z)],
  },
  events: [S(0.1, 'swing'), EV(0.17, 'hit')],
};
const knifeStab = {
  name: 'stab', weapon: 'knife', duration: 1.0,
  tracks: {
    gun: [K(0, Z, Z), K(0.28, [-0.04, 0.03, 0.12], [30, 10, -80]), K(0.36, [-0.05, 0.035, 0.13], [32, 10, -82]), K(0.46, [-0.09, 0.02, -0.22], [-6, 8, -90], 'out'),
      K(0.56, [-0.09, 0.02, -0.2], [-4, 8, -88]), K(1.0, Z, Z)],
    lhand: [K(0, LH_AWAY, Z)],
    cam: [K(0, Z, Z), K(0.34, Z, [1.2, 0, 0]), K(0.48, Z, [-1.8, 0, 0]), K(1.0, Z, Z)],
  },
  events: [S(0.38, 'swing'), EV(0.44, 'hit')],
};
const knifeInspect = {
  name: 'inspect', weapon: 'knife', duration: 3.4,
  tracks: {
    gun: [K(0, Z, Z), K(0.18, [0.01, -0.01, 0.01], [-4, 0, 6]),
      K(0.6, [-0.06, 0.05, -0.04], [10, 55, -15]), K(0.7, [-0.062, 0.052, -0.042], [11, 57, -16]), K(1.4, [-0.058, 0.055, -0.04], [8, 52, -12]),
      K(1.75, [-0.05, 0.08, -0.04], [8, 52, 345], 'inout'), // full twirl
      K(1.85, [-0.052, 0.078, -0.042], [9, 54, 350]), K(2.6, [-0.05, 0.06, -0.04], [6, 30, 360 + 25]),
      K(3.0, [0.0, 0.0, 0.0], [2, -2, 360 - 4]), K(3.15, [0.002, -0.004, 0], [-1, 0.5, 360 + 1]), K(3.4, Z, [0, 0, 360])],
    lhand: [K(0, LH_AWAY, Z)],
    cam: [K(0, Z, Z), K(0.6, Z, [-0.5, 0.6, 0.4]), K(1.8, Z, [0.3, -0.3, -0.5]), K(3.4, Z, Z)],
  },
  events: [S(0.12, 'gear'), S(1.45, 'knifeFlip'), S(2.9, 'gear')],
};
// knife rest has the left hand away from the weapon
const knifeIdle = { name: 'idle', weapon: 'knife', duration: 1, tracks: { lhand: [K(0, LH_AWAY, Z)] }, events: [] };

// ====================================================================== SHOTGUN (pump)
// left hand rides the pump (fore socket). Port = loading port under the receiver.
const SG_PORT = [0.032, -0.012, 0.36], SG_PORT_R = [-28, 0, -52];
const SG_BELT = [-0.06, -0.3, 0.26], SG_BELT_R = [20, 0, -40];
function pumpCycle(t0) {
  const t = (x) => +(t0 + x).toFixed(3);
  return {
    bolt: [V(t(0), 0), V(t(0.14), 0.088, 'out'), V(t(0.19), 0.088), V(t(0.33), 0, 'in')],
    lhand: [K(t(0), Z, Z), K(t(0.14), [0, -0.004, 0.088], [0, 0, -3], 'out'), K(t(0.19), [0, -0.003, 0.088], [0, 0, -3]), K(t(0.33), Z, Z, 'in')],
    gun: [K(t(0), Z, Z), K(t(0.14), [0.002, -0.008, 0.012], [2, 1, 4]), K(t(0.33), [0, 0.004, -0.006], [-1.5, 0, -2]), K(t(0.55), Z, Z)],
    events: [S(t(0.02), 'pumpBack'), EV(t(0.12), 'shell'), S(t(0.22), 'pumpForward'), KICK(t(0.15), [0, -0.02, 0.04], [-3, 0, 2]), KICK(t(0.33), [0, 0.012, -0.03], [1.5, 0, -1])],
  };
}
const shotgunFire = (() => {
  const c = pumpCycle(0.22);
  return {
    name: 'fire', weapon: 'shotgun', duration: 0.85,
    tracks: { trigger: [V(0, 1), V(0.1, 0)], bolt: c.bolt, lhand: c.lhand, gun: [K(0, Z, Z), ...c.gun], cam: [K(0.2, Z, Z), K(0.38, Z, [-0.4, 0.2, 0.5]), K(0.7, Z, Z)] },
    events: c.events,
  };
})();
const shotgunDraw = {
  name: 'draw', weapon: 'shotgun', duration: 0.85,
  tracks: {
    gun: [K(0, [0.03, -0.25, 0.1], [-50, 25, 40]), K(0.34, [0.0, 0.012, -0.01], [5, -2, -4]), K(0.52, [0, -0.004, 0.003], [-1.5, 0.6, 1.2]), K(0.85, Z, Z)],
    lhand: [K(0, [-0.06, -0.16, 0.12], [0, 0, 30]), K(0.2, [-0.04, -0.08, 0.07], [0, 0, 15]), K(0.44, Z, Z)],
    lgrip: [V(0, 0.2), V(0.3, 0.3), V(0.44, 1)],
  },
  events: [S(0.02, 'draw'), KICK(0.35, [0, -0.06, 0.06], [-10, 0, 3]), S(0.44, 'gear')],
};
// reload stance: rolled to the right so the loading port faces the left hand
const SG_T = (t, dp = Z, dr = Z, e) => K(t, [-0.03 + dp[0], 0.07 + dp[1], 0.03 + dp[2]], [12 + dr[0], -10 + dr[1], 32 + dr[2]], e);
const shotgunReloadStart = {
  name: 'reloadStart', weapon: 'shotgun', duration: 0.42,
  tracks: {
    gun: [K(0, Z, Z), SG_T(0.3, [0.006, -0.012, 0], [-4, 2, -6]), SG_T(0.42)],
    lhand: [K(0, Z, Z), K(0.16, [-0.01, -0.06, 0.1], [10, 0, -20]), K(0.42, SG_BELT, SG_BELT_R)],
    lgrip: [V(0, 1), V(0.14, 0.3), V(0.42, 0.6)],
    cam: [K(0, Z, Z), K(0.3, Z, [-0.6, 0.4, 0.5])],
  },
  events: [S(0.04, 'gear')],
};
const shotgunReloadInsert = {
  name: 'reloadInsert', weapon: 'shotgun', duration: 0.6,
  tracks: {
    gun: [SG_T(0), SG_T(0.3, [0, 0.003, 0], [1, 0, 1]), SG_T(0.36, [0.002, -0.006, 0.004], [-2, 0, -2]), SG_T(0.46, [0, 0.002, 0], [0.5, 0, 0.5]), SG_T(0.6)],
    lhand: [K(0, SG_BELT, SG_BELT_R), K(0.06, add(SG_BELT, [0.01, 0.01, 0]), SG_BELT_R), K(0.24, add(SG_PORT, [0.0, -0.06, -0.01]), SG_PORT_R, 'out'),
      K(0.3, add(SG_PORT, [0.0, -0.012, 0.0]), SG_PORT_R), K(0.36, SG_PORT, SG_PORT_R, 'in'), K(0.42, add(SG_PORT, [0.0, -0.02, 0.005]), SG_PORT_R), K(0.6, SG_BELT, SG_BELT_R)],
    lgrip: [V(0, 0.6), V(0.08, 0.95), V(0.3, 0.9), V(0.38, 0.5), V(0.6, 0.6)],
  },
  events: [EV(0.07, 'lpose', { pose: 'mag' }), EV(0.08, 'shellShow'), S(0.32, 'shellInsert'), EV(0.36, 'shellHide'), EV(0.37, 'ammo1'), KICK(0.36, [0, 0.03, -0.01], [2, 0, -1])],
};
const shotgunReloadEnd = (pump) => {
  const tr = {
    gun: [SG_T(0), K(0.34, [0.004, -0.006, 0.004], [-1, -1, -2]), K(0.55, Z, Z)],
    lhand: [K(0, SG_BELT, SG_BELT_R), K(0.22, [-0.01, -0.05, 0.08], [10, 0, -16]), K(0.38, Z, Z)],
    lgrip: [V(0, 0.6), V(0.24, 0.4), V(0.38, 1)],
    cam: [K(0, Z, [-0.6, 0.4, 0.5]), K(0.5, Z, Z)],
  };
  const ev = [EV(0.02, 'lpose', { pose: 'grip' }), S(0.36, 'gear')];
  if (!pump) return { name: 'reloadEnd', weapon: 'shotgun', duration: 0.55, tracks: tr, events: ev };
  const c = pumpCycle(0.5);
  tr.bolt = c.bolt; tr.lhand.push(...c.lhand.slice(1)); tr.gun = [...tr.gun.slice(0, 2), K(0.5, Z, Z), ...c.gun.slice(1)];
  return { name: 'reloadEndPump', weapon: 'shotgun', duration: 1.1, tracks: tr, events: [...ev, ...c.events.filter((e) => e.type !== 'shell')] };
};
const shotgunInspect = {
  name: 'inspect', weapon: 'shotgun', duration: 4.2,
  tracks: {
    gun: [K(0, Z, Z), K(0.18, [0.01, -0.012, 0.01], [-3, -4, 4]), K(0.62, [-0.07, 0.05, -0.05], [4, 50, -12]), K(0.75, [-0.072, 0.052, -0.052], [5, 53, -13]),
      K(1.6, [-0.066, 0.056, -0.046], [2, 48, -8]), K(2.1, [-0.056, 0.068, -0.03], [-6, 38, 58]), K(2.22, [-0.058, 0.07, -0.032], [-7, 40, 62]),
      K(3.0, [-0.054, 0.064, -0.028], [-4, 36, 55]), K(3.45, [-0.01, 0.006, 0.0], [2, -3, -5]), K(3.65, [0.004, -0.006, 0.0], [-1.2, 0.8, 1.6]), K(4.2, Z, Z)],
    lgrip: [V(0, 1), V(1.0, 0.75), V(1.25, 1)],
    bolt: [V(2.4, 0), V(2.55, 0.03, 'out'), V(2.75, 0.03), V(2.9, 0, 'in')],
    lhand: [K(2.4, Z, Z), K(2.55, [0, 0, 0.03], Z, 'out'), K(2.75, [0, 0, 0.03], Z), K(2.9, Z, Z, 'in')],
    cam: [K(0, Z, Z), K(0.65, Z, [-0.6, 0.8, 0.5]), K(2.15, Z, [0.4, -0.4, -0.6]), K(4.2, Z, Z)],
  },
  events: [S(0.15, 'gear'), S(2.45, 'pumpBack'), S(2.8, 'pumpForward'), S(3.4, 'gear')],
};

// ====================================================================== export
// hip pose each clip set was authored against: gun keys far from rest keep
// their absolute stance when a weapon uses a different hip pose
export const CLIP_HIP = {
  rifle: { p: [0.145, -0.21, -0.33], r: [11, 11, -4] },
  sniper: { p: [0.15, -0.205, -0.33], r: [10, 10, -4] },
  pistol: { p: [0.08, -0.125, -0.34], r: [6, 6, -2] },
};
// weapons without their own clip set reuse (and retarget) another gun's clips
export const CLIP_SOURCE = { m4: 'rifle', smg: 'rifle', deagle: 'pistol', m9: 'knife', karambit: 'knife', butterfly: 'knife' };
export const DEFAULT_CLIPS = {
  rifle: { draw: rifleDraw, fire: rifleFire, reload: rifleReload(false), reloadEmpty: rifleReload(true), inspect: rifleInspect },
  pistol: { draw: pistolDraw, fire: pistolFire, reload: pistolReload(false), reloadEmpty: pistolReload(true), inspect: pistolInspect },
  sniper: { draw: sniperDraw, fire: sniperFire, reload: sniperReload(false), reloadEmpty: sniperReload(true), inspect: sniperInspect },
  knife: { draw: knifeDraw, slash1: knifeSlash1, slash2: knifeSlash2, stab: knifeStab, inspect: knifeInspect, idle: knifeIdle },
  shotgun: { draw: shotgunDraw, fire: shotgunFire, reloadStart: shotgunReloadStart, reloadInsert: shotgunReloadInsert, reloadEnd: shotgunReloadEnd(false), reloadEndPump: shotgunReloadEnd(true), inspect: shotgunInspect },
};

// Weapon stats + viewmodel placement. Names are original (not real brands).

// CS-style spray pattern (degrees added per shot: [pitch up, yaw right])
const RIFLE_PATTERN = [
  [0, 0], [1.1, 0.05], [1.3, -0.1], [1.4, 0.15], [1.4, 0.1], [1.2, -0.3], [1.0, -0.5], [0.8, -0.6], [0.6, -0.5], [0.4, -0.2],
  [0.3, 0.4], [0.3, 0.7], [0.2, 0.8], [0.2, 0.6], [0.2, 0.3], [0.1, -0.4], [0.1, -0.7], [0.1, -0.8], [0.1, -0.5], [0.1, 0.3],
  [0.1, 0.6], [0.1, 0.7], [0.1, 0.4], [0.1, -0.2], [0.1, -0.6], [0.1, -0.6], [0.1, -0.2], [0.1, 0.4], [0.1, 0.6], [0.1, 0.4],
];

export const WEAPONS = {
  rifle: {
    id: 'rifle', name: 'KR-47', slot: 1, kind: 'rifle', auto: true,
    dmg: 35, head: 4.0, chest: 1.0, stomach: 1.15, legs: 0.75, range: 140, falloff: 0.98,
    delay: 0.1, mag: 30, reserve: 90,
    spread: 0.0025, moveSpread: 0.075, jumpSpread: 0.22, crouchMul: 0.7, recoverySpread: 0.009,
    pattern: RIFLE_PATTERN, patternScale: 0.9, recoilReset: 0.38, viewKick: 0.55,
    speed: 5.3, tracerEvery: 3, sound: 'rifle', shell: 'rifle', drawTime: 0.85,
    vm: { hip: { p: [0.145, -0.21, -0.33], r: [11, 11, -4] }, shoulderR: [0.2, -0.3, 0.12], shoulderL: [-0.24, -0.44, -0.02], poleR: [0.7, -0.8, 0.25], poleL: [-1, -0.5, 0.2], rPose: 'trigger', lPose: 'grip', kickBack: 0.032, kickUp: 4.2 },
  },
  sniper: {
    id: 'sniper', name: 'R-338 Raven', slot: 1, kind: 'sniper', auto: false, scope: [24, 11],
    dmg: 118, head: 2.5, chest: 1.0, stomach: 1.0, legs: 0.85, range: 300, falloff: 1.0,
    delay: 1.35, mag: 5, reserve: 20,
    spread: 0.0004, unscopedSpread: 0.07, moveSpread: 0.16, jumpSpread: 0.3, crouchMul: 0.8, recoverySpread: 0.0,
    pattern: null, viewKick: 3.2,
    speed: 4.8, tracerEvery: 1, sound: 'sniper', shell: 'sniper', boltAction: true, drawTime: 1.0,
    vm: { hip: { p: [0.15, -0.205, -0.33], r: [10, 10, -4] }, shoulderR: [0.2, -0.3, 0.12], shoulderL: [-0.24, -0.44, -0.02], poleR: [0.7, -0.8, 0.25], poleL: [-1, -0.5, 0.2], rPose: 'trigger', lPose: 'grip', kickBack: 0.06, kickUp: 9 },
  },
  pistol: {
    id: 'pistol', name: 'Vanta-9', slot: 2, kind: 'pistol', auto: false,
    dmg: 27, head: 4.0, chest: 1.0, stomach: 1.1, legs: 0.75, range: 90, falloff: 0.94,
    delay: 0.15, mag: 15, reserve: 60,
    spread: 0.004, moveSpread: 0.035, jumpSpread: 0.14, crouchMul: 0.75, recoverySpread: 0.02,
    pattern: null, viewKick: 1.25,
    speed: 5.8, tracerEvery: 1, sound: 'pistol', shell: 'pistol', drawTime: 0.6, slideLock: 0.045,
    vm: { hip: { p: [0.08, -0.125, -0.34], r: [6, 6, -2] }, shoulderR: [0.2, -0.32, 0.12], shoulderL: [-0.2, -0.34, 0.08], poleR: [0.6, -0.9, 0.2], poleL: [-0.7, -0.9, 0.1], rPose: 'trigger', lPose: 'grip', kickBack: 0.045, kickUp: 7 },
  },
  knife: {
    id: 'knife', name: 'Talon', slot: 3, kind: 'knife', melee: true,
    dmg: 40, dmgHeavy: 65, backstab: 180, range: 2.0, delay: 0.42, heavyDelay: 1.0,
    speed: 6.1, sound: 'knife', drawTime: 0.6,
    vm: { hip: { p: [0.14, -0.17, -0.34], r: [8, -6, -10] }, shoulderR: [0.2, -0.32, 0.12], shoulderL: [-0.24, -0.44, 0.0], poleR: [0.7, -0.8, 0.25], poleL: [-0.8, -0.8, 0.1], rPose: 'knife', lPose: 'open', lhandFree: true, kickBack: 0, kickUp: 0 },
  },
};

export const SLOT_ORDER = ['primary', 'pistol', 'knife'];
export const PRIMARIES = ['rifle', 'sniper'];

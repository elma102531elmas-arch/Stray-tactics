// Weapon stats + viewmodel placement. Names are original (not real brands).
// id == model/animation kind; cls = behaviour class (rifle, smg, shotgun,
// sniper, pistol, knife); slot = primary | pistol | knife.

// CS-style spray patterns (degrees added per shot: [pitch up, yaw right])
const RIFLE_PATTERN = [
  [0, 0], [1.1, 0.05], [1.3, -0.1], [1.4, 0.15], [1.4, 0.1], [1.2, -0.3], [1.0, -0.5], [0.8, -0.6], [0.6, -0.5], [0.4, -0.2],
  [0.3, 0.4], [0.3, 0.7], [0.2, 0.8], [0.2, 0.6], [0.2, 0.3], [0.1, -0.4], [0.1, -0.7], [0.1, -0.8], [0.1, -0.5], [0.1, 0.3],
  [0.1, 0.6], [0.1, 0.7], [0.1, 0.4], [0.1, -0.2], [0.1, -0.6], [0.1, -0.6], [0.1, -0.2], [0.1, 0.4], [0.1, 0.6], [0.1, 0.4],
];
const M4_PATTERN = RIFLE_PATTERN.map(([p, y], i) => [+(p * 0.82).toFixed(3), +(y * (i > 10 ? 0.7 : 0.5)).toFixed(3)]);
const SMG_PATTERN = RIFLE_PATTERN.map(([p, y]) => [+(p * 0.55).toFixed(3), +(y * 0.6).toFixed(3)]);

// shared hand/shoulder setup for long guns
const LONG = { shoulderR: [0.2, -0.3, 0.12], shoulderL: [-0.24, -0.44, -0.02], poleR: [0.7, -0.8, 0.25], poleL: [-1, -0.5, 0.2], rPose: 'trigger', lPose: 'grip' };
const SHORT = { shoulderR: [0.2, -0.32, 0.12], shoulderL: [-0.2, -0.34, 0.08], poleR: [0.6, -0.9, 0.2], poleL: [-0.7, -0.9, 0.1], rPose: 'trigger', lPose: 'grip' };
const BLADE = { shoulderR: [0.2, -0.32, 0.12], shoulderL: [-0.24, -0.44, 0.0], poleR: [0.7, -0.8, 0.25], poleL: [-0.8, -0.8, 0.1], rPose: 'knife', lPose: 'open', lhandFree: true, kickBack: 0, kickUp: 0 };

const knife = (id, name, price, vm = {}) => ({
  id, name, slot: 'knife', cls: 'knife', kind: id, melee: true, price,
  dmg: 40, dmgHeavy: 65, backstab: 180, range: 2.0, delay: 0.42, heavyDelay: 1.0,
  speed: 6.1, sound: 'knife', drawTime: 0.6,
  vm: { hip: { p: [0.13, -0.14, -0.33], r: [10, 10, -10] }, ...BLADE, ...vm },
});

export const WEAPONS = {
  rifle: {
    id: 'rifle', name: 'KR-47', slot: 'primary', cls: 'rifle', kind: 'rifle', auto: true,
    dmg: 35, head: 4.0, chest: 1.0, stomach: 1.15, legs: 0.75, range: 140, falloff: 0.98,
    delay: 0.1, mag: 30, reserve: 90,
    spread: 0.0025, moveSpread: 0.075, jumpSpread: 0.22, crouchMul: 0.7, recoverySpread: 0.009,
    pattern: RIFLE_PATTERN, patternScale: 0.9, recoilReset: 0.38, viewKick: 0.55,
    speed: 5.3, tracerEvery: 3, sound: 'ak', shell: 'rifle', drawTime: 0.85,
    vm: { hip: { p: [0.14, -0.16, -0.3], r: [0, 3, -2] }, ...LONG, kickBack: 0.032, kickUp: 4.2 },
  },
  m4: {
    id: 'm4', name: 'MR-4 Ranger', slot: 'primary', cls: 'rifle', kind: 'm4', auto: true,
    dmg: 31, head: 4.0, chest: 1.0, stomach: 1.15, legs: 0.75, range: 140, falloff: 0.97,
    delay: 0.09, mag: 30, reserve: 90,
    spread: 0.0022, moveSpread: 0.07, jumpSpread: 0.2, crouchMul: 0.7, recoverySpread: 0.008,
    pattern: M4_PATTERN, patternScale: 0.9, recoilReset: 0.35, viewKick: 0.5,
    speed: 5.4, tracerEvery: 3, sound: 'm4', shell: 'rifle', drawTime: 0.8,
    vm: { hip: { p: [0.14, -0.155, -0.3], r: [0, 3, -2] }, ...LONG, kickBack: 0.028, kickUp: 3.6 },
  },
  smg: {
    id: 'smg', name: 'GR-3 Grease', slot: 'primary', cls: 'smg', kind: 'smg', auto: true,
    dmg: 25, head: 3.6, chest: 1.0, stomach: 1.15, legs: 0.8, range: 80, falloff: 0.85,
    delay: 0.075, mag: 30, reserve: 120,
    spread: 0.004, moveSpread: 0.028, jumpSpread: 0.15, crouchMul: 0.8, recoverySpread: 0.006,
    pattern: SMG_PATTERN, patternScale: 0.9, recoilReset: 0.3, viewKick: 0.42,
    speed: 5.9, tracerEvery: 3, sound: 'smg', shell: 'pistol', drawTime: 0.7,
    vm: { hip: { p: [0.13, -0.15, -0.3], r: [0, 3, -2] }, ...LONG, kickBack: 0.024, kickUp: 2.8 },
  },
  shotgun: {
    id: 'shotgun', name: 'SG-12 Breacher', slot: 'primary', cls: 'shotgun', kind: 'shotgun', auto: false,
    pellets: 9, dmg: 19, head: 2.0, chest: 1.0, stomach: 1.0, legs: 0.8, range: 45, falloff: 0.55,
    delay: 0.9, mag: 7, reserve: 28, shellReload: true,
    spread: 0.055, moveSpread: 0.07, jumpSpread: 0.12, crouchMul: 0.9, recoverySpread: 0.0,
    pattern: null, viewKick: 3.2,
    speed: 5.2, tracerEvery: 1, sound: 'shotgun', shell: 'shotgun', drawTime: 0.85, pump: true,
    vm: { hip: { p: [0.135, -0.165, -0.3], r: [0, 3, -2] }, ...LONG, kickBack: 0.07, kickUp: 9 },
  },
  sniper: {
    id: 'sniper', name: 'R-338 Raven', slot: 'primary', cls: 'sniper', kind: 'sniper', auto: false, scope: [24, 11],
    dmg: 118, head: 2.5, chest: 1.0, stomach: 1.0, legs: 0.85, range: 300, falloff: 1.0,
    delay: 1.35, mag: 5, reserve: 20,
    spread: 0.0004, unscopedSpread: 0.07, moveSpread: 0.16, jumpSpread: 0.3, crouchMul: 0.8, recoverySpread: 0.0,
    pattern: null, viewKick: 3.2,
    speed: 4.8, tracerEvery: 1, sound: 'sniper', shell: 'sniper', boltAction: true, drawTime: 1.0,
    vm: { hip: { p: [0.14, -0.16, -0.29], r: [0, 3, -2] }, ...LONG, kickBack: 0.06, kickUp: 9 },
  },
  pistol: {
    id: 'pistol', name: 'PM-9', slot: 'pistol', cls: 'pistol', kind: 'pistol', auto: false,
    dmg: 27, head: 4.0, chest: 1.0, stomach: 1.1, legs: 0.75, range: 90, falloff: 0.94,
    delay: 0.15, mag: 12, reserve: 48,
    spread: 0.004, moveSpread: 0.035, jumpSpread: 0.14, crouchMul: 0.75, recoverySpread: 0.02,
    pattern: null, viewKick: 1.25,
    speed: 5.8, tracerEvery: 1, sound: 'pistol', shell: 'pistol', drawTime: 0.6, slideLock: 0.045,
    vm: { hip: { p: [0.11, -0.13, -0.3], r: [-2, 15, -6] }, ...SHORT, kickBack: 0.045, kickUp: 7 },
  },
  deagle: {
    id: 'deagle', name: 'D-50 Eagle', slot: 'pistol', cls: 'pistol', kind: 'deagle', auto: false,
    dmg: 54, head: 3.9, chest: 1.0, stomach: 1.1, legs: 0.75, range: 110, falloff: 0.92,
    delay: 0.36, mag: 7, reserve: 35,
    spread: 0.0035, moveSpread: 0.08, jumpSpread: 0.2, crouchMul: 0.75, recoverySpread: 0.03,
    pattern: null, viewKick: 3.4,
    speed: 5.6, tracerEvery: 1, sound: 'deagle', shell: 'pistol', drawTime: 0.7, slideLock: 0.05,
    vm: { hip: { p: [0.11, -0.13, -0.31], r: [-2, 15, -6] }, ...SHORT, kickBack: 0.07, kickUp: 13 },
  },
  knife: knife('knife', 'Talon', 0),
  m9: knife('m9', 'M9 Bayonet', 1),
  karambit: knife('karambit', 'Karambit', 1, { hip: { p: [0.13, -0.11, -0.3], r: [45, -10, -45] }, rPose: 'karambit' }),
  butterfly: knife('butterfly', 'Butterfly', 1),
};

export const SLOT_ORDER = ['primary', 'pistol', 'knife'];
export const PRIMARIES = ['rifle', 'm4', 'smg', 'shotgun', 'sniper'];
export const SECONDARIES = ['pistol', 'deagle'];
export const KNIVES = ['knife', 'm9', 'karambit', 'butterfly'];
export const clsOf = (id) => (WEAPONS[id] ? WEAPONS[id].cls : id);

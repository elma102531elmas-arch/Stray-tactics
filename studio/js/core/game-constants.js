// Values transcribed by hand from the original game's source so the Studio can show them as reference
// archetypes. Every entry cites where it came from; nothing here is invented. The game itself is not modified.

export const GAME_SOURCE_NOTE = 'saint-marrow/js (original runtime, read-only)';

export const HOLLOW_REFERENCE = {
  name: 'Hollow (imported reference)',
  imported: true,
  source: 'saint-marrow/js/entities/enemy.js + creatures.js',
  health: 100,                       // enemy.js: this.maxHp = 100 * diff.enemyHp
  walkSpeed: 1.05, runSpeed: 3.4, crawlSpeed: 2.7,   // enemy.js:106-107
  vision: { range: 15, halfAngleDeg: 71.6, chaseHalfAngleDeg: 180, closeAlwaysSeen: 2.2 },  // enemy.js perceive(): range 15, fov 1.25 rad, 2.2 m "close"
  hearing: { footstepWalk: 4.5, footstepRun: 11, footstepCrouch: 1.5, melee: 6, door: 6, pistol: 30, rifle: 42 },  // player.js noise radii, game.js makeNoise
  attack: { range: 1.25, hitReach: 1.7, damage: 15, windup: 0.45, duration: 0.85, cooldown: 1.1, bleedChance: 0.45, fractureChance: 0.03 },
  wakeRadius: 3.2,
  weakSpots: [{ part: 'head', multiplier: 2.6 }, { part: 'body', multiplier: 1 }, { part: 'arm', multiplier: 0.6 }, { part: 'leg', multiplier: 0.75 }],  // enemy.js damage()
  states: ['dormant', 'rise', 'idle', 'wander', 'investigate', 'search', 'chase', 'attack', 'stagger', 'dead'],
};

export const WARDEN_REFERENCE = {
  name: 'Warden (imported reference)',
  imported: true,
  source: 'saint-marrow/js/entities/enemy.js + game.js directWarden()',
  health: null, invulnerable: true,           // bullets only stagger (enemy.js damage())
  walkSpeed: 1.45, runSpeed: 4.25,
  vision: { range: 22, halfAngleDeg: 71.6, chaseHalfAngleDeg: 180, closeAlwaysSeen: 2.2 },
  hearing: { footstepWalk: 4.5, footstepRun: 11, footstepCrouch: 1.5, melee: 6, door: 6, pistol: 30, rifle: 42 },
  attack: { range: 1.45, hitReach: 1.9, damage: 48, windup: 0.35, duration: 1.4, cooldown: 2, bleedChance: 1, fractureChance: 0.45 },
  staggerSeconds: { normal: 0.9, heavy: 2.6, max: 3.2 },
  director: 'Appears on a timer away from players, wanders toward them, leaves after a presence window (chapter-specific gap/presence in chapters.js `warden:`).',
  states: ['absent', 'wander', 'investigate', 'search', 'chase', 'grab', 'bash', 'stagger', 'leave'],
};

export const PLAYER_REFERENCE = {
  eyeHeight: 1.62, crouchEyeHeight: 1.05, radius: 0.3,                // player.js eyeHeight / game collide(…, 0.3)
  walkSpeed: 2.45, crouchSpeed: 1.25, sprintSpeed: 4.8,                // player.js update()
  interactReach: 2.4, interactSlack: 0.12,                              // game.js updateInteraction(…, 2.4) + level.js findInteractable
  stepHeight: 'n/a (flat 2.5D grid world)',
};

/** Game door lock strings (door.locked) as handled by game.js interact(). */
export const LOCK_KINDS = ['', 'chain', 'jammed', 'power', 'script', 'code:<digits>', 'item:<itemId>'];

export const CLUTTER_BY_THEME = {
  corridor: ['wheelchair', 'chair', 'sign', 'bag', 'box', 'papers', 'plasticchair', 'crutches', 'trashcan'],
  ward: ['chair', 'papers', 'nightstand', 'crutches', 'box', 'bloodbucket', 'suitcase'],
  office: ['chair', 'papers', 'box', 'drawers', 'suitcase'],
  surgery: ['stool2', 'bloodbucket', 'papers', 'gurney'],
  basement: ['barrel', 'crate', 'milcrate', 'propane', 'box', 'tyre', 'handtruck'],
  storage: ['crate', 'box', 'barrel', 'toolchest', 'propane', 'handtruck'],
  chapel: ['bench', 'papers', 'chair'],
  hut: ['box', 'crate', 'propane', 'tyre'],
  morgue: ['gurney', 'stool2', 'bloodbucket'],
  outdoor: ['tyre', 'barrel', 'log', 'bag'],
};

/** Dimensions of props the game builds procedurally (props.js) — used for clearly-labelled proxy boxes. */
export const PROCEDURAL_PROP_DIMS = {
  locker: [0.62, 1.95, 0.52], gurney: [0.66, 0.92, 1.95], body: [0.9, 0.35, 2.05], optable: [0.7, 1.0, 2.0],
  surglamp: [0.84, 1.0, 0.84], morgue: [2.0, 2.2, 0.75], fountain: [4.5, 2.4, 4.5], sleepbag: [0.75, 0.12, 1.9],
  papers: [0.9, 0.02, 0.9], sink: [0.55, 0.85, 0.42], bucket: [0.3, 0.3, 0.3], padding: [0.96, 2.4, 0.12],
  // added with the 2026-10-25 story rework (woods, control level); measured from the procedural builders in props.js
  tent: [1.6, 1.15, 2.1], tentdown: [1.6, 0.35, 2.1], firepit: [1.2, 0.25, 1.2], grave: [0.8, 0.95, 1.7], cross: [0.42, 1.0, 0.05],
  rock: [1.3, 0.8, 1.3], viewer: [0.35, 1.42, 0.4], noticeboard: [1.7, 2.0, 0.4], stump: [0.6, 0.5, 0.6], memorial: [1.2, 1.5, 0.7],
  core: [4.6, 2.97, 4.6], pylon: [0.62, 2.9, 0.62], console: [1.4, 1.3, 0.7],
};

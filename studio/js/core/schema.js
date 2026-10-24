// Node type registry. Everything the editor knows about a node type lives here:
// its label, category, property schema (drives the inspector automatically),
// default values and the local-space bounding box derived from its properties.
// Adding a new node type = adding one `def()` call.
//
// Local-space conventions (so alignment is predictable):
//   wall      origin = bottom-centre of the wall, length along local X, thickness along Z.
//   floor     origin = centre of the TOP surface (slab hangs below y = 0).
//   ceiling   origin = centre of the BOTTOM surface (slab rises above y = 0).
//   door/window/stairs/elevator/box  origin = bottom-centre.
//   volumes (trigger, interaction, zones) origin = centre.

import { deepClone } from './util.js';

export const TYPES = {};
export const CATEGORIES = ['Architecture', 'Props', 'Lighting', 'Logic', 'Spawns', 'Audio', 'Effects', 'Structure'];

const P = (key, label, type, def, extra = {}) => ({ key, label, type, default: def, ...extra });
const num = (key, label, def, extra = {}) => P(key, label, 'number', def, { step: 0.05, ...extra });
const mat = (def = null) => P('material', 'Material', 'material', def, { group: 'Surface' });

function def(type, spec) {
  TYPES[type] = { type, helper: false, icon: type[0].toUpperCase(), ...spec };
}

export const SURFACES = ['tile', 'concrete', 'wood', 'metal', 'mud', 'grass', 'water', 'carpet', 'gravel'];
export const LOCK_HELP = "'' = unlocked · key:<itemId> · code:<digits> · power · flag:<name> · jammed · script · chain";

// ------------------------------------------------------------------ Architecture
def('wall', {
  label: 'Wall', category: 'Architecture', icon: 'W', color: 0x9aa3a8,
  props: [
    num('length', 'Length', 4, { min: 0.05, unit: 'm', group: 'Dimensions' }),
    num('height', 'Height', 2.8, { min: 0.05, unit: 'm', group: 'Dimensions' }),
    num('thick', 'Thickness', 0.2, { min: 0.01, unit: 'm', group: 'Dimensions' }),
    mat('mat_plaster'),
    P('collide', 'Collision', 'select', 'solid', { options: ['solid', 'none'], group: 'Physics' }),
    P('autoOpenings', 'Auto-cut door/window openings', 'bool', true, { group: 'Physics' }),
  ],
  box: (p) => [-p.length / 2, 0, -p.thick / 2, p.length / 2, p.height, p.thick / 2],
});
def('floor', {
  label: 'Floor', category: 'Architecture', icon: 'F', color: 0x7d8286,
  props: [
    num('w', 'Width (X)', 4, { min: 0.05, unit: 'm', group: 'Dimensions' }),
    num('d', 'Depth (Z)', 4, { min: 0.05, unit: 'm', group: 'Dimensions' }),
    num('thick', 'Thickness', 0.2, { min: 0.01, unit: 'm', group: 'Dimensions' }),
    mat('mat_tile'),
    P('surface', 'Footstep surface', 'select', 'tile', { options: SURFACES, group: 'Physics' }),
    P('collide', 'Collision', 'select', 'solid', { options: ['solid', 'none'], group: 'Physics' }),
  ],
  box: (p) => [-p.w / 2, -p.thick, -p.d / 2, p.w / 2, 0, p.d / 2],
});
def('ceiling', {
  label: 'Ceiling', category: 'Architecture', icon: 'C', color: 0x777b7e,
  props: [
    num('w', 'Width (X)', 4, { min: 0.05, unit: 'm', group: 'Dimensions' }),
    num('d', 'Depth (Z)', 4, { min: 0.05, unit: 'm', group: 'Dimensions' }),
    num('thick', 'Thickness', 0.2, { min: 0.01, unit: 'm', group: 'Dimensions' }),
    mat('mat_plaster'),
    P('collide', 'Collision', 'select', 'solid', { options: ['solid', 'none'], group: 'Physics' }),
  ],
  box: (p) => [-p.w / 2, 0, -p.d / 2, p.w / 2, p.thick, p.d / 2],
});
def('box', {
  label: 'Box / Block', category: 'Architecture', icon: 'B', color: 0xa09890,
  props: [
    num('w', 'Width (X)', 1, { min: 0.01, unit: 'm', group: 'Dimensions' }),
    num('h', 'Height (Y)', 1, { min: 0.01, unit: 'm', group: 'Dimensions' }),
    num('d', 'Depth (Z)', 1, { min: 0.01, unit: 'm', group: 'Dimensions' }),
    mat('mat_concrete'),
    P('collide', 'Collision', 'select', 'solid', { options: ['solid', 'walkable', 'none'], group: 'Physics' }),
  ],
  box: (p) => [-p.w / 2, 0, -p.d / 2, p.w / 2, p.h, p.d / 2],
});
def('stairs', {
  label: 'Stairs', category: 'Architecture', icon: 'S', color: 0x8c8c86,
  props: [
    num('width', 'Width', 1.2, { min: 0.2, unit: 'm', group: 'Dimensions' }),
    P('steps', 'Steps', 'int', 12, { min: 1, max: 80, group: 'Dimensions' }),
    num('stepH', 'Step height', 0.18, { min: 0.02, max: 0.6, unit: 'm', group: 'Dimensions' }),
    num('stepD', 'Step depth', 0.28, { min: 0.05, unit: 'm', group: 'Dimensions' }),
    mat('mat_concrete'),
  ],
  box: (p) => [-p.width / 2, 0, 0, p.width / 2, p.steps * p.stepH, p.steps * p.stepD],
});
def('door', {
  label: 'Door', category: 'Architecture', icon: 'D', color: 0x8a6a4a,
  props: [
    num('width', 'Opening width', 1, { min: 0.3, unit: 'm', group: 'Dimensions' }),
    num('height', 'Opening height', 2.15, { min: 0.5, unit: 'm', group: 'Dimensions' }),
    num('thick', 'Wall thickness', 0.2, { min: 0.02, unit: 'm', group: 'Dimensions' }),
    P('doorId', 'Door ID', 'string', '', { group: 'Behaviour', hint: 'Stable identifier used by events and saves. Defaults to the node name.' }),
    P('state', 'Initial state', 'select', 'closed', { options: ['closed', 'open'], group: 'Behaviour' }),
    P('locked', 'Lock', 'string', '', { group: 'Behaviour', hint: LOCK_HELP }),
    P('hinge', 'Hinge side', 'select', 'left', { options: ['left', 'right'], group: 'Behaviour' }),
    num('openAngle', 'Open angle', 100, { min: 10, max: 180, step: 1, unit: '°', group: 'Behaviour' }),
    P('doubleDoor', 'Double door', 'bool', false, { group: 'Behaviour' }),
    P('metal', 'Metal door', 'bool', false, { group: 'Surface' }),
    mat('mat_wood'),
    P('sndOpen', 'Open sound', 'asset:audio', '', { group: 'Audio' }),
    P('sndClose', 'Close sound', 'asset:audio', '', { group: 'Audio' }),
    P('sndLocked', 'Locked sound', 'asset:audio', '', { group: 'Audio' }),
  ],
  box: (p) => [-p.width / 2, 0, -p.thick / 2, p.width / 2, p.height, p.thick / 2],
});
def('window', {
  label: 'Window', category: 'Architecture', icon: 'N', color: 0x6a8aa0,
  props: [
    num('width', 'Opening width', 1.2, { min: 0.2, unit: 'm', group: 'Dimensions' }),
    num('height', 'Opening height', 1.2, { min: 0.2, unit: 'm', group: 'Dimensions' }),
    num('thick', 'Wall thickness', 0.2, { min: 0.02, unit: 'm', group: 'Dimensions' }),
    num('opacity', 'Glass opacity', 0.25, { min: 0, max: 1, group: 'Surface' }),
    P('broken', 'Broken glass', 'bool', false, { group: 'Surface' }),
    P('boarded', 'Boarded up', 'bool', false, { group: 'Surface' }),
    P('bars', 'Bars', 'bool', false, { group: 'Surface' }),
    mat('mat_wood'),
  ],
  box: (p) => [-p.width / 2, 0, -p.thick / 2, p.width / 2, p.height, p.thick / 2],
});
def('elevator', {
  label: 'Elevator', category: 'Architecture', icon: 'E', color: 0x8a8f94,
  props: [
    num('w', 'Cabin width', 2, { min: 0.8, unit: 'm', group: 'Dimensions' }),
    num('d', 'Cabin depth', 2, { min: 0.8, unit: 'm', group: 'Dimensions' }),
    num('h', 'Cabin height', 2.4, { min: 1.8, unit: 'm', group: 'Dimensions' }),
    P('floors', 'Stop heights (m, comma separated)', 'string', '0, 4', { group: 'Behaviour' }),
    P('startFloor', 'Start stop index', 'int', 0, { min: 0, group: 'Behaviour' }),
    num('speed', 'Speed', 1.5, { min: 0.1, unit: 'm/s', group: 'Behaviour' }),
    P('locked', 'Lock', 'string', '', { group: 'Behaviour', hint: LOCK_HELP }),
    mat('mat_metal'),
  ],
  box: (p) => [-p.w / 2, 0, -p.d / 2, p.w / 2, p.h, p.d / 2],
});
def('vent', {
  label: 'Ventilation shaft', category: 'Architecture', icon: 'V', color: 0x7a7e82,
  props: [
    num('w', 'Inner width', 0.7, { min: 0.2, unit: 'm', group: 'Dimensions' }),
    num('h', 'Inner height', 0.7, { min: 0.2, unit: 'm', group: 'Dimensions' }),
    num('length', 'Length', 4, { min: 0.2, unit: 'm', group: 'Dimensions' }),
    num('thick', 'Sheet thickness', 0.03, { min: 0.005, unit: 'm', group: 'Dimensions' }),
    mat('mat_metal'),
    P('collide', 'Collision', 'select', 'solid', { options: ['solid', 'none'], group: 'Physics' }),
  ],
  box: (p) => [-p.w / 2 - p.thick, 0, 0, p.w / 2 + p.thick, p.h + 2 * p.thick, p.length],
});
def('terrain', {
  label: 'Terrain', category: 'Architecture', icon: 'T', color: 0x5a5448,
  props: [
    num('size', 'Size (square)', 32, { min: 2, unit: 'm', group: 'Dimensions' }),
    P('cells', 'Resolution (cells)', 'int', 32, { min: 4, max: 128, group: 'Dimensions' }),
    P('heights', 'Heights', 'hidden', null),
    mat('mat_mud'),
    P('surface', 'Footstep surface', 'select', 'mud', { options: SURFACES, group: 'Physics' }),
  ],
  box: (p) => {
    let lo = 0, hi = 0;
    if (p.heights) for (const h of p.heights) { if (h < lo) lo = h; if (h > hi) hi = h; }
    return [-p.size / 2, lo - 0.1, -p.size / 2, p.size / 2, hi, p.size / 2];
  },
});

// ------------------------------------------------------------------ Props
def('model', {
  label: 'Model', category: 'Props', icon: 'M', color: 0xb0a898,
  props: [
    P('asset', 'Asset', 'asset:model', '', { group: 'Model' }),
    P('pivot', 'Pivot offset', 'vec3', [0, 0, 0], { group: 'Model', hint: 'Shifts the model inside this node so the node origin is where you want it.' }),
    P('collision', 'Collision', 'select', 'auto-box', { options: ['none', 'auto-box', 'custom'], group: 'Physics' }),
    P('colliderCenter', 'Collider centre', 'vec3', [0, 0.5, 0], { group: 'Physics' }),
    P('colliderSize', 'Collider size', 'vec3', [1, 1, 1], { group: 'Physics' }),
    P('clip', 'Animation clip', 'string', '', { group: 'Animation' }),
    P('autoplay', 'Autoplay clip', 'bool', false, { group: 'Animation' }),
    P('loop', 'Loop clip', 'bool', true, { group: 'Animation' }),
    num('speed', 'Clip speed', 1, { min: 0.05, max: 4, group: 'Animation' }),
    P('materialOverrides', 'Material overrides', 'json', {}, { group: 'Surface' }),
    P('castShadow', 'Cast shadow', 'bool', true, { group: 'Surface' }),
    P('sounds', 'Attached sounds', 'json', [], { group: 'Audio' }),
    P('interaction', 'Interaction', 'json', null, { group: 'Interaction' }),
  ],
  box: (p, ctx) => {
    const b = ctx?.assets?.[p.asset]?.bounds;
    const o = p.pivot || [0, 0, 0];
    if (!b) return [-0.25 + o[0], 0 + o[1], -0.25 + o[2], 0.25 + o[0], 0.5 + o[1], 0.25 + o[2]];
    return [b.min[0] + o[0], b.min[1] + o[1], b.min[2] + o[2], b.max[0] + o[0], b.max[1] + o[1], b.max[2] + o[2]];
  },
});
def('decal', {
  label: 'Decal', category: 'Props', icon: 'd', color: 0x8a2020,
  props: [
    P('texture', 'Texture', 'asset:image', 'builtin:decal/splat', { group: 'Decal' }),
    num('w', 'Width', 1, { min: 0.05, unit: 'm', group: 'Decal' }),
    num('h', 'Height', 1, { min: 0.05, unit: 'm', group: 'Decal' }),
    num('opacity', 'Opacity', 1, { min: 0, max: 1, group: 'Decal' }),
    P('color', 'Tint', 'color', '#ffffff', { group: 'Decal' }),
    P('surfaceTolerance', 'Max distance from surface', 'number', 0.03, { step: 0.005, unit: 'm', group: 'Validation', hint: 'Validation warns when the decal floats further than this from any surface.' }),
  ],
  box: (p) => [-p.w / 2, -p.h / 2, 0, p.w / 2, p.h / 2, 0.01],
});

// ------------------------------------------------------------------ Lighting
def('light', {
  label: 'Light', category: 'Lighting', icon: 'L', color: 0xffd070,
  props: [
    P('kind', 'Kind', 'select', 'point', { options: ['point', 'spot', 'directional'], group: 'Light' }),
    P('color', 'Colour', 'color', '#ffe9c8', { group: 'Light' }),
    num('intensity', 'Intensity', 20, { min: 0, step: 0.5, group: 'Light' }),
    num('range', 'Range', 10, { min: 0.5, unit: 'm', group: 'Light' }),
    num('angle', 'Spot angle', 40, { min: 5, max: 120, step: 1, unit: '°', group: 'Light' }),
    num('penumbra', 'Spot penumbra', 0.3, { min: 0, max: 1, group: 'Light' }),
    P('castShadow', 'Cast shadow', 'bool', false, { group: 'Light' }),
    P('enabled', 'Initially on', 'bool', true, { group: 'Behaviour' }),
    P('flicker', 'Flicker', 'select', 'none', { options: ['none', 'flicker', 'dying', 'pulse'], group: 'Behaviour' }),
    P('powerGroup', 'Power group', 'string', 'main', { group: 'Behaviour', hint: 'Events can switch whole groups on or off.' }),
  ],
  box: () => [-0.15, -0.15, -0.15, 0.15, 0.15, 0.15],
});

// ------------------------------------------------------------------ Logic volumes
const volumeProps = (size, extra = []) => [
  P('size', 'Size', 'vec3', size, { group: 'Volume', min: 0.05 }),
  P('shape', 'Shape', 'select', 'box', { options: ['box', 'sphere'], group: 'Volume' }),
  ...extra,
];
const volumeBox = (p) => {
  const s = p.size || [1, 1, 1];
  return p.shape === 'sphere'
    ? [-s[0] / 2, -s[0] / 2, -s[0] / 2, s[0] / 2, s[0] / 2, s[0] / 2]
    : [-s[0] / 2, -s[1] / 2, -s[2] / 2, s[0] / 2, s[1] / 2, s[2] / 2];
};
def('trigger', {
  label: 'Trigger zone', category: 'Logic', icon: 'Z', helper: true, color: 0x40c0ff,
  props: volumeProps([3, 2.5, 3], [
    P('onEnter', 'On enter event', 'string', '', { group: 'Events' }),
    P('onExit', 'On exit event', 'string', '', { group: 'Events' }),
    P('once', 'Fire once', 'bool', true, { group: 'Events' }),
    P('filter', 'Who triggers', 'select', 'player', { options: ['player', 'enemy', 'any'], group: 'Events' }),
    P('enabled', 'Initially enabled', 'bool', true, { group: 'Events' }),
  ]),
  box: volumeBox,
});
def('interaction', {
  label: 'Interaction volume', category: 'Logic', icon: 'I', helper: true, color: 0x60e090,
  props: volumeProps([1, 1, 1], [
    P('prompt', 'Prompt text', 'string', 'use', { group: 'Interaction' }),
    num('hold', 'Hold time', 0, { min: 0, unit: 's', group: 'Interaction' }),
    P('requires', 'Requires item', 'string', '', { group: 'Interaction' }),
    P('event', 'Event on use', 'string', '', { group: 'Interaction' }),
    P('once', 'Single use', 'bool', false, { group: 'Interaction' }),
    P('enabled', 'Initially enabled', 'bool', true, { group: 'Interaction' }),
    P('reachHeight', 'Player eye height used for reach check', 'number', 1.62, { step: 0.01, unit: 'm', group: 'Validation' }),
  ]),
  box: volumeBox,
});
def('checkpoint', {
  label: 'Checkpoint', category: 'Logic', icon: 'K', helper: true, color: 0xffe060,
  props: volumeProps([3, 2.5, 3], [
    P('checkpointId', 'Checkpoint ID', 'string', '', { group: 'Checkpoint' }),
    P('saves', 'Saved state', 'json', ['flags', 'inventory', 'doors', 'items', 'position'], { group: 'Checkpoint' }),
  ]),
  box: volumeBox,
});
def('navBlocker', {
  label: 'Nav blocker', category: 'Logic', icon: 'X', helper: true, color: 0xff6060,
  props: volumeProps([2, 2, 2], [P('mode', 'Mode', 'select', 'block', { options: ['block', 'allow'], group: 'Navigation' })]),
  box: volumeBox,
});
def('arena', {
  label: 'Boss arena', category: 'Logic', icon: 'A', helper: true, color: 0xc060ff,
  props: volumeProps([12, 5, 12], [
    P('boss', 'Boss archetype', 'string', '', { group: 'Arena' }),
    P('lockDoors', 'Doors locked during fight', 'json', [], { group: 'Arena' }),
    P('escapeObjective', 'Escape objective', 'text', '', { group: 'Arena' }),
  ]),
  box: volumeBox,
});
def('path', {
  label: 'Patrol path', category: 'Logic', icon: 'P', helper: true, color: 0xffa040,
  props: [
    P('closed', 'Closed loop', 'bool', true, { group: 'Path' }),
    P('mode', 'Mode', 'select', 'loop', { options: ['loop', 'pingpong', 'once'], group: 'Path' }),
  ],
  box: () => [-0.15, 0, -0.15, 0.15, 0.3, 0.15],
});
def('waypoint', {
  label: 'Waypoint', category: 'Logic', icon: 'w', helper: true, color: 0xffa040,
  props: [
    num('wait', 'Wait here', 0, { min: 0, unit: 's', group: 'Waypoint' }),
    P('lookAround', 'Look around while waiting', 'bool', false, { group: 'Waypoint' }),
  ],
  box: () => [-0.2, 0, -0.2, 0.2, 0.4, 0.2],
});

// ------------------------------------------------------------------ Spawns
def('playerSpawn', {
  label: 'Player spawn', category: 'Spawns', icon: '@', helper: true, color: 0x40ff90,
  props: [P('spawnId', 'Spawn ID', 'string', '', { group: 'Spawn' }), P('slot', 'Player slot', 'int', 0, { min: 0, max: 3, group: 'Spawn' })],
  box: () => [-0.3, 0, -0.3, 0.3, 1.8, 0.3],
});
def('enemySpawn', {
  label: 'Enemy spawn', category: 'Spawns', icon: 'e', helper: true, color: 0xff4040,
  props: [
    P('archetype', 'Enemy archetype', 'string', '', { group: 'Spawn' }),
    P('dormant', 'Starts dormant', 'bool', false, { group: 'Spawn' }),
    P('patrol', 'Patrol path (node id)', 'string', '', { group: 'Spawn' }),
    P('startState', 'Start state', 'string', 'idle', { group: 'Spawn' }),
    num('delay', 'Spawn delay', 0, { min: 0, unit: 's', group: 'Spawn' }),
    P('spawnOn', 'Spawn on event', 'string', '', { group: 'Spawn' }),
  ],
  box: () => [-0.35, 0, -0.35, 0.35, 1.9, 0.35],
});
def('itemSpawn', {
  label: 'Item pickup', category: 'Spawns', icon: 'i', helper: true, color: 0x40d0d0,
  props: [
    P('item', 'Item ID', 'string', '', { group: 'Item' }),
    P('count', 'Count', 'int', 1, { min: 1, group: 'Item' }),
    P('model', 'Model asset', 'asset:model', '', { group: 'Item' }),
    P('event', 'Event on pickup', 'string', '', { group: 'Item' }),
    P('prompt', 'Prompt', 'string', 'take', { group: 'Item' }),
  ],
  box: () => [-0.15, 0, -0.15, 0.15, 0.3, 0.15],
});

// ------------------------------------------------------------------ Audio
def('audioSource', {
  label: 'Audio source', category: 'Audio', icon: 'a', helper: true, color: 0xe0a0ff,
  props: [
    P('asset', 'Sound', 'asset:audio', '', { group: 'Sound' }),
    num('volume', 'Volume', 1, { min: 0, max: 2, group: 'Sound' }),
    num('pitch', 'Pitch', 1, { min: 0.25, max: 4, group: 'Sound' }),
    P('loop', 'Loop', 'bool', true, { group: 'Sound' }),
    P('autoplay', 'Autoplay', 'bool', true, { group: 'Sound' }),
    num('interval', 'Random one-shot interval (s, 0 = off)', 0, { min: 0, step: 0.5, group: 'Sound' }),
    num('refDistance', 'Full-volume distance', 2, { min: 0.1, unit: 'm', group: 'Spatial' }),
    num('maxDistance', 'Max distance (inaudible beyond)', 30, { min: 0.5, unit: 'm', group: 'Spatial' }),
    num('rolloff', 'Rolloff', 1.2, { min: 0, max: 4, group: 'Spatial' }),
    P('distanceModel', 'Distance model', 'select', 'inverse', { options: ['inverse', 'linear', 'exponential'], group: 'Spatial' }),
    P('occlusion', 'Muffled behind walls', 'bool', true, { group: 'Spatial' }),
    num('reverbSend', 'Reverb send', 0.3, { min: 0, max: 1, group: 'Spatial' }),
    P('bus', 'Bus', 'select', 'sfx', { options: ['sfx', 'ambience', 'music', 'voice'], group: 'Sound' }),
    P('playOnEvent', 'Play on event', 'string', '', { group: 'Triggering' }),
  ],
  box: () => [-0.2, -0.2, -0.2, 0.2, 0.2, 0.2],
});
def('audioZone', {
  label: 'Audio zone', category: 'Audio', icon: 'o', helper: true, color: 0xc080ff,
  props: volumeProps([8, 3, 8], [
    P('kind', 'Kind', 'select', 'ambience', { options: ['ambience', 'reverb', 'music'], group: 'Zone' }),
    P('asset', 'Sound / music', 'asset:audio', '', { group: 'Zone' }),
    num('volume', 'Volume', 0.6, { min: 0, max: 2, group: 'Zone' }),
    num('fade', 'Fade time', 1.5, { min: 0, unit: 's', group: 'Zone' }),
    P('reverb', 'Reverb preset', 'select', 'room', { options: ['none', 'room', 'hall', 'basement', 'chapel', 'outdoor'], group: 'Zone' }),
    P('priority', 'Priority', 'int', 0, { group: 'Zone' }),
    P('muffle', 'Low-pass (Hz, 0 = off)', 'int', 0, { min: 0, group: 'Zone' }),
  ]),
  box: volumeBox,
});
def('footstepZone', {
  label: 'Footstep zone', category: 'Audio', icon: 'f', helper: true, color: 0xa0a0ff,
  props: volumeProps([4, 2, 4], [P('surface', 'Surface', 'select', 'tile', { options: SURFACES, group: 'Zone' })]),
  box: volumeBox,
});

// ------------------------------------------------------------------ Effects
def('particleEmitter', {
  label: 'Particle emitter', category: 'Effects', icon: 'p', color: 0xd0d0d0,
  props: [
    P('preset', 'Preset', 'select', 'dust', { options: ['dust', 'sparks', 'smoke', 'blood', 'drip', 'custom'], group: 'Emitter' }),
    P('texture', 'Texture (custom)', 'asset:image', '', { group: 'Emitter' }),
    P('sheet', 'Sprite sheet (cols,rows,fps)', 'string', '', { group: 'Emitter', hint: 'e.g. 4,4,12 — leave empty for a single frame.' }),
    num('rate', 'Particles / second', 20, { min: 0, step: 1, group: 'Emitter' }),
    num('lifetime', 'Lifetime', 2, { min: 0.1, unit: 's', group: 'Emitter' }),
    num('size', 'Size', 0.1, { min: 0.005, unit: 'm', group: 'Emitter' }),
    num('speed', 'Initial speed', 0.5, { min: 0, group: 'Emitter' }),
    num('spread', 'Spread', 0.5, { min: 0, max: 3, group: 'Emitter' }),
    num('gravity', 'Gravity', 0, { min: -20, max: 20, group: 'Emitter' }),
    P('color', 'Colour', 'color', '#ffffff', { group: 'Emitter' }),
    P('autoplay', 'Autoplay', 'bool', true, { group: 'Emitter' }),
  ],
  box: () => [-0.15, -0.15, -0.15, 0.15, 0.15, 0.15],
});
def('cameraShot', {
  label: 'Camera shot', category: 'Effects', icon: 'c', helper: true, color: 0xffffff,
  props: [num('fov', 'Field of view', 60, { min: 10, max: 140, step: 1, unit: '°', group: 'Camera' }), P('note', 'Note', 'text', '', { group: 'Camera' })],
  box: () => [-0.25, -0.2, -0.3, 0.25, 0.2, 0.3],
});
def('marker', {
  label: 'Marker', category: 'Logic', icon: 'm', helper: true, color: 0xffffff,
  props: [
    P('kind', 'Kind', 'string', 'marker', { group: 'Marker', hint: 'Free-form tag used by events and imported maps (e.g. "gate", "clutter", "tree").' }),
    P('note', 'Note', 'text', '', { group: 'Marker' }),
  ],
  box: () => [-0.2, 0, -0.2, 0.2, 0.4, 0.2],
});
def('group', {
  label: 'Group', category: 'Structure', icon: 'G', color: 0x888888,
  props: [P('prefab', 'Prefab ID', 'string', '', { group: 'Prefab', readonly: true })],
  box: () => [0, 0, 0, 0, 0, 0],
});

// ------------------------------------------------------------------ API
export const TYPE_LIST = Object.keys(TYPES);

export function defaultProps(type) {
  const t = TYPES[type];
  if (!t) throw new Error(`Unknown node type "${type}"`);
  const out = {};
  for (const p of t.props) out[p.key] = deepClone(p.default);
  return out;
}

export function propDef(type, key) {
  return TYPES[type]?.props.find((p) => p.key === key) || null;
}

/** Local-space bounding box [minX,minY,minZ,maxX,maxY,maxZ] of a node ignoring its own transform. */
export function localBox(node, ctx) {
  const t = TYPES[node.type];
  if (!t) return [0, 0, 0, 0, 0, 0];
  const p = { ...defaultProps(node.type), ...node.props };
  return t.box(p, ctx);
}

/** Validate one property value against its schema. Returns an error string or null. */
export function validateProp(type, key, value) {
  const d = propDef(type, key);
  if (!d) return `Unknown property "${key}" for ${type}`;
  switch (d.type) {
    case 'number': case 'int':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${d.label} must be a finite number`;
      if (d.min !== undefined && value < d.min) return `${d.label} must be at least ${d.min}`;
      if (d.max !== undefined && value > d.max) return `${d.label} must be at most ${d.max}`;
      if (d.type === 'int' && !Number.isInteger(value)) return `${d.label} must be a whole number`;
      return null;
    case 'bool': return typeof value === 'boolean' ? null : `${d.label} must be true or false`;
    case 'select': return d.options.includes(value) ? null : `${d.label} must be one of ${d.options.join(', ')}`;
    case 'vec3': return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? null : `${d.label} must be three numbers`;
    case 'color': return /^#[0-9a-fA-F]{6}$/.test(value) ? null : `${d.label} must be a #rrggbb colour`;
    default: return null;
  }
}

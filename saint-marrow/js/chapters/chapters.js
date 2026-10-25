// The six chapters of Saint Marrow, following the story design document (v0.1):
//   1 The Woods · 2 Inside · 3 Below · 4 (draft) · 5 (draft) · 6 Burn the Memory
// Chapters 4 and 5 are placeholders the director has not approved: they are labelled DRAFT in the game.
// A seventh, hidden entry is the epilogue of chapter 6 (the run out through the woods); it never appears in menus.
//
// Each chapter: map, atmosphere, what every letter on the map means, and the script. Scripts run on the host (or the
// solo player); visual events are broadcast with g.custom() and replayed for everyone in onEvent.
import * as THREE from '../../lib/three.module.js';
import { WOODS, ADMISSIONS, WARD9, BASEMENT, CORE } from './maps.js';
import { T } from '../world/grid.js';
import { rand, pick } from '../util.js';
import { CORE_GLOW } from '../world/props.js';

// ------------------------------------------------------------------ shared builders
// Iron gate in the garden fence. The chain is only on gates that were chained shut.
function buildGate(level, open, { chain = true } = {}) {
  const m = level.markers.gate?.[0];
  if (!m) return;
  const A = level.assets;
  const pivot = new THREE.Group();
  pivot.position.set(m.x - 1.5, 0, m.z);
  const gate = A.model('large_iron_gate');
  gate.scale.set(1.02, 0.85, 1);
  gate.position.set(1.5, 0, 0);
  pivot.add(gate);
  level.root.add(pivot);
  const col = level.grid.addCollider({ minX: m.x - 1.5, maxX: m.x + 1.5, minZ: m.z - 0.15, maxZ: m.z + 0.15, minY: 0, maxY: 2.5, solidRay: false, noNav: false });
  const chainGrp = new THREE.Group();
  if (chain) {
    const steel = A.mat('rusty_metal_02', { metal: true, color: 0x8a8580, env: 0.5 });
    const link = new THREE.TorusGeometry(0.03, 0.008, 6, 10);
    for (let i = 0; i < 9; i++) {
      const l = new THREE.Mesh(link, steel);
      l.position.set(0, 1.2 + Math.sin(i * 0.7) * 0.12, (i - 4) * 0.045);
      l.rotation.set(i % 2 ? Math.PI / 2 : 0, Math.PI / 2, 0);
      chainGrp.add(l);
    }
  }
  // the electric lock box on the post
  const lock = new THREE.Mesh(new THREE.BoxGeometry(chain ? 0.06 : 0.16, chain ? 0.08 : 0.22, chain ? 0.03 : 0.1), A.mat('rusty_metal_02', { metal: true, color: chain ? 0x9a8a50 : 0x5a5f58, env: 0.6 }));
  lock.position.set(chain ? 0 : 1.45, chain ? 1.05 : 1.2, 0.05);
  chainGrp.add(lock);
  chainGrp.position.set(m.x, 0, m.z);
  level.root.add(chainGrp);
  level.gate = { pivot, col, chain: chainGrp, open: 0, target: 0, speed: chain ? 0.8 : 0.35 };
  level.animated.push({ update: (dt) => { const G = level.gate; G.open += (G.target - G.open) * Math.min(1, dt * G.speed); pivot.rotation.y = -G.open * 1.6; } });
  if (open) { level.gate.open = level.gate.target = 1; col.disabled = true; if (chain) chainGrp.visible = false; }
  level.addInteractable({ id: 'gate', kind: 'use', use: 'gate', pos: () => new THREE.Vector3(m.x, 1.2, m.z), radius: 1.2, prompt: () => 'use', hold: 0, enabled: !open });
}

function markerNear(g, name, test) {
  const list = g.level.markers[name] || [];
  return list.filter(test);
}

// ------------------------------------------------------------------ chapter 1 — THE WOODS
const WOODS_ENV = {
  env: 'outdoor', rain: false, reverb: 'outdoor', ambience: ['amb_wind', 'amb_forest'],
  themes: ['hut', 'chapel', 'corridor'], defaultTheme: 0,
  fog: [0x080a0d, 0.046], ambient: [0x4f5f78, 0x17140f, 1.75], moon: 0.7, extH: 12, oldBlood: 0,
};

function woodsLegend(epilogue) {
  // in the epilogue the woods are only run through: nothing to use, no story triggers (only the trailhead, CH7.extra)
  const use = (o) => (epilogue ? {} : o);
  return {
    m: { door: true, id: 'mainL', locked: 'script', double: 'left', tint: 0x5a4a3a },
    M: { door: true, id: 'mainR', locked: 'script', double: 'right', tint: 0x5a4a3a },
    g: { base: T.PATH }, G: { base: T.PATH, marker: 'gate' },
    f: { prop: 'fountain' }, w: { prop: 'wheelchair', rot: 2.2 }, j: { prop: 'bench' }, q: { light: 'street', state: epilogue ? 'off' : 'dying' },
    Z: use({ trigger: 'garden', r: 3.2 }), Y: { marker: 'epiSpawn' },
    s: { light: 'security', y: 4.2, state: epilogue ? 'off' : 'flicker', id: 'secLight' },
    Q: { prop: 'desk' }, C: { prop: 'tv' },
    P: { prop: 'fusebox', ...use({ use: 'gatePanel', id: 'gatePanel', useY: 1.45, useR: 0.75, hold: 1.0 }) },
    N: { note: 'n_guard', id: 'guardLog', y: 0.02 },
    u: { light: 'bulb', group: 'booth', state: epilogue ? 'on' : 'off', intensity: 8 },
    R: { prop: 'generator', ...use({ use: 'generator', id: 'generator', hold: 2.5, useY: 1.0, useFront: 0.3 }) },
    d: { prop: 'barrel' },
    e: { door: true, id: 'boothDoor', metal: true, tint: 0x6a6f6a, sign: 'SECURITY' },
    E: { prop: 'noticeboard', note: 'n_board', id: 'board', noteDz: 1.0, noteY: 0.02, face: 's' },
    A: { prop: 'tent' }, a: { prop: 'tentdown' }, o: { prop: 'firepit' }, v: { prop: 'sleepbag' }, p: { prop: 'bag' },
    k: { prop: 'table', item: epilogue ? null : 'key', id: 'cabinKey' },
    c: { note: 'n_campers', id: 'campNote' },
    h: { door: true, id: 'cabinDoor', locked: epilogue ? null : 'item:key', tint: 0x5e4a36 },
    b: { prop: 'daybed' }, r: { prop: 'shelf' },
    K: { prop: 'table', note: 'n_hunter', id: 'hunterLog' },
    J: { item: epilogue ? null : 'fuel', id: 'fuel' },
    i: { item: 'battery' },
    U: { light: 'bulb', group: 'cabin', state: 'off', intensity: 6 },
    X: { prop: 'rock' }, V: { prop: 'viewer', ...use({ use: 'viewer', id: 'viewer', useY: 1.35, useDz: 0.45, prompt: 'use' }) }, l: { prop: 'log', rot: 0.4 },
    y: { prop: 'grave' }, n: { prop: 'cross' },
    I: { prop: 'memorial', note: 'n_memorial', id: 'memorial', noteDz: 0.85, noteY: 0.02 },
    H: { marker: 'wspot' }, t: use({ trigger: 'road', r: 4 }), z: use({ trigger: 'camp', r: 5 }),
  };
}

// little sounds in the dark around the player: owls far off, a twig snapping somewhere behind
function forestSounds(g, dt) {
  g.flags.forestT = (g.flags.forestT ?? rand(12, 20)) - dt;
  if (g.flags.forestT > 0) return;
  g.flags.forestT = rand(14, 32);
  const p = g.randomPlayer();
  if (!p) return;
  const a = rand(0, Math.PI * 2);
  if (Math.random() < 0.55) g.sfx('owl', { x: p.pos.x + Math.cos(a) * 35, y: 8, z: p.pos.z + Math.sin(a) * 35 }, 0.5);
  else {
    // behind the player, close enough to make you turn around
    const yaw = p.p.yaw ?? 0;
    g.sfx('branch', { x: p.pos.x + Math.sin(yaw) * rand(7, 12), y: 0.2, z: p.pos.z + Math.cos(yaw) * rand(7, 12) }, 0.55);
  }
}

// a sighting at one of the hand-placed spots that is ahead of a player, far enough away, and visible
function woodsSighting(g, opts = {}) {
  const pl = g.randomPlayer();
  if (!pl || !g.watcherDir) return false;
  const yaw = pl.p.yaw ?? 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const grid = g.level.grid;
  const spots = markerNear(g, 'wspot', (m) => {
    const dx = m.x - pl.pos.x, dz = m.z - pl.pos.z, d = Math.hypot(dx, dz);
    return d > (opts.min || 17) && d < (opts.max || 42) && (dx * fx + dz * fz) / d > 0.35 && grid.lineOfSight(pl.pos.x, 1.6, pl.pos.z, m.x, 1.9, m.z);
  });
  let s = spots.length ? pick(spots) : null;
  if (!s) { const f = g.watcherDir.findSpot([pl]); if (f) s = { x: f[0], z: f[1] }; }
  if (!s) return false;
  g.watcherDir.showAt(s.x, s.z, { stay: opts.stay ?? rand(10, 18), noVanish: !!opts.noVanish });
  return true;
}

const CH1 = Object.assign({}, WOODS_ENV, {
  id: 1, key: 'ch1', map: WOODS, spawnYaw: 0,
  legend: woodsLegend(false),
  warden: { enabled: false },
  watcher: { gap: [45, 80], dist: [17, 36], near: 12, enabled: false },
  extra(level) { buildGate(level, false, { chain: false }); },
  start(g) {
    g.flags.stage = 0;
    g.objective('o_w_start');
    g.timer(1.5, () => g.subtitle('s_w_arrive', 6));
    g.timer(10, () => g.sfx('owl', { x: 20, y: 9, z: 60 }, 0.6));
    // the first time it is seen: far up the path, standing still
    g.timer(24, () => {
      if (woodsSighting(g, { stay: 14 })) g.timer(2, () => g.subtitle('s_w_figure', 5));
      if (g.watcherDir) { g.watcherDir.enabled = true; g.watcherDir.timer = rand(40, 70); }
    });
  },
  update(g, dt) {
    forestSounds(g, dt);
    // the outer gate closes only when everybody is inside the fence, so nobody is shut out
    if (g.flags.stage === 4) {
      const alive = g.allPlayers().filter((x) => !x.p.dead);
      if (alive.length && alive.every((x) => x.pos.z < 21.6)) {
        g.flags.stage = 5;
        g.custom('gateClose');
        if (g.watcherDir) { g.watcherDir.enabled = false; g.watcherDir.hide('instant'); }
        g.timer(2.2, () => { if (g.watcherDir) g.watcherDir.showAt(35.5, 26.5, { stay: 12, noVanish: true }); g.subtitle('s_w_closed', 6); g.stinger('sting_low'); });
        g.timer(4, () => g.objective('o_w_doors'));
      }
    }
  },
  onTrigger(g, id) {
    if (id === 'road' && g.flags.stage < 1) { g.flags.stage = 1; g.objective('o_w_gate'); }
    if (id === 'camp' && !g.flags.campSeen) {
      g.flags.campSeen = true;
      g.subtitle('s_w_camp', 5);
      g.timer(7, () => woodsSighting(g, { min: 15, max: 32, stay: 9 }));
    }
    if (id === 'garden' && g.flags.stage === 4 && g.isCoop()) g.subtitle('s_w_waitAll', 4);
  },
  onRead(g, note) {
    if (note === 'n_guard' && g.flags.stage < 2) { g.flags.stage = 2; g.objective(g.team.fuel ? 'o_w_fuel2' : 'o_w_power'); }
    if (note === 'n_hunter' && !g.flags.hunterRead) {
      g.flags.hunterRead = true;
      // something outside the window while you read
      g.timer(3.5, () => { if (g.watcherDir && !g.watcher?.visible()) g.watcherDir.showAt(61.2, 58.5, { stay: 6 }); g.sfx('branch', { x: 60.5, y: 0.3, z: 58.5 }, 0.7); });
    }
  },
  onPickup(g, kind) {
    if (kind === 'key') { g.objective('o_w_cabin'); g.timer(5, () => woodsSighting(g, { min: 15, max: 30, stay: 8 })); }
    if (kind === 'fuel') { g.objective('o_w_fuel2'); g.flags.stage = Math.max(g.flags.stage, 2); }
  },
  onUse(g, id, slot) {
    if (id === 'gate') {
      g.toastTo(slot, g.flags.gateOpen ? 'jammed' : 'gateLocked');
      if (g.flags.stage < 1) { g.flags.stage = 1; g.objective('o_w_gate'); }
      return;
    }
    if (id === 'gatePanel') {
      if (!g.flags.power) { g.toastTo(slot, 'panelDead'); if (g.flags.stage < 2) { g.flags.stage = 2; g.objective(g.team.fuel ? 'o_w_fuel2' : 'o_w_power'); } return; }
      if (g.flags.gateOpen) return;
      g.flags.gateOpen = true;
      g.flags.stage = 4;
      g.custom('gateOpen');
      g.objective('o_w_through');
      return;
    }
    if (id === 'generator') {
      if (g.flags.power) return;
      if (!g.team.fuel) { g.toastTo(slot, 'needItem', 'fuel'); g.objective('o_w_fuel'); g.flags.stage = Math.max(g.flags.stage, 2); return; }
      g.flags.power = true;
      g.flags.stage = 3;
      g.custom('genOn');
      g.setPower('booth', true);
      g.objective('o_w_panel');
      g.makeNoise(new THREE.Vector3(47.5, 0, 25.5), 30, 'machine');
      return;
    }
    if (id === 'viewer') {
      // binoculars: whoever looks sees it standing out there, far away, looking back
      const spots = markerNear(g, 'wspot', (m) => { const d = Math.hypot(m.x - 57.5, m.z - 35.5); return d > 20 && d < 48 && g.level.grid.lineOfSight(57.5, 1.6, 35.5, m.x, 1.9, m.z); });
      const s = spots.length ? pick(spots) : { x: 35.5, z: 24.5 };
      if (g.watcherDir && !g.flags.binocularSeen) { g.flags.binocularSeen = true; g.watcherDir.showAt(s.x, s.z, { stay: 6, noVanish: true }); }
      g.custom('binoculars', { slot, x: s.x, z: s.z });
      return;
    }
    if (id === 'mainL' || id === 'mainR') {
      if (g.flags.stage >= 5) { g.flags.stage = 6; g.custom('enterHospital'); g.timer(2.2, () => g.endChapter()); }
      else g.toastTo(slot, 'jammed');
    }
  },
  onEvent(g, e) {
    const G = g.level.gate;
    if (e.k === 'gateOpen' && G) {
      G.target = 1; G.col.disabled = true;
      g.level.interactable('gate').enabled = false;
      g.audio.play('gate_motor', { pos: G.chain.position.clone().setY(1.2), vol: 0.9, ref: 4 });
      g.audio.play('gate', { pos: G.chain.position.clone().setY(1.5), vol: 0.8, delay: 0.4 });
    }
    if (e.k === 'gateClose' && G) {
      G.speed = 2.2; G.target = 0; G.col.disabled = false;
      g.audio.play('gate', { pos: G.chain.position.clone().setY(1.5), vol: 1 });
      setTimeout(() => g.audio.play('gate_clang', { pos: G.chain.position.clone().setY(1.2), vol: 1 }), 900);
      setTimeout(() => g.shake(0.25, 0.4), 900);
    }
    if (e.k === 'genOn') {
      g.audio.play('generator', { pos: new THREE.Vector3(47.5, 0.5, 25.5), vol: 0.8, loop: true, ref: 3 });
      g.subtitle('s_w_power', 4, true);
      const sl = g.level.entities.get('secLight');
      if (sl) sl.state = 'on';
    }
    if (e.k === 'binoculars' && e.slot === g.mySlot()) g.binoculars(new THREE.Vector3(e.x, 2.0, e.z), 5.5);
    if (e.k === 'enterHospital') { g.audio.play('door_creak2', { vol: 0.9 }); g.fadeOut(2); }
  },
});

// ------------------------------------------------------------------ chapter 2 — INSIDE
const INSIDE_LEGEND = {
  a: { decal: 'smear', size: 2, rot: Math.PI / 2 },
  b: { prop: 'bed' }, c: { light: 'bulb', group: 'camp', state: 'on', intensity: 16 },
  d: { decal: 'writing', text: 'HE HEARS YOU', w: 2.6 },
  e: { item: 'battery' }, f: { prop: 'fusebox', use: 'fusebox', id: 'fusebox', useY: 1.45, useR: 0.7, hold: 1.5 },
  g: { item: 'pistol', id: 'pistol', y: 0.79 }, h: { spawn: 'hollow', dormant: true }, i: { item: 'bandage' }, j: { prop: 'chair' },
  k: { item: 'painkillers' }, l: { prop: 'body', decal: 'pool', size: 1.4 }, m: { marker: 'wardenA' }, n: { prop: 'bench' },
  o: { note: 'n_admit' }, p: { prop: 'nightstand' }, q: { marker: 'wardenB' }, r: { prop: 'shelf' }, s: { prop: 'sink' },
  t: { note: 'n_visitors', id: 'visitorsNote' }, u: { prop: 'gurney' }, v: { prop: 'sleepbag' }, w: { prop: 'wheelchair' },
  y: { decal: 'writing', text: 'WE WERE NEVER PATIENTS', face: 'n', w: 3 },
  z: { item: 'ammo9', count: 6 },
  C: { prop: 'tv', id: 'tv' }, E: { door: true, id: 'stairs', locked: 'power', metal: true, sign: 'STAIRS' },
  H: { spawn: 'hollow', dormant: true, id: 'loungeH' }, I: { item: 'fuse', id: 'fuse2', y: 0.79 }, J: { item: 'fuse', id: 'fuse3', y: 0.79 },
  // the code note lies on the desks in the row above (without noteDz it lay on the floor in front of them)
  M: { item: 'medkit' }, N: { note: 'n_code', id: 'codeNote', noteDz: -0.95 }, P: { item: 'painkillers' }, Q: { prop: 'desk' },
  R: { note: 'n_roster' }, S: { door: true, id: 'secDoor', locked: 'code:1994', metal: true, sign: 'SECURITY' },
  U: { item: 'fuse', id: 'fuse1' }, Y: { trigger: 'nearStairs', r: 3 },
  // not once: the handler ignores it until the power is on, and a spent one-shot trigger would end the chapter never
  Z: { trigger: 'stairsEnd', r: 1.6, once: false },
};

const CH2 = {
  id: 2, key: 'ch2', map: ADMISSIONS, env: 'indoor', reverb: 'hall', ambience: ['amb_indoor', 'drone'],
  themes: ['corridor', 'ward', 'office', 'storage', 'surgery'], defaultTheme: 0,
  fog: [0x050607, 0.075], ambient: [0x5d6670, 0x221d18, 1.8], lightsDefault: 'on', cageState: 'flicker', spawnYaw: 0,
  warden: { enabled: false },
  legend: INSIDE_LEGEND,
  extra(level) {
    // a crowbar near the entrance — a tool first, a weapon only if it must be
    level.placeItem('crowbar', 52, 34, { id: 'crowbar' });
  },
  start(g) {
    g.objective('o_in_explore');
    g.setPower('main', false);
    g.flags.fuses = 0;
    g.timer(2.5, () => g.sfx('bang_far', { x: 10, y: 2, z: 5 }, 0.8));
    g.timer(40, () => g.sfx('whisper', { x: 30, y: 1.6, z: 18 }, 0.6));
  },
  update(g, dt) {
    // now and then a door somewhere closes by itself — the feeling of being watched grows
    g.flags.creakT = (g.flags.creakT ?? rand(30, 50)) - dt;
    if (g.flags.creakT <= 0) { g.flags.creakT = rand(35, 70); const p = g.randomPlayer(); if (p) g.sfx(pick(['door_creak2', 'bang_far', 'bare_step']), { x: p.pos.x + rand(-12, 12), y: 1.2, z: p.pos.z + rand(-12, 12) }, 0.6); }
  },
  onTrigger(g, id) {
    if (id === 'stairsEnd' && g.flags.powered) g.endChapter();
  },
  onRead(g, note) {
    if (note === 'n_visitors' && !g.flags.fuseObj) { g.flags.fuseObj = true; g.objective('o_fuses', g.team.fuse || 0, 3); }
  },
  onPickup(g, kind, id) {
    if (kind === 'fuse') {
      if (!g.flags.fuseObj) g.flags.fuseObj = true;
      const n = g.team.fuse || 0;
      if (n >= 3) g.objective('o_fusebox'); else g.objective('o_fuses', n, 3);
      if (id === 'fuse2') { const e = g.enemyById('loungeH'); if (e && e.state === 'dormant') g.timer(0.8, () => e.wake(null)); }
    }
    if (kind === 'pistol') g.timer(1.5, () => g.subtitle('s_in_pistol', 5, true));
  },
  onUse(g, id, slot) {
    if (id === 'fusebox') {
      if ((g.team.fuse || 0) < 3) { g.toastTo(slot, 'needItem', 'fuse', `${g.team.fuse || 0}/3`); return; }
      if (g.flags.powered) return;
      g.flags.powered = true;
      g.custom('powerOn');
      g.setDoor('stairs', { locked: null });
      g.timer(4.5, () => {
        // at the end of the main corridor: the same shape as in the woods. It does not come closer.
        const m = g.level.markers.wardenA?.[0];
        if (m && g.watcherDir) { g.watcherDir.showAt(m.x, m.z, { stay: 4 }); g.subtitle('s_in_figure', 4); g.stinger('sting_low'); }
        g.custom('burst', { x: m?.x ?? 14, z: m?.z ?? 18 });
      });
      g.timer(9, () => { for (const [x, z] of [[12, 29], [40, 29]]) { const e = g.spawnEnemy('hollow', x + 0.5, z + 0.5, {}); if (e) { e.investigate = new THREE.Vector3(30, 0, 18); e.setState('investigate'); } } });
      g.timer(16, () => g.objective('o_stairs'));
    }
  },
  onEvent(g, e) {
    if (e.k === 'powerOn') {
      g.audio.play('power_on', { vol: 1 });
      g.subtitle('s_lightsOn', 4, true);
      const fx = g.lights.fixtures.filter((f) => f.group === 'main');
      fx.forEach((f) => { f.power = false; });
      fx.sort((a, b) => a.pos.x - b.pos.x);
      fx.forEach((f, i) => setTimeout(() => { f.power = true; if (Math.random() < 0.3) f.state = 'flicker'; g.audio.play('switch', { pos: f.pos, vol: 0.5 }); }, 300 + i * 90));
      g.lights.setGroup('emergency', false);
      const tv = g.level.entities.get('tv');
      if (tv) g.audio.play('static', { pos: tv.obj.position.clone().setY(0.4), vol: 0.6, loop: true, ref: 1.5 });
    }
    if (e.k === 'burst') {
      for (const f of g.lights.fixtures) {
        if (f.group === 'main' && Math.hypot(f.pos.x - e.x, f.pos.z - e.z) < 9) { f.state = 'dying'; g.audio.play('glass', { pos: f.pos, vol: 0.6 }); }
      }
    }
  },
};

// ------------------------------------------------------------------ chapter 3 — BELOW (stealth)
const CH3 = {
  id: 3, key: 'ch3', map: BASEMENT, env: 'indoor', reverb: 'basement', ambience: ['amb_basement', 'drone'],
  themes: ['basement', 'storage', 'morgue', 'surgery'], defaultTheme: 0,
  fog: [0x040505, 0.09], ambient: [0x4c545a, 0x18150f, 1.45], lightsDefault: 'on', cageGroup: 'gen', cageState: 'on', spawnYaw: Math.PI / 2,
  // the patrol creature: always on the floor, walking a route; it can be driven off, not killed
  warden: { enabled: true, patrol: true, gap: [4, 8], presence: [100000, 100000], first: 6 },
  legend: {
    b: { prop: 'bodybed' }, e: { note: 'n_plan', id: 'plan', noteDz: -0.95 }, h: { spawn: 'hollow', dormant: true, crawler: true }, i: { item: 'battery' },
    k: { item: 'ammo9', count: 4 }, o: { item: 'medkit' }, r: { prop: 'rack' }, u: { prop: 'gurney' }, w: { prop: 'wheelchair' },
    y: { decal: 'writing', text: 'HE NEVER SLEEPS', w: 2.6 },
    G: { prop: 'generator', use: 'generator', id: 'generator', hold: 2.5, useY: 1.0, useFront: 0.3 }, H: { spawn: 'hollow', dormant: true, scriptOnly: true, tag: 'morgue' },
    J: { item: 'fuel', id: 'fuel' }, K: { door: true, id: 'labDoor', locked: 'power', metal: true, sign: 'LAB' },
    M: { prop: 'morgue', id: 'morgueWall' }, N: { note: 'n_gen' }, P: { item: 'painkillers' }, Q: { prop: 'desk' },
    X: { use: 'ladder', id: 'ladder', useY: 1.4, prompt: 'use' }, Y: { trigger: 'flood', r: 2 }, Z: { trigger: 'nearExit', r: 3 },
  },
  extra(level) {
    const x = level.entities.get('ladder');
    if (x) {
      const A = level.assets;
      const steel = A.mat('rusty_metal_02', { metal: true, color: 0x7a6a60, env: 0.4 });
      const g = new THREE.Group();
      for (const s of [-0.22, 0.22]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.0, 0.04), steel); r.position.set(0, 1.5, s); g.add(r); }
      for (let i = 0; i < 10; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.44, 6), steel); r.rotation.x = Math.PI / 2; r.position.set(0, 0.3 + i * 0.28, 0); g.add(r); }
      g.position.set(x.x + 0.1, 0, x.z + 0.5);
      level.root.add(g);
    }
    // glass bottles to throw: a noise somewhere else is the best way past the patrol
    const rng = level.rng;
    const g = level.grid;
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 9; tries++) {
      const c = g.randomWalkable(rng);
      if (!c || g.blocked(c.x, c.z, 0.3)) continue;
      if (Math.hypot(c.x - 60, c.z - 14) < 5) continue;
      level.placeItem('bottle', Math.floor(c.x), Math.floor(c.z), { id: 'bottle_' + placed });
      placed++;
    }
  },
  start(g) {
    g.objective('o_b_start');
    g.setPower('gen', false);
    g.timer(2, () => g.sfx('drip', { x: 30, y: 2.8, z: 14 }, 0.8));
    g.timer(5, () => g.subtitle('s_b_quiet', 6));
    g.timer(14, () => g.subtitle('s_b_throw', 6, true));
  },
  update(g, dt) {
    g.flags.dripT = (g.flags.dripT ?? 3) - dt;
    if (g.flags.dripT <= 0) { g.flags.dripT = rand(1.5, 4); const p = g.randomPlayer(); if (p) g.sfx('drip', { x: p.pos.x + rand(-6, 6), y: 2.9, z: p.pos.z + rand(-6, 6) }, 0.5); }
  },
  onPickup(g, kind) {
    if (kind === 'fuel') {
      g.objective('o_b_generator');
      g.custom('drawers');
      g.timer(0.8, () => { for (const e of g.enemies) if (e.tag === 'morgue' && e.state === 'dormant') e.wake(null); });
      g.stinger('sting_jump');
    }
  },
  onRead(g, note) {
    if (note === 'n_plan' && !g.flags.plan) { g.flags.plan = true; g.objective('o_b_shaft'); g.timer(1, () => g.subtitle('s_b_plan', 6, true)); }
  },
  onUse(g, id, slot) {
    if (id === 'generator') {
      if (!g.team.fuel) { g.toastTo(slot, 'needItem', 'fuel'); return; }
      if (g.flags.gen) return;
      g.flags.gen = true;
      g.custom('genStart');
      g.setPower('gen', true);
      g.setDoor('labDoor', { locked: null });
      g.objective('o_b_lab');
      // the generator is loud: everything on this floor heard it
      g.makeNoise(new THREE.Vector3(49.5, 0, 19.5), 40, 'machine');
    }
    if (id === 'ladder') {
      if (!g.flags.plan) { g.toastTo(slot, 'shaftDark'); return; }
      g.custom('descend');
      g.timer(2.5, () => g.endChapter());
    }
  },
  onTrigger(g, id) {
    if (id === 'flood' && g.warden && g.warden.state === 'wander') { g.warden.investigate = new THREE.Vector3(26, 0, 14); g.warden.setState('investigate'); }
  },
  onEvent(g, e) {
    if (e.k === 'drawers') {
      const m = g.level.entities.get('morgueWall');
      if (m?.obj?.userData.doors) {
        m.obj.userData.doors.forEach((d, i) => { if (i % 3 !== 1) setTimeout(() => { d.rotation.y = -1.4 - Math.random() * 0.3; g.audio.play('locker', { pos: m.obj.position.clone().setY(1), vol: 0.7, rate: 0.8 }); }, 200 + i * 160); });
      }
    }
    if (e.k === 'genStart') {
      g.audio.play('generator', { pos: new THREE.Vector3(49.5, 0.5, 19.5), vol: 0.9, loop: true, ref: 3 });
      g.subtitle('s_genStart', 4, true);
      g.lights.setGroup('emergency', false);
    }
    if (e.k === 'descend') { g.audio.play('door_creak2', { vol: 0.7, rate: 0.6 }); g.fadeOut(2); }
  },
};

// ------------------------------------------------------------------ chapter 4 — DRAFT (not approved)
// Placeholder built from the earlier Ward 9 level: records about what the hospital really was begin to surface.
const CH4 = {
  id: 4, key: 'ch4', draft: true, map: WARD9, env: 'indoor', reverb: 'hall', ambience: ['amb_indoor', 'drone'],
  themes: ['corridor', 'padded', 'office', 'storage', 'surgery'], defaultTheme: 0,
  fog: [0x050506, 0.08], ambient: [0x5a616a, 0x1e1a16, 1.7], lightsDefault: 'dying', cageState: 'flicker', spawnYaw: -Math.PI / 2,
  warden: { enabled: true, gap: [30, 55], presence: [55, 95], first: 45 },
  legend: {
    a: { item: 'ammo9', count: 6 }, b: { prop: 'bed' }, c: { door: true, id: 'cell94' }, d: { decal: 'writing', text: 'HE KEEPS THE OTHERS IN LINE', w: 3.2 },
    e: { note: 'n_hale', id: 'haleDiary', y: 0.79 }, g: { prop: 'gurney', spawn: 'hollow', dormant: true, scriptOnly: true, dz: 1.0, tag: 'theatre' },
    h: { spawn: 'hollow', dormant: true }, i: { item: 'battery' }, k: { prop: 'nightstand', item: 'key', id: 'elevKey' },
    l: { door: true, locked: 'jammed' }, m: { prop: 'body', decal: 'pool', size: 1.8, id: 'cellBody' }, n: { prop: 'bench' }, p: { prop: 'bed' },
    r: { prop: 'shelf' }, s: { prop: 'sink' }, t: { note: 'n_tape4', tape: true, id: 'tape4' }, u: { prop: 'gurney' }, v: { item: 'medkit' },
    w: { prop: 'wheelchair' }, y: { decal: 'pool', size: 2.4 },
    C: { prop: 'cabinet', item: 'rifle', id: 'rifle' }, G: { item: 'ammo762', count: 5 }, H: { spawn: 'hollow' }, I: { item: 'keycard', id: 'keycard' },
    K: { door: true, id: 'haleDoor', locked: 'item:keycard', sign: 'DR. E. HALE' }, N: { note: 'n_surgery' }, P: { item: 'painkillers' },
    Q: { prop: 'desk' }, S: { prop: 'surglamp' }, U: { prop: 'optable' }, V: { door: true, id: 'elevDoor', locked: 'item:key', metal: true, sign: 'LIFT' },
    Z: { trigger: 'elevator', r: 1.8 },
  },
  start(g) {
    g.objective('o_d4_start');
    g.timer(1.2, () => g.subtitle('s_draft', 6, true));
    g.timer(3, () => g.sfx('whisper', { x: 20, y: 1.6, z: 16 }, 0.9));
  },
  onRead(g, note) {
    if (note === 'n_tape4' && !g.flags.heardTape) { g.flags.heardTape = true; g.objective('o_keycard'); }
    if (note === 'n_hale' && g.flags.office) g.objective('o_elevator');
  },
  onPickup(g, kind) {
    if (kind === 'keycard') {
      g.objective('o_office');
      g.custom('theatre');
      g.timer(1.2, () => { for (const e of g.enemies) if (e.tag === 'theatre' && e.state === 'dormant') e.wake(null); });
      g.stinger('sting_jump');
    }
    if (kind === 'key') { g.flags.office = true; g.objective('o_elevator'); }
    if (kind === 'rifle') g.flags.office = true;
  },
  onTrigger(g, id) {
    if (id === 'elevator' && !g.flags.elev) {
      g.flags.elev = true;
      g.custom('elevator');
      g.timer(6.5, () => g.endChapter());
    }
  },
  onEvent(g, e) {
    if (e.k === 'theatre') {
      for (const f of g.lights.fixtures) if (f.pos.z < 9 && f.pos.x > 13 && f.pos.x < 33) f.state = 'flicker';
      g.flash(0.3, 0.1);
    }
    if (e.k === 'elevator') {
      const d = g.level.entities.get('elevDoor');
      if (d) d.slam();
      g.audio.play('door_slam', { vol: 0.9 });
      g.audio.play('elevator', { vol: 1, delay: 0.8 });
      g.subtitle('s_elevator', 4, true);
      g.shake(0.6, 4.5);
      g.fadeOut(5.5);
    }
  },
};

// ------------------------------------------------------------------ chapter 5 — DRAFT (not approved)
// Placeholder: the hospital's system plays with perception. The ground floor again, but it lies to you:
// footsteps that are not there, a figure that is gone when the light finds it, monitors showing the room you stand in.
const CH5 = {
  id: 5, key: 'ch5', draft: true, map: ADMISSIONS, env: 'indoor', reverb: 'hall', ambience: ['amb_indoor', 'drone'],
  themes: ['corridor', 'ward', 'office', 'storage', 'surgery'], defaultTheme: 0,
  fog: [0x060506, 0.085], ambient: [0x5a5560, 0x1d1820, 1.55], lightsDefault: 'flicker', cageState: 'dying', spawnYaw: 0,
  warden: { enabled: false },
  legend: Object.assign({}, INSIDE_LEGEND, {
    g: { item: 'ammo9', count: 6, y: 0.79 }, o: {}, t: {}, R: {}, N: {}, z: { item: 'battery' },
    d: { decal: 'writing', text: 'IT SEES WHAT YOU SEE', w: 2.8 },
    y: { decal: 'writing', text: 'NOTHING HERE IS REAL', face: 'n', w: 3 },
    // three monitors that show the room you are standing in; switching them off loosens the system's grip
    U: { prop: 'tv', use: 'relay', id: 'relay1', useY: 1.05, hold: 1.2 }, I: { prop: 'tv', use: 'relay', id: 'relay2', useY: 1.05, hold: 1.2, dx: -0.4 }, J: { prop: 'tv', use: 'relay', id: 'relay3', useY: 1.05, hold: 1.2, dx: 0.4 },
    E: { door: true, id: 'stairs', locked: 'script', metal: true, sign: 'STAIRS' },
    S: { door: true, id: 'secDoor', metal: true, sign: 'SECURITY' },
    f: { prop: 'fusebox' },
  }),
  start(g) {
    g.objective('o_d5_start', 0, 3);
    g.flags.relays = 0;
    g.timer(1.2, () => g.subtitle('s_draft', 6, true));
    g.timer(8, () => g.subtitle('s_d5_wrong', 5));
  },
  update(g, dt) {
    // false cues: steps right behind you, a knock from a room you just left, a voice from the wrong direction
    g.flags.lieT = (g.flags.lieT ?? 12) - dt;
    if (g.flags.lieT <= 0) {
      g.flags.lieT = rand(10, 22);
      const p = g.randomPlayer();
      if (!p) return;
      const yaw = p.p.yaw ?? 0;
      const r = Math.random();
      if (r < 0.35) g.sfx('bare_step', { x: p.pos.x + Math.sin(yaw) * 2.5, y: 0.1, z: p.pos.z + Math.cos(yaw) * 2.5 }, 0.8);
      else if (r < 0.6) g.sfx('bang_far', { x: p.pos.x + rand(-8, 8), y: 1.5, z: p.pos.z + rand(-8, 8) }, 0.7);
      else if (r < 0.8) g.sfx('radio_voice', { x: p.pos.x - Math.sin(yaw) * -10, y: 1.5, z: p.pos.z + 10 }, 0.5);
      else if (g.watcherDir && !g.watcher?.visible()) {
        // a shape ahead that is gone as soon as the light touches it
        const d = rand(7, 12), a = yaw + rand(-0.4, 0.4);
        const x = p.pos.x - Math.sin(a) * d, z = p.pos.z - Math.cos(a) * d;
        if (!g.level.grid.blocked(x, z, 0.35) && g.level.grid.lineOfSight(p.pos.x, 1.6, p.pos.z, x, 1.8, z)) g.watcherDir.showAt(x, z, { stay: 2.5 });
      }
    }
  },
  onUse(g, id, slot) {
    if (id.startsWith('relay')) {
      if (g.flags[id]) return;
      g.flags[id] = true;
      g.flags.relays++;
      g.custom('relayOff', { id });
      if (g.flags.relays >= 3) { g.setDoor('stairs', { locked: null }); g.objective('o_d5_stairs'); g.custom('released'); }
      else g.objective('o_d5_start', g.flags.relays, 3);
    }
    if (id === 'stairs') g.toastTo(slot, 'jammed');
  },
  onTrigger(g, id) {
    if (id === 'stairsEnd' && g.flags.relays >= 3) g.endChapter();
  },
  onEvent(g, e) {
    if (e.k === 'relayOff') { const t = g.level.entities.get(e.id); if (t) g.audio.play('static', { pos: t.pos.clone().setY(0.6), vol: 0.5 }); g.flash(0.2, 0.08); }
    if (e.k === 'released') { g.audio.play('power_on', { vol: 0.7, rate: 0.7 }); g.subtitle('s_d5_released', 4, true); }
  },
};

// ------------------------------------------------------------------ chapter 6 — BURN THE MEMORY
const CH6 = {
  id: 6, key: 'ch6', map: CORE, env: 'indoor', reverb: 'basement', ambience: ['amb_basement', 'drone'],
  themes: ['basement'], defaultTheme: 0,
  fog: [0x040506, 0.075], ambient: [0x4c5562, 0x15130f, 1.5], lightsDefault: 'on', cageState: 'on', spawnYaw: 0,
  warden: { enabled: false },
  escapeTime: 180,
  legend: {
    A: { prop: 'console', use: 'station', id: 'stationW', useY: 1.05, useFront: 0.45, hold: 2.0 },
    // not 'B': that letter is an exterior wall in the grid (world/grid.js CHAR), so the console was built as a wall
    G: { prop: 'console', use: 'station', id: 'stationE', useY: 1.05, useFront: 0.45, hold: 2.0 },
    E: { prop: 'console', use: 'station', id: 'stationN', useY: 1.05, useFront: 0.45, hold: 2.0 },
    C: { prop: 'core', use: 'core', id: 'core', useY: 1.0, useDz: 2.35, useR: 0.9, hold: 4.0 },
    Y: { prop: 'pylon' },
    K: { door: true, id: 'chamberS1', locked: 'script', metal: true, double: 'left' },
    k: { door: true, id: 'chamberS2', locked: 'script', metal: true, double: 'right' },
    N: { door: true, id: 'chamberN1', locked: 'script', metal: true, double: 'left' },
    w: { door: true, id: 'chamberN2', locked: 'script', metal: true, double: 'right' },
    // not once: the exit corridor is reachable before the core is shut down, and the handler waits for the escape
    Z: { trigger: 'exit', r: 1.6, once: false },
    f: { marker: 'hazard' },
    h: { spawn: 'hollow', dormant: true },
    i: { item: 'battery' }, m: { item: 'medkit' }, a: { item: 'ammo9', count: 8 }, n: { item: 'bandage' }, p: { item: 'painkillers' },
    r: { note: 'n_core', id: 'coreNote', y: 0.02 },
  },
  start(g) {
    g.objective('o_f_stations', 0, 3);
    g.flags.stations = 0;
    g.timer(1.5, () => g.subtitle('s_f_arrive', 6));
    g.timer(6, () => g.sfx('static', { x: 27.5, y: 2, z: 20.5 }, 0.5));
  },
  update(g, dt) {
    if (g.flags.escape) {
      g.flags.left = Math.max(0, (g.flags.left ?? CH6.escapeTime) - dt);
      if (Math.floor(g.flags.left) !== g.flags.shown) { g.flags.shown = Math.floor(g.flags.left); g.objective('o_f_escape', null, null, g.flags.left); }
      g.flags.quakeT = (g.flags.quakeT ?? 3) - dt;
      if (g.flags.quakeT <= 0) {
        g.flags.quakeT = rand(4, 9);
        g.custom('quake', { a: rand(0.25, 0.5) });
        // falling debris near someone, a hit if you are standing right under it
        const p = g.randomPlayer();
        if (p) {
          const x = p.pos.x + rand(-3, 3), z = p.pos.z + rand(-3, 3);
          g.custom('debris', { x, z });
          for (const q of g.allPlayers()) if (!q.p.dead && Math.hypot(q.pos.x - x, q.pos.z - z) < 1.1) g.damagePlayer(q.slot, 22, { dir: new THREE.Vector3(0, -1, 0) });
        }
      }
      // fire: standing in it hurts
      for (const h of g.level.markers.hazard || []) {
        for (const q of g.allPlayers()) {
          if (q.p.dead || Math.hypot(q.pos.x - h.x, q.pos.z - h.z) >= 1.0) continue;
          const k = 'burn' + q.slot;
          g.flags[k] = (g.flags[k] ?? 0) - dt;
          if (g.flags[k] <= 0) { g.flags[k] = 0.6; g.damagePlayer(q.slot, 8, {}); }
        }
      }
      if (g.flags.left <= 0 && !g.flags.collapsed) {
        g.flags.collapsed = true;
        g.custom('collapse');
        for (const q of g.allPlayers()) if (!q.p.dead) g.damagePlayer(q.slot, 999, { dir: new THREE.Vector3(0, -1, 0) });
      }
    }
  },
  onUse(g, id, slot) {
    if (id === 'station') return;
    if (id.startsWith('station')) {
      if (g.flags[id]) return;
      g.flags[id] = true;
      g.flags.stations++;
      g.custom('stationOn', { id });
      if (g.flags.stations >= 3) {
        for (const id of ['chamberS1', 'chamberS2']) g.setDoor(id, { locked: null, open: true });
        g.objective('o_f_core');
        g.timer(1, () => g.subtitle('s_f_chamber', 5));
        // the system notices: everything still sleeping down here wakes
        g.timer(3, () => { for (const e of g.enemies) if (e.state === 'dormant') e.wake(null); });
      } else g.objective('o_f_stations', g.flags.stations, 3);
      return;
    }
    if (id === 'core') {
      if (g.flags.stations < 3) { g.toastTo(slot, 'coreLocked'); return; }
      if (g.flags.escape) return;
      g.flags.escape = true;
      g.flags.left = CH6.escapeTime;
      g.custom('shutdown');
      for (const id of ['chamberS1', 'chamberS2']) g.setDoor(id, { open: false, locked: 'script', slam: true });
      for (const id of ['chamberN1', 'chamberN2']) g.setDoor(id, { locked: null, open: true });
      g.timer(2, () => g.subtitle('s_f_shutdown', 6));
      g.timer(6, () => { for (const [x, z] of [[45, 31], [10, 9], [44, 8]]) { const e = g.spawnEnemy('hollow', x + 0.5, z + 0.5, {}); if (e) { e.investigate = new THREE.Vector3(27.5, 0, 12); e.setState('investigate'); } } });
    }
  },
  onTrigger(g, id) {
    if (id === 'exit' && g.flags.escape && !g.flags.out) { g.flags.out = true; g.custom('out'); g.timer(1.6, () => g.continueChapter(7)); }
  },
  onEvent(g, e) {
    if (e.k === 'stationOn') {
      const t = g.level.entities.get(e.id);
      if (t?.obj?.userData.screen) t.obj.userData.screen.material = t.obj.userData.screen.material.clone(), t.obj.userData.screen.material.emissive.set(0x7fd6ff), t.obj.userData.screen.material.emissiveIntensity = 1.4;
      g.audio.play('switch', { pos: t?.pos?.clone().setY(1) || null, vol: 0.7 });
      g.audio.play('power_on', { vol: 0.4, rate: 1.3 });
    }
    if (e.k === 'shutdown') {
      CORE_GLOW.emissiveIntensity = 0.05;
      g.audio.play('power_on', { vol: 1, rate: 0.5 });
      g.alarm = g.audio.play('alarm', { vol: 0.55, loop: true, bus: 'music' });
      g.audio.play('rumble', { vol: 1 });
      g.shake(0.6, 2.5);
      g.lights.setGroup('main', false);
      g.lights.setGroup('emergency', true);
      for (const f of g.lights.fixtures) if (f.kind === 'emergency' || f.type === 'emergency') f.state = 'on';
      for (const h of g.level.markers.hazard || []) g.fx.fire ? g.fx.fire(new THREE.Vector3(h.x, 0, h.z)) : null;
      g.debrisBlock?.();
    }
    if (e.k === 'quake') { g.shake(e.a, 1.2); g.audio.play('rumble', { vol: 0.5 + e.a }); }
    if (e.k === 'debris') { g.fx.debris ? g.fx.debris(new THREE.Vector3(e.x, 2.9, e.z)) : g.fx.impact({ x: e.x, y: 0.05, z: e.z, nx: 0, ny: 1, nz: 0 }, new THREE.Vector3(0, -1, 0), 'concrete'); g.audio.play('impact_wall', { pos: new THREE.Vector3(e.x, 1, e.z), vol: 1 }); }
    if (e.k === 'collapse') { g.audio.play('collapse', { vol: 1 }); g.shake(1, 3); g.fadeOut(2.5); }
    if (e.k === 'out') { g.audio.play('door_slam', { vol: 0.8 }); g.fadeOut(1.4); }
  },
  extra(level) {
    // when the system goes down the ceiling over the north corridor comes down: the short way out is gone
    level.game.debrisBlock = () => {
      const g = level.grid;
      const col = g.addCollider({ minX: 17.5, maxX: 19.5, minZ: 6, maxZ: 11, minY: 0, maxY: 2.6, solidRay: true });
      const A = level.assets;
      const rubble = new THREE.Group();
      const stone = A.mat('concrete_wall_006', { color: 0x6a6660 });
      for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.4 + Math.random() * 0.9, 0.3 + Math.random() * 0.8, 0.4 + Math.random() * 0.9), stone); m.position.set(17.6 + Math.random() * 1.8, Math.random() * 2.2, 6.2 + Math.random() * 4.6); m.rotation.set(Math.random(), Math.random(), Math.random()); m.castShadow = true; rubble.add(m); }
      level.root.add(rubble);
      return col;
    };
  },
};

// ------------------------------------------------------------------ epilogue of chapter 6 (hidden) — out through the woods
const CH7 = Object.assign({}, WOODS_ENV, {
  id: 7, key: 'ch6', hidden: true, part: 6, map: WOODS, spawnMarker: 'epiSpawn', spawnYaw: Math.PI,
  fog: [0x0e0907, 0.034], ambient: [0x5c4a3e, 0x15100c, 1.35], ambience: ['amb_wind', 'fire'],
  legend: woodsLegend(true),
  warden: { enabled: false },
  extra(level) {
    buildGate(level, true, { chain: false });
    // the trail where it all began
    level.triggers.push({ id: 'trailhead', x: 35.5, z: 84.5, r: 4, once: true, fired: false });
    // fire behind every window of the hospital, and the upper floors that are about to come down
    const A = level.assets;
    const hosp = new THREE.Group();
    const brick = A.mat('red_bricks_04', { color: 0x4a3830 });
    const upper = new THREE.Mesh(new THREE.BoxGeometry(48, 9, 7), brick); upper.position.set(35.5, 16.5, 5); hosp.add(upper);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 7), brick); tower.position.set(35.5, 27, 5); hosp.add(tower);
    const glow = new THREE.MeshBasicMaterial({ color: 0xff6a20 });
    for (let i = 0; i < 18; i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.5), glow); w.position.set(13 + i * 2.6, 15 + (i % 3) * 2.8, 8.56); hosp.add(w); }
    level.root.add(hosp);
    level.hospitalTop = hosp;
    // the glow on the garden goes through the light pool like every other light (quality setting decides how many are real)
    for (const x of [16, 28, 40, 54]) level.lights.add('virtual', x, 6, 11, { color: 0xff6a20, intensity: 200, range: 26, state: 'fire' });
  },
  start(g) {
    g.objective('o_f_run');
    g.audio.play('rumble', { vol: 0.9 });
    g.timer(1.2, () => g.subtitle('s_f_out', 5));
    // they come out after you
    g.timer(7, () => { for (const [x, z] of [[33, 12], [38, 12], [36, 14]]) { const e = g.spawnEnemy('hollow', x + 0.5, z + 0.5, {}); if (e) { const p = g.nearestPlayer(e.pos); if (p) { e.investigate = p.pos.clone(); e.setState('investigate'); } } } });
    g.flags.boomT = 6;
  },
  update(g, dt) {
    g.flags.boomT -= dt;
    if (g.flags.boomT <= 0 && !g.flags.done) { g.flags.boomT = rand(6, 12); g.custom('boom'); }
  },
  onTrigger(g, id) {
    if (id === 'trailhead' && !g.flags.done) {
      g.flags.done = true;
      g.custom('finale');
      g.timer(11, () => g.endGame());
    }
  },
  onEvent(g, e) {
    if (e.k === 'boom') { g.audio.play('rumble', { vol: 0.8 }); g.shake(0.3, 1); g.flash(0.25, 0.3); }
    if (e.k === 'finale') {
      // stop and look back: the hospital comes down
      for (const en of g.enemies) en.state = 'absent', en.root.visible = false;
      g.lookBack(new THREE.Vector3(35.5, 14, 6), 10);
      const top = g.level.hospitalTop;
      setTimeout(() => { g.audio.play('collapse', { vol: 1 }); g.flash(0.6, 0.6); }, 2500);
      if (top) { let t = 0; g.level.animated.push({ update: (dt) => { t += dt; if (t < 2.5) return; const k = Math.min(1, (t - 2.5) / 5); top.position.y = -k * k * 22; top.rotation.z = k * 0.08; } }); }
      setTimeout(() => g.subtitle('s_f_end', 6), 6000);
    }
  },
});

export const CHAPTERS = [CH1, CH2, CH3, CH4, CH5, CH6, CH7];
export const CHAPTER_COUNT = CHAPTERS.filter((c) => !c.hidden).length;

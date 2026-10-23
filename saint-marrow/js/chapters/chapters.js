// The five chapters: map, atmosphere, what every letter on the map means, and the story script.
// Scripts run on the host (or solo player); visual events are broadcast and replayed with onEvent.
import * as THREE from '../../lib/three.module.js';
import { GROUNDS, ADMISSIONS, WARD9, BASEMENT } from './maps.js';
import { T } from '../world/grid.js';
import { rand, pick } from '../util.js';

const OUTDOOR_ENV = {
  env: 'outdoor', rain: true, reverb: 'outdoor', ambience: ['amb_wind', 'amb_rain'],
  themes: ['hut', 'chapel', 'corridor'], defaultTheme: 2,
  fog: [0x0b0d10, 0.045], ambient: [0x55657a, 0x1c1914, 2.0], moon: 0.8, extH: 10, oldBlood: 0,
};

// ------------------------------------------------------------------ shared builders
function groundsLegend(ch) {
  return {
    m: { door: true, id: 'mainL', locked: 'chain', double: 'left', tint: 0x6a5a48 },
    M: { door: true, id: 'mainR', locked: 'chain', double: 'right', tint: 0x6a5a48 },
    a: { door: true, id: 'bay', locked: 'script', metal: true, tint: 0x8a8f86, sign: 'AMBULANCE' },
    c: { door: true, id: 'chapel', locked: ch === 1 ? 'jammed' : null, open: ch === 5, tint: 0x5a4030 },
    h: { door: true, id: 'hutDoor', tint: 0x6e5a44 },
    g: { base: T.PATH },
    G: { base: T.PATH, marker: 'gate' },
    s: { light: 'security', y: 4.2, state: 'flicker', id: 'secLight' },
    q: { light: 'street', state: 'dying' },
    k: { prop: 'table', item: ch === 1 ? 'boltcutters' : null, id: 'cutters' },
    K: { prop: 'toolchest', item: ch === 1 ? 'crowbar' : null, id: 'crowbarHut' },
    N: { prop: 'nightstand', note: 'n_hut', id: 'hutNote' },
    i: { prop: 'nightstand', item: 'battery' },
    b: { prop: 'daybed' },
    o: { item: 'bandage' },
    v: { prop: 'car', rot: Math.PI / 2 },
    l: { prop: 'log', rot: 0.2 },
    e: { note: 'n_gate', id: 'gateNote' },
    w: { prop: 'wheelchair', id: 'wheel', rot: Math.PI / 2 },
    y: { prop: 'body', note: 'n_theo', id: 'theo', dx: 0.6, decal: 'pool', size: 1.6, rot: 1.2 },
    r: { decal: 'smear', rot: 0, size: 1.4 },
    j: { prop: 'bench' },
    d: { prop: 'barrel' },
    A: { prop: 'table', face: 'e' },
    R: { prop: 'radio', id: 'radio', use: ch === 5 ? 'radio' : null, useY: 1.1, prompt: 'use', face: 'e', y: 0.96 },
    J: { marker: 'jonah' },
    u: { light: 'bulb', group: 'chapel', state: ch === 5 ? 'on' : 'off', intensity: 10 },
    p: { marker: 'p5', item: ch === 5 ? 'medkit' : null },
    n: { prop: 'bench', face: 'w' },
    f: { prop: 'fountain' },
    H: { marker: 'hspawn' },
    z: { trigger: 'wheel', r: 3 },
    Z: { trigger: 'gateInside', r: 3 },
    Y: { trigger: 'bay', r: 5 },
    X: { marker: 'carSpot' },
    E: { trigger: 'road', r: 4 },
  };
}

// Iron gate in the south fence, chained shut in chapter 1.
function buildGate(level, open) {
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
  const chain = new THREE.Group();
  const steel = A.mat('rusty_metal_02', { metal: true, color: 0x8a8580, env: 0.5 });
  const link = new THREE.TorusGeometry(0.03, 0.008, 6, 10);
  for (let i = 0; i < 9; i++) {
    const l = new THREE.Mesh(link, steel);
    l.position.set(0, 1.2 + Math.sin(i * 0.7) * 0.12, (i - 4) * 0.045);
    l.rotation.set(i % 2 ? Math.PI / 2 : 0, Math.PI / 2, 0);
    chain.add(l);
  }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.03), A.mat('rusty_metal_02', { metal: true, color: 0x9a8a50, env: 0.6 }));
  lock.position.set(0, 1.05, 0.05);
  chain.add(lock);
  chain.position.set(m.x, 0, m.z);
  level.root.add(chain);
  level.gate = { pivot, col, chain, open: 0, target: 0 };
  level.animated.push({ update: (dt) => { const G = level.gate; G.open += (G.target - G.open) * Math.min(1, dt * 0.8); pivot.rotation.y = -G.open * 1.6; } });
  if (open) { level.gate.open = level.gate.target = 1; col.disabled = true; chain.visible = false; }
  level.addInteractable({ id: 'gate', kind: 'use', use: 'gate', pos: () => new THREE.Vector3(m.x, 1.2, m.z), radius: 1.2, prompt: () => 'use', hold: 0, enabled: !open });
}

function rainAndLightning(g, dt) {
  g.flags.lightT = (g.flags.lightT ?? rand(8, 20)) - dt;
  if (g.flags.lightT <= 0) {
    g.flags.lightT = rand(14, 32);
    g.custom('lightning', { d: rand(0.5, 2.5) });
  }
}
function lightningEvent(g, e) {
  g.flash(0.9, 0.18);
  setTimeout(() => g.flash(0.6, 0.12), 180);
  g.audio.play('thunder', { vol: 0.9, delay: e.d, reverb: 0.5 });
}

// ------------------------------------------------------------------ chapter 1
const CH1 = Object.assign({}, OUTDOOR_ENV, {
  id: 1, key: 'ch1', map: GROUNDS, spawnYaw: Math.PI / 2,
  legend: groundsLegend(1),
  warden: { enabled: false },
  extra(level) { buildGate(level, false); },
  start(g) {
    g.objective('o_reachGate');
    g.timer(1.2, () => g.subtitle('s_arrive', 6));
    g.timer(8, () => g.subtitle('s_carStop', 4));
    g.flags.stage = 0;
  },
  update(g, dt) { rainAndLightning(g, dt); },
  onTrigger(g, id) {
    if (id === 'road' && g.flags.stage === 0) { g.flags.stage = 1; g.objective('o_cutChain'); }
    if (id === 'wheel') { g.custom('wheel'); g.timer(0.6, () => g.subtitle('s_wheel', 4)); }
    if (id === 'bay' && g.flags.stage >= 3 && !g.flags.bayAmbush) {
      g.flags.bayAmbush = true;
      g.objective('o_ambulance');
      const h = g.level.markers.hspawn || [];
      const spot = h.find((p) => p.x > 45 && p.z < 25) || h[0];
      if (spot) g.timer(1.0, () => { const e = g.spawnEnemy('hollow', spot.x, spot.z, {}); if (e) { e.alert = 1.2; e.target = g.nearestPlayer(e.pos)?.p ? g.playerRef(g.nearestPlayer(e.pos).p) : null; e.setState('chase'); } g.stinger('sting_jump'); });
    }
  },
  onPickup(g, kind) {
    if (kind === 'boltcutters') {
      g.objective('o_useCutters');
      g.flags.stage = Math.max(g.flags.stage, 2);
      g.timer(1.5, () => { g.custom('lightning', { d: 0.3 }); g.sfx('door_slam', { x: 9.5, y: 1.2, z: 52.5 }, 1); g.setDoor('hutDoor', { open: false }); });
      g.timer(3.0, () => { g.sfx('bare_step', { x: 14, y: 0.2, z: 50 }, 1); g.sfx('bare_step', { x: 18, y: 0.2, z: 50 }, 1); g.sfx('hollow_idle_2', { x: 22, y: 1.5, z: 49 }, 1); g.subtitle('s_whatWasThat', 4); });
    }
    if (kind === 'note' && g.flags.stage === 0) { g.flags.stage = 1; g.objective('o_cutChain'); }
  },
  onUse(g, id, slot) {
    if (id === 'gate') {
      if (!g.team.boltcutters) { g.toastTo(slot, 'chained'); if (g.flags.stage < 1) { g.flags.stage = 1; g.objective('o_cutChain'); } return; }
      g.custom('gateOpen');
      g.flags.stage = 3;
      g.objective('o_findWayIn');
      return;
    }
    if (id === 'bay') {
      if (g.flags.stage >= 3) g.endChapter();
      else g.toastTo(slot, 'jammed');
    }
  },
  onEvent(g, e) {
    if (e.k === 'lightning') lightningEvent(g, e);
    if (e.k === 'gateOpen') {
      const G = g.level.gate;
      if (!G) return;
      G.target = 1; G.col.disabled = true; G.chain.visible = false;
      g.level.interactable('gate').enabled = false;
      g.audio.play('chain_cut', { pos: G.chain.position.clone().setY(1.2), vol: 1 });
      g.audio.play('gate', { pos: G.chain.position.clone().setY(1.5), vol: 1, delay: 0.6 });
    }
    if (e.k === 'wheel') {
      const w = g.level.entities.get('wheel');
      if (!w || w.moved) return;
      w.moved = true;
      if (w.col) w.col.disabled = true;
      const from = w.obj.position.clone();
      const to = from.clone().add(new THREE.Vector3(2.2, 0, 1.2));
      let t = 0;
      g.level.animated.push({ update: (dt) => { if (t >= 1) return; t = Math.min(1, t + dt / 3); w.obj.position.lerpVectors(from, to, t * t * (3 - 2 * t)); w.obj.rotation.y += dt * 0.15; } });
      g.audio.play('door_creak2', { pos: from.clone().setY(0.5), vol: 0.8, rate: 1.6 });
    }
  },
});

// ------------------------------------------------------------------ chapter 2
const CH2 = {
  id: 2, key: 'ch2', map: ADMISSIONS, env: 'indoor', reverb: 'hall', ambience: ['amb_indoor', 'drone'],
  themes: ['corridor', 'ward', 'office', 'storage', 'surgery'], defaultTheme: 0,
  fog: [0x050607, 0.075], ambient: [0x5d6670, 0x221d18, 1.8], lightsDefault: 'on', cageState: 'flicker', spawnYaw: 0,
  warden: { enabled: false, gap: [35, 70], presence: [45, 80] },
  legend: {
    a: { decal: 'smear', size: 2, rot: Math.PI / 2 },
    b: { prop: 'bed' }, c: { light: 'bulb', group: 'camp', state: 'on', intensity: 16 },
    d: { decal: 'writing', text: 'HE HEARS YOU', w: 2.6 },
    e: { item: 'battery' }, f: { prop: 'fusebox', use: 'fusebox', id: 'fusebox', useY: 1.45, useR: 0.7, hold: 1.5 },
    g: { item: 'pistol', id: 'pistol', y: 0.79 }, h: { spawn: 'hollow', dormant: true }, i: { item: 'bandage' }, j: { prop: 'chair' },
    k: { item: 'painkillers' }, l: { prop: 'body', decal: 'pool', size: 1.4 }, m: { marker: 'wardenA' }, n: { prop: 'bench' },
    o: { note: 'n_lounge' }, p: { prop: 'nightstand' }, q: { marker: 'wardenB' }, r: { prop: 'shelf' }, s: { prop: 'sink' },
    t: { note: 'n_camp', id: 'campNote' }, u: { prop: 'gurney' }, v: { prop: 'sleepbag' }, w: { prop: 'wheelchair' },
    y: { decal: 'writing', text: 'WE WERE NEVER PATIENTS', face: 'n', w: 3 },
    z: { item: 'ammo9', count: 8 },
    C: { prop: 'tv', id: 'tv' }, E: { door: true, id: 'stairs', locked: 'power', metal: true, sign: 'STAIRS' },
    H: { spawn: 'hollow', dormant: true, id: 'loungeH' }, I: { item: 'fuse', id: 'fuse2', y: 0.79 }, J: { item: 'fuse', id: 'fuse3', y: 0.79 },
    M: { item: 'medkit' }, N: { note: 'n_code', id: 'codeNote', y: 0.79 }, P: { item: 'painkillers' }, Q: { prop: 'desk' },
    R: { note: 'n_records' }, S: { door: true, id: 'secDoor', locked: 'code:1994', metal: true, sign: 'SECURITY' },
    U: { item: 'fuse', id: 'fuse1' }, Y: { trigger: 'nearStairs', r: 3 }, Z: { trigger: 'stairsEnd', r: 1.6 },
  },
  start(g) {
    g.objective('o_explore2');
    g.setPower('main', false);
    g.flags.fuses = 0;
    g.timer(2.5, () => g.sfx('bang_far', { x: 10, y: 2, z: 5 }, 0.8));
  },
  update(g, dt) {
    if (g.flags.powered && !g.flags.wardenScene) {
      g.flags.wardenScene = true;
    }
  },
  onTrigger(g, id) {
    if (id === 'stairsEnd' && g.flags.powered) g.endChapter();
  },
  onRead(g, note) {
    if (note === 'n_camp' && !g.flags.fuseObj) { g.flags.fuseObj = true; g.objective('o_fuses', g.team.fuse || 0, 3); }
  },
  onPickup(g, kind, id) {
    if (kind === 'fuse') {
      if (!g.flags.fuseObj) g.flags.fuseObj = true;
      const n = g.team.fuse || 0;
      if (n >= 3) g.objective('o_fusebox'); else g.objective('o_fuses', n, 3);
      if (id === 'fuse2') { const e = g.enemyById('loungeH'); if (e && e.state === 'dormant') g.timer(0.8, () => e.wake(null)); }
    }
  },
  onUse(g, id, slot) {
    if (id === 'fusebox') {
      if ((g.team.fuse || 0) < 3) { g.toastTo(slot, 'needItem', 'fuse', `${g.team.fuse || 0}/3`); return; }
      if (g.flags.powered) return;
      g.flags.powered = true;
      g.custom('powerOn');
      g.setDoor('stairs', { locked: null });
      g.timer(4.5, () => {
        // the Warden shows himself at the end of the main corridor
        const m = g.level.markers.wardenA?.[0];
        const w = g.warden;
        if (w && m) { w.appear(m.x, m.z); w.yaw = Math.PI / 2; g.subtitle('s_heComes', 4); g.objective('o_hide'); g.stinger('sting_low'); }
        g.custom('burst', { x: m?.x ?? 14, z: m?.z ?? 18 });
      });
      g.timer(7, () => {
        for (const [x, z] of [[12, 29], [40, 29], [10, 35]]) g.spawnEnemy('hollow', x + 0.5, z + 0.5, {});
      });
      g.timer(30, () => { g.objective('o_stairs'); g.wardenDirector({ enabled: true, gap: [40, 75], presence: [40, 70] }); });
    }
  },
  onEvent(g, e) {
    if (e.k === 'powerOn') {
      g.audio.play('power_on', { vol: 1 });
      g.subtitle('s_lightsOn', 4, true);
      // lights stutter on one after another
      const fx = g.lights.fixtures.filter((f) => f.group === 'main');
      fx.forEach((f) => { f.power = false; });
      fx.sort((a, b) => a.pos.x - b.pos.x);
      fx.forEach((f, i) => setTimeout(() => { f.power = true; if (Math.random() < 0.3) f.state = 'flicker'; g.audio.play('switch', { pos: f.pos, vol: 0.5 }); }, 300 + i * 90));
      g.lights.setGroup('emergency', false);
      const tv = g.level.entities.get('tv');
      if (tv) g.audio.play('static', { pos: tv.obj.position.clone().setY(0.4), vol: 0.6, loop: true, ref: 1.5 });
    }
    if (e.k === 'burst') {
      // the lights nearest the Warden pop
      for (const f of g.lights.fixtures) {
        if (f.group === 'main' && Math.hypot(f.pos.x - e.x, f.pos.z - e.z) < 9) { f.state = 'dying'; g.audio.play('glass', { pos: f.pos, vol: 0.6 }); }
      }
    }
  },
};

// ------------------------------------------------------------------ chapter 3
const CH3 = {
  id: 3, key: 'ch3', map: WARD9, env: 'indoor', reverb: 'hall', ambience: ['amb_indoor', 'drone'],
  themes: ['corridor', 'padded', 'office', 'storage', 'surgery'], defaultTheme: 0,
  fog: [0x050506, 0.08], ambient: [0x5a616a, 0x1e1a16, 1.7], lightsDefault: 'dying', cageState: 'flicker', spawnYaw: -Math.PI / 2,
  warden: { enabled: true, gap: [30, 55], presence: [55, 95], first: 45 },
  legend: {
    a: { item: 'ammo9', count: 8 }, b: { prop: 'bed' }, c: { door: true, id: 'cell94' }, d: { decal: 'writing', text: 'HE KEEPS THE OTHERS IN LINE', w: 3.2 },
    e: { note: 'n_hale', id: 'haleDiary', y: 0.79 }, g: { prop: 'gurney', spawn: 'hollow', dormant: true, scriptOnly: true, dz: 1.0, tag: 'theatre' },
    h: { spawn: 'hollow', dormant: true }, i: { item: 'battery' }, k: { prop: 'nightstand', item: 'key', id: 'elevKey' },
    l: { door: true, locked: 'jammed' }, m: { prop: 'body', decal: 'pool', size: 1.8, id: 'mara' }, n: { prop: 'bench' }, p: { prop: 'bed' },
    r: { prop: 'shelf' }, s: { prop: 'sink' }, t: { note: 'n_mara', tape: true, id: 'maraTape' }, u: { prop: 'gurney' }, v: { item: 'medkit' },
    w: { prop: 'wheelchair' }, y: { decal: 'pool', size: 2.4 },
    C: { prop: 'cabinet', item: 'rifle', id: 'rifle' }, G: { item: 'ammo762', count: 5 }, H: { spawn: 'hollow' }, I: { item: 'keycard', id: 'keycard' },
    K: { door: true, id: 'haleDoor', locked: 'item:keycard', sign: 'DR. E. HALE' }, N: { note: 'n_surgery' }, P: { item: 'painkillers' },
    Q: { prop: 'desk' }, S: { prop: 'surglamp' }, U: { prop: 'optable' }, V: { door: true, id: 'elevDoor', locked: 'item:key', metal: true, sign: 'LIFT' },
    Z: { trigger: 'elevator', r: 1.8 },
  },
  start(g) {
    g.objective('o_findMara');
    g.timer(3, () => g.sfx('whisper', { x: 20, y: 1.6, z: 16 }, 0.9));
  },
  onRead(g, note) {
    if (note === 'n_mara' && !g.flags.heardMara) { g.flags.heardMara = true; g.objective('o_keycard'); }
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

// ------------------------------------------------------------------ chapter 4
const CH4 = {
  id: 4, key: 'ch4', map: BASEMENT, env: 'indoor', reverb: 'basement', ambience: ['amb_basement', 'drone'],
  themes: ['basement', 'storage', 'morgue', 'surgery'], defaultTheme: 0,
  fog: [0x040505, 0.09], ambient: [0x4c545a, 0x18150f, 1.5], lightsDefault: 'on', cageGroup: 'gen', cageState: 'on', spawnYaw: Math.PI / 2,
  warden: { enabled: true, gap: [30, 60], presence: [45, 80], first: 70 },
  legend: {
    b: { prop: 'bodybed' }, e: { note: 'n_lab', tape: true, y: 0.79 }, h: { spawn: 'hollow', dormant: true, crawler: true }, i: { item: 'battery' },
    k: { item: 'ammo9', count: 8 }, o: { item: 'medkit' }, r: { prop: 'rack' }, u: { prop: 'gurney' }, w: { prop: 'wheelchair' },
    y: { decal: 'writing', text: 'HE NEVER SLEEPS', w: 2.6 },
    G: { prop: 'generator', use: 'generator', id: 'generator', hold: 2.5, useY: 0.6 }, H: { spawn: 'hollow', dormant: true, scriptOnly: true, tag: 'morgue' },
    J: { item: 'fuel', id: 'fuel' }, K: { door: true, id: 'labDoor', locked: 'power', metal: true, sign: 'LAB' },
    M: { prop: 'morgue', id: 'morgueWall' }, N: { note: 'n_gen' }, P: { item: 'painkillers' }, Q: { prop: 'desk' },
    X: { use: 'ladder', id: 'ladder', useY: 1.4, prompt: 'use' }, Y: { trigger: 'flood', r: 2 }, Z: { trigger: 'nearExit', r: 3 },
  },
  extra(level) {
    // service ladder on the west wall
    const x = level.entities.get('ladder');
    if (!x) return;
    const A = level.assets;
    const steel = A.mat('rusty_metal_02', { metal: true, color: 0x7a6a60, env: 0.4 });
    const g = new THREE.Group();
    for (const s of [-0.22, 0.22]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.0, 0.04), steel); r.position.set(0, 1.5, s); g.add(r); }
    for (let i = 0; i < 10; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.44, 6), steel); r.rotation.x = Math.PI / 2; r.position.set(0, 0.3 + i * 0.28, 0); g.add(r); }
    g.position.set(x.x + 0.1, 0, x.z + 0.5);
    level.root.add(g);
  },
  start(g) {
    g.objective('o_fuel');
    g.setPower('gen', false);
    g.timer(2, () => g.sfx('drip', { x: 30, y: 2.8, z: 14 }, 0.8));
  },
  update(g, dt) {
    g.flags.dripT = (g.flags.dripT ?? 3) - dt;
    if (g.flags.dripT <= 0) { g.flags.dripT = rand(1.5, 4); const p = g.randomPlayer(); if (p) g.sfx('drip', { x: p.pos.x + rand(-6, 6), y: 2.9, z: p.pos.z + rand(-6, 6) }, 0.5); }
  },
  onPickup(g, kind) {
    if (kind === 'fuel') {
      g.objective('o_generator');
      g.custom('drawers');
      g.timer(0.8, () => { for (const e of g.enemies) if (e.tag === 'morgue' && e.state === 'dormant') e.wake(null); });
      g.timer(1.4, () => { for (const [x, z] of [[30, 14], [38, 14]]) { const e = g.spawnEnemy('hollow', x + 0.5, z + 0.5, { crawler: true }); if (e) e.setState('investigate'), (e.investigate = new THREE.Vector3(34, 0, 16)); } });
      g.stinger('sting_jump');
    }
  },
  onUse(g, id, slot) {
    if (id === 'generator') {
      if (!g.team.fuel) { g.toastTo(slot, 'needItem', 'fuel'); return; }
      if (g.flags.gen) return;
      g.flags.gen = true;
      g.custom('genStart');
      g.setPower('gen', true);
      g.setDoor('labDoor', { locked: null });
      g.objective('o_tunnel');
      g.makeNoise(new THREE.Vector3(49.5, 0, 26.5), 40, 'machine');
    }
    if (id === 'ladder') g.endChapter();
  },
  onTrigger(g, id) {
    if (id === 'flood' && g.flags.gen && !g.flags.floodScare) {
      g.flags.floodScare = true;
      const w = g.warden;
      if (w && w.state === 'absent') { w.appear(39.5, 21.5); g.stinger('sting_low'); }
    }
  },
  onEvent(g, e) {
    if (e.k === 'drawers') {
      const m = g.level.entities.get('morgueWall');
      if (m?.obj?.userData.doors) {
        m.obj.userData.doors.forEach((d, i) => { if (i % 3 !== 1) setTimeout(() => { d.rotation.y = -1.4 - Math.random() * 0.3; g.audio.play('locker', { pos: m.obj.position.clone().setY(1), vol: 0.7, rate: 0.8 }); }, 200 + i * 160); });
      }
    }
    if (e.k === 'genStart') {
      g.audio.play('generator', { pos: new THREE.Vector3(49.5, 0.5, 26.5), vol: 0.9, loop: true, ref: 3 });
      g.subtitle('s_genStart', 4, true);
      g.lights.setGroup('emergency', false);
    }
  },
};

// ------------------------------------------------------------------ chapter 5
const CH5 = Object.assign({}, OUTDOOR_ENV, {
  id: 5, key: 'ch5', map: GROUNDS, spawnMarker: 'p5', spawnYaw: Math.PI / 2,
  legend: groundsLegend(5),
  warden: { enabled: true, gap: [18, 35], presence: [40, 70], first: 40 },
  extra(level) { buildGate(level, true); },
  start(g) {
    g.objective('o_radio');
    g.flags.count = -1;
    g.custom('jonah');
    g.timer(1.5, () => g.subtitle('s_jonah1', 6));
    g.timer(8, () => g.subtitle('s_jonah2', 7));
  },
  update(g, dt) {
    rainAndLightning(g, dt);
    if (g.flags.count > 0) {
      g.flags.count -= dt;
      g.flags.waveT = (g.flags.waveT ?? 6) - dt;
      if (g.flags.waveT <= 0) {
        g.flags.waveT = rand(14, 22);
        const H = g.level.markers.hspawn || [];
        const alive = g.enemies.filter((e) => e.kind === 'hollow' && e.isAlive()).length;
        const n = Math.min(3, 8 - alive);
        for (let i = 0; i < n; i++) {
          const m = pick(H);
          const e = g.spawnEnemy('hollow', m.x + rand(-1, 1), m.z + rand(-1, 1), { crawler: Math.random() < 0.25 });
          const p = g.randomPlayer();
          if (e && p) { e.investigate = p.pos.clone(); e.setState('investigate'); }
        }
      }
      if (Math.floor(g.flags.count) !== g.flags.lastShown) { g.flags.lastShown = Math.floor(g.flags.count); g.objective('o_survive', null, null, Math.max(0, g.flags.count)); }
      if (g.flags.count <= 0) {
        g.flags.count = 0;
        g.custom('rescue');
        g.objective('o_gate');
        g.flags.rescued = true;
      }
    }
  },
  onUse(g, id, slot) {
    if (id === 'radio' && g.flags.count < 0) {
      g.flags.count = 180;
      g.custom('radio');
      g.wardenDirector({ enabled: true, gap: [12, 25], presence: [50, 90] });
    }
  },
  onTrigger(g, id) {
    if (id === 'road' && g.flags.rescued) g.endGame();
  },
  onEvent(g, e) {
    if (e.k === 'lightning') lightningEvent(g, e);
    if (e.k === 'jonah') g.spawnJonah();
    if (e.k === 'radio') {
      const r = g.level.entities.get('radio');
      const p = r ? r.obj.position.clone().setY(1.1) : null;
      g.audio.play('static', { pos: p, vol: 0.8 });
      g.audio.play('radio_voice', { pos: p, vol: 1, delay: 1.2 });
      g.subtitle('s_rescue', 6, true);
      setTimeout(() => g.subtitle('s_jonah3', 4, true), 7000);
      setTimeout(() => g.jonahTurn && g.jonahTurn(), 9000);
    }
    if (e.k === 'rescue') g.spawnRescue();
  },
});

export const CHAPTERS = [CH1, CH2, CH3, CH4, CH5];

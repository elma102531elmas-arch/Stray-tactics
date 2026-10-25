// A playable level: grid + geometry + doors + lights + props + items + interactables + atmosphere.
import * as THREE from '../../lib/three.module.js';
import { Grid, T, OUTDOOR } from './grid.js';
import { LevelBuilder, makeSky } from './builder.js';
import { Door } from './doors.js';
import { PRESETS, makePropMesh, makeItemMesh, propCollider } from './props.js';
import { THEMES } from './themes.js';
import { makeBloodWriting, makeLabelTexture, DECAL, makeSoftDot } from '../engine/textures.js';
import { mulberry32, pick } from '../util.js';

const CLUTTER = {
  corridor: ['wheelchair', 'chair', 'sign', 'bag', 'box', 'papers', 'plasticchair', 'crutches', 'trashcan'],
  ward: ['chair', 'papers', 'nightstand', 'crutches', 'box', 'bloodbucket', 'suitcase'],
  office: ['chair', 'papers', 'box', 'box', 'drawers', 'suitcase'],
  surgery: ['stool2', 'bloodbucket', 'papers', 'gurney'],
  basement: ['barrel', 'crate', 'milcrate', 'propane', 'box', 'tyre', 'handtruck'],
  storage: ['crate', 'box', 'barrel', 'toolchest', 'propane', 'handtruck'],
  chapel: ['bench', 'papers', 'chair'],
  hut: ['box', 'crate', 'propane', 'tyre'],
  morgue: ['gurney', 'stool2', 'bloodbucket'],
  outdoor: ['tyre', 'barrel', 'log', 'bag'],
};

let glintTex = null;

export class Level {
  constructor(game, def, seed = 1) {
    this.game = game;
    this.def = def;
    this.seed = seed;
    this.assets = game.assets;
    this.rng = mulberry32(seed);
    this.root = new THREE.Group();
    this.root.name = 'level';
    this.doorAxis = new Map();
    this.fenceCells = [];
    this.treeCells = [];
    this.interactables = [];
    this.entities = new Map();
    this.markers = {};
    this.playerSpawns = [];
    this.triggers = [];
    this.glints = [];
    this.animated = [];
    this.lockers = [];
  }

  build() {
    const def = this.def;
    this.grid = new Grid(def);
    const g = this.grid;
    this.builder = new LevelBuilder(this, this.assets);
    this.root.add(this.builder.build());
    this.lights = this.game.lights;
    this.lights.clear();
    // walk all marks
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) {
      const i = g.idx(x, z);
      const t = g.type[i];
      const mk = g.mark[i];
      if (t === T.DOOR) this.placeDoor(x, z, mk && def.legend?.[mk] ? def.legend[mk] : { open: mk === 'O' });
      if (!mk || mk === 'O') continue;
      if (mk === '*') this.addCeilingLight(x, z, 'fluoro', { group: 'main', state: def.lightsDefault || 'on' });
      else if (mk === '+') this.addCeilingLight(x, z, 'fluoro', { state: 'off', group: 'dead' });
      else if (mk === '^') this.addCeilingLight(x, z, 'cage', { group: def.cageGroup || 'main', state: def.cageState || 'on' });
      else if (mk === '!') this.addWallLight(x, z, 'emergency', {});
      else if (mk === 'L') this.placeProp('locker', x, z, { hide: true });
      else if (mk === 'x') this.placeClutter(x, z);
      else if (mk === '%') this.placeProp(pick(['box', 'crate', 'papers']), x, z, {});
      else if (mk === '@') this.playerSpawns.push(new THREE.Vector3(x + 0.5, 0, z + 0.5));
      else if (def.legend?.[mk] && t !== T.DOOR) this.placeEntity(def.legend[mk], x, z);
    }
    if (!this.playerSpawns.length) this.playerSpawns.push(new THREE.Vector3(2.5, 0, 2.5));
    this.scatterOldBlood();
    if (def.extra) def.extra(this);
    this.setupAtmosphere();
    this.root.updateMatrixWorld(true);
    this.buildCullList();
    return this;
  }

  // Objects beyond the fog are invisible anyway; hide them so phones draw less.
  buildCullList() {
    const fogD = (this.def.fog || [0, 0.08])[1];
    this.cullDist = 2.1 / fogD;
    this.cull = [];
    const box = new THREE.Box3(), sph = new THREE.Sphere();
    const add = (o) => {
      box.setFromObject(o);
      if (box.isEmpty()) return;
      box.getBoundingSphere(sph);
      this.cull.push({ o, c: sph.center.clone(), r: sph.radius });
    };
    for (const o of this.root.children) {
      if (o.name === 'levelGeometry') {
        for (const m of o.children) {
          if (m.isMesh && !m.isInstancedMesh) add(m);
          // tree tiles go sooner: a trunk 36 m out is 94% fog already, and the trees are most of what the woods draw
          else if (m.userData.cullTile && m.boundingSphere) this.cull.push({ o: m, c: m.boundingSphere.center.clone(), r: m.boundingSphere.radius, k: 0.79 });
        }
        continue;
      }
      if (o.isSprite || o.isLight || o === this.sky) continue;
      add(o);
    }
    this.cullT = 0;
  }

  updateCull(camPos) {
    const d2 = this.cullDist;
    for (const c of this.cull) {
      if (c.o.userData.hidden) { c.o.visible = false; continue; }
      c.o.visible = c.c.distanceTo(camPos) - c.r < d2 * (c.k ?? 1);
    }
  }

  themeName(x, z) {
    const idx = this.grid.theme[this.grid.idx(x, z)];
    return (this.def.themes || ['corridor'])[idx] || 'corridor';
  }

  // ---------- placement helpers ----------
  wallDir(x, z) {
    // direction to a neighbouring wall (prefer the one with most wall cells behind it)
    const g = this.grid;
    const opts = [];
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const t = g.get(x + dx, z + dz);
      if (t === T.WALL || t === T.EXT || t === T.WINDOW) opts.push([dx, dz]);
    }
    if (!opts.length) return null;
    return opts[Math.floor(this.rng() * opts.length)];
  }

  placeDoor(x, z, d) {
    const axis = this.doorAxis.get(this.grid.idx(x, z)) || 'x';
    const signTex = d.sign ? makeLabelTexture([d.sign], 512, 160, { size: 72 }) : null;
    const door = new Door(this, x, z, axis, { id: d.id, locked: d.locked, lockMsg: d.lockMsg, open: d.open, metal: d.metal, window: d.window, sign: signTex, tint: d.tint, double: d.double });
    this.grid.doors.set(this.grid.idx(x, z), door);
    this.entities.set(door.id, door);
    this.animated.push(door);
    if (!d.noInteract) {
      this.addInteractable({
        id: door.id, kind: 'door', door,
        pos: () => door.center(), radius: 0.7,
        prompt: () => (door.locked ? 'locked' : door.open ? 'close' : 'open'),
      });
    }
    return door;
  }

  addCeilingLight(x, z, kind, opts) {
    const th = THEMES[this.themeName(x, z)] || THEMES.corridor;
    const h = this.grid.isOutdoor(x, z) ? 3.5 : th.h;
    return this.lights.add(kind, x + 0.5, h - 0.005, z + 0.5, opts, this.root);
  }

  addWallLight(x, z, kind, opts) {
    const d = this.wallDir(x, z) || [0, -1];
    const px = x + 0.5 + d[0] * 0.48, pz = z + 0.5 + d[1] * 0.48;
    const rot = Math.atan2(-d[0], -d[1]);
    return this.lights.add(kind, px, opts.y ?? 2.4, pz, Object.assign({ rotY: rot }, opts), this.root);
  }

  placeProp(name, x, z, opts = {}) {
    const p = PRESETS[name];
    if (!p) return null;
    const obj = makePropMesh(this.assets, name, Math.floor(this.rng() * 1000));
    if (!obj) return null;
    let px = x + 0.5, pz = z + 0.5, rot = 0;
    let wd = null;
    if (opts.face) {
      wd = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[opts.face];
    } else if (p.wall || p.mount) wd = this.wallDir(x, z);
    if (p.mount) {
      wd = wd || [0, -1];
      rot = Math.atan2(-wd[0], -wd[1]);
      px += wd[0] * 0.5; pz += wd[1] * 0.5;
      obj.position.set(px, opts.y ?? p.mount, pz);
      obj.rotation.y = rot;
    } else if (p.ceiling) {
      const th = THEMES[this.themeName(x, z)] || THEMES.corridor;
      obj.position.set(px, th.h, pz);
    } else {
      if (wd) {
        rot = Math.atan2(-wd[0], -wd[1]);
        // push against wall using model depth
        obj.rotation.y = rot;
        obj.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(obj, true);
        const depth = Math.abs(wd[0]) ? (b.max.x - b.min.x) : (b.max.z - b.min.z);
        const off = 0.5 - depth / 2 - 0.02;
        px += wd[0] * off; pz += wd[1] * off;
        rot += (this.rng() - 0.5) * 0.06;
      } else if (p.free) rot = this.rng() * Math.PI * 2;
      if (opts.rot !== undefined) rot = opts.rot;
      obj.position.set(px + (opts.dx || 0), opts.y || 0, pz + (opts.dz || 0));
      obj.rotation.y = rot;
    }
    if (opts.scale) obj.scale.setScalar(opts.scale);
    this.root.add(obj);
    obj.updateMatrixWorld(true);
    let col = null;
    if (p.col && !opts.noCol) {
      col = propCollider(obj, 0.0);
      if (col) { col.prop = name; this.grid.addCollider(col); }
    }
    const ent = { obj, name, x, z, col, pos: obj.position.clone(), wallDir: wd };
    if (opts.id) this.entities.set(opts.id, ent);
    if (opts.hide || name === 'locker') this.setupLocker(ent, opts);
    return ent;
  }

  placeClutter(x, z) {
    const th = this.grid.isOutdoor(x, z) ? 'outdoor' : this.themeName(x, z);
    const list = CLUTTER[th] || CLUTTER.corridor;
    return this.placeProp(pick(list), x, z, {});
  }

  setupLocker(ent, opts) {
    const door = ent.obj.userData.door;
    const wd = ent.wallDir || [0, -1];
    const front = new THREE.Vector3(-wd[0], 0, -wd[1]);
    ent.locker = { door, open: 0, target: 0, front, occupant: null };
    this.lockers.push(ent);
    this.animated.push({ update: (dt) => { const L = ent.locker; L.open += (L.target - L.open) * Math.min(1, dt * 10); door.rotation.y = -L.open * 1.6; } });
    this.addInteractable({
      id: opts.id || `locker_${ent.x}_${ent.z}`, kind: 'locker', locker: ent,
      pos: () => ent.obj.position.clone().add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(front, 0.3), radius: 0.6,
      prompt: () => 'hide',
    });
  }

  placeEntity(d, x, z) {
    let ent = null;
    if (d.prop) ent = this.placeProp(d.prop, x, z, d);
    if (d.item) ent = this.placeItem(d.item, x, z, d);
    if (d.note) ent = this.placeNote(d, x, z);
    if (d.light) {
      const f = d.light === 'emergency' || d.light === 'wall' ? this.addWallLight(x, z, d.light, d) : (d.light === 'street' ? this.lights.add('street', x + 0.5, 0, z + 0.5, d, this.root) : this.addCeilingLight(x, z, d.light, d));
      if (d.id) this.entities.set(d.id, f);
    }
    if (d.spawn) {
      (this.markers['spawn:' + d.spawn] ||= []).push({ x: x + 0.5, z: z + 0.5, def: d });
    }
    if (d.marker) (this.markers[d.marker] ||= []).push({ x: x + 0.5, z: z + 0.5, def: d });
    if (d.trigger) this.triggers.push({ id: d.trigger, x: x + 0.5, z: z + 0.5, r: d.r || 1.5, once: d.once !== false, fired: false });
    if (d.decal) this.placeDecal(d, x, z);
    if (d.use) {
      const base = ent?.obj ? ent.obj.position.clone() : new THREE.Vector3(x + 0.5, 0, z + 0.5);
      // useFront: step out from a wall-placed prop into the room; useDx/useDz: a fixed offset (a panel on one side)
      if (d.useFront && ent?.wallDir) { base.x -= ent.wallDir[0] * d.useFront; base.z -= ent.wallDir[1] * d.useFront; }
      base.x += d.useDx || 0; base.z += d.useDz || 0;
      this.addInteractable({
        id: d.id || d.use, kind: 'use', use: d.use,
        // useY is the height above the floor (it used to be added on top of a wall mount: fuse box at 2.9 m)
        pos: () => new THREE.Vector3(base.x, d.useY ?? base.y + 1.2, base.z), radius: d.useR || 0.8,
        prompt: () => d.prompt || 'use', hold: d.hold || 0,
      });
      if (d.id && !this.entities.has(d.id)) this.entities.set(d.id, { pos: base, x, z, obj: ent?.obj });
    }
    if (d.player) this.playerSpawns.push(new THREE.Vector3(x + 0.5, 0, z + 0.5));
    return ent;
  }

  surfaceHeight(x, z) {
    // place items on top of whatever prop is in this cell
    let y = 0;
    const b = this.grid.colBuckets.get(Math.floor(x) + ',' + Math.floor(z));
    if (b) for (const c of b) if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && c.maxY < 1.3) y = Math.max(y, c.maxY);
    return y;
  }

  placeItem(kind, x, z, d) {
    const mesh = makeItemMesh(this.assets, kind);
    const px = x + 0.5 + (d.dx || 0), pz = z + 0.5 + (d.dz || 0);
    const y = d.y ?? this.surfaceHeight(px, pz);
    mesh.position.set(px, y, pz);
    mesh.rotation.y = d.rot ?? this.rng() * Math.PI * 2;
    this.root.add(mesh);
    const id = d.id || `item_${kind}_${x}_${z}`;
    const ent = { obj: mesh, kind, id, item: kind, count: d.count, pos: mesh.position.clone() };
    this.entities.set(id, ent);
    this.addGlint(mesh, ent);
    this.addInteractable({
      id, kind: 'item', item: kind, count: d.count, ent,
      pos: () => mesh.position.clone().add(new THREE.Vector3(0, 0.08, 0)), radius: 0.45,
      prompt: () => 'take', hold: d.hold || 0,
    });
    return ent;
  }

  placeNote(d, x, z) {
    const mesh = makeItemMesh(this.assets, d.tape ? 'tape' : 'note');
    // noteDx/noteDz/noteY place a note on its own when it shares a cell with a prop (dx/dz/y move the prop too)
    const px = x + 0.5 + (d.noteDx ?? d.dx ?? 0), pz = z + 0.5 + (d.noteDz ?? d.dz ?? 0);
    mesh.position.set(px, d.noteY ?? d.y ?? this.surfaceHeight(px, pz), pz);
    mesh.rotation.y = this.rng() * Math.PI * 2;
    this.root.add(mesh);
    const id = d.id || 'note_' + d.note;
    const ent = { obj: mesh, id, note: d.note, tape: !!d.tape, pos: mesh.position.clone() };
    this.entities.set(id, ent);
    this.addGlint(mesh, ent);
    this.addInteractable({
      id, kind: d.tape ? 'tape' : 'note', note: d.note, ent,
      pos: () => mesh.position.clone().add(new THREE.Vector3(0, 0.05, 0)), radius: 0.45,
      prompt: () => (d.tape ? 'listen' : 'read'),
    });
    return ent;
  }

  addGlint(mesh, ent) {
    if (!glintTex) glintTex = makeSoftDot(64);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, color: 0xfff1d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(0.12);
    s.position.copy(mesh.position).add(new THREE.Vector3(0, 0.06, 0));
    this.root.add(s);
    const gl = { s, ent, phase: this.rng() * 6 };
    ent.glint = gl;
    this.glints.push(gl);
  }

  placeDecal(d, x, z) {
    const fx = this.game.fx;
    if (d.decal === 'writing') {
      let wd = d.face ? { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[d.face] : this.wallDir(x, z);
      let dist = 0.495;
      if (!wd) {
        // no wall right here: write on the nearest wall within three cells (straight line, open floor between)
        const solid = (t) => t === T.WALL || t === T.EXT;
        for (let k = 2; k <= 3 && !wd; k++) for (const dir of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          let open = true;
          for (let s = 1; s < k; s++) if (solid(this.grid.get(x + dir[0] * s, z + dir[1] * s))) open = false;
          if (open && solid(this.grid.get(x + dir[0] * k, z + dir[1] * k))) { wd = dir; dist = k - 0.505; break; }
        }
      }
      const w = d.w || 2.4, h = w / 4;
      const tex = makeBloodWriting(d.text, 1024, 256, Math.floor(this.rng() * 1000));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2 }));
      if (wd) {
        m.position.set(x + 0.5 + wd[0] * dist, d.y || 1.65, z + 0.5 + wd[1] * dist);
        m.rotation.y = Math.atan2(-wd[0], -wd[1]);
      } else {
        // nothing to write on: it is scrawled across the floor
        m.position.set(x + 0.5, 0.015, z + 0.5);
        m.rotation.set(-Math.PI / 2, 0, this.rng() * 0.6 - 0.3);
      }
      m.renderOrder = 3;
      this.root.add(m);
      return;
    }
    const p = new THREE.Vector3(x + 0.5 + (d.dx || 0), 0, z + 0.5 + (d.dz || 0));
    const up = new THREE.Vector3(0, 1, 0);
    if (d.decal === 'pool') fx.wet.add(p, up, d.size || 1.6, pick(DECAL.pool), this.rng() * 6.28, 1, 0.0035);
    else if (d.decal === 'smear') fx.wet.add(p, up, d.size || 1.6, pick(DECAL.smear), d.rot ?? this.rng() * 6.28, 1, 0.003);
    else if (d.decal === 'splat') fx.wet.add(p, up, d.size || 0.9, pick(DECAL.splat), this.rng() * 6.28, 1, 0.003);
    else if (d.decal === 'hand' || d.decal === 'drip') {
      const wd = this.wallDir(x, z) || [0, -1];
      const wp = new THREE.Vector3(x + 0.5 + wd[0] * 0.5, d.y || 1.3, z + 0.5 + wd[1] * 0.5);
      fx.wet.add(wp, new THREE.Vector3(-wd[0], 0, -wd[1]), d.size || 0.6, pick(d.decal === 'hand' ? DECAL.hand : DECAL.drip), d.decal === 'drip' ? Math.PI : this.rng() * 0.8 - 0.4, 1, 0.003);
    }
  }

  scatterOldBlood() {
    const g = this.grid, fx = this.game.fx;
    const amount = this.def.oldBlood ?? 1;
    if (!amount) return;
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) {
      const t = g.get(x, z);
      if (t !== T.FLOOR) continue;
      const r = this.rng();
      if (r < 0.018 * amount) fx.old.add(new THREE.Vector3(x + this.rng(), 0, z + this.rng()), new THREE.Vector3(0, 1, 0), 0.5 + this.rng() * 0.9, pick([...DECAL.splat, ...DECAL.smear, ...DECAL.pool]), this.rng() * 6.28, 1, 0.003);
      else if (r < 0.03 * amount) {
        const wd = this.wallDir(x, z);
        if (wd) fx.old.add(new THREE.Vector3(x + 0.5 + wd[0] * 0.5, 0.6 + this.rng() * 1.2, z + 0.5 + wd[1] * 0.5), new THREE.Vector3(-wd[0], 0, -wd[1]), 0.4 + this.rng() * 0.4, pick([...DECAL.hand, ...DECAL.drip, ...DECAL.splat]), Math.PI + (this.rng() - 0.5) * 0.6, 1, 0.003);
      }
    }
  }

  setupAtmosphere() {
    const def = this.def;
    const scene = this.game.scene;
    const fog = def.fog || [0x07080a, 0.085];
    scene.fog = new THREE.FogExp2(fog[0], fog[1]);
    this.game.renderer.gl.setClearColor(fog[0]);
    const amb = def.ambient || [0x6a7684, 0x2a241e, 1.0];
    this.hemi = new THREE.HemisphereLight(amb[0], amb[1], amb[2]);
    this.hemi.layers.enableAll();
    this.root.add(this.hemi);
    if (def.env === 'outdoor') {
      this.sky = makeSky();
      this.root.add(this.sky);
      this.moon = new THREE.DirectionalLight(0x8fa3c8, def.moon ?? 0.35);
      this.moon.position.set(-40, 50, -80);
      this.moon.layers.enableAll();
      this.root.add(this.moon);
    }
  }

  // ---------- interaction queries ----------
  addInteractable(o) {
    o.enabled = o.enabled !== false;
    this.interactables.push(o);
    return o;
  }
  removeInteractable(id) {
    const i = this.interactables.findIndex((o) => o.id === id);
    if (i >= 0) this.interactables.splice(i, 1);
  }
  interactable(id) { return this.interactables.find((o) => o.id === id); }

  findInteractable(origin, dir, maxDist = 2.3) {
    let best = null, bestScore = Infinity;
    const tmp = new THREE.Vector3();
    for (const o of this.interactables) {
      if (!o.enabled) continue;
      const p = o.pos();
      tmp.copy(p).sub(origin);
      const d = tmp.length();
      if (d > maxDist + o.radius) continue;
      const along = tmp.dot(dir);
      if (along < 0.1) continue;
      const perp = Math.sqrt(Math.max(0, d * d - along * along));
      const allow = o.radius + along * 0.12;
      if (perp > allow) continue;
      const score = perp / allow + d * 0.15;
      if (score < bestScore) {
        // line of sight to the object (doors can be targeted through their own cell)
        if (o.kind !== 'door' && !this.grid.lineOfSight(origin.x, origin.y, origin.z, p.x, p.y, p.z)) continue;
        best = o; bestScore = score;
      }
    }
    return best;
  }

  surfaceAt(x, z) {
    const g = this.grid;
    const cx = Math.floor(x), cz = Math.floor(z);
    const t = g.get(cx, cz);
    if (t === T.WATER) return 'water';
    if (t === T.ROAD || t === T.PATH) return 'concrete';
    if (t === T.GROUND || t === T.TREE) return 'mud';
    if (t === T.GRASS) return 'grass';
    const th = THEMES[this.themeName(cx, cz)];
    return th ? th.surface : 'tile';
  }

  isOutdoorAt(x, z) { return this.grid.isOutdoor(Math.floor(x), Math.floor(z)); }
  ceilAt(x, z) {
    if (this.isOutdoorAt(x, z)) return 99;
    const th = THEMES[this.themeName(Math.floor(x), Math.floor(z))];
    return th ? th.h : 3.2;
  }

  update(dt, t, camPos, camDir) {
    for (const a of this.animated) a.update(dt, t);
    this.cullT -= dt;
    if (this.cullT <= 0 && this.cull) { this.cullT = 0.2; this.updateCull(camPos); }
    // item glints visible when near and roughly in view
    for (const gl of this.glints) {
      if (!gl.ent.obj.visible || gl.ent.taken) { gl.s.visible = false; continue; }
      const d = gl.s.position.distanceTo(camPos);
      const v = d < 9 ? (1 - d / 9) : 0;
      gl.s.visible = v > 0;
      gl.s.material.opacity = v * (0.35 + 0.35 * Math.sin(t * 3 + gl.phase));
    }
    if (this.sky) { this.sky.position.copy(camPos); this.sky.material.uniforms.uTime.value = t; }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry && !o.geometry.userData?.shared) {
        // keep geometry shared with cached models; only dispose our generated buffers
        if (o.parent?.name === 'levelGeometry') o.geometry.dispose();
      }
    });
    this.root.parent?.remove(this.root);
  }
}

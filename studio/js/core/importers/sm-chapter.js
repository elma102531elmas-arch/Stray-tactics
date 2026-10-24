// Importer: converts one original Saint Marrow chapter (ASCII grid + legend + atmosphere) into editor nodes.
//
// The original runtime is only READ: we import its Grid/THEMES/PRESETS modules to parse the map exactly the
// way the game does. Coordinates are preserved (1 grid cell = 1 m, cell (x,z) spans [x,x+1]×[z,z+1]) and legend
// identities (door ids, entity ids) are kept in node names / meta.source.
//
// Anything that cannot be imported faithfully is NOT silently replaced: it is counted in the returned report
// (and, where a stand-in is needed to keep the map walkable, the stand-in is tagged `proxy`).

import { makeNode, ROOT_ID } from '../scene.js';
import { deepClone } from '../util.js';
import { builtinModelId, builtinTexId, builtinMeta } from '../builtin.js';
import { defaultMaterial } from '../materials.js';
import { HOLLOW_REFERENCE, WARDEN_REFERENCE, CLUTTER_BY_THEME, PROCEDURAL_PROP_DIMS } from '../game-constants.js';
import { addNode } from '../commands.js';

const D2R = 180 / Math.PI;
const FACE = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

/** Dynamically load the original game's modules (read-only). baseUrl points at the saint-marrow folder. */
export async function loadGameModules(baseUrl) {
  const imp = (p) => import(/* @vite-ignore */ `${baseUrl}/js/${p}`);
  try {
    const [chapters, grid, themes, props] = await Promise.all([imp('chapters/chapters.js'), imp('world/grid.js'), imp('world/themes.js'), imp('world/props.js')]);
    return { CHAPTERS: chapters.CHAPTERS, Grid: grid.Grid, T: grid.T, THEMES: themes.THEMES, PRESETS: props.PRESETS, ITEMS: props.ITEMS };
  } catch (e) {
    throw new Error(`Could not load the original Saint Marrow modules from "${baseUrl}" (${e.message}). Serve the repository root so the Studio can read ../saint-marrow/js read-only.`);
  }
}

function hex(n) { return '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6); }

/** Greedy rectangle merge of a W×H key grid. Returns [{x,z,w,d,key}] */
export function mergeRects(W, H, keyAt) {
  const used = new Uint8Array(W * H);
  const out = [];
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const k = keyAt(x, z);
      if (k === null || k === undefined || used[z * W + x]) continue;
      let w = 1;
      while (x + w < W && !used[z * W + x + w] && keyAt(x + w, z) === k) w++;
      let d = 1;
      outer: while (z + d < H) {
        for (let i = 0; i < w; i++) if (used[(z + d) * W + x + i] || keyAt(x + i, z + d) !== k) break outer;
        d++;
      }
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) used[(z + j) * W + x + i] = 1;
      out.push({ x, z, w, d, key: k });
    }
  }
  return out;
}

export function importChapterDef(def, mods, opts = {}) {
  const { Grid, T, THEMES, PRESETS, ITEMS } = mods;
  const chapterNo = def.id;
  const grid = new Grid({ grid: def.map, legend: def.legend || {}, defaultTheme: def.defaultTheme ?? 0, themes: def.themes });
  const W = grid.w, H = grid.h;
  const themeNames = def.themes || ['corridor'];
  const lib = opts.library || {};
  const report = { chapter: chapterNo, key: def.key, size: [W, H], counts: {}, unimportable: [], notes: [], proxies: [] };
  const count = (k, n = 1) => { report.counts[k] = (report.counts[k] || 0) + n; };
  const bad = (what, n, reason) => { if (n) report.unimportable.push({ what, count: n, reason }); };

  const materials = {};
  const matFromTheme = (themeName, slot) => {
    const th = THEMES[themeName] || THEMES.corridor;
    const spec = th[slot];
    if (!spec) return 'mat_plain_dark';
    const [set, tile, tint] = spec;
    const id = `mat_game_${set}_${(tint >>> 0).toString(16)}`;
    if (!materials[id]) {
      materials[id] = {
        ...defaultMaterial(`${set.replace(/_/g, ' ')} (${themeName} ${slot})`),
        map: builtinTexId(`${set}_diff`), normalMap: builtinTexId(`${set}_nor`), ormMap: builtinTexId(`${set}_arm`),
        color: hex(tint), tiling: [1 / tile, 1 / tile], surface: th.surface || '', preset: false,
        meta: { source: `saint-marrow/js/world/themes.js ${themeName}.${slot}` },
      };
    }
    return id;
  };

  const nodes = [];     // [{node, parentGroup}]
  const groups = {};
  const root = makeNode('group', { name: `Chapter ${chapterNo} — ${def.key}`, meta: { source: { game: 'saint-marrow', chapter: chapterNo } } });
  const group = (name) => { if (!groups[name]) { groups[name] = makeNode('group', { name }); } return groups[name]; };
  const put = (node, g) => { nodes.push({ node, g }); count(node.type); return node; };

  const themeAt = (x, z) => themeNames[grid.theme[grid.idx(x, z)]] || themeNames[0];
  const typeAt = (x, z) => grid.get(x, z);
  const heightOf = (name) => (THEMES[name] || THEMES.corridor).h;
  const isSolidCell = (t) => t === T.WALL || t === T.EXT || t === T.WINDOW || t === T.VOID;
  const indoorFloor = (t) => t === T.FLOOR || t === T.DOOR || t === T.WATER;
  const src = (x, z, extra = {}) => ({ source: { game: 'saint-marrow', chapter: chapterNo, cell: [x, z], mark: grid.mark[grid.idx(x, z)] || null, ...extra } });

  // ---------------------------------------------------------------- floors
  // trees and fences stand on plain ground in the game, so they share the GROUND floor type
  const outdoorMat = { [T.GROUND]: 'mat_mud', [T.GRASS]: 'mat_grass', [T.ROAD]: 'mat_road', [T.PATH]: 'mat_concrete_floor' };
  const floorKey = (x, z) => {
    const t = typeAt(x, z);
    if (indoorFloor(t)) return `in|${themeAt(x, z)}|${t === T.WATER ? 'water' : 'floor'}`;
    if (outdoorMat[t]) return `out|${t}`;
    if (t === T.TREE || t === T.FENCE) return `out|${T.GROUND}`;
    return null;
  };
  for (const r of mergeRects(W, H, floorKey)) {
    const [kind, a, b] = r.key.split('|');
    const n = makeNode('floor', {
      name: kind === 'in' ? `Floor ${a}${b === 'water' ? ' (water)' : ''}` : `Ground ${a}`,
      p: [r.x + r.w / 2, 0, r.z + r.d / 2],
      props: kind === 'in'
        ? { w: r.w, d: r.d, material: b === 'water' ? 'mat_glass' : matFromTheme(a, 'floor'), surface: b === 'water' ? 'water' : (THEMES[a]?.surface || 'tile') }
        : { w: r.w, d: r.d, material: outdoorMat[a], surface: { [T.GROUND]: 'mud', [T.GRASS]: 'grass', [T.ROAD]: 'concrete', [T.PATH]: 'concrete' }[a] || 'mud' },
      meta: { source: { game: 'saint-marrow', chapter: chapterNo, cells: [r.x, r.z, r.w, r.d] } },
    });
    put(n, group('Floors'));
  }

  // ---------------------------------------------------------------- ceilings (indoor only)
  for (const r of mergeRects(W, H, (x, z) => (indoorFloor(typeAt(x, z)) ? themeAt(x, z) : null))) {
    const n = makeNode('ceiling', { name: `Ceiling ${r.key}`, p: [r.x + r.w / 2, heightOf(r.key), r.z + r.d / 2], props: { w: r.w, d: r.d, material: matFromTheme(r.key, 'ceil') }, meta: { source: { game: 'saint-marrow', chapter: chapterNo, cells: [r.x, r.z, r.w, r.d] }, note: 'derived: the game draws a ceiling over every indoor cell' } });
    put(n, group('Ceilings'));
  }

  // ---------------------------------------------------------------- walls
  const adjacentThemes = (x, z) => {
    const out = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const t = typeAt(x + dx, z + dz); if (indoorFloor(t)) out.push(themeAt(x + dx, z + dz)); }
    return out;
  };
  const extH = def.extH ?? 9;
  const wallInfo = (x, z) => {
    const t = typeAt(x, z);
    if (t === T.EXT) return { h: extH, mat: 'mat_brick', kind: 'ext' };
    if (t === T.WALL || t === T.WINDOW) {
      const adj = adjacentThemes(x, z);
      if (!adj.length) {
        // touches only outdoors/void: in the game these are never drawn indoors; treat as facade of unknown height
        const outside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const tt = typeAt(x + dx, z + dz); return tt !== T.VOID && !isSolidCell(tt) && !indoorFloor(tt); });
        return outside ? { h: extH, mat: 'mat_brick', kind: 'ext' } : null;
      }
      const best = adj.reduce((a, b) => (heightOf(a) >= heightOf(b) ? a : b));
      const surface = t === T.WINDOW ? 'window' : 'wall';
      return { h: heightOf(best), mat: matFromTheme(best, 'high'), kind: surface, theme: best };
    }
    return null;
  };
  const doorCells = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (typeAt(x, z) === T.DOOR) doorCells.push([x, z]);
  for (const r of mergeRects(W, H, (x, z) => { const i = wallInfo(x, z); return i ? `${i.kind}|${i.h}|${i.mat}` : null; })) {
    const [kind, h, mat] = r.key.split('|');
    const n = makeNode('wall', {
      name: `${kind === 'ext' ? 'Facade' : kind === 'window' ? 'Window wall' : 'Wall'} (${r.x},${r.z})`,
      p: [r.x + r.w / 2, 0, r.z + r.d / 2],
      props: { length: r.w, height: +h, thick: r.d, material: mat, autoOpenings: false },
      meta: { source: { game: 'saint-marrow', chapter: chapterNo, cells: [r.x, r.z, r.w, r.d] } },
    });
    put(n, group('Walls'));
  }
  // window decoration: boarded window at every interior face of a window cell
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (typeAt(x, z) !== T.WINDOW) continue;
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nt = typeAt(x + dx, z + dz);
      if (!indoorFloor(nt)) continue;
      const yaw = Math.atan2(dx, dz) * D2R; // face normal points toward the walkable side
      put(makeNode('window', { name: `Window (${x},${z})`, p: [x + 0.5 + dx * 0.5, 1.0, z + 0.5 + dz * 0.5], r: [0, yaw, 0], props: { width: 0.64, height: 1.35, thick: 0.04, boarded: true }, meta: src(x, z, { note: 'decor only — the game does not cut an opening' }) }), group('Windows'));
    }
  }

  // ---------------------------------------------------------------- doors (each in a 1×1 wall block so the opening is auto-cut)
  for (const [x, z] of doorCells) {
    const mk = grid.mark[grid.idx(x, z)];
    const d = (mk && def.legend?.[mk]) || { open: mk === 'O' };
    const solidX = (xx) => isSolidCell(typeAt(xx, z)) || typeAt(xx, z) === T.DOOR;
    const axis = solidX(x - 1) && solidX(x + 1) ? 'x' : 'z';
    const rotY = axis === 'x' ? 0 : 90;
    const th = adjacentThemes(x, z)[0] || themeNames[0];
    const H0 = heightOf(th);
    const doorId = d.id || `door_${x}_${z}`;
    put(makeNode('wall', { name: `Door frame wall (${x},${z})`, p: [x + 0.5, 0, z + 0.5], r: [0, rotY, 0], props: { length: 1, height: H0, thick: 1, material: matFromTheme(th, 'high'), autoOpenings: true }, meta: src(x, z) }), group('Walls'));
    put(makeNode('door', {
      name: doorId, p: [x + 0.5, 0, z + 0.5], r: [0, rotY, 0],
      props: {
        width: 1, height: 2.15, thick: 1, doorId, state: d.open ? 'open' : 'closed', locked: d.locked || '',
        metal: !!d.metal, doubleDoor: !!d.double, material: d.metal ? 'mat_green_metal' : 'mat_wood',
      },
      meta: src(x, z, { id: d.id || null, legend: mk, sign: d.sign || null, windowed: !!d.window }),
    }), group('Doors'));
  }

  // ---------------------------------------------------------------- fences & trees
  const fenceRects = mergeRects(W, H, (x, z) => (typeAt(x, z) === T.FENCE ? 'f' : null));
  for (const r of fenceRects) {
    const alongX = r.w >= r.d;
    put(makeNode('wall', {
      name: `Iron fence (${r.x},${r.z})`, p: [r.x + r.w / 2, 0, r.z + r.d / 2], r: [0, alongX ? 0 : 90, 0],
      props: { length: alongX ? r.w : r.d, height: 2.3, thick: 0.08, material: 'mat_metal', autoOpenings: false },
      tags: ['fence'], meta: { source: { game: 'saint-marrow', chapter: chapterNo, cells: [r.x, r.z, r.w, r.d] }, note: 'Solid for movement; the game lets shots pass through fences.' },
    }), group('Fences'));
  }
  let trees = 0;
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (typeAt(x, z) !== T.TREE) continue;
    trees++;
    put(makeNode('box', { name: `Tree proxy (${x},${z})`, p: [x + 0.5, 0, z + 0.5], props: { w: 0.44, h: 4.5, d: 0.44, material: 'mat_bark', collide: 'solid' }, tags: ['proxy', 'tree', 'structural'], meta: { ...src(x, z), proxy: true } }), group('Trees'));
  }
  if (trees) report.proxies.push({ what: 'tree', count: trees, reason: 'The game generates dead trees procedurally (builder.js makeDeadTree) — no mesh file exists to import. A 0.44 m collider-sized box stands in for each.' });

  // ---------------------------------------------------------------- lights
  const LIGHT_KINDS = {
    fluoro: { color: 0xe8f4ff, intensity: 24, range: 9, y: (h) => h - 0.255 },
    cage: { color: 0xffc98a, intensity: 32, range: 9, y: (h) => h - 0.755 },
    bulb: { color: 0xffb46b, intensity: 20, range: 7, y: (h) => h - 0.655 },
    wall: { color: 0xffd7a0, intensity: 20, range: 7, y: () => 2.4 },
    emergency: { color: 0xff2012, intensity: 14, range: 7, y: () => 2.4, flicker: 'pulse', group: 'emergency' },
    street: { color: 0xff9a45, intensity: 260, range: 20, y: () => 3.6 },
    security: { color: 0xdfe8ff, intensity: 110, range: 16, y: () => 4.2 },
  };
  const wallDirFirst = (x, z) => {
    const c = [];
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const t = typeAt(x + dx, z + dz); if (t === T.WALL || t === T.EXT || t === T.WINDOW) c.push([dx, dz]); }
    return { dir: c[0] || null, ambiguous: c.length > 1 };
  };
  let ambiguousWalls = 0;
  const lightNode = (kind, x, z, o = {}, markSrc = {}) => {
    const spec = LIGHT_KINDS[kind];
    const h = indoorFloor(typeAt(x, z)) ? heightOf(themeAt(x, z)) : 3.5;
    let px = x + 0.5, pz = z + 0.5;
    if (kind === 'wall' || kind === 'emergency') { const { dir, ambiguous } = wallDirFirst(x, z); if (ambiguous) ambiguousWalls++; const dd = dir || [0, -1]; px += dd[0] * 0.48; pz += dd[1] * 0.48; }
    const state = o.state || 'on';
    return makeNode('light', {
      name: `${kind} light (${x},${z})`, p: [px, o.y ?? spec.y(h), pz],
      props: {
        kind: 'point', color: hex(spec.color), intensity: o.intensity ?? spec.intensity, range: spec.range,
        enabled: state !== 'off', flicker: state === 'flicker' || state === 'dying' || state === 'pulse' ? state : (spec.flicker || 'none'),
        powerGroup: o.group || spec.group || 'main',
      },
      meta: src(x, z, { lightKind: kind, ...markSrc }),
    });
  };
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const mk = grid.mark[grid.idx(x, z)];
    if (mk === '*') put(lightNode('fluoro', x, z, { state: def.lightsDefault || 'on', group: 'main' }), group('Lights'));
    else if (mk === '+') put(lightNode('fluoro', x, z, { state: 'off', group: 'dead' }), group('Lights'));
    else if (mk === '^') put(lightNode('cage', x, z, { state: def.cageState || 'on', group: def.cageGroup || 'main' }), group('Lights'));
    else if (mk === '!') put(lightNode('emergency', x, z, {}), group('Lights'));
  }

  // ---------------------------------------------------------------- props, items, entities from marks
  const propNodes = [];          // for item surface heights
  const modelAsset = (name) => builtinModelId(name);
  const boundsOf = (name) => lib.models?.[modelAsset(name)]?.bounds || builtinMeta(modelAsset(name))?.bounds || null;

  function placeProp(name, x, z, o = {}, id = null) {
    const p = PRESETS[name];
    if (!p) { bad(`prop "${name}"`, 1, 'Unknown prop preset in the original game.'); return null; }
    const mName = p.model || name;
    let px = x + 0.5, pz = z + 0.5, yaw = 0, y = 0;
    let wd = null;
    if (o.face) wd = FACE[o.face];
    else if (p.wall || p.mount) { const r = wallDirFirst(x, z); wd = r.dir; if (r.ambiguous) ambiguousWalls++; }
    const meta = src(x, z, { prop: name, id: id || null, wallGuess: !!(p.wall || p.mount) && !o.face });
    if (p.mount) {
      wd = wd || [0, -1];
      yaw = Math.atan2(-wd[0], -wd[1]);
      px += wd[0] * 0.5; pz += wd[1] * 0.5; y = o.y ?? p.mount;
    } else if (p.ceiling) {
      y = heightOf(themeAt(x, z));
    } else {
      if (wd) {
        yaw = Math.atan2(-wd[0], -wd[1]);
        const b = boundsOf(mName);
        const depth = b ? b.max[2] - b.min[2] : PROCEDURAL_PROP_DIMS[p.proc]?.[2] ?? 0.5;
        const off = 0.5 - depth / 2 - 0.02;
        px += wd[0] * off; pz += wd[1] * off;
      } else if (p.free && o.rot === undefined) meta.randomRotation = true;
      if (o.rot !== undefined) yaw = o.rot;
      px += o.dx || 0; pz += o.dz || 0; y = o.y || 0;
    }
    let node;
    if (p.model) {
      node = makeNode('model', {
        name: id || `${name} (${x},${z})`, p: [px, y, pz], r: [0, yaw * D2R, 0], s: o.scale ? [o.scale, o.scale, o.scale] : [1, 1, 1],
        props: { asset: modelAsset(name === 'trashcan' ? p.model : p.model), collision: p.col ? 'auto-box' : 'none', pivot: [0, 0, 0] },
        tags: p.mount ? ['mounted'] : [], meta,
      });
    } else {
      const dims = PROCEDURAL_PROP_DIMS[p.proc] || [0.5, 0.5, 0.5];
      node = makeNode('box', {
        name: id || `${name} (${x},${z})`, p: [px, y, pz], r: [0, yaw * D2R, 0],
        props: { w: dims[0], h: dims[1], d: dims[2], material: 'mat_plain_dark', collide: p.col ? 'solid' : 'none' },
        tags: ['proxy', 'procedural:' + p.proc, ...(p.mount || p.ceiling ? ['mounted'] : [])], meta: { ...meta, proxy: true },
      });
      report.proxies.push({ what: `procedural prop "${name}"`, count: 1, reason: `Built in code (props.js ${p.proc}) — no model file exists. A box of its real dimensions stands in.` });
    }
    put(node, group(p.proc ? 'Props (proxies)' : 'Props'));
    const bb = boundsOf(mName);
    const dim = bb ? [bb.max[0] - bb.min[0], bb.max[1], bb.max[2] - bb.min[2]] : (PROCEDURAL_PROP_DIMS[p.proc] || [0.5, 0.5, 0.5]);
    propNodes.push({ node, h: dim[1] * (o.scale || 1) + y, x: px, z: pz, half: Math.max(dim[0], dim[2]) / 2 * (o.scale || 1), solid: !!p.col });
    return node;
  }

  const surfaceHeight = (x, z) => {
    let y = 0;
    for (const p of propNodes) {
      if (!p.solid) continue;      // the game only rests items on props that have a collider
      if (Math.abs(p.x - x) <= p.half && Math.abs(p.z - z) <= p.half && p.h < 1.3 && p.h > y) y = p.h;
    }
    return y;
  };

  let clutterSlots = 0, randomMarks = 0, doorLegend = 0;
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = grid.idx(x, z);
    const mk = grid.mark[i];
    const t = grid.type[i];
    if (!mk || mk === 'O') continue;
    if (mk === '@') { put(makeNode('playerSpawn', { name: `Player spawn ${(report.counts.playerSpawn || 0) + 1}`, p: [x + 0.5, 0, z + 0.5], r: [0, (def.spawnYaw || 0) * D2R, 0], props: { slot: (report.counts.playerSpawn || 0) % 4 }, meta: src(x, z) }), group('Spawns')); continue; }
    if (mk === '*' || mk === '+' || mk === '^' || mk === '!') continue;
    if (mk === 'L') { placeProp('locker', x, z, {}); continue; }
    if (mk === 'x') {
      clutterSlots++;
      const th = indoorFloor(t) || t === T.FLOOR ? themeAt(x, z) : 'outdoor';
      put(makeNode('marker', { name: `Clutter slot (${x},${z})`, p: [x + 0.5, 0, z + 0.5], props: { kind: 'clutter', note: `The game picks one of: ${(CLUTTER_BY_THEME[th] || CLUTTER_BY_THEME.corridor).join(', ')} at random per session.` }, meta: src(x, z, { candidates: CLUTTER_BY_THEME[th] || CLUTTER_BY_THEME.corridor }) }), group('Markers'));
      continue;
    }
    if (mk === '%') { randomMarks++; put(makeNode('marker', { name: `Random prop slot (${x},${z})`, p: [x + 0.5, 0, z + 0.5], props: { kind: 'clutter', note: 'box / crate / papers chosen at random per session' }, meta: src(x, z) }), group('Markers')); continue; }
    const d = def.legend?.[mk];
    if (!d) continue;
    if (t === T.DOOR) { doorLegend++; continue; }          // handled above
    const id = d.id || null;
    let propNode = null;
    if (d.prop) propNode = placeProp(d.prop, x, z, d, (d.item || d.note || d.use) ? null : id);
    if (d.item) {
      const it = ITEMS[d.item];
      const px = x + 0.5 + (d.dx || 0), pz = z + 0.5 + (d.dz || 0);
      const y = d.y ?? surfaceHeight(px, pz);
      put(makeNode('itemSpawn', { name: id && !d.prop ? id : `${d.item} (${x},${z})`, p: [px, y, pz], props: { item: d.item, count: d.count || 1, model: it?.model ? modelAsset(it.model) : '', prompt: 'take' }, meta: src(x, z, { id, y: d.y ?? 'surface' }) }), group('Items'));
    }
    if (d.note) {
      const px = x + 0.5 + (d.dx || 0), pz = z + 0.5 + (d.dz || 0);
      put(makeNode('itemSpawn', { name: id || `note ${d.note}`, p: [px, d.y ?? surfaceHeight(px, pz), pz], props: { item: `${d.tape ? 'tape' : 'note'}:${d.note}`, count: 1, model: d.tape ? modelAsset('portable_cassette_player') : '', prompt: d.tape ? 'listen' : 'read' }, meta: src(x, z, { id, note: d.note, tape: !!d.tape }) }), group('Items'));
    }
    if (d.light) {
      const kind = d.light;
      if (LIGHT_KINDS[kind]) put(lightNode(kind, x, z, { state: d.state, group: d.group, intensity: d.intensity, y: d.y }, { id }), group('Lights'));
      else bad(`light kind "${kind}"`, 1, 'Unknown light kind.');
    }
    if (d.spawn) {
      const arch = d.spawn;
      put(makeNode('enemySpawn', { name: id || `${arch} spawn (${x},${z})`, p: [x + 0.5 + (d.dx || 0), 0, z + 0.5 + (d.dz || 0)], props: { archetype: arch, dormant: !!d.dormant, startState: d.dormant ? 'dormant' : 'idle' }, meta: src(x, z, { id, crawler: !!d.crawler, scriptOnly: !!d.scriptOnly, tag: d.tag || null }) }), group('Spawns'));
    }
    if (d.marker) put(makeNode('marker', { name: `${d.marker} marker (${x},${z})`, p: [x + 0.5, 0, z + 0.5], props: { kind: d.marker, note: '' }, meta: src(x, z, { id }) }), group('Markers'));
    if (d.trigger) {
      const r = d.r || 1.5;
      put(makeNode('trigger', { name: `trigger:${d.trigger}`, p: [x + 0.5, 1, z + 0.5], props: { shape: 'sphere', size: [r * 2, r * 2, r * 2], onEnter: `trigger:${d.trigger}`, once: d.once !== false, filter: 'player' }, meta: src(x, z) }), group('Triggers'));
    }
    if (d.player) put(makeNode('playerSpawn', { name: `Player spawn (${x},${z})`, p: [x + 0.5, 0, z + 0.5], meta: src(x, z) }), group('Spawns'));
    if (d.decal) {
      const kind = d.decal;
      if (kind === 'writing') {
        const wdd = d.face ? FACE[d.face] : (wallDirFirst(x, z).dir || [0, -1]);
        put(makeNode('decal', { name: `Blood writing "${d.text}"`, p: [x + 0.5 + wdd[0] * 0.495, d.y || 1.65, z + 0.5 + wdd[1] * 0.495], r: [0, Math.atan2(-wdd[0], -wdd[1]) * D2R, 0], props: { texture: 'builtin:decal/writing', w: d.w || 2.4, h: (d.w || 2.4) / 4, color: '#ffffff' }, meta: src(x, z, { text: d.text }) }), group('Decals'));
      } else if (kind === 'hand' || kind === 'drip') {
        const wdd = wallDirFirst(x, z).dir || [0, -1];
        put(makeNode('decal', { name: `Blood ${kind}`, p: [x + 0.5 + wdd[0] * 0.5, d.y || 1.3, z + 0.5 + wdd[1] * 0.5], r: [0, Math.atan2(-wdd[0], -wdd[1]) * D2R, 0], props: { texture: `builtin:decal/${kind}`, w: d.size || 0.6, h: d.size || 0.6 }, meta: src(x, z) }), group('Decals'));
      } else {
        put(makeNode('decal', { name: `Blood ${kind}`, p: [x + 0.5 + (d.dx || 0), 0.0035, z + 0.5 + (d.dz || 0)], r: [-90, 0, 0], props: { texture: `builtin:decal/${kind}`, w: d.size || 1.2, h: d.size || 1.2 }, meta: src(x, z) }), group('Decals'));
      }
    }
    if (d.use) {
      // Game semantics (level.js placeEntity): interaction point = prop position + useY. We import it as-is.
      const baseY = propNode ? propNode.t.p[1] : 0;
      const bx = propNode ? propNode.t.p[0] : x + 0.5, bz = propNode ? propNode.t.p[2] : z + 0.5;
      const rad = d.useR || 0.8;
      put(makeNode('interaction', {
        name: `use:${d.id || d.use}`, p: [bx, baseY + (d.useY ?? 1.2), bz],
        props: { shape: 'sphere', size: [rad * 2, rad * 2, rad * 2], prompt: d.prompt || 'use', hold: d.hold || 0, event: `use:${d.id || d.use}` },
        meta: src(x, z, { use: d.use, id: d.id || null, formula: 'prop.position.y + useY (as in level.js)' }),
      }), group('Interactions'));
    }
  }
  if (clutterSlots) bad("random clutter slots ('x')", clutterSlots, 'The game chooses a prop at random per session; imported as markers listing the candidates, not as props.');
  if (randomMarks) bad("random prop slots ('%')", randomMarks, 'Chosen at random per session; imported as markers.');
  if (ambiguousWalls) report.notes.push(`${ambiguousWalls} wall-mounted prop/light(s) had several adjacent walls; the game picks one at random each session. The first (N,E,S,W order) was used.`);

  // gate & ladder built by chapter extra() code
  const gate = nodes.find((e) => e.node.type === 'marker' && e.node.props.kind === 'gate')?.node;
  if (gate && (chapterNo === 1 || chapterNo === 5)) {
    put(makeNode('model', { name: 'Iron gate', p: [gate.t.p[0], 0, gate.t.p[2]], s: [1.02, 0.85, 1], props: { asset: modelAsset('large_iron_gate'), collision: 'custom', colliderCenter: [0, 1.25, 0], colliderSize: [3, 2.5, 0.3] }, tags: ['structural'], meta: { source: { game: 'saint-marrow', chapter: chapterNo, from: 'chapters.js buildGate()' }, note: chapterNo === 5 ? 'Open in the game (rotated); imported closed.' : 'Chained shut until the bolt cutters are used.' } }), group('Props'));
  }

  // ---------------------------------------------------------------- unimportable features
  bad('chapter scripts (start/update/onTrigger/onPickup/onUse/onEvent/onRead/onKilled)', Object.keys(def).filter((k) => typeof def[k] === 'function' && k !== 'extra').length, 'JavaScript story logic cannot be converted automatically. The function source is stored under Scripts as read-only reference.');
  if ((def.oldBlood ?? 1) > 0 && !def.env) bad('old blood decals', 1, 'level.js scatterOldBlood() sprinkles decals randomly per session from the level seed; they are not part of the map data.');
  else if ((def.oldBlood ?? 1) > 0) report.notes.push('Procedural "old blood" decals are generated per session (level.js scatterOldBlood) and are not imported.');
  if (def.extra) report.notes.push('This chapter builds extra objects in code (def.extra): ' + (chapterNo === 4 ? 'a service-tunnel ladder (not imported; the ladder interaction is).' : 'the main gate (imported as a model).'));
  report.notes.push('Walls are imported as one material (the game splits tiled lower / painted upper wall halves).');
  if (def.warden) report.notes.push(`Warden director settings (${JSON.stringify(def.warden)}) are not scene data; see the reference archetypes.`);
  const warns = nodes.filter((e) => e.node.type === 'door' && e.node.props.locked).length;
  report.notes.push(`${warns} door(s) carry lock strings exactly as in the game (chain/jammed/power/script/code:/item:).`);

  // ---------------------------------------------------------------- assemble
  const environment = {
    mapSize: [W, H],
    fog: { color: hex((def.fog || [0x07080a])[0]), density: (def.fog || [0, 0.085])[1] },
    ambient: { color: hex((def.ambient || [0x6a7684])[0]), groundColor: hex((def.ambient || [0, 0x2a241e])[1] ?? 0x2a241e), intensity: (def.ambient || [0, 0, 1])[2] ?? 1 },
    exposure: 1, clearColor: hex((def.fog || [0x07080a])[0]),
    outdoor: def.env === 'outdoor', rain: !!def.rain, reverb: def.reverb || 'hall', ceilingHeight: 3,
    moon: { enabled: def.env === 'outdoor', color: '#8fa3c8', intensity: def.moon ?? 0.5, direction: [-0.4, 0.8, -0.6] },
  };
  const scripts = {};
  for (const [k, v] of Object.entries(def)) {
    if (typeof v !== 'function') continue;
    scripts[`ref_ch${chapterNo}_${k}`] = { name: `Original chapter ${chapterNo} ${k}() — reference only`, readOnly: true, code: `// Imported read-only from saint-marrow/js/chapters/chapters.js. NOT executed by the Studio.\n// Use it as a reference when rebuilding this logic with events and sequences.\nconst ${k} = ${v.toString()};` };
  }
  const enemies = { ref_hollow: deepClone(HOLLOW_REFERENCE), ref_warden: deepClone(WARDEN_REFERENCE) };

  const rootNode = root;
  return { root: rootNode, groups, entries: nodes, materials, environment, scripts, enemies, report, grid: { w: W, h: H } };
}

/** Build the command list that inserts an import result into a project (single undo step via History.transaction). */
export function importCommands(result) {
  const cmds = [];
  cmds.push(addNode(result.root, ROOT_ID));
  const order = ['Floors', 'Ceilings', 'Walls', 'Doors', 'Windows', 'Fences', 'Trees', 'Props', 'Props (proxies)', 'Items', 'Lights', 'Interactions', 'Triggers', 'Spawns', 'Markers', 'Decals'];
  const gids = {};
  for (const name of order) {
    const g = result.groups[name];
    if (!g) continue;
    gids[name] = g.id;
    cmds.push(addNode(g, result.root.id));
  }
  for (const { node, g } of result.entries) cmds.push(addNode(node, g.id));
  return cmds;
}

import { setData } from '../commands.js';

/** Apply an import result to a project through the history (one undo step). Returns a summary. */
export function importIntoProject(project, history, result, { replaceScene = false } = {}) {
  history.transaction(`Import chapter ${result.report.chapter}`, () => {
    if (replaceScene) history.exec(removeAllCmd());
    for (const c of importCommands(result)) history.exec(c);
    const mats = { ...project.data.materials, ...result.materials };
    history.exec(setData(['materials'], mats, { label: 'Import materials' }));
    history.exec(setData(['environment'], { ...project.data.environment, ...result.environment }, { label: 'Import environment' }));
    history.exec(setData(['scripts'], { ...project.data.scripts, ...result.scripts }, { label: 'Import reference scripts' }));
    history.exec(setData(['enemies'], { ...project.data.enemies, ...result.enemies }, { label: 'Import reference archetypes' }));
    history.exec(setData(['importReport'], result.report, { label: 'Import report' }));
  });
  return { nodes: result.entries.length, report: result.report };
}

import { removeNodes } from '../commands.js';
function removeAllCmd() {
  return {
    label: 'Clear scene',
    _inner: null,
    do(ctx) { this._inner = removeNodes([...ctx.scene.root.children]); return this._inner.do(ctx); },
    undo(ctx) { return this._inner.undo(ctx); },
  };
}

// Downloads CC0 source assets and builds the optimized game assets in /assets.
//
//   node tools/assets.mjs fetch   -> downloads sources into .cache/assets
//   node tools/assets.mjs build   -> writes optimized files into assets/
//   node tools/assets.mjs         -> both
//
// Every source is CC0 (Poly Haven, Freesound CC0) except the Vanguard soldier
// (Mixamo, royalty-free for games). See assets/CREDITS.md.
import fs from 'fs';
import path from 'path';
import https from 'https';
import { execFileSync } from 'child_process';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, simplify, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import ffmpegPath from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache/assets');
const OUT = path.join(ROOT, 'assets');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) strikepoint-asset-builder';

// ---------------------------------------------------------------- catalog
// map material id -> Poly Haven texture id, output size
export const TEXTURES = {
  sandstone: { ph: 'sandstone_blocks_04', size: 1024 },
  sandstone_white: { ph: 'white_sandstone_bricks', size: 512 },
  plaster: { ph: 'patterned_clay_plaster', size: 1024 },
  plaster_ochre: { ph: 'clay_plaster', size: 1024 },
  plaster_blue: { ph: 'blue_plaster_weathered', size: 512 },
  sand: { ph: 'coast_sand_01', size: 1024 },
  pavers: { ph: 'stone_tiles_02', size: 1024 },
  tiles: { ph: 'cobblestone_square', size: 1024 },
  concrete: { ph: 'rough_concrete', size: 512 },
  wood: { ph: 'weathered_brown_planks', size: 512 },
  crate: { ph: 'wood_planks_dirt', size: 512 },
  door: { ph: 'wood_peeling_paint_weathered', size: 512 },
  metal: { ph: 'green_metal_rust', size: 512 },
  rust: { ph: 'rusty_metal_02', size: 512 },
  roof: { ph: 'clay_roof_tiles_02', size: 512 },
  leather: { ph: 'fabric_leather_02', size: 512 },
  fabric: { ph: 'stretch_poplin', size: 512 },
  neoprene: { ph: 'scuba_suede', size: 512 },
  denim: { ph: 'denim_fabric_05', size: 512 },
};

// Poly Haven models -> game asset name
export const MODELS = {
  pistol_ph: { ph: 'service_pistol', tex: 1024, keep: /_a$|magazine_loaded|bullet/ },
  boltrifle_ph: { ph: 'bolt_action_rifle_7_62', tex: 1024 },
  crate_lettered: { ph: 'wooden_crate_02', tex: 512, ratio: 0.5 },
  crate_military: { ph: 'old_military_crate', tex: 512, ratio: 0.35, keep: /_a$/ },
  barrel_red: { ph: 'Barrel_01', tex: 512 },
  barrel_blue: { ph: 'barrel_03', tex: 512 },
  barrel_wood: { ph: 'wine_barrel_01', tex: 512, ratio: 0.3 },
  jerrycan: { ph: 'metal_jerrycan_green', tex: 512, ratio: 0.15 },
  ammo_box: { ph: 'ammo_box', tex: 512, ratio: 0.5 },
  pot_clay: { ph: 'planter_pot_clay', tex: 512 },
  vase_jug: { ph: 'ceramic_vase_04', tex: 512, ratio: 0.3 },
  barrier: { ph: 'concrete_road_barrier', tex: 512, ratio: 0.04 },
  castle_door: { ph: 'large_castle_door', tex: 512, ratio: 0.25 },
  utility_box: { ph: 'utility_box_01', tex: 512 },
  covered_car: { ph: 'covered_car', tex: 1024, ratio: 0.5 },
  tyre: { ph: 'old_tyre', tex: 512 },
  cement_bag: { ph: 'cement_bag', tex: 512 },
  crate_wood: { ph: 'wooden_crate_01', tex: 512, ratio: 0.5 },
  shutter_door: { ph: 'rollershutter_door', tex: 512 },
  basket: { ph: 'wicker_basket_02', tex: 512, ratio: 0.25 },
  brass_pot: { ph: 'brass_pot_01', tex: 512, ratio: 0.6 },
  table_wood: { ph: 'WoodenTable_01', tex: 512 },
  lantern: { ph: 'wooden_lantern_01', tex: 512, ratio: 0.5 },
};

// skinned models from direct URLs (kept rigged; materials are set in code)
export const URL_MODELS = {
  // WebXR generic hands (MIT): https://github.com/immersive-web/webxr-input-profiles
  hand_r: 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.19/dist/profiles/generic-hand/right.glb',
  hand_l: 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.19/dist/profiles/generic-hand/left.glb',
};

// Weapon models (CC0 unless noted, see assets/CREDITS.md). Sources were
// converted from FBX/.blend to GLB with tools/b2glb.py (Blender as a Python
// module) into .cache/research/<pack>/; this step only optimizes them.
//   scale/rotY: normalize to meters and gun space (-Z = muzzle, +Y = up)
export const GUNS = {
  gun_ak: { src: 'itch_3dmodelscc0_guns/ak47.glb', tex: 1024 },
  gun_m4: { src: 'oga_m4a1_cc0/m4a1.glb', tex: 1024 },
  gun_sniper: { src: 'itch_3dmodelscc0_guns/sniper.glb', tex: 1024, rotX: -10.2 },
  gun_shotgun: { src: 'itch_3dmodelscc0_guns/shotgun.glb', tex: 1024 },
  gun_smg: { src: 'itch_3dmodelscc0_guns/greasegun.glb', tex: 1024 },
  gun_pistol: { src: 'itch_3dmodelscc0_guns/makarov.glb', tex: 1024 },
  gun_deagle: { src: 'oga_deagle_sirdraco/deagle.glb', tex: 512, drop: /^Bullets$/, scale: 0.0628, rotY: 180, ratio: 0.6 },
  knife_m9: { src: 'oga_m9_knife/m9_knife.glb', tex: 1024, scale: 0.0258 },
  knife_combat: { src: 'itch_3dmodelscc0_melee/combat_knife.glb', tex: 1024 },
};
const RESEARCH = path.join(ROOT, '.cache/research');

// ---------------------------------------------------------------- helpers
function get(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return get(new URL(res.headers.location, url).href, dest).then(resolve, reject); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(res.statusCode + ' ' + url)); }
      const f = fs.createWriteStream(dest);
      res.pipe(f); f.on('finish', () => f.close(() => resolve(dest)));
    });
    req.on('error', reject);
  });
}
async function getJSON(url) { const p = path.join(CACHE, 'json', encodeURIComponent(url)); if (!fs.existsSync(p)) await get(url, p); return JSON.parse(fs.readFileSync(p, 'utf8')); }
const exists = (p) => fs.existsSync(p) && fs.statSync(p).size > 0;

// ---------------------------------------------------------------- fetch
async function fetchTextures() {
  for (const [id, t] of pick(TEXTURES)) {
    const files = await getJSON(`https://api.polyhaven.com/files/${t.ph}`);
    for (const [map, key] of [['diff', 'Diffuse'], ['nor', 'nor_gl'], ['arm', 'arm']]) {
      const dest = path.join(CACHE, 'tex', `${t.ph}_${map}.jpg`);
      if (exists(dest)) continue;
      const res = files[key]['1k'] ? '1k' : Object.keys(files[key])[0];
      await get(files[key][res].jpg.url, dest);
      console.log('tex', id, map);
    }
  }
}
const ONLY = process.argv.slice(3);
const pick = (obj) => Object.entries(obj).filter(([k]) => !ONLY.length || ONLY.includes(k));
async function fetchModels() {
  for (const [name, m] of pick(MODELS)) {
    const files = await getJSON(`https://api.polyhaven.com/files/${m.ph}`);
    const g = files.gltf['1k'] ? files.gltf['1k'].gltf : files.gltf[Object.keys(files.gltf)[0]].gltf;
    const dir = path.join(CACHE, 'models', m.ph);
    const main = path.join(dir, path.basename(g.url));
    if (!exists(main)) await get(g.url, main);
    for (const [rel, inc] of Object.entries(g.include || {})) { const d = path.join(dir, rel); if (!exists(d)) await get(inc.url, d); }
    console.log('model', name);
  }
  for (const [name, url] of pick(URL_MODELS)) {
    const d = path.join(CACHE, 'models', name + '.glb');
    if (!exists(d)) { await get(url, d); console.log('model', name); }
  }
  const soldier = path.join(CACHE, 'models', 'Soldier.glb');
  if (!exists(soldier)) await get('https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Soldier.glb', soldier);
}

// ---------------------------------------------------------------- build
async function buildTextures() {
  const dir = path.join(OUT, 'tex'); fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const [id, t] of pick(TEXTURES)) {
    for (const [map, q] of [['diff', 78], ['nor', 82], ['arm', 70]]) {
      const src = path.join(CACHE, 'tex', `${t.ph}_${map}.jpg`);
      const size = map === 'arm' ? Math.min(512, t.size) : t.size;
      const dest = path.join(dir, `${id}_${map}.webp`);
      await sharp(src).resize(size, size, { kernel: 'lanczos3' }).webp({ quality: q, effort: 6, smartSubsample: map === 'diff' }).toFile(dest);
      total += fs.statSync(dest).size;
    }
  }
  console.log('textures', (total / 1024).toFixed(0) + ' KB');
}

async function optimizeModel(io, doc, opts) {
  await MeshoptEncoder.ready;
  const ops = [dedup(), prune(), weld()];
  if (opts.ratio) ops.push(simplify({ simplifier: MeshoptSimplifier, ratio: opts.ratio, error: 0.002 }));
  ops.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [opts.tex, opts.tex], quality: 80 }));
  ops.push(prune({ keepAttributes: false }));
  ops.push(quantize());
  await doc.transform(...ops);
  if (!opts.noMeshopt) {
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  }
}

async function buildModels() {
  const dir = path.join(OUT, 'models'); fs.mkdirSync(dir, { recursive: true });
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  for (const [name, m] of pick(MODELS)) {
    const srcDir = path.join(CACHE, 'models', m.ph);
    const gltf = fs.readdirSync(srcDir).find((f) => f.endsWith('.gltf'));
    const doc = await io.read(path.join(srcDir, gltf));
    if (m.keep) {
      // drop alternative variants that ship in the same file
      for (const node of doc.getRoot().listNodes()) if (node.getMesh() && !m.keep.test(node.getName())) node.dispose();
    }
    await optimizeModel(io, doc, m);
    const dest = path.join(dir, `${name}.glb`);
    await io.write(dest, doc);
    console.log('model', name, (fs.statSync(dest).size / 1024).toFixed(0) + ' KB');
  }
  for (const [name] of pick(URL_MODELS)) {
    const doc = await io.read(path.join(CACHE, 'models', name + '.glb'));
    await optimizeModel(io, doc, { tex: 256 });
    const dest = path.join(dir, `${name}.glb`);
    await io.write(dest, doc);
    console.log('model', name, (fs.statSync(dest).size / 1024).toFixed(0) + ' KB');
  }
  if (ONLY.length && !ONLY.includes('soldier')) return;
  // soldier (keep skinning + animations)
  const doc = await io.read(path.join(CACHE, 'models', 'Soldier.glb'));
  await optimizeModel(io, doc, { tex: 1024 });
  const dest = path.join(dir, 'soldier.glb');
  await io.write(dest, doc);
  console.log('model soldier', (fs.statSync(dest).size / 1024).toFixed(0) + ' KB');
}

// ---------------------------------------------------------------- sounds
// name: {fs: freesound id, url: preview url, start, dur, gain, hp, lp, fade}
export const SOUNDS = JSON.parse(fs.existsSync(path.join(ROOT, 'tools/sounds.json')) ? fs.readFileSync(path.join(ROOT, 'tools/sounds.json'), 'utf8') : '{}');

async function fetchSounds() {
  for (const [name, s] of Object.entries(SOUNDS)) {
    const dest = path.join(CACHE, 'sfx', `${s.fs}.mp3`);
    if (!exists(dest)) { await get(s.url, dest); console.log('sfx', name); }
  }
}
function buildSounds() {
  const dir = path.join(OUT, 'sfx'); fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const [name, s] of Object.entries(SOUNDS)) {
    const src = path.join(CACHE, 'sfx', `${s.fs}.mp3`);
    const dest = path.join(dir, `${name}.mp3`);
    const filters = [];
    if (s.hp) filters.push(`highpass=f=${s.hp}`);
    if (s.lp) filters.push(`lowpass=f=${s.lp}`);
    filters.push(`afade=t=out:st=${Math.max(0, (s.dur || 1) - (s.fade || 0.08))}:d=${s.fade || 0.08}`);
    filters.push(`volume=${s.gain || 1}`);
    filters.push('alimiter=limit=0.95');
    execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-ss', String(s.start || 0), '-t', String(s.dur || 1), '-i', src, '-ac', '1', '-ar', '44100', '-af', filters.join(','), '-b:a', (s.kbps || 96) + 'k', dest]);
    total += fs.statSync(dest).size;
  }
  console.log('sounds', Object.keys(SOUNDS).length, (total / 1024).toFixed(0) + ' KB');
}

// Bake skinned meshes into static geometry at their rest pose (rigid gun rigs
// like the Desert Eagle): v' = sum(w * jointWorld * IBM) * v, node moved to
// the scene root with an identity transform; skins/animations removed.
function mat4mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
function unskin(doc) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  for (const node of root.listNodes()) {
    const skin = node.getSkin(); if (!skin || !node.getMesh()) continue;
    const joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
    const M = joints.map((j, i) => mat4mul(j.getWorldMatrix(), ibm ? Array.from(ibm.getElement(i, [])) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    const mesh = node.getMesh().clone(); node.setMesh(mesh);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION').clone(), nor = prim.getAttribute('NORMAL')?.clone();
      const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      const v = [0, 0, 0], n = [0, 0, 0], jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        J.getElement(i, jj); W.getElement(i, ww);
        const m = new Array(16).fill(0);
        for (let k = 0; k < 4; k++) if (ww[k]) for (let e = 0; e < 16; e++) m[e] += ww[k] * M[jj[k]][e];
        pos.getElement(i, v);
        pos.setElement(i, [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
        if (nor) {
          nor.getElement(i, n);
          const x = m[0] * n[0] + m[4] * n[1] + m[8] * n[2], y = m[1] * n[0] + m[5] * n[1] + m[9] * n[2], z = m[2] * n[0] + m[6] * n[1] + m[10] * n[2], l = Math.hypot(x, y, z) || 1;
          nor.setElement(i, [x / l, y / l, z / l]);
        }
      }
      prim.setAttribute('POSITION', pos); if (nor) prim.setAttribute('NORMAL', nor);
      prim.setAttribute('JOINTS_0', null); prim.setAttribute('WEIGHTS_0', null);
    }
    node.setSkin(null);
    const parent = node.getParentNode(); if (parent) parent.removeChild(node);
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    scene.addChild(node);
  }
  for (const a of root.listAnimations()) a.dispose();
  for (const sk of root.listSkins()) sk.dispose();
  // drop the now empty joint hierarchy (keeps part names unique)
  const hasMesh = (n) => !!n.getMesh() || n.listChildren().some(hasMesh);
  for (const n of root.listNodes()) if (!hasMesh(n)) n.dispose();
}

async function buildGuns() {
  const dir = path.join(OUT, 'models'); fs.mkdirSync(dir, { recursive: true });
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  await MeshoptDecoder.ready;
  for (const [name, g] of pick(GUNS)) {
    const src = path.join(RESEARCH, g.src);
    if (!exists(src)) { console.log('missing', src); continue; }
    const doc = await io.read(src);
    const root = doc.getRoot();
    if (g.drop) for (const n of root.listNodes()) if (g.drop.test(n.getName())) n.dispose();
    if (root.listSkins().length) unskin(doc);
    if (g.scale || g.rotY || g.rotX) {
      const scene = root.listScenes()[0];
      const a = ((g.rotY || 0) * Math.PI) / 360, b = ((g.rotX || 0) * Math.PI) / 360;
      // q = qY * qX
      const q = [Math.cos(a) * Math.sin(b), Math.sin(a) * Math.cos(b), -Math.sin(a) * Math.sin(b), Math.cos(a) * Math.cos(b)];
      const wrap = doc.createNode('gun').setScale([g.scale || 1, g.scale || 1, g.scale || 1]).setRotation(q);
      for (const c of scene.listChildren()) { scene.removeChild(c); wrap.addChild(c); }
      scene.addChild(wrap);
    }
    await doc.transform(dedup(), prune(), weld());
    if (g.ratio) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: g.ratio, error: 0.001 }));
    // normal maps keep more quality than color/metal-rough maps
    await doc.transform(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [g.tex, g.tex], quality: 86, slots: /^normalTexture$/ }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [g.tex, g.tex], quality: 78, slots: /^(?!normalTexture$).*$/ }),
      prune({ keepAttributes: false }), quantize(),
    );
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const dest = path.join(dir, `${name}.glb`);
    await io.write(dest, doc);
    console.log('gun', name, (fs.statSync(dest).size / 1024).toFixed(0) + ' KB');
  }
}

const cmd = process.argv[2] || 'all';
if (cmd === 'guns') await buildGuns();
if (cmd === 'fetch' || cmd === 'all') { await fetchTextures(); await fetchModels(); await fetchSounds(); }
if (cmd === 'build' || cmd === 'all') { await buildTextures(); await buildModels(); buildSounds(); }
if (cmd === 'sounds') { await fetchSounds(); buildSounds(); }

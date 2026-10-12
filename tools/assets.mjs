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
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
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
  plaster_ochre: { ph: 'rough_plaster_broken', size: 1024 },
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
};

// Poly Haven models -> game asset name
export const MODELS = {
  pistol_ph: { ph: 'service_pistol', tex: 1024, keep: /_a$|magazine_loaded|bullet/ },
  boltrifle_ph: { ph: 'bolt_action_rifle_7_62', tex: 1024 },
  crate_lettered: { ph: 'wooden_crate_02', tex: 512, ratio: 0.5 },
  crate_military: { ph: 'old_military_crate', tex: 512, ratio: 0.35, keep: /_a$/ },
  barrel_red: { ph: 'Barrel_01', tex: 512 },
  barrel_blue: { ph: 'barrel_03', tex: 512 },
  barrel_wood: { ph: 'wine_barrel_01', tex: 512, ratio: 0.5 },
  jerrycan: { ph: 'metal_jerrycan_green', tex: 512, ratio: 0.15 },
  ammo_box: { ph: 'ammo_box', tex: 512, ratio: 0.5 },
  pot_clay: { ph: 'planter_pot_clay', tex: 512 },
  vase_jug: { ph: 'ceramic_vase_04', tex: 512 },
  barrier: { ph: 'concrete_road_barrier', tex: 512, ratio: 0.04 },
  castle_door: { ph: 'large_castle_door', tex: 512, ratio: 0.5 },
  utility_box: { ph: 'utility_box_01', tex: 512 },
};

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
  for (const [id, t] of Object.entries(TEXTURES)) {
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
async function fetchModels() {
  for (const [name, m] of Object.entries(MODELS)) {
    const files = await getJSON(`https://api.polyhaven.com/files/${m.ph}`);
    const g = files.gltf['1k'] ? files.gltf['1k'].gltf : files.gltf[Object.keys(files.gltf)[0]].gltf;
    const dir = path.join(CACHE, 'models', m.ph);
    const main = path.join(dir, path.basename(g.url));
    if (!exists(main)) await get(g.url, main);
    for (const [rel, inc] of Object.entries(g.include || {})) { const d = path.join(dir, rel); if (!exists(d)) await get(inc.url, d); }
    console.log('model', name);
  }
  const soldier = path.join(CACHE, 'models', 'Soldier.glb');
  if (!exists(soldier)) await get('https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Soldier.glb', soldier);
}

// ---------------------------------------------------------------- build
async function buildTextures() {
  const dir = path.join(OUT, 'tex'); fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const [id, t] of Object.entries(TEXTURES)) {
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
  for (const [name, m] of Object.entries(MODELS)) {
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

const cmd = process.argv[2] || 'all';
if (cmd === 'fetch' || cmd === 'all') { await fetchTextures(); await fetchModels(); await fetchSounds(); }
if (cmd === 'build' || cmd === 'all') { await buildTextures(); await buildModels(); buildSounds(); }
if (cmd === 'sounds') { await fetchSounds(); buildSounds(); }

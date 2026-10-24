// Dev tool: scans the original game's asset folder (read-only) and writes studio/assets-builtin/library.json
// with real bounds / triangle counts, so the Studio can place the game's props without loading every file.
// Requires: npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds as bounds } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'fs'; import path from 'path';
const GAME = process.argv[2], OUT = process.argv[3];
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const lib = { generated: new Date().toISOString(), source: 'saint-marrow/assets (read-only scan)', license: 'CC0 1.0 (Poly Haven, https://polyhaven.com)', models: {}, textures: {} };
for (const f of fs.readdirSync(path.join(GAME, 'assets/models')).filter((f) => f.endsWith('.glb')).sort()) {
  const doc = await io.read(path.join(GAME, 'assets/models', f));
  const scene = doc.getRoot().listScenes()[0];
  const b = bounds(scene);
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  const name = f.replace(/\.glb$/, '');
  lib.models['builtin:model/' + name] = {
    id: 'builtin:model/' + name, name, kind: 'model', builtin: true, path: `../saint-marrow/assets/models/${f}`, format: 'glb',
    bounds: { min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)) },
    triangles: Math.round(tris), meshes: doc.getRoot().listMeshes().length, size: fs.statSync(path.join(GAME, 'assets/models', f)).size,
    animations: doc.getRoot().listAnimations().map((a) => a.getName()),
    license: 'CC0 (Poly Haven)', source: 'https://polyhaven.com/a/' + name.toLowerCase(),
  };
}
const texDir = path.join(GAME, 'assets/tex');
for (const f of fs.readdirSync(texDir).filter((f) => f.endsWith('.webp')).sort()) {
  const name = f.replace(/\.webp$/, '');
  lib.textures['builtin:tex/' + name] = { id: 'builtin:tex/' + name, name, kind: 'image', builtin: true, path: `../saint-marrow/assets/tex/${f}`, format: 'webp', size: fs.statSync(path.join(texDir, f)).size, license: 'CC0 (Poly Haven)' };
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(lib, null, 1));
console.log(Object.keys(lib.models).length, 'models,', Object.keys(lib.textures).length, 'textures ->', OUT);

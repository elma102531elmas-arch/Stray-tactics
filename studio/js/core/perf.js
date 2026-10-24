// Performance analysis: budgets, hot spots and hints from plain records (DOM-free, unit-tested), plus timings of the editor's own heavy steps.
// The budgets are the Studio's guidance for a comfortable editor and playtest on a mid-range laptop GPU — they are NOT limits of the original game.

import { worldColliders, sceneBounds } from './geometry.js';
import { CollisionWorld } from './collision.js';
import { buildNavMesh } from './navmesh.js';
import { validateProject } from './validate.js';

export const BUDGETS = [
  { key: 'calls', label: 'Draw calls', unit: '', warn: 800, bad: 1500, hint: 'Each mesh with its own material is one draw call. Repeated props are the usual cause.' },
  { key: 'tris', label: 'Triangles', unit: '', warn: 800_000, bad: 2_000_000, hint: 'Dense models (scans, high-poly props) dominate; check “Heaviest models”.' },
  { key: 'geometries', label: 'Geometries in memory', unit: '', warn: 900, bad: 1800, hint: 'Walls/floors with unique sizes each own a geometry.' },
  { key: 'textureMB', label: 'Texture memory (estimate)', unit: ' MB', warn: 400, bad: 900, hint: 'Estimated as width × height × 4 bytes × 1.33 for mipmaps, per unique texture.' },
  { key: 'lights', label: 'Lights in the scene', unit: '', warn: 40, bad: 120, hint: 'The viewport shades only the nearest lights at a time, but many lights still cost CPU.' },
  { key: 'colliders', label: 'Collision boxes', unit: '', warn: 4000, bad: 12000, hint: 'Affects validation, navigation mesh building and the playtest.' },
];

export const status = (b, v) => (v >= b.bad ? 'bad' : v >= b.warn ? 'warn' : 'ok');
export function evaluate(stats) { return BUDGETS.map((b) => ({ key: b.key, label: b.label, unit: b.unit, value: stats[b.key] ?? 0, warn: b.warn, bad: b.bad, status: status(b, stats[b.key] ?? 0), hint: b.hint })); }

/**
 * records: [{ geo, mat, tris, name, asset?, type? }] one per rendered mesh. Returns hot spots:
 *  repeated  geometries drawn many times (candidates for instancing/merging), heaviest models by triangles × instances, materials by draw calls.
 */
export function aggregate(records) {
  const byGeo = new Map(), byMat = new Map();
  let tris = 0;
  for (const r of records) {
    tris += r.tris;
    const g = byGeo.get(r.geo) || byGeo.set(r.geo, { geo: r.geo, name: r.name, tris: r.tris, instances: 0, asset: r.asset || null }).get(r.geo); g.instances++;
    const m = byMat.get(r.mat) || byMat.set(r.mat, { mat: r.mat, name: r.matName || r.mat, calls: 0 }).get(r.mat); m.calls++;
  }
  const geos = [...byGeo.values()];
  return {
    meshes: records.length, tris,
    repeated: geos.filter((g) => g.instances >= 8).sort((a, b) => b.instances - a.instances).slice(0, 10),
    heaviest: geos.map((g) => ({ ...g, total: g.tris * g.instances })).sort((a, b) => b.total - a.total).slice(0, 10),
    materials: [...byMat.values()].sort((a, b) => b.calls - a.calls).slice(0, 10), uniqueGeometries: geos.length, uniqueMaterials: byMat.size,
  };
}

/** Human-readable suggestions derived from the numbers (each one says what it saves, nothing is applied automatically). */
export function hints(stats, agg) {
  const out = [];
  for (const g of agg.repeated.slice(0, 3)) out.push({ severity: g.instances >= 30 ? 'warn' : 'info', message: `“${g.name}” is drawn ${g.instances} times with the same geometry. Merging or instancing it would save about ${g.instances - 1} draw calls.` });
  if (stats.calls >= 100 && agg.materials[0] && agg.materials[0].calls > stats.calls * 0.25) out.push({ severity: 'info', message: `Material “${agg.materials[0].name}” accounts for ${Math.round((100 * agg.materials[0].calls) / stats.calls)} % of the draw calls; merging static meshes that share it would help most.` });
  const h = agg.heaviest[0]; if (h && h.total > stats.tris * 0.3 && h.total > 100_000) out.push({ severity: 'warn', message: `“${h.name}” (${h.instances}×${h.tris.toLocaleString()} triangles) is ${Math.round((100 * h.total) / stats.tris)} % of all triangles. A lower-poly version would cut the load most.` });
  if (stats.lights > BUDGETS.find((b) => b.key === 'lights').warn) out.push({ severity: 'info', message: `${stats.lights} lights: group them by power group and keep shadows to a few.` });
  if (stats.fps && stats.fps < 20) out.push({ severity: 'info', message: `The viewport runs at ${stats.fps.toFixed(0)} fps. Lower “Render scale” in the View menu, or switch shading to Lit/Wire; render-on-demand already skips idle frames.` });
  return out;
}

/** Wall-clock timings of the editor's heavy steps for the current project (ms). Used by the panel and by the performance test. */
export function measureCore(project) {
  const t = {}, time = (k, f) => { const t0 = performance.now(); const r = f(); t[k] = Math.round(performance.now() - t0); return r; };
  const cols = time('colliders', () => worldColliders(project.scene, project.geoCtx));
  const world = time('collisionWorld', () => new CollisionWorld(cols));
  const bounds = time('bounds', () => sceneBounds(project.scene, project.geoCtx));
  const seeds = project.scene.find((n) => n.type === 'playerSpawn').map((n) => project.scene.worldPosition(n.id));
  const nav = time('navmesh', () => buildNavMesh(world, bounds, { seeds }));
  const v = time('validation', () => validateProject(project));
  return { ms: t, counts: { colliders: cols.length, navNodes: nav.nodes.length, issues: v.issues.length, nodes: project.scene.size } };
}

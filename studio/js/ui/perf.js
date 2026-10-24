// Reads the live viewport: render statistics, a per-mesh census (for hot spots) and a texture memory estimate. The analysis itself is core/perf.js.
import { HELPER_LAYER } from '../viewport/builders.js';
import { aggregate, evaluate, hints } from '../core/perf.js';
import { worldColliders } from '../core/geometry.js';

export function perfSnapshot(app) {
  const vp = app.viewport, scene = app.scene, records = [], textures = new Set();
  let lights = 0;
  const nodeOf = (o) => { for (let p = o; p; p = p.parent) if (p.userData?.nodeId) return scene.get(p.userData.nodeId); return null; };
  vp.scene.traverseVisible((o) => {
    if (o.layers.isEnabled(HELPER_LAYER) && !o.layers.isEnabled(0)) return;
    if (o.isLight) lights++;
    if (!o.isMesh || !o.geometry || o === vp.grid) return;
    const geo = o.geometry, tris = (geo.index ? geo.index.count : geo.attributes.position?.count || 0) / 3;
    for (const m of [].concat(o.material)) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) if (m?.[k]) textures.add(m[k]);
      const nd = nodeOf(o), a = nd?.props?.asset && app.assets.meta(nd.props.asset);
      records.push({ geo: geo.uuid, mat: m?.uuid || 'none', matName: m?.name || m?.type || 'material', tris: tris / [].concat(o.material).length, name: a?.name || nd?.name || geo.name || o.name || geo.type, asset: a?.id || null });
    }
  });
  let texBytes = 0;
  for (const t of textures) { const im = t.image; const w = im?.width || im?.videoWidth || 0, h = im?.height || im?.videoHeight || 0; texBytes += w * h * 4 * (t.generateMipmaps === false ? 1 : 1.33); }
  const info = vp.lastInfo || { calls: 0, tris: 0, geometries: 0, textures: 0 };
  const stats = { fps: vp.fps || 0, calls: info.calls, tris: info.tris, geometries: info.geometries, textures: info.textures, textureMB: Math.round(texBytes / 1048576), lights: Math.max(lights, scene.find((n) => n.type === 'light').length), colliders: colliderCount(app), nodes: scene.size, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
  const agg = aggregate(records);
  return { stats, budgets: evaluate(stats), agg, hints: hints(stats, agg) };
}

/** Collision box count, cached per scene version (building them takes a few ms on a big map; the panel refreshes every second). */
function colliderCount(app) {
  const v = app.scene.version, c = app._perfColliders;
  if (!c || c.version !== v) app._perfColliders = { version: v, n: worldColliders(app.scene, app.project.geoCtx).length };
  return app._perfColliders.n;
}

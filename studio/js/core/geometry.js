// Pure geometry derived from scene data: wall openings, collider boxes, world bounds.
// Shared by the viewport (to build meshes), validation, navigation and playtest,
// so what you see, what collides and what the validator checks always agree.

import * as THREE from '../../lib/three.module.js';
import { localBox, defaultProps } from './schema.js';
import { ROOT_ID } from './scene.js';

const EPS = 1e-4;
const COS_ALIGN = Math.cos(8 * Math.PI / 180);

export const propsOf = (node) => ({ ...defaultProps(node.type), ...node.props });

/** Openings (doors/windows) that cut through a wall, expressed in the wall's local space. */
export function wallOpenings(scene, wall, ctx) {
  const p = propsOf(wall);
  if (!p.autoOpenings) return [];
  const inv = scene.worldMatrix(wall.id).clone().invert();
  const out = [];
  const L = p.length, H = p.height;
  scene.walk((n) => {
    if ((n.type !== 'door' && n.type !== 'window') || !scene.isVisible(n.id)) return;
    const m = inv.clone().multiply(scene.worldMatrix(n.id));
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    const q = new THREE.Quaternion(), sc = new THREE.Vector3();
    m.decompose(new THREE.Vector3(), q, sc);
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    if (Math.abs(ax.x) < COS_ALIGN || up.y < 0.98) return;          // not aligned with the wall plane
    if (Math.abs(pos.z) > p.thick / 2 + 0.06) return;                // not inside the wall thickness
    const np = propsOf(n);
    const w = np.width * Math.abs(sc.x), h = np.height * Math.abs(sc.y);
    const x0 = Math.max(-L / 2, pos.x - w / 2), x1 = Math.min(L / 2, pos.x + w / 2);
    if (x1 - x0 < 0.05) return;                                      // doesn't overlap the wall span
    const y0 = Math.max(0, pos.y), y1 = Math.min(H, pos.y + h);
    if (y1 - y0 < 0.05) return;
    out.push({ nodeId: n.id, type: n.type, x0, x1, y0, y1 });
  });
  out.sort((a, b) => a.x0 - b.x0);
  return out;
}

/** Solid wall pieces after subtracting openings, as local boxes {min,max}. */
export function wallPieces(scene, wall, ctx) {
  const p = propsOf(wall);
  const L = p.length, H = p.height, T = p.thick / 2;
  const ops = wallOpenings(scene, wall, ctx);
  const pieces = [];
  let cursor = -L / 2;
  for (const o of ops) {
    if (o.x0 > cursor + EPS) pieces.push({ min: [cursor, 0, -T], max: [o.x0, H, T] });
    if (o.y0 > EPS) pieces.push({ min: [Math.max(o.x0, cursor), 0, -T], max: [o.x1, o.y0, T] });
    if (o.y1 < H - EPS) pieces.push({ min: [Math.max(o.x0, cursor), o.y1, -T], max: [o.x1, H, T] });
    cursor = Math.max(cursor, o.x1);
  }
  if (cursor < L / 2 - EPS) pieces.push({ min: [cursor, 0, -T], max: [L / 2, H, T] });
  return pieces;
}

/** Local collider boxes of a node. kind: 'solid' | 'ground' | 'door' | 'volume' | 'navBlock' | 'navAllow' */
export function localColliders(scene, node, ctx) {
  const p = propsOf(node);
  const box = (b, kind = 'solid', extra = {}) => ({ min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]], kind, ...extra });
  switch (node.type) {
    case 'wall': return p.collide === 'none' ? [] : wallPieces(scene, node, ctx).map((pc) => ({ min: pc.min, max: pc.max, kind: 'solid' }));
    case 'floor': return p.collide === 'none' ? [] : [box(localBox(node, ctx), 'solid', { walk: true })];
    case 'ceiling': return p.collide === 'none' ? [] : [box(localBox(node, ctx))];
    case 'box': return p.collide === 'none' ? [] : [box(localBox(node, ctx), p.collide === 'walkable' ? 'ground' : 'solid', { walk: true })];
    case 'stairs': {
      const out = [];
      for (let i = 0; i < p.steps; i++) out.push(box([-p.width / 2, 0, i * p.stepD, p.width / 2, (i + 1) * p.stepH, (i + 1) * p.stepD], 'solid', { walk: true }));
      return out;
    }
    case 'door': return [box([-p.width / 2, 0, -0.05, p.width / 2, p.height, 0.05], 'door', { doorId: p.doorId || node.name })];
    case 'window': return [box([-p.width / 2, 0, -Math.min(p.thick, 0.1) / 2, p.width / 2, p.height, Math.min(p.thick, 0.1) / 2])];
    case 'elevator': {
      const t = 0.1;
      return [
        box([-p.w / 2, -t, -p.d / 2, p.w / 2, 0, p.d / 2], 'solid', { walk: true }),
        box([-p.w / 2, 0, -p.d / 2, p.w / 2, p.h, -p.d / 2 + t]),
        box([-p.w / 2, 0, -p.d / 2, -p.w / 2 + t, p.h, p.d / 2]),
        box([p.w / 2 - t, 0, -p.d / 2, p.w / 2, p.h, p.d / 2]),
        box([-p.w / 2, p.h, -p.d / 2, p.w / 2, p.h + t, p.d / 2]),
      ];
    }
    case 'vent': {
      if (p.collide === 'none') return [];
      const t = p.thick, w = p.w / 2, h = p.h;
      return [
        box([-w - t, 0, 0, w + t, t, p.length]), box([-w - t, h + t, 0, w + t, h + 2 * t, p.length]),
        box([-w - t, t, 0, -w, h + t, p.length]), box([w, t, 0, w + t, h + t, p.length]),
      ];
    }
    case 'model': {
      if (p.collision === 'none') return [];
      if (p.collision === 'custom') {
        const c = p.colliderCenter, s = p.colliderSize;
        return [box([c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2, c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2])];
      }
      return [box(localBox(node, ctx))];
    }
    case 'trigger': case 'interaction': case 'checkpoint': case 'arena': case 'audioZone': case 'footstepZone':
      return [box(localBox(node, ctx), 'volume', { shape: p.shape })];
    case 'navBlocker': return [box(localBox(node, ctx), p.mode === 'allow' ? 'navAllow' : 'navBlock', { shape: p.shape })];
    default: return [];
  }
}

/** Terrain height sample (local space of the terrain node). */
export function terrainHeight(p, lx, lz) {
  const n = p.cells, size = p.size;
  const gx = ((lx + size / 2) / size) * n, gz = ((lz + size / 2) / size) * n;
  if (gx < 0 || gz < 0 || gx > n || gz > n) return null;
  const ix = Math.min(n - 1, Math.floor(gx)), iz = Math.min(n - 1, Math.floor(gz));
  const fx = gx - ix, fz = gz - iz;
  const H = (x, z) => (p.heights ? p.heights[z * (n + 1) + x] || 0 : 0);
  const h00 = H(ix, iz), h10 = H(ix + 1, iz), h01 = H(ix, iz + 1), h11 = H(ix + 1, iz + 1);
  return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
}

/** World-space description of one collider box (rotation+translation exact, scale baked into the box). */
export function makeWorldCollider(nodeId, lc, M, idx = 0) {
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  M.decompose(pos, q, s);
  const mn = [lc.min[0] * s.x, lc.min[1] * s.y, lc.min[2] * s.z];
  const mx = [lc.max[0] * s.x, lc.max[1] * s.y, lc.max[2] * s.z];
  const min = [Math.min(mn[0], mx[0]), Math.min(mn[1], mx[1]), Math.min(mn[2], mx[2])];
  const max = [Math.max(mn[0], mx[0]), Math.max(mn[1], mx[1]), Math.max(mn[2], mx[2])];
  const rt = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  const invRT = rt.clone().invert();
  // world AABB
  const aabb = new THREE.Box3();
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) aabb.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(rt));
  return { id: `${nodeId}#${idx}`, nodeId, kind: lc.kind, shape: lc.shape || 'box', doorId: lc.doorId, walk: !!lc.walk, min, max, rt, invRT, quat: q, aabb };
}

/** All colliders of the scene in world space. */
export function worldColliders(scene, ctx, { includeHidden = false } = {}) {
  const out = [];
  scene.walk((n) => {
    if (!includeHidden && !n.visible) return false;
    const lcs = localColliders(scene, n, ctx);
    const M = scene.worldMatrix(n.id);
    lcs.forEach((lc, i) => out.push(makeWorldCollider(n.id, lc, M, i)));
    if (n.type === 'terrain') {
      const p = propsOf(n);
      const c = makeWorldCollider(n.id, { min: [-p.size / 2, -1000, -p.size / 2], max: [p.size / 2, 1000, p.size / 2], kind: 'terrain' }, M, 0);
      c.terrain = { props: p };
      c.walk = true;
      c.aabb = new THREE.Box3().setFromObject(new THREE.Object3D());
      const b = localBox(n, ctx);
      c.aabb = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]).applyMatrix4(M), new THREE.Vector3(b[3], b[4], b[5]).applyMatrix4(M));
      c.aabb.makeEmpty();
      for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) c.aabb.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(M));
      out.push(c);
    }
  });
  return out;
}

export function nodeWorldAABB(scene, id, ctx) {
  const n = scene.get(id);
  const b = localBox(n, ctx);
  const M = scene.worldMatrix(id);
  const box = new THREE.Box3();
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(M));
  return box;
}

/** Bounds of a node including all descendants. */
export function subtreeAABB(scene, id, ctx) {
  const box = new THREE.Box3();
  const add = (n) => { if (n.type !== 'group') box.union(nodeWorldAABB(scene, n.id, ctx)); else box.expandByPoint(scene.worldPosition(n.id)); };
  const n = scene.get(id);
  add(n);
  scene.walk((d) => { add(d); }, id);
  return box;
}

export function sceneBounds(scene, ctx) {
  const box = new THREE.Box3();
  scene.walk((n) => { if (n.type !== 'group' && scene.isVisible(n.id)) box.union(nodeWorldAABB(scene, n.id, ctx)); });
  if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
  return box;
}

/** World-space centre-line points of a patrol path (children waypoints in order). */
export function pathPoints(scene, pathId) {
  return scene.children(pathId).filter((c) => c.type === 'waypoint').map((c) => scene.worldPosition(c.id));
}
export { ROOT_ID };

// Scene & project validation. Each check is a small function so tests (and the UI)
// can run them individually. Issues carry the node ids involved and, where a safe
// automatic repair exists, a `fix` description the UI turns into an undoable command.
//
//   Issue = { code, severity: 'error'|'warn'|'info', message, nodes: [id], fix?: {...} }

import * as THREE from '../../lib/three.module.js';
import { propsOf, nodeWorldAABB, worldColliders, wallOpenings } from './geometry.js';
import { CollisionWorld } from './collision.js';
import { TYPES } from './schema.js';
import { referencedAssets } from './project.js';
import { buildNavMesh } from './navmesh.js';
import { analyzeGraphs } from './events.js';
import { sceneBounds } from './geometry.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const r3 = (v) => Math.round(v * 1000) / 1000;
const issue = (code, severity, message, nodes = [], extra = {}) => ({ code, severity, message, nodes, ...extra });

/** Wall footprint in world XZ: 4 corners of the oriented rectangle (length × thickness), optionally only a slice along its length. */
function wallRect(scene, w, x0 = null, x1 = null) {
  const p = propsOf(w), M = scene.worldMatrix(w.id), T = p.thick / 2;
  const a = x0 ?? -p.length / 2, b = x1 ?? p.length / 2;
  return [[a, -T], [b, -T], [b, T], [a, T]].map(([x, z]) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(M); return [v.x, v.z]; });
}
function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / l2));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}
/** Distance between two convex quads (0 when they overlap or touch). */
function quadDistance(A, B) {
  const axes = [];
  for (const Q of [A, B]) for (let i = 0; i < 4; i++) { const [x0, z0] = Q[i], [x1, z1] = Q[(i + 1) % 4]; axes.push([-(z1 - z0), x1 - x0]); }
  let separated = false;
  for (const [nx, nz] of axes) {
    const len = Math.hypot(nx, nz) || 1;
    const pr = (Q) => { let lo = Infinity, hi = -Infinity; for (const [x, z] of Q) { const d = (x * nx + z * nz) / len; if (d < lo) lo = d; if (d > hi) hi = d; } return [lo, hi]; };
    const [a0, a1] = pr(A), [b0, b1] = pr(B);
    if (a1 < b0 - 1e-9 || b1 < a0 - 1e-9) { separated = true; break; }
  }
  if (!separated) return 0;
  let best = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) for (const [px, pz] of P) for (let i = 0; i < 4; i++) { const [x0, z0] = Q[i], [x1, z1] = Q[(i + 1) % 4]; best = Math.min(best, segDist(px, pz, x0, z0, x1, z1)); }
  return best;
}
const quadBox = (Q) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, z] of Q) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); } return [a, b, c, d]; };

// ---------------------------------------------------------------- individual checks
export const checks = {};

/** Wall ends that almost, but do not, meet another wall (a visible crack). Compares the END CAP of a wall with the footprint of every other wall. */
checks.wallGaps = (ctx) => {
  const { scene } = ctx;
  const out = [];
  const MAXGAP = 0.15, CAP = 0.02;
  const seen = new Set();   // the same crack is seen from both walls; report it once
  const walls = scene.find((n) => n.type === 'wall' && scene.isVisible(n.id)).map((n) => {
    const p = propsOf(n), rect = wallRect(scene, n);
    return { n, p, rect, box: quadBox(rect), y: new THREE.Vector3().setFromMatrixPosition(scene.worldMatrix(n.id)).y };
  });
  for (const A of walls) {
    for (const endName of ['start', 'end']) {
      const L = A.p.length;
      const cap = endName === 'start' ? wallRect(scene, A.n, -L / 2, -L / 2 + CAP) : wallRect(scene, A.n, L / 2 - CAP, L / 2);
      const cb = quadBox(cap);
      let touching = false, near = null;
      for (const B of walls) {
        if (A === B) continue;
        if (Math.abs(A.y - B.y) > 0.05 || Math.abs(A.p.height - B.p.height) > 0.5) continue;
        if (B.box[0] > cb[2] + MAXGAP || B.box[2] < cb[0] - MAXGAP || B.box[1] > cb[3] + MAXGAP || B.box[3] < cb[1] - MAXGAP) continue;
        const gap = quadDistance(cap, B.rect);
        if (gap <= 0.002) { touching = true; break; }
        if (gap <= MAXGAP && (!near || gap < near.gap)) near = { gap, B };
      }
      const pair = near && [A.n.id, near.B.n.id].sort().join('|') + '|' + near.gap.toFixed(2);
      if (!touching && near && !seen.has(pair)) {
        seen.add(pair);
        out.push(issue('wall-gap', 'warn', `Wall "${A.n.name}" ${endName} ends ${r3(near.gap)} m short of "${near.B.n.name}" (visible crack).`, [A.n.id, near.B.n.id],
          { fix: { type: 'extendWall', wallId: A.n.id, end: endName, by: r3(near.gap) } }));
      }
    }
  }
  return out;
};

/** Door/window volumes that overlap each other. */
checks.overlappingOpenings = (ctx) => {
  const { scene, geo } = ctx;
  const out = [];
  const items = scene.find((n) => (n.type === 'door' || n.type === 'window') && scene.isVisible(n.id)).map((n) => ({ n, box: nodeWorldAABB(scene, n.id, geo) }));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].box, b = items[j].box;
    const ix = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
    const iy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
    const iz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
    if (ix > 0.02 && iy > 0.02 && iz > 0.02) out.push(issue('overlapping-openings', 'error', `"${items[i].n.name}" and "${items[j].n.name}" overlap (${r3(ix)} × ${r3(iy)} × ${r3(iz)} m).`, [items[i].n.id, items[j].n.id]));
  }
  return out;
};

/** Doors/windows that are not properly inside a wall. */
checks.openingPlacement = (ctx) => {
  const { scene, geo } = ctx;
  const out = [];
  const walls = scene.find((n) => n.type === 'wall' && scene.isVisible(n.id));
  const cutBy = new Map();
  for (const w of walls) for (const o of wallOpenings(scene, w, geo)) { if (!cutBy.has(o.nodeId)) cutBy.set(o.nodeId, []); cutBy.get(o.nodeId).push(w.id); }
  scene.walk((n) => {
    if (n.type !== 'door' && n.type !== 'window') return;
    if (cutBy.has(n.id)) return;
    const box = nodeWorldAABB(scene, n.id, geo).expandByScalar(0.35);
    // find a nearby wall that is almost aligned and report why it did not cut
    let hint = null;
    for (const w of walls) {
      const wb = nodeWorldAABB(scene, w.id, geo);
      if (!box.intersectsBox(wb)) continue;
      const inv = scene.worldMatrix(w.id).clone().invert();
      const m = inv.multiply(scene.worldMatrix(n.id));
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      const q = new THREE.Quaternion(); m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y * 180 / Math.PI;
      hint = { w, offsetZ: pos.z, yaw };
      break;
    }
    if (hint) {
      const wp = propsOf(hint.w);
      const yawErr = ((Math.abs(hint.yaw) % 180) + 180) % 180; const yawOff = Math.min(yawErr, 180 - yawErr);
      const reasons = [];
      if (Math.abs(hint.offsetZ) > wp.thick / 2 + 0.06) reasons.push(`it sits ${r3(Math.abs(hint.offsetZ))} m off the wall centre-line`);
      if (yawOff > 8) reasons.push(`it is rotated ${r3(yawOff)}° relative to the wall`);
      if (!reasons.length) reasons.push('it is outside the wall span or too small to cut');
      out.push(issue('opening-misaligned', 'warn', `${TYPES[n.type].label} "${n.name}" does not cut "${hint.w.name}": ${reasons.join(' and ')}.`, [n.id, hint.w.id],
        { fix: { type: 'alignOpening', nodeId: n.id, wallId: hint.w.id } }));
    } else {
      out.push(issue('opening-orphan', 'info', `${TYPES[n.type].label} "${n.name}" is not inside any wall (free-standing).`, [n.id]));
    }
  });
  return out;
};

/** Props hovering above the floor. */
checks.floating = (ctx) => {
  const { scene, geo, world } = ctx;
  const out = [];
  scene.walk((n) => {
    if (!scene.isVisible(n.id)) return false;
    if (!(n.type === 'model' || (n.type === 'box' && n.props.collide !== 'none'))) return;
    if (n.tags?.includes('mounted') || n.tags?.includes('structural')) return;
    const box = nodeWorldAABB(scene, n.id, geo);
    const ys = box.min.y;
    const pts = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
    let support = -Infinity;
    for (const [fx, fz] of pts) {
      const x = box.min.x + (box.max.x - box.min.x) * fx, z = box.min.z + (box.max.z - box.min.z) * fz;
      const hit = world.raycast(new THREE.Vector3(x, ys + 0.03, z), DOWN, 30, { ignore: new Set([n.id]), doors: false, kinds: new Set(['solid', 'ground', 'terrain']) });
      if (hit && hit.point.y > support) support = hit.point.y;
    }
    if (support === -Infinity) { out.push(issue('floating-no-ground', 'warn', `"${n.name}" has nothing underneath it.`, [n.id])); return; }
    const gap = ys - support;
    if (gap > 0.05) out.push(issue('floating', 'warn', `"${n.name}" floats ${r3(gap)} m above the surface below.`, [n.id], { fix: { type: 'dropToSurface', nodeId: n.id, dy: -r3(gap) } }));
    else if (gap < -0.25) out.push(issue('buried', 'info', `"${n.name}" is sunk ${r3(-gap)} m into the surface below.`, [n.id]));
  });
  return out;
};

/** Custom colliders that do not match the visible model. */
checks.colliderMatch = (ctx) => {
  const { scene, project } = ctx;
  const out = [];
  scene.walk((n) => {
    if (n.type !== 'model') return;
    const p = propsOf(n);
    const a = project?.data.assets?.[p.asset];
    if (p.collision !== 'custom' || !a?.bounds) return;
    const cs = p.colliderSize, cc = p.colliderCenter;
    const bs = [a.bounds.max[0] - a.bounds.min[0], a.bounds.max[1] - a.bounds.min[1], a.bounds.max[2] - a.bounds.min[2]];
    const bc = [(a.bounds.max[0] + a.bounds.min[0]) / 2 + p.pivot[0], (a.bounds.max[1] + a.bounds.min[1]) / 2 + p.pivot[1], (a.bounds.max[2] + a.bounds.min[2]) / 2 + p.pivot[2]];
    const off = Math.hypot(cc[0] - bc[0], cc[1] - bc[1], cc[2] - bc[2]);
    const diag = Math.hypot(...bs);
    const ratio = (cs[0] * cs[1] * cs[2]) / Math.max(1e-6, bs[0] * bs[1] * bs[2]);
    if (off > diag * 0.35) out.push(issue('collider-offset', 'warn', `Collider of "${n.name}" is ${r3(off)} m away from the model's centre — it will not match what you see.`, [n.id]));
    else if (ratio < 0.2 || ratio > 5) out.push(issue('collider-size', 'warn', `Collider of "${n.name}" is ${ratio < 1 ? 'much smaller' : 'much larger'} than the model (volume ratio ${r3(ratio)}).`, [n.id]));
  });
  return out;
};

/** Decals that float away from walls/floors or face the wrong way. */
checks.decals = (ctx) => {
  const { scene, world } = ctx;
  const out = [];
  scene.walk((n) => {
    if (n.type !== 'decal' || !scene.isVisible(n.id)) return;
    const p = propsOf(n);
    const M = scene.worldMatrix(n.id);
    const pos = new THREE.Vector3().setFromMatrixPosition(M);
    const q = new THREE.Quaternion(); M.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const hit = world.raycast(pos.clone().addScaledVector(normal, 0.01), normal.clone().negate(), 0.6, { doors: false, kinds: new Set(['solid', 'ground', 'terrain', 'door']) });
    if (!hit) { out.push(issue('decal-floating', 'warn', `Decal "${n.name}" has no surface behind it (it floats in the air).`, [n.id])); return; }
    const gap = hit.t - 0.01;
    if (gap > p.surfaceTolerance) out.push(issue('decal-gap', 'warn', `Decal "${n.name}" floats ${r3(gap)} m in front of the surface.`, [n.id], { fix: { type: 'snapDecal', nodeId: n.id, gap: r3(gap) } }));
    const ang = Math.acos(Math.min(1, Math.max(-1, normal.dot(hit.normal)))) * 180 / Math.PI;
    if (ang > 12) out.push(issue('decal-tilt', 'warn', `Decal "${n.name}" is tilted ${r3(ang)}° away from the surface.`, [n.id], { fix: { type: 'alignDecal', nodeId: n.id } }));
  });
  return out;
};

/** Interaction volumes the player cannot comfortably reach. */
checks.interactions = (ctx) => {
  const { scene, geo } = ctx;
  const out = [];
  const nodes = scene.find((n) => scene.isVisible(n.id));
  for (const n of nodes) {
    let label = null, eye = 1.62;
    if (n.type === 'interaction') { label = 'Interaction volume'; eye = propsOf(n).reachHeight; } else if (n.type === 'model' && n.props.interaction?.enabled) { label = 'Model interaction'; } else continue;
    const c = nodeWorldAABB(scene, n.id, geo).getCenter(new THREE.Vector3());
    const dh = 0.9;                       // comfortable standing distance in front of the target
    const pitch = Math.atan2(c.y - eye, dh) * 180 / Math.PI;
    const crouchPitch = Math.atan2(c.y - 1.05, dh) * 180 / Math.PI;
    if (Math.abs(pitch) > 50) out.push(issue('interaction-out-of-reach', 'error', `${label} "${n.name}" is centred at y=${r3(c.y)} m: a standing player (eye ${eye} m) must look ${r3(Math.abs(pitch))}° ${pitch > 0 ? 'up' : 'down'} from ${dh} m away.`, [n.id], { fix: { type: 'lowerInteraction', nodeId: n.id, targetY: 1.3 } }));
    else if (Math.abs(pitch) > 35) out.push(issue('interaction-awkward', 'warn', `${label} "${n.name}" needs a ${r3(Math.abs(pitch))}° look ${pitch > 0 ? 'up' : 'down'} when standing (${r3(Math.abs(crouchPitch))}° when crouching).`, [n.id]));
  }
  return out;
};

/** Spawns inside geometry or in mid-air; scene without a player spawn. */
checks.spawns = (ctx) => {
  const { scene, world } = ctx;
  const out = [];
  let players = 0;
  scene.walk((n) => {
    if (!['playerSpawn', 'enemySpawn', 'itemSpawn'].includes(n.type) || !scene.isVisible(n.id)) return;
    if (n.type === 'playerSpawn') players++;
    const pos = scene.worldPosition(n.id);
    const h = n.type === 'itemSpawn' ? 0.3 : 1.7;
    const hit = world.sphereHit(new THREE.Vector3(pos.x, pos.y + h / 2 + 0.2, pos.z), 0.25, { doors: false });
    if (hit && n.type === 'enemySpawn' && n.props.dormant) out.push(issue('spawn-dormant-overlap', 'info', `Dormant enemy "${n.name}" overlaps "${hit.collider.nodeId}" (fine if it is meant to lie on it).`, [n.id]));
    else if (hit) out.push(issue('spawn-embedded', 'error', `${TYPES[n.type].label} "${n.name}" is inside solid geometry ("${hit.collider.nodeId}").`, [n.id]));
    const g = world.groundAt(pos.x, pos.z, pos.y + 0.5, pos.y - 3);
    if (g === null) out.push(issue('spawn-no-ground', 'warn', `${TYPES[n.type].label} "${n.name}" has no ground within 3 m below it.`, [n.id]));
    else if (pos.y - g > 0.3) out.push(issue('spawn-floating', 'warn', `${TYPES[n.type].label} "${n.name}" is ${r3(pos.y - g)} m above the ground.`, [n.id], { fix: { type: 'dropToSurface', nodeId: n.id, dy: -r3(pos.y - g) } }));
  });
  if (players === 0 && scene.size > 0) out.push(issue('no-player-spawn', 'warn', 'The map has no player spawn.', []));
  return out;
};

/** Pairs of solid objects that interpenetrate (excluding expected joints). */
checks.intersections = (ctx) => {
  const { scene, world } = ctx;
  const out = [];
  const SKIP_TYPES = new Set(['wall', 'floor', 'ceiling', 'door', 'window', 'vent']);
  const solids = world.list.filter((c) => c.kind === 'solid');
  const byNode = new Map();
  for (const c of solids) { if (!byNode.has(c.nodeId)) byNode.set(c.nodeId, []); byNode.get(c.nodeId).push(c); }
  const ids = [...byNode.keys()];
  let count = 0;
  for (let i = 0; i < ids.length && count < 200; i++) {
    const A = scene.get(ids[i]);
    for (let j = i + 1; j < ids.length && count < 200; j++) {
      const B = scene.get(ids[j]);
      if (SKIP_TYPES.has(A.type) && SKIP_TYPES.has(B.type)) continue;
      if (scene.isDescendant(A.id, B.id) || scene.isDescendant(B.id, A.id)) continue;
      let worst = 0;
      for (const ca of byNode.get(A.id)) for (const cb of byNode.get(B.id)) {
        if (!ca.aabb.intersectsBox(cb.aabb)) continue;
        const ix = Math.min(ca.aabb.max.x, cb.aabb.max.x) - Math.max(ca.aabb.min.x, cb.aabb.min.x);
        const iy = Math.min(ca.aabb.max.y, cb.aabb.max.y) - Math.max(ca.aabb.min.y, cb.aabb.min.y);
        const iz = Math.min(ca.aabb.max.z, cb.aabb.max.z) - Math.max(ca.aabb.min.z, cb.aabb.min.z);
        const depth = Math.min(ix, iy, iz);
        if (depth > worst) worst = depth;
      }
      if (worst > 0.06) { out.push(issue('intersection', 'info', `"${A.name}" and "${B.name}" intersect by about ${r3(worst)} m.`, [A.id, B.id])); count++; }
    }
  }
  return out;
};

/** Triggers/interactions/etc. with missing or suspicious settings. */
checks.logicVolumes = (ctx) => {
  const { scene } = ctx;
  const out = [];
  const seenDoor = new Map(), seenCp = new Map();
  scene.walk((n) => {
    const p = propsOf(n);
    if (n.type === 'trigger') {
      if (!p.onEnter && !p.onExit) out.push(issue('trigger-no-event', 'warn', `Trigger "${n.name}" has no enter/exit event, so it does nothing.`, [n.id]));
      if (p.filter === 'player' && Math.min(p.size[0], p.size[2]) < 0.6) out.push(issue('trigger-small', 'info', `Trigger "${n.name}" is narrower than a player (${r3(Math.min(p.size[0], p.size[2]))} m); it can be skipped over.`, [n.id]));
    }
    if (n.type === 'interaction' && !p.event && !p.requires) out.push(issue('interaction-no-event', 'warn', `Interaction "${n.name}" has no event, so using it does nothing.`, [n.id]));
    if (n.type === 'door') {
      const id = p.doorId || n.name;
      if (seenDoor.has(id)) out.push(issue('duplicate-door-id', 'error', `Door ID "${id}" is used by both "${seenDoor.get(id)}" and "${n.name}".`, [n.id]));
      else seenDoor.set(id, n.name);
      if (p.state === 'open' && p.locked) out.push(issue('door-open-but-locked', 'warn', `Door "${n.name}" starts open but is also marked locked ("${p.locked}") — it will look locked yet stand open.`, [n.id], { fix: { type: 'setProp', nodeId: n.id, key: 'state', value: 'closed' } }));
    }
    if (n.type === 'checkpoint') {
      const id = p.checkpointId || n.name;
      if (seenCp.has(id)) out.push(issue('duplicate-checkpoint-id', 'error', `Checkpoint ID "${id}" is used twice ("${seenCp.get(id)}" and "${n.name}").`, [n.id]));
      else seenCp.set(id, n.name);
    }
  });
  return out;
};

/** Project-level cross-references: assets, materials, event names. */
checks.references = (ctx) => {
  const { project, scene } = ctx;
  const out = [];
  if (!project) return out;
  const assets = project.data.assets;
  const mats = project.data.materials;
  const isBuiltin = (id) => typeof id === 'string' && id.startsWith('builtin:');
  for (const [id, where] of referencedAssets(project)) {
    if (!isBuiltin(id) && !assets[id]) out.push(issue('missing-asset', 'error', `Asset "${id}" is referenced (${where.slice(0, 3).join(', ')}) but is not in the project.`, []));
  }
  scene.walk((n) => {
    const m = n.props.material;
    if (m && !mats[m] && !m.startsWith('mat_') && !isBuiltin(m)) out.push(issue('missing-material', 'warn', `"${n.name}" uses material "${m}" which does not exist.`, [n.id]));
    if (n.type === 'model' && !n.props.asset) out.push(issue('model-no-asset', 'warn', `Model "${n.name}" has no asset assigned.`, [n.id]));
    if (n.type === 'audioSource' && !n.props.asset) out.push(issue('audio-no-asset', 'warn', `Audio source "${n.name}" has no sound assigned.`, [n.id]));
  });
  // events: fired by scene objects must be handled; names listened to must be fired by something
  const { handled: graphHandled, emitted: graphEmitted } = analyzeGraphs(project);
  const handled = new Set(graphHandled);
  for (const s of Object.values(project.data.sequences || {})) handled.add('seq:' + s.name);
  const fired = new Map(), consumed = new Map();
  const put = (m, k, id) => { if (!m.has(k)) m.set(k, []); m.get(k).push(id); };
  scene.walk((n) => {
    const p = propsOf(n);
    for (const k of ['onEnter', 'onExit']) if (typeof p[k] === 'string' && p[k]) put(fired, p[k], n.id);
    if ((n.type === 'interaction' || n.type === 'itemSpawn') && p.event) put(fired, p.event, n.id);
    if (n.type === 'model' && p.interaction?.enabled && p.interaction.event) put(fired, p.interaction.event, n.id);
    for (const k of ['playOnEvent', 'spawnOn']) if (typeof p[k] === 'string' && p[k]) { put(consumed, p[k], n.id); handled.add(p[k]); }
  });
  for (const [ev, ids] of fired) if (!handled.has(ev)) out.push(issue('unhandled-event', 'warn', `Event "${ev}" is fired by ${ids.length} object(s) but no event graph (or sound/spawn setting) listens to it.`, ids.slice(0, 5)));
  const known = new Set([...fired.keys(), ...graphEmitted, 'start']);
  for (const [ev, ids] of consumed) if (!known.has(ev)) out.push(issue('event-never-fired', 'warn', `"${ev}" is waited for by ${ids.length} object(s) but nothing ever fires it.`, ids.slice(0, 5)));
  for (const ev of graphHandled) if (!known.has(ev) && !ev.startsWith('seq:')) out.push(issue('event-never-fired', 'info', `An event graph listens for "${ev}" but no object or graph fires it (it may be emitted by a plugin or the game code).`, []));
  return out;
};

/** Navigation: interactions and spawns that cannot be reached. */
checks.reachability = (ctx) => {
  const { scene, world, geo } = ctx;
  const out = [];
  const spawns = scene.find((n) => n.type === 'playerSpawn').map((n) => scene.worldPosition(n.id));
  if (!spawns.length) return out;
  const nav = buildNavMesh(world, sceneBounds(scene, geo), { seeds: spawns });
  ctx.nav = nav;
  if (nav.stats.nodes === 0) return out;
  scene.walk((n) => {
    if (!scene.isVisible(n.id)) return;
    if (n.type === 'interaction' || n.type === 'itemSpawn' || (n.type === 'model' && n.props.interaction?.enabled)) {
      const c = nodeWorldAABB(scene, n.id, geo);
      const p = c.getCenter(new THREE.Vector3()); p.y = c.min.y;
      const near = nav.nearest(new THREE.Vector3(p.x, c.min.y, p.z), 2.6, 4);
      if (!near || !near.reachable) out.push(issue('unreachable', 'error', `${TYPES[n.type].label} "${n.name}" cannot be reached on foot from the player spawn.`, [n.id]));
    }
    if (n.type === 'enemySpawn' || n.type === 'waypoint') {
      const p = scene.worldPosition(n.id);
      const near = nav.nearest(p, 1.2, 2);
      if (!near) out.push(issue('off-navmesh', 'warn', `${TYPES[n.type].label} "${n.name}" is not on walkable ground (enemies there cannot navigate).`, [n.id]));
    }
  });
  return out;
};

/** Static problems inside event graphs (dangling references, unreachable nodes, event loops). */
checks.eventGraphs = (ctx) => (ctx.project ? analyzeGraphs(ctx.project).issues.map((i) => issue(i.code, i.severity, i.message, [], { graph: i.graph, graphNode: i.node })) : []);

// ---------------------------------------------------------------- driver
export const CHECK_ORDER = ['wallGaps', 'overlappingOpenings', 'openingPlacement', 'floating', 'colliderMatch', 'decals', 'interactions', 'spawns', 'intersections', 'logicVolumes', 'references', 'eventGraphs', 'reachability'];

export function makeValidationContext(project) {
  const geo = project.geoCtx;
  const world = new CollisionWorld(worldColliders(project.scene, geo));
  return { project, scene: project.scene, geo, world };
}

/** Run all (or selected) checks. Returns {issues, counts, ms}. */
export function validateProject(project, { only = null } = {}) {
  const t0 = Date.now();
  const ctx = makeValidationContext(project);
  const issues = [];
  for (const name of CHECK_ORDER) {
    if (only && !only.includes(name)) continue;
    try { issues.push(...checks[name](ctx)); } catch (e) { issues.push(issue('validator-error', 'error', `Check "${name}" crashed: ${e.message}`, [])); }
  }
  const counts = { error: 0, warn: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return { issues, counts, ms: Date.now() - t0 };
}

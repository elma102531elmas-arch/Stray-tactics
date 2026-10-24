// Turns validator "fix" descriptors into undoable commands. DOM-free so tests can apply and verify them.
import * as THREE from '../../lib/three.module.js';
import { setTransforms, setProps, batch } from './commands.js';
import { makeValidationContext } from './validate.js';
import { propsOf, nodeWorldAABB } from './geometry.js';

const D2R = Math.PI / 180;
const r4 = (v) => Math.round(v * 10000) / 10000;

function moveWorld(scene, id, delta) {
  const n = scene.get(id);
  const w = scene.worldMatrix(id).clone();
  w.setPosition(new THREE.Vector3().setFromMatrixPosition(w).add(delta));
  return setTransforms([{ id, t: scene.localTransformFromWorld(n.parent, w) }], { label: 'Fix: move' });
}

export function fixCommand(project, fix) {
  const scene = project.scene;
  const need = (id) => { const n = scene.get(id); if (!n) throw new Error('The object this fix refers to no longer exists.'); return n; };
  switch (fix.type) {
    case 'extendWall': {
      const w = need(fix.wallId);
      const p = propsOf(w);
      const sx = Math.abs(w.t.s[0]) || 1;
      const by = fix.by / sx;
      const axis = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(w.t.r[0] * D2R, w.t.r[1] * D2R, w.t.r[2] * D2R, 'XYZ'));
      const dir = fix.end === 'start' ? -1 : 1;
      const np = [w.t.p[0] + axis.x * dir * fix.by / 2, w.t.p[1] + axis.y * dir * fix.by / 2, w.t.p[2] + axis.z * dir * fix.by / 2].map(r4);
      return batch(`Fix: extend wall ${w.name}`, [setProps(w.id, { length: r4(p.length + by) }), setTransforms([{ id: w.id, t: { p: np } }])]);
    }
    case 'dropToSurface': { need(fix.nodeId); return moveWorld(scene, fix.nodeId, new THREE.Vector3(0, fix.dy, 0)); }
    case 'snapDecal': {
      const n = need(fix.nodeId);
      const q = new THREE.Quaternion(); scene.worldMatrix(n.id).decompose(new THREE.Vector3(), q, new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      return moveWorld(scene, n.id, normal.multiplyScalar(-fix.gap));
    }
    case 'alignDecal': {
      const n = need(fix.nodeId);
      const ctx = makeValidationContext(project);
      const M = scene.worldMatrix(n.id);
      const pos = new THREE.Vector3().setFromMatrixPosition(M);
      const q = new THREE.Quaternion(); M.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const hit = ctx.world.raycast(pos.clone().addScaledVector(normal, 0.01), normal.clone().negate(), 0.6, { doors: false, kinds: new Set(['solid', 'ground', 'terrain', 'door']) });
      if (!hit) throw new Error('No surface found behind the decal to align it to.');
      const target = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
      // keep the decal's roll about its own normal
      const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), new THREE.Euler().setFromQuaternion(q, 'ZXY').z);
      const finalQ = target.multiply(roll);
      const p = hit.point.clone().addScaledVector(hit.normal, 0.004);
      const s = new THREE.Vector3(); M.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
      const w = new THREE.Matrix4().compose(p, finalQ, s);
      return setTransforms([{ id: n.id, t: scene.localTransformFromWorld(n.parent, w) }], { label: 'Fix: align decal' });
    }
    case 'lowerInteraction': {
      const n = need(fix.nodeId);
      const c = nodeWorldAABB(scene, n.id, project.geoCtx).getCenter(new THREE.Vector3());
      return moveWorld(scene, n.id, new THREE.Vector3(0, fix.targetY - c.y, 0));
    }
    case 'alignOpening': {
      const n = need(fix.nodeId), wall = need(fix.wallId);
      const wm = scene.worldMatrix(wall.id).clone();
      const inv = wm.clone().invert();
      const lp = new THREE.Vector3().setFromMatrixPosition(scene.worldMatrix(n.id)).applyMatrix4(inv);
      lp.z = 0;
      const wq = new THREE.Quaternion(); wm.decompose(new THREE.Vector3(), wq, new THREE.Vector3());
      const nq = new THREE.Quaternion(); scene.worldMatrix(n.id).decompose(new THREE.Vector3(), nq, new THREE.Vector3());
      const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      const alt = wq.clone().multiply(flip);
      const useQ = nq.angleTo(wq) <= nq.angleTo(alt) ? wq : alt;
      const s = new THREE.Vector3(); scene.worldMatrix(n.id).decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
      const w = new THREE.Matrix4().compose(lp.applyMatrix4(wm), useQ, s);
      return setTransforms([{ id: n.id, t: scene.localTransformFromWorld(n.parent, w) }], { label: 'Fix: align opening to wall' });
    }
    case 'setProp': { need(fix.nodeId); return setProps(fix.nodeId, { [fix.key]: fix.value }); }
    default: throw new Error(`Unknown fix type "${fix.type}".`);
  }
}

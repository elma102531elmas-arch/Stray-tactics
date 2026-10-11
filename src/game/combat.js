// Shared weapon state + hitscan logic used by the local player and bots.
import * as THREE from 'three';
import { WEAPONS } from '../weapons/weapons.js';

export class GunState {
  constructor(id) {
    this.id = id; this.def = WEAPONS[id];
    this.mag = this.def.mag || 0; this.reserve = this.def.reserve || 0;
    this.nextFire = 0; this.reloading = false; this.reloadEnd = 0;
    this.spray = 0; this.lastShot = -10; this.spreadAdd = 0;
  }
  refill() { this.mag = this.def.mag || 0; this.reserve = this.def.reserve || 0; this.reloading = false; this.spray = 0; }
}

const _hit = {}, _o = new THREE.Vector3(), _d = new THREE.Vector3();
const ZONE_MULT = (def, zone) => zone === 'head' ? def.head : zone === 'chest' ? def.chest : zone === 'stomach' ? def.stomach : zone === 'legs' ? def.legs : 0.9;

// Fire one hitscan bullet. Returns {end, hitActor, zone, normal, mat}
export function traceShot(game, shooter, origin, dir, range) {
  const col = game.world.collision;
  const wh = col.raycast(origin, dir, range, _hit);
  let maxT = wh ? wh.t : range;
  let best = null, bestZone = null;
  for (const a of game.actors) {
    if (a === shooter || !a.alive) continue;
    // cheap reject: distance from ray to actor
    _o.subVectors(a.pos, origin);
    const along = _o.dot(dir);
    if (along < 0 || along > maxT + 1) continue;
    _d.copy(dir).multiplyScalar(along).sub(_o);
    if (_d.x * _d.x + _d.z * _d.z > 1.2) continue;
    const r = a.raycast(origin, dir, maxT);
    if (r && r.t < maxT) { maxT = r.t; best = a; bestZone = r.zone; }
  }
  const end = origin.clone().addScaledVector(dir, maxT);
  if (best) return { end, actor: best, zone: bestZone, t: maxT };
  if (wh) return { end, actor: null, normal: wh.normal.clone(), mat: wh.mat, t: maxT };
  return { end, actor: null, t: maxT };
}

export function damageFor(def, zone, dist) {
  const fall = Math.pow(def.falloff || 1, dist / 10);
  return def.dmg * ZONE_MULT(def, zone) * fall;
}

// current inaccuracy (radians, cone half-angle-ish)
export function spreadFor(def, st) {
  let s = def.spread;
  if (def.scope && !st.scoped) s = def.unscopedSpread || s;
  s += def.moveSpread * Math.min(1, st.speedFrac);
  if (!st.onGround) s += def.jumpSpread;
  if (st.crouch) s *= def.crouchMul || 1;
  s += st.sprayAdd || 0;
  return s;
}

export function applySpread(dir, spread, out = new THREE.Vector3()) {
  // random point in a disc, gaussian-ish toward the center
  const a = Math.random() * Math.PI * 2, r = spread * Math.sqrt(Math.random()) * (0.5 + 0.5 * Math.random());
  const up = Math.abs(dir.y) > 0.95 ? _X : _Yv;
  const right = _r.crossVectors(dir, up).normalize(); const up2 = _u.crossVectors(right, dir).normalize();
  return out.copy(dir).addScaledVector(right, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r).normalize();
}
const _X = new THREE.Vector3(1, 0, 0), _Yv = new THREE.Vector3(0, 1, 0), _r = new THREE.Vector3(), _u = new THREE.Vector3();

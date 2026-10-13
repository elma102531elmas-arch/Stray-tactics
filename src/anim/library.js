// Animation library: built-in clips + user overrides saved by the Animation
// Studio (localStorage). get(weapon, clipName) returns the active clip.
//
// Built-in clips were authored on reference guns. Keys tagged with an anchor
// (k.a = 'mag' | 'charge' | 'port') are retargeted to the actual weapon: the
// hand keeps the same position relative to that feature (magazine, charging
// handle...) instead of relative to the hand socket, and keeps its absolute
// orientation when the socket orientation differs. Clips of weapons without
// their own set come from CLIP_SOURCE (e.g. the M4 reuses the rifle clips).
import * as THREE from 'three';
import { DEFAULT_CLIPS, CLIP_SOURCE, CLIP_HIP } from './defaults.js';
import { WEAPONS } from '../weapons/weapons.js';
import { sortClip } from './clip.js';
import { store } from '../core/settings.js';
import { weaponAnchors } from '../weapons/models.js';
import { DEG } from '../core/util.js';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

export function retargetClip(clip, kind) {
  if (!clip || clip.baked === kind) return clip;
  const R = weaponAnchors(clip.weapon, true), W = weaponAnchors(kind);
  const c = JSON.parse(JSON.stringify(clip));
  c.baked = kind;
  if (!R || !W) return c;
  retargetHip(c, CLIP_HIP[clip.weapon], WEAPONS[kind] && WEAPONS[kind].vm.hip);
  for (const [track, base, baseQ] of [['lhand', 'fore', 'foreQ'], ['rhand', 'grip', 'gripQ']]) {
    for (const k of c.tracks[track] || []) {
      if (!k.a || !R[k.a] || !W[k.a] || !R[base] || !W[base]) continue;
      for (let i = 0; i < 3; i++) k.p[i] = +(k.p[i] + (W[k.a][i] - W[base][i]) - (R[k.a][i] - R[base][i])).toFixed(4);
      if (R[baseQ] && W[baseQ] && Math.abs(R[baseQ].dot(W[baseQ])) < 0.9999) {
        // same absolute hand orientation on the new socket frame
        _q.setFromEuler(_e.set(k.r[0] * DEG, k.r[1] * DEG, k.r[2] * DEG));
        _q2.copy(W[baseQ]).invert().multiply(R[baseQ]).multiply(_q);
        _e.setFromQuaternion(_q2);
        k.r = [+(_e.x / DEG).toFixed(2), +(_e.y / DEG).toFixed(2), +(_e.z / DEG).toFixed(2)];
      }
    }
  }
  return c;
}

// keep the absolute gun stance of keys far from rest (reload/inspect poses)
// when the weapon's hip pose differs from the one the clip was authored on
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qk = new THREE.Quaternion(), _qd = new THREE.Quaternion();
function retargetHip(c, from, to) {
  if (!from || !to || !c.tracks.gun) return;
  _qa.setFromEuler(_e.set(from.r[0] * DEG, from.r[1] * DEG, from.r[2] * DEG));
  _qb.setFromEuler(_e.set(to.r[0] * DEG, to.r[1] * DEG, to.r[2] * DEG));
  _qd.copy(_qb).invert().multiply(_qa); // to^-1 * from
  for (const k of c.tracks.gun) {
    const pl = Math.hypot(k.p[0], k.p[1], k.p[2]), rl = Math.max(Math.abs(k.r[0]), Math.abs(k.r[1]), Math.abs(k.r[2]));
    const w = Math.max(Math.min(1, Math.max(0, (pl - 0.012) / 0.03)), Math.min(1, Math.max(0, (rl - 4) / 8)));
    if (w <= 0) continue;
    for (let i = 0; i < 3; i++) k.p[i] = +(k.p[i] + w * (from.p[i] - to.p[i])).toFixed(4);
    _qk.setFromEuler(_e.set(k.r[0] * DEG, k.r[1] * DEG, k.r[2] * DEG));
    _q.copy(_qd).multiply(_qk);
    _qk.slerp(_q, w);
    _e.setFromQuaternion(_qk);
    // keep multi-turn spins (e.g. knife twirls) by only adding the correction
    const r0 = k.r.slice(); const n = [_e.x / DEG, _e.y / DEG, _e.z / DEG];
    k.r = n.map((v, i) => { let d = v - r0[i]; d = ((d + 540) % 360) - 180; return +(r0[i] + d).toFixed(2); });
  }
}

class AnimLibrary {
  constructor() {
    this.user = store.get('anims', {}); // key "weapon/name" -> clip
    for (const w in DEFAULT_CLIPS) for (const n in DEFAULT_CLIPS[w]) sortClip(DEFAULT_CLIPS[w][n]);
    for (const k in this.user) sortClip(this.user[k]);
    this.baked = new Map();
  }
  _src(weapon) { return CLIP_SOURCE[weapon] || weapon; }
  _bake(weapon, name, clip) {
    if (!clip) return null;
    const key = weapon + '/' + name, hit = this.baked.get(key);
    if (hit && hit.src === clip) return hit.clip;
    const b = retargetClip(clip, weapon);
    this.baked.set(key, { src: clip, clip: b });
    return b;
  }
  get(weapon, name) { return this.user[weapon + '/' + name] || this.builtin(weapon, name); }
  builtin(weapon, name) {
    const own = DEFAULT_CLIPS[weapon] && DEFAULT_CLIPS[weapon][name];
    const src = own || (DEFAULT_CLIPS[this._src(weapon)] && DEFAULT_CLIPS[this._src(weapon)][name]);
    return this._bake(weapon, name, src);
  }
  names(weapon) {
    const s = new Set([...Object.keys(DEFAULT_CLIPS[this._src(weapon)] || {}), ...Object.keys(DEFAULT_CLIPS[weapon] || {})]);
    for (const k in this.user) if (k.startsWith(weapon + '/')) s.add(k.split('/')[1]);
    return [...s];
  }
  isCustom(weapon, name) { return !!this.user[weapon + '/' + name]; }
  save(weapon, name, clip) { this.user[weapon + '/' + name] = sortClip({ ...JSON.parse(JSON.stringify(clip)), baked: weapon }); return store.set('anims', this.user); }
  reset(weapon, name) { delete this.user[weapon + '/' + name]; store.set('anims', this.user); }
}
export const anims = new AnimLibrary();

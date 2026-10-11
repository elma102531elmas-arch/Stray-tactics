// Animation library: built-in clips + user overrides saved by the Animation
// Studio (localStorage). get(weapon, clipName) returns the active clip.
import { DEFAULT_CLIPS } from './defaults.js';
import { sortClip } from './clip.js';
import { store } from '../core/settings.js';

class AnimLibrary {
  constructor() {
    this.user = store.get('anims', {}); // key "weapon/name" -> clip
    for (const w in DEFAULT_CLIPS) for (const n in DEFAULT_CLIPS[w]) sortClip(DEFAULT_CLIPS[w][n]);
    for (const k in this.user) sortClip(this.user[k]);
  }
  get(weapon, name) { return this.user[weapon + '/' + name] || (DEFAULT_CLIPS[weapon] && DEFAULT_CLIPS[weapon][name]) || null; }
  builtin(weapon, name) { return DEFAULT_CLIPS[weapon] && DEFAULT_CLIPS[weapon][name]; }
  names(weapon) {
    const s = new Set(Object.keys(DEFAULT_CLIPS[weapon] || {}));
    for (const k in this.user) if (k.startsWith(weapon + '/')) s.add(k.split('/')[1]);
    return [...s];
  }
  isCustom(weapon, name) { return !!this.user[weapon + '/' + name]; }
  save(weapon, name, clip) { this.user[weapon + '/' + name] = sortClip(JSON.parse(JSON.stringify(clip))); return store.set('anims', this.user); }
  reset(weapon, name) { delete this.user[weapon + '/' + name]; store.set('anims', this.user); }
}
export const anims = new AnimLibrary();

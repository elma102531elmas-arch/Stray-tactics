// Applies a sequence's state to a SceneModel and captures/restores what it touches. DOM-free (hosts add overlays/audio via callbacks).
import { deepClone } from './util.js';
import { SequencePlayer } from './sequence.js';

export class SceneSequenceHost {
  /**
   * @param o.scene   SceneModel
   * @param o.seq     the sequence (to know which properties to capture)
   * @param o.hooks   { overlay(state), camera(state|null), audio(clip), event(name), begin(), end(reason) }
   */
  constructor({ scene, seq, hooks = {} }) {
    this.scene = scene; this.seq = seq; this.hooks = hooks;
  }
  resolve(target) { return this.scene.get(target) || this.scene.byName(target); }

  // --- SequencePlayer adapter ---
  capture(targets) {
    const nodes = [], props = [];
    for (const target of targets) { const n = this.resolve(target); if (n) nodes.push({ id: n.id, t: deepClone(n.t) }); }
    for (const tr of this.seq.tracks) if (tr.type === 'property' && tr.target && tr.prop) { const n = this.resolve(tr.target); if (n && !props.some((p) => p.id === n.id && p.prop === tr.prop)) props.push({ id: n.id, prop: tr.prop, value: deepClone(n.props[tr.prop]) }); }
    return { nodes, props };
  }
  restore(snap) {
    if (!snap) return;
    for (const n of snap.nodes) if (this.scene.has(n.id)) this.scene.setTransform(n.id, n.t);
    for (const p of snap.props) if (this.scene.has(p.id)) this.scene.setProp(p.id, p.prop, p.value);
  }
  apply(state) {
    for (const [target, v] of Object.entries(state.nodes)) { const n = this.resolve(target); if (n) this.scene.setTransform(n.id, v); }
    for (const p of state.props) { const n = this.resolve(p.target); if (n) this.scene.setProp(n.id, p.prop, p.value); }
    this.hooks.camera?.(state.camera, state);
    this.hooks.overlay?.(state);
  }
  audio(c) { this.hooks.audio?.(c); }
  event(name) { this.hooks.event?.(name); }
  begin() { this.hooks.begin?.(); }
  end(reason) { this.hooks.camera?.(null, null); this.hooks.overlay?.(null); this.hooks.end?.(reason); }

  player(opts) { return new SequencePlayer(this.seq, this, opts); }
}

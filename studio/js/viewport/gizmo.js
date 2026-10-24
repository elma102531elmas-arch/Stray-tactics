// Transform gizmo. Wraps three's TransformControls around an invisible pivot that represents the selection.
// While dragging, the model is updated live (no history); on release ONE undoable command is committed.

import * as THREE from '../../lib/three.module.js';
import { TransformControls } from '../../lib/TransformControls.js';
import { setTransforms, batch, setProps } from '../core/commands.js';
import { HELPER_LAYER } from './builders.js';

const D2R = Math.PI / 180;
const SCALE_BAKE = {
  wall: { sx: 'length', sy: 'height', sz: 'thick' },
  floor: { sx: 'w', sz: 'd', sy: 'thick' }, ceiling: { sx: 'w', sz: 'd', sy: 'thick' },
  box: { sx: 'w', sy: 'h', sz: 'd' },
  door: { sx: 'width', sy: 'height', sz: 'thick' }, window: { sx: 'width', sy: 'height', sz: 'thick' },
  stairs: { sx: 'width' },
  decal: { sx: 'w', sy: 'h' },
};
const VEC_SIZE = ['trigger', 'interaction', 'checkpoint', 'navBlocker', 'arena', 'audioZone', 'footstepZone'];

export class GizmoController {
  constructor(app, viewport) {
    this.app = app; this.vp = viewport;
    this.tc = new TransformControls(viewport.camera, viewport.canvas);
    this.tc.setSize(0.9);
    this.helper = this.tc.getHelper();
    this.helper.traverse((o) => o.layers.set(HELPER_LAYER));
    viewport.scene.add(this.helper);
    this.pivot = new THREE.Object3D();
    viewport.scene.add(this.pivot);
    this.tc.attach(this.pivot);
    this.mode = 'translate';
    this.space = 'world';
    this.dragging = false;
    this.start = null;
    this.tc.addEventListener('dragging-changed', (e) => this._dragChanged(e.value));
    this.tc.addEventListener('objectChange', () => this._objectChange());
    this.tc.addEventListener('change', () => this.vp.requestRender());
    this.applySnap();
    this.sync();
    app.on('selection', () => this.sync());
    app.on('history', () => { if (!this.dragging) this.sync(); });
    app.on('scene', (ev, id, f) => { if (!this.dragging && ev === 'changed') this.syncSoon(); });
  }

  syncSoon() { if (this._s) return; this._s = true; queueMicrotask(() => { this._s = false; if (!this.dragging) this.sync(); }); }

  setMode(mode) { this.mode = mode; if (mode !== 'none') this.tc.setMode(mode); this.sync(); this.vp.requestRender(); }
  setSpace(space) { this.space = space; this.sync(); this.vp.requestRender(); }
  setCamera(cam) { this.tc.camera = cam; }

  applySnap(invert = false) {
    const s = this.app.project.data.settings;
    const on = (flag) => (invert ? !flag : flag);
    this.tc.setTranslationSnap(on(s.grid.snap) ? s.grid.size : null);
    this.tc.setRotationSnap(on(s.rotSnapOn) ? s.rotSnap * D2R : null);
    this.tc.setScaleSnap(on(s.scaleSnapOn) ? s.scaleSnap : null);
  }

  get targets() {
    const app = this.app;
    return app.topSelection().filter((id) => !app.scene.isLocked(id) && app.scene.isVisible(id));
  }

  /** Place the pivot at the selection and show/hide the gizmo. */
  sync() {
    const ids = this.targets;
    const show = ids.length > 0 && this.vp.tool?.id === 'select' && this.mode !== 'none';
    this.tc.enabled = show;
    this.helper.visible = show;
    if (!show) this.tc.axis = null;
    if (!ids.length) { this.vp.requestRender(); return; }
    const scene = this.app.scene;
    const c = new THREE.Vector3();
    for (const id of ids) c.add(scene.worldPosition(id));
    c.multiplyScalar(1 / ids.length);
    this.pivot.position.copy(c);
    this.pivot.scale.set(1, 1, 1);
    const q = new THREE.Quaternion();
    if (this.space === 'local' || this.mode === 'scale') {
      const m = scene.worldMatrix(ids.at(-1));
      m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    }
    this.pivot.quaternion.copy(q);
    this.tc.setSpace(this.mode === 'scale' ? 'local' : this.space);
    this.pivot.updateMatrixWorld(true);
    this.vp.requestRender();
  }

  _dragChanged(dragging) {
    this.dragging = dragging;
    this.vp.onGizmoDragging?.(dragging);
    if (dragging) this._begin(); else this._commit();
  }

  _begin() {
    const scene = this.app.scene;
    const ids = this.targets;
    this.pivot.updateMatrixWorld(true);
    this.start = {
      pivot: this.pivot.matrixWorld.clone(),
      nodes: ids.map((id) => ({ id, world: scene.worldMatrix(id).clone(), from: JSON.parse(JSON.stringify(scene.get(id).t)), props: { ...scene.get(id).props } })),
    };
    this.moved = false;
  }

  _objectChange() {
    if (!this.start) return;
    const scene = this.app.scene;
    this.pivot.updateMatrixWorld(true);
    const delta = this.pivot.matrixWorld.clone().multiply(this.start.pivot.clone().invert());
    for (const n of this.start.nodes) {
      const world = delta.clone().multiply(n.world);
      const node = scene.get(n.id);
      scene.setTransform(n.id, scene.localTransformFromWorld(node.parent, world));
    }
    this.moved = true;
    this.vp.sceneView.refreshOutlines?.();
    this.vp.requestRender();
  }

  _commit() {
    const st = this.start; this.start = null;
    if (!st || !this.moved) { this.sync(); return; }
    const scene = this.app.scene;
    const items = st.nodes.map((n) => ({ id: n.id, from: n.from, t: JSON.parse(JSON.stringify(scene.get(n.id).t)) }));
    const label = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[this.mode] + (items.length > 1 ? ` ${items.length} objects` : '');
    const cmds = [setTransforms(items, { label })];
    if (this.mode === 'scale') {
      // Primitives keep scale 1: the scale becomes their real dimensions so textures, collision and navigation agree.
      for (const it of items) {
        const node = scene.get(it.id);
        const s = it.t.s;
        const map = SCALE_BAKE[node.type];
        if (map) {
          const changes = {};
          if (map.sx) changes[map.sx] = round(node.props[map.sx] * Math.abs(s[0]));
          if (map.sy) changes[map.sy] = round(node.props[map.sy] * Math.abs(s[1]));
          if (map.sz) changes[map.sz] = round(node.props[map.sz] * Math.abs(s[2]));
          if (node.type === 'stairs') { changes.stepH = round(node.props.stepH * Math.abs(s[1])); changes.stepD = round(node.props.stepD * Math.abs(s[2])); }
          // keep the wall anchored on its pivot-edge: nothing to do, origin stays where the gizmo left it
          cmds.push(setProps(it.id, changes, { mergeKey: undefined }));
          cmds.push(setTransforms([{ id: it.id, from: it.t, t: { s: [1, 1, 1] } }]));
        } else if (VEC_SIZE.includes(node.type)) {
          const sz = node.props.size.map((v, i) => round(v * Math.abs(s[i])));
          cmds.push(setProps(it.id, { size: sz }));
          cmds.push(setTransforms([{ id: it.id, from: it.t, t: { s: [1, 1, 1] } }]));
        }
      }
    }
    // The live edits already hold the final values; exec re-applies the same values and records one undo step.
    if (cmds.length === 1) this.app.exec(cmds[0]); else this.app.exec(batch(cmds[0].label, cmds));
    this.sync();
  }
}
const round = (v) => Math.round(v * 1000) / 1000;

// SceneModel: the authoritative, renderer-independent description of a map.
// All edits go through commands (see commands.js) so everything is undoable;
// the viewport only *reads* this model and re-syncs when it emits events.

import * as THREE from '../../lib/three.module.js';
import { Emitter, uid, deepClone, uniqueName } from './util.js';
import { TYPES, defaultProps } from './schema.js';

export const ROOT_ID = 'root';
const D2R = Math.PI / 180;

export function makeNode(type, opts = {}) {
  if (!TYPES[type]) throw new Error(`Unknown node type "${type}"`);
  const node = {
    id: opts.id || uid('n'),
    name: opts.name || TYPES[type].label,
    type,
    parent: null,
    children: [],
    t: {
      p: opts.p ? [...opts.p] : [0, 0, 0],
      r: opts.r ? [...opts.r] : [0, 0, 0],
      s: opts.s ? [...opts.s] : [1, 1, 1],
    },
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    props: { ...defaultProps(type), ...deepClone(opts.props || {}) },
    tags: opts.tags ? [...opts.tags] : [],
    anim: opts.anim ? deepClone(opts.anim) : null,
    meta: opts.meta ? deepClone(opts.meta) : {},
  };
  return node;
}

export class SceneModel extends Emitter {
  constructor() {
    super();
    this.nodes = new Map();
    this.version = 0;
    this._wm = new Map();
    this._wmVersion = -1;
    const root = makeNode('group', { id: ROOT_ID, name: 'Scene' });
    this.nodes.set(ROOT_ID, root);
  }

  get root() { return this.nodes.get(ROOT_ID); }
  get(id) { return this.nodes.get(id) || null; }
  has(id) { return this.nodes.has(id); }
  get size() { return this.nodes.size - 1; }

  children(id) { return (this.get(id)?.children || []).map((c) => this.nodes.get(c)).filter(Boolean); }
  parentOf(id) { const n = this.get(id); return n && n.parent ? this.get(n.parent) : null; }

  ancestors(id) {
    const out = [];
    let p = this.parentOf(id);
    while (p) { out.push(p); p = this.parentOf(p.id); }
    return out;
  }
  isDescendant(id, ancestorId) {
    let p = this.get(id)?.parent;
    while (p) { if (p === ancestorId) return true; p = this.get(p)?.parent; }
    return false;
  }
  /** depth-first, parents before children; excludes the root itself. */
  walk(cb, fromId = ROOT_ID) {
    const visit = (id) => {
      for (const cid of this.get(id).children) {
        const c = this.get(cid);
        if (!c) continue;
        if (cb(c) === false) continue; // returning false skips the subtree
        visit(cid);
      }
    };
    visit(fromId);
  }
  all() { const out = []; this.walk((n) => { out.push(n); }); return out; }
  find(pred) { const out = []; this.walk((n) => { if (pred(n)) out.push(n); }); return out; }
  descendants(id) { const out = []; this.walk((n) => { out.push(n); }, id); return out; }
  byName(name) { return this.all().find((n) => n.name === name) || null; }
  /** A node is effectively locked/hidden when any ancestor is. */
  isLocked(id) { const n = this.get(id); return !!n && (n.locked || this.ancestors(id).some((a) => a.locked)); }
  isVisible(id) { const n = this.get(id); return !!n && n.visible && this.ancestors(id).every((a) => a.visible); }

  // ------------------------------------------------------------ mutation primitives (used by commands only)
  _bump() { this.version++; }

  insert(node, parentId = ROOT_ID, index = -1) {
    if (this.nodes.has(node.id)) throw new Error(`Node id "${node.id}" already exists`);
    const parent = this.get(parentId);
    if (!parent) throw new Error(`Parent "${parentId}" does not exist`);
    node.parent = parentId;
    node.children = node.children || [];
    this.nodes.set(node.id, node);
    if (index < 0 || index > parent.children.length) parent.children.push(node.id); else parent.children.splice(index, 0, node.id);
    this._bump();
    this.emit('added', node.id);
    return node;
  }

  /** Insert a nested snapshot ({...node, children:[snapshot]}) — used by undo of delete, duplicate, prefabs. */
  insertSnapshot(snap, parentId = ROOT_ID, index = -1) {
    const { children, ...rest } = snap;
    const node = { ...deepClone(rest), children: [] };
    this.insert(node, parentId, index);
    for (const c of children || []) this.insertSnapshot(c, node.id, -1);
    return node;
  }

  snapshot(id) {
    const n = this.get(id);
    if (!n) throw new Error(`Cannot snapshot missing node "${id}"`);
    const { children, ...rest } = n;
    return { ...deepClone(rest), children: children.map((c) => this.snapshot(c)) };
  }

  /** Remove a node and its subtree. Returns {snapshot, parentId, index} for undo. */
  detach(id) {
    const n = this.get(id);
    if (!n || id === ROOT_ID) throw new Error(`Cannot remove "${id}"`);
    const parent = this.get(n.parent);
    const index = parent.children.indexOf(id);
    const snapshot = this.snapshot(id);
    const kill = (nid) => {
      const x = this.nodes.get(nid);
      for (const c of [...x.children]) kill(c);
      this.nodes.delete(nid);
      this.emit('removed', nid, x.parent);
    };
    parent.children.splice(index, 1);
    kill(id);
    this._bump();
    return { snapshot, parentId: parent.id, index };
  }

  move(id, newParentId, index = -1) {
    const n = this.get(id);
    const np = this.get(newParentId);
    if (!n || !np || id === ROOT_ID) throw new Error('Invalid reparent');
    if (id === newParentId || this.isDescendant(newParentId, id)) throw new Error('Cannot move a node into itself');
    const old = this.get(n.parent);
    const oldIndex = old.children.indexOf(id);
    old.children.splice(oldIndex, 1);
    if (index < 0 || index > np.children.length) np.children.push(id); else np.children.splice(index, 0, id);
    n.parent = newParentId;
    this._bump();
    this.emit('moved', id, old.id, newParentId);
    return { parentId: old.id, index: oldIndex };
  }

  setTransform(id, t) {
    const n = this.get(id);
    if (t.p) n.t.p = [...t.p];
    if (t.r) n.t.r = [...t.r];
    if (t.s) n.t.s = [...t.s];
    this._bump();
    this.emit('changed', id, ['t']);
  }

  patch(id, fields) {
    const n = this.get(id);
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'props') Object.assign(n.props, v); else n[k] = deepClone(v);
    }
    this._bump();
    this.emit('changed', id, Object.keys(fields));
  }

  setProp(id, key, value) {
    const n = this.get(id);
    if (value === undefined) delete n.props[key]; else n.props[key] = deepClone(value);
    this._bump();
    this.emit('changed', id, ['props.' + key]);
  }

  // ------------------------------------------------------------ transforms
  localMatrix(id, out = new THREE.Matrix4()) {
    const n = this.get(id);
    const e = new THREE.Euler(n.t.r[0] * D2R, n.t.r[1] * D2R, n.t.r[2] * D2R, 'XYZ');
    return out.compose(new THREE.Vector3(...n.t.p), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(...n.t.s));
  }
  worldMatrix(id) {
    if (this._wmVersion !== this.version) { this._wm.clear(); this._wmVersion = this.version; }
    const hit = this._wm.get(id);
    if (hit) return hit;
    const n = this.get(id);
    const m = this.localMatrix(id);
    if (n.parent && n.parent !== ROOT_ID) m.premultiply(this.worldMatrix(n.parent));
    this._wm.set(id, m);
    return m;
  }
  worldPosition(id) { return new THREE.Vector3().setFromMatrixPosition(this.worldMatrix(id)); }
  /** Convert a world matrix to the local transform that reproduces it under the node's parent. */
  localTransformFromWorld(parentId, worldM) {
    const pm = parentId && parentId !== ROOT_ID ? this.worldMatrix(parentId) : new THREE.Matrix4();
    const lm = new THREE.Matrix4().copy(pm).invert().multiply(worldM);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    lm.decompose(p, q, s);
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    return { p: [p.x, p.y, p.z], r: [e.x / D2R, e.y / D2R, e.z / D2R], s: [s.x, s.y, s.z] };
  }

  uniqueNameIn(parentId, base) {
    const taken = new Set(this.children(parentId).map((c) => c.name));
    return uniqueName(base, taken);
  }

  // ------------------------------------------------------------ (de)serialisation
  toJSON() {
    const nodes = [];
    this.walk((n) => {
      const { children, ...rest } = n;
      nodes.push(deepClone(rest));
    });
    return { rootName: this.root.name, nodes };
  }

  static fromJSON(json) {
    const s = new SceneModel();
    if (json?.rootName) s.root.name = json.rootName;
    const nodes = json?.nodes || [];
    const pending = new Map(nodes.map((n) => [n.id, n]));
    // Insert parents before children regardless of stored order.
    const insertOne = (n, guard = 0) => {
      if (s.has(n.id)) return;
      const pid = n.parent || ROOT_ID;
      if (!s.has(pid)) {
        const parent = pending.get(pid);
        if (!parent || guard > 10000) throw new Error(`Scene file is corrupt: node "${n.id}" references missing parent "${pid}"`);
        insertOne(parent, guard + 1);
      }
      const t = TYPES[n.type];
      if (!t) throw new Error(`Scene contains unknown node type "${n.type}" (node "${n.name}"). It may have been created by a newer Studio version.`);
      const node = {
        ...deepClone(n),
        children: [],
        props: { ...defaultProps(n.type), ...deepClone(n.props || {}) }, // forward-compatible: fill new props
      };
      s.insert(node, pid, -1);
    };
    for (const n of nodes) insertOne(n);
    s.version = 0;
    return s;
  }
}

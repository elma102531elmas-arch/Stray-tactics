// Command factories. Each returns { label, do(ctx), undo(ctx) } where ctx = { scene, data }.
// Nothing outside this file (and the importers, which use the same factories) mutates the scene.

import { ROOT_ID, makeNode } from './scene.js';
import { deepClone, getPath, setPath, uid, deepEqual } from './util.js';
import { validateProp } from './schema.js';

/** Deep-copy a snapshot assigning fresh ids; also rewrites id references inside props. */
export function cloneSnapshotWithNewIds(snap, idMap = new Map()) {
  const walkMap = (s) => { idMap.set(s.id, uid('n')); (s.children || []).forEach(walkMap); };
  walkMap(snap);
  const rebuild = (s) => {
    const { children, ...rest } = s;
    const copy = deepClone(rest);
    copy.id = idMap.get(s.id);
    copy.parent = null;
    for (const [k, v] of Object.entries(copy.props || {})) if (typeof v === 'string' && idMap.has(v)) copy.props[k] = idMap.get(v);
    return { ...copy, children: (children || []).map(rebuild) };
  };
  return rebuild(snap);
}

export function addNode(node, parentId = ROOT_ID, index = -1) {
  const snap = { ...node, children: node.children?.length ? node.children : [] };
  return {
    label: `Add ${node.name}`,
    do: ({ scene }) => { scene.insertSnapshot(snap, parentId, index); return node.id; },
    undo: ({ scene }) => { if (scene.has(node.id)) scene.detach(node.id); },
  };
}

export function addSnapshot(snap, parentId = ROOT_ID, index = -1, label) {
  return {
    label: label || `Add ${snap.name}`,
    do: ({ scene }) => { scene.insertSnapshot(snap, parentId, index); return snap.id; },
    undo: ({ scene }) => { if (scene.has(snap.id)) scene.detach(snap.id); },
  };
}

/** Remove top-most selected nodes (children of removed nodes are removed with them). */
export function removeNodes(ids) {
  let saved = [];
  return {
    label: ids.length > 1 ? `Delete ${ids.length} objects` : 'Delete object',
    do: ({ scene }) => {
      const set = new Set(ids);
      const top = ids.filter((id) => scene.has(id) && !scene.ancestors(id).some((a) => set.has(a.id)));
      saved = [];
      for (const id of top) saved.push(scene.detach(id));
      return top;
    },
    undo: ({ scene }) => {
      for (let i = saved.length - 1; i >= 0; i--) {
        const s = saved[i];
        scene.insertSnapshot(s.snapshot, s.parentId, s.index);
      }
    },
  };
}

export function setProps(id, changes, { mergeKey } = {}) {
  let old = null;
  const cmd = {
    label: `Edit ${Object.keys(changes).join(', ')}`,
    mergeKey: mergeKey || `props:${id}:${Object.keys(changes).sort().join(',')}`,
    do: ({ scene }) => {
      const n = scene.get(id);
      if (!n) throw new Error(`Object "${id}" no longer exists`);
      if (!old) { old = {}; for (const k of Object.keys(changes)) old[k] = deepClone(n.props[k]); }
      for (const [k, v] of Object.entries(changes)) {
        const err = validateProp(n.type, k, v);
        if (err) throw new Error(err);
        scene.setProp(id, k, v);
      }
    },
    undo: ({ scene }) => { for (const [k, v] of Object.entries(old)) scene.setProp(id, k, v); },
    mergeWith(next) { Object.assign(changes, next._changes); cmd._changes = changes; return true; },
  };
  cmd._changes = changes;
  return cmd;
}

export function setFields(id, fields, { mergeKey } = {}) {
  let old = null;
  return {
    label: `Edit ${Object.keys(fields).join(', ')}`,
    mergeKey,
    do: ({ scene }) => {
      const n = scene.get(id);
      if (!n) throw new Error(`Object "${id}" no longer exists`);
      if (!old) { old = {}; for (const k of Object.keys(fields)) old[k] = deepClone(n[k]); }
      scene.patch(id, fields);
    },
    undo: ({ scene }) => scene.patch(id, old),
    mergeWith(next) { return false; },
  };
}

/** items: [{id, t:{p?,r?,s?}}] — local transforms. */
export function setTransforms(items, { mergeKey, label } = {}) {
  let old = null;
  const cmd = {
    label: label || (items.length > 1 ? `Transform ${items.length} objects` : 'Transform'),
    mergeKey,
    do: ({ scene }) => {
      if (!old) old = items.map((it) => { const n = scene.get(it.id); return { id: it.id, t: deepClone(n.t) }; });
      for (const it of items) scene.setTransform(it.id, it.t);
    },
    undo: ({ scene }) => { for (const o of old) scene.setTransform(o.id, o.t); },
    mergeWith(next) {
      const byId = new Map(items.map((i) => [i.id, i]));
      let ok = next._items.length === items.length;
      for (const n of next._items) if (!byId.has(n.id)) ok = false;
      if (!ok) return false;
      for (const n of next._items) byId.get(n.id).t = { ...byId.get(n.id).t, ...n.t };
      return true;
    },
  };
  cmd._items = items;
  return cmd;
}

/** Move nodes under a new parent, preserving their world transform. */
export function reparent(ids, parentId, index = -1, { keepWorld = true } = {}) {
  let saved = [];
  return {
    label: 'Reparent',
    do: ({ scene }) => {
      saved = [];
      const set = new Set(ids);
      const top = ids.filter((id) => scene.has(id) && !scene.ancestors(id).some((a) => set.has(a.id)));
      let i = index;
      for (const id of top) {
        if (id === parentId || scene.isDescendant(parentId, id)) throw new Error('Cannot move an object into itself');
        const wm = scene.worldMatrix(id).clone();
        const oldT = deepClone(scene.get(id).t);
        const prev = scene.move(id, parentId, i);
        if (i >= 0) i++;
        if (keepWorld) scene.setTransform(id, scene.localTransformFromWorld(parentId, wm));
        saved.push({ id, oldT, prev });
      }
      return top;
    },
    undo: ({ scene }) => {
      for (let k = saved.length - 1; k >= 0; k--) {
        const s = saved[k];
        scene.move(s.id, s.prev.parentId, s.prev.index);
        scene.setTransform(s.id, s.oldT);
      }
    },
  };
}

export function groupNodes(ids, name = 'Group') {
  let groupId = null, saved = [];
  return {
    label: 'Group',
    do: ({ scene }) => {
      const set = new Set(ids);
      const top = ids.filter((id) => scene.has(id) && !scene.ancestors(id).some((a) => set.has(a.id)));
      if (!top.length) throw new Error('Nothing to group');
      const parentId = scene.get(top[0]).parent;
      // pivot at the centroid of the members' world positions
      const c = [0, 0, 0];
      for (const id of top) { const p = scene.worldPosition(id); c[0] += p.x; c[1] += p.y; c[2] += p.z; }
      c[0] /= top.length; c[1] /= top.length; c[2] /= top.length;
      const g = makeNode('group', { name: scene.uniqueNameIn(parentId, name) });
      if (!groupId) groupId = g.id; else g.id = groupId;
      scene.insert(g, parentId, scene.get(parentId).children.indexOf(top[0]));
      scene.setTransform(g.id, scene.localTransformFromWorld(parentId, new (scene.worldMatrix(top[0]).constructor)().makeTranslation(...c)));
      saved = [];
      for (const id of top) {
        const wm = scene.worldMatrix(id).clone();
        const oldT = deepClone(scene.get(id).t);
        const prev = scene.move(id, g.id, -1);
        scene.setTransform(id, scene.localTransformFromWorld(g.id, wm));
        saved.push({ id, oldT, prev });
      }
      return g.id;
    },
    undo: ({ scene }) => {
      for (let k = saved.length - 1; k >= 0; k--) {
        const s = saved[k];
        scene.move(s.id, s.prev.parentId, s.prev.index);
        scene.setTransform(s.id, s.oldT);
      }
      if (scene.has(groupId)) scene.detach(groupId);
    },
  };
}

export function ungroupNode(id) {
  let saved = null, groupSnap = null;
  return {
    label: 'Ungroup',
    do: ({ scene }) => {
      const g = scene.get(id);
      if (!g || g.type !== 'group') throw new Error('Only groups can be ungrouped');
      const parentId = g.parent;
      const index = scene.get(parentId).children.indexOf(id);
      groupSnap = { t: deepClone(g.t), node: scene.snapshot(id), parentId, index };
      const kids = [...g.children];
      saved = [];
      let i = index;
      for (const cid of kids) {
        const wm = scene.worldMatrix(cid).clone();
        const oldT = deepClone(scene.get(cid).t);
        scene.move(cid, parentId, i++);
        scene.setTransform(cid, scene.localTransformFromWorld(parentId, wm));
        saved.push({ id: cid, oldT });
      }
      scene.detach(id);
      return kids;
    },
    undo: ({ scene }) => {
      const s = groupSnap;
      const shell = { ...s.node, children: [] };
      scene.insertSnapshot(shell, s.parentId, s.index);
      for (const k of saved) { scene.move(k.id, id, -1); scene.setTransform(k.id, k.oldT); }
    },
  };
}

/** Duplicate nodes next to the originals. Returns the new top-level ids. */
export function duplicateNodes(ids, offset = [0.5, 0, 0.5]) {
  let created = [];
  return {
    label: ids.length > 1 ? `Duplicate ${ids.length} objects` : 'Duplicate',
    do: ({ scene }) => {
      if (created.length) {
        for (const c of created) scene.insertSnapshot(c.snap, c.parentId, c.index);
        return created.map((c) => c.snap.id);
      }
      const set = new Set(ids);
      const top = ids.filter((id) => scene.has(id) && !scene.ancestors(id).some((a) => set.has(a.id)));
      const idMap = new Map();
      for (const id of top) {
        const snap = cloneSnapshotWithNewIds(scene.snapshot(id), idMap);
        snap.name = scene.uniqueNameIn(scene.get(id).parent, scene.get(id).name);
        snap.t.p = [snap.t.p[0] + offset[0], snap.t.p[1] + offset[1], snap.t.p[2] + offset[2]];
        const parentId = scene.get(id).parent;
        const index = scene.get(parentId).children.indexOf(id) + 1;
        created.push({ snap, parentId, index });
        scene.insertSnapshot(snap, parentId, index);
      }
      return created.map((c) => c.snap.id);
    },
    undo: ({ scene }) => { for (const c of [...created].reverse()) if (scene.has(c.snap.id)) scene.detach(c.snap.id); },
  };
}

/** Edit any plain data in project.data by path, e.g. ['materials','mat_x','color']. */
export function setData(path, value, { mergeKey, label } = {}) {
  let old, had = false;
  const cmd = {
    label: label || `Edit ${path.join('.')}`,
    mergeKey,
    do: ({ data }) => {
      if (!had) { old = deepClone(getPath(data, path)); had = true; }
      setPath(data, path, deepClone(value));
    },
    undo: ({ data }) => { setPath(data, path, deepClone(old)); },
    mergeWith(next) { if (!deepEqual(next._path, path)) return false; value = next._value; cmd._value = value; return true; },
  };
  cmd._path = path; cmd._value = value;
  return cmd;
}

export function batch(label, cmds) {
  return {
    label,
    do: (ctx) => cmds.map((c) => c.do(ctx)),
    undo: (ctx) => { for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo(ctx); },
  };
}

// Plugins and scripts: records, permissions, static code analysis, approvals and the permission-checked API that sandboxed code talks to.
// DOM-free (tested in Node). The sandbox itself (iframe + worker + CSP) is ui/sandbox.js.
//
// Security model, in one paragraph: code from a project or from a file is NEVER executed on load, import or open. It runs only after the user
// has read it in the review dialog and approved it; the approval is remembered in this browser only, keyed by project + code hash, so editing the
// code (or opening someone else's project) asks again. Approved code runs in a sandboxed Worker with no network, and every call it makes to the
// editor goes through ApiRouter below, which checks the granted permissions, validates the arguments and enforces budgets.

import * as acorn from '../../lib/acorn.mjs';
import { uid, deepClone } from './util.js';
import { makeNode, ROOT_ID } from './scene.js';
import { TYPES, defaultProps } from './schema.js';
import * as C from './commands.js';

// ------------------------------------------------------------------ permissions
export const PERMISSIONS = {
  'scene.read': 'Read the objects in the map (names, positions, properties).',
  'scene.write': 'Create, change and delete objects in the map. Applied as ONE undoable step when the command finishes.',
  'project.read': 'Read project data: settings, materials, the asset list, event graphs, sequences.',
  'ui.menu': 'Add its own commands to the Plugins menu.',
  'ui.validate': 'Add its own checks to the project validator (Issues panel).',
  'files.download': 'Offer you a file to save (you are asked each time and choose where it goes).',
  'game.read': 'Read the playtest state: flags, inventory, door and light states, player position.',
  'game.write': 'Change the playtest state: flags, items, doors, lights, messages, objectives and events.',
};
/** Which permissions each kind may request. Scripts run inside the playtest; plugins extend the editor. */
export const KIND_PERMISSIONS = { plugin: ['scene.read', 'scene.write', 'project.read', 'ui.menu', 'ui.validate', 'files.download'], script: ['game.read', 'game.write', 'scene.read'] };
export const LIMITS = { codeBytes: 200_000, callsPerRun: 4000, writesPerRun: 1000, logsPerRun: 300, resultBytes: 1_000_000, nameLen: 120, timeoutMs: { command: 8000, load: 3000, validate: 4000, script: 1500 } };

// ------------------------------------------------------------------ records
export function newRecord(kind, name = kind === 'plugin' ? 'New plugin' : 'New script') {
  const now = new Date().toISOString();
  return { id: uid(kind === 'plugin' ? 'plug' : 'scr'), kind, name, version: '0.1.0', author: '', description: '', license: '', permissions: [], code: kind === 'plugin' ? PLUGIN_TEMPLATE : SCRIPT_TEMPLATE, source: { type: 'authored' }, created: now, modified: now };
}

export const PLUGIN_TEMPLATE = `// A plugin is code that extends the editor. It runs in a sandbox and only does what its permissions allow.
// Declare commands with api.command(label, fn); they appear in the Plugins menu (needs the "ui.menu" permission).
api.command('Count objects by type', async () => {
  const nodes = await api.scene.find({});          // needs "scene.read"
  const counts = {};
  for (const n of nodes) counts[n.type] = (counts[n.type] || 0) + 1;
  api.log('info', JSON.stringify(counts));
  api.notify('Objects: ' + nodes.length);
});
`;
export const SCRIPT_TEMPLATE = `// A script runs inside the playtest when an event graph reaches a "Run plugin script" node.
// Available: game (needs "game.read" / "game.write"), ctx ({ script, event }), api.log.
const seen = (await game.getFlag('seen_note')) || 0;
await game.setFlag('seen_note', seen + 1);
await game.say('You have read the note ' + (seen + 1) + ' time(s).');
`;

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Validate a record (from a file or a project). Returns [{severity, message}]. Never throws, never runs the code. */
export function validateRecord(r) {
  const out = [], add = (severity, message) => out.push({ severity, message });
  if (!r || typeof r !== 'object') return [{ severity: 'error', message: 'Not a plugin record.' }];
  if (!['plugin', 'script'].includes(r.kind)) add('error', `Unknown kind “${r.kind}” (expected plugin or script).`);
  if (typeof r.code !== 'string') add('error', 'The record has no code.');
  else if (new TextEncoder().encode(r.code).length > LIMITS.codeBytes) add('error', `The code is larger than ${LIMITS.codeBytes / 1000} KB.`);
  if (typeof r.name !== 'string' || !r.name.trim()) add('error', 'The record needs a name.');
  else if (r.name.length > LIMITS.nameLen) add('error', 'The name is too long.');
  if (!Array.isArray(r.permissions)) add('error', 'permissions must be a list.');
  else for (const p of r.permissions) {
    if (!PERMISSIONS[p]) add('error', `Unknown permission “${p}”.`);
    else if (KIND_PERMISSIONS[r.kind] && !KIND_PERMISSIONS[r.kind].includes(p)) add('error', `A ${r.kind} cannot request “${p}”.`);
  }
  return out;
}

/** Clean copy of an imported record: only known fields, forced inactive/untrusted, a fresh id so it can never overwrite an approved one. */
export function sanitizeImported(raw, { fileName = '' } = {}) {
  const base = newRecord(raw?.kind === 'script' ? 'script' : 'plugin', String(raw?.name || fileName || 'Imported').slice(0, LIMITS.nameLen));
  const rec = { ...base, version: String(raw?.version || '0.0.0').slice(0, 30), author: String(raw?.author || '').slice(0, 200), description: String(raw?.description || '').slice(0, 2000), license: String(raw?.license || '').slice(0, 200),
    permissions: Array.isArray(raw?.permissions) ? raw.permissions.filter((p) => typeof p === 'string') : [], code: typeof raw?.code === 'string' ? raw.code : '',
    source: { type: 'imported', file: fileName, importedAt: new Date().toISOString() } };
  return rec;
}

// ------------------------------------------------------------------ static analysis (acorn). Advisory: the sandbox, not this, is the protection.
const BLOCKED = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker', 'SharedWorker', 'indexedDB', 'localStorage', 'sessionStorage', 'caches', 'document', 'window', 'parent', 'top', 'frames', 'navigator', 'location', 'BroadcastChannel', 'postMessage', 'WebTransport']);
const DANGEROUS = new Set(['eval', 'Function', 'constructor', '__proto__', 'prototype', 'globalThis', 'self', 'Reflect', 'Proxy', 'WebAssembly', 'AsyncFunction']);

export function analyzeCode(code) {
  const out = [];
  let ast;
  try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true }); }
  catch (e) { return [{ severity: 'error', code: 'syntax', message: e.message.replace(/\(\d+:\d+\)$/, '').trim(), line: e.loc?.line ?? 1, col: e.loc?.column ?? 0 }]; }
  const add = (severity, codeName, message, node) => out.push({ severity, code: codeName, message, line: node.loc.start.line, col: node.loc.start.column });
  const seen = new Set();
  (function walk(n, parent) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier' && !(parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) && !(parent?.type === 'Property' && parent.key === n && !parent.computed)) {
      if (BLOCKED.has(n.name)) add('warn', 'blocked', `“${n.name}” is not available in the sandbox (network, storage and page access are removed).`, n);
      else if (DANGEROUS.has(n.name)) add('danger', 'dynamic', `“${n.name}” can build code at run time or reach the global object — read this part carefully.`, n);
    }
    if (n.type === 'MemberExpression') {
      const p = !n.computed && n.property.type === 'Identifier' ? n.property.name : (n.computed && n.property.type === 'Literal' ? String(n.property.value) : null);
      if (p && DANGEROUS.has(p)) add('danger', 'dynamic', `Accessing “.${p}” can be used to escape a sandbox or run dynamic code.`, n.property);
      else if (p && BLOCKED.has(p)) add('warn', 'blocked', `“.${p}” is not available in the sandbox.`, n.property);
    }
    if (n.type === 'ImportExpression') add('danger', 'dynamic', 'import() loads code from a URL; the sandbox blocks it.', n);
    if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'Function') add('danger', 'dynamic', 'new Function() builds code from text.', n);
    if ((n.type === 'WhileStatement' || n.type === 'ForStatement') && (!n.test || (n.test.type === 'Literal' && n.test.value)) && !JSON.stringify(n.body, (k, v) => (k === 'loc' ? undefined : v)).includes('"BreakStatement"') && !JSON.stringify(n.body, (k, v) => (k === 'loc' ? undefined : v)).includes('"ReturnStatement"')) add('warn', 'loop', 'A loop that never ends: the editor will stop the plugin after its time limit.', n);
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c, n)); else if (v && typeof v.type === 'string') walk(v, n);
    }
  })(ast, null);
  return out.filter((f) => { const key = `${f.code}:${f.line}:${f.col}:${f.message}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** Highest severity of a findings list: 'danger' > 'error' > 'warn' > 'info' > 'ok'. */
export function worstFinding(findings) { for (const s of ['danger', 'error', 'warn', 'info']) if (findings.some((f) => f.severity === s)) return s; return 'ok'; }

// ------------------------------------------------------------------ approvals (stored in THIS browser only, never in the project file)
export class Approvals {
  /** store = { get(): object, set(obj) } — localStorage-backed in the UI, a plain object in tests. */
  constructor(store) { this.store = store; }
  key(projectId, rec) { return `${projectId}:${rec.id}`; }
  async status(projectId, rec) {
    const a = this.store.get()[this.key(projectId, rec)];
    if (!a) return { state: 'unapproved' };
    const hash = await sha256Hex(rec.code);
    if (a.hash !== hash) return { state: 'changed', approvedAt: a.at };                                         // code edited since approval
    const need = rec.permissions || [];
    if (need.some((p) => !a.permissions.includes(p))) return { state: 'changed', approvedAt: a.at };            // asks for more than was approved
    return { state: 'approved', approvedAt: a.at, permissions: a.permissions, hash };
  }
  async approve(projectId, rec) { const all = this.store.get(); all[this.key(projectId, rec)] = { hash: await sha256Hex(rec.code), permissions: [...(rec.permissions || [])], at: new Date().toISOString(), name: rec.name }; this.store.set(all); }
  revoke(projectId, rec) { const all = this.store.get(); delete all[this.key(projectId, rec)]; this.store.set(all); }
}

// ------------------------------------------------------------------ the API sandboxed code can call
export class PermissionError extends Error { constructor(msg) { super(msg); this.name = 'PermissionError'; } }
export class ApiError extends Error { constructor(msg) { super(msg); this.name = 'ApiError'; } }

const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6;
const vec3 = (v, what) => { if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) throw new ApiError(`${what} must be three finite numbers (|x| ≤ 1,000,000).`); return v.map((x) => +x); };
const str = (v, what, max = 500) => { if (typeof v !== 'string' || v.length > max) throw new ApiError(`${what} must be text of at most ${max} characters.`); return v; };
/** Plain-JSON deep copy that refuses functions, cycles, huge values — whatever crosses the boundary is data only. */
export function jsonSafe(v, { maxBytes = LIMITS.resultBytes } = {}) {
  let s; try { s = JSON.stringify(v === undefined ? null : v); } catch (e) { throw new ApiError('The value cannot be sent (cyclic or not plain data).'); }
  if (s === undefined) return null;
  if (s.length > maxBytes) throw new ApiError('The value is too large to send.');
  return JSON.parse(s);
}

export class ApiRouter {
  constructor() { this.methods = new Map(); }
  /** perm = permission needed ('' = always allowed). fn(ctx, args) may be async. */
  define(method, perm, fn) { this.methods.set(method, { perm, fn }); return this; }
  async call(ctx, method, args) {
    const m = this.methods.get(method);
    if (!m) throw new ApiError(`Unknown API call “${method}”.`);
    if (m.perm && !ctx.granted.has(m.perm)) throw new PermissionError(`“${ctx.record.name}” is not allowed to use ${method} (needs the “${m.perm}” permission).`);
    ctx.calls = (ctx.calls || 0) + 1;
    if (ctx.calls > LIMITS.callsPerRun) throw new ApiError(`Too many API calls in one run (limit ${LIMITS.callsPerRun}).`);
    return jsonSafe(await m.fn(ctx, args ?? []));
  }
}

const nodeView = (scene, n) => ({ id: n.id, name: n.name, type: n.type, parent: n.parent === ROOT_ID ? null : n.parent, p: [...n.t.p], r: [...n.t.r], s: [...n.t.s], visible: n.visible, locked: n.locked, tags: [...(n.tags || [])], props: deepClone(n.props) });
const PROJECT_KEYS = ['settings', 'environment', 'materials', 'assets', 'events', 'sequences', 'enemies', 'weapons', 'audio', 'story', 'prefabs'];

/**
 * Editor-side API. `app` needs { scene, project, history/exec/tx, selection, toast, log }. Writes are queued in ctx.ops and applied by
 * commitOps() as ONE transaction when the command finishes successfully (nothing is applied if it errors or times out).
 */
export function editorApi(app, { download = null } = {}) {
  const r = new ApiRouter();
  r.define('log', '', (ctx, [level, text]) => { ctx.logs = (ctx.logs || 0) + 1; if (ctx.logs > LIMITS.logsPerRun) return null; app.log(['info', 'warn', 'error'].includes(level) ? level : 'info', `[${ctx.record.name}] ${str(String(text), 'text', 2000)}`); return null; });
  r.define('notify', '', (ctx, [text, kind]) => { ctx.notes = (ctx.notes || 0) + 1; if (ctx.notes <= 3) app.toast(`${ctx.record.name}: ${str(String(text), 'text', 300)}`, ['info', 'error', 'ok'].includes(kind) ? kind : 'info'); return null; });
  r.define('scene.find', 'scene.read', (ctx, [q = {}]) => {
    const out = []; const limit = Math.min(+q.limit || 2000, 2000);
    for (const n of app.scene.all()) {
      if (q.type && n.type !== q.type) continue;
      if (q.name && !n.name.toLowerCase().includes(String(q.name).toLowerCase())) continue;
      if (q.tag && !(n.tags || []).includes(q.tag)) continue;
      out.push(nodeView(app.scene, n)); if (out.length >= limit) break;
    }
    return out;
  });
  r.define('scene.get', 'scene.read', (ctx, [id]) => { const n = app.scene.get(str(id, 'id', 100)); return n ? nodeView(app.scene, n) : null; });
  r.define('scene.selection', 'scene.read', () => app.selection.map((id) => nodeView(app.scene, app.scene.get(id))));
  r.define('project.get', 'project.read', (ctx, [key]) => {
    if (!PROJECT_KEYS.includes(key)) throw new ApiError(`project.get key must be one of: ${PROJECT_KEYS.join(', ')}.`);
    return deepClone(app.project.data[key]);
  });
  const queue = (ctx, op) => { ctx.ops = ctx.ops || []; if (ctx.ops.length >= LIMITS.writesPerRun) throw new ApiError(`Too many changes in one run (limit ${LIMITS.writesPerRun}).`); ctx.ops.push(op); };
  const exists = (ctx, id) => app.scene.has(id) || (ctx.ops || []).some((o) => o.node?.id === id);
  r.define('scene.create', 'scene.write', (ctx, [spec]) => {
    if (!spec || typeof spec !== 'object') throw new ApiError('scene.create needs an object like { type, name, p, props }.');
    if (!TYPES[spec.type]) throw new ApiError(`Unknown object type “${String(spec.type).slice(0, 40)}”.`);
    const props = spec.props === undefined ? {} : spec.props;
    if (!props || typeof props !== 'object' || Array.isArray(props)) throw new ApiError('props must be an object.');
    const known = new Set(TYPES[spec.type].props.map((p) => p.key));
    for (const k of Object.keys(props)) if (!known.has(k)) throw new ApiError(`“${spec.type}” has no property “${k}”.`);
    const parent = spec.parent == null ? ROOT_ID : str(spec.parent, 'parent', 100);
    if (parent !== ROOT_ID && !exists(ctx, parent)) throw new ApiError('parent does not exist.');
    const node = makeNode(spec.type, { name: spec.name === undefined ? undefined : str(spec.name, 'name', LIMITS.nameLen), p: spec.p ? vec3(spec.p, 'p') : undefined, r: spec.r ? vec3(spec.r, 'r') : undefined, s: spec.s ? vec3(spec.s, 's') : undefined, props: jsonSafe(props) });
    queue(ctx, { kind: 'create', node, parent });
    return node.id;
  });
  r.define('scene.update', 'scene.write', (ctx, [id, patch]) => {
    id = str(id, 'id', 100);
    if (!exists(ctx, id)) throw new ApiError('That object does not exist.');
    if (!patch || typeof patch !== 'object') throw new ApiError('scene.update needs a patch object.');
    const clean = {};
    if (patch.name !== undefined) clean.name = str(patch.name, 'name', LIMITS.nameLen);
    for (const k of ['p', 'r', 's']) if (patch[k] !== undefined) clean[k] = vec3(patch[k], k);
    if (patch.visible !== undefined) clean.visible = !!patch.visible;
    if (patch.props !== undefined) {
      const type = (app.scene.get(id) || ctx.ops.find((o) => o.node?.id === id).node).type, known = new Set(TYPES[type].props.map((p) => p.key));
      for (const k of Object.keys(patch.props)) if (!known.has(k)) throw new ApiError(`“${type}” has no property “${k}”.`);
      clean.props = jsonSafe(patch.props);
    }
    queue(ctx, { kind: 'update', id, patch: clean });
    return null;
  });
  r.define('scene.remove', 'scene.write', (ctx, [ids]) => {
    ids = (Array.isArray(ids) ? ids : [ids]).map((i) => str(i, 'id', 100));
    for (const id of ids) if (!app.scene.has(id)) throw new ApiError('That object does not exist.');
    queue(ctx, { kind: 'remove', ids });
    return null;
  });
  r.define('download', 'files.download', async (ctx, [name, text]) => {
    name = str(name, 'file name', 100).replace(/[\\/:*?"<>|]/g, '_'); text = str(text, 'file text', 2_000_000);
    if (!download) throw new ApiError('Downloads are not available here.');
    return { saved: !!(await download(ctx.record, name, text)) };
  });
  return r;
}

/** Apply a finished run's queued writes as one undoable step. Returns the number of changes applied. */
export function commitOps(app, ctx, label) {
  const ops = ctx.ops || [];
  if (!ops.length) return 0;
  app.tx(label, () => {
    for (const op of ops) {
      if (op.kind === 'create') { op.node.name = app.scene.uniqueNameIn(op.parent, op.node.name); app.exec(C.addNode(op.node, op.parent)); }
      else if (op.kind === 'update') {
        const { props, ...fields } = op.patch;
        if (Object.keys(fields).some((k) => ['p', 'r', 's'].includes(k))) {
          const t = {}; for (const k of ['p', 'r', 's']) if (fields[k]) t[k] = fields[k];
          app.exec(C.setTransforms([{ id: op.id, t }], { label }));
        }
        const f = {}; if (fields.name !== undefined) f.name = fields.name; if (fields.visible !== undefined) f.visible = fields.visible;
        if (Object.keys(f).length) app.exec(C.setFields(op.id, f));
        if (props) app.exec(C.setProps(op.id, props));
      } else if (op.kind === 'remove') app.exec(C.removeNodes(op.ids.filter((i) => app.scene.has(i))));
    }
  });
  return ops.length;
}

export { defaultProps };

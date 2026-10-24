import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../../js/app.js';
import { MemoryStorage } from '../../js/store/storage.js';
import * as P from '../../js/core/plugins.js';

const mk = () => { globalThis.localStorage ??= { getItem: () => null, setItem() {} }; return new App({ storage: new MemoryStorage(), baseUrl: 'file:///studio/' }); };
const ctxFor = (perms, name = 'T') => ({ record: { id: 'p1', name, kind: 'plugin', permissions: perms }, granted: new Set(perms) });
const rejects = (p, cls, re) => assert.rejects(p, (e) => { assert.ok(e instanceof cls, `${e.name}: ${e.message}`); if (re) assert.match(e.message, re); return true; });

test('records: validation reports what is wrong without running anything', () => {
  const ok = P.newRecord('plugin'); ok.permissions = ['scene.read', 'ui.menu'];
  assert.deepEqual(P.validateRecord(ok), []);
  assert.equal(P.validateRecord(null)[0].severity, 'error');
  const bad = { ...ok, kind: 'macro', permissions: ['scene.read', 'nuke'], name: '' };
  const msgs = P.validateRecord(bad).map((m) => m.message).join(' | ');
  assert.match(msgs, /Unknown kind/); assert.match(msgs, /Unknown permission “nuke”/); assert.match(msgs, /needs a name/);
  assert.match(P.validateRecord({ ...ok, kind: 'script', permissions: ['scene.write'] })[0].message, /script cannot request “scene.write”/, 'scripts cannot edit the map');
  assert.match(P.validateRecord({ ...ok, code: 'x'.repeat(P.LIMITS.codeBytes + 1) })[0].message, /larger than/);
});

test('imported records are forced untrusted: fresh id, no flags that could pre-approve or auto-run, known fields only', () => {
  const raw = { id: 'plug_existing', kind: 'plugin', name: 'Sneaky', code: 'api.log("hi")', permissions: ['scene.read', 7], enabled: true, approved: true, autorun: true, source: { type: 'authored' }, hash: 'x', evil: { a: 1 } };
  const r = P.sanitizeImported(raw, { fileName: 'sneaky.smplugin.json' });
  assert.notEqual(r.id, 'plug_existing', 'cannot overwrite an approved record');
  assert.deepEqual(r.permissions, ['scene.read']);
  assert.equal(r.source.type, 'imported'); assert.equal(r.source.file, 'sneaky.smplugin.json');
  for (const k of ['enabled', 'approved', 'autorun', 'hash', 'evil']) assert.ok(!(k in r), `${k} dropped`);
  assert.equal(P.sanitizeImported({}, { fileName: 'a.js' }).name, 'a.js'); assert.equal(P.sanitizeImported({ kind: 'script' }).kind, 'script');
});

test('static analysis: syntax errors with position; blocked APIs; dynamic-code tricks; endless loops; clean code is quiet', () => {
  const syn = P.analyzeCode('const x = ;\n');
  assert.equal(syn.length, 1); assert.equal(syn[0].severity, 'error'); assert.equal(syn[0].line, 1);
  const at = (code, sev, re) => { const f = P.analyzeCode(code); assert.ok(f.some((x) => x.severity === sev && re.test(x.message)), `${code} → ${JSON.stringify(f)}`); return f; };
  at('fetch("https://x.test")', 'warn', /“fetch” is not available/);
  at('const w = new WebSocket("ws://x")', 'warn', /WebSocket/);
  at('localStorage.setItem("a", 1)', 'warn', /localStorage/);
  at('document.body', 'warn', /document/);
  at('eval("1")', 'danger', /eval/);
  at('new Function("return 1")', 'danger', /Function/);
  at('(() => {}).constructor("return this")()', 'danger', /constructor/);
  at('const o = {}; o["__proto__"].x = 1', 'danger', /__proto__/);
  at('globalThis.x', 'danger', /globalThis/);
  at('await import("https://x.test/a.js")', 'danger', /import\(\)/);
  at('while (true) { }', 'warn', /never ends/);
  at('for (;;) { x++ }', 'warn', /never ends/);
  assert.ok(!P.analyzeCode('while (true) { if (x) break; }').some((f) => f.code === 'loop'), 'a loop with a break is fine');
  const f = P.analyzeCode('a.fetch(1); const o = { fetch: 2 }; function fetchData() {}');
  assert.deepEqual(f.filter((x) => x.code === 'blocked').map((x) => x.line), [1], 'only the .fetch member is flagged, not property names / identifiers containing the word');
  assert.deepEqual(P.analyzeCode(P.PLUGIN_TEMPLATE).filter((x) => x.severity !== 'info'), [], 'the shipped templates are clean');
  assert.deepEqual(P.analyzeCode(P.SCRIPT_TEMPLATE).filter((x) => x.severity !== 'info'), []);
  assert.equal(P.worstFinding([{ severity: 'info' }, { severity: 'danger' }, { severity: 'warn' }]), 'danger'); assert.equal(P.worstFinding([]), 'ok');
});

test('approvals: per project and per code hash; editing code or asking for more permissions asks again; revoke works', async () => {
  let data = {}; const A = new P.Approvals({ get: () => data, set: (d) => { data = d; } });
  const rec = { ...P.newRecord('plugin', 'Tool'), permissions: ['scene.read'], code: 'api.log("a")' };
  assert.equal((await A.status('projA', rec)).state, 'unapproved');
  await A.approve('projA', rec);
  assert.equal((await A.status('projA', rec)).state, 'approved');
  assert.equal((await A.status('projB', rec)).state, 'unapproved', 'a copy of the same plugin in another project is not approved');
  assert.equal((await A.status('projA', { ...rec, id: 'other' })).state, 'unapproved');
  assert.equal((await A.status('projA', { ...rec, code: 'api.log("b")' })).state, 'changed', 'edited code');
  assert.equal((await A.status('projA', { ...rec, permissions: ['scene.read', 'scene.write'] })).state, 'changed', 'more permissions');
  assert.equal((await A.status('projA', { ...rec, permissions: [] })).state, 'approved', 'fewer permissions is fine');
  A.revoke('projA', rec); assert.equal((await A.status('projA', rec)).state, 'unapproved');
  assert.equal(await P.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('API router: every call is checked against the granted permissions; unknown calls and floods are refused', async () => {
  const app = mk(); app.createNode('wall', { name: 'W' });
  const api = P.editorApi(app);
  await rejects(api.call(ctxFor([]), 'scene.find', [{}]), P.PermissionError, /needs the “scene.read” permission/);
  await rejects(api.call(ctxFor(['scene.read']), 'scene.create', [{ type: 'wall' }]), P.PermissionError, /scene.write/);
  await rejects(api.call(ctxFor(['scene.read']), 'project.get', ['settings']), P.PermissionError, /project.read/);
  await rejects(api.call(ctxFor(['scene.read']), 'download', ['a.txt', 'x']), P.PermissionError, /files.download/);
  await rejects(api.call(ctxFor(['scene.read']), 'nothing.here', []), P.ApiError, /Unknown API call/);
  assert.equal((await api.call(ctxFor(['scene.read']), 'scene.find', [{ type: 'wall' }])).length, 1);
  assert.equal(await api.call(ctxFor([]), 'log', ['info', 'hello']), null, 'logging needs no permission');
  const c = ctxFor(['scene.read']); c.calls = P.LIMITS.callsPerRun;
  await rejects(api.call(c, 'scene.find', [{}]), P.ApiError, /Too many API calls/);
});

test('reads return plain copies: editing a result never edits the map; find filters; project.get is a whitelist', async () => {
  const app = mk(); const a = app.createNode('wall', { name: 'North' }), b = app.createNode('door', { name: 'Front' });
  app.scene.get(a.id).tags = ['x'];
  const api = P.editorApi(app), c = ctxFor(['scene.read', 'project.read']);
  const found = await api.call(c, 'scene.find', [{ name: 'nor' }]); assert.deepEqual(found.map((n) => n.name), ['North']);
  assert.deepEqual((await api.call(c, 'scene.find', [{ tag: 'x' }])).map((n) => n.id), [a.id]);
  found[0].p[0] = 999; found[0].props.length = 1;
  assert.notEqual(app.scene.get(a.id).t.p[0], 999);
  assert.equal((await api.call(c, 'scene.get', [b.id])).type, 'door'); assert.equal(await api.call(c, 'scene.get', ['nope']), null);
  const s = await api.call(c, 'project.get', ['settings']); s.hacked = true; assert.ok(!app.project.data.settings.hacked);
  await rejects(api.call(c, 'project.get', ['plugins']), P.ApiError, /must be one of/);
  await rejects(api.call(c, 'project.get', ['scripts']), P.ApiError);
  app.select([b.id]); assert.deepEqual((await api.call(c, 'scene.selection', [])).map((n) => n.name), ['Front']);
});

test('writes are queued, validated, and applied as ONE undoable step only when the run succeeds', async () => {
  const app = mk(); const w = app.createNode('wall', { name: 'W' });
  const api = P.editorApi(app), c = ctxFor(['scene.read', 'scene.write']);
  const before = JSON.stringify(app.scene.toJSON()), undo0 = app.history.undoStack.length;
  const id = await api.call(c, 'scene.create', [{ type: 'light', name: 'Lamp', p: [1, 2, 3], props: { intensity: 7 } }]);
  assert.equal(typeof id, 'string');
  await api.call(c, 'scene.update', [id, { p: [4, 5, 6], props: { intensity: 9 } }]);        // an object created earlier in the same run
  await api.call(c, 'scene.update', [w.id, { name: 'Wall renamed' }]);
  const child = await api.call(c, 'scene.create', [{ type: 'light', name: 'Lamp', parent: id }]);   // a child of an object queued in the same run
  const twin = await api.call(c, 'scene.create', [{ type: 'light', name: 'Lamp' }]);                // same name at the top level: made unique on commit
  assert.equal(JSON.stringify(app.scene.toJSON()), before, 'nothing is applied while the command runs');
  assert.equal(P.commitOps(app, c, 'Plugin “T”: demo'), 5);
  assert.equal(app.history.undoStack.length, undo0 + 1, 'a single undo step');
  assert.equal(app.history.undoStack.at(-1).label, 'Plugin “T”: demo');
  const lamp = app.scene.get(id); assert.deepEqual(lamp.t.p, [4, 5, 6]); assert.equal(lamp.props.intensity, 9);
  assert.equal(app.scene.get(w.id).name, 'Wall renamed');
  assert.equal(app.scene.get(child).parent, id); assert.equal(app.scene.get(child).name, 'Lamp', 'unique among its own siblings');
  assert.equal(app.scene.get(twin).name, 'Lamp 2');
  app.undo(); assert.equal(JSON.stringify(app.scene.toJSON()), before, 'one undo reverts everything the plugin did');
  // a run that fails never commits: the ops simply are not applied
  const c2 = ctxFor(['scene.write']); await api.call(c2, 'scene.create', [{ type: 'wall' }]);
  assert.equal(JSON.stringify(app.scene.toJSON()), before);
  // removal
  const c3 = ctxFor(['scene.write']); await api.call(c3, 'scene.remove', [w.id]); P.commitOps(app, c3, 'x'); assert.equal(app.scene.has(w.id), false);
});

test('write arguments are validated: types, vectors, properties, parents, sizes, budgets', async () => {
  const app = mk(); const w = app.createNode('wall');
  const api = P.editorApi(app), c = () => ctxFor(['scene.read', 'scene.write']);
  await rejects(api.call(c(), 'scene.create', [null]), P.ApiError, /needs an object/);
  await rejects(api.call(c(), 'scene.create', [{ type: 'virus' }]), P.ApiError, /Unknown object type/);
  await rejects(api.call(c(), 'scene.create', [{ type: 'wall', p: [1, 2] }]), P.ApiError, /three finite numbers/);
  await rejects(api.call(c(), 'scene.create', [{ type: 'wall', p: [NaN, 0, 0] }]), P.ApiError, /three finite/);
  await rejects(api.call(c(), 'scene.create', [{ type: 'wall', p: [Infinity, 0, 0] }]), P.ApiError);
  await rejects(api.call(c(), 'scene.create', [{ type: 'wall', p: [2e6, 0, 0] }]), P.ApiError, /1,000,000/);
  await rejects(api.call(c(), 'scene.create', [{ type: 'wall', props: { colour: 'red' } }]), P.ApiError, /no property “colour”/);
  await rejects(api.call(c(), 'scene.create', [{ type: 'wall', props: [1] }]), P.ApiError, /props must be an object/);
  await rejects(api.call(c(), 'scene.create', [{ type: 'wall', parent: 'ghost' }]), P.ApiError, /parent does not exist/);
  await rejects(api.call(c(), 'scene.create', [{ type: 'wall', name: 'x'.repeat(500) }]), P.ApiError, /at most/);
  await rejects(api.call(c(), 'scene.update', ['ghost', { name: 'a' }]), P.ApiError, /does not exist/);
  await rejects(api.call(c(), 'scene.update', [w.id, { props: { nonsense: 1 } }]), P.ApiError, /no property/);
  await rejects(api.call(c(), 'scene.update', [w.id, { s: 'big' }]), P.ApiError, /three finite/);
  await rejects(api.call(c(), 'scene.remove', ['ghost']), P.ApiError, /does not exist/);
  const flood = c(); flood.ops = new Array(P.LIMITS.writesPerRun).fill({ kind: 'noop' });
  await rejects(api.call(flood, 'scene.create', [{ type: 'wall' }]), P.ApiError, /Too many changes/);
});

test('whatever crosses the boundary is plain data: cycles, functions and huge values are refused', () => {
  const cyc = {}; cyc.self = cyc;
  assert.throws(() => P.jsonSafe(cyc), P.ApiError);
  assert.deepEqual(P.jsonSafe({ a: 1, f() {} }), { a: 1 }, 'functions are dropped, not sent');
  assert.equal(P.jsonSafe(undefined), null);
  assert.throws(() => P.jsonSafe('x'.repeat(2_000_000)), P.ApiError, /too large/);
  assert.throws(() => P.jsonSafe(10n), P.ApiError);
});

test('download goes through the host callback (which asks the user) and needs its own permission', async () => {
  const app = mk(); const asked = [];
  const api = P.editorApi(app, { download: async (rec, name, text) => { asked.push([rec.name, name, text]); return name !== 'no.txt'; } });
  assert.deepEqual(await api.call(ctxFor(['files.download'], 'Exporter'), 'download', ['a/b:c.txt', 'hello']), { saved: true });
  assert.deepEqual(asked, [['Exporter', 'a_b_c.txt', 'hello']], 'path characters in the name are neutralised');
  assert.deepEqual(await api.call(ctxFor(['files.download']), 'download', ['no.txt', 'x']), { saved: false }, 'the user said no');
  await rejects(P.editorApi(app).call(ctxFor(['files.download']), 'download', ['a.txt', 'x']), P.ApiError, /not available/);
});

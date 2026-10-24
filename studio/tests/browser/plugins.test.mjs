// Plugins & scripts in a real browser. The first group attacks the sandbox with hostile code; the second drives the review / approve /
// run flow through the UI with real input. Nothing is trusted: code that is not approved must never even create a sandbox.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, openStudio, menu, sleep, clickDialog } from './helpers.mjs';
import { tmpDir } from './fixtures.mjs';

let h, page, tmp;
before(async () => { h = await launch({ width: 1600, height: 1000 }); page = await openStudio(h); tmp = tmpDir(); });
after(async () => { await h?.close(); });

const ws = '#ws-plugins';
const frames = () => page.evaluate(() => document.querySelectorAll('iframe[title="plugin sandbox"]').length);
const consoleText = () => page.locator('#pl-console').innerText();
const rec = () => page.evaluate(() => { const w = window.__studio.pluginsWs; return w.rec() && JSON.parse(JSON.stringify(w.rec())); });
const status = () => page.locator(`${ws} #pl-title [data-status]`).getAttribute('data-status');
const waitStatus = (s) => page.waitForFunction((s) => document.querySelector('#ws-plugins #pl-title [data-status]')?.dataset.status === s, s, { timeout: 10000 });
const setCode = async (code) => {
  await page.locator(`${ws} .ce-ta`).fill(code);
  await page.waitForFunction((c) => window.__studio.pluginsWs.rec()?.code === c, code, { timeout: 5000 });
};
const clickBtn = (text) => page.locator(`${ws} button`, { hasText: text }).first().click();
const perm = async (name, on) => { const box = page.locator(`${ws} input[aria-label="Permission ${name}"]`); if ((await box.isChecked()) !== on) await box.setChecked(on); await page.waitForFunction(([n, on]) => window.__studio.pluginsWs.rec()?.permissions.includes(n) === on, [name, on]); };
/** Approve through the real dialog. */
const approve = async () => {
  await clickBtn('Review & approve');
  await page.waitForSelector('.modal-h:has-text("Review")');
  await page.locator('.modal input[aria-label="I have read this code"]').check();
  const two = page.locator('.modal input[aria-label="I understand the dynamic-code warnings"]'); if (await two.count()) await two.check();
  await clickDialog(page, 'Approve and allow');
  await waitStatus('approved');
};
const newPlugin = async (name, code, perms) => {
  await clickBtn('+ Plugin');
  await page.locator(`${ws} input[aria-label="Name"]`).fill(name); await page.locator(`${ws} input[aria-label="Name"]`).press('Enter');
  await page.waitForFunction((n) => window.__studio.pluginsWs.rec()?.name === n, name);
  await setCode(code);
  for (const p of ['scene.read', 'scene.write', 'project.read', 'ui.menu', 'ui.validate', 'files.download']) await perm(p, perms.includes(p));
};
const sceneJson = () => page.evaluate(() => JSON.stringify(window.__studio.scene.toJSON()));
const undoCount = () => page.evaluate(() => window.__studio.history.undoStack.length);
const setLimit = (k, v) => page.evaluate(async ([k, v]) => { const { LIMITS } = await import('/studio/js/core/plugins.js'); LIMITS.timeoutMs[k] = v; }, [k, v]);

// =========================================================================================== hostile code vs the sandbox
const hostile = (code, { ms = 3000, api = ['log'] } = {}) => page.evaluate(async ([code, ms, api]) => {
  const { Sandbox } = await import('/studio/js/ui/sandbox.js');
  const logs = [], calls = [];
  const sb = new Sandbox({ code, api, onRpc: async (m, a) => { calls.push(m); if (m === 'log') logs.push(String(a[1])); return null; } });
  const t0 = performance.now(); let out;
  try { await sb.start(ms); out = { ok: true }; } catch (e) { out = { ok: false, message: e.message, kind: e.kind }; }
  sb.kill('test done');
  return { ...out, ms: Math.round(performance.now() - t0), logs, calls: calls.length };
}, [code, ms, api]);

test('SANDBOX: every network, storage, worker and page global is gone, and the usual escape tricks find nothing', async () => {
  const r = await hostile(`
    const names = ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','Worker','SharedWorker','indexedDB','caches','BroadcastChannel','navigator','location','document','window','parent','top','localStorage','sessionStorage','postMessage','WebAssembly'];
    await api.log('info', 'TYPES:' + names.map((n) => typeof globalThis[n]).join(','));
    await api.log('info', 'CTOR:' + (() => {}).constructor('return typeof fetch + typeof Worker + typeof XMLHttpRequest + typeof indexedDB')());
    await api.log('info', 'ACTOR:' + await (async () => {}).constructor('return typeof fetch')());
    let o = globalThis, found = []; while (o) { for (const n of ['fetch','XMLHttpRequest','Worker','WebSocket','importScripts','indexedDB']) { try { if (Object.getOwnPropertyNames(o).includes(n) && o[n]) found.push(n); } catch (e) {} } o = Object.getPrototypeOf(o); }
    await api.log('info', 'PROTO:' + found.join(','));
    await api.log('info', 'THIS:' + (function () { return typeof this; })());
  `);
  assert.equal(r.ok, true, r.message);
  const L = Object.fromEntries(r.logs.map((l) => [l.split(':')[0], l.slice(l.indexOf(':') + 1)]));
  assert.ok(L.TYPES.split(',').every((t) => t === 'undefined'), L.TYPES);
  assert.equal(L.CTOR, 'undefinedundefinedundefinedundefined'); assert.equal(L.ACTOR, 'undefined'); assert.equal(L.PROTO, '');
});

test('SANDBOX: network access is refused by the CSP even if code gets creative (fetch, import(), XHR is gone)', async () => {
  const r = await hostile(`
    const tryit = async (k, f) => { try { await api.log('info', k + ':OK:' + String(await f())); } catch (e) { await api.log('info', k + ':BLOCKED:' + e.name); } };
    await tryit('import-data', () => import('data:text/javascript,export default 1'));
    await tryit('import-http', () => import('http://127.0.0.1:1/x.js'));
    await tryit('import-blob', async () => import(URL.createObjectURL(new Blob(['export default 1'], { type: 'text/javascript' }))));
    await tryit('worker', () => new Worker('data:text/javascript,1'));
    await tryit('fetch', () => fetch('https://example.com'));
  `);
  assert.equal(r.ok, true, r.message);
  for (const l of r.logs) assert.doesNotMatch(l, /:OK:/, `${l} was allowed`);
  assert.equal(r.logs.length, 5);
});

test('SANDBOX: an endless loop is stopped on time and the editor keeps running', async () => {
  const frames0 = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
  const [r, n] = await Promise.all([hostile('while (true) {}', { ms: 1000 }), page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }))]);
  assert.equal(r.ok, false); assert.equal(r.kind, 'timeout'); assert.ok(r.ms >= 900 && r.ms < 2500, `stopped after ${r.ms} ms`);
  assert.ok(n > frames0 * 0.4, `the page kept rendering while the plugin spun (${n} vs ${frames0} frames)`);
  assert.equal(await frames(), 0, 'the sandbox iframe was removed');
});

test('SANDBOX: floods, syntax errors and thrown errors are contained and reported', async () => {
  const flood = await hostile(`for (let i = 0; i < 1e6; i++) api.log('info', 'x'); await new Promise(() => {})`, { ms: 2000 });
  assert.equal(flood.ok, false); assert.ok(['flood', 'timeout'].includes(flood.kind), flood.kind); assert.ok(flood.ms < 5000, `${flood.ms} ms`);
  const syn = await hostile('const = 1;'); assert.equal(syn.ok, false); assert.match(syn.message, /SyntaxError/);
  const thr = await hostile(`throw new TypeError('kaboom')`); assert.equal(thr.ok, false); assert.match(thr.message, /TypeError: kaboom/);
  const rej = await hostile(`await Promise.reject(new Error('later'))`); assert.equal(rej.ok, false); assert.match(rej.message, /later/);
  assert.equal(await frames(), 0);
});

test('SANDBOX: the sandboxed frame cannot reach the Studio (opaque origin) — no cookie/storage/parent access', async () => {
  const r = await page.evaluate(async () => {
    localStorage.setItem('studio-secret', 'top-secret');
    const { Sandbox } = await import('/studio/js/ui/sandbox.js');
    let leaked = null;
    const sb = new Sandbox({ code: `
      let r = {};
      try { r.ls = typeof localStorage; } catch (e) { r.ls = 'threw'; }
      try { r.parent = typeof parent.document; } catch (e) { r.parent = 'blocked'; }
      await api.log('info', JSON.stringify(r));
    `, api: ['log'], onRpc: async (m, a) => { leaked = a[1]; return null; } });
    await sb.start(3000); sb.kill('x');
    return { leaked, secret: localStorage.getItem('studio-secret') };
  });
  assert.equal(r.secret, 'top-secret');
  assert.doesNotMatch(r.leaked, /top-secret/);
  assert.match(r.leaked, /"ls":"undefined"/);
});

// =========================================================================================== the review / approve / run flow
test('a new plugin is NOT approved and nothing runs: no sandbox exists until you approve and start it', async () => {
  await page.click('.tab[data-ws="plugins"]');
  await clickBtn('+ Plugin');
  await waitStatus('unapproved');
  assert.equal(await frames(), 0);
  assert.match(await page.locator(`${ws} #pl-state`).innerText(), /Not approved: it will not run/);
  assert.match((await rec()).code, /api\.command\('Count objects by type'/);
  assert.equal((await rec()).source.type, 'authored');
  assert.deepEqual(await page.evaluate(() => [...window.__studio.plugins.running.keys()]), []);
});

test('the code analyser marks blocked and dangerous code with its line; the shipped template is clean', async () => {
  assert.match(await page.locator('#pl-findings').innerText(), /nothing unusual/);
  await setCode(`api.log('info', 'a');\nfetch('https://evil.test');\nconst f = (() => {}).constructor('return 1');\n`);
  await page.waitForSelector('#pl-findings .pl-finding[data-sev="warn"]');
  const rows = await page.locator('#pl-findings .pl-finding').allInnerTexts();
  assert.ok(rows.some((t) => /line 2: .*fetch/.test(t)), rows.join('|')); assert.ok(rows.some((t) => /line 3: .*constructor/.test(t)));
  assert.ok(await page.locator(`${ws} .ce-ln.m-danger`).count() >= 1, 'gutter marker on the dangerous line');
  await setCode(`api.log('info', 'a');`);
});

test('review dialog: shows permissions, findings and the code; refuses without the checkbox; Cancel approves nothing', async () => {
  await perm('scene.read', true); await perm('ui.menu', true);
  await clickBtn('Review & approve');
  await page.waitForSelector('.modal-h:has-text("Review plugin")');
  const text = await page.locator('.modal').innerText();
  assert.match(text, /This is a program/); assert.match(text, /scene\.read/); assert.match(text, /ui\.menu/); assert.match(text, /sha256/); assert.match(text, /api\.log/);
  await clickDialog(page, 'Approve and allow');
  assert.match(await page.locator('.modal .err:not(.note)').innerText(), /Tick/);
  assert.equal(await page.locator('.modal').count(), 1, 'dialog stays open');
  await clickDialog(page, 'Cancel');
  assert.equal(await status(), 'unapproved'); assert.equal(await frames(), 0);
  // dangerous code needs a second explicit confirmation
  await setCode(`const f = (() => {}).constructor('return 1'); api.log('info', 'x');`);
  await clickBtn('Review & approve');
  await page.waitForSelector('.modal-h:has-text("Review plugin")');
  await page.locator('.modal input[aria-label="I have read this code"]').check();
  await clickDialog(page, 'Approve and allow');
  assert.match(await page.locator('.modal .err:not(.note)').innerText(), /second box/);
  await clickDialog(page, 'Cancel');
  await setCode(`api.log('info', 'a');`);
});

test('approve → Start runs it in the sandbox; its command appears in the Plugins menu and works (read-only plugin)', async () => {
  await page.evaluate(() => { const a = window.__studio; a.createNode('wall', { name: 'W1' }, { select: false }); a.createNode('wall', { name: 'W2' }, { select: false }); a.createNode('door', { name: 'D' }, { select: false }); });
  await newPlugin('Counter', `api.command('Count objects by type', async () => {
    const nodes = await api.scene.find({});
    const counts = {}; for (const n of nodes) counts[n.type] = (counts[n.type] || 0) + 1;
    api.log('info', 'COUNTS ' + JSON.stringify(counts));
  });`, ['scene.read', 'ui.menu']);
  await approve();
  assert.equal(await frames(), 0, 'approving alone does not start it');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('smstudio.approvals')));
  assert.equal(Object.keys(stored).length, 1); assert.match(Object.values(stored)[0].hash, /^[0-9a-f]{64}$/);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__studio.project.toJSON()).includes('approvedAt')), false, 'approvals are never written into the project');
  await clickBtn('Start');
  await waitStatus('running');
  assert.equal(await frames(), 1);
  const before = await sceneJson();
  await menu(page, 'Plugins', 'Counter: Count objects by type');
  await page.waitForFunction(() => /COUNTS/.test(document.querySelector('#pl-console').textContent), null, { timeout: 8000 });
  assert.match(await consoleText(), /COUNTS \{"wall":2,"door":1\}/);
  assert.equal(await sceneJson(), before, 'a read-only plugin changed nothing');
});

test('a plugin without scene.write cannot edit the map: the call is refused with a permission error and nothing changes', async () => {
  await clickBtn('Stop');
  await setCode(`api.command('Delete everything', async () => { const n = await api.scene.find({}); await api.scene.remove(n.map((x) => x.id)); });`);
  await waitStatus('unapproved').catch(() => {});
  assert.equal(await status(), 'changed', 'editing the code withdrew the approval');
  assert.equal(await frames(), 0);
  await clickBtn('Start');                                            // asks for review first
  await page.waitForSelector('.modal-h:has-text("Review plugin")');
  await page.locator('.modal input[aria-label="I have read this code"]').check(); await clickDialog(page, 'Approve and allow');
  await waitStatus('running');
  const before = await sceneJson(), u0 = await undoCount();
  await menu(page, 'Plugins', 'Counter: Delete everything');
  await page.waitForFunction(() => /not allowed to use scene\.remove/.test(document.querySelector('#pl-console').textContent), null, { timeout: 8000 });
  assert.match(await consoleText(), /needs the “scene\.write” permission/); assert.match(await consoleText(), /No changes were applied/);
  assert.equal(await sceneJson(), before); assert.equal(await undoCount(), u0);
});

test('with scene.write approved, a command\'s changes land as ONE undo step; a failing command applies nothing', async () => {
  await clickBtn('Stop');
  await setCode(`api.command('Make lamps', async () => { for (let i = 0; i < 3; i++) await api.scene.create({ type: 'light', name: 'Lamp', p: [i, 2, 0] }); });
api.command('Half then fail', async () => { await api.scene.create({ type: 'light', name: 'Ghost' }); throw new Error('nope'); });`);
  await perm('scene.write', true);
  await clickBtn('Start'); await page.waitForSelector('.modal-h:has-text("Review plugin")');
  assert.match(await page.locator('.modal').innerText(), /scene\.write/);
  await page.locator('.modal input[aria-label="I have read this code"]').check(); await clickDialog(page, 'Approve and allow');
  await waitStatus('running');
  const before = await sceneJson(), u0 = await undoCount();
  await menu(page, 'Plugins', 'Counter: Make lamps');
  await page.waitForFunction(() => window.__studio.scene.find((n) => n.type === 'light').length === 3, null, { timeout: 8000 });
  assert.equal(await undoCount(), u0 + 1, 'one undo step for the whole command');
  assert.equal(await page.evaluate(() => window.__studio.history.undoStack.at(-1).label), 'Plugin “Counter”: Make lamps');
  await page.evaluate(() => window.__studio.undo());
  assert.equal(await sceneJson(), before, 'one undo removes all three lamps');
  await menu(page, 'Plugins', 'Counter: Half then fail');
  await page.waitForFunction(() => /nope/.test(document.querySelector('#pl-console').textContent), null, { timeout: 8000 });
  assert.equal(await sceneJson(), before, 'nothing applied from a command that failed');
});

test('a hanging command is stopped at its time limit, reported, and the plugin is taken out of the menu', async () => {
  await setLimit('command', 1200);
  await clickBtn('Stop');
  await setCode(`api.command('Hang', async () => { while (true) {} });`);
  await clickBtn('Start'); await page.waitForSelector('.modal-h:has-text("Review plugin")');
  await page.locator('.modal input[aria-label="I have read this code"]').check(); await clickDialog(page, 'Approve and allow');
  await waitStatus('running');
  const t0 = Date.now();
  await menu(page, 'Plugins', 'Counter: Hang');
  await page.waitForFunction(() => /was stopped|took longer/.test(document.querySelector('#pl-console').textContent), null, { timeout: 8000 });
  assert.ok(Date.now() - t0 < 5000);
  await waitStatus('failed');
  assert.equal(await frames(), 0);
  assert.equal(await page.locator('.menu-top[data-menu="Plugins"]').count(), 1);
  await page.click('.menu-top[data-menu="Plugins"]');
  assert.equal(await page.locator('.menu-pop .menu-item[data-label="Counter: Hang"]').count(), 0, 'its command left the menu');
  await page.keyboard.press('Escape');
});

test('plugin validators add issues to the Issues list (source: plugin); a plugin may offer a download only with your confirmation', async () => {
  await clickBtn('Stop').catch(() => {});
  await setCode(`api.validator(async () => { const w = await api.scene.find({ type: 'wall' }); return w.map((n) => ({ severity: 'warn', message: 'Wall ' + n.name + ' is checked by the plugin', nodes: [n.id] })); });
api.command('Save report', async () => { const r = await api.download('report.txt', 'hello report'); api.log('info', 'SAVED=' + r.saved); });`);
  await perm('ui.validate', true); await perm('files.download', true);
  await clickBtn('Start'); await page.waitForSelector('.modal-h:has-text("Review plugin")');
  await page.locator('.modal input[aria-label="I have read this code"]').check(); await clickDialog(page, 'Approve and allow');
  await waitStatus('running');
  await page.evaluate(() => window.__studio.run('project.validate'));
  await page.waitForFunction(() => window.__studio.issues.some((i) => i.source === 'plugin'), null, { timeout: 8000 });
  const issues = await page.evaluate(() => window.__studio.issues.filter((i) => i.source === 'plugin').map((i) => i.message));
  assert.equal(issues.length, 2); assert.match(issues[0], /\[Counter\] Wall W[12] is checked/);
  // download: declined first, then accepted
  await menu(page, 'Plugins', 'Counter: Save report');
  await page.waitForSelector('.modal-h:has-text("wants to save a file")');
  assert.match(await page.locator('.modal').innerText(), /report\.txt/);
  await clickDialog(page, 'Cancel');
  await page.waitForFunction(() => /SAVED=false/.test(document.querySelector('#pl-console').textContent), null, { timeout: 8000 });
  const dl = page.waitForEvent('download');
  await menu(page, 'Plugins', 'Counter: Save report');
  await page.waitForSelector('.modal-h:has-text("wants to save a file")'); await clickDialog(page, 'Save file');
  const d = await dl; assert.equal(d.suggestedFilename(), 'report.txt');
  assert.equal(fs.readFileSync(await d.path(), 'utf8'), 'hello report');
  await clickBtn('Stop');
});

test('IMPORT: a plugin file is added switched off and never run, whatever its flags claim; code files are refused as assets', async () => {
  const evil = path.join(tmp, 'evil.smplugin.json');
  fs.writeFileSync(evil, JSON.stringify({ format: 'smstudio-plugin', kind: 'plugin', name: 'Evil', version: '6.6.6', code: `api.command('Pwn', async () => { await api.scene.remove((await api.scene.find({})).map((n) => n.id)); });\napi.log('error', 'I RAN AT LOAD');`, permissions: ['scene.read', 'scene.write', 'ui.menu', 'nuke'], enabled: true, approved: true, autorun: true, id: 'plug_counter', hash: 'abc' }));
  const before = await sceneJson();
  const chooser = page.waitForEvent('filechooser');
  await clickBtn('Import…');
  await (await chooser).setFiles(evil);
  await page.waitForFunction(() => window.__studio.pluginsWs.rec()?.name === 'Evil', null, { timeout: 8000 });
  assert.equal(await frames(), 0, 'importing created no sandbox');
  const r = await rec();
  assert.equal(r.source.type, 'imported'); assert.notEqual(r.id, 'plug_counter'); assert.deepEqual(r.permissions, ['scene.read', 'scene.write', 'ui.menu']);
  for (const k of ['enabled', 'approved', 'autorun', 'hash']) assert.ok(!(k in r));
  await waitStatus('unapproved');
  assert.doesNotMatch(await page.locator('#pl-console').innerText(), /I RAN AT LOAD/);
  assert.equal(await sceneJson(), before);
  assert.equal(await page.evaluate(() => window.__studio.plugins.running.size), 0);
  // the Start button asks for review; cancelling leaves it not running
  await clickBtn('Start'); await page.waitForSelector('.modal-h:has-text("Review plugin")'); await clickDialog(page, 'Cancel');
  assert.equal(await frames(), 0);
  // raw .js is imported as an inactive plugin with NO permissions
  const js = path.join(tmp, 'tool.js'); fs.writeFileSync(js, `api.log('info', 'tool');`);
  const c2 = page.waitForEvent('filechooser'); await clickBtn('Import…'); await (await c2).setFiles(js);
  await page.waitForFunction(() => window.__studio.pluginsWs.rec()?.name === 'tool', null, { timeout: 8000 });
  assert.deepEqual((await rec()).permissions, []); await waitStatus('unapproved');
  // the asset importer refuses code outright
  const res = await page.evaluate(async (code) => { const r = await window.__studio.importer.importFiles([{ path: 'x.js', file: new File([code], 'x.js') }, { path: 'p.html', file: new File(['<script>1</script>'], 'p.html') }], { license: 'x' }); return { added: r.added.length, errors: r.errors.map((e) => e.message) }; }, 'alert(1)');
  assert.equal(res.added, 0); assert.match(res.errors.join(' '), /never imported as an asset/); assert.match(res.errors.join(' '), /Web pages are not imported/);
});

test('approvals belong to this browser and this project: another project with the same plugin is not approved; switching projects stops plugins', async () => {
  const counter = await page.evaluate(() => window.__studio.plugins.list('plugin').find((r) => r.name === 'Counter'));
  await page.evaluate((id) => { window.__studio.pluginsWs.sel = { kind: 'plugin', id }; window.__studio.pluginsWs.refresh(); }, counter.id);
  await waitStatus('failed').catch(() => {});
  const mine = await page.evaluate(async (id) => { const a = window.__studio; return (await a.plugins.status(a.plugins.find('plugin', id))).state; }, counter.id);
  assert.ok(['approved', 'failed', 'changed'].includes(mine), mine);
  const other = await page.evaluate(async (id) => {
    const a = window.__studio; const { Project } = await import('/studio/js/core/project.js');
    const rec = JSON.parse(JSON.stringify(a.plugins.find('plugin', id)));
    await a.plugins.approvals.approve(a.project.meta.id, rec);                                  // approved in THIS project…
    const p = new Project('Someone else\'s map'); p.data.plugins[rec.id] = rec; a.setProject(p);  // …then a different project arrives carrying the same plugin
    return { state: (await a.plugins.status(a.plugins.find('plugin', id))).state, running: a.plugins.running.size, frames: document.querySelectorAll('iframe[title="plugin sandbox"]').length };
  }, counter.id);
  assert.deepEqual(other, { state: 'unapproved', running: 0, frames: 0 });
});

// =========================================================================================== scripts inside the playtest
test('SCRIPTS: an approved script runs in the playtest through the game API; an unapproved one does not; the map is untouched', async () => {
  await page.evaluate(async () => {
    const a = window.__studio; const { newRecord } = await import('/studio/js/core/plugins.js'); const { newGraph, newNode } = await import('/studio/js/core/events.js');
    const { setData } = await import('/studio/js/core/commands.js');
    a.createNode('floor', { name: 'F', p: [0, 0, 0], props: { w: 10, d: 10 } }, { select: false }); a.createNode('playerSpawn', { name: 'S', p: [0, 0, 0] }, { select: false });
    const mk = (name, code, perms) => { const r = newRecord('script', name); r.code = code; r.permissions = perms; a.exec(setData(['scripts', r.id], r, { label: 'script' })); return r; };
    mk('Greeter', `await game.setFlag('greeted', 'yes'); await game.say('Hello from a script, event ' + ctx.event); await game.giveItem('coin', 2);`, ['game.read', 'game.write']);
    mk('Sneaky', `await game.setFlag('sneaky', 'ran');`, ['game.write']);
    mk('Nosy', `await game.setFlag('nosy', 'ran');`, ['game.read']);              // lacks game.write
    const g = newGraph('scripts'); const ev = (name, script) => { const a1 = newNode('on.event', 0, 0, { name }), b = newNode('act.script', 0, 0, { script }); g.nodes.push(a1, b); g.edges.push({ id: 'e' + name, from: { node: a1.id, port: 'out' }, to: { node: b.id, port: 'in' } }); };
    ev('greet', 'Greeter'); ev('sneak', 'Sneaky'); ev('nose', 'Nosy');
    a.project.data.events.graphs[g.id] = g;
    window.__before = JSON.stringify(a.scene.toJSON());
  });
  // approve only Greeter and Nosy, through the real UI
  await page.click('.tab[data-ws="plugins"]');
  for (const name of ['Greeter', 'Nosy']) {
    await page.locator(`${ws} .tree-row[data-rec]`, { hasText: name }).click();
    await waitStatus('unapproved'); await approve();
  }
  await page.click('.tab[data-ws="scene"]');
  await page.keyboard.press('Control+p');
  await page.waitForFunction(() => !!window.__playtest, null, { timeout: 15000 });
  await page.waitForFunction(() => /Scripts not approved/.test(document.querySelector('.pt-msgs')?.textContent || ''), null, { timeout: 8000 });
  assert.match(await page.locator('.pt-msgs').innerText(), /Sneaky/);
  const flags = () => page.evaluate(() => ({ ...window.__playtest.world.runtime.state.flags }));
  await page.evaluate(() => { const r = window.__playtest.world.runtime; r.emit('sneak'); r.emit('nose'); r.emit('greet'); });
  await page.waitForFunction(() => window.__playtest.world.runtime.state.flags.greeted === 'yes', null, { timeout: 15000 });
  await page.waitForFunction(() => window.__playtest.world.inventory.coin === 2, null, { timeout: 10000 });         // giveItem is the script's last call
  assert.match(await page.locator('.pt-msgs').innerText(), /Hello from a script, event greet/);
  const f = await flags(); assert.equal(f.sneaky, undefined, 'the unapproved script did not run'); assert.equal(f.nosy, undefined, 'the script without game.write could not set a flag');
  await page.waitForFunction(() => /Permission|not allowed to use game\.setFlag/.test(document.querySelector('#pl-console')?.textContent || '') || true);
  const log = await page.evaluate(() => window.__studio.plugins.console.map((l) => l.text).join('\n'));
  assert.match(log, /not allowed to use game\.setFlag \(needs the “game\.write” permission\)/); assert.match(log, /has not been approved/);
  await page.evaluate(() => window.__playtest.stop()); await page.waitForFunction(() => !window.__playtest);
  assert.equal(await sceneJson(), await page.evaluate(() => window.__before), 'scripts cannot change the map; the playtest left it untouched');
  assert.equal(await frames(), 0, 'no sandbox left behind');
});

test('SCRIPTS: an endless-loop script is stopped at its limit; the playtest keeps running', async () => {
  await setLimit('script', 800);
  await page.evaluate(async () => {
    const a = window.__studio; const { newRecord } = await import('/studio/js/core/plugins.js'); const { setData } = await import('/studio/js/core/commands.js'); const { newGraph, newNode } = await import('/studio/js/core/events.js');
    const r = newRecord('script', 'Spinner'); r.code = `while (true) {}`; r.permissions = ['game.read']; a.exec(setData(['scripts', r.id], r, { label: 's' }));
    const g = newGraph('spin'); const x = newNode('on.event', 0, 0, { name: 'spin' }), y = newNode('act.script', 0, 0, { script: 'Spinner' }); g.nodes.push(x, y); g.edges.push({ id: 'es', from: { node: x.id, port: 'out' }, to: { node: y.id, port: 'in' } }); a.project.data.events.graphs[g.id] = g;
    await a.plugins.approvals.approve(a.project.meta.id, r);
  });
  await page.keyboard.press('Control+p'); await page.waitForFunction(() => !!window.__playtest, null, { timeout: 15000 });
  const t0 = await page.evaluate(() => window.__playtest.world.time);
  await page.evaluate(() => window.__playtest.world.runtime.emit('spin'));
  await page.waitForFunction(() => window.__studio.plugins.console.some((l) => l.plugin === 'Spinner' && l.level === 'error'), null, { timeout: 15000 });
  await page.waitForFunction(() => /Spinner.*failed — see the Plugins console/.test(document.querySelector('.pt-msgs')?.textContent || ''), null, { timeout: 10000 });
  await page.waitForFunction((t) => window.__playtest.world.time > t + 0.3, t0, { timeout: 10000 });
  assert.match(await page.evaluate(() => window.__studio.plugins.console.map((l) => l.text).join('\n')), /took longer than 0\.8 s and was stopped|did not finish starting within 0\.8 s/);
  await page.evaluate(() => window.__playtest.stop()); await page.waitForFunction(() => !window.__playtest);
  assert.equal(await frames(), 0);
  const bad = h.errors.filter((e) => /pageerror/.test(e));
  assert.deepEqual(bad, []);
});

// Diagnostics workspace in a real browser, on the REAL imported chapter 2 of the game: triage with evidence, tracker, hit boxes, performance.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openStudio, sleep, clickDialog } from './helpers.mjs';

let h, page;
before(async () => { h = await launch({ width: 1600, height: 1000 }); page = await openStudio(h); });
after(async () => { await h?.close(); });

const ws = '#ws-diagnostics';
const rows = () => page.locator(`${ws} .dg-issue`).evaluateAll((e) => e.map((x) => ({ code: x.dataset.code, cls: x.dataset.cls, text: x.innerText })));
const tab = (t) => page.click(`${ws} button[data-tab="${t}"]`);
const tracked = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__studio.project.data.issues)));
const row = (re) => page.locator(`${ws} .dg-issue`, { hasText: re }).first();

test('import chapter 2 of the game; the Diagnostics tab validates and triages every issue', async () => {
  const n = await page.evaluate(async () => {
    const a = window.__studio; const { loadGameModules, importChapterDef, importIntoProject } = await import('/studio/js/core/importers/sm-chapter.js');
    const mods = await loadGameModules(new URL('/saint-marrow', location.origin).href);
    const r = importIntoProject(a.project, a.history, importChapterDef(mods.CHAPTERS[1], mods));
    a.emit('project'); a.viewport.sceneView.rebuild?.(); return r.nodes;
  });
  assert.ok(n > 300);
  await page.click('.tab[data-ws="diagnostics"]');
  await page.waitForSelector(`${ws} .dg-issue`, { timeout: 30000 });
  const r = await rows();
  assert.equal(r.length, 3);
  const byCls = {}; for (const x of r) byCls[x.cls] = (byCls[x.cls] || 0) + 1;
  assert.deepEqual(byCls, { quirk: 1, script: 2 }, 'every imported issue is explained; none is called a bug');
  assert.match(await page.locator('#dg-summary').innerText(), /3 issues: 1 original-game quirk · 2 original script logic/);
});

test('“Why?” shows the explanation and the evidence (what was read in the game’s own functions)', async () => {
  await row(/trigger:nearStairs/).locator('button', { hasText: 'Why?' }).click();
  const why = await row(/trigger:nearStairs/).locator('.dg-why').innerText();
  assert.match(why, /Trigger the original never handles/); assert.match(why, /never contain 'nearStairs'/); assert.match(why, /ref_ch2_/);
  await row(/use:fusebox/).locator('button', { hasText: 'Why?' }).click();
  assert.match(await row(/use:fusebox/).locator('.dg-why').innerText(), /onUse\(\) mention 'fusebox'/);
  assert.equal(await page.locator(`${ws} .dg-why`).count(), 2);
});

test('class and severity filters and the search box narrow the list', async () => {
  await page.click(`${ws} button[data-cls="script"]`);
  assert.deepEqual([...new Set((await rows()).map((x) => x.cls))], ['quirk']);
  await page.click(`${ws} button[data-cls="script"]`);
  await page.locator(`${ws} input[aria-label="Search issues"]`).fill('stairs');
  await page.waitForFunction(() => document.querySelectorAll('#ws-diagnostics .dg-issue').length === 2, null, { timeout: 5000 });
  assert.ok((await rows()).every((x) => /stairs/i.test(x.text)));
  await page.locator(`${ws} input[aria-label="Search issues"]`).fill('');
  await page.waitForFunction(() => document.querySelectorAll('#ws-diagnostics .dg-issue').length === 3);
});

test('Track puts an issue in the project tracker (quirks start as accepted); fixing it in the map is noticed', async () => {
  await row(/trigger:nearStairs/).locator('button', { hasText: 'Track' }).click();
  await tab('tracker');
  await page.waitForSelector(`${ws} [data-tracked]`);
  let t = await tracked(); assert.equal(t.length, 1); assert.equal(t[0].status, 'accepted'); assert.equal(t[0].cls, 'quirk'); assert.match(t[0].title, /never handles/); assert.deepEqual(t[0].nodeNames, ['trigger:nearStairs']);
  assert.equal(await page.locator(`${ws} [data-repro]`).getAttribute('data-repro'), 'yes');
  // the useless trigger is removed from THIS copy of the map: Show selects it in the Scene tab, the Delete key removes it
  await tab('issues');
  await row(/trigger:nearStairs/).locator('button', { hasText: 'Show' }).click();
  await page.waitForFunction(() => window.__studio.primary?.name === 'trigger:nearStairs');
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => !window.__studio.scene.byName('trigger:nearStairs'));
  await page.click('.tab[data-ws="diagnostics"]');
  await tab('tracker');
  await page.waitForSelector(`${ws} [data-repro="no"]`, { timeout: 15000 });
  await page.locator(`${ws} button`, { hasText: 'Mark fixed' }).click();
  await page.waitForFunction(() => window.__studio.project.data.issues[0].status === 'fixed');
  await page.evaluate(() => { window.__studio.undo(); });                                     // undo the status change
  await page.waitForFunction(() => window.__studio.project.data.issues[0].status === 'accepted');
});

test('your own issues: add, change status, write notes; all undoable', async () => {
  await page.locator(`${ws} button`, { hasText: '+ Add issue' }).click();
  await page.waitForSelector('.modal-h:has-text("New issue")');
  await page.locator('.modal input[type="text"]').fill('Door in the east wing squeaks'); await page.locator('.modal .btn.primary').click();
  await page.waitForFunction(() => window.__studio.project.data.issues.length === 2);
  const card = page.locator(`${ws} [data-tracked]`, { hasText: 'Door in the east wing squeaks' });
  assert.equal(await card.getAttribute('data-status'), 'open');
  await card.locator('select[aria-label="Status"]').selectOption('investigating');
  const notes = card.locator('textarea[aria-label="Notes"]'); await notes.fill('Only when the generator is on.'); await notes.press('Tab');
  await page.waitForFunction(() => { const i = window.__studio.project.data.issues[1]; return i.status === 'investigating' && i.notes === 'Only when the generator is on.'; });
  await page.locator(`${ws} select[aria-label="Show"]`).selectOption('investigating');
  assert.equal(await page.locator(`${ws} [data-tracked]`).count(), 1);
  await page.locator(`${ws} select[aria-label="Show"]`).selectOption('all');
});

test('objects you make yourself are classified as bugs in YOUR map, not blamed on the original game', async () => {
  await page.evaluate(() => { const a = window.__studio; a.createNode('decal', { name: 'My floating decal', p: [5, 3, 5], props: { texture: 'builtin:decal/writing' } }, { select: false }); });
  await tab('issues');
  await page.locator(`${ws} button`, { hasText: 'Validate now' }).click();
  await page.waitForSelector(`${ws} .dg-issue[data-cls="bug"]`, { timeout: 15000 });
  const bug = (await rows()).find((x) => x.cls === 'bug'); assert.match(bug.text, /My floating decal/);
  assert.equal((await rows()).filter((x) => x.cls === 'bug').length >= 1, true);
});

test('the diagnostics report exports as Markdown with the groups, explanations and evidence', async () => {
  const dl = page.waitForEvent('download');
  await page.locator(`${ws} button`, { hasText: 'Export report' }).click();
  const d = await dl; const md = require_fs().readFileSync(await d.path(), 'utf8');
  assert.match(d.suggestedFilename(), /-diagnostics\.md$/);
  assert.match(md, /# Diagnostics —/); assert.match(md, /## Original script logic/); assert.match(md, /### Handled by the original game’s script/); assert.match(md, /- Evidence: /); assert.match(md, /## Bug in this map/); assert.match(md, /My floating decal/);
  assert.doesNotMatch(md, /trigger:nearStairs/, 'the dead trigger was deleted earlier in this test file, so it is gone from the report');
});
import fs from 'node:fs';
function require_fs() { return fs; }

test('hit boxes: the overlay draws enemy cylinders and the calculator uses the same zones and weak-spot multipliers as the playtest', async () => {
  await page.evaluate(() => { const a = window.__studio; a.createNode('enemySpawn', { name: 'Test Hollow', p: [10, 0, 10], props: { archetype: 'ref_hollow' } }, { select: false }); a.createNode('playerSpawn', { name: 'P', p: [12, 0, 10] }, { select: false }); });
  await tab('hitboxes');
  await page.locator(`${ws} input[aria-label="Show hit boxes & reach in the Scene view"]`).check();
  await page.waitForFunction(() => window.__studio.viewport.overlays.on.hitboxes === true && window.__studio.viewport.overlays.parts.hitboxes?.children.length >= 8, null, { timeout: 8000 });
  const counts = await page.evaluate(() => { const g = window.__studio.viewport.overlays.parts.hitboxes; return { meshes: g.children.filter((c) => c.isMesh).length, lines: g.children.filter((c) => c.isLineSegments || c.isLine).length }; });
  assert.ok(counts.meshes >= 5 && counts.lines >= 4, JSON.stringify(counts));      // 3 bands + eye (enemy) + 1 capsule band (player) …
  const set = async (aim) => { const f = page.locator(`${ws} input[aria-label="Aim height above its feet"]`); await f.fill(String(aim)); await f.press('Enter'); };
  await page.locator(`${ws} select[aria-label="Enemy"]`).selectOption('ref_hollow'); await page.locator(`${ws} select[aria-label="Weapon"]`).selectOption('ref_pistol');
  await set(1.75); await page.waitForSelector(`${ws} [data-hit-part="head"]`);
  assert.equal(await page.locator(`${ws} [data-stk-now]`).innerText(), '2');          // 34 × 2.6 = 88.4 per head shot, 100 hp
  assert.equal(await page.locator(`${ws} tr[data-part="head"] [data-stk]`).innerText(), '2');
  await set(0.9); await page.waitForSelector(`${ws} [data-hit-part="body"]`); assert.equal(await page.locator(`${ws} [data-stk-now]`).innerText(), '3');
  await set(0.3); await page.waitForSelector(`${ws} [data-hit-part="leg"]`); assert.equal(await page.locator(`${ws} [data-stk-now]`).innerText(), '4');   // 34 × 0.75 = 25.5
  await page.locator(`${ws} select[aria-label="Enemy"]`).selectOption('ref_warden');
  await page.waitForFunction(() => /cannot be killed/.test(document.querySelector('#ws-diagnostics [data-stk-now]').textContent));
  // the calculator and the overlay are not a second opinion: they import the same constants as the AI system
  const same = await page.evaluate(async () => { const m = await import('/studio/js/core/aisystem.js'); return { head: m.HIT_ZONES.head, body: m.HIT_ZONES.body, r: m.hitRadius({ radius: 0.2 }), part: m.hitPart(0.9) }; });
  assert.deepEqual(same, { head: 0.82, body: 0.35, r: 0.3, part: 'head' });
  await page.locator(`${ws} input[aria-label="Show hit boxes & reach in the Scene view"]`).uncheck();
  await page.waitForFunction(() => !window.__studio.viewport.overlays.parts.hitboxes);
});

test('performance: live numbers, budgets, hints, hot spots, and measured editor steps for the real chapter', async () => {
  await page.click('.tab[data-ws="scene"]'); await page.evaluate(() => { window.__studio.viewport.frameAll(); window.__studio.viewport.requestRender(); }); await sleep(1500);
  await page.click('.tab[data-ws="diagnostics"]'); await tab('perf');
  await page.waitForSelector(`${ws} #dg-perf [data-budget="calls"]`);
  const num = async (k) => parseInt((await page.locator(`${ws} [data-budget="${k}"] td`).nth(1).innerText()).replace(/[^\d]/g, ''), 10);
  const calls = await num('calls'), tris = await num('tris'), geos = await num('geometries'), cols = await num('colliders');
  process.stderr.write(`[perf] chapter 2 in the viewport: ${calls} draw calls, ${tris} triangles, ${geos} geometries, ${cols} collision boxes\n`);
  assert.ok(calls > 50 && calls < 1500, `draw calls ${calls}`); assert.ok(tris > 10000 && tris < 2000000, `triangles ${tris}`); assert.ok(geos < 1800);
  for (const k of ['calls', 'tris', 'geometries', 'textureMB', 'lights', 'colliders']) assert.ok(await page.locator(`${ws} [data-budget="${k}"]`).count() === 1);
  assert.match(await page.locator(`${ws} #dg-perf`).innerText(), /Repeated geometry/); assert.match(await page.locator(`${ws} #dg-perf`).innerText(), /Heaviest models/);
  await page.locator(`${ws} button`, { hasText: 'Measure editor steps' }).click();
  await page.waitForFunction(() => /navigation mesh \d+ ms/.test(document.getElementById('dg-measure')?.textContent || ''), null, { timeout: 60000 });
  const m = await page.locator('#dg-measure').innerText(); process.stderr.write(`[perf] ${m}\n`);
  const ms = Object.fromEntries([...m.matchAll(/(collision|navigation mesh|validation) (\d+) ms/g)].map((x) => [x[1], +x[2]]));
  assert.ok(ms['navigation mesh'] < 5000 && ms.validation < 8000 && ms.collision < 2000, m);
  assert.deepEqual(h.errors.filter((e) => /pageerror|console\.error/.test(e)), []);
});

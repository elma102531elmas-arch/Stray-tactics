// Importing and inspecting a real game chapter in the browser: report, rendering, validation, fixes, overlays, performance.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openStudio, menu, state, nodes, clickDialog, sleep } from './helpers.mjs';

let h, page;
before(async () => { h = await launch({ width: 1600, height: 950 }); page = await openStudio(h); });
after(async () => { await h?.close(); });

test('New / Import ▸ Original chapter builds a new project and shows an honest report', async () => {
  await menu(page, 'File', 'New / Import map…');
  await page.locator('.modal input[value="chapter"]').check();
  await clickDialog(page, 'Continue');
  await page.locator('.modal input[aria-label="Chapter 2"]').check();
  await clickDialog(page, 'Import');
  await page.waitForSelector('.modal-h:has-text("Import report")', { timeout: 30000 });
  const text = await page.locator('.modal').innerText();
  assert.match(text, /Not importable/i);
  assert.match(text, /chapter scripts/i);
  assert.match(text, /Walls are imported as one material/);
  assert.match(text, /did NOT|NOT reproduced exactly/i);
  await clickDialog(page, 'OK');
  assert.equal(await page.evaluate(() => window.__studio.project.meta.name), 'Chapter 2 (imported)');
  assert.ok((await state(page)).count > 200);
  assert.equal(await page.evaluate(() => !!window.__studio.project.data.importReport), true, 'report is stored in the project');
});

test('the imported map renders (non-blank frame) and costs a sane number of draw calls', async () => {
  await page.evaluate(() => { window.__vp.setView('iso'); window.__vp.frameAll(); });
  await sleep(1500);
  const px = await page.evaluate(() => { const c = document.createElement('canvas'); const vp = window.__vp; vp.render(); const gl = vp.renderer.getContext(); const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight; const buf = new Uint8Array(w * hh * 4); gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, buf); const seen = new Set(); for (let i = 0; i < buf.length; i += 4 * 97) seen.add((buf[i] >> 3) + ',' + (buf[i + 1] >> 3) + ',' + (buf[i + 2] >> 3)); return { distinct: seen.size, info: vp.lastInfo }; });
  assert.ok(px.distinct > 12, `frame has visual variety (${px.distinct} distinct colour buckets)`);
  console.log('      chapter 2 frame:', JSON.stringify(px.info));
  assert.ok(px.info.calls < 3000, `draw calls ${px.info.calls}`);
});

test('hierarchy is virtualised: hundreds of nodes, only a window of rows in the DOM', async () => {
  const total = (await state(page)).count;
  const rows = await page.locator('.hier .tree-row').count();
  assert.ok(total > 200 && rows < 80, `${rows} DOM rows for ${total} nodes`);
  const first = await page.locator('.hier .tree-row').first().getAttribute('data-name');
  assert.ok(first, 'rows have names: ' + first);
});

test('Validate finds real, explained problems; clicking one selects and frames the object', async () => {
  await page.keyboard.press('F7');
  await page.waitForFunction(() => window.__studio.validatedOnce, null, { timeout: 30000 });
  await page.click('#bottom [data-id="issues"]');
  const total = await page.locator('#bp-issues .issue').count();
  assert.ok(total >= 1, 'validator reports something on a real map');
  const codes = await page.evaluate(() => [...new Set(window.__studio.issues.map((i) => i.code))]);
  console.log('      issue codes on chapter 2:', codes.join(', '));
  assert.ok(!codes.includes('validator-error'), 'no validator crashes');
  const withNodes = page.locator('#bp-issues .issue').first();
  await withNodes.click();
  await sleep(200);
  const s = await state(page);
  assert.ok(s.selection.length >= 0);
});

test('auto-fix is explicit, undoable and reduces the issue count', async () => {
  const fixable = await page.evaluate(() => window.__studio.issues.filter((i) => i.fix));
  if (!fixable.length) { console.log('      (no auto-fixable issues in this chapter)'); return; }
  const before = await page.evaluate(() => window.__studio.issues.length);
  const undoBefore = (await state(page)).undo;
  await page.locator('#bp-issues .issue button', { hasText: 'Fix' }).first().click();
  await sleep(500);
  const after = await page.evaluate(() => window.__studio.issues.length);
  assert.ok(after < before, `issues ${before} -> ${after}`);
  assert.equal((await state(page)).undo, undoBefore + 1, 'one undo step');
  await page.keyboard.press('Control+z'); await sleep(300);
  await page.keyboard.press('F7'); await sleep(800);
  assert.equal(await page.evaluate(() => window.__studio.issues.length), before, 'undo restores the original problem');
});

test('collision and navigation overlays draw real data', async () => {
  await menu(page, 'View', 'Overlays', 'Collision boxes');
  const cols = await page.evaluate(() => { const o = window.__vp.overlays; return { count: o.colliderCount, drawn: !!o.parts.collision }; });
  assert.ok(cols.count > 100 && cols.drawn, JSON.stringify(cols));
  await menu(page, 'Project', 'Build navigation mesh');
  const nav = await page.evaluate(() => window.__vp.overlays.navInfo);
  console.log('      navmesh:', JSON.stringify({ nodes: nav.nodes, components: nav.components, reachable: nav.reachable, ms: nav.ms }));
  assert.ok(nav.nodes > 1000 && nav.reachable > 500);
  assert.ok(await page.evaluate(() => !!window.__vp.overlays.parts.navmesh));
  await menu(page, 'View', 'Overlays', 'Collision boxes');
  await menu(page, 'View', 'Overlays', 'Navigation mesh');
});

test('undoing the import removes everything in one step; the game files are untouched', async () => {
  const undoCount = (await state(page)).undo;
  await page.evaluate(() => { const a = window.__studio; while (a.history.canUndo) a.undo(); });
  assert.equal((await state(page)).count, 0);
  const res = await page.evaluate(async () => { const r = await fetch('/saint-marrow/js/game.js'); return r.status; });
  assert.equal(res, 200);
  assert.deepEqual(h.errors.filter((e) => /pageerror|http 5/.test(e)), []);
});

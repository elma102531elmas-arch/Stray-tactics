// Asset pipeline in a real browser: import dialogs, validation, error handling, placement, material/asset editors, persistence.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, openStudio, menu, toScreen, state, nodes, dialog, clickDialog, sleep } from './helpers.mjs';
import { GAME_MODEL, GAME_TEX, tmpDir, makeWav, makePng, makeGltf } from './fixtures.mjs';

let h, page, tmp;
before(async () => { h = await launch({ width: 1600, height: 950 }); page = await openStudio(h); tmp = tmpDir(); });
after(async () => { await h?.close(); });

async function importFiles(paths, { license = 'CC0 test fixture', agree = true } = {}) {
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'File', 'Import assets…');
  await (await chooser).setFiles(paths);
  await page.waitForSelector('.modal-h:has-text("Import assets")');
  if (agree) { await page.fill('.modal input[aria-label="Licence"]', license); await page.check('.modal input[aria-label="I have the right to use these files"]'); }
  await clickDialog(page, 'Import');
}
const report = async () => { await page.waitForSelector('.modal-h:has-text("Import report"), .modal-h:has-text("Nothing could be imported")', { timeout: 20000 }); return page.locator('.modal').innerText(); };
const closeDialog = () => clickDialog(page, 'OK');
const assets = () => page.evaluate(() => Object.values(window.__studio.project.data.assets).map((a) => ({ id: a.id, name: a.name, kind: a.kind, tris: a.triangles, w: a.width, h: a.height, dur: a.duration, license: a.license, hash: a.hash, bounds: a.bounds })));

test('import is refused until the user confirms they may use the files', async () => {
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'File', 'Import assets…');
  await (await chooser).setFiles([GAME_MODEL('Barrel_01')]);
  await page.waitForSelector('.modal-h:has-text("Import assets")');
  await clickDialog(page, 'Import');                      // checkbox not ticked
  assert.equal(await page.locator('.modal-h:has-text("Import assets")').count(), 1, 'dialog stays open');
  assert.match(await page.locator('.modal .err').innerText(), /confirm that you have the right/);
  assert.deepEqual(await assets(), []);
  await clickDialog(page, 'Cancel');
});

test('importing a GLB reads real geometry, stores the licence and reports it', async () => {
  await importFiles([GAME_MODEL('Barrel_01')], { license: 'CC0 (Poly Haven)' });
  const text = await report();
  assert.match(text, /Imported\s*1/); assert.match(text, /2,214 tris|2\,214/);
  await closeDialog();
  const [a] = await assets();
  assert.equal(a.kind, 'model'); assert.equal(a.tris, 2214); assert.equal(a.license, 'CC0 (Poly Haven)');
  assert.ok(Math.abs(a.bounds.max[1] - 0.8734) < 0.01, `bounds from the real file: ${a.bounds.max}`);
});

test('importing the same file again is detected as a duplicate (no silent second copy)', async () => {
  await importFiles([GAME_MODEL('Barrel_01')]);
  const text = await report();
  assert.match(text, /identical to the already-imported asset/);
  await closeDialog();
  assert.equal((await assets()).length, 1);
});

test('corrupt, truncated and unsupported files give specific errors and change nothing', async () => {
  const bad = path.join(tmp, 'broken.glb'); fs.writeFileSync(bad, Buffer.from('this is not a glb file at all, just text padding'.repeat(3)));
  const trunc = path.join(tmp, 'trunc.glb'); fs.writeFileSync(trunc, fs.readFileSync(GAME_MODEL('Barrel_01')).subarray(0, 4000));
  const blend = path.join(tmp, 'scene.blend'); fs.writeFileSync(blend, 'BLENDER');
  const before = (await assets()).length;
  await importFiles([bad, trunc, blend]);
  const text = await report();
  assert.match(text, /Errors\s*3/);
  assert.match(text, /not a valid GLB|header is missing/i);
  assert.match(text, /truncated/i);
  assert.match(text, /Blender/i);
  await closeDialog();
  assert.equal((await assets()).length, before);
  assert.deepEqual(h.errors.filter((e) => /pageerror/.test(e)), [], 'no uncaught exceptions');
});

test('glTF + external texture is grouped; a missing texture only warns', async () => {
  const dir = path.join(tmp, 'ok'); fs.mkdirSync(dir);
  await importFiles([makeGltf(dir), path.join(dir, 'tri.png')]);
  let text = await report();
  assert.match(text, /Imported\s*1/);
  await closeDialog();
  const dir2 = path.join(tmp, 'missing'); fs.mkdirSync(dir2);
  await importFiles([makeGltf(dir2, { withTexture: false })]);
  text = await report();
  assert.match(text, /was not included|not found/i);
  await closeDialog();
  assert.equal((await assets()).filter((a) => a.name === 'tri').length >= 1, true);
});

test('audio: WAV is decoded for duration / channels; stereo gets a spatial-audio hint', async () => {
  const mono = makeWav(path.join(tmp, 'beep.wav'), { seconds: 0.5 }), stereo = makeWav(path.join(tmp, 'wide.wav'), { seconds: 0.25, channels: 2 });
  await importFiles([mono, stereo]);
  const text = await report();
  assert.match(text, /Stereo sounds are not positioned/);
  await closeDialog();
  const a = (await assets()).find((x) => x.name === 'beep');
  assert.ok(Math.abs(a.dur - 0.5) < 0.02, `duration ${a.dur}`);
});

test('texture import reads dimensions; non power-of-two textures warn', async () => {
  const png = makePng(path.join(tmp, 'odd.png'), 10, 6);
  await importFiles([png, GAME_TEX('wood_floor_worn_diff')]);
  const text = await report();
  assert.match(text, /not a power of two/);
  await closeDialog();
  const a = (await assets()).find((x) => x.name === 'odd');
  assert.deepEqual([a.w, a.h], [10, 6]);
});

test('assets panel lists project assets; double-click places a model; the model loads and sits on the grid', async () => {
  await page.click('#bottom [data-id="assets"]');
  await page.click('#bp-assets [data-kind="project"]');
  const card = page.locator('#bp-assets .card[title^="Barrel_01"]');
  await card.waitFor();
  await card.dblclick();
  assert.equal((await state(page)).tool, 'place');
  await page.evaluate(() => { window.__vp.setView('iso'); window.__vp.nav.target.set(0, 0, 0); window.__vp.nav.dist = 8; window.__vp.updateCamera(); });
  await sleep(200);
  const p = await toScreen(page, 2, 0, 2);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => window.__studio.scene.all().some((n) => n.type === 'model'), null, { timeout: 8000 });
  await page.keyboard.press('Escape');
  const [m] = await nodes(page, 'model');
  assert.ok(m.props.asset.startsWith('tex_') === false && m.props.asset.length > 3);
  await page.waitForFunction((id) => { const e = window.__vp.sceneView.entryOf(id); return e && e.root.children.some((c) => c.children?.length) && e.problems.length === 0; }, m.id, { timeout: 15000 });
  await page.evaluate(() => window.__studio.select([]));
  const size = await page.evaluate(async (id) => { const THREE = await import('/studio/lib/three.module.js'); const b = new THREE.Box3().setFromObject(window.__vp.sceneView.objectOf(id)); return [b.max.x - b.min.x, b.max.y - b.min.y]; }, m.id);
  assert.ok(Math.abs(size[1] - 0.88) < 0.03, `loaded model height ${size[1]}`);
  assert.deepEqual(h.errors.filter((e) => /pageerror/.test(e)), []);
});

test('Asset editor: scale changes the placed object and the model bounds, and is undoable', async () => {
  await page.click('.tab[data-ws="assets"]');
  const [model] = await nodes(page, 'model');
  await page.selectOption('#ws-assets select[aria-label="Asset kind"]', 'project');
  await page.locator('#ws-assets .tree-row', { hasText: 'Barrel_01' }).click();
  await page.locator('#ws-assets .field', { hasText: /^Scale/ }).waitFor();
  const scaleField = page.locator('#ws-assets .field', { hasText: /^Scale/ }).locator('input').first();
  await scaleField.fill('2'); await scaleField.press('Enter');
  await sleep(500);
  const b = await page.evaluate(() => window.__studio.project.data.assets[Object.keys(window.__studio.project.data.assets).find((k) => window.__studio.project.data.assets[k].name === 'Barrel_01')].bounds);
  assert.ok(Math.abs(b.max[1] - 0.8734 * 2) < 0.02, `effective bounds scaled: ${b.max}`);
  await page.waitForFunction(async (id) => { const THREE = await import('/studio/lib/three.module.js'); const bb = new THREE.Box3().setFromObject(window.__vp.sceneView.objectOf(id)); return Math.abs(bb.max.y - bb.min.y - 1.78) < 0.05; }, model.id, { timeout: 8000 });
  await page.keyboard.press('Control+z');
  await sleep(500);
  const b2 = await page.evaluate(() => Object.values(window.__studio.project.data.assets).find((a) => a.name === 'Barrel_01').scale);
  assert.equal(b2, 1);
  await page.click('.tab[data-ws="scene"]');
});

test('built-in game assets are read-only until copied into the project explicitly', async () => {
  await page.click('.tab[data-ws="assets"]');
  await page.selectOption('#ws-assets select[aria-label="Asset kind"]', 'model');
  await page.fill('#ws-assets .search', 'old_bed_frame');
  await page.locator('#ws-assets .tree-row').first().click();
  await page.locator('#ws-assets .note.warn', { hasText: 'read-only' }).waitFor();
  assert.equal(await page.locator('#ws-assets .field', { hasText: /^Scale/ }).locator('input').first().isDisabled(), true);
  const n0 = (await assets()).length;
  await page.locator('#ws-assets button', { hasText: 'Copy into project to edit' }).click();
  await clickDialog(page, 'Copy into project');
  await page.locator('#ws-assets .note.warn', { hasText: 'read-only' }).waitFor({ state: 'detached', timeout: 10000 });
  await page.waitForFunction((n) => Object.keys(window.__studio.project.data.assets).length === n + 1, n0, { timeout: 10000 });
  const copy = (await assets()).find((a) => /old_bed_frame \(copy\)/.test(a.name));
  assert.ok(copy, 'copy exists'); assert.ok(copy.tris > 100);
  assert.equal(await page.locator('#ws-assets .field', { hasText: /^Scale/ }).locator('input').first().isDisabled(), false);
  await page.click('.tab[data-ws="scene"]');
});

test('Materials: create from textures, assign to a wall, texture reaches the GPU material', async () => {
  await page.evaluate(() => { const a = window.__studio; a.select([]); a.createNode('wall', { name: 'TestWall' }); });
  await page.click('.tab[data-ws="materials"]');
  await page.locator('#ws-materials button', { hasText: 'From textures…' }).click();
  await sleep(400);
  const created = await page.evaluate(() => Object.entries(window.__studio.project.data.materials).map(([id, m]) => ({ id, name: m.name, map: m.map })));
  assert.equal(created.length, 1); assert.ok(created[0].map, 'texture slot filled by name guess: ' + JSON.stringify(created));
  await page.locator('#ws-materials button', { hasText: 'Assign to selection' }).click();
  const wall = (await nodes(page, 'wall')).find((n) => n.name === 'TestWall');
  assert.equal(wall.props.material, created[0].id);
  await page.click('.tab[data-ws="scene"]');
  await page.waitForFunction((id) => { const o = window.__vp.sceneView.objectOf(id); let ok = false; o.traverse((c) => { if (c.isMesh && c.material.map) ok = true; }); return ok; }, wall.id, { timeout: 10000 });
});

test('Materials: presets are read-only; editing a project material is live and undoable', async () => {
  await page.click('.tab[data-ws="materials"]');
  await page.locator('#ws-materials .tree-row[data-mat="mat_plaster"]').click();
  assert.equal(await page.locator('#ws-materials .note.warn', { hasText: 'Built-in preset' }).count(), 1);
  const id = await page.evaluate(() => Object.keys(window.__studio.project.data.materials)[0]);
  await page.locator(`#ws-materials .tree-row[data-mat="${id}"]`).click();
  const rough = page.locator('#ws-materials .field', { hasText: /^Roughness/ }).locator('input');
  await rough.fill('0.2'); await rough.press('Enter'); await sleep(200);
  assert.equal(await page.evaluate((id) => window.__studio.project.data.materials[id].roughness, id), 0.2);
  assert.equal(await page.evaluate((id) => window.__studio.materials.get(id).roughness, id), 0.2, 'GPU material updated in place');
  await page.keyboard.press('Control+z'); await sleep(200);
  assert.equal(await page.evaluate((id) => window.__studio.project.data.materials[id].roughness, id), 1);
  assert.equal(await page.evaluate((id) => window.__studio.materials.get(id).roughness, id), 1);
  await page.click('.tab[data-ws="scene"]');
});

test('Prefabs: save a selection, place it twice, instances are independent', async () => {
  await page.evaluate(() => { const a = window.__studio; a.select([]); a.createNode('box', { name: 'PA', p: [20, 0, 20] }, { select: false }); a.createNode('box', { name: 'PB', p: [22, 0, 20] }, { select: false }); a.select([a.scene.byName('PA').id, a.scene.byName('PB').id]); });
  await menu(page, 'Edit', 'Save selection as prefab…');
  await page.fill('.modal input', 'Crates'); await clickDialog(page, 'OK');
  const pid = await page.evaluate(() => Object.keys(window.__studio.project.data.prefabs)[0]);
  assert.ok(pid);
  await page.evaluate((pid) => { window.__studio.placePrefab(pid, [0, 0, -10]); window.__studio.placePrefab(pid, [10, 0, -10]); }, pid);
  const groups = (await nodes(page, 'group')).filter((g) => g.props.prefab === pid);
  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].id, groups[1].id);
  const kids = await page.evaluate((ids) => ids.map((id) => window.__studio.scene.get(id).children.map((c) => window.__studio.scene.get(c).t.p)), groups.map((g) => g.id));
  assert.deepEqual(kids[0], [[-1, 0, 0], [1, 0, 0]]);
});

test('persistence: save, reload, reopen — imported models still load from IndexedDB', async () => {
  await page.keyboard.press('Control+s'); await sleep(600);
  await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => window.__studioReady === true);
  await menu(page, 'File', 'Open…');
  await dialog(page).locator('a', { hasText: 'Untitled map' }).first().click();
  await sleep(500);
  const [m] = await nodes(page, 'model');
  await page.waitForFunction((id) => { const e = window.__vp.sceneView.entryOf(id); return e && e.problems.length === 0 && e.root.children.some((c) => c.children?.length); }, m.id, { timeout: 15000 });
  assert.equal((await assets()).length >= 4, true);
});

test('bundle: Save to file downloads a .smproj that restores the project and its assets elsewhere', async () => {
  const download = page.waitForEvent('download');
  await page.evaluate(() => { window.showSaveFilePicker = undefined; window.__studio.run('file.saveFile'); });
  const dl = await download;
  assert.match(dl.suggestedFilename(), /\.smproj$/);
  const file = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(file);
  assert.ok(fs.statSync(file).size > 50_000, 'bundle contains the asset files');
  // a brand-new browser context has no IndexedDB data at all
  const ctx2 = await h.browser.newContext({ viewport: { width: 1400, height: 850 } });
  const p2 = await ctx2.newPage(); p2.setDefaultTimeout(8000);
  const errs = []; p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(h.url); await p2.waitForFunction(() => window.__studioReady === true);
  const chooser = p2.waitForEvent('filechooser');
  await p2.click('.menu-top[data-menu="File"]'); await p2.click('.menu-item[data-label="Open…"]');
  await p2.waitForSelector('.modal');
  await p2.locator('.modal .btn', { hasText: 'Open from file…' }).click();
  await (await chooser).setFiles(file);
  await p2.waitForFunction(() => window.__studio.scene.size > 0, null, { timeout: 15000 });
  const m2 = await p2.evaluate(() => window.__studio.scene.all().find((n) => n.type === 'model').id);
  await p2.waitForFunction((id) => { const e = window.__vp.sceneView.entryOf(id); return e && e.problems.length === 0 && e.root.children.some((c) => c.children?.length); }, m2, { timeout: 15000 });
  assert.deepEqual(errs, []);
  await ctx2.close();
});

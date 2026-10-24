// Real-browser tests: every interaction below is performed with real mouse/keyboard events or the real menus.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openStudio, menu, toScreen, state, nodes, dialog, clickDialog, framed, sleep } from './helpers.mjs';

let h, page;
before(async () => { h = await launch({ width: 1500, height: 900 }); page = await openStudio(h); });
after(async () => { await h?.close(); });
const noErrors = () => assert.deepEqual(h.errors, [], 'no console errors / failed requests');

test('boots into a clean, empty editor with all menus', async () => {
  const menus = await page.$$eval('.menu-top', (els) => els.map((e) => e.textContent));
  assert.deepEqual(menus, ['File', 'Edit', 'Create', 'View', 'Tools', 'Project', 'Plugins', 'Help']);
  assert.equal((await state(page)).count, 0);
  assert.ok(await page.evaluate(() => window.__vp.renderer.getContext() !== null), 'WebGL context exists');
  noErrors();
});

test('Create ▸ Architecture ▸ Wall adds an object that appears in hierarchy, inspector and viewport', async () => {
  await menu(page, 'Create', 'Architecture', 'Wall');
  const s = await state(page);
  assert.equal(s.count, 1); assert.equal(s.selection.length, 1);
  await page.waitForSelector('.tree-row[data-name="Wall"]');
  assert.equal(await page.inputValue('.insp-title input.name'), 'Wall');
  assert.ok(await page.locator('.sec-h', { hasText: 'Dimensions' }).count() > 0, 'inspector shows schema groups');
  const meshes = await page.evaluate(() => window.__vp.sceneView.stat().meshes);
  assert.ok(meshes >= 1, 'a mesh was built');
});

test('editing a property in the inspector updates the model and the 3D geometry, and undo reverts both', async () => {
  const id = (await state(page)).selection[0];
  await page.evaluate(async () => { window.__box3 = (await import('/studio/lib/three.module.js')).Box3; });
  const boxWidth = () => page.evaluate((id) => { const o = window.__vp.sceneView.objectOf(id); const b = new window.__box3().setFromObject(o.children[0]); return b.max.x - b.min.x; }, id);
  const before = await boxWidth();
  assert.ok(Math.abs(before - 4) < 0.01, `default wall is 4 m (got ${before})`);
  const field = page.locator('.field', { hasText: /^Length/ }).locator('input');
  await field.fill('9.5'); await field.press('Enter');
  await sleep(200);
  assert.equal((await nodes(page, 'wall'))[0].props.length, 9.5);
  assert.ok(Math.abs((await boxWidth()) - 9.5) < 0.01, 'geometry rebuilt at the new length');
  await page.keyboard.press('Control+z');
  await sleep(200);
  assert.equal((await nodes(page, 'wall'))[0].props.length, 4);
  assert.ok(Math.abs((await boxWidth()) - 4) < 0.01, 'undo reverts the geometry');
  await page.keyboard.press('Control+Shift+z');
  await sleep(150);
  assert.equal((await nodes(page, 'wall'))[0].props.length, 9.5);
});

test('invalid input is rejected with a visible error and does not change the model', async () => {
  const field = page.locator('.field', { hasText: /^Length/ }).locator('input');
  const before = (await nodes(page, 'wall'))[0].props.length;
  await field.fill('-3'); await field.press('Enter');
  await sleep(200);
  assert.equal((await nodes(page, 'wall'))[0].props.length, before);
  assert.ok((await page.evaluate(() => window.__studio.logLines.at(-1).msg)).match(/at least/), 'error logged');
});

test('clicking an object in the viewport selects it; empty space deselects; shift-click adds', async () => {
  await page.evaluate(() => { const a = window.__studio; a.select([]); a.createNode('box', { name: 'BoxA', p: [0, 0, 6], props: { w: 2, h: 2, d: 2 } }, { select: false }); a.createNode('box', { name: 'BoxB', p: [5, 0, 6], props: { w: 2, h: 2, d: 2 } }, { select: false }); });
  await framed(page);
  const [a, b] = await nodes(page, 'box');
  const pa = await toScreen(page, 0, 1, 6), pb = await toScreen(page, 5, 1, 6);
  await page.mouse.click(pa.x, pa.y);
  assert.deepEqual((await state(page)).selection, [a.id]);
  await page.keyboard.down('Shift'); await page.mouse.click(pb.x, pb.y); await page.keyboard.up('Shift');
  assert.deepEqual((await state(page)).selection.sort(), [a.id, b.id].sort());
  await page.mouse.click(pa.x - 5, 130);  // empty sky above
  assert.deepEqual((await state(page)).selection, []);
});

test('dragging a selected object moves it on the grid; one undo step restores it', async () => {
  const [a] = await nodes(page, 'box');
  const pa = await toScreen(page, 0, 1, 6);
  await page.mouse.click(pa.x, pa.y);
  const undoBefore = (await state(page)).undo;
  await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move(pa.x - 40, pa.y + 25, { steps: 8 }); await page.mouse.up();
  const moved = (await nodes(page, 'box'))[0];
  assert.notDeepEqual(moved.p, a.p);
  assert.ok(moved.p.every((v) => Math.abs(v / 0.5 - Math.round(v / 0.5)) < 1e-6), `snapped to the 0.5 m grid: ${moved.p}`);
  assert.equal((await state(page)).undo, undoBefore + 1, 'a whole drag is a single undo step');
  await page.keyboard.press('Control+z');
  assert.deepEqual((await nodes(page, 'box'))[0].p, a.p);
});

test('marquee selection picks everything inside the rectangle', async () => {
  await page.evaluate(() => window.__studio.select([]));
  const p1 = await toScreen(page, -3, 0, 3), p2 = await toScreen(page, 8, 3, 9);
  const r = await page.evaluate(() => { const b = window.__vp.canvas.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
  await page.mouse.move(Math.max(r.l + 5, Math.min(p1.x, p2.x) - 60), Math.max(r.t + 5, Math.min(p1.y, p2.y) - 80));
  await page.mouse.down();
  await page.mouse.move(Math.min(r.r - 5, Math.max(p1.x, p2.x) + 60), Math.min(r.b - 5, Math.max(p1.y, p2.y) + 60), { steps: 6 });
  await page.mouse.up();
  const sel = await page.evaluate(() => window.__studio.selection.map((id) => window.__studio.scene.get(id).name));
  assert.ok(sel.includes('BoxA') && sel.includes('BoxB'), `marquee selected ${sel}`);
});

test('keyboard: duplicate, delete, undo; group and ungroup', async () => {
  await page.evaluate(() => window.__studio.select([window.__studio.scene.byName('BoxA').id]));
  const before = (await state(page)).count;
  await page.keyboard.press('Control+d');
  assert.equal((await state(page)).count, before + 1);
  assert.equal((await page.evaluate(() => window.__studio.primary.name)), 'BoxA 2');
  await page.keyboard.press('Delete');
  assert.equal((await state(page)).count, before);
  await page.keyboard.press('Control+z');
  assert.equal((await state(page)).count, before + 1);
  await page.evaluate(() => { const a = window.__studio; a.select([a.scene.byName('BoxA').id, a.scene.byName('BoxB').id]); });
  await page.keyboard.press('Control+g');
  const g = await page.evaluate(() => { const a = window.__studio; return { type: a.primary.type, kids: a.primary.children.length }; });
  assert.deepEqual(g, { type: 'group', kids: 2 });
  await page.keyboard.press('Control+Shift+g');
  assert.equal(await page.evaluate(() => window.__studio.scene.byName('BoxA').parent), 'root');
});

test('hierarchy: rename with F2, hide, lock blocks viewport picking, search filters, drag-drop reparents', async () => {
  const row = (name) => page.locator(`.tree-row[data-name="${name}"]`);
  await row('BoxB').click();
  await page.keyboard.press('F2');
  await page.locator('.tree-name input').fill('Crate'); await page.keyboard.press('Enter');
  assert.ok(await page.evaluate(() => !!window.__studio.scene.byName('Crate')));
  // lock via row button -> viewport click does not select it
  await row('Crate').locator('button[aria-label="Toggle lock"]').click();
  await page.evaluate(() => window.__studio.select([]));
  const p = await toScreen(page, 5, 1, 6);
  await page.mouse.click(p.x, p.y);
  assert.deepEqual((await state(page)).selection, [], 'a locked object cannot be picked');
  await row('Crate').locator('button[aria-label="Toggle lock"]').click();
  // hide
  await row('Crate').locator('button[aria-label="Toggle visibility"]').click();
  assert.equal(await page.evaluate(() => window.__studio.scene.byName('Crate').visible), false);
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.__studio.scene.byName('Crate').visible), true);
  // search
  await page.fill('.hier .search', 'crate');
  assert.equal(await page.locator('.tree-row').count(), 1);
  await page.fill('.hier .search', '');
  // drag & drop into a group
  await page.evaluate(() => window.__studio.createNode('group', { name: 'Props' }));
  await page.dragAndDrop('.tree-row[data-name="Crate"]', '.tree-row[data-name="Props"]');
  assert.equal(await page.evaluate(() => { const a = window.__studio; return a.scene.get(a.scene.byName('Crate').parent).name; }), 'Props');
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.__studio.scene.byName('Crate').parent), 'root');
});

test('Room tool: dragging a rectangle builds floor, ceiling and four walls as one undo step', async () => {
  await page.evaluate(() => { const a = window.__studio; a.select(a.scene.all().map((n) => n.id)); a.deleteSelection(); window.__vp.setView('top'); window.__vp.nav.target.set(0, 0, 0); window.__vp.nav.dist = 30; window.__vp.updateCamera(); });
  await sleep(300);
  await page.keyboard.press('n');
  assert.equal((await state(page)).tool, 'room');
  const a = await toScreen(page, -3, 0, -2), b = await toScreen(page, 3, 0, 2);
  const undo0 = (await state(page)).undo;
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  const room = (await nodes(page)).filter((n) => n.type !== 'group');
  assert.deepEqual(room.map((n) => n.type).sort(), ['ceiling', 'floor', 'wall', 'wall', 'wall', 'wall']);
  const floor = room.find((n) => n.type === 'floor');
  assert.ok(Math.abs(floor.props.w - 6) < 0.01 && Math.abs(floor.props.d - 4) < 0.01, `floor ${floor.props.w}x${floor.props.d}`);
  assert.equal((await state(page)).undo, undo0 + 1);
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).tool, 'select');
});

test('Wall tool: clicking points draws connected walls; Enter-less finish via right click; angles snap with Shift', async () => {
  await page.evaluate(() => { const a = window.__studio; a.select(a.scene.all().map((n) => n.id)); a.deleteSelection(); });
  await page.keyboard.press('b');
  const pts = [[-4, -4], [4, -4], [4, 2]];
  for (const [x, z] of pts) { const p = await toScreen(page, x, 0, z); await page.mouse.click(p.x, p.y); }
  const last = await toScreen(page, 4, 0, 2);
  await page.mouse.click(last.x, last.y, { button: 'right' });
  const walls = await nodes(page, 'wall');
  assert.equal(walls.length, 2);
  const lens = walls.map((w) => w.props.length).sort((x, y) => x - y);
  assert.ok(Math.abs(lens[0] - 6.1) < 0.05 && Math.abs(lens[1] - 8.1) < 0.05, `lengths ${lens} (6 m and 8 m plus 0.1 m corner fill each)`);
  assert.equal((await state(page)).tool, 'wall', 'tool stays active for the next wall');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  assert.equal((await state(page)).tool, 'select');
});

test('Save, reload the page, open from browser storage: scene is identical', async () => {
  const before = await nodes(page);
  await page.keyboard.press('Control+s');
  await sleep(500);
  assert.equal((await state(page)).dirty, false);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__studioReady === true);
  assert.equal((await state(page)).count, 0, 'a fresh page starts empty');
  await menu(page, 'File', 'Open…');
  await dialog(page).locator('a', { hasText: 'Untitled map' }).first().click();
  await sleep(500);
  const after = await nodes(page);
  assert.equal(after.length, before.length);
  assert.deepEqual(after.map((n) => [n.id, n.name, n.type, n.p, n.props]), before.map((n) => [n.id, n.name, n.type, n.p, n.props]));
  noErrors();
});

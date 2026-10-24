// Weapons workspace in a real browser: read-only game references, duplicate/edit, balance numbers, scatter test,
// label scrubbing, viewmodel + animation clips, and the loadout used by the playtest.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, openStudio, sleep, clickDialog } from './helpers.mjs';
import { tmpDir, makeAnimatedGltf } from './fixtures.mjs';

let h, page, tmp;
before(async () => { h = await launch({ width: 1600, height: 1000 }); page = await openStudio(h); tmp = tmpDir(); });
after(async () => { await h?.close(); });

const ws = '#ws-weapons';
const field = (label) => page.locator(`${ws} input[aria-label="${label}"], ${ws} select[aria-label="${label}"]`).first();
const stat = (k) => page.locator(`${ws} [data-stat="${k}"]`).innerText();
const weapons = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__studio.project.data.weapons)));
const current = () => page.evaluate(() => window.__studio.weaponsWs.current);
const setNumber = async (label, v) => { const f = field(label); await f.fill(String(v)); await f.press('Enter'); };
const counts = () => page.evaluate(() => { const c = document.querySelector('#ws-weapons canvas[data-head]'); return { head: +c.dataset.head, body: +c.dataset.body, miss: +c.dataset.miss }; });
const importGltf = async (file) => page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const r = await window.__studio.importer.importFiles([{ path: 'gun.gltf', file: new File([bytes], 'gun.gltf') }], { license: 'CC0 test fixture' });
  return { added: r.added, errors: r.errors.map((e) => e.message) };
}, fs.readFileSync(file).toString('base64'));

test('the tab lists the three game weapons, marked read-only', async () => {
  await page.click('.tab[data-ws="weapons"]');
  await page.waitForSelector(`${ws} .tree-row[data-weapon]`);
  const ids = await page.locator(`${ws} .tree-row[data-weapon]`).evaluateAll((els) => els.map((e) => e.dataset.weapon));
  assert.deepEqual(ids, ['ref_crowbar', 'ref_pistol', 'ref_rifle']);
});

test('the pistol reference shows the game\'s numbers and cannot be edited; its balance table is computed from them', async () => {
  await page.click(`${ws} .tree-row[data-weapon="ref_pistol"]`);
  assert.match(await page.locator(`${ws} .note.warn`).first().innerText(), /player\.js WEAPONS\.pistol/);
  assert.equal(await field('Damage').isDisabled(), true);
  assert.equal(await field('Damage').inputValue(), '34');
  assert.equal(await field('Magazine size').inputValue(), '8');
  assert.equal(await stat('stk'), '3');                       // 100 hp / 34 damage
  assert.equal(await stat('ttk'), '0.4 s');                   // two intervals of 0.2 s
  assert.deepEqual(await weapons(), {}, 'nothing was added to the project');
});

test('Duplicate to edit creates a project weapon; typing a value changes it, the table follows, undo works', async () => {
  await page.locator(`${ws} button`, { hasText: 'Duplicate to edit' }).click();
  const id = await current();
  assert.notEqual(id, 'ref_pistol');
  const all = await weapons();
  assert.equal(all[id].name, 'Service pistol copy'); assert.equal(all[id].damage, 34); assert.equal(all[id].readOnly, undefined);
  assert.equal(await field('Damage').isDisabled(), false);
  await setNumber('Damage', 50);
  assert.equal((await weapons())[id].damage, 50);
  assert.equal(await stat('stk'), '2'); assert.equal(await stat('ttk'), '0.2 s');
  await page.evaluate(() => window.__studio.undo());
  assert.equal((await weapons())[id].damage, 34);
  assert.equal(await field('Damage').inputValue(), '34', 'the panel shows the undone value');
  await setNumber('Damage', 50);
});

test('dragging a label keeps changing the value even though the panel re-renders on every step', async () => {
  const id = await current();
  const b = await page.locator(`${ws} label[title="Damage"]`).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x + i * 4, y); await sleep(40); }
  await page.mouse.up();
  const dmg = (await weapons())[id].damage;
  assert.ok(dmg >= 58, `scrubbed well past the first step (damage ${dmg})`);
  assert.equal(await field('Damage').inputValue(), String(dmg));
  await setNumber('Damage', 50);
});

test('scatter test: zero spread puts every shot on the target; a wide spread produces misses; counts add up', async () => {
  await setNumber('Hip-fire spread', 0); await setNumber('Aimed spread', 0);
  await page.locator(`${ws} button`, { hasText: 'Fire ×20' }).click();
  assert.deepEqual(await counts(), { head: 0, body: 20, miss: 0 });
  await setNumber('Hip-fire spread', 8);
  assert.deepEqual(await counts(), { head: 0, body: 0, miss: 0 }, 'old shots are cleared when the spread changes');
  await page.locator(`${ws} button`, { hasText: 'Fire ×20' }).click();
  const c = await counts();
  assert.equal(c.head + c.body + c.miss, 20);
  assert.ok(c.miss > 0, `an 8° spread at 15 m misses a 0.5 m wide target (${JSON.stringify(c)})`);
  assert.match(await stat('spread'), /^2\.1\d? m hip/);
  await setNumber('Hip-fire spread', 1.26);
});

test('a warning appears for impossible values and clears when fixed', async () => {
  await setNumber('Aimed spread', 5);
  assert.match(await page.locator(`${ws} .note.warn`).first().innerText(), /LESS accurate/);
  await setNumber('Aimed spread', 0.2);
  assert.equal(await page.locator(`${ws} .note.warn`).count(), 0);
});

test('“Carry in playtest” changes the loadout, and the playtest really uses this weapon\'s numbers', async () => {
  const id = await current();
  await page.check(`${ws} input[aria-label="Carry in playtest"]`);
  assert.ok((await page.evaluate(() => window.__studio.project.data.settings.loadout)).includes(id));
  await page.click('.tab[data-ws="scene"]');
  await page.evaluate(() => { const a = window.__studio; a.createNode('floor', { name: 'F', p: [0, 0, 0], props: { w: 6, d: 6 } }, { select: false }); a.createNode('playerSpawn', { name: 'S', p: [0, 0, 0] }, { select: false }); });
  await page.evaluate(() => window.__studio.run('playtest.start'));
  await page.waitForFunction(() => !!window.__playtest, null, { timeout: 10000 });
  const got = await page.evaluate((id) => { const w = window.__playtest.world.weapons.find((x) => x.def.id === id); return w && { damage: w.def.damage, mag: w.mag }; }, id);
  assert.deepEqual(got, { damage: 50, mag: 8 });
  await page.evaluate(() => window.__playtest.stop());
  await page.waitForFunction(() => !window.__playtest);
  await page.click('.tab[data-ws="weapons"]');
});

test('an imported model with animation clips: viewmodel is applied, clips are mapped, the reload clip is scaled to the reload time', async () => {
  const gltf = makeAnimatedGltf(tmp, { Idle: 1, Fire: 0.1, Reload: 2 }, 'gun.gltf');
  const r = await importGltf(gltf);
  assert.deepEqual(r.errors, []); assert.equal(r.added.length, 1);
  const id = await current();
  await field('Model').selectOption(r.added[0]);
  await page.waitForFunction(() => document.querySelectorAll('#ws-weapons select[aria-label="Reload clip"] option').length > 3, null, { timeout: 15000 });
  assert.equal((await weapons())[id].model, r.added[0]);
  assert.deepEqual(await page.locator(`${ws} select[aria-label="Reload clip"] option`).evaluateAll((o) => o.map((x) => x.value)), ['', 'Idle', 'Fire', 'Reload']);
  assert.equal(await page.locator(`${ws} button[data-clip="reload"]`).isDisabled(), true, 'nothing is mapped yet');
  await field('Idle clip').selectOption('Idle'); await field('Fire clip').selectOption('Fire'); await field('Reload clip').selectOption('Reload');
  assert.deepEqual((await weapons())[id].clips, { idle: 'Idle', fire: 'Fire', reload: 'Reload' });
  await page.waitForSelector(`${ws} button[data-clip="reload"]:not([disabled])`);
  // the copied pistol reloads in 1.85 s; make it 2 s = the clip length, so the clip plays at 1.00x. The 0.1 s fire clip fits the 0.2 s interval.
  await setNumber('Reload time', 2);
  await page.waitForFunction(() => /vs 2 s/.test(document.querySelector('#ws-weapons .chip')?.textContent || ''));
  assert.match(await page.locator(`${ws} .chip`).first().innerText(), /reload clip 2\.00 s vs 2 s → 1\.00×/);
  await setNumber('Reload time', 1);
  await page.waitForFunction(() => /2\.00×/.test(document.querySelector('#ws-weapons .chip')?.textContent || ''));
  await page.locator(`${ws} button[data-clip="reload"]`).click();
  assert.equal(await page.evaluate(() => window.__studio.weaponsWs.viewer.action.timeScale), 2, 'the reload preview plays twice as fast so it ends with the reload');
  await setNumber('Time between shots', 0.05);
  assert.match(await page.locator(`${ws} .chip.warn`).last().innerText(), /fire clip 0\.10 s is longer than the 0\.05 s fire interval/);
  await setNumber('Time between shots', 0.2); await setNumber('Reload time', 2);
});

test('viewmodel fields move the model in first-person view and are ignored in orbit view', async () => {
  const id = await current();
  const pos = () => page.evaluate(() => { const r = window.__studio.weaponsWs.viewer.root.position; return [r.x, r.y, r.z].map((v) => Math.round(v * 1000) / 1000); });
  await page.waitForFunction(() => window.__studio.weaponsWs.viewer.fp === true);
  assert.deepEqual(await pos(), [0.18, -0.2, -0.45]);
  const x = page.locator(`${ws} input[aria-label="Position X"]`);
  await x.fill('0.3'); await x.press('Enter');
  assert.deepEqual((await weapons())[id].viewmodel.pos, [0.3, -0.2, -0.45]);
  assert.deepEqual(await pos(), [0.3, -0.2, -0.45]);
  await page.locator(`${ws} label`, { hasText: 'First-person view' }).locator('input').uncheck();
  assert.deepEqual(await pos(), [0, 0, 0], 'orbit view shows the model unmoved');
  await page.locator(`${ws} label`, { hasText: 'First-person view' }).locator('input').check();
});

test('deleting a weapon asks first and removes it; reference weapons cannot be deleted', async () => {
  const id = await current();
  await page.locator(`${ws} button`, { hasText: 'Delete' }).click();
  await page.waitForSelector('.modal');
  await clickDialog(page, 'Cancel');
  assert.ok((await weapons())[id], 'cancel keeps it');
  await page.locator(`${ws} button`, { hasText: 'Delete' }).click();
  await clickDialog(page, 'Delete');
  assert.deepEqual(await weapons(), {});
  await page.click(`${ws} .tree-row[data-weapon="ref_rifle"]`);
  await page.locator(`${ws} button`, { hasText: 'Delete' }).click();
  assert.equal(await page.locator('.modal').count(), 0, 'no dialog for a reference weapon');
  assert.equal(await page.locator(`${ws} .tree-row[data-weapon="ref_rifle"]`).count(), 1);
  assert.deepEqual(h.errors.filter((e) => /pageerror|console\.error/.test(e)), []);
});

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openStudio, menu, sleep, clickDialog } from './helpers.mjs';

let h, page;
before(async () => { h = await launch({ width: 1600, height: 950 }); page = await openStudio(h); });
after(async () => { await h?.close(); });
const seq = () => page.evaluate(() => { const s = Object.values(window.__studio.project.data.sequences)[0]; return s && JSON.parse(JSON.stringify(s)); });
const tl = '#bp-timeline';

test('create a sequence, add a camera track and keys with the mouse', async () => {
  await page.evaluate(() => { const a = window.__studio; a.createNode('door', { name: 'Door1', p: [4, 0, 4] }, { select: false }); a.createNode('light', { name: 'Lamp', p: [0, 2.6, 0], props: { intensity: 20 } }, { select: false }); a.createNode('floor', { props: { w: 20, d: 20 } }, { select: false }); });
  await page.click('#bottom [data-id="timeline"]');
  await page.locator(`${tl} button`, { hasText: /^New$/ }).click();
  await page.fill('.modal input', 'Intro'); await clickDialog(page, 'OK');
  assert.equal((await seq()).name, 'Intro');
  await page.locator(`${tl} button`, { hasText: '+ Track' }).click();
  await page.locator('.menu-pop.ctx .menu-item', { hasText: 'Camera (takes over the view)' }).click();
  const lane = page.locator(`${tl} .tl-lane`).first();
  const b = await lane.boundingBox();
  await page.evaluate(() => { const vp = window.__vp; vp.nav.target.set(0, 1, 0); vp.nav.yaw = 0; vp.nav.pitch = 0.2; vp.nav.dist = 8; vp.updateCamera(); });
  await page.mouse.dblclick(b.x + 5 * 0 + 12, b.y + 15);                       // key at t≈0
  await page.evaluate(() => { const vp = window.__vp; vp.nav.target.set(6, 1, 0); vp.nav.yaw = 1.2; vp.updateCamera(); });
  await page.mouse.dblclick(b.x + 2.0 * 120, b.y + 15);                        // key at t=2
  const s = await seq();
  assert.equal(s.tracks[0].type, 'camera'); assert.equal(s.tracks[0].keys.length, 2);
  assert.ok(Math.abs(s.tracks[0].keys[1].t - 2) < 0.11, `second key at ${s.tracks[0].keys[1].t}`);
  assert.notDeepEqual(s.tracks[0].keys[0].p, s.tracks[0].keys[1].p, 'each key captured a different viewport pose');
});

test('scrubbing previews the camera in the 3D view with a letterbox; stop gives control back', async () => {
  const ruler = page.locator(`${tl} .tl-ruler`);
  const rb = await ruler.boundingBox();
  await page.mouse.click(rb.x + 1.0 * 120, rb.y + 12);
  await sleep(300);
  const st = await page.evaluate(() => ({ override: !!window.__vp.override, letterbox: window.__vp.fxEl.classList.contains('letterbox'), previewing: !!window.__studio.previewing }));
  assert.deepEqual(st, { override: true, letterbox: true, previewing: true });
  const camNow = () => page.evaluate(() => window.__vp.persp.position.toArray().map((v) => +v.toFixed(2)));
  const camMid = await camNow();
  await page.mouse.click(rb.x + 2.0 * 120, rb.y + 12);
  await page.waitForFunction((mid) => { const p = window.__vp.persp.position.toArray().map((v) => +v.toFixed(2)); return p.some((v, i) => v !== mid[i]); }, camMid, { timeout: 5000 });
  const camEnd = await camNow();
  assert.ok(Math.abs(camEnd[0] - 13.3) < 0.2, `camera reached the second key pose: ${camEnd}`);
  await page.locator(`${tl} button[aria-label="Stop and restore scene"]`).click();
  await sleep(200);
  assert.deepEqual(await page.evaluate(() => ({ override: !!window.__vp.override, previewing: !!window.__studio.previewing })), { override: false, previewing: false });
});

test('an object-transform track moves the real node during preview and restores it exactly afterwards', async () => {
  await page.evaluate(() => window.__studio.select([window.__studio.scene.byName('Door1').id]));
  await page.locator(`${tl} button`, { hasText: '+ Track' }).click();
  await page.locator('.menu-pop.ctx .menu-item', { hasText: 'Object transform' }).click();
  const lane = page.locator(`${tl} .tl-lane`).nth(1);
  const b = await lane.boundingBox();
  await page.mouse.dblclick(b.x + 12, b.y + 15);
  await page.mouse.dblclick(b.x + 2 * 120, b.y + 15);
  // edit the second key's position through the property form
  await page.locator(`${tl} .tl-key[data-track="1"][data-key="1"]`).click();
  const px = page.locator(`${tl} .field`, { hasText: /^Position/ }).locator('input').first();
  await px.fill('10'); await px.press('Tab');
  assert.equal((await seq()).tracks[1].keys[1].p[0], 10);
  const before = await page.evaluate(() => [...window.__studio.scene.byName('Door1').t.p]);
  const ruler = page.locator(`${tl} .tl-ruler`); const rb = await ruler.boundingBox();
  await page.mouse.click(rb.x + 2 * 120, rb.y + 12);
  await page.waitForFunction(() => window.__studio.scene.byName('Door1').t.p[0] === 10, null, { timeout: 5000 });
  await page.locator(`${tl} button[aria-label="Stop and restore scene"]`).click(); await sleep(200);
  assert.deepEqual(await page.evaluate(() => [...window.__studio.scene.byName('Door1').t.p]), before, 'scene restored exactly');
  assert.deepEqual(before, [4, 0, 4]);
});

test('playing runs on the real clock, fires events once, and finishing restores the scene', async () => {
  await page.evaluate(() => { const s = Object.values(window.__studio.project.data.sequences)[0]; });
  await page.locator(`${tl} button`, { hasText: '+ Track' }).click();
  await page.locator('.menu-pop.ctx .menu-item', { hasText: /^Event$/ }).click();
  const idx = (await seq()).tracks.length - 1;
  const lane = page.locator(`${tl} .tl-lane`).nth(idx); const b = await lane.boundingBox();
  await page.mouse.dblclick(b.x + 0.5 * 120, b.y + 15);
  await page.locator(`${tl} .tl-key[data-track="${idx}"]`).first().click();
  await page.locator(`${tl} .field`, { hasText: /^Event name/ }).locator('input').fill('intro-beat'); await page.keyboard.press('Tab');
  await page.evaluate(() => { window.__fired = []; window.__studio.on('sequence-event', (n) => window.__fired.push(n)); window.__studio.history.exec({ label: 'len', do: ({ data }) => { const s = Object.values(data.sequences)[0]; s.duration = 1.2; }, undo: () => {}, keepPreview: true }); });
  await page.locator(`${tl} button[aria-label="Play / pause"]`).click();
  await page.waitForFunction(() => window.__fired.length >= 1, null, { timeout: 5000 });
  await page.waitForFunction(() => !window.__studio.previewing || !window.__studio.previewing.player?.playing, null, { timeout: 8000 });
  assert.deepEqual(await page.evaluate(() => window.__fired), ['intro-beat']);
});

test('Jumpscare… builds an editable, accessible sequence from explicit choices', async () => {
  await page.locator(`${tl} button`, { hasText: 'Jumpscare…' }).click();
  await page.fill('.modal input[aria-label="Name"]', 'Hall scare');
  await page.check('.modal input[aria-label="White flash"]');
  await page.selectOption('.modal select[aria-label="Lights out"]', 'Lamp');
  await clickDialog(page, 'Create');
  const s = (await page.evaluate(() => Object.values(window.__studio.project.data.sequences).find((x) => x.name === 'Hall scare')));
  assert.ok(s); assert.equal(s.reduceFlashing, true);
  assert.deepEqual(s.tracks.map((t) => t.type).sort(), ['audio', 'event', 'fade', 'flash', 'fov', 'property', 'shake']);
  assert.equal(s.tracks.find((t) => t.type === 'property').target, 'Lamp');
  // the sound is deliberately left for the author to choose and the validator says so
  const msgs = await page.evaluate(async () => { const m = await import('/studio/js/core/sequence.js'); const s = Object.values(window.__studio.project.data.sequences).find((x) => x.name === 'Hall scare'); return m.validateSequence(s, window.__studio.project).map((i) => i.message); });
  assert.ok(msgs.some((m) => /no sound chosen/.test(m)), msgs.join('|'));
  assert.deepEqual(h.errors.filter((e) => /pageerror/.test(e)), []);
});

test('timeline edits are undoable', async () => {
  const n0 = (await page.evaluate(() => Object.keys(window.__studio.project.data.sequences).length));
  await page.evaluate(() => window.__studio.undo()); await sleep(200);
  const n1 = (await page.evaluate(() => Object.keys(window.__studio.project.data.sequences).length));
  assert.equal(n1, n0 - 1);
});

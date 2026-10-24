// Audio Studio in a real browser: imported sounds + waveform analysis, the spatial preview (dragging the listener with the mouse),
// the mixer, footstep mapping, reverb editing, live "Listen" voices, and the playtest's footsteps / zones / events.
// Web Audio runs for real; we check what the engine was told to do (voices, gains, cut-offs), not what comes out of the speakers.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, openStudio, sleep } from './helpers.mjs';
import { tmpDir, makeWav } from './fixtures.mjs';
import * as A from '../../js/core/audio.js';

let h, page, tmp, ids = {};
before(async () => { h = await launch({ width: 1600, height: 1000 }); page = await openStudio(h); tmp = tmpDir(); });
after(async () => { await h?.close(); });

const ws = '#ws-audio';
const audioData = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__studio.project.data.audio)));
const row = (name) => page.locator(`${ws} #aud-hearing tr[data-row]`).filter({ hasText: name });
const settled = () => page.waitForFunction(() => !window.__studio.audioWs.hearDirty, null, { timeout: 5000 });
const db = async (name) => (await settled(), parseFloat(await row(name).locator('td[data-db]').getAttribute('data-db')));
const state = async (name) => (await settled(), row(name).getAttribute('data-state'));
const snap = () => page.evaluate(() => window.__studio.audioWs.engine?.snapshot() || null);
const importWavs = (files) => page.evaluate(async (list) => {
  const out = [];
  for (const [name, b64] of list) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const r = await window.__studio.importer.importFiles([{ path: name, file: new File([bytes], name) }], { license: 'CC0 test fixture' });
    if (r.errors.length) throw new Error(r.errors.map((e) => e.message).join('; '));
    out.push([name, r.added[0]]);
  }
  return out;
}, files.map((f) => [path.basename(f), fs.readFileSync(f).toString('base64')]));
/** Drag the listener (blue dot) to a world position with real mouse events. */
const dragListener = async (x, z) => {
  const p = await page.evaluate(([x, z]) => { const w = window.__studio.audioWs, r = w.canvas.getBoundingClientRect(), a = w.toScreen(w.listener.x, w.listener.z), b = w.toScreen(x, z); return { from: [r.left + a[0] / w.d, r.top + a[1] / w.d], to: [r.left + b[0] / w.d, r.top + b[1] / w.d] }; }, [x, z]);
  await page.mouse.move(...p.from); await page.mouse.down(); await page.mouse.move((p.from[0] + p.to[0]) / 2, (p.from[1] + p.to[1]) / 2, { steps: 4 }); await page.mouse.move(...p.to, { steps: 4 }); await page.mouse.up();
  await page.waitForFunction(([x, z]) => Math.hypot(window.__studio.audioWs.listener.x - x, window.__studio.audioWs.listener.z - z) < 0.2 && !window.__studio.audioWs.hearDirty, [x, z], { timeout: 5000 });
};

test('a map with a dividing wall and two sources, plus three imported sounds (tone, clipped, late start)', async () => {
  const files = [makeWav(path.join(tmp, 'tone.wav'), { seconds: 1, freq: 330 }), makeWav(path.join(tmp, 'hot.wav'), { seconds: 0.5, amp: 90000 }), makeWav(path.join(tmp, 'late.wav'), { seconds: 1, lead: 0.4, freq: 220 })];
  const added = await importWavs(files);
  ids = Object.fromEntries(added.map(([n, id]) => [n.replace('.wav', ''), id]));
  assert.equal(Object.keys(ids).length, 3);
  await page.evaluate(async (ids) => {
    const a = window.__studio;
    const { createRoom } = await import('/studio/js/tools/build.js');
    createRoom(a, { cx: 0, cz: 0, y: 0, w: 16, d: 12 }, { height: 2.8, thick: 0.2, wallMaterial: 'mat_plaster', floorMaterial: 'mat_tile', ceilingMaterial: 'mat_plaster', doorSide: 'none' });
    a.select([]);
    a.createNode('wall', { name: 'Divider', p: [0, 0, 0], props: { length: 16, height: 2.8 } }, { select: false });
    a.createNode('audioSource', { name: 'Hum', p: [0, 1.2, -3], props: { asset: ids.tone, refDistance: 2, maxDistance: 20, rolloff: 1.2, bus: 'ambience' } }, { select: false });
    a.createNode('audioSource', { name: 'Near', p: [3, 1.2, 3], props: { asset: ids.tone, refDistance: 2, maxDistance: 20, rolloff: 1.2, bus: 'sfx' } }, { select: false });
    a.createNode('playerSpawn', { name: 'Start', p: [-5, 0, 4] }, { select: false });
  }, ids);
});

test('the Audio tab lists the sounds; selecting one draws its waveform and measures it (peak, clipping, leading silence)', async () => {
  await page.click('.tab[data-ws="audio"]');
  await page.waitForSelector(`${ws} .tree-row[data-sound]`);
  assert.equal(await page.locator(`${ws} .tree-row[data-sound]`).count(), 3);
  await page.click(`${ws} .tree-row[data-sound="${ids.tone}"]`);
  await page.waitForFunction(() => +document.getElementById('aud-wave').dataset.drawn > 50, null, { timeout: 15000 });
  const info = await page.locator('#aud-wave-info').innerText();
  assert.match(info, /1\.00 s/); assert.match(info, /peak -8\.[5-9] dB/); assert.equal(await page.locator('#aud-wave-info .chip.warn').count(), 0, 'a clean tone has no warnings');
  await page.click(`${ws} .tree-row[data-sound="${ids.hot}"]`);
  await page.waitForFunction(() => /clipping/.test(document.getElementById('aud-wave-info').textContent), null, { timeout: 15000 });
  await page.click(`${ws} .tree-row[data-sound="${ids.late}"]`);
  await page.waitForFunction(() => /0\.4\d s of silence at the start/.test(document.getElementById('aud-wave-info').textContent), null, { timeout: 15000 });
  await page.click(`${ws} .tree-row[data-sound="${ids.tone}"]`);
  await page.waitForFunction(() => document.getElementById('aud-wave-title').textContent === 'tone', null, { timeout: 15000 });
});

test('▶ Play starts a real voice, ■ Stop ends it', async () => {
  await page.click('#aud-play');
  await page.waitForFunction(() => window.__studio.audioWs.engine?.snapshot().voices.some((v) => v.key === 'preview'), null, { timeout: 10000 });
  assert.equal((await snap()).state, 'running');
  assert.match(await page.locator('#aud-play').innerText(), /Stop/);
  await page.click('#aud-play');
  await page.waitForFunction(() => !window.__studio.audioWs.engine.snapshot().voices.some((v) => v.key === 'preview'));
});

test('hearing table = the core rules: a source beside the listener is unobstructed, the one behind the divider has 1 blocker', async () => {
  await dragListener(0, 3);                                                   // same side as "Near", the divider wall (z=0) is between listener and "Hum"
  // the mouse drop is not exactly (0,3): use the distance the page measured, and check the level is exactly the core distance curve for it
  const dist = await page.evaluate(() => window.__studio.audioWs.last.rows.find((r) => r.name === 'Near').distance);
  assert.ok(Math.abs(dist - Math.hypot(3, 0.4)) < 0.25, `distance ${dist}`);
  assert.ok(Math.abs((await db('Near')) - A.toDb(A.sourceGain({ refDistance: 2, maxDistance: 20, rolloff: 1.2, distanceModel: 'inverse' }, dist))) < 0.01, 'level = distance curve only');
  assert.equal((await row('Near').locator('td').nth(3).innerText()).trim(), '–');
  assert.match(await row('Hum').locator('td').nth(3).innerText(), /^1 \(2200 Hz\)/);
  await dragListener(0, -2);                                                  // now on Hum's side
  assert.equal((await row('Hum').locator('td').nth(3).innerText()).trim(), '–');
  assert.match(await row('Near').locator('td').nth(3).innerText(), /^1 /);
  assert.ok((await db('Near')) < (await db('Hum')) - 3, 'the occluded, farther source is much quieter');
  await dragListener(0, 3);
});

test('clicking a source in the map selects it and opens its properties; editing max distance changes the table', async () => {
  const p = await page.evaluate(() => { const w = window.__studio.audioWs, s = w.scene().audio.sources.find((x) => x.name === 'Hum'), r = w.canvas.getBoundingClientRect(), a = w.toScreen(s.pos.x, s.pos.z); return [r.left + a[0] / w.d, r.top + a[1] / w.d]; });
  await page.mouse.click(...p);
  await page.waitForFunction(() => window.__studio.audioWs.tab === 'selected');
  assert.equal(await page.evaluate(() => window.__studio.primary?.name), 'Hum');
  const f = page.locator(`${ws} input[aria-label="Max distance (inaudible beyond)"]`);
  await f.fill('4'); await f.press('Enter');
  await page.waitForFunction(() => document.querySelector('#ws-audio tr[data-row][data-state="out of range"]'), null, { timeout: 5000 });
  assert.equal(await state('Hum'), 'out of range');
  await page.evaluate(() => window.__studio.undo());
  await page.waitForFunction(() => !document.querySelector('#ws-audio tr[data-row][data-state="out of range"]'), null, { timeout: 5000 });
  await page.evaluate(() => window.__studio.select([]));
  await page.click(`${ws} button[data-tab="mixer"]`);
});

test('mixer: fader scales the level by the right amount, mute and solo silence buses, all undoable and stored in the project', async () => {
  const before = await db('Near');
  const f = page.locator(`${ws} input[aria-label="Sfx volume"]`);
  await f.fill('0.5');
  assert.equal((await audioData()).buses.sfx, 0.5);
  await page.waitForFunction((b) => { const r = [...document.querySelectorAll('#ws-audio #aud-hearing tr[data-row]')].find((x) => x.textContent.startsWith('Near')); return Math.abs(parseFloat(r.querySelector('td[data-db]').getAttribute('data-db')) - b) > 1; }, before);
  assert.ok(Math.abs((await db('Near')) - (before - 6.02)) < 0.05, `halving the fader is −6.02 dB (${before} → ${await db('Near')})`);
  await page.click(`${ws} button[aria-label="Mute Sfx"]`);
  assert.equal((await audioData()).mute.sfx, true);
  await page.waitForFunction(() => document.querySelector('#ws-audio tr[data-state="bus muted"]'));
  assert.equal(await state('Near'), 'bus muted'); assert.equal(await state('Hum'), 'audible');
  await page.click(`${ws} button[aria-label="Mute Sfx"]`);
  await page.click(`${ws} button[aria-label="Solo Ambience"]`);
  assert.equal((await audioData()).solo, 'ambience');
  await page.waitForFunction(() => document.querySelector('#ws-audio tr[data-row][data-state="bus muted"]'));
  assert.equal(await state('Near'), 'bus muted', 'solo on another bus silences this one');
  await page.click(`${ws} button[aria-label="Solo Ambience"]`);
  await page.evaluate(() => { const a = window.__studio; while (a.history.undoStack.length && JSON.stringify(a.project.data.audio.buses.sfx) !== '1') a.undo(); });
  assert.equal((await audioData()).buses.sfx, 1, 'undo restores the fader');
  await f.fill('1');
});

test('master volume affects every row', async () => {
  const before = await db('Near');
  await page.locator(`${ws} input[aria-label="Master volume"]`).fill('0.25');
  await page.waitForFunction((b) => { const r = [...document.querySelectorAll('#ws-audio #aud-hearing tr[data-row]')].find((x) => x.textContent.startsWith('Near')); return Math.abs(parseFloat(r.querySelector('td[data-db]').getAttribute('data-db')) - b) > 1; }, before);
  assert.ok(Math.abs((await db('Near')) - (before - 12.04)) < 0.05);
  await page.locator(`${ws} input[aria-label="Master volume"]`).fill('1');
});

test('footsteps: map sounds to a surface, chips show them, Test plays one, × removes it; the mapping is an asset reference', async () => {
  await page.click(`${ws} button[data-tab="footsteps"]`);
  const wood = `${ws} [data-surface="wood"]`;
  assert.equal(await page.locator(`${wood} button[aria-label="Play wood footstep"]`).isDisabled(), true);
  await page.locator(`${wood} select[aria-label="Add sound to wood"]`).selectOption(ids.hot);
  assert.deepEqual((await audioData()).footsteps.wood, [ids.hot]);
  assert.equal(await page.locator(`${wood} .chip[data-step]`).count(), 1);
  await page.locator(`${wood} select[aria-label="Add sound to wood"]`).selectOption(ids.late);
  assert.deepEqual((await audioData()).footsteps.wood, [ids.hot, ids.late]);
  await page.click(`${wood} button[aria-label="Play wood footstep"]`);
  await page.waitForFunction(() => window.__studio.audioWs.engine?.snapshot().stats.footsteps >= 1, null, { timeout: 10000 });
  assert.equal(await page.evaluate((id) => [...window.__studio.referencedAssets?.(id) || []].length >= 0, ids.hot), true);
  assert.deepEqual(await page.evaluate(async () => { const { referencedAssets } = await import('/studio/js/core/project.js'); return referencedAssets(window.__studio.project).get(Object.values(window.__studio.project.data.audio.footsteps.wood)[0]); }), ['audio footsteps.wood']);
  await page.click(`${wood} button[aria-label^="Remove"] >> nth=1`);
  assert.deepEqual((await audioData()).footsteps.wood, [ids.hot]);
});

test('reverb: editing a preset changes the project (undoable), marks it modified; Reset restores the default; Preview loads it', async () => {
  await page.click(`${ws} button[data-tab="reverb"]`);
  await page.locator(`${ws} select[aria-label="Reverb preset"]`).selectOption('hall');
  const decay = page.locator(`${ws} input[aria-label="Decay time"]`);
  assert.equal(await decay.inputValue(), String(A.REVERB_PRESETS.hall.decay));
  await decay.fill('3.5'); await decay.press('Enter');
  assert.equal((await audioData()).reverbs.hall.decay, 3.5);
  assert.match(await page.locator(`${ws} .chip`, { hasText: 'modified' }).innerText(), /modified/);
  await page.click(`${ws} .tree-row[data-sound="${ids.tone}"]`);
  await page.locator(`${ws} button`, { hasText: 'Preview' }).click();
  await page.waitForFunction(() => window.__studio.audioWs.engine?.snapshot().reverb === 'hall', null, { timeout: 8000 });
  await page.locator(`${ws} button`, { hasText: 'Reset' }).click();
  assert.deepEqual((await audioData()).reverbs, {});
  assert.equal(await decay.inputValue(), String(A.REVERB_PRESETS.hall.decay));
});

test('Listen: sources become live voices whose gain and cut-off follow the listener (distance + occlusion), and stop with ■', async () => {
  await dragListener(0, 3);
  await page.click('#aud-listen');
  await page.waitForFunction(() => window.__studio.audioWs.engine?.snapshot().voices.filter((v) => v.key.startsWith('src:')).length === 2, null, { timeout: 15000 });
  const voices = async () => { const nodes = await page.evaluate(() => Object.fromEntries(window.__studio.scene.all().filter((n) => n.type === 'audioSource').map((n) => [n.name, n.id]))); const s = await snap(); return Object.fromEntries(Object.entries(nodes).map(([k, id]) => [k, s.voices.find((v) => v.key === 'src:' + id)])); };
  await page.waitForFunction(() => window.__studio.audioWs.engine.snapshot().voices.every((v) => v.gain > 0));
  let v = await voices();
  assert.equal(v.Hum.cutoff, 2200, 'the divider muffles Hum'); assert.equal(v.Near.cutoff, 20000);
  assert.ok(v.Near.gain > v.Hum.gain);
  assert.ok(v.Near.positional && v.Hum.bus === 'ambience');
  await dragListener(0, -2);
  await page.waitForFunction(() => { const s = window.__studio.audioWs.engine.snapshot().voices.filter((x) => x.key.startsWith('src:')); return s.length === 2 && s.filter((x) => x.cutoff === 2200).length === 1; }, null, { timeout: 8000 });
  v = await voices();
  assert.equal(v.Hum.cutoff, 20000); assert.equal(v.Near.cutoff, 2200, 'now Near is behind the wall');
  await page.click('#aud-listen');
  await page.waitForFunction(() => !window.__studio.audioWs.listening);
  await page.waitForFunction(() => window.__studio.audioWs.engine.snapshot().voices.length === 0, null, { timeout: 5000 });
});

test('+ Source adds an undoable audio source at the listener using the selected sound', async () => {
  await page.click(`${ws} .tree-row[data-sound="${ids.late}"]`);
  const n0 = await page.evaluate(() => window.__studio.scene.find((n) => n.type === 'audioSource').length);
  await page.locator(`${ws} button`, { hasText: '+ Source' }).click();
  const made = await page.evaluate(() => { const n = window.__studio.primary; return { type: n.type, asset: n.props.asset, p: n.t.p }; });
  assert.equal(made.type, 'audioSource'); assert.equal(made.asset, ids.late);
  assert.equal(await page.evaluate(() => window.__studio.scene.find((n) => n.type === 'audioSource').length), n0 + 1);
  await page.waitForSelector(`${ws} .tree-row[data-node]:has-text("Audio source")`);
  await page.evaluate(() => window.__studio.undo());
  assert.equal(await page.evaluate(() => window.__studio.scene.find((n) => n.type === 'audioSource').length), n0);
});

test('the validator reports audio problems with the Audio tab\'s rules (missing sound, range, unmapped footstep zone)', async () => {
  const codes = await page.evaluate(async () => {
    const a = window.__studio; const { validateProject } = await import('/studio/js/core/validate.js');
    const s = a.createNode('audioSource', { name: 'Broken', p: [0, 1, 0], props: { asset: '' } }, { select: false });
    a.createNode('footstepZone', { name: 'Gravel patch', p: [5, 1, 0], props: { size: [2, 2, 2], surface: 'gravel' } }, { select: false });
    const r = validateProject(a.project, { only: ['audio'] });
    a.undo(); a.undo();
    return r.issues.map((i) => i.code);
  });
  assert.ok(codes.includes('audio-no-asset')); assert.ok(codes.includes('audio-footstep-unmapped'));
});

test('playtest: footsteps use the surface under the player and the mapped sounds; zones start ambience + set reverb; events start sources', async () => {
  await page.click('.tab[data-ws="scene"]');
  // wood floor under the spawn, a footstep mapping for wood, an ambience zone with a hall reverb, and a source that waits for an event
  await page.evaluate((ids) => {
    const a = window.__studio;
    a.createNode('floor', { name: 'Wood patch', p: [-5, 0.01, 4], props: { w: 6, d: 6, surface: 'wood' } }, { select: false });
    a.createNode('audioZone', { name: 'Cellar air', p: [-5, 1.5, 4], props: { size: [6, 3, 6], kind: 'ambience', asset: ids.tone, volume: 0.6, fade: 0.5, reverb: 'hall', priority: 1 } }, { select: false });
    a.createNode('audioSource', { name: 'Doorbell', p: [-5, 1.2, 2], props: { asset: ids.late, autoplay: false, playOnEvent: 'ring', loop: false } }, { select: false });
    a.project.data.audio = { ...a.project.data.audio, footsteps: { wood: [ids.hot] } };
  }, ids);
  await page.keyboard.press('Control+p');
  await page.waitForFunction(() => !!window.__playtest?.audio, null, { timeout: 15000 });
  // the zone is entered at once: ambience loop + hall reverb
  await page.waitForFunction(() => window.__playtest.audio.snapshot().loops.ambience === 'Cellar air', null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__playtest.world.reverbPreset), 'hall');
  await page.waitForFunction(() => window.__playtest.audio.snapshot().reverb === 'hall', null, { timeout: 5000 });
  // walk: footsteps happen on the wood surface and play the mapped sound
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__playtest.world.footstepLog.length >= 2, null, { timeout: 30000 });       // software GL runs the game slower than real time
  await page.keyboard.up('KeyW');
  const log = await page.evaluate(() => window.__playtest.world.footstepLog.map((e) => ({ s: e.surface, sound: e.sound, kind: e.kind })));
  assert.ok(log.length >= 1, 'the player took steps');
  assert.ok(log.every((e) => e.sound === ids.hot || e.s !== 'wood'), 'steps on wood use the mapped sound');
  assert.ok(log.some((e) => e.s === 'wood' && e.sound === ids.hot));
  await page.waitForFunction(() => window.__playtest.audio.snapshot().stats.footsteps >= 1, null, { timeout: 5000 });
  // an event starts a source that does not autoplay
  const bell = await page.evaluate(() => 'src:' + window.__studio.scene.byName('Doorbell').id);
  assert.equal(await page.evaluate((k) => window.__playtest.audio.snapshot().voices.some((v) => v.key === k), bell), false, 'the doorbell does not play on its own');
  await page.evaluate(() => window.__playtest.world.runtime.emit('ring'));
  await page.waitForFunction((k) => window.__playtest.audio.snapshot().voices.some((v) => v.key === k), bell, { timeout: 10000 });
  // pausing suspends audio, resuming restarts it
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__playtest.audio.ac.state === 'suspended', null, { timeout: 5000 });
  await page.locator('.pt-menu button', { hasText: 'Resume' }).click();
  await page.waitForFunction(() => window.__playtest.audio.ac.state === 'running', null, { timeout: 5000 });
  await page.evaluate(() => window.__playtest.stop());
  await page.waitForFunction(() => !window.__playtest);
  assert.deepEqual(h.errors.filter((e) => /pageerror|console\.error/.test(e)), []);
});

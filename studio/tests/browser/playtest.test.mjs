import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openStudio, sleep, clickDialog } from './helpers.mjs';

let h, page;
before(async () => { h = await launch({ width: 1500, height: 900 }); page = await openStudio(h); });
after(async () => { await h?.close(); });
const world = () => page.evaluate(() => { const w = window.__playtest.world; return { p: { x: w.player.x, y: w.player.y, z: w.player.z, yaw: w.player.yaw, pitch: w.player.pitch }, inv: { ...w.inventory }, lights: { ...w.lights }, doors: [...w.doors].map(([k, d]) => [k, d.open, d.locked]), flags: { ...w.runtime.state.flags }, msgs: w.messages.map((m) => m.text), objective: w.objective }; });
const sceneJson = () => page.evaluate(() => JSON.stringify(window.__studio.scene.toJSON()));

test('build a small playable map with a locked door, a key, a trigger and an event graph', async () => {
  await page.evaluate(async () => {
    const a = window.__studio;
    const { createRoom } = await import('/studio/js/tools/build.js');
    const { newGraph, newNode } = await import('/studio/js/core/events.js');
    const R = { height: 2.8, thick: 0.2, wallMaterial: 'mat_plaster', floorMaterial: 'mat_tile', ceilingMaterial: 'mat_plaster' };
    createRoom(a, { cx: 0, cz: 0, y: 0, w: 8, d: 6 }, { ...R, doorSide: 'N' });
    // the back room shares no wall with the first room (overlapping walls would hide the door from the player)
    const add = (type, o) => a.createNode(type, o, { select: false });
    add('floor', { name: 'Back floor', p: [0, 0, -6.1], props: { w: 8, d: 6.2 } }); add('ceiling', { name: 'Back ceiling', p: [0, 2.8, -6.1], props: { w: 8, d: 6.2 } });
    add('wall', { name: 'Back N', p: [0, 0, -9.2], props: { length: 8.2, height: 2.8 } }); add('wall', { name: 'Back W', p: [-4, 0, -6.1], r: [0, 90, 0], props: { length: 6.2, height: 2.8 } }); add('wall', { name: 'Back E', p: [4, 0, -6.1], r: [0, 90, 0], props: { length: 6.2, height: 2.8 } });
    a.select([]);
    const door = a.scene.find((n) => n.type === 'door')[0];
    a.setProps(door.id, { doorId: 'D1', locked: 'item:key' });
    a.createNode('playerSpawn', { name: 'Start', p: [0, 0, 1.5] }, { select: false });
    a.createNode('itemSpawn', { name: 'Key', p: [2.5, 0, 1.5], props: { item: 'key' } }, { select: false });
    a.createNode('light', { name: 'Lamp', p: [0, 2.5, -6], props: { powerGroup: 'back', intensity: 20 } }, { select: false });
    a.createNode('trigger', { name: 'Back room zone', p: [0, 1.25, -6], props: { size: [6, 2.5, 4], onEnter: 'entered-back' } }, { select: false });
    const g = newGraph('Back room');
    const t = newNode('on.event', 0, 0, { name: 'entered-back' }), l = newNode('act.light', 0, 0, { group: 'back', action: 'off' }), o = newNode('act.objective', 0, 0, { text: 'Find the way out' });
    g.nodes.push(t, l, o);
    g.edges.push({ id: 'e1', from: { node: t.id, port: 'out' }, to: { node: l.id, port: 'in' } }, { id: 'e2', from: { node: l.id, port: 'out' }, to: { node: o.id, port: 'in' } });
    a.project.data.events.graphs[g.id] = g;
    window.__before = JSON.stringify(a.scene.toJSON());
  });
  assert.equal(await page.evaluate(() => window.__studio.scene.find((n) => n.type === 'door').length), 1);
});

test('Ctrl+P starts the playtest: first-person camera, game lighting, editor helpers hidden', async () => {
  await page.keyboard.press('Control+p');
  await page.waitForFunction(() => !!window.__playtest, null, { timeout: 8000 });
  const st = await page.evaluate(() => ({ shading: window.__vp.shading, helpers: window.__vp.sceneView.helpersVisible, override: !!window.__vp.override, hud: !!document.querySelector('.pt-hud'), tool: window.__studio.playtest !== null }));
  assert.deepEqual(st, { shading: 'game', helpers: false, override: true, hud: true, tool: true });
  const w = await world();
  assert.ok(Math.abs(w.p.z - 1.5) < 0.05 && w.p.y < 0.05, `spawned at the player spawn: ${JSON.stringify(w.p)}`);
});

test('real keyboard input walks the player (W) and turns the view (arrow keys); walls stop movement', async () => {
  const z0 = (await world()).p.z;
  await page.keyboard.down('KeyW'); await sleep(900); await page.keyboard.up('KeyW');
  const z1 = (await world()).p.z;
  assert.ok(z0 - z1 > 0.4, `moved forward (${z0} -> ${z1})`);
  const yaw0 = (await world()).p.yaw;
  await page.keyboard.down('ArrowRight'); await sleep(500); await page.keyboard.up('ArrowRight');
  assert.notEqual((await world()).p.yaw, yaw0, 'arrow key turned the view');
  // walk into the north wall region: must stop at the closed door
  await page.evaluate(() => { const p = window.__playtest.world.player; p.yaw = 0; p.pitch = 0; p.x = 0; p.z = 1.5; });
  await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
  assert.ok((await world()).p.z > -3 + 0.2, `stopped by the closed door (z=${(await world()).p.z})`);
});

test('locked door: E shows the game\'s message; picking up the key (E) then using the door opens it', async () => {
  await page.evaluate(() => { const p = window.__playtest.world.player; p.yaw = 0; p.pitch = 0; p.x = 0; p.z = -2.0; });
  await page.waitForFunction(() => /locked/.test(document.querySelector('.pt-prompt').textContent), null, { timeout: 8000 });
  await page.keyboard.press('KeyE'); await sleep(300);
  assert.ok((await world()).msgs.some((m) => /You need: key/.test(m)));
  // go to the key and look at it
  await page.evaluate(() => { const w = window.__playtest.world; const p = w.player; p.x = 1.9; p.z = 1.5; const e = w.eye(); const dx = 2.5 - e.x, dy = 0.2 - e.y, dz = 1.5 - e.z; p.yaw = Math.atan2(-dx, -dz) * 180 / Math.PI; p.pitch = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI; });
  await page.waitForFunction(() => /take key/.test(document.querySelector('.pt-prompt').textContent), null, { timeout: 8000 });
  await page.keyboard.press('KeyE'); await sleep(250);
  assert.equal((await world()).inv.key, 1);
  await page.evaluate(() => { const p = window.__playtest.world.player; p.yaw = 0; p.pitch = 0; p.x = 0; p.z = -2.0; });
  await page.waitForFunction(() => /open|locked|close/.test(document.querySelector('.pt-prompt').textContent), null, { timeout: 8000 });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__playtest.world.doors.values().next().value.open === true, null, { timeout: 15000 }).catch(() => {});
  assert.equal((await world()).doors[0][1], true, 'door is open');
  // software GL can run at < 1 fps (the simulation then slows down on purpose), so wait for the position, not for a fixed time
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__playtest.world.player.z < -4 && window.__playtest.world.lights.back === 'off', null, { timeout: 60000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const w = await world();
  assert.ok(w.p.z < -4, `walked into the back room (z=${w.p.z})`);
  assert.equal(w.lights.back, 'off', 'trigger → event graph switched the light group off');
  assert.equal(w.objective, 'Find the way out');
  assert.match(await page.locator('.pt-objective').innerText(), /Find the way out/);
});

test('F3 shows live debug information', async () => {
  await page.keyboard.press('F3');
  await page.waitForFunction(() => /entered-back/.test(document.querySelector('.pt-debug')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
  const t = await page.locator('.pt-debug').innerText();
  assert.match(t, /pos/); assert.match(t, /inventory/); assert.match(t, /entered-back/);
  await page.keyboard.press('F3');
});

test('Esc pauses (world frozen), Resume continues, Stop restores the editor exactly and the map is untouched', async () => {
  await page.keyboard.press('Escape'); await sleep(200);
  assert.equal(await page.locator('.pt-pause').isVisible(), true);
  const t0 = await page.evaluate(() => window.__playtest.world.time);
  await sleep(500);
  assert.equal(await page.evaluate(() => window.__playtest.world.time), t0, 'time does not advance while paused');
  await page.locator('.pt-menu button', { hasText: 'Resume' }).click(); await sleep(200);
  assert.equal(await page.locator('.pt-pause').isVisible(), false);
  await page.keyboard.press('Escape'); await sleep(150);
  await page.locator('.pt-menu button', { hasText: 'Stop playtest' }).click();
  await page.waitForFunction(() => !window.__playtest, null, { timeout: 8000 });
  const st = await page.evaluate(() => ({ shading: window.__vp.shading, helpers: window.__vp.sceneView.helpersVisible, override: !!window.__vp.override, hud: !!document.querySelector('.pt-hud'), pt: window.__studio.playtest }));
  assert.deepEqual(st, { shading: 'lit', helpers: true, override: false, hud: false, pt: null });
  assert.equal(await sceneJson(), await page.evaluate(() => window.__before), 'the scene model is byte-identical after the playtest');
  assert.deepEqual(h.errors.filter((e) => /pageerror/.test(e)), []);
});

test('keypad door: wrong code is rejected, right code opens (real dialog)', async () => {
  await page.evaluate(() => { const a = window.__studio; const d = a.scene.find((n) => n.type === 'door')[0]; a.setProps(d.id, { locked: 'code:4711' }); });
  await page.keyboard.press('Control+p'); await page.waitForFunction(() => !!window.__playtest);
  await page.evaluate(() => { const p = window.__playtest.world.player; p.yaw = 0; p.pitch = 0; p.x = 0; p.z = -2.0; });
  await sleep(250); await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal-h:has-text("Keypad")');
  await page.fill('.modal input[aria-label="Door code"]', '0000'); await clickDialog(page, 'Enter'); await sleep(200);
  assert.equal((await world()).doors[0][1], false);
  assert.ok((await world()).msgs.some((m) => /Wrong code/.test(m)));
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal-h:has-text("Keypad")');
  await page.fill('.modal input[aria-label="Door code"]', '4711'); await clickDialog(page, 'Enter'); await sleep(250);
  assert.equal((await world()).doors[0][1], true);
  await page.evaluate(() => window.__playtest.stop());
});

test('a sequence played by an event takes over the camera, freezes the player, and everything is restored afterwards', async () => {
  await page.evaluate(async () => {
    const a = window.__studio;
    const { newSequence, newTrack } = await import('/studio/js/core/sequence.js');
    const { newGraph, newNode } = await import('/studio/js/core/events.js');
    const door = a.scene.find((n) => n.type === 'door')[0]; a.setProps(door.id, { locked: '' });
    const s = newSequence('Cut'); s.duration = 1;
    s.tracks.push(newTrack('camera', { keys: [{ t: 0, p: [0, 1.6, 4], r: [0, 0, 0], fov: 50 }, { t: 1, p: [0, 1.6, 2], r: [0, 0, 0], fov: 50 }] }));
    s.tracks.push(newTrack('transform', { target: 'Key', keys: [{ t: 0, p: [2.5, 0, 1.5] }, { t: 1, p: [2.5, 3, 1.5] }] }));
    s.tracks.push(newTrack('text', { keys: [{ t: 0, dur: 1, text: 'Authored subtitle' }] }));
    s.tracks.push(newTrack('event', { keys: [{ t: 1, name: 'cut-done' }] }));
    a.project.data.sequences[s.id] = s;
    const g = newGraph('Cut'); const t = newNode('on.start'), q = newNode('act.sequence', 0, 0, { sequence: 'Cut' }), d = newNode('on.event', 0, 0, { name: 'cut-done' }), f = newNode('act.setFlag', 0, 0, { name: 'cut', value: 'true' });
    g.nodes.push(t, q, d, f); g.edges.push({ id: 'a', from: { node: t.id, port: 'out' }, to: { node: q.id, port: 'in' } }, { id: 'b', from: { node: d.id, port: 'out' }, to: { node: f.id, port: 'in' } });
    a.project.data.events.graphs[g.id] = g;
    window.__before2 = JSON.stringify(a.scene.toJSON());
  });
  await page.keyboard.press('Control+p'); await page.waitForFunction(() => !!window.__playtest);
  await page.waitForFunction(() => window.__playtest.frozen === true, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__vp.fxEl.classList.contains('letterbox')), true);
  const z0 = (await world()).p.z;
  await page.keyboard.down('KeyW'); await sleep(300); await page.keyboard.up('KeyW');
  assert.equal((await world()).p.z, z0, 'player cannot move during the cutscene');
  assert.match(await page.locator('.vp-fx .fx-subs').innerText(), /Authored subtitle/);
  await page.waitForFunction(() => window.__playtest.frozen === false, null, { timeout: 6000 }).catch(async (e) => { console.log('ERRORS', JSON.stringify(h.errors.slice(0,3)), JSON.stringify(await page.evaluate(() => new Promise((res) => { let c = 0; const t0 = performance.now(); const f = () => { c++; if (performance.now() - t0 > 1500) res({ raf: c, vis: document.visibilityState, hidden: document.hidden, focus: document.hasFocus(), lock: !!document.pointerLockElement, active: document.activeElement && document.activeElement.tagName }); else requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(() => res({ raf: c, stuck: true, vis: document.visibilityState }), 3000); })))); console.log('STATE', JSON.stringify(await page.evaluate(() => { const s = window.__playtest; return { frozen: s.frozen, paused: s.paused, sp: s.seqPlayer && { t: s.seqPlayer.time, d: s.seqPlayer.seq.duration, playing: s.seqPlayer.playing }, time: s.world.time, keys: [...s.keys] }; }))); throw e; });
  assert.equal((await world()).flags.cut, 'true', 'the sequence\'s event reached the event graph');
  assert.equal(await page.evaluate(() => window.__vp.fxEl.classList.contains('letterbox')), false);
  await page.evaluate(() => window.__playtest.stop());
  assert.equal(await sceneJson(), await page.evaluate(() => window.__before2), 'objects moved by the sequence are back in place');
});

test('Playtest from the editor camera starts where you are looking', async () => {
  await page.evaluate(() => { const v = window.__vp; v.setView('iso'); v.nav.target.set(-2, 0, 1.5); v.nav.dist = 6; v.updateCamera(); });
  await page.evaluate(() => window.__studio.run('playtest.fromHere'));
  await page.waitForFunction(() => !!window.__playtest);
  const p = (await world()).p;
  assert.ok(Math.abs(p.x + 2) < 3 && Math.abs(p.z - 1.5) < 3, JSON.stringify(p));
  await page.evaluate(() => window.__playtest.stop());
  assert.deepEqual(h.errors.filter((e) => /pageerror/.test(e)), []);
});

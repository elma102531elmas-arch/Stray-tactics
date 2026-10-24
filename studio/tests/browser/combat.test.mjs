// Weapons and enemies inside the playtest, driven by real mouse and keyboard events in Chromium.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openStudio, sleep } from './helpers.mjs';

let h, page;
before(async () => { h = await launch({ width: 1500, height: 900 }); page = await openStudio(h); });
after(async () => { await h?.close(); });

const hud = (sel) => page.locator(sel).innerText();
const gun = () => page.evaluate(() => { const w = window.__playtest.world.weapon; return { name: w.def.name, mag: w.mag, reserve: w.reserve, state: w.state, ads: w.ads }; });
const agent = (i = 0) => page.evaluate((i) => { const a = window.__playtest.world.ai.agents[i]; return { alive: a.agent.alive, hp: a.agent.hp, state: a.agent.behavior, active: a.active, name: a.agent.def.name }; }, i);
/** Aim the player at a world point (the camera follows the player, so this is what a mouse look would do). */
const lookAt = (x, y, z) => page.evaluate(([x, y, z]) => { const w = window.__playtest.world, p = w.player, e = w.eye(); const dx = x - e.x, dy = y - e.y, dz = z - e.z; p.yaw = Math.atan2(-dx, -dz) * 180 / Math.PI; p.pitch = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI; }, [x, y, z]);
const click = async (button = 'left') => { const b = await page.locator('.vp-canvas').first().boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down({ button }); await sleep(60); await page.mouse.up({ button }); };

test('a map with a dormant enemy 14 m ahead and a second enemy that spawns on an event', async () => {
  await page.evaluate(async () => {
    const a = window.__studio;
    const { createRoom } = await import('/studio/js/tools/build.js');
    createRoom(a, { cx: 0, cz: 0, y: 0, w: 6, d: 30 }, { height: 2.8, thick: 0.2, wallMaterial: 'mat_plaster', floorMaterial: 'mat_tile', ceilingMaterial: 'mat_plaster', doorSide: 'none' });
    a.select([]);
    a.createNode('playerSpawn', { name: 'Start', p: [0, 0, 12] }, { select: false });
    a.createNode('enemySpawn', { name: 'Target', p: [0, 0, -2], props: { archetype: 'ref_hollow', dormant: true } }, { select: false });
    a.createNode('enemySpawn', { name: 'Ambusher', p: [0, 0, 9.5], r: [0, 180, 0], props: { archetype: 'ref_hollow', spawnOn: 'unleash' } }, { select: false });
    window.__before = JSON.stringify(a.scene.toJSON());
  });
});

test('Ctrl+P: enemies exist (the spawn-on-event one waits), the first gun is drawn, HUD shows health', async () => {
  await page.keyboard.press('Control+p');
  await page.waitForFunction(() => !!window.__playtest && window.__playtest.world.ai, null, { timeout: 10000 });
  const v = await page.evaluate(() => { const s = window.__playtest; return { views: s.enemyViews.size, visible: [...s.enemyViews.values()].map((e) => e.group.visible), loadout: s.world.weapons.map((w) => w.def.id) }; });
  assert.equal(v.views, 2);
  assert.deepEqual(v.visible, [true, false], 'only the first enemy is in the world until its event fires');
  assert.deepEqual(v.loadout, ['ref_crowbar', 'ref_pistol', 'ref_rifle']);
  assert.match(await hud('.pt-hp'), /HP 100/);
  assert.match(await hud('.pt-weapon'), /Service pistol\s+8 \/ 40/);
  assert.equal((await agent(0)).state, 'dormant');
});

test('number keys switch weapons: 1 = crowbar (no ammo shown), 2 = pistol with the magazine and reserve from its definition', async () => {
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => /^Crowbar\s*$/.test(document.querySelector('.pt-weapon').textContent), null, { timeout: 8000 });
  await page.keyboard.press('Digit2');
  await page.waitForFunction(() => /Service pistol/.test(document.querySelector('.pt-weapon').textContent), null, { timeout: 8000 });
  assert.match(await hud('.pt-weapon'), /8 \/ 40/);
});

test('left click fires: the magazine drops, the enemy is hurt; repeated shots kill it (it stays where it was shot)', async () => {
  await lookAt(0, 1.0, -2);
  await sleep(500);                                                   // wait out the draw time
  let hp0 = (await agent(0)).hp;
  for (let i = 0; i < 4 && (await agent(0)).hp === hp0; i++) { await click(); await sleep(400); }     // first click may only capture the mouse
  const g = await gun();
  assert.ok(g.mag <= 7, `a round was used (mag ${g.mag})`);
  const a1 = await agent(0);
  assert.ok(a1.hp < hp0, `the enemy lost health (${hp0} -> ${a1.hp})`);
  assert.match(await hud('.pt-weapon'), new RegExp(`${g.mag} / 40`));
  // keep firing (reloading when empty) until it falls
  for (let i = 0; i < 25 && (await agent(0)).alive; i++) {
    if ((await gun()).mag === 0) { await page.keyboard.press('KeyR'); await page.waitForFunction(() => window.__playtest.world.weapon.mag > 0, null, { timeout: 10000 }); }
    await lookAt(0, 1.0, -2); await click(); await sleep(350);
  }
  const dead = await agent(0);
  assert.equal(dead.alive, false, 'the enemy died');
  assert.equal(await page.evaluate(() => Math.abs(([...window.__playtest.enemyViews.values()][0].group.rotation.x)) > 1.4), true, 'the corpse is shown lying down');
});

test('R reloads from the reserve; the HUD says so while it happens', async () => {
  const before = await gun();
  assert.ok(before.mag < 8, 'the magazine is partly used');
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__playtest.world.weapon.state === 'reloading', null, { timeout: 5000 });
  assert.match(await hud('.pt-weapon'), /reloading/);
  await page.waitForFunction(() => window.__playtest.world.weapon.mag === 8, null, { timeout: 12000 });
  const after = await gun();
  assert.equal(after.mag, 8);
  assert.equal(after.reserve, before.reserve - (8 - before.mag), 'only the missing rounds were taken from the reserve');
});

test('right mouse button aims (ADS) while held and releases afterwards', async () => {
  const b = await page.locator('.vp-canvas').first().boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => window.__playtest.world.weapon.ads === true, null, { timeout: 5000 });
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(() => window.__playtest.world.weapon.ads === false, null, { timeout: 5000 });
});

test('F3 lists the enemies with their state', async () => {
  await page.keyboard.press('F3');
  await page.waitForFunction(() => /enemy/i.test(document.querySelector('.pt-debug').textContent), null, { timeout: 8000 });
  const t = await hud('.pt-debug');
  assert.match(t, /enemy Target\s+\S+ hp/); assert.match(t, /enemy Ambusher.*\(waiting\)/);          // the Ambusher has not spawned
  await page.keyboard.press('F3');
});

test('the second enemy appears when its event fires, attacks the player, and dying shows the restart screen', async () => {
  await page.evaluate(() => { const w = window.__playtest.world; w.player.hp = 12; w.player.x = 0; w.player.z = 12; w.runtime.emit('unleash'); });
  await page.waitForFunction(() => window.__playtest.enemyViews.size && [...window.__playtest.enemyViews.values()][1].group.visible, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__playtest.world.dead === true, null, { timeout: 40000 });
  assert.equal(await page.locator('.pt-dead').isVisible(), true);
  assert.match(await hud('.pt-hp'), /HP 0/);
  assert.match(await page.locator('.pt-dead .btn.primary').innerText(), /beginning/i, 'no checkpoint yet, so the button says it restarts from the beginning');
});

test('Restart brings a fresh run: full health, the dead enemy back, scene untouched', async () => {
  await page.locator('.pt-dead .btn.primary').click();
  await page.waitForFunction(() => window.__playtest && !window.__playtest.world.dead && window.__playtest.world.player.hp === 100 && window.__playtest.world.ai.agents[0].agent.alive, null, { timeout: 10000 });
  assert.equal(await page.locator('.pt-dead').isVisible(), false);
  await page.evaluate(() => window.__playtest.stop());
  await page.waitForFunction(() => !window.__playtest);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__studio.scene.toJSON())), await page.evaluate(() => window.__before), 'the playtest never changes the map');
  assert.deepEqual(h.errors.filter((e) => /pageerror/.test(e)), []);
});

// The game, chapters 2 and 3 (Inside, Below), finished with real key presses, and the bottle throw. See game-helpers.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { useGame, page, errors, G, until, start, face, press, hold, closeNote, teleport, flags } from './game-helpers.mjs';

useGame();

test('chapter 2 — Inside: the security code, the pistol, three fuses, the fuse box, the stairs', async () => {
  await start(2);
  await G(() => { for (const e of window.__game.enemies) if (e.state === 'dormant') e.scriptOnly = true; });
  await press('secDoor');
  await until(() => !document.getElementById('keypad').hidden);
  for (const k of ['1', '9', '9', '4', 'OK']) await page.click(`#keypadKeys button:text-is("${k}")`);
  await until(() => !window.__game.level.entities.get('secDoor').locked);
  await press('pistol');
  await until(() => window.__game.player.owned.pistol === true);
  for (const id of ['fuse1', 'fuse2', 'fuse3']) await press(id);
  await until(() => window.__game.team.fuse >= 3);
  await hold('fusebox', () => window.__game.flags.powered === true);
  await until(() => !window.__game.level.entities.get('stairs').locked);
  const z = await G(() => { const t = window.__game.level.triggers.find((t) => t.id === 'stairsEnd'); return [t.x, t.z]; });
  await teleport(z[0], z[1]);
  await until(() => window.__game.state === 'done', null, 60000);
});

test('chapter 3 — Below: fuel from the morgue, the generator, the lab plan, down the shaft (and the doorways are open)', async () => {
  await start(3);
  // the patrol is tested elsewhere; here it must not interrupt the route
  await G(() => { const w = window.__game.warden; if (w) { w.state = 'absent'; w.root.visible = false; } window.__game.wardenCfg.enabled = false; });
  const bottles = await G(() => [...window.__game.level.entities.keys()].filter((k) => k.startsWith('bottle_')).length);
  assert.ok(bottles >= 5, `bottles placed for distraction (${bottles})`);
  await press('fuel');
  await until(() => window.__game.team.fuel >= 1);
  await hold('generator', () => window.__game.flags.gen === true);
  await until(() => !window.__game.level.entities.get('labDoor').locked);
  // the shaft refuses until you know where it goes
  await press('ladder');
  await page.waitForTimeout(500);
  assert.equal(await G(() => window.__game.state), 'play');
  await press('plan'); await closeNote();
  assert.equal((await flags()).plan, true);
  await press('ladder');
  await until(() => window.__game.state === 'done', null, 60000);
});

test('chapter 3 — a thrown bottle breaks and the patrol goes to look', async () => {
  await start(3);
  const before = await G(() => { const g = window.__game, w = g.warden; g.player.inv.bottle = 2; w.appear(30.5, 14.5); w.patrol = null; w.setState('wander'); return g.player.inv.bottle; });
  // throw toward the far end of the corridor
  await G(() => { const P = window.__game.player; P.pos.set(50, 0, 14.5); P.yaw = Math.PI / 2; P.pitch = 0.15; });
  await page.keyboard.press('KeyX');
  await until(() => window.__game.player.inv.bottle === 1);
  await until(() => !window.__game.projectiles?.length, null, 30000);
  await until(() => ['investigate', 'search', 'chase'].includes(window.__game.warden.state), null, 30000);
  assert.equal(before, 2);
});

test('the playthrough raised no page errors', () => {
  assert.deepEqual(errors, []);
});

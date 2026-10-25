// The game, chapter 6 (Burn the Memory), finished with real key presses up to the epilogue. See game-helpers.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { useGame, page, errors, G, until, start, face, press, hold, closeNote, teleport, flags } from './game-helpers.mjs';

useGame();

test('chapter 6 — Burn the Memory: three stations, the core, the escape, and out into the epilogue', async () => {
  await start(6);
  await G(() => { for (const e of window.__game.enemies) e.scriptOnly = true; });
  // the exit corridor is open before the shutdown: being there early must not use the exit up
  await teleport(2.5, 1.5);
  await until(() => window.__game.level.triggers.find((t) => t.id === 'exit').fired === true);
  await page.waitForTimeout(1000);
  assert.equal(await G(() => window.__game.chapterNo), 6);
  for (const id of ['stationW', 'stationE', 'stationN']) { await face(id); await page.keyboard.press('KeyE'); await until((id) => window.__game.flags[id] === true, id, 240000); }
  await until(() => window.__game.flags.stations === 3);
  await until(() => !window.__game.level.entities.get('chamberS1').locked && !window.__game.level.entities.get('chamberS2').locked);
  await hold('core', () => window.__game.flags.escape === true);
  await until(() => !window.__game.level.entities.get('chamberN1').locked);
  assert.ok((await flags()).left > 100, 'escape timer running');
  await G(() => { for (const e of window.__game.enemies) { e.state = 'absent'; e.root.visible = false; } });
  await teleport(2.5, 1.5);
  await until(() => window.__game.chapterNo === 7 && window.__game.state === 'play', null, 180000);
  assert.doesNotMatch(await G(() => document.querySelector('#chapterCard .n').textContent), /7/, 'the epilogue has no title card of its own');
  assert.equal(await G(() => window.__game.player.owned.pistol), true, 'the loadout carries over into the epilogue');
});

test('the playthrough raised no page errors', () => {
  assert.deepEqual(errors, []);
});

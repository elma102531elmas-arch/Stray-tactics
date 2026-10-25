// The game, the epilogue of chapter 6: out through the burning woods to the trail where it began, the hospital comes
// down behind, the end screen. Software GL draws this view at ~0.3 fps and the finale waits 11 s of game time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { useGame, page, errors, G, until, start, face, press, hold, closeNote, teleport, flags } from './game-helpers.mjs';

useGame();

const awayEnemies = () => G(() => { for (const e of window.__game.enemies) { e.state = 'absent'; e.root.visible = false; } });

test('epilogue — the trailhead starts the finale: the player looks back, the hospital collapses, the game ends', async () => {
  await start(7);
  assert.equal(await G(() => window.__game.chapter.hidden), true);
  await awayEnemies();
  await teleport(35.5, 84.5);
  await until(() => window.__game.flags.done === true, null, 120000);
  assert.equal(await G(() => window.__game.input.enabled), false, 'control is taken for the look back');
  await until(() => window.__game.state === 'end', null, 600000);
});

test('the playthrough raised no page errors', () => {
  assert.deepEqual(errors, []);
});

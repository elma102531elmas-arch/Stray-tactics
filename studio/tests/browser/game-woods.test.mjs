// The game, chapter 1 (The Woods), finished with real key presses. See game-helpers.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { useGame, page, errors, G, until, start, face, press, hold, closeNote, teleport, flags } from './game-helpers.mjs';

useGame();

test('chapter 1 — The Woods: board, camp key, cabin, fuel, generator, gate panel, the gate closes, the doors', async () => {
  await start(1);
  assert.equal(await G(() => window.__game.player.weapon), 'none', 'no weapon in the woods');
  await press('board'); await closeNote();
  await press('cabinKey');
  await until(() => window.__game.team.key >= 1);
  await press('cabinDoor');                                    // unlock with the key
  await until(() => !window.__game.level.entities.get('cabinDoor').locked);
  await press('fuel');
  await until(() => window.__game.team.fuel >= 1);
  await hold('generator', () => window.__game.flags.power === true);
  await hold('gatePanel', () => window.__game.flags.gateOpen === true);
  // the binocular viewer at the lookout
  await press('viewer');
  await until(() => !!window.__game.binoc);
  await until(() => !window.__game.binoc, null, 180000);
  // walk in through the gate: it closes behind and the figure is out on the road
  await teleport(35.5, 17.5);
  await until(() => window.__game.flags.stage === 5);
  await until(() => window.__game.watcher?.visible(), null, 180000);
  await until(() => window.__game.level.gate.col.disabled === false);
  await press('mainL');
  await until(() => window.__game.state === 'done', null, 60000);
});

test('the playthrough raised no page errors', () => {
  assert.deepEqual(errors, []);
});

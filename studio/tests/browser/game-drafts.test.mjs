// The game, the two DRAFT chapters (4 and 5 are placeholders until the story decides them): each can still be finished.
// Enemies are sent away so the route is what is tested, not combat. See game-helpers.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { useGame, page, errors, G, until, start, face, press, hold, closeNote, teleport, flags } from './game-helpers.mjs';

useGame();

const awayEnemies = () => G(() => { const g = window.__game; for (const e of g.enemies) { e.state = 'absent'; e.root.visible = false; e.scriptOnly = true; } if (g.wardenCfg) g.wardenCfg.enabled = false; });
const trigger = (id) => G((id) => { const t = window.__game.level.triggers.find((t) => t.id === id); return t && [t.x, t.z]; }, id);

test('chapter 4 (draft) — keycard, the office, the lift key, the lift', async () => {
  await start(4);
  await awayEnemies();
  await press('keycard');
  await until(() => window.__game.team.keycard >= 1);
  await awayEnemies();
  await press('haleDoor');
  await until(() => !window.__game.level.entities.get('haleDoor').locked);
  await press('elevKey');
  await until(() => window.__game.team.key >= 1);
  await press('elevDoor');
  await until(() => !window.__game.level.entities.get('elevDoor').locked);
  const [x, z] = await trigger('elevator');
  await teleport(x, z);
  await until(() => window.__game.state === 'done', null, 180000);
});

test('chapter 5 (draft) — three monitors switched off, then the stairs', async () => {
  await start(5);
  await awayEnemies();
  await press('stairs');                                    // jammed until the monitors are off
  await page.waitForTimeout(500);
  assert.ok(await G(() => window.__game.level.entities.get('stairs').locked));
  for (const id of ['relay1', 'relay2', 'relay3']) { await face(id); await page.keyboard.press('KeyE'); await until((id) => window.__game.flags[id] === true, id, 120000); }
  await until(() => !window.__game.level.entities.get('stairs').locked);
  const [x, z] = await trigger('stairsEnd');
  await teleport(x, z);
  await until(() => window.__game.state === 'done', null, 120000);
});

test('the playthrough raised no page errors', () => {
  assert.deepEqual(errors, []);
});

// The game's first-person weapons: reloads pressed with the real R key play their sounds in the order the hands do the work
// (magazine out → new magazine in → slide only when it was empty; rifle bolt open → one click per round → bolt closed), the ammo
// adds up, and the magazine is back in the grip when the hands are done. Sounds are observed, not faked: audio.play is wrapped
// to record names. See game-helpers.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { useGame, page, errors, G, until, start } from './game-helpers.mjs';

useGame();

const sounds = () => G(() => window.__snd.splice(0));
const RELOAD_SOUNDS = ['mag_out', 'mag_in', 'slide', 'bolt_open', 'round_in', 'bolt_close'];

test('setup: chapter 6 with the pistol and the rifle, enemies kept asleep', async () => {
  await start(6);
  await G(() => {
    const g = window.__game;
    for (const e of g.enemies) e.scriptOnly = true;
    window.__snd = [];
    const play = g.audio.play.bind(g.audio);
    g.audio.play = (name, o) => { window.__snd.push(name); return play(name, o); };
  });
  assert.deepEqual(await G(() => [window.__game.player.weapon, window.__game.player.owned.rifle]), ['pistol', true]);
});

test('pistol, magazine not empty: out, in, no slide — 3 + 5 rounds, and the magazine is back in the grip', async () => {
  await G(() => { const P = window.__game.player; P.mag.pistol = 3; P.inv.ammo9 = 20; window.__snd.length = 0; });
  await page.keyboard.press('KeyR');
  await until(() => window.__game.player.reloading > 0 && window.__game.vm.clip?.kind === 'reload');
  // while the hands work the magazine leaves the gun (a dropped copy falls, the grip is empty until the new one seats)
  await until(() => { const p = window.__game.vm.weapons.pistol; return !p.mag.visible || p.mag.parent !== p.magParent || p.mag.position.distanceTo(p.mag0) > 0.01; }, null, 120000);
  await until(() => window.__game.player.reloading <= 0 && window.__game.player.mag.pistol === 8, null, 120000);
  assert.deepEqual((await sounds()).filter((s) => RELOAD_SOUNDS.includes(s)), ['mag_out', 'mag_in']);
  assert.equal(await G(() => window.__game.player.inv.ammo9), 15);
  assert.ok(await G(() => { const p = window.__game.vm.weapons.pistol; return p.mag.visible && p.mag.parent === p.magParent && p.mag.position.distanceTo(p.mag0) < 1e-6; }), 'magazine seated');
});

test('pistol, empty: out, in, then the slide is released', async () => {
  await G(() => { window.__game.player.mag.pistol = 0; window.__snd.length = 0; });
  await page.keyboard.press('KeyR');
  await until(() => window.__game.player.reloading <= 0 && window.__game.player.mag.pistol === 8, null, 120000);
  assert.deepEqual((await sounds()).filter((s) => RELOAD_SOUNDS.includes(s)), ['mag_out', 'mag_in', 'slide']);
});

test('rifle: bolt open, one round at a time, bolt closed', async () => {
  await page.keyboard.press('Digit3');
  await until(() => window.__game.player.weapon === 'rifle' && !window.__game.vm.clip);
  await G(() => { const P = window.__game.player; P.mag.rifle = 3; P.inv.ammo762 = 10; window.__snd.length = 0; });
  await page.keyboard.press('KeyR');
  await until(() => window.__game.player.reloading <= 0 && window.__game.player.mag.rifle === 5, null, 120000);
  assert.deepEqual((await sounds()).filter((s) => RELOAD_SOUNDS.includes(s)), ['bolt_open', 'round_in', 'round_in', 'bolt_close']);
  assert.equal(await G(() => window.__game.player.inv.ammo762), 8);
});

test('the weapon tests raised no page errors', () => {
  assert.deepEqual(errors, []);
});

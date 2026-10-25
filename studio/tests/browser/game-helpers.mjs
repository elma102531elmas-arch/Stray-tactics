// Shared driver for the game playthrough tests (game-*.test.mjs): the game itself, not the Studio, played with real keys.
// For each step the player is stood where the game's own targeting (level.findInteractable) picks the object, looks at
// it, and E is pressed through the browser's keyboard. Walking between places is a teleport; whether the places are
// reachable on foot is a separate question (the Studio validator's reachability check).
// Software GL draws the woods at ~1 fps and the game clamps a frame to 0.1 s of game time, so waits are generous.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from '../../serve.mjs';

const require = createRequire(import.meta.url);
let srv, browser;
export let page;
export const errors = [];

/** Registers before/after hooks: a server, Chromium on software GL, the game loaded at low quality, waiting at its title. */
export function useGame() {
  test.before(async () => {
    const { chromium } = require('playwright');
    srv = await startServer(0);
    browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    page = await browser.newPage({ viewport: { width: 800, height: 450 } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    await page.addInitScript(() => { try { localStorage.setItem('saintMarrowCfg_v1', JSON.stringify({ quality: 'low', lang: 'en', difficulty: 'easy' })); localStorage.removeItem('saintMarrowSave_v1'); } catch { /* storage blocked */ } });
    await page.goto(new URL('/saint-marrow/index.html', srv.url).href);
    await page.waitForFunction(() => window.__game?.player && /Tap to start/i.test(document.body.innerText), null, { timeout: 180000 });
  });
  test.after(async () => { await browser?.close(); srv?.server.close(); });
}

export const G = (fn, arg) => page.evaluate(fn, arg);
export const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

export async function start(ch) {
  await G((c) => window.__game.startSolo(c), ch);
  await until(() => window.__game.state === 'play' && window.__game.input.enabled, null, 180000);
  // the chapter card and opening subtitles do not block input; give the first frames a moment
  await page.waitForTimeout(300);
}

/** Stand where the game targets interactable `id`, looking at it (fails the test if no spot does). */
export async function face(id) {
  const ok = await G((id) => {
    const g = window.__game, L = g.level, P = g.player, grid = L.grid;
    const o = L.interactables.find((x) => x.id === id && x.enabled !== false);
    if (!o) return 'no interactable ' + id;
    const p = o.pos();
    for (const r of [1.0, 1.3, 0.75, 1.6]) for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (grid.blocked(x, z, 0.3)) continue;
      const eye = 1.62, dx = p.x - x, dy = p.y - eye, dz = p.z - z;
      P.pos.set(x, 0, z); P.vel?.set?.(0, 0, 0);
      P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      P.applyCamera(g.camera, 0, 0); g.camera.updateMatrixWorld(true);
      const c = new g.camera.position.constructor(), f = new g.camera.position.constructor();
      g.camera.getWorldPosition(c); g.camera.getWorldDirection(f);
      if (L.findInteractable(c, f, 2.4) === o) return true;
    }
    return 'no spot targets ' + id;
  }, id);
  assert.equal(ok, true, String(ok));
  await until((id) => window.__game.lookAt?.id === id, id, 20000);
}

export async function press(id) { await face(id); await page.keyboard.press('KeyE'); }
// hold time counts in frames of at most 0.1 s, and software GL draws the woods at ~1 fps: allow for it
export async function hold(id, done, timeout = 240000) {
  await face(id);
  await page.keyboard.down('KeyE');
  try { await until(done, null, timeout); } finally { await page.keyboard.up('KeyE'); }
}
export async function closeNote() { await until(() => !document.getElementById('note').hidden); await page.click('#btnNoteClose'); await until(() => window.__game.input.enabled); }
export async function teleport(x, z) { await G(([x, z]) => { window.__game.player.pos.set(x, 0, z); }, [x, z]); }
export const flags = () => G(() => ({ ...window.__game.flags }));


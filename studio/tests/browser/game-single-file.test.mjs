// The single-file build (saint-marrow.html, made by tools/build-game-single.mjs) opens straight from disk: no server, every texture and
// model embedded, and it plays — chapter 1 starts and the torch and the use prompt work with real keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const FILE = process.env.SM_SINGLE_FILE || new URL('../../../saint-marrow.html', import.meta.url).pathname;
let browser, page;
const errors = [], assetRequests = [];

test.before(async () => {
  const { chromium } = require('playwright');
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (/\/assets\/|\.glb|\.webp/.test(r.url()) && !r.url().startsWith('data:')) assetRequests.push(r.url()); });
  await page.addInitScript(() => { try { localStorage.setItem('saintMarrowCfg_v1', JSON.stringify({ quality: 'low', lang: 'en' })); } catch { /* file:// storage */ } });
});
test.after(async () => { await browser?.close(); });

test('saint-marrow.html is one self-contained file and boots from disk', async () => {
  const html = fs.readFileSync(FILE, 'utf8');
  assert.ok(!/src="js\/main\.js"|href="css\/style\.css"/.test(html), 'no links to the source files');
  assert.ok(html.includes('window.__ASSETS__='), 'assets embedded');
  await page.goto(pathToFileURL(FILE).href);
  await page.waitForFunction(() => window.__game?.player && /Tap to start/i.test(document.body.innerText), null, { timeout: 240000 });
});

test('chapter 1 starts from the single file and answers real keys', async () => {
  await page.evaluate(() => window.__game.startSolo(1));
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.input.enabled, null, { timeout: 240000 });
  assert.equal(await page.evaluate(() => window.__game.level.def.key), 'ch1');
  const lit = await page.evaluate(() => window.__game.player.flashOn);
  await page.keyboard.press('KeyF');
  await page.waitForFunction((was) => window.__game.player.flashOn !== was, lit, { timeout: 60000 });
});

test('no asset was fetched from disk and no page error was raised', () => {
  assert.deepEqual(assetRequests, []);
  assert.deepEqual(errors, []);
});

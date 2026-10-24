// Shared helpers for the Playwright browser tests: static server + headless Chromium with software WebGL.
import { createRequire } from 'node:module';
import { startServer } from '../../serve.mjs';

const require = createRequire(import.meta.url);

export async function launch({ width = 1500, height = 900 } = {}) {
  const { chromium } = require('playwright');
  const srv = await startServer(0);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [], logs = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 5).join('\n')));
  page.on('console', (m) => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); if (m.type() === 'error') errors.push('console.error: ' + t); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  return { srv, browser, context, page, errors, logs, url: srv.url, async close() { await browser.close(); srv.server.close(); } };
}

export async function openStudio(h, { fresh = true } = {}) {
  await h.page.goto(h.url, { waitUntil: 'load' });
  if (fresh) await h.page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await h.page.waitForFunction(() => window.__studioReady === true, null, { timeout: 60000 });
  return h.page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Click a menu path like ['Create', 'Architecture', 'Wall'] using real mouse events. */
export async function menu(page, ...path) {
  const [top, ...rest] = path;
  await page.click(`.menu-top[data-menu="${top}"]`);
  for (let i = 0; i < rest.length; i++) {
    const last = i === rest.length - 1;
    const item = page.locator(`.menu-pop:not(.ctx) .menu-item[data-label="${rest[i]}"]`).first();
    if (last) await item.click(); else await item.hover();
  }
}

/** World point -> page coordinates using the live camera. */
export const toScreen = (page, x, y, z) => page.evaluate(([x, y, z]) => { const vp = window.__vp; return vp.toClient(new vp.camera.position.constructor(x, y, z)); }, [x, y, z]);
export const state = (page) => page.evaluate(() => { const a = window.__studio; return { count: a.scene.size, selection: [...a.selection], dirty: a.dirty, undo: a.history.undoStack.length, tool: window.__vp.tool.id }; });
export const nodes = (page, type) => page.evaluate((type) => window.__studio.scene.all().filter((n) => !type || n.type === type).map((n) => ({ id: n.id, name: n.name, type: n.type, p: n.t.p, r: n.t.r, s: n.t.s, parent: n.parent, props: n.props })), type);
export const dialog = (page) => page.locator('.modal');
export async function clickDialog(page, label) { await page.locator('.modal .modal-f .btn', { hasText: label }).first().click(); }
export const framed = async (page) => { await page.evaluate(() => { window.__vp.frameAll(); }); await page.waitForTimeout(250); };

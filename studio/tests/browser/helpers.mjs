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
  const errors = [], logs = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
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

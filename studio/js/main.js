// Bootstrap: create the App, build the shell, register actions, show the window.
import { App } from './app.js';
import { Shell } from './ui/shell.js';
import { MenuBar } from './ui/menubar.js';
import { Toolbar } from './ui/toolbar.js';
import { installShortcuts } from './ui/shortcuts.js';
import { registerActions } from './actions/index.js';
import { ProjectIO } from './store/projectio.js';
import { toast } from './ui/dialogs.js';

const bootMsg = (m) => { const e = document.getElementById('boot-msg'); if (e) e.textContent = m; };

async function boot() {
  const app = new App();
  window.__studio = app;           // exposed for the automated browser tests and for debugging
  window.addEventListener('error', (e) => app.log('error', `Uncaught: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => app.log('error', `Unhandled: ${e.reason?.message || e.reason}`));
  bootMsg('Loading asset library…');
  await app.init();
  if (new URLSearchParams(location.search).has('lowfx')) { app.prefs.renderScale = 0.5; app.prefs.antialias = false; }   // for automated tests and slow machines; not saved
  app.projectIO = new ProjectIO(app);
  app.on('toast', (m, k) => toast(m, k));
  bootMsg('Starting editor…');
  document.getElementById('app').hidden = false;
  const shell = new Shell(app);
  shell.build();
  registerActions(app);
  new MenuBar(app, document.getElementById('menubar'));
  new Toolbar(app, document.getElementById('toolbar'));
  installShortcuts(app, { isBlocked: (e) => app.viewport?.flying || (app.playtest && !(e.ctrlKey && e.code === 'KeyP')) });
  // restore persisted panel visibility
  for (const w of ['left', 'right']) if (app.pref('panel.' + w, true) === false) shell.togglePanel(w);
  document.getElementById('boot').remove();
  app.log('info', `Saint Marrow Studio ready (storage: ${app.storage.kind}). The playable game is never modified by the Studio.`);
  if (app.storage.kind === 'memory') app.log('warn', 'IndexedDB is unavailable — projects can only be saved as downloaded files this session.');
  app.projectIO.startAutosave();
  await app.projectIO.recoverIfAny();
  app.emit('booted');
  window.__studioReady = true;
}

boot().catch((e) => {
  console.error(e);
  const m = document.getElementById('boot-msg');
  if (m) { m.textContent = 'Failed to start: ' + e.message; m.style.color = '#ff6a6a'; }
});

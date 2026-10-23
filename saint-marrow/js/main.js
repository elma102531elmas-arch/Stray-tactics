// Entry point.
import { loadCfg, loadSave } from './settings.js';
import { Game } from './game.js';

loadCfg();
loadSave();
const game = new Game();
window.__game = game;
game.boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loadLabel');
  if (l) l.textContent = 'Something went wrong while loading: ' + (e && e.message ? e.message : e);
});

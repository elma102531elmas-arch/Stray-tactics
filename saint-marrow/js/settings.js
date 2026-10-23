import { isMobile } from './util.js';

const KEY = 'saintMarrowCfg_v1';
const SAVE_KEY = 'saintMarrowSave_v1';

export const QUALITY = {
  low:    { pr: 0.8,  maxPr: 1.0,  post: false, bloom: false, msaa: 0, shadow: 512,  lights: 2, dust: false, normal: true,  aniso: 2 },
  medium: { pr: 1.0,  maxPr: 1.35, post: true,  bloom: false, msaa: 0, shadow: 1024, lights: 3, dust: true,  normal: true,  aniso: 4 },
  high:   { pr: 1.0,  maxPr: 1.75, post: true,  bloom: true,  msaa: 4, shadow: 1024, lights: 4, dust: true,  normal: true,  aniso: 8 },
  ultra:  { pr: 1.0,  maxPr: 2.0,  post: true,  bloom: true,  msaa: 4, shadow: 2048, lights: 6, dust: true,  normal: true,  aniso: 16 },
};

export const CFG = {
  name: '',
  sens: 1.0,
  aimSens: 0.65,
  quality: isMobile() ? 'medium' : 'high',
  fov: 78,
  invertY: false,
  volume: 0.9,
  music: 0.75,
  blood: 'high',
  lang: (navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en',
  hudScale: 1,
  btnOpacity: 0.8,
  autoRes: true,
  showFps: false,
  difficulty: 'normal',
  brightness: 1.1,
};

export function loadCfg() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k in CFG) if (k in s) CFG[k] = s[k];
  } catch (e) { /* storage blocked: keep defaults */ }
  if (!CFG.name) CFG.name = 'Survivor' + Math.floor(100 + Math.random() * 900);
  if (!QUALITY[CFG.quality]) CFG.quality = 'medium';
}
export function saveCfg() {
  try { localStorage.setItem(KEY, JSON.stringify(CFG)); } catch (e) { /* ignore */ }
}

export const SAVE = { unlocked: 1, checkpoint: null, best: {} };
export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    Object.assign(SAVE, s);
  } catch (e) { /* ignore */ }
}
export function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) { /* ignore */ }
}

export const DIFF = {
  easy:   { dmgTaken: 0.6, enemyHp: 0.8, loot: 1.4, wardenSpeed: 0.9 },
  normal: { dmgTaken: 1.0, enemyHp: 1.0, loot: 1.0, wardenSpeed: 1.0 },
  hard:   { dmgTaken: 1.45, enemyHp: 1.25, loot: 0.7, wardenSpeed: 1.08 },
};

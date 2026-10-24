// Decal textures. The ORIGINAL game paints its blood decals procedurally (saint-marrow/js/engine/textures.js);
// the Studio loads that module read-only and reuses the real atlas so decals look like they do in the game.
// If the module cannot be loaded, a plain red-brown placeholder is used and the console says so.

import * as THREE from '../../lib/three.module.js';

let atlasPromise = null;
const cache = new Map();
const KINDS = { splat: [0, 1, 2, 3], drip: [4, 5], pool: [6, 7], smear: [8, 9], hand: [10, 11], spray: [12, 13], bullet: [14], scorch: [15] };

function loadAtlas(baseUrl, log) {
  if (!atlasPromise) {
    atlasPromise = (async () => {
      const mod = await import(new URL('../saint-marrow/js/engine/textures.js', baseUrl).href);
      const tex = mod.makeBloodAtlas();
      const canvas = tex.image;
      tex.dispose();
      return { canvas, mod };
    })().catch((e) => { log?.('warn', 'Decal atlas of the original game could not be loaded (' + e.message + '). Using a flat placeholder.'); return null; });
  }
  return atlasPromise;
}

/** Returns a Texture (possibly filled in asynchronously) for ids like "builtin:decal/splat". */
export function decalTexture(id, { baseUrl, log, onReady, text } = {}) {
  const key = id + (text || '');
  if (cache.has(key)) return cache.get(key);
  const kind = id.replace('builtin:decal/', '');
  // The final bitmap is drawn INTO this canvas later; its size never changes so the GPU texture storage stays valid.
  const W = kind === 'writing' ? 1024 : 256, H = kind === 'writing' ? 256 : 256;
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const cx = canvas.getContext('2d');
  cx.fillStyle = 'rgba(90,10,8,0.55)'; cx.beginPath(); cx.ellipse(W / 2, H / 2, W * 0.3, H * 0.3, 0, 0, Math.PI * 2); cx.fill();
  const placeholder = new THREE.CanvasTexture(canvas);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, placeholder);
  loadAtlas(baseUrl, log).then((atlas) => {
    if (!atlas) return;
    cx.clearRect(0, 0, W, H);
    if (kind === 'writing') {
      const src = atlas.mod.makeBloodWriting(text || 'WRITING', W, H, 1);
      cx.drawImage(src.image, 0, 0, W, H); src.dispose();
    } else {
      const idx = (KINDS[kind] || KINDS.splat)[0];
      cx.drawImage(atlas.canvas, (idx % 4) * 256, Math.floor(idx / 4) * 256, 256, 256, 0, 0, 256, 256);
    }
    placeholder.needsUpdate = true;
    onReady?.();
  });
  return placeholder;
}
export const DECAL_KINDS = Object.keys(KINDS).concat(['writing']);

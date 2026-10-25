// Dev tool: builds saint-marrow.html, the whole game in one file (opens from disk, no server): index.html with the stylesheet
// inlined, every texture and model embedded in window.__ASSETS__ (engine/assets.js reads it before fetching), and js/main.js
// bundled into one module script. Same layout as the single file shipped before the rework.
// Requires esbuild (dev only, not part of the game or the Studio): `npm i esbuild`, or NODE_PATH pointing at a global install.
// Usage (from the repository root): node studio/tools/build-game-single.mjs [out.html]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GAME = path.join(ROOT, 'saint-marrow');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'saint-marrow.html'));

let esbuild;
try { esbuild = await import('esbuild'); } catch {
  try { esbuild = createRequire(import.meta.url)('esbuild'); } catch {
    console.error('esbuild not found: run `npm i esbuild` (dev only) or set NODE_PATH to a folder that has it.');
    process.exit(1);
  }
}

const bundle = await esbuild.build({
  entryPoints: [path.join(GAME, 'js/main.js')], bundle: true, minify: true, format: 'esm', target: 'es2020', write: false, legalComments: 'eof', logLevel: 'warning',
});
// a literal "</script" inside the code would end the inline script early
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// keys are the same relative URLs the game asks for: textures as data URLs, models as bare base64 (engine/assets.js loadTex / loadModel)
const assets = {};
for (const f of fs.readdirSync(path.join(GAME, 'assets/tex')).sort()) {
  const mime = f.endsWith('.webp') ? 'image/webp' : f.endsWith('.png') ? 'image/png' : f.endsWith('.jpg') ? 'image/jpeg' : null;
  if (mime) assets['assets/tex/' + f] = `data:${mime};base64,` + fs.readFileSync(path.join(GAME, 'assets/tex', f)).toString('base64');
}
for (const f of fs.readdirSync(path.join(GAME, 'assets/models')).sort()) {
  if (f.endsWith('.glb')) assets['assets/models/' + f] = fs.readFileSync(path.join(GAME, 'assets/models', f)).toString('base64');
}

let html = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(GAME, 'css/style.css'), 'utf8');
const swap = (from, to) => {
  if (html.split(from).length !== 2) throw new Error(`index.html: expected exactly one ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}</style>`);
swap('<script type="module" src="js/main.js"></script>', `<script>window.__ASSETS__=${JSON.stringify(assets)}</script>\n<script type="module">\n${js}</script>`);
fs.writeFileSync(OUT, html);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${(html.length / 1048576).toFixed(1)} MB (${Object.keys(assets).length} embedded assets, ${(js.length / 1024).toFixed(0)} KB of code)`);

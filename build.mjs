// Bundles src/ into ONE self-contained index.html (three.js included), so the
// game runs offline, from file://, from GitHub Pages and on phones.
import * as esbuild from 'esbuild';
import fs from 'fs';

const watch = process.argv.includes('--watch');

function inline(js) {
  const css = fs.readFileSync('src/style.css', 'utf8');
  const tpl = fs.readFileSync('src/index.html', 'utf8');
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  return tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => safeJs);
}

const plugin = {
  name: 'inline-html',
  setup(build) {
    build.onEnd((res) => {
      if (res.errors.length) return;
      const js = res.outputFiles.find((f) => f.path.endsWith('.js')).text;
      fs.writeFileSync('index.html', inline(js));
      const kb = (fs.statSync('index.html').size / 1024).toFixed(0);
      console.log(`[build] index.html written (${kb} KB)`);
    });
  },
};

const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: !watch,
  sourcemap: false,
  format: 'iife',
  target: 'es2020',
  write: false,
  outfile: 'out.js',
  legalComments: 'none',
  plugins: [plugin],
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('[build] watching src/ ...');
} else {
  await esbuild.build(opts);
}

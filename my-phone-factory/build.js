#!/usr/bin/env node
// Bundles index.html + src/*.css/js into one self-contained HTML file: ../my-phone-factory.html
const fs = require('fs');
const path = require('path');
const dir = __dirname;
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="(.+?)">/g, (_, href) => '<style>\n' + fs.readFileSync(path.join(dir, href), 'utf8') + '\n</style>');
html = html.replace(/<!-- BUILD:SCRIPTS -->[\s\S]*?<!-- \/BUILD:SCRIPTS -->/, (block) => {
  const files = [...block.matchAll(/<script src="(.+?)"><\/script>/g)].map((m) => m[1]);
  const inline = [...block.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const js = files.map((f) => '/* ---- ' + f + ' ---- */\n' + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  return '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n' + inline + '\n</script>';
});
const out = path.join(dir, '..', 'my-phone-factory.html');
fs.writeFileSync(out, html);
console.log('Built ' + out + ' (' + (html.length / 1024).toFixed(0) + ' KB)');

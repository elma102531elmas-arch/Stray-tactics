// RULE 1 of the project: the playable game must never change. This test hashes every file of the original game and compares it with
// the manifest recorded before the Studio was started (backups/saint-marrow-original.sha256). Any edit, addition or deletion fails the build.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = fs.readFileSync(path.join(ROOT, 'backups/saint-marrow-original.sha256'), 'utf8').trim().split('\n').map((l) => { const [hash, ...rest] = l.split('  '); return { hash, file: rest.join('  ') }; });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('manifest covers the game (sanity)', () => { assert.ok(manifest.length > 100); assert.ok(manifest.some((m) => m.file === 'saint-marrow.html')); });

test('every original file is byte-identical to the backup manifest', () => {
  const bad = manifest.filter((m) => !fs.existsSync(path.join(ROOT, m.file)) || sha(m.file) !== m.hash).map((m) => m.file);
  assert.deepEqual(bad, [], `Original game files changed or went missing: ${bad.join(', ')}`);
});

test('no files were added to the original game folder', () => {
  const known = new Set(manifest.map((m) => m.file));
  const extra = walk('saint-marrow').filter((f) => !known.has(f.split(path.sep).join('/')));
  assert.deepEqual(extra, [], `Unexpected new files inside saint-marrow/: ${extra.join(', ')}`);
});

test('backup archive of the original project exists and is not empty', () => {
  const tar = path.join(ROOT, 'backups/saint-marrow-original-2026-10-24.tar.gz');
  assert.ok(fs.existsSync(tar));
  assert.ok(fs.statSync(tar).size > 1_000_000);
});

test('the Studio never writes into the game folder (static scan of Studio sources)', () => {
  const offenders = [];
  for (const f of walk('studio/js').filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/writeFile[^;]*saint-marrow\//.test(src) || /fs\.(rm|unlink|rename)[^;]*saint-marrow/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
});

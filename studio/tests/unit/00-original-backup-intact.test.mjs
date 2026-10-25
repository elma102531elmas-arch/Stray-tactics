// The original game (as it was before the Studio and before the 2026-10-25 rework the user asked for) must stay recoverable.
// The game itself may now change; the backup may not. This test reads the backup archive and checks every file in it against
// the SHA-256 manifest recorded at the time (backups/saint-marrow-original.sha256). The single-file build saint-marrow.html is
// too large for the archive; it is listed in the manifest and preserved on the git branch saint-marrow-original-backup.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TAR = path.join(ROOT, 'backups/saint-marrow-original-2026-10-24.tar.gz');
const manifest = new Map(fs.readFileSync(path.join(ROOT, 'backups/saint-marrow-original.sha256'), 'utf8').trim().split('\n').map((l) => { const [hash, ...rest] = l.split('  '); return [rest.join('  '), hash]; }));
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** Minimal ustar reader: [{ name, data }] for regular files. */
function untar(buf) {
  const out = [];
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const name = (str(345, 500) ? str(345, 500) + '/' : '') + str(0, 100);
    if (type === '0' || type === '\0') out.push({ name, data: buf.subarray(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

test('backup manifest covers the original game', () => {
  assert.ok(manifest.size > 100);
  assert.ok(manifest.has('saint-marrow.html'));
  assert.ok(manifest.has('saint-marrow/js/game.js'));
});

test('every file in the backup archive matches the manifest byte for byte', () => {
  const files = untar(zlib.gunzipSync(fs.readFileSync(TAR)));
  assert.ok(files.length > 100, 'archive is not empty');
  const bad = files.filter((f) => manifest.get(f.name) !== crypto.createHash('sha256').update(f.data).digest('hex')).map((f) => f.name);
  assert.deepEqual(bad, [], `backup files differ from the manifest: ${bad.join(', ')}`);
  const missing = [...manifest.keys()].filter((k) => k.startsWith('saint-marrow/') && !files.some((f) => f.name === k));
  assert.deepEqual(missing, [], 'every original game file is in the archive');
});

test('the Studio never writes into the game folder (static scan of Studio sources)', () => {
  const offenders = [];
  for (const f of walk('studio/js').filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/writeFile[^;]*saint-marrow\//.test(src) || /fs\.(rm|unlink|rename)[^;]*saint-marrow/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
});

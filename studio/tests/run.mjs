// Test runner: node studio/tests/run.mjs [unit|browser|all] [name-filter]
//   unit     fast DOM-free tests (node:test)           studio/tests/unit/*.test.mjs
//   browser  real Chromium tests (Playwright)          studio/tests/browser/*.test.mjs   (needs `playwright` + Chromium)
// Exits non-zero if anything fails. Prints one summary line per suite so a failure is easy to find.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const which = process.argv[2] || 'all';
const filter = process.argv[3] || '';
const suites = [];
if (which === 'unit' || which === 'all') suites.push(['unit', path.join(here, 'unit')]);
if (which === 'browser' || which === 'all') suites.push(['browser', path.join(here, 'browser')]);

let failed = 0, total = 0;
const rows = [];
for (const [kind, dir] of suites) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.test.mjs') && x.includes(filter)).sort()) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['--test', '--test-timeout=900000', path.join(dir, f)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    const num = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
    const tests = num('tests'), pass = num('pass'), fail = num('fail');
    total += tests; failed += fail + (r.status && !fail ? 1 : 0);
    rows.push({ kind, file: f, tests, pass, fail, ms: Date.now() - t0 });
    console.log(`${fail || r.status ? 'FAIL' : ' ok '}  ${kind.padEnd(7)} ${f.padEnd(34)} ${String(pass).padStart(3)}/${String(tests).padEnd(3)} ${(rows.at(-1).ms / 1000).toFixed(1)}s`);
    if (fail || r.status) console.log(out.split('\n').filter((l) => /^not ok|error:|^\s+(\+|-) /.test(l)).slice(0, 25).join('\n'));
  }
}
console.log(`\n${total - failed}/${total} tests passed in ${rows.length} suites${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);

// The generated docs must match what the code produces today. If this fails: node studio/tools/gen-docs.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadAll, compatibilityMd, diagnosticsMd, docPath } from '../../tools/docs-lib.mjs';

test('docs/COMPATIBILITY.md and docs/DIAGNOSTICS.md are up to date with the importer and validator', async () => {
  const all = await loadAll();
  for (const [name, text] of [['COMPATIBILITY.md', compatibilityMd(all)], ['DIAGNOSTICS.md', diagnosticsMd(all)]]) {
    assert.ok(fs.existsSync(docPath(name)), `${name} is missing: run node studio/tools/gen-docs.mjs`);
    assert.equal(fs.readFileSync(docPath(name), 'utf8'), text, `${name} is stale: run node studio/tools/gen-docs.mjs`);
  }
});

test('every document the Help menu opens exists and is not a stub', () => {
  for (const name of ['KNOWN_LIMITATIONS.md', 'COMPATIBILITY.md', 'ARCHITECTURE.md', 'PLUGINS.md', 'DIAGNOSTICS.md', 'PROGRESS.md', 'TESTING.md']) {
    const f = docPath(name); assert.ok(fs.existsSync(f), `${name} missing`); assert.ok(fs.statSync(f).size > 1500, `${name} looks like a stub`);
  }
});

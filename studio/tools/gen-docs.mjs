// node studio/tools/gen-docs.mjs  — rewrites docs/COMPATIBILITY.md and docs/DIAGNOSTICS.md from real importer runs.
import fs from 'node:fs';
import { loadAll, compatibilityMd, diagnosticsMd, docPath } from './docs-lib.mjs';
const all = await loadAll();
fs.writeFileSync(docPath('COMPATIBILITY.md'), compatibilityMd(all));
fs.writeFileSync(docPath('DIAGNOSTICS.md'), diagnosticsMd(all));
console.log('wrote docs/COMPATIBILITY.md and docs/DIAGNOSTICS.md');

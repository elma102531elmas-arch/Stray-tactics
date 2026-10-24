// The review dialog: everything a person needs to decide whether to let a plugin/script run. Approving is recorded in THIS browser only.
import { h } from './dom.js';
import { modal, KEEP_OPEN } from './dialogs.js';
import { CodeEditor } from './codeeditor.js';
import { PERMISSIONS, analyzeCode, sha256Hex } from '../core/plugins.js';

const SEV_TEXT = { danger: 'Careful', error: 'Error', warn: 'Blocked', info: 'Note' };

/** Resolves true when the user approved (and the approval was stored), false otherwise. */
export async function reviewAndApprove(app, rec) {
  const findings = analyzeCode(rec.code), hash = await sha256Hex(rec.code);
  const hasDanger = findings.some((f) => f.severity === 'danger'), hasError = findings.some((f) => f.severity === 'error');
  const perms = rec.permissions || [];
  const holder = h('div', { style: { height: '230px', marginTop: '6px' } });
  const err = h('div', { class: 'err', style: { minHeight: '16px' } });
  const read = h('input', { type: 'checkbox', 'aria-label': 'I have read this code' });
  const understand = h('input', { type: 'checkbox', 'aria-label': 'I understand the dynamic-code warnings' });
  const body = h('div', {},
    h('div', { class: 'note err', style: { margin: '0 0 10px' } }, h('b', {}, 'This is a program. '), `Approving lets “${rec.name}” run on your computer inside a browser sandbox. The sandbox has no network access, no access to your files or to the rest of the Studio, and can only use the permissions listed below — but no sandbox is perfect. Only approve code you have read or that comes from someone you trust. Nothing has been run so far.`),
    h('div', { class: 'kv', style: { fontSize: '12px', marginBottom: '8px' } },
      h('span', {}, 'Name'), h('b', {}, `${rec.name} ${rec.version || ''}`), h('span', {}, 'Kind'), h('b', {}, rec.kind), h('span', {}, 'Author'), h('b', {}, rec.author || '(not stated)'), h('span', {}, 'Licence'), h('b', {}, rec.license || '(not stated)'),
      h('span', {}, 'Source'), h('b', {}, rec.source?.type === 'imported' ? `imported from ${rec.source.file || 'a file'}` : 'written in this project'),
      h('span', {}, 'Code'), h('b', {}, `${new TextEncoder().encode(rec.code).length} bytes · sha256 ${hash.slice(0, 16)}…`)),
    h('div', { style: { fontWeight: 600, margin: '6px 0 3px' } }, perms.length ? 'It asks for these permissions:' : 'It asks for no permissions (it can only log messages).'),
    ...perms.map((p) => h('div', { 'data-perm': p, style: { padding: '2px 0 2px 10px', fontSize: '12px' } }, h('b', {}, p), ' — ', PERMISSIONS[p] || 'unknown')),
    findings.length ? h('div', { style: { fontWeight: 600, margin: '10px 0 3px' } }, `What the code analyser noticed (${findings.length}):`) : h('div', { style: { margin: '10px 0 3px', color: 'var(--dim)' } }, 'The code analyser found nothing unusual. (It is advisory: read the code too.)'),
    ...findings.slice(0, 12).map((f) => h('div', { class: 'pl-finding', 'data-sev': f.severity, onclick: () => ed.goto(f.line) }, h('span', { class: 'sev ' + f.severity }, SEV_TEXT[f.severity]), h('span', {}, `line ${f.line}: ${f.message}`))),
    findings.length > 12 ? h('div', { style: { color: 'var(--faint)', fontSize: '11px', paddingLeft: '10px' } }, `…and ${findings.length - 12} more`) : null,
    h('div', { style: { fontWeight: 600, margin: '10px 0 0' } }, 'The full code:'), holder,
    h('label', { style: { display: 'flex', gap: '8px', margin: '10px 0 2px', alignItems: 'flex-start' } }, read, 'I have read this code, or I trust where it came from.'),
    hasDanger ? h('label', { style: { display: 'flex', gap: '8px', margin: '2px 0', alignItems: 'flex-start', color: '#ffb0b0' } }, understand, 'It uses features that can build or run code at run time or reach the global object (listed above as “Careful”). I understand the risk.') : null, err);
  const ed = new CodeEditor(holder, { value: rec.code, readOnly: true });
  ed.setFindings(findings);
  const ok = await modal({ title: `Review ${rec.kind}: ${rec.name}`, width: 780, body, buttons: [
    { label: 'Cancel', value: false },
    { label: 'Approve and allow', primary: !hasDanger, danger: hasDanger, value: () => {
      if (hasError) { err.textContent = 'The code has a syntax error, so it cannot run. Fix it first.'; return KEEP_OPEN; }
      if (!read.checked) { err.textContent = 'Tick “I have read this code” to continue.'; return KEEP_OPEN; }
      if (hasDanger && !understand.checked) { err.textContent = 'Tick the second box to confirm you understand the warnings.'; return KEEP_OPEN; }
      return true;
    } }] });
  if (!ok) return false;
  await app.plugins.approvals.approve(app.project.meta.id, rec);
  app.log('ok', `Approved ${rec.kind} “${rec.name}” (sha256 ${hash.slice(0, 12)}…) on this browser. It runs only when you start it.`);
  return true;
}

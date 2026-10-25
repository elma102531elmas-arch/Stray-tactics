// Issue triage: WHY did the validator report this? Each issue is classified as a bug in the user's own map, a verified quirk of the original game
// (the Studio imports the original coordinates as-is, so the same quirks appear), something that depends on the original game's JavaScript, or a
// limitation of the Studio. Every "verified" claim cites its evidence, and the claims about the original game are re-checked against the RUNNING game by
// tests/browser/original-oracle.test.mjs and tests/unit/diagnostics.test.mjs — nothing here is a guess dressed up as a fact. DOM-free.

import { uid } from './util.js';

export const CLASSES = {
  bug: { label: 'Bug in this map', color: '#ff6a6a', blurb: 'A problem in objects you made or changed. Fix it, or mark it accepted if it is intended.' },
  quirk: { label: 'Original-game quirk', color: '#ffb347', blurb: 'The original game has the same oddity. The Studio keeps the original coordinates, so it appears here too. Not a Studio bug.' },
  script: { label: 'Original script logic', color: '#c792ea', blurb: 'Depends on the original game’s JavaScript (handlers, scripted movement) which cannot be imported. Expected after an import.' },
  limit: { label: 'Studio limitation', color: '#6cb6ff', blurb: 'The Studio approximates something here (see docs/KNOWN_LIMITATIONS.md). It may be a false alarm.' },
  unverified: { label: 'Imported — not verified', color: '#9aa5b5', blurb: 'On an imported object, but nobody has checked whether the original game has the same issue. Treat as open.' },
  note: { label: 'Note', color: '#7bd88f', blurb: 'Informational: usually intended or harmless.' },
};
export const STATUSES = ['open', 'investigating', 'accepted', 'fixed', 'wontfix'];
export const STATUS_LABEL = { open: 'Open', investigating: 'Investigating', accepted: 'Accepted (intended)', fixed: 'Fixed', wontfix: 'Won’t fix' };

const SRC = 'saint-marrow/js/chapters/chapters.js';

/**
 * Verified findings about the game. Matching: chapter (from the imported node's meta.source.chapter), validator code(s) and object name.
 * `evidence` says how each statement was established.
 *
 * Until 2026-10-24 this listed oddities of the frozen original (a fuse box use point 2.9 m up, blood writing in mid-air, notes beside desks,
 * a basement region only scripts could join, …). The game has since been reworked and those were fixed in the game itself; what stays here
 * is intended. Anything new the validator finds on the game should be fixed there first, and only recorded here if it is meant to be so.
 */
export const KNOWN_QUIRKS = [
  { id: 'dormant-on-props', chapters: [4], codes: ['spawn-dormant-overlap'], name: /^hollow spawn/, cls: 'note',
    title: 'Dormant enemies lie on furniture',
    explanation: 'Dormant enemies are placed lying on beds/gurneys on purpose; the overlap is intended.', evidence: [`${SRC}: chapter 4 legend g { prop: 'gurney', spawn: 'hollow', dormant: true, scriptOnly: true, dz: 1.0, tag: 'theatre' }`] },
];

const sourceOf = (node) => node?.meta?.source || null;
const isImported = (node) => sourceOf(node)?.game === 'saint-marrow';

/** Does the game source text handle this id: names it literally, or tests a prefix of it (id.startsWith('relay') handles relay1…3)? */
export function sourceMentions(code, id) {
  const re = new RegExp(`['"\`]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
  if (re.test(code)) return true;
  for (const m of code.matchAll(/startsWith\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) if (id.startsWith(m[1])) return true;
  return false;
}

/** Which original-game reference scripts of this chapter handle the event's id? (e.g. “trigger:bay” → 'bay' in onTrigger()) */
function handlersFor(project, chapter, eventName) {
  const id = String(eventName).split(':').slice(1).join(':'); if (!id) return [];
  return Object.entries(project.data.scripts || {}).filter(([k, s]) => k.startsWith(`ref_ch${chapter}_`) && typeof s.code === 'string' && sourceMentions(s.code, id)).map(([k]) => k.replace(`ref_ch${chapter}_`, '') + '()');
}

/** Classification of one validator issue (see CLASSES). Pure: depends only on the project and the issue. */
export function classifyIssue(project, issue) {
  const nodes = (issue.nodes || []).map((id) => project.scene.get(id)).filter(Boolean);
  const imported = nodes.length > 0 && nodes.every(isImported);
  const chapter = imported ? sourceOf(nodes[0]).chapter : null;
  const base = { imported, chapter, quirk: null, evidence: [] };
  if (imported) {
    const names = nodes.map((n) => n.name);
    for (const q of KNOWN_QUIRKS) {
      if (!q.chapters.includes(chapter) || !q.codes.includes(issue.code)) continue;
      if (q.name && !names.some((n) => q.name.test(n))) continue;
      return { ...base, cls: q.cls, quirk: q.id, title: q.title, explanation: q.explanation, evidence: q.evidence };
    }
    if (issue.code === 'unhandled-event') {
      const ev = nodes[0].name, hs = handlersFor(project, chapter, ev), id = ev.split(':').slice(1).join(':');
      if (hs.length) return { ...base, cls: 'script', title: 'Handled by the original game’s script', explanation: `Nothing in the Studio handles “${ev}”, but the original game does it in JavaScript (${hs.join(', ')}), which cannot be imported. Rebuild the logic with event graphs if you need it.`, evidence: [`${SRC}: ${hs.join(', ')} mention '${id}'`, 'the import report lists the chapter functions that were not converted'] };
      if (Object.keys(project.data.scripts || {}).some((k) => k.startsWith(`ref_ch${chapter}_`)))        // the reference functions are present and none mentions it
        return { ...base, cls: 'quirk', quirk: 'dead-trigger', title: 'Trigger the original never handles', explanation: `“${ev}” is defined in the map legend, but none of this chapter’s original functions (start/update/onTrigger/onUse/…) mentions '${id}', so it does nothing in the original game either.`, evidence: [`the imported reference scripts ref_ch${chapter}_* (the original functions, read-only) never contain '${id}'`, `${SRC}: the legend defines it; there is no handler`] };
    }
    return { ...base, cls: issue.severity === 'info' ? 'note' : 'unverified', title: 'Imported object — not verified', explanation: 'This object comes from the original game. The same problem may exist there; it has not been checked.', evidence: [] };
  }
  if (issue.severity === 'info') return { ...base, cls: 'note', title: 'Note', explanation: 'Informational.', evidence: [] };
  return { ...base, cls: 'bug', title: 'Problem in this map', explanation: 'On objects that are not imported from the original game.', evidence: [] };
}

/** Stable identity of an issue across validations (node ids can change when a chapter is re-imported, so imported nodes use their source cell). */
export function issueKey(project, issue) {
  const parts = (issue.nodes || []).map((id) => { const n = project.scene.get(id); const s = sourceOf(n); return s ? `src:${s.chapter}:${(s.cell || []).join(',')}:${n.name}` : `id:${id}`; }).sort();
  return `${issue.code}|${parts.join(';') || issue.message}`;
}

export function enrichIssues(project, issues) { return issues.map((i) => ({ ...i, key: issueKey(project, i), names: (i.nodes || []).map((id) => project.scene.get(id)?.name).filter(Boolean), triage: classifyIssue(project, i) })); }

/** Counts per class for the summary bar. */
export function summarize(enriched) { const out = Object.fromEntries(Object.keys(CLASSES).map((k) => [k, 0])); for (const i of enriched) out[i.triage.cls]++; return out; }

// ------------------------------------------------------------------ tracker (project.data.issues)
export function newTracked(enrichedIssue, { title = null } = {}) {
  const t = enrichedIssue.triage, now = new Date().toISOString();
  return { id: uid('iss'), key: enrichedIssue.key, code: enrichedIssue.code, title: title || t.title || enrichedIssue.message.slice(0, 80), message: enrichedIssue.message, cls: t.cls, quirk: t.quirk, severity: enrichedIssue.severity, status: t.cls === 'quirk' || t.cls === 'script' || t.cls === 'note' ? 'accepted' : 'open', notes: '', evidence: t.evidence || [], nodeNames: enrichedIssue.names || [], created: now, updated: now };
}

/** For each tracked item: does it still reproduce in this validation run? */
export function trackedState(tracked, enriched) {
  const keys = new Set(enriched.map((i) => i.key));
  return tracked.map((t) => ({ ...t, reproduces: keys.has(t.key) }));
}

/** Markdown report of the current triage (also used for docs/DIAGNOSTICS.md). */
export function reportMarkdown(project, enriched) {
  const sum = summarize(enriched), lines = [`# Diagnostics — ${project.meta.name}`, '', `${enriched.length} validator issue(s).`, '', '| Class | Count |', '|---|---|'];
  for (const [k, c] of Object.entries(CLASSES)) lines.push(`| ${c.label} | ${sum[k]} |`);
  for (const [k, c] of Object.entries(CLASSES)) {
    const list = enriched.filter((i) => i.triage.cls === k); if (!list.length) continue;
    lines.push('', `## ${c.label} (${list.length})`, '', c.blurb, '');
    const groups = new Map(); for (const i of list) { const g = i.triage.quirk || i.code; (groups.get(g) || groups.set(g, []).get(g)).push(i); }
    for (const [g, items] of groups) {
      const t = items[0].triage;
      lines.push(`### ${t.title || g}  ×${items.length}`, '', t.explanation, '');
      for (const e of t.evidence || []) lines.push(`- Evidence: ${e}`);
      lines.push('', ...items.slice(0, 12).map((i) => `- \`${i.code}\` ${i.message}`), ...(items.length > 12 ? [`- …and ${items.length - 12} more`] : []), '');
    }
  }
  return lines.join('\n');
}

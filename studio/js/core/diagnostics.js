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
const LVL = 'saint-marrow/js/world/level.js';
const T = 'studio/tests/browser/original-oracle.test.mjs';

/**
 * Verified findings about the original game. Matching: chapter (from the imported node's meta.source.chapter), validator code(s) and object name.
 * `evidence` says how each statement was established; entries marked [running game] were measured by running the original in Chromium.
 */
export const KNOWN_QUIRKS = [
  { id: 'ch2-fusebox-high', chapters: [2], codes: ['interaction-out-of-reach', 'unreachable'], name: /^use:fusebox$/, cls: 'quirk',
    title: 'Fuse box interaction point sits 2.9 m up',
    explanation: 'The game registers the fuse box’s “use” point at y = 2.9 m. The prop is mounted at 1.45 m and the legend adds useY (1.45) on top, so the point is a metre above the box itself. Players have to look up ~40° at the empty wall above it. The Studio preserves the original coordinates; the “lower to eye level” fix changes only your copy.',
    evidence: ['[running game] level.interactables fusebox pos().y = 2.9 while the fusebox prop is at y = 1.45 (' + T + ': “the original fusebox interaction really is at y = 2.9”)', `${SRC}: legend f { prop: 'fusebox', useY: 1.45 }; props.js: fusebox mount 1.45`] },
  { id: 'writing-no-wall', chapters: [2, 3, 4], codes: ['decal-floating'], name: /^Blood writing/, cls: 'quirk',
    title: 'Blood writing floats in the open',
    explanation: 'The map cell for this writing has no wall next to it. The game then falls back to “north” and places the writing 0.495 m north of the cell centre, in mid-air — it does the same in the original. Move the decal onto a wall (the Studio offers a snap fix) if you want it fixed in your copy.',
    evidence: [`${LVL} placeDecal(): wd = this.wallDir(x, z) || [0, -1]; wallDir() returns null when no neighbouring cell is a wall`, 'tests/unit/diagnostics.test.mjs checks, per chapter, that the source cell has no adjacent wall'] },
  { id: 'note-off-desk', chapters: [2, 4], codes: ['spawn-floating'], name: /^(codeNote|note n_lab)$/, cls: 'quirk',
    title: 'Note placed at desk height beside the desk',
    explanation: 'The legend gives this note an explicit height of 0.79 m (the desk top), but the desks are in the neighbouring map row, 0.5 m away, so the note hovers at 0.79 m with nothing under it — in the original game as well.',
    evidence: [`${SRC}: legend N { note: 'n_code', id: 'codeNote', y: 0.79 }, e { note: 'n_lab', tape: true, y: 0.79 }`, `${LVL} placeNote(): mesh.position.y = d.y ?? surfaceHeight(...) — the explicit y wins`, 'imported colliders: desks at z 10.03–10.98 (ch2) and 19.03–19.98 (ch4); the notes are at z 11.5 and 20.5'] },
  { id: 'generator-low', chapters: [4], codes: ['interaction-awkward'], name: /^use:generator$/, cls: 'quirk',
    title: 'Generator interaction point is near the floor',
    explanation: 'The original registers the generator’s “use” point at y = 0.6 m (useY: 0.6), so a standing player looks down ~35° at it. Same in the original.',
    evidence: ['[running game] interaction point identical to the import in x, y, z (' + T + ')', `${SRC}: G { prop: 'generator', use: 'generator', useY: 0.6 }`] },
  { id: 'battery-in-table-box', chapters: [1, 5], codes: ['spawn-embedded', 'intersection'], name: /^(battery \(7,53\)|nightstand \(7,53\)|Facade \((6,52|6,53)\))$/, cls: 'quirk',
    title: 'Battery / nightstand overlap a table box and the hut facade',
    explanation: 'In the hut, the 2.4 m-wide table’s bounding box (x 7.30–9.70) overlaps the nightstand at (7,53) where the battery lies, and the facade walls touch the nightstand. The game builds the same boxes: its prop colliders are bounding boxes of the models, which are solid in the box but open underneath in reality.',
    evidence: ['[running game] prop colliders in the hut: table x 7.3–9.7, z 52.93–54.07; nightstand x 7.24–7.76 (same as the import)', `${LVL} placeProp(): col = propCollider(obj, 0.0) — the model’s bounding box`] },
  { id: 'hut-doorway-squeeze', chapters: [1, 5], codes: ['unreachable'], name: /^(battery \(7,53\)|hutNote|bandage \(9,55\))$/, cls: 'limit',
    title: 'Hut interior behind a 0.43 m gap',
    explanation: 'Right behind the hut door the table and the tool chest leave a 0.43 m gap, narrower than the player (0.6 m). The Studio’s navigation, and a strict collision flood-fill of the original, cannot get through, so items deeper in the hut count as unreachable. The original’s push-out collision may let a player squeeze through — the Studio does not claim to know. The boltcutters and crowbar can be picked up from the doorway and are not flagged.',
    evidence: ['[running game] hut prop colliders equal the import to < 1 cm; the game’s own findInteractable() cannot pick these items from any position a radius-0.3 circle can reach (' + T + ')', 'Studio and original agree on geometry, so this is about player squeeze tolerance, not import accuracy'] },
  { id: 'ch1-gate-closed', chapters: [1], codes: ['unreachable'], name: /^theo$/, cls: 'note',
    title: 'Theo is behind the chained gate',
    explanation: 'In chapter 1 the main gate is chained shut until the player uses the bolt cutters; everything inside is cut off until then. (In chapter 5 the gate is open and Theo is reachable.)',
    evidence: [`${SRC}: buildGate(level, false) in chapter 1, buildGate(level, true) in chapter 5`, '[running game] chapter 1: flood fill cannot reach Theo, chapter 5: can; the import now builds the chapter 5 gate open (' + T + ')'] },
  { id: 'ch4-disconnected-region', chapters: [4], codes: ['unreachable'], name: null, cls: 'script',
    title: 'Basement region joined by game logic',
    explanation: 'From the player’s spawn, the part of the basement holding these objects is not connected by walkable space — not even with every door opened, in the original game’s own collision. The original joins it with scripted events (the service-tunnel ladder, the flood trigger), which the Studio cannot import.',
    evidence: ['[running game] flood fill with all doors opened from the spawn cell: none of these objects reachable (' + T + ')', 'the ladder interaction and the flood trigger are handled in chapters.js chapter-4 functions (not importable)'] },
  { id: 'dormant-on-props', chapters: [3], codes: ['spawn-dormant-overlap'], name: /^hollow spawn/, cls: 'note',
    title: 'Dormant enemies lie on furniture',
    explanation: 'Dormant enemies are placed lying on beds/gurneys on purpose; the overlap is intended.', evidence: [`${SRC}: h { spawn: 'hollow', dormant: true }, g { prop: 'gurney', spawn: 'hollow', dormant: true }`] },
];

const sourceOf = (node) => node?.meta?.source || null;
const isImported = (node) => sourceOf(node)?.game === 'saint-marrow';

/** Does any original-game reference script of this chapter mention the event's id? (e.g. “trigger:bay” → 'bay' in onTrigger()) */
function handlersFor(project, chapter, eventName) {
  const id = String(eventName).split(':').slice(1).join(':'); if (!id) return [];
  const re = new RegExp(`['"\`]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
  return Object.entries(project.data.scripts || {}).filter(([k, s]) => k.startsWith(`ref_ch${chapter}_`) && typeof s.code === 'string' && re.test(s.code)).map(([k]) => k.replace(`ref_ch${chapter}_`, '') + '()');
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

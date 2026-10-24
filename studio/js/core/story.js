// Story structure the author builds BY HAND: chapters and endings in a graph, an item catalogue and notes. DOM-free.
// The Studio never writes story text for you. This module only stores what the author typed and checks the structure
// (reachability, dead ends, undefined items) so mistakes are caught before they reach players.
//
//   project.data.story = { start: <chapter node id>, graph: { id, name, nodes: [chapter|ending], edges: [transition] }, items: {id: item}, notes: {id: note} }
//   chapter node.data = { title, summary, objective, map, notes: [noteId] }      ending node.data = { title, text }
//   transition edge.data = { kind: 'always' | 'event' | 'flag', event, flag, value, label }

import { uid, deepClone } from './util.js';
import { analyzeGraphs, sceneEventNames } from './events.js';

export const TRANSITION_KINDS = ['always', 'event', 'flag'];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'item';

export function defaultStory() { return { start: '', graph: { id: 'story', name: 'Story', nodes: [], edges: [] }, items: {}, notes: {}, endings: {}, chapters: {} }; }

/** Normalised view of project.data.story (older / partial data is tolerated). */
export function storyOf(project) {
  const s = project.data.story || {};
  const base = defaultStory();
  return { ...base, ...s, graph: { ...base.graph, ...(s.graph || {}), nodes: s.graph?.nodes || [], edges: s.graph?.edges || [] }, items: s.items || {}, notes: s.notes || {} };
}

export const newChapter = (x = 40, y = 40, title = 'New chapter') => ({ id: uid('chap'), type: 'chapter', x, y, data: { title, summary: '', objective: '', map: '', notes: [] } });
export const newEnding = (x = 40, y = 40, title = 'New ending') => ({ id: uid('end'), type: 'ending', x, y, data: { title, text: '' } });
export const newEdge = (from, to, data = {}) => ({ id: uid('tr'), from: { node: from, port: 'out' }, to: { node: to, port: 'in' }, data: { kind: 'always', event: '', flag: '', value: 'true', label: '', ...data } });
export function newItem(name, existing = {}) { let id = slug(name), n = 2; while (existing[id]) id = `${slug(name)}_${n++}`; return { id, name, description: '', stack: 1 }; }
export function newNote(title = 'New note') { return { id: uid('note'), title, text: '' }; }

/** Every item id the map and its event graphs refer to: door locks, interaction requirements, pickups, give/take nodes. */
export function itemReferences(project) {
  const refs = new Map();
  const add = (id, where) => { if (id && typeof id === 'string') { if (!refs.has(id)) refs.set(id, []); refs.get(id).push(where); } };
  project.scene.walk((n) => {
    const p = n.props || {};
    if (n.type === 'door' && typeof p.locked === 'string' && /^(item|key):/.test(p.locked)) add(p.locked.split(':')[1], `door “${n.name}”`);
    if (n.type === 'interaction') add(p.requires, `interaction “${n.name}”`);
    if (n.type === 'itemSpawn') add(p.item, `pickup “${n.name}”`);
  });
  for (const g of Object.values(project.data.events?.graphs || {})) for (const nd of g.nodes) if (nd.type === 'act.item') add(nd.data?.item, `graph “${g.name}”`);
  return refs;
}

/** Structure checks + path statistics. Returns { issues, stats, order } (order = chapter/ending ids breadth-first from the start). */
export function analyzeStory(project) {
  const st = storyOf(project), g = st.graph;
  const issues = [], add = (severity, code, message, nodes = []) => issues.push({ severity, code, message, nodes });
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const chapters = g.nodes.filter((n) => n.type === 'chapter'), endings = g.nodes.filter((n) => n.type === 'ending');
  const out = new Map(), inc = new Map();
  for (const e of g.edges) {
    if (!byId.has(e.from.node) || !byId.has(e.to.node)) { add('error', 'story-dangling', 'A transition points at a chapter that no longer exists.'); continue; }
    (out.get(e.from.node) || out.set(e.from.node, []).get(e.from.node)).push(e); (inc.get(e.to.node) || inc.set(e.to.node, []).get(e.to.node)).push(e);
  }
  const label = (n) => n.data?.title || '(untitled)';
  const stats = { chapters: chapters.length, endings: endings.length, transitions: g.edges.length, reachable: 0, unreachable: [], paths: 0, pathsCapped: false, cycles: false };
  const order = [];
  if (!chapters.length && !endings.length) {
    return { issues: [{ severity: 'info', code: 'story-empty', message: 'No story has been authored in this project (that is fine for a single map).', nodes: [] }], stats, order };
  }
  const start = byId.get(st.start);
  if (!st.start) add('warn', 'story-no-start', 'No starting chapter is set. Select a chapter and choose “Set as start”.');
  else if (!start || start.type !== 'chapter') add('error', 'story-bad-start', 'The starting chapter no longer exists. Set a new one.');
  // reachability + order
  const seen = new Set();
  if (start?.type === 'chapter') { const q = [start.id]; seen.add(start.id); while (q.length) { const id = q.shift(); order.push(id); for (const e of out.get(id) || []) if (!seen.has(e.to.node)) { seen.add(e.to.node); q.push(e.to.node); } } }
  stats.reachable = seen.size;
  if (start) for (const n of g.nodes) if (!seen.has(n.id)) { stats.unreachable.push(n.id); add('warn', 'story-unreachable', `${n.type === 'ending' ? 'Ending' : 'Chapter'} “${label(n)}” can never be reached from the starting chapter.`, [n.id]); }
  for (const c of chapters) {
    if (!(out.get(c.id) || []).length) add('warn', 'story-dead-end', `Chapter “${label(c)}” has no way forward (no transition) and is not an ending.`, [c.id]);
    if (!String(c.data?.title || '').trim()) add('info', 'story-untitled', 'A chapter has no title.', [c.id]);
    for (const nid of c.data?.notes || []) if (!st.notes[nid]) add('warn', 'story-missing-note', `Chapter “${label(c)}” refers to a note that no longer exists.`, [c.id]);
  }
  for (const e of g.edges) {
    const a = byId.get(e.from.node), d = e.data || {};
    if (!a || !byId.has(e.to.node)) continue;
    if (byId.get(e.from.node).type === 'ending') add('warn', 'story-ending-out', `Ending “${label(a)}” has a transition leaving it; endings end the story.`, [a.id]);
    if (d.kind === 'event' && !String(d.event || '').trim()) add('warn', 'story-edge-empty', `The transition out of “${label(a)}” waits for an event but no event name is set.`, [a.id]);
    if (d.kind === 'flag' && !String(d.flag || '').trim()) add('warn', 'story-edge-empty', `The transition out of “${label(a)}” waits for a flag but no flag name is set.`, [a.id]);
  }
  // events: this map may legitimately not fire an event that another chapter's map does, so this is only a note
  const { emitted } = analyzeGraphs(project); const fired = new Set([...sceneEventNames(project).keys(), ...emitted]);
  for (const e of g.edges) { const d = e.data || {}, a = byId.get(e.from.node); if (a && d.kind === 'event' && d.event && !fired.has(d.event)) add('info', 'story-event-unfired', `The transition out of “${label(a)}” waits for “${d.event}”, which nothing in the OPEN map fires (it may come from the chapter's own map).`, [a.id]); }
  // paths from the start to an ending (simple paths; capped), and loops
  if (start?.type === 'chapter') {
    let count = 0; const CAP = 10000, onPath = new Set();
    const dfs = (id) => {
      if (count >= CAP) return;
      const n = byId.get(id);
      if (n.type === 'ending') { count++; return; }
      onPath.add(id);
      for (const e of out.get(id) || []) { if (onPath.has(e.to.node)) { stats.cycles = true; continue; } dfs(e.to.node); }
      onPath.delete(id);
    };
    dfs(start.id); stats.paths = count; stats.pathsCapped = count >= CAP;
    if (!endings.some((e) => seen.has(e.id))) add('warn', 'story-no-ending', 'No ending can be reached from the starting chapter.');
    if (stats.cycles) add('info', 'story-loop', 'The story contains a loop (a transition leads back to an earlier chapter). That is fine for hub-style stories, but make sure the player can leave it.');
  }
  // items
  const refs = itemReferences(project), defined = Object.keys(st.items);
  if (defined.length) for (const [id, where] of refs) if (!st.items[id]) add('warn', 'story-item-undefined', `Item “${id}” is used (${where.slice(0, 2).join(', ')}) but is not in the story's item list.`);
  for (const id of defined) if (!refs.has(id)) add('info', 'story-item-unused', `Item “${st.items[id].name || id}” is in the item list but nothing in the open map uses it.`);
  return { issues, stats, order };
}

/** A plain-text outline of what the author wrote, for sharing or review. Nothing is generated: every sentence is the author's. */
export function storyOutline(project) {
  const st = storyOf(project), g = st.graph, byId = new Map(g.nodes.map((n) => [n.id, n]));
  const { order } = analyzeStory(project);
  const ids = [...order, ...g.nodes.map((n) => n.id).filter((i) => !order.includes(i))];
  const lines = [`# ${project.meta.name} — story outline`, ''];
  for (const id of ids) {
    const n = byId.get(id), d = n.data || {};
    lines.push(`## ${n.type === 'ending' ? 'Ending: ' : ''}${d.title || '(untitled)'}${st.start === id ? '  (start)' : ''}`);
    if (n.type === 'chapter') {
      if (d.map) lines.push(`Map: ${d.map}`);
      if (d.objective) lines.push(`Objective: ${d.objective}`);
      if (d.summary) lines.push('', d.summary);
      for (const nid of d.notes || []) if (st.notes[nid]) lines.push('', `Note “${st.notes[nid].title}”: ${st.notes[nid].text}`);
      const outs = g.edges.filter((e) => e.from.node === id && byId.has(e.to.node));
      if (outs.length) { lines.push('', 'Leads to:'); for (const e of outs) { const t = byId.get(e.to.node).data?.title || '(untitled)', k = e.data || {}; lines.push(`- ${t}${k.kind === 'event' ? ` — when “${k.event}” happens` : k.kind === 'flag' ? ` — when flag “${k.flag}” is ${k.value || 'true'}` : ''}${k.label ? ` (${k.label})` : ''}`); } }
    } else if (d.text) lines.push('', d.text);
    lines.push('');
  }
  const items = Object.values(st.items);
  if (items.length) { lines.push('## Items', ''); for (const it of items) lines.push(`- ${it.name || it.id} (\`${it.id}\`)${it.description ? `: ${it.description}` : ''}`); lines.push(''); }
  return lines.join('\n');
}

export { deepClone };

// Story workspace: the author's own chapters and endings in a graph, an item catalogue and notes, with structural checks.
// Nothing is generated: every title and sentence is typed by the author. The original game's chapter list is shown as a READ-ONLY reference only.
import { h, download } from '../ui/dom.js';
import { GraphEditor } from '../ui/graph.js';
import { textField, numberField, button } from '../ui/fields.js';
import { confirmBox, promptBox } from '../ui/dialogs.js';
import { setData } from '../core/commands.js';
import { autoLayout } from '../core/events.js';
import { loadGameModules } from '../core/importers/sm-chapter.js';
import * as S from '../core/story.js';
import { sceneEventNames, analyzeGraphs } from '../core/events.js';

const REGISTRY = {
  categories: ['Story'],
  types: {
    chapter: { cat: 'Story', label: 'Chapter', color: '#3f78c4', inputs: ['in'], outputs: ['out'], width: 260, hint: 'A part of the story. Connect it to the chapter or ending that follows.', fields: [
      { key: 'title', label: 'Title', type: 'string' }, { key: 'summary', label: 'Summary (your own words)', type: 'text' }, { key: 'objective', label: 'Objective shown to the player', type: 'string' }, { key: 'map', label: 'Map / scene it takes place in', type: 'string' }] },
    ending: { cat: 'Story', label: 'Ending', color: '#b5563a', inputs: ['in'], outputs: [], width: 260, hint: 'The story ends here.', fields: [{ key: 'title', label: 'Title', type: 'string' }, { key: 'text', label: 'Text', type: 'text' }] },
  },
};

class StoryWorkspace {
  constructor(app, el) {
    this.app = app; this.el = el; this.tab = 'items'; this.sel = null; this.selItem = null; this.selNote = null; this.selNodes = [];
    this.leftBody = h('div', { class: 'panel-body', style: { flex: 1 } });
    this.tabBar = h('div', { class: 'toolbar', style: { height: 'auto', padding: '4px 6px', gap: '4px' } }, ['items', 'notes', 'reference'].map((t) => h('button', { class: 'btn small', 'data-tab': t, onclick: () => { this.tab = t; this.renderLeft(); } }, { items: 'Items', notes: 'Notes', reference: 'Original game' }[t])));
    this.graphBox = h('div', { style: { flex: 1, position: 'relative', minHeight: '200px' } });
    this.report = h('div', { class: 'panel-body insp' });
    this.selectionBox = h('div');
    this.startInfo = h('span', { id: 'st-start', style: { color: 'var(--dim)', marginRight: 'auto' } });
    el.append(h('div', { class: 'split', style: { height: '100%' } },
      h('div', { class: 'pane', style: { width: '300px', display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: '1px solid var(--line)' } }, h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Story data')), this.tabBar, this.leftBody),
      h('div', { class: 'pane', style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 } },
        h('div', { class: 'graph-bar' }, this.startInfo, button('+ Chapter', () => this.addNode('chapter'), { primary: true }), button('+ Ending', () => this.addNode('ending')), button('Set as start', () => this.setStart(), { title: 'Make the selected chapter the first one' }), button('Auto layout', () => this.layout()), button('Fit', () => this.editor?.fit())),
        this.graphBox,
        h('div', { style: { padding: '4px 10px', color: 'var(--faint)', fontSize: '11px', borderTop: '1px solid var(--line)' } }, 'Right-click the canvas to add chapters and endings · drag from a dot to connect · click a connection to say when it happens (always / an event / a flag)')),
      h('div', { class: 'pane', style: { width: '340px', background: 'var(--panel)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' } }, h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Selection & checks')), this.selectionBox, this.report)));
    this.editor = new GraphEditor(app, this.graphBox, {
      registry: REGISTRY,
      getGraph: () => S.storyOf(app.project).graph,
      commit: (g, label, mergeKey) => this.commitGraph(g, label, mergeKey),
      newNode: (type, x, y) => (type === 'ending' ? S.newEnding(x, y, '') : S.newChapter(x, y, '')),
      defaultEdgeData: { kind: 'always', event: '', flag: '', value: 'true', label: '' },
      edgeLabel: (e) => { const d = e.data || {}; return d.kind === 'event' ? `on “${d.event || '?'}”` : d.kind === 'flag' ? `if ${d.flag || '?'} = ${d.value || 'true'}` : (d.label || ''); },
      edgeFields: () => [{ key: 'kind', label: 'Happens', type: 'select', options: S.TRANSITION_KINDS, default: 'always' }, { key: 'event', label: 'Event name (if “event”)', type: 'string' }, { key: 'flag', label: 'Flag name (if “flag”)', type: 'string' }, { key: 'value', label: 'Flag value', type: 'string', default: 'true' }, { key: 'label', label: 'Note (optional)', type: 'string' }],
      suggest: (kind) => (kind === 'event' ? this.eventNames() : []),
      decorate: (n) => this.badges(n),
      onSelect: (s) => { this.selNodes = s?.nodes || []; this.renderSelection(); },
    });
    app.on('history', () => { if (this.live) this.refresh(); });
    app.on('project', () => { this.sel = null; this.selItem = null; this.selNote = null; this.gameRef = null; if (this.live) this.refresh(); });
    app.on('scene', () => { if (this.live) this.refreshReport(); });
  }

  get live() { return this.el.classList.contains('on'); }
  show() { this.refresh(); setTimeout(() => this.editor.fit(), 30); }
  data() { return S.storyOf(this.app.project); }
  eventNames() { const p = this.app.project; return [...new Set([...sceneEventNames(p).keys(), ...analyzeGraphs(p).emitted])].sort(); }

  commit(next, label, mergeKey) { this.app.exec(setData(['story'], next, { label, mergeKey })); }
  commitGraph(graph, label, mergeKey) { this.commit({ ...this.data(), graph }, label, mergeKey); }
  edit(fn, label, mergeKey) { const d = JSON.parse(JSON.stringify(this.data())); fn(d); this.commit(d, label, mergeKey); }

  refresh() { this.editor.render(); this.renderLeft(); this.refreshReport(); this.renderSelection(); }
  refreshReport() { this.analysis = S.analyzeStory(this.app.project); this.renderReport(); this.updateStart(); }

  badges(n) { return (this.analysis?.issues || []).filter((i) => i.nodes.includes(n.id) && i.severity !== 'info').map((i) => ({ severity: i.severity, message: i.message })); }
  updateStart() {
    const d = this.data(), st = d.graph.nodes.find((n) => n.id === d.start);
    this.startInfo.textContent = st ? `Starts with: ${st.data.title || '(untitled)'}` : 'No starting chapter set';
    this.editor.nodeEls?.forEach((el, id) => el.classList.toggle('is-start', id === d.start));
  }

  // ------------------------------------------------------------------ graph actions
  addNode(type) {
    const d = JSON.parse(JSON.stringify(this.data())), n = this.editor.opts.newNode(type, 40 + (d.graph.nodes.length % 4) * 300, 40 + Math.floor(d.graph.nodes.length / 4) * 260);
    d.graph.nodes.push(n); if (type === 'chapter' && !d.start) d.start = n.id;
    this.commit(d, type === 'chapter' ? 'Add chapter' : 'Add ending'); setTimeout(() => this.editor.fit(), 30);
  }
  setStart() {
    const id = this.selNodes.find((i) => this.data().graph.nodes.find((n) => n.id === i)?.type === 'chapter');
    if (!id) { this.app.toast('Select a chapter first.', 'info'); return; }
    this.edit((d) => { d.start = id; }, 'Set starting chapter');
  }
  layout() { const d = JSON.parse(JSON.stringify(this.data())), pos = autoLayout(d.graph, { dy: 260 }); d.graph.nodes.forEach((n) => { n.x = pos[n.id].x; n.y = pos[n.id].y; }); this.commit(d, 'Auto layout'); setTimeout(() => this.editor.fit(), 30); }

  // ------------------------------------------------------------------ left: items / notes / original reference
  renderLeft() {
    this.tabBar.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('primary', b.dataset.tab === this.tab));
    ({ items: () => this.renderItems(), notes: () => this.renderNotes(), reference: () => this.renderReference() })[this.tab]();
  }
  renderItems() {
    const d = this.data(), refs = S.itemReferences(this.app.project), items = Object.values(d.items);
    const missing = [...refs.keys()].filter((id) => !d.items[id]);
    const sel = d.items[this.selItem] || null;
    this.leftBody.replaceChildren(
      h('div', { class: 'hint', style: { padding: '8px 10px', color: 'var(--faint)', fontSize: '11px' } }, 'Items the story talks about. The checks compare this list with the items your map uses (door locks, pickups, interactions, give/take nodes).'),
      ...items.map((it) => h('div', { class: 'tree-row' + (it.id === this.selItem ? ' sel primary' : ''), 'data-item': it.id, style: { position: 'relative', height: '28px' }, onclick: () => { this.selItem = it.id; this.renderLeft(); } }, h('span', { class: 'tree-icon', style: { background: '#d8a54a', marginLeft: '8px' } }, 'i'), h('span', { class: 'tree-name' }, it.name || it.id), h('span', { class: 'tree-tag' }, refs.has(it.id) ? `${refs.get(it.id).length} use${refs.get(it.id).length > 1 ? 's' : ''}` : 'unused'))),
      h('div', { style: { padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' } }, button('+ Item', () => this.addItem(), { primary: true }), button(`Add ${missing.length} used item${missing.length === 1 ? '' : 's'} not listed`, () => this.addMissing(missing), { title: 'Creates entries with just the id; you write the names and descriptions' }), button('Delete', () => this.deleteItem())),
      sel ? h('div', { class: 'insp', style: { padding: '0 10px 10px' } },
        h('div', { class: 'kv', style: { fontSize: '12px', margin: '4px 0' } }, h('span', {}, 'Id'), h('b', { 'data-item-id': sel.id }, sel.id), h('span', {}, 'Used in'), h('span', {}, (refs.get(sel.id) || ['nothing in the open map']).slice(0, 4).join(', '))),
        textField('Name', { value: sel.name, onChange: (v) => this.edit((x) => { x.items[sel.id].name = v; }, 'Item name', `si:${sel.id}:name`) }).el,
        textField('Description', { value: sel.description, multiline: true, onChange: (v) => this.edit((x) => { x.items[sel.id].description = v; }, 'Item description', `si:${sel.id}:desc`) }).el,
        numberField('Max stack', { value: sel.stack ?? 1, step: 1, min: 1, int: true, onChange: (v) => this.edit((x) => { x.items[sel.id].stack = Math.max(1, v); }, 'Item stack', `si:${sel.id}:stack`) }).el) : null);
  }
  async addItem() { const name = await promptBox('New item', 'Item name (its id is made from it and stays the same if you rename it later)', ''); if (!name?.trim()) return; const it = S.newItem(name.trim(), this.data().items); this.edit((d) => { d.items[it.id] = it; }, 'Add item'); this.selItem = it.id; this.renderLeft(); }
  addMissing(ids) { if (!ids.length) { this.app.toast('Every item your map uses is already listed.', 'info'); return; } this.edit((d) => { for (const id of ids) d.items[id] = { id, name: id, description: '', stack: 1 }; }, `Add ${ids.length} items used by the map`); }
  async deleteItem() { const it = this.data().items[this.selItem]; if (!it) return; if (!(await confirmBox('Delete item', `Delete “${it.name || it.id}” from the item list? Objects that use it are not changed.`, { ok: 'Delete', danger: true }))) return; this.edit((d) => { delete d.items[it.id]; }, 'Delete item'); this.selItem = null; this.renderLeft(); }

  renderNotes() {
    const d = this.data(), notes = Object.values(d.notes), sel = d.notes[this.selNote] || null;
    this.leftBody.replaceChildren(
      h('div', { class: 'hint', style: { padding: '8px 10px', color: 'var(--faint)', fontSize: '11px' } }, 'Documents the player can find (letters, diary pages). Attach them to chapters from the Selection panel.'),
      ...notes.map((n) => h('div', { class: 'tree-row' + (n.id === this.selNote ? ' sel primary' : ''), 'data-note': n.id, style: { position: 'relative', height: '28px' }, onclick: () => { this.selNote = n.id; this.renderLeft(); } }, h('span', { class: 'tree-icon', style: { background: '#8aa0c8', marginLeft: '8px' } }, 'n'), h('span', { class: 'tree-name' }, n.title || '(untitled)'))),
      h('div', { style: { padding: '8px', display: 'flex', gap: '6px' } }, button('+ Note', () => { const n = S.newNote('New note'); this.edit((x) => { x.notes[n.id] = n; }, 'Add note'); this.selNote = n.id; this.renderLeft(); }, { primary: true }), button('Delete', async () => { if (!sel) return; if (!(await confirmBox('Delete note', `Delete “${sel.title}”?`, { ok: 'Delete', danger: true }))) return; this.edit((x) => { delete x.notes[sel.id]; x.graph.nodes.forEach((n) => { if (n.data?.notes) n.data.notes = n.data.notes.filter((i) => i !== sel.id); }); }, 'Delete note'); this.selNote = null; this.renderLeft(); })),
      sel ? h('div', { class: 'insp', style: { padding: '0 10px 10px' } }, textField('Title', { value: sel.title, onChange: (v) => this.edit((x) => { x.notes[sel.id].title = v; }, 'Note title', `sn:${sel.id}:t`) }).el, textField('Text', { value: sel.text, multiline: true, onChange: (v) => this.edit((x) => { x.notes[sel.id].text = v; }, 'Note text', `sn:${sel.id}:x`) }).el) : null);
  }

  async renderReference() {
    this.leftBody.replaceChildren(h('div', { class: 'note warn' }, h('b', {}, 'Read-only reference. '), 'This is the structure of the original game’s chapters, read from its source files. It is not copied into your story unless you press “Add shell” (which creates a chapter with only the title).'), h('div', { class: 'empty' }, 'Loading…'));
    try {
      if (!this.gameRef) {
        const mods = await loadGameModules(new URL('../saint-marrow', this.app.baseUrl).href.replace(/\/$/, ''));
        const i18n = await import(/* @vite-ignore */ new URL('../saint-marrow/js/i18n.js', this.app.baseUrl).href);
        // the hidden epilogue is part of chapter 6 (same key), not a chapter of its own; drafts stay labelled as the game labels them
        this.gameRef = mods.CHAPTERS.filter((c) => !c.hidden).map((c) => ({ id: c.id, key: c.key, title: i18n.t(c.key), draft: !!c.draft, sub: i18n.t(c.key + 'sub'), size: c.map ? `${c.map[0]?.length || '?'}×${c.map.length}` : '' }));
      }
    } catch (e) { this.leftBody.replaceChildren(h('div', { class: 'note err' }, 'Could not read the original chapters: ' + e.message)); return; }
    if (this.tab !== 'reference') return;
    this.leftBody.replaceChildren(h('div', { class: 'note warn' }, h('b', {}, 'Read-only reference. '), 'The original game’s chapters, read from its source. Nothing is added to your story unless you press “Add shell” (a chapter with only its title).'),
      ...this.gameRef.map((c) => h('div', { 'data-ref': c.key, style: { padding: '6px 10px', borderBottom: '1px solid var(--line)' } }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('b', { style: { flex: 1 } }, `${c.id}. ${c.title}${c.draft ? ' (draft)' : ''}`), button('Add shell', () => this.addShell(c))), h('div', { style: { color: 'var(--dim)', fontSize: '12px' } }, c.sub))));
  }
  addShell(c) {
    const n = S.newChapter(40, 40, c.title); n.data.map = `original game: ${c.key}`;
    this.edit((d) => { n.x = 40 + (d.graph.nodes.length % 4) * 300; n.y = 40 + Math.floor(d.graph.nodes.length / 4) * 260; d.graph.nodes.push(n); if (!d.start) d.start = n.id; }, `Add chapter shell “${c.title}”`);
    setTimeout(() => this.editor.fit(), 30);
  }

  // ------------------------------------------------------------------ right: selection + report
  renderSelection() {
    const d = this.data(), n = this.selNodes.length === 1 ? d.graph.nodes.find((x) => x.id === this.selNodes[0]) : null;
    if (!n || n.type !== 'chapter') { this.selectionBox.replaceChildren(h('div', { class: 'hint', style: { padding: '8px 10px', color: 'var(--faint)', fontSize: '11px' } }, n ? 'Endings only have a title and text.' : 'Select a chapter to attach notes or set it as the start.')); return; }
    const notes = Object.values(d.notes);
    this.selectionBox.replaceChildren(h('div', { class: 'insp', style: { padding: '6px 10px' } },
      h('b', { 'data-sel-title': '1' }, n.data.title || '(untitled)'), d.start === n.id ? h('span', { class: 'chip' }, 'start') : button('Set as start', () => this.setStart()),
      h('div', { style: { margin: '8px 0 2px', fontWeight: 600 } }, 'Notes in this chapter'),
      ...(notes.length ? notes.map((nt) => h('label', { style: { display: 'flex', gap: '6px', fontSize: '12px' } }, h('input', { type: 'checkbox', 'aria-label': `Note ${nt.title}`, checked: (n.data.notes || []).includes(nt.id), onchange: (e) => this.edit((x) => { const c = x.graph.nodes.find((y) => y.id === n.id); c.data.notes = e.target.checked ? [...new Set([...(c.data.notes || []), nt.id])] : (c.data.notes || []).filter((i) => i !== nt.id); }, 'Chapter notes') }), nt.title || '(untitled)')) : [h('div', { style: { color: 'var(--faint)', fontSize: '12px' } }, 'No notes yet (Notes tab).')])));
  }
  renderReport() {
    const a = this.analysis, s = a.stats;
    const stat = (k, v, extra = {}) => [h('span', {}, k), h('b', { ...extra }, String(v))];
    this.report.replaceChildren(
      h('div', { class: 'kv', id: 'st-stats', style: { fontSize: '12px', padding: '6px 10px' } }, ...stat('Chapters', s.chapters, { 'data-stat': 'chapters' }), ...stat('Endings', s.endings, { 'data-stat': 'endings' }), ...stat('Transitions', s.transitions), ...stat('Reachable', `${s.reachable} of ${s.chapters + s.endings}`, { 'data-stat': 'reachable' }), ...stat('Paths to an ending', s.pathsCapped ? '10,000+' : s.paths, { 'data-stat': 'paths' }), ...stat('Loops', s.cycles ? 'yes' : 'no')),
      h('div', { class: 'panel-head' }, h('span', { class: 'title' }, `Checks (${a.issues.filter((i) => i.code !== 'story-empty').length})`)),
      ...(a.issues.length ? a.issues.map((i) => h('div', { class: 'issue', 'data-code': i.code, style: { cursor: i.nodes.length ? 'pointer' : 'default' }, onclick: () => { if (i.nodes[0]) { this.editor.select(i.nodes[0]); this.focusNode(i.nodes[0]); } } }, h('span', { class: 'sev ' + i.severity }), h('div', { style: { flex: 1 } }, i.message))) : [h('div', { class: 'empty' }, 'No problems found.')]),
      h('div', { style: { padding: '8px 10px', display: 'flex', gap: '6px' } }, button('Export outline (.md)', () => download(`${this.app.project.meta.name.replace(/[^\w.-]+/g, '_')}-story.md`, S.storyOutline(this.app.project), 'text/markdown'), { primary: true }), button('Copy outline', () => { navigator.clipboard?.writeText(S.storyOutline(this.app.project)).then(() => this.app.toast('Outline copied.', 'ok')).catch(() => this.app.toast('Could not copy.', 'error')); })));
  }
  focusNode(id) { const el = this.editor.nodeEls?.get(id); el?.scrollIntoView?.({ block: 'center', inline: 'center' }); }
}

export default {
  id: 'story', label: 'Story', fill: true,
  create(app, el) { const w = new StoryWorkspace(app, el); app.storyWs = w; return w; },
};

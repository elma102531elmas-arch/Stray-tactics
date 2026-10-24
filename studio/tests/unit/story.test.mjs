import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../../js/core/project.js';
import { makeNode } from '../../js/core/scene.js';
import { newGraph, newNode } from '../../js/core/events.js';
import { validateProject } from '../../js/core/validate.js';
import * as S from '../../js/core/story.js';

/** Build a story: edges as [from, to, data]. nodes: {key: node}. */
function story(nodes, edges, { start = null, items = {}, notes = {} } = {}) {
  const p = new Project('Story test');
  const ids = {};
  const g = { id: 'story', name: 'Story', nodes: [], edges: [] };
  for (const [k, n] of Object.entries(nodes)) { ids[k] = n.id; g.nodes.push(n); }
  for (const [a, b, d] of edges) g.edges.push(S.newEdge(ids[a], ids[b], d));
  p.data.story = { ...S.defaultStory(), graph: g, start: start ? ids[start] : '', items, notes };
  return { p, ids };
}
const ch = (title, extra = {}) => ({ ...S.newChapter(0, 0, title), data: { ...S.newChapter().data, title, ...extra } });
const en = (title) => S.newEnding(0, 0, title);
const codes = (p) => S.analyzeStory(p).issues.map((i) => i.code);

test('an empty story is fine (single-map projects), and nothing is invented for it', () => {
  const p = new Project('x');
  const r = S.analyzeStory(p);
  assert.deepEqual(r.issues.map((i) => i.code), ['story-empty']); assert.equal(r.stats.chapters, 0);
  assert.deepEqual(validateProject(p, { only: ['story'] }).issues, [], 'no noise in the validator when no story exists');
  assert.equal(S.storyOf(p).graph.nodes.length, 0);
  assert.match(S.storyOutline(p), /# x — story outline/);
});

test('a healthy story: reachable, endings reachable, path count, order from the start', () => {
  const { p } = story({ a: ch('One'), b: ch('Two'), c: ch('Three'), e1: en('Good'), e2: en('Bad') }, [['a', 'b'], ['a', 'c'], ['b', 'e1'], ['c', 'e1'], ['c', 'e2']], { start: 'a' });
  const r = S.analyzeStory(p);
  assert.deepEqual(r.issues.filter((i) => i.severity !== 'info'), []);
  assert.equal(r.stats.reachable, 5); assert.equal(r.stats.paths, 3, 'a→b→e1, a→c→e1, a→c→e2'); assert.equal(r.stats.cycles, false);
  assert.deepEqual(r.order.map((id) => p.data.story.graph.nodes.find((n) => n.id === id).data.title), ['One', 'Two', 'Three', 'Good', 'Bad']);
});

test('problems are found: no start, bad start, unreachable, dead ends, no ending, ending with exits, dangling edges', () => {
  let { p } = story({ a: ch('A'), b: ch('B') }, [['a', 'b']]);
  assert.ok(codes(p).includes('story-no-start'));
  ({ p } = story({ a: ch('A') }, [], { start: 'a' })); p.data.story.start = 'ghost';
  assert.ok(codes(p).includes('story-bad-start'));
  ({ p } = story({ a: ch('A'), b: ch('B'), orphan: ch('Island'), e: en('End') }, [['a', 'b'], ['b', 'e']], { start: 'a' }));
  const r = S.analyzeStory(p); const un = r.issues.filter((i) => i.code === 'story-unreachable');
  assert.equal(un.length, 1); assert.match(un[0].message, /“Island”/); assert.equal(r.stats.unreachable.length, 1);
  assert.ok(r.issues.some((i) => i.code === 'story-dead-end' && /Island/.test(i.message)), 'the island has no way forward');
  ({ p } = story({ a: ch('A'), b: ch('B') }, [['a', 'b']], { start: 'a' }));
  assert.ok(codes(p).includes('story-dead-end') && codes(p).includes('story-no-ending'));
  ({ p } = story({ a: ch('A'), e: en('End'), z: ch('Z') }, [['a', 'e'], ['e', 'z']], { start: 'a' }));
  assert.ok(codes(p).includes('story-ending-out'));
  ({ p } = story({ a: ch('A'), b: ch('B') }, [['a', 'b']], { start: 'a' })); p.data.story.graph.nodes.pop();
  assert.ok(codes(p).includes('story-dangling'));
});

test('loops are allowed but reported; paths are counted without looping forever', () => {
  const { p } = story({ hub: ch('Hub'), a: ch('A'), b: ch('B'), e: en('End') }, [['hub', 'a'], ['a', 'hub'], ['hub', 'b'], ['b', 'e']], { start: 'hub' });
  const r = S.analyzeStory(p);
  assert.equal(r.stats.cycles, true); assert.ok(r.issues.some((i) => i.code === 'story-loop' && i.severity === 'info'));
  assert.equal(r.stats.paths, 1);
  assert.ok(!r.issues.some((i) => i.severity !== 'info' && i.code !== 'story-dead-end'), JSON.stringify(r.issues));
});

test('transitions: empty conditions are flagged; events nothing fires are only a note (the chapter may use another map)', () => {
  const { p } = story({ a: ch('A'), b: ch('B'), c: ch('C'), e: en('E') }, [['a', 'b', { kind: 'event', event: '' }], ['b', 'c', { kind: 'flag', flag: '' }], ['c', 'e', { kind: 'event', event: 'boss-dead' }]], { start: 'a' });
  const r = S.analyzeStory(p);
  assert.equal(r.issues.filter((i) => i.code === 'story-edge-empty').length, 2);
  const note = r.issues.find((i) => i.code === 'story-event-unfired'); assert.equal(note.severity, 'info'); assert.match(note.message, /boss-dead/);
  // once the open map fires it, the note disappears
  const trig = makeNode('trigger', { name: 'Boss zone', props: { onEnter: 'boss-dead' } }); p.scene.insert(trig);
  assert.ok(!codes(p).includes('story-event-unfired'));
  const gr = newGraph('g'); gr.nodes.push(newNode('act.emit', 0, 0, { name: 'boss-dead' })); p.data.events.graphs[gr.id] = gr; p.scene.detach(trig.id);
  assert.ok(!codes(p).includes('story-event-unfired'), 'an Emit node also counts');
});

test('items: references from doors, interactions, pickups and graphs are compared with the story item list', () => {
  const { p } = story({ a: ch('A'), e: en('E') }, [['a', 'e']], { start: 'a', items: { key: { id: 'key', name: 'Brass key' }, lamp: { id: 'lamp', name: 'Lamp' } } });
  p.scene.insert(makeNode('door', { name: 'Cell door', props: { locked: 'item:key' } }));
  p.scene.insert(makeNode('door', { name: 'Vault', props: { locked: 'item:crowbar' } }));
  p.scene.insert(makeNode('itemSpawn', { name: 'Pill', props: { item: 'pills' } }));
  p.scene.insert(makeNode('interaction', { name: 'Slot', props: { requires: 'coin' } }));
  const gr = newGraph('g'); gr.nodes.push(newNode('act.item', 0, 0, { item: 'fuse', action: 'give' })); p.data.events.graphs[gr.id] = gr;
  const refs = S.itemReferences(p);
  assert.deepEqual([...refs.keys()].sort(), ['coin', 'crowbar', 'fuse', 'key', 'pills']);
  const issues = S.analyzeStory(p).issues;
  assert.deepEqual(issues.filter((i) => i.code === 'story-item-undefined').map((i) => i.message.match(/“(\w+)”/)[1]).sort(), ['coin', 'crowbar', 'fuse', 'pills']);
  assert.deepEqual(issues.filter((i) => i.code === 'story-item-unused').map((i) => i.message), ['Item “Lamp” is in the item list but nothing in the open map uses it.']);
  // without an item list at all there is nothing to compare against, so no noise
  p.data.story.items = {}; assert.ok(!codes(p).some((c) => c.startsWith('story-item')));
});

test('catalogue helpers: unique item ids from names, notes referenced by chapters must exist', () => {
  const items = {}; for (const n of ['Brass key', 'Brass key', 'Brass-Key!']) { const it = S.newItem(n, items); items[it.id] = it; }
  assert.deepEqual(Object.keys(items), ['brass_key', 'brass_key_2', 'brass_key_3']);
  const note = S.newNote('Diary'); const { p } = story({ a: ch('A', { notes: [note.id, 'ghost'] }), e: en('E') }, [['a', 'e']], { start: 'a', notes: { [note.id]: note } });
  const m = S.analyzeStory(p).issues.filter((i) => i.code === 'story-missing-note'); assert.equal(m.length, 1);
});

test('the outline contains only what the author wrote, in story order, with transition conditions', () => {
  const note = { ...S.newNote('Diary'), text: 'Day 3: the lights failed.' };
  const { p } = story({ a: ch('The Gate', { summary: 'You arrive.', objective: 'Reach the gate', map: 'grounds', notes: [note.id] }), b: ch('Inside'), e: en('Escape') }, [['a', 'b', { kind: 'event', event: 'gate-open', label: 'door' }], ['b', 'e', { kind: 'flag', flag: 'power', value: 'on' }]], { start: 'a', notes: { [note.id]: note }, items: { key: { id: 'key', name: 'Key', description: 'Opens the gate.' } } });
  p.data.story.graph.nodes.find((n) => n.type === 'ending').data.text = 'You leave.';
  const md = S.storyOutline(p);
  assert.match(md, /## The Gate {2}\(start\)/); assert.match(md, /Objective: Reach the gate/); assert.match(md, /Map: grounds/); assert.match(md, /You arrive\./);
  assert.match(md, /Note “Diary”: Day 3: the lights failed\./);
  assert.match(md, /- Inside — when “gate-open” happens \(door\)/); assert.match(md, /- Escape — when flag “power” is on/);
  assert.match(md, /## Ending: Escape\n\nYou leave\./); assert.match(md, /- Key \(`key`\): Opens the gate\./);
  assert.ok(md.indexOf('The Gate') < md.indexOf('Inside') && md.indexOf('Inside') < md.indexOf('Ending: Escape'));
});

test('validator integration: story issues appear in the project check', () => {
  const { p } = story({ a: ch('A') }, [], { start: 'a' });
  const v = validateProject(p, { only: ['story'] });
  assert.ok(v.issues.some((i) => i.code === 'story-dead-end'));
});

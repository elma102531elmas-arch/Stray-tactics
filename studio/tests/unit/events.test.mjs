import test from 'node:test';
import assert from 'node:assert/strict';
import { EventRuntime, newGraph, newNode, analyzeGraphs, evalCondition, sceneEventNames, EVENT_NODE_TYPES } from '../../js/core/events.js';
import { Project } from '../../js/core/project.js';
import { makeNode } from '../../js/core/scene.js';

/** Build a graph from a compact description: nodes = {key: [type, data]}, edges = [[fromKey, port, toKey]] */
function graph(nodes, edges, name = 'g') {
  const g = newGraph(name); const ids = {};
  for (const [key, [type, data]] of Object.entries(nodes)) { const n = newNode(type, 0, 0, data); ids[key] = n.id; g.nodes.push(n); }
  edges.forEach(([a, port, b], i) => g.edges.push({ id: 'e' + i, from: { node: ids[a], port }, to: { node: ids[b], port: 'in' } }));
  return g;
}
const rt = (...gs) => new EventRuntime(Object.fromEntries(gs.map((g) => [g.id, g])));
const effects = (r, type) => r.effects.filter((e) => e.type === type);

test('event → set flag → door opens', () => {
  const g = graph({ t: ['on.event', { name: 'fuse-used' }], f: ['act.setFlag', { name: 'power', value: 'true' }], d: ['act.door', { doorId: 'D1', action: 'open' }] }, [['t', 'out', 'f'], ['f', 'out', 'd']]);
  const r = rt(g);
  assert.equal(r.emit('fuse-used'), 1);
  assert.equal(r.state.flags.power, 'true');
  assert.deepEqual(effects(r, 'door'), [{ t: 0, type: 'door', doorId: 'D1', action: 'open' }]);
  assert.equal(r.state.doors.D1, 'open');
});

test('events nobody listens to are reported in the trace, not silently dropped', () => {
  const r = rt(graph({}, []));
  assert.equal(r.emit('ghost'), 0);
  assert.ok(r.log.some((l) => /nothing listens to “ghost”/.test(l)));
});

test('branch follows flag / item / counter conditions', () => {
  const g = graph({ t: ['on.event', { name: 'go' }], b: ['flow.branch', { kind: 'flag', name: 'power', op: '==', value: 'true' }], yes: ['act.say', { text: 'lit' }], no: ['act.say', { text: 'dark' }] }, [['t', 'out', 'b'], ['b', 'true', 'yes'], ['b', 'false', 'no']]);
  const r = rt(g);
  r.emit('go'); assert.deepEqual(effects(r, 'say').map((e) => e.text), ['dark']);
  r.setFlag('power', true); r.emit('go'); assert.deepEqual(effects(r, 'say').map((e) => e.text), ['dark', 'lit']);
  assert.equal(evalCondition({ kind: 'item', name: 'key' }, { flags: {}, vars: {}, inventory: { key: 1 } }), true);
  assert.equal(evalCondition({ kind: 'item', name: 'key' }, { flags: {}, vars: {}, inventory: {} }), false);
  assert.equal(evalCondition({ kind: 'var', name: 'n', op: '>=', value: '3' }, { flags: {}, vars: { n: 3 }, inventory: {} }), true);
});

test('delay uses the virtual clock', () => {
  const g = graph({ t: ['on.event', { name: 'x' }], w: ['flow.delay', { seconds: 2 }], l: ['act.light', { group: 'main', action: 'off' }] }, [['t', 'out', 'w'], ['w', 'out', 'l']]);
  const r = rt(g);
  r.emit('x');
  assert.equal(effects(r, 'light').length, 0);
  r.advance(1.9); assert.equal(effects(r, 'light').length, 0);
  r.advance(0.2);
  assert.equal(effects(r, 'light').length, 1);
  assert.equal(effects(r, 'light')[0].t, 2);
});

test('"only the first time" blocks later runs; sequence runs outputs in order', () => {
  const g = graph({ t: ['on.event', { name: 'x' }], o: ['flow.once', {}], s: ['flow.sequence', {}], a: ['act.say', { text: 'A' }], b: ['act.say', { text: 'B' }] }, [['t', 'out', 'o'], ['o', 'out', 's'], ['s', '1', 'a'], ['s', '2', 'b']]);
  const r = rt(g);
  r.emit('x'); r.emit('x'); r.emit('x');
  assert.deepEqual(effects(r, 'say').map((e) => e.text), ['A', 'B']);
});

test('random picks only connected outputs and respects the rng', () => {
  const g = graph({ t: ['on.event', { name: 'x' }], r: ['flow.random', {}], a: ['act.say', { text: 'A' }], c: ['act.say', { text: 'C' }] }, [['t', 'out', 'r'], ['r', 'a', 'a'], ['r', 'c', 'c']]);
  const r = new EventRuntime({ [g.id]: g }, {}, { rng: () => 0.99 });
  r.emit('x'); assert.deepEqual(effects(r, 'say').map((e) => e.text), ['C']);
});

test('flag triggers fire when the flag takes the watched value', () => {
  const g = graph({ t: ['on.flag', { name: 'alarm', value: 'true' }], s: ['act.say', { text: 'ALARM' }] }, [['t', 'out', 's']]);
  const r = rt(g);
  r.setFlag('alarm', false); r.setFlag('alarm', true); r.setFlag('alarm', true);
  assert.equal(effects(r, 'say').length, 1);
});

test('events chain between graphs; counters and inventory update; timers repeat', () => {
  const g1 = graph({ t: ['on.event', { name: 'pickup:key' }], i: ['act.item', { item: 'key', action: 'give', count: 1 }], e: ['act.emit', { name: 'got-key' }] }, [['t', 'out', 'i'], ['i', 'out', 'e']], 'one');
  const g2 = graph({ t: ['on.event', { name: 'got-key' }], c: ['act.addVar', { name: 'keys', amount: 2 }] }, [['t', 'out', 'c']], 'two');
  const g3 = graph({ t: ['on.timer', { seconds: 5, max: 2 }], s: ['act.say', { text: 'tick' }] }, [['t', 'out', 's']], 'three');
  const r = rt(g1, g2, g3);
  r.start(); r.emit('pickup:key');
  assert.equal(r.state.inventory.key, 1); assert.equal(r.state.vars.keys, 2);
  r.advance(30);
  assert.equal(effects(r, 'say').filter((e) => e.text === 'tick').length, 2, 'timer limited to max 2');
});

test('a graph that re-emits its own trigger is stopped, logged, and does not hang', () => {
  const g = graph({ t: ['on.event', { name: 'loop' }], e: ['act.emit', { name: 'loop' }] }, [['t', 'out', 'e']]);
  const r = rt(g);
  r.emit('loop');
  assert.ok(r.errors.some((e) => /Event loop/.test(e)));
});

test('runaway flow inside one graph is cut off by the step budget', () => {
  const g = newGraph('cycle'); const a = newNode('on.event', 0, 0, { name: 'x' }), b = newNode('flow.once'), c = newNode('act.addVar', 0, 0, { name: 'n' });
  g.nodes.push(a, b, c);
  g.edges.push({ id: '1', from: { node: a.id, port: 'out' }, to: { node: c.id, port: 'in' } }, { id: '2', from: { node: c.id, port: 'out' }, to: { node: c.id, port: 'in' } });
  const r = new EventRuntime({ [g.id]: g }, {}, { maxSteps: 100 });
  r.emit('x');
  assert.ok(r.errors.some((e) => /ran more than 100 steps/.test(e)));
  assert.ok(r.state.vars.n <= 101);
});

test('adapter receives world effects', () => {
  const calls = [];
  const g = graph({ t: ['on.event', { name: 'x' }], d: ['act.door', { doorId: 'A', action: 'lock' }], s: ['act.spawn', { spawnId: 'Hollow 1' }] }, [['t', 'out', 'd'], ['d', 'out', 's']]);
  const r = new EventRuntime({ [g.id]: g }, { door: (id, a) => calls.push(['door', id, a]), spawn: (id) => calls.push(['spawn', id]) });
  r.emit('x');
  assert.deepEqual(calls, [['door', 'A', 'lock'], ['spawn', 'Hollow 1']]);
});

test('every node type has a runtime handler or is a trigger', () => {
  for (const [type, def] of Object.entries(EVENT_NODE_TYPES)) {
    if (type.startsWith('on.')) continue;
    const g = graph({ t: ['on.event', { name: 'x' }], n: [type, {}] }, [['t', 'out', 'n']]);
    const r = rt(g); r.emit('x');
    assert.deepEqual(r.errors, [], `${type} runs without “unknown node” errors`);
  }
});

test('static analysis: dangling references, unreachable nodes, loops, empty names', () => {
  const p = new Project('t');
  p.scene.insert(makeNode('door', { name: 'Door A', props: { doorId: 'A' } }));
  p.scene.insert(makeNode('light', { props: { powerGroup: 'hall' } }));
  const g = graph({
    t: ['on.event', { name: 'x' }], d1: ['act.door', { doorId: 'A', action: 'open' }], d2: ['act.door', { doorId: 'NOPE', action: 'open' }], l: ['act.light', { group: 'cellar', action: 'off' }],
    e: ['act.emit', { name: 'x' }], orphan: ['act.say', { text: 'never' }], s: ['act.sequence', { sequence: 'missing' }], emptyEv: ['on.event', { name: '' }],
  }, [['t', 'out', 'd1'], ['d1', 'out', 'd2'], ['d2', 'out', 'l'], ['l', 'out', 'e'], ['e', 'out', 's']]);
  p.data.events.graphs[g.id] = g;
  const codes = analyzeGraphs(p).issues.map((i) => i.code);
  for (const c of ['ref-door', 'ref-lightgroup', 'node-unreachable', 'event-loop', 'ref-sequence', 'node-empty']) assert.ok(codes.includes(c), `${c} detected (got ${codes})`);
  assert.equal(codes.filter((c) => c === 'ref-door').length, 1, 'door A exists, only NOPE is reported');
});

test('scene volumes and interactions contribute event names', () => {
  const p = new Project('t');
  p.scene.insert(makeNode('trigger', { name: 'Z', props: { onEnter: 'enter-z', onExit: 'exit-z' } }));
  p.scene.insert(makeNode('interaction', { name: 'I', props: { event: 'use-i' } }));
  p.scene.insert(makeNode('itemSpawn', { name: 'K', props: { item: 'key', event: 'pick-k' } }));
  const names = [...sceneEventNames(p).keys()].sort();
  assert.deepEqual(names, ['enter-z', 'exit-z', 'pick-k', 'use-i']);
});

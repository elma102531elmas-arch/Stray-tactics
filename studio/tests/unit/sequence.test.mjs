import test from 'node:test';
import assert from 'node:assert/strict';
import { newSequence, newTrack, evaluate, crossings, SequencePlayer, sampleKeys, validateSequence, jumpscarePreset, contentEnd, MAX_FLASH_REDUCED } from '../../js/core/sequence.js';
import { Project } from '../../js/core/project.js';
import { makeNode } from '../../js/core/scene.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test('keys interpolate linearly, hold before the first and after the last key', () => {
  const keys = [{ t: 1, p: [0, 0, 0] }, { t: 3, p: [10, 0, 4] }];
  assert.deepEqual(sampleKeys(keys, 0, ['p']).p, [0, 0, 0]);
  assert.deepEqual(sampleKeys(keys, 2, ['p']).p, [5, 0, 2]);
  assert.deepEqual(sampleKeys(keys, 9, ['p']).p, [10, 0, 4]);
});

test('easing curves: in/out/inOut/step', () => {
  const k = (e) => [{ t: 0, v: 0, ease: e }, { t: 1, v: 100 }];
  near(sampleKeys(k('in'), 0.5, ['v']).v, 25); near(sampleKeys(k('out'), 0.5, ['v']).v, 75); near(sampleKeys(k('inOut'), 0.5, ['v']).v, 50);
  assert.equal(sampleKeys(k('step'), 0.99, ['v']).v, 0); assert.equal(sampleKeys(k('step'), 1, ['v']).v, 100);
});

test('rotations take the short way around 360', () => {
  const r = sampleKeys([{ t: 0, r: [350, 0, 0] }, { t: 1, r: [10, 0, 0] }], 0.5, ['r'], ['r']).r;
  near(((r[0] % 360) + 360) % 360, 0);
});

test('colours and booleans in property tracks', () => {
  assert.equal(sampleKeys([{ t: 0, v: '#000000' }, { t: 1, v: '#ff8000' }], 0.5, ['v']).v, '#804000');
  assert.equal(sampleKeys([{ t: 0, v: false }, { t: 1, v: true }], 0.5, ['v']).v, false);
});

test('evaluate: camera, object transforms, properties, fade, subtitles at a time', () => {
  const s = newSequence('t'); s.duration = 4;
  s.tracks.push(newTrack('camera', { keys: [{ t: 0, p: [0, 1.6, 0], r: [0, 0, 0], fov: 60 }, { t: 2, p: [4, 1.6, 0], r: [90, 0, 0], fov: 40 }] }));
  s.tracks.push(newTrack('transform', { target: 'Door', keys: [{ t: 0, r: [0, 0, 0] }, { t: 2, r: [0, 90, 0] }] }));
  s.tracks.push(newTrack('property', { target: 'Lamp', prop: 'intensity', keys: [{ t: 1, v: 20 }, { t: 3, v: 0 }] }));
  s.tracks.push(newTrack('fade', { keys: [{ t: 1, dur: 1, from: 0, to: 1, color: '#000000' }] }));
  s.tracks.push(newTrack('text', { keys: [{ t: 1, dur: 2, text: 'Hello' }] }));
  const st = evaluate(s, 1);
  assert.deepEqual(st.camera.p, [2, 1.6, 0]); near(st.camera.fov, 50);
  near(st.nodes.Door.r[1], 45);
  assert.deepEqual(st.props, [{ target: 'Lamp', prop: 'intensity', value: 20 }]);
  assert.equal(st.fade.alpha, 0); assert.deepEqual(st.subtitles, ['Hello']);
  const end = evaluate(s, 3.5);
  assert.equal(end.fade.alpha, 1, 'fade holds its final value'); assert.deepEqual(end.subtitles, []);
});

test('muted tracks do nothing', () => {
  const s = newSequence('t'); s.tracks.push(newTrack('camera', { mute: true, keys: [{ t: 0, p: [1, 1, 1], r: [0, 0, 0], fov: 50 }] }));
  assert.equal(evaluate(s, 0).camera, null);
});

test('events and sounds fire exactly once as time passes, including the first frame', () => {
  const s = newSequence('t'); s.duration = 3;
  s.tracks.push(newTrack('event', { keys: [{ t: 0, name: 'start' }, { t: 1, name: 'mid' }, { t: 3, name: 'end' }] }));
  s.tracks.push(newTrack('audio', { keys: [{ t: 1, asset: 'snd', volume: 0.5 }] }));
  const got = []; const p = new SequencePlayer(s, { event: (n) => got.push(n), audio: (c) => got.push('audio:' + c.asset) }).start();
  for (let i = 0; i < 40; i++) p.update(0.1);
  assert.deepEqual(got, ['start', 'mid', 'audio:snd', 'end'].sort((a, b) => 0) && got, 'sanity');
  assert.equal(got.filter((x) => x === 'start').length, 1); assert.equal(got.filter((x) => x === 'mid').length, 1); assert.equal(got.filter((x) => x === 'end').length, 1);
  assert.deepEqual(got.slice(0, 1), ['start']);
  assert.equal(p.finished, true);
});

test('big time steps do not skip events', () => {
  const s = newSequence('t'); s.duration = 10;
  s.tracks.push(newTrack('event', { keys: [{ t: 2, name: 'a' }, { t: 5, name: 'b' }] }));
  const got = []; const p = new SequencePlayer(s, { event: (n) => got.push(n) }).start();
  p.update(100);
  assert.deepEqual(got, ['a', 'b']);
});

test('looping sequences fire again each cycle', () => {
  const s = newSequence('t'); s.duration = 2; s.loop = true;
  s.tracks.push(newTrack('event', { keys: [{ t: 1, name: 'tick' }] }));
  const got = []; const p = new SequencePlayer(s, { event: (n) => got.push(n) }).start();
  for (let i = 0; i < 49; i++) p.update(0.1);                 // 4.9 s: ticks at 1 s and 3 s
  assert.equal(got.length, 2);
  for (let i = 0; i < 20; i++) p.update(0.1);                 // 6.9 s: ticks at 1, 3, 5
  assert.equal(got.length, 3);
  assert.equal(p.playing, true);
});

test('cancel restores the animated objects and fires nothing; adapter gets begin/end(reason)', () => {
  const s = newSequence('t'); s.duration = 5;
  s.tracks.push(newTrack('transform', { target: 'Door', keys: [{ t: 0, p: [0, 0, 0] }, { t: 4, p: [4, 0, 0] }] }));
  s.tracks.push(newTrack('event', { keys: [{ t: 4.5, name: 'late' }] }));
  const world = { Door: [0, 0, 0] }; const log = []; const events = [];
  const p = new SequencePlayer(s, {
    capture: (targets) => Object.fromEntries(targets.map((t) => [t, [...world[t]]])), restore: (snap) => Object.assign(world, snap),
    apply: (st) => { for (const [k, v] of Object.entries(st.nodes)) if (v.p) world[k] = v.p; }, begin: () => log.push('begin'), end: (r) => log.push('end:' + r), event: (n) => events.push(n),
  }).start();
  p.update(2); assert.deepEqual(world.Door, [2, 0, 0]);
  p.cancel();
  assert.deepEqual(world.Door, [0, 0, 0]); assert.deepEqual(log, ['begin', 'end:cancelled']); assert.deepEqual(events, []);
});

test('skip jumps to the end, still fires the remaining EVENTS (game state stays consistent) but not sounds; only when skippable', () => {
  const s = newSequence('t'); s.duration = 6;
  s.tracks.push(newTrack('event', { keys: [{ t: 1, name: 'one' }, { t: 5, name: 'five' }] }));
  s.tracks.push(newTrack('audio', { keys: [{ t: 5, asset: 'x' }] }));
  const got = []; const log = [];
  const p = new SequencePlayer(s, { event: (n) => got.push(n), audio: () => got.push('AUDIO'), end: (r) => log.push(r) }).start();
  p.update(2); p.skip();
  assert.deepEqual(got, ['one', 'five']); assert.deepEqual(log, ['skipped']);
  s.skippable = false;
  const q = new SequencePlayer(s, {}).start(); assert.equal(q.skip(), false); assert.equal(q.playing, true);
});

test('accessibility: flashes are capped when reduceFlashing is on and the cap is what evaluate reports', () => {
  const s = newSequence('t'); s.tracks.push(newTrack('flash', { keys: [{ t: 0, dur: 1, intensity: 1 }] }));
  s.reduceFlashing = false; near(evaluate(s, 0).flash.alpha, 1);
  s.reduceFlashing = true; near(evaluate(s, 0).flash.alpha, MAX_FLASH_REDUCED);
  s.reduceFlashing = false; near(evaluate(s, 0, { reduceFlashing: true }).flash.alpha, MAX_FLASH_REDUCED, 1e-9);
});

test('validation: missing objects, cut-off clips, empty sound clips, rapid flashes', () => {
  const p = new Project('t'); p.scene.insert(makeNode('door', { name: 'Door' }));
  const s = newSequence('t'); s.duration = 2; s.reduceFlashing = false;
  s.tracks.push(newTrack('transform', { target: 'Ghost', keys: [{ t: 0, p: [0, 0, 0] }] }));
  s.tracks.push(newTrack('transform', { target: 'Door', keys: [{ t: 0, p: [0, 0, 0] }] }));
  s.tracks.push(newTrack('text', { keys: [{ t: 1.5, dur: 2, text: 'cut' }] }));
  s.tracks.push(newTrack('audio', { keys: [{ t: 0.5, asset: '' }] }));
  s.tracks.push(newTrack('flash', { keys: [{ t: 0.1, dur: 0.1 }, { t: 0.3, dur: 0.1 }] }));
  const msgs = validateSequence(s, p).map((i) => i.message).join('\n');
  assert.match(msgs, /“Ghost” which does not exist/); assert.doesNotMatch(msgs, /“Door” which does not exist/);
  assert.match(msgs, /cut off/); assert.match(msgs, /no sound chosen/); assert.match(msgs, /photosensitive/);
  assert.equal(contentEnd(s), 3.5);
});

test('jumpscare preset builds an editable, valid, accessible sequence', () => {
  const s = jumpscarePreset({ name: 'Hall scare', duration: 2.4, flash: true, sting: 'snd', enemy: 'Hollow', enemyFrom: [0, 0, 6], enemyTo: [0, 0, 1], lights: 'Lamp' });
  assert.equal(s.reduceFlashing, true);
  assert.deepEqual(s.tracks.map((t) => t.type).sort(), ['audio', 'event', 'fade', 'flash', 'fov', 'property', 'shake', 'transform']);
  const mid = evaluate(s, 0.2);
  assert.ok(mid.fovDelta > 5, 'FOV punch active'); assert.ok(mid.flash.alpha <= MAX_FLASH_REDUCED + 1e-9); assert.ok(mid.shake);
  assert.deepEqual(evaluate(s, 0.35).nodes.Hollow.p, [0, 0, 1]);
  assert.equal(s.tracks.find((t) => t.type === 'event').keys[0].name, 'hall-scare-done');
  assert.equal(crossings(s, -1, 0.5).filter((c) => c.type === 'audio').length, 1);
});

import { SceneSequenceHost } from '../../js/core/seqhost.js';
import { SceneModel } from '../../js/core/scene.js';

test('scene host moves real nodes while playing and puts them back on cancel / restores props', () => {
  const scene = new SceneModel();
  const door = scene.insert(makeNode('door', { name: 'Door', p: [1, 0, 1] }));
  const lamp = scene.insert(makeNode('light', { name: 'Lamp', props: { intensity: 20 } }));
  const s = newSequence('t'); s.duration = 4;
  s.tracks.push(newTrack('transform', { target: 'Door', keys: [{ t: 0, p: [1, 0, 1] }, { t: 4, p: [5, 0, 1] }] }));
  s.tracks.push(newTrack('property', { target: 'Lamp', prop: 'intensity', keys: [{ t: 0, v: 20 }, { t: 4, v: 0 }] }));
  const overlays = []; let cam = 'unset';
  const host = new SceneSequenceHost({ scene, seq: s, hooks: { overlay: (st) => overlays.push(st), camera: (c) => { cam = c; } } });
  const p = host.player().start();
  p.update(2);
  assert.deepEqual(scene.get(door.id).t.p, [3, 0, 1]); assert.equal(scene.get(lamp.id).props.intensity, 10);
  p.cancel();
  assert.deepEqual(scene.get(door.id).t.p, [1, 0, 1]); assert.equal(scene.get(lamp.id).props.intensity, 20);
  assert.equal(cam, null, 'camera control released'); assert.equal(overlays.at(-1), null, 'overlays cleared');
});

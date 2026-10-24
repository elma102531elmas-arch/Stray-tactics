import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../lib/three.module.js';
import { Project } from '../../js/core/project.js';
import { makeNode } from '../../js/core/scene.js';
import { CollisionWorld } from '../../js/core/collision.js';
import { validateProject } from '../../js/core/validate.js';
import { referencedAssets } from '../../js/core/project.js';
import * as A from '../../js/core/audio.js';
import { PlaytestWorld } from '../../js/core/playtest.js';
import { newGraph, newNode } from '../../js/core/events.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

/** A floor, a wall at z=-5 across the path and some audio objects. */
function map(fn) {
  const p = new Project('audio'); const S = p.scene;
  S.insert(makeNode('floor', { props: { w: 60, d: 60, surface: 'tile' } }));
  fn?.(p, S);
  p.data.assets.snd1 = { id: 'snd1', name: 'hum', kind: 'audio', duration: 2 };
  p.data.assets.snd2 = { id: 'snd2', name: 'step', kind: 'audio', duration: 0.3 };
  p.data.assets.img1 = { id: 'img1', name: 'pic', kind: 'image' };
  return p;
}
const world = (p) => new CollisionWorld(A.collectAudio(p).colliders);

test('distance models follow the Web Audio formulas', () => {
  // inverse: ref / (ref + rolloff * (d - ref)); linear: 1 - rolloff*(d-ref)/(max-ref); exponential: (d/ref)^-rolloff
  near(A.distanceGain('inverse', 2, 2, 30, 1.2), 1);
  near(A.distanceGain('inverse', 12, 2, 30, 1), 2 / (2 + 10));
  near(A.distanceGain('linear', 16, 2, 30, 1), 1 - 14 / 28);
  near(A.distanceGain('exponential', 8, 2, 30, 1.5), 4 ** -1.5);
  near(A.distanceGain('inverse', 0.5, 2, 30, 1), 1, 1e-9);           // closer than the reference distance never gets louder
  assert.equal(A.distanceGain('linear', 100, 2, 30, 1), 0);
});

test('sourceGain is silent beyond max distance and fades over the last 10 % (no click)', () => {
  const props = { refDistance: 2, maxDistance: 30, rolloff: 1.2, distanceModel: 'inverse' };
  assert.equal(A.sourceGain(props, 30.01), 0);
  const at27 = A.sourceGain(props, 27), at29 = A.sourceGain(props, 29), at30 = A.sourceGain(props, 30);
  near(at27, A.distanceGain('inverse', 27, 2, 30, 1.2));              // fade starts at 27 m
  assert.ok(at29 < at27 && at30 < 1e-9 && at30 >= 0, `${at27} > ${at29} > ${at30}`);
  assert.ok(A.sourceGain(props, 2) > A.sourceGain(props, 10) && A.sourceGain(props, 10) > A.sourceGain(props, 25), 'monotonic');
});

test('walls and closed doors between listener and source muffle it step by step; an open door does not', () => {
  const p = map((_, S) => {
    S.insert(makeNode('wall', { name: 'W1', p: [0, 0, -5], props: { length: 20, height: 3 } }));
    S.insert(makeNode('wall', { name: 'W2', p: [0, 0, -8], props: { length: 20, height: 3 } }));
    S.insert(makeNode('door', { name: 'Door', p: [10, 0, -5], props: { doorId: 'D', thick: 0.2 } }));
    S.insert(makeNode('wall', { name: 'W3', p: [10, 0, -5], props: { length: 4, height: 3 } }));
  });
  const w = world(p);
  const from = V(0, 1.6, 0);
  assert.equal(A.occlusion(w, from, V(0, 1.6, -3)).blockers, 0);
  const one = A.occlusion(w, from, V(0, 1.6, -6.5));
  assert.equal(one.blockers, 1); assert.deepEqual([one.gain, one.cutoff], [A.OCCLUSION_STEPS[1].gain, A.OCCLUSION_STEPS[1].cutoff]);
  const two = A.occlusion(w, from, V(0, 1.6, -10));
  assert.equal(two.blockers, 2); assert.ok(two.gain < one.gain && two.cutoff < one.cutoff);
  // through the door: closed blocks, open lets sound through
  const closed = A.occlusion(w, V(10, 1.6, 0), V(10, 1.6, -9));
  assert.ok(closed.blockers >= 1, 'the closed door/wall blocks');
  w.doorOpen.set('D', true);
  assert.ok(A.occlusion(w, V(10, 1.6, 0), V(10, 1.6, -9)).blockers < closed.blockers, 'open door blocks less');
});

test('hearSource combines distance, occlusion, volume, bus level and master; reports why a source is silent', () => {
  const p = map((_, S) => {
    S.insert(makeNode('audioSource', { name: 'Hum', p: [0, 1, -10], props: { asset: 'snd1', volume: 0.8, bus: 'ambience' } }));
    S.insert(makeNode('wall', { name: 'W', p: [0, 0, -5], props: { length: 20, height: 3 } }));
    S.insert(makeNode('audioSource', { name: 'Empty', p: [0, 1, -2], props: { asset: '' } }));
  });
  const audio = A.collectAudio(p), w = new CollisionWorld(audio.colliders), s = A.audioSettings(p.data);
  const L = V(0, 1.6, 0);
  const hum = audio.sources.find((x) => x.name === 'Hum');
  const h = A.hearSource(hum, L, w, s);
  near(h.distance, Math.hypot(0.6, 10), 1e-6);
  assert.equal(h.blockers, 1);
  near(h.final, A.sourceGain(hum.props, h.distance) * 0.5 * 0.8, 1e-9);
  assert.equal(h.state, 'audible');
  // bus controls
  s.buses.ambience = 0.5; near(A.hearSource(hum, L, w, s).final, h.final * 0.5, 1e-9);
  s.mute.ambience = true; assert.equal(A.hearSource(hum, L, w, s).state, 'bus muted');
  s.mute.ambience = false; s.solo = 'sfx'; assert.equal(A.hearSource(hum, L, w, s).final, 0, 'solo on another bus silences this one');
  s.solo = ''; s.master = 0.5; near(A.hearSource(hum, L, w, s).final, h.final * 0.5 * 0.5, 1e-9);
  assert.equal(A.hearSource(audio.sources.find((x) => x.name === 'Empty'), L, w, A.audioSettings(p.data)).state, 'no sound');
  assert.equal(A.hearSource(hum, V(0, 1.6, 60), w, A.audioSettings(p.data)).state, 'out of range');
});

test('audio settings are normalised: old projects, bad numbers, unknown buses', () => {
  const s = A.audioSettings({ audio: { buses: { sfx: 0.5, music: 'loud', bogus: 3 }, mute: { voice: 1 }, solo: 'nope', footsteps: { wood: ['a', 3, ''], metal: 'x' } } });
  assert.deepEqual(s.buses, { sfx: 0.5, ambience: 1, music: 1, voice: 1 });
  assert.equal(s.mute.voice, true); assert.equal(s.solo, ''); assert.deepEqual(s.footsteps, { wood: ['a'] });
  assert.deepEqual(A.busLevels(s), { sfx: 0.5, ambience: 1, music: 1, voice: 0 });
  assert.equal(A.audioSettings(undefined).master, 1);
  assert.equal(A.busLevels({ ...s, solo: 'music' }).sfx, 0);
});

test('zones: priority wins, ties go to the smaller volume; muffle and reverb come from the winning zones', () => {
  const p = map((_, S) => {
    S.insert(makeNode('audioZone', { name: 'Big', p: [0, 1.5, 0], props: { size: [20, 3, 20], kind: 'ambience', asset: 'snd1', reverb: 'hall', priority: 0 } }));
    S.insert(makeNode('audioZone', { name: 'Small', p: [0, 1.5, 0], props: { size: [4, 3, 4], kind: 'ambience', asset: 'snd2', reverb: 'basement', priority: 0, muffle: 800 } }));
    S.insert(makeNode('audioZone', { name: 'Music', p: [30, 1.5, 0], props: { size: [10, 3, 10], kind: 'music', asset: 'snd1', reverb: 'chapel', priority: 2 } }));
    S.insert(makeNode('audioZone', { name: 'Loud', p: [0, 1.5, 0], props: { size: [10, 3, 10], kind: 'ambience', asset: 'snd2', reverb: 'room', priority: 5 } }));
  });
  const a = A.collectAudio(p);
  let z = A.zonesAt(a.zones, V(0, 1, 0));
  assert.equal(z.inside.length, 3);
  assert.equal(z.ambience.name, 'Loud', 'highest priority wins');
  assert.equal(A.reverbAt(p, z), 'room');
  z = A.zonesAt(a.zones, V(1.5, 1, 1.5));
  assert.equal(z.muffle.name, 'Small');
  z = A.zonesAt(a.zones, V(8, 1, 0));                                  // inside Big only (Loud is 10 wide = ±5)
  assert.equal(z.ambience.name, 'Big'); assert.equal(A.reverbAt(p, z), 'hall');
  z = A.zonesAt(a.zones, V(30, 1, 0));
  assert.equal(z.music.name, 'Music'); assert.equal(z.ambience, null);
  z = A.zonesAt(a.zones, V(-40, 1, 0));
  assert.equal(z.inside.length, 0); assert.equal(A.reverbAt(p, z), p.data.environment.reverb, 'outside every zone the environment reverb applies');
  // tie → smaller volume
  p.scene.find((n) => n.name === 'Loud')[0].props.priority = 0;
  const a2 = A.collectAudio(p);
  assert.equal(A.zonesAt(a2.zones, V(0.5, 1, 0.5)).ambience.name, 'Small');
});

test('footstep surface: zone > floor property > material > default; mapped sounds never repeat back to back', () => {
  const p = map((_, S) => {
    S.insert(makeNode('floor', { name: 'Wood', p: [100, 0, 0], props: { w: 20, d: 20, surface: 'wood' } }));
    S.insert(makeNode('floor', { name: 'Mat', p: [200, 0, 0], props: { w: 20, d: 20, surface: '', material: 'mat_metal' } }));
    S.insert(makeNode('footstepZone', { name: 'Puddle', p: [0, 1, 0], props: { size: [4, 2, 4], surface: 'water' } }));
  });
  const a = A.collectAudio(p), w = new CollisionWorld(a.colliders);
  assert.equal(A.surfaceAt(p, a, w, V(10, 0, 10)).surface, 'tile');
  assert.equal(A.surfaceAt(p, a, w, V(100, 0, 0)).surface, 'wood');
  assert.equal(A.surfaceAt(p, a, w, V(200, 0, 0)).surface, 'metal');
  const z = A.surfaceAt(p, a, w, V(0, 0, 0)); assert.equal(z.surface, 'water'); assert.match(z.from, /Puddle/);
  assert.equal(A.surfaceAt(p, a, w, V(500, 0, 0)).surface, 'concrete', 'nothing below: documented default');
  const s = A.audioSettings({ audio: { footsteps: { wood: ['a', 'b', 'c'], tile: ['only'] } } });
  let last = null; const seen = new Set();
  for (let i = 0; i < 60; i++) { const id = A.pickFootstep(s, 'wood', Math.random, last); assert.notEqual(id, last); last = id; seen.add(id); }
  assert.equal(seen.size, 3);
  assert.equal(A.pickFootstep(s, 'tile', Math.random, 'only'), 'only'); assert.equal(A.pickFootstep(s, 'gravel'), null);
});

test('reverb impulses: deterministic, predelay silence, 60 dB decay at RT60, longer RT60 = longer tail, damping darkens', () => {
  const sr = 8000;
  const p = A.reverbParams(null, 'hall'); assert.deepEqual(p, A.REVERB_PRESETS.hall);
  assert.deepEqual(A.reverbParams({ reverbs: { hall: { decay: 3, wet: 5 } } }, 'hall'), { ...A.REVERB_PRESETS.hall, decay: 3, wet: 1 }, 'overrides are clamped');
  const ir = A.impulseResponse({ decay: 1, predelay: 0.05, wet: 0.3, damp: 20000 }, sr, 7), again = A.impulseResponse({ decay: 1, predelay: 0.05, wet: 0.3, damp: 20000 }, sr, 7);
  assert.deepEqual(ir.channels[0], again.channels[0]); assert.notDeepEqual(ir.channels[0], ir.channels[1], 'left and right differ');
  const pre = 0.05 * sr;
  assert.ok(ir.channels[0].subarray(0, pre).every((v) => v === 0), 'silent during the predelay');
  const rms = (a, from, to) => Math.sqrt(a.subarray(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  const start = rms(ir.channels[0], pre, pre + 400), end = rms(ir.channels[0], pre + sr - 400, pre + sr);
  const db = 20 * Math.log10(end / start);
  assert.ok(db < -50 && db > -70, `~60 dB down after RT60 (got ${db.toFixed(1)} dB)`);
  assert.ok(A.impulseResponse({ decay: 3, predelay: 0, wet: 0.3, damp: 20000 }, sr, 7).length > ir.length);
  const dark = A.impulseResponse({ decay: 1, predelay: 0, wet: 0.3, damp: 300 }, sr, 7), bright = A.impulseResponse({ decay: 1, predelay: 0, wet: 0.3, damp: 20000 }, sr, 7);
  const roughness = (a) => { let s = 0; for (let i = 1; i < 4000; i++) s += Math.abs(a[i] - a[i - 1]); return s / rms(a, 0, 4000); };
  assert.ok(roughness(dark.channels[0]) < roughness(bright.channels[0]) * 0.6, 'a low damping frequency gives a smoother (darker) tail');
  assert.equal(A.impulseResponse(A.REVERB_PRESETS.none, sr).length, 1, 'preset none = no impulse');
});

test('sound analysis: peak, RMS, clipping and silence at both ends; waveform peaks per column', () => {
  const sr = 1000, n = 1000, ch = new Float32Array(n);
  for (let i = 200; i < 700; i++) ch[i] = 0.5 * Math.sin(i / 5);
  const a = A.analyzeSamples([ch], sr);
  near(a.peak, 0.5, 0.01); near(a.duration, 1); near(a.leadingSilence, 0.2, 0.01); near(a.trailingSilence, 0.3, 0.01); assert.equal(a.clipped, 0);
  near(a.peakDb, 20 * Math.log10(a.peak), 1e-9);
  const hot = new Float32Array(100).fill(1); hot[0] = 0;
  assert.equal(A.analyzeSamples([hot], 100).clipped, 99);
  const quiet = A.analyzeSamples([new Float32Array(50)], 50); assert.equal(quiet.silent, true); assert.equal(quiet.peakDb, -Infinity);
  const peaks = A.waveformPeaks([ch], 10);
  assert.equal(peaks.length, 20);
  assert.equal(peaks[0], 0); assert.equal(peaks[1], 0);               // first column is silent
  assert.ok(peaks[2 * 4 + 1] > 0.3 && peaks[2 * 4] < -0.3, 'a column inside the tone has both signs');
});

test('validation: missing / wrong / unmapped audio is reported with the nodes involved; healthy audio is quiet', () => {
  const p = map((_, S) => {
    S.insert(makeNode('audioSource', { name: 'None', p: [0, 1, 0], props: { asset: '' } }));
    S.insert(makeNode('audioSource', { name: 'Gone', p: [1, 1, 0], props: { asset: 'nope' } }));
    S.insert(makeNode('audioSource', { name: 'Pic', p: [2, 1, 0], props: { asset: 'img1' } }));
    S.insert(makeNode('audioSource', { name: 'Range', p: [3, 1, 0], props: { asset: 'snd1', refDistance: 5, maxDistance: 5 } }));
    S.insert(makeNode('audioSource', { name: 'Never', p: [4, 1, 0], props: { asset: 'snd1', autoplay: false, playOnEvent: '' } }));
    S.insert(makeNode('audioSource', { name: 'OK', p: [5, 1, 0], props: { asset: 'snd1' } }));
    S.insert(makeNode('footstepZone', { name: 'Gravel', p: [0, 1, 6], props: { size: [3, 2, 3], surface: 'gravel' } }));
    S.insert(makeNode('audioZone', { name: 'Z1', p: [0, 1.5, 20], props: { size: [6, 3, 6], kind: 'ambience', asset: 'snd1' } }));
    S.insert(makeNode('audioZone', { name: 'Z2', p: [1, 1.5, 20], props: { size: [6, 3, 6], kind: 'ambience', asset: 'snd2' } }));
    S.insert(makeNode('audioZone', { name: 'Silent', p: [30, 1.5, 20], props: { size: [4, 3, 4], kind: 'music', asset: '' } }));
  });
  p.data.audio = { ...A.defaultAudioData(), solo: 'music', footsteps: { wood: ['ghost'] } };
  const issues = A.analyzeAudio(p);
  const byCode = (c) => issues.filter((i) => i.code === c);
  const name = (i) => p.scene.get(i.nodes[0])?.name;
  assert.deepEqual(byCode('audio-no-asset').map(name).sort(), ['None', 'Silent']);
  assert.deepEqual(byCode('audio-missing-asset').map((i) => name(i) || i.message.match(/"(\w+)"/)[1]).sort(), ['Gone', 'ghost']);
  assert.deepEqual(byCode('audio-wrong-kind').map(name), ['Pic']);
  assert.deepEqual(byCode('audio-range').map(name), ['Range']);
  assert.deepEqual(byCode('audio-never-plays').map(name), ['Never']);
  assert.deepEqual(byCode('audio-footstep-unmapped').map(name), ['Gravel']);
  assert.equal(byCode('audio-zone-tie').length, 1); assert.deepEqual(byCode('audio-zone-tie')[0].nodes.map((id) => p.scene.get(id).name).sort(), ['Z1', 'Z2']);
  assert.equal(byCode('audio-solo').length, 1);
  assert.ok(!issues.some((i) => i.nodes.length === 1 && name(i) === 'OK'), 'a healthy source has no issues');
  // the same issues come out of the project validator, in its own "audio" check
  const v = validateProject(p, { only: ['audio'] });
  assert.equal(v.issues.length, issues.length);
});

test('footstep sounds are asset references (bundles keep them, unused-asset reports know them)', () => {
  const p = map();
  p.data.audio = { ...A.defaultAudioData(), footsteps: { wood: ['snd2'], tile: ['snd1', 'snd2'] } };
  const refs = referencedAssets(p);
  assert.deepEqual(refs.get('snd2').sort(), ['audio footsteps.tile', 'audio footsteps.wood']);
  assert.deepEqual(refs.get('snd1'), ['audio footsteps.tile']);
});

test('playtest world: footsteps follow the surface and mapping, zones set ambience + reverb, events and "play sound" reach the audio queue', () => {
  const p = map((_, S) => {
    S.insert(makeNode('floor', { name: 'Wood', p: [0, 0.02, 0], props: { w: 10, d: 40, surface: 'wood' } }));
    S.insert(makeNode('playerSpawn', { p: [0, 0, 10] }));
    S.insert(makeNode('audioZone', { name: 'Cellar', p: [0, 1.5, 0], props: { size: [10, 3, 10], kind: 'ambience', asset: 'snd1', reverb: 'basement', priority: 1 } }));
  });
  p.data.audio = { ...A.defaultAudioData(), footsteps: { wood: ['snd2'], tile: ['snd1'] } };
  const g = newGraph('g'); const a = newNode('on.event', 0, 0, { name: 'go' }), b = newNode('act.sound', 0, 0, { asset: 'snd1', volume: 0.5 });
  g.nodes.push(a, b); g.edges.push({ id: 'e', from: { node: a.id, port: 'out' }, to: { node: b.id, port: 'in' } }); p.data.events.graphs[g.id] = g;
  const before = JSON.stringify(p.scene.toJSON());
  const w = new PlaytestWorld(p);
  assert.equal(w.audioZones.ambience, null); assert.equal(w.reverbPreset, p.data.environment.reverb);
  for (let i = 0; i < 60 * 4; i++) w.step(1 / 60, { my: 1 });                       // walk ~6 m north: 10 → 4
  assert.ok(w.footstepLog.length >= 3, `steps taken: ${w.footstepLog.length}`);
  assert.ok(w.footstepLog.every((e) => e.surface === 'wood' && e.sound === 'snd2' && e.kind === 'walk'), JSON.stringify(w.footstepLog[0]));
  assert.ok(w.footstepLog.at(-1).t > w.footstepLog[0].t);
  assert.equal(w.audioZones.ambience?.name, 'Cellar', 'inside the zone after walking in'); assert.equal(w.reverbPreset, 'basement');
  const stride = (sprint) => { const q = new PlaytestWorld(p); for (let i = 0; i < 60 * 3; i++) q.step(1 / 60, { my: 1, sprint }); return q.player.z === undefined ? 0 : q.footstepLog.length / Math.abs(10 - q.player.z); };
  assert.ok(stride(true) < stride(false), 'sprinting takes longer strides (fewer steps per metre)');
  w.audioEvents.length = 0;
  w.runtime.emit('go');
  assert.deepEqual(w.audioEvents.map((e) => e.type), ['event', 'sound']);
  assert.equal(w.audioEvents[1].asset, 'snd1'); assert.equal(w.audioEvents[1].volume, 0.5);
  w.player.z = -30; w.step(1 / 60, {});
  assert.equal(w.audioZones.ambience, null); assert.equal(w.reverbPreset, p.data.environment.reverb, 'back to the map default outside every zone');
  assert.equal(JSON.stringify(p.scene.toJSON()), before, 'the scene model is untouched by all of this');
});

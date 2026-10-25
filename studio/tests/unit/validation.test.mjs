import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../../js/core/project.js';
import { makeNode } from '../../js/core/scene.js';
import { History } from '../../js/core/history.js';
import { validateProject } from '../../js/core/validate.js';
import { fixCommand } from '../../js/core/fixes.js';

const codes = (p, only) => validateProject(p, only ? { only } : {}).issues.map((i) => i.code);
const room = () => {
  const p = new Project('t');
  p.scene.insert(makeNode('floor', { props: { w: 10, d: 10 } }));
  p.scene.insert(makeNode('playerSpawn', { p: [0, 0, 0] }));
  return p;
};

test('a clean map has no errors or warnings', () => {
  const p = room();
  p.scene.insert(makeNode('wall', { name: 'W1', p: [0, 0, -4], props: { length: 8 } }));
  const r = validateProject(p);
  assert.equal(r.counts.error, 0, JSON.stringify(r.issues));
  assert.equal(r.counts.warn, 0, JSON.stringify(r.issues));
});

test('wall gap: two walls that almost meet are reported and the fix closes the gap', () => {
  const p = room();
  p.scene.insert(makeNode('wall', { name: 'A', p: [0, 0, 0], props: { length: 4 } }));
  p.scene.insert(makeNode('wall', { name: 'B', p: [4.3, 0, 0], props: { length: 4, thick: 0.2 } }));       // A ends at x=2, B starts at x=2.3: a big opening, not a crack
  assert.ok(!codes(p, ['wallGaps']).includes('wall-gap'));
  p.scene.setTransform(p.scene.byName('B').id, { p: [4.1, 0, 0] });                                         // B starts at x=2.1 -> 0.1 m crack
  const issues = validateProject(p, { only: ['wallGaps'] }).issues.filter((i) => i.code === 'wall-gap');
  assert.ok(issues.length >= 1, 'gap reported');
  const h = new History(p.ctx);
  h.exec(fixCommand(p, issues.find((i) => i.fix).fix));
  assert.ok(!codes(p, ['wallGaps']).includes('wall-gap'), 'gap closed after fix');
  h.undo();
  assert.ok(codes(p, ['wallGaps']).includes('wall-gap'), 'undo restores the gap');
});

test('overlapping doors, misaligned and duplicate door ids', () => {
  const p = room();
  p.scene.insert(makeNode('wall', { name: 'W', p: [0, 0, 3], props: { length: 8 } }));
  p.scene.insert(makeNode('door', { name: 'D1', p: [-1, 0, 3] })); p.scene.insert(makeNode('door', { name: 'D2', p: [-1.4, 0, 3] }));
  assert.ok(codes(p, ['overlappingOpenings']).includes('overlapping-openings'));
  const q = room();
  q.scene.insert(makeNode('door', { name: 'Same', p: [1, 0, 3] })); q.scene.insert(makeNode('door', { name: 'Other', p: [5, 0, 3], props: { doorId: 'Same' } }));
  assert.ok(codes(q).includes('duplicate-door-id'));
});

test('floating and buried objects', () => {
  const p = room();
  p.scene.insert(makeNode('box', { name: 'Crate', p: [0, 0.8, 3] }));
  assert.ok(codes(p, ['floating']).some((c) => c.startsWith('floating')));
  const q = room();
  q.scene.insert(makeNode('box', { name: 'Crate', p: [0, 0, 3] }));
  assert.ok(!codes(q, ['floating']).some((c) => c.startsWith('floating')));
});

test('interaction placed too high is an error and the fix lowers it', () => {
  const p = room();
  const n = p.scene.insert(makeNode('interaction', { name: 'Fuse', p: [3, 2.9, 3], props: { event: 'x' } }));
  const issue = validateProject(p, { only: ['interactions'] }).issues.find((i) => i.code === 'interaction-out-of-reach');
  assert.ok(issue, 'reported'); assert.equal(issue.severity, 'error');
  new History(p.ctx).exec(fixCommand(p, issue.fix));
  assert.ok(Math.abs(p.scene.get(n.id).t.p[1] - 1.3) < 0.05);
  assert.ok(!codes(p, ['interactions']).includes('interaction-out-of-reach'));
});

test('decals: floating in mid-air is reported, one on a wall is fine', () => {
  const p = room();
  p.scene.insert(makeNode('wall', { p: [0, 0, 4], props: { length: 6 } }));
  p.scene.insert(makeNode('decal', { name: 'Good', p: [0, 1.5, 3.89], r: [0, 180, 0] }));
  p.scene.insert(makeNode('decal', { name: 'Bad', p: [0, 1.5, -2] }));
  const bad = validateProject(p, { only: ['decals'] }).issues;
  assert.ok(bad.some((i) => i.code === 'decal-floating' && p.scene.get(i.nodes[0]).name === 'Bad'));
  assert.ok(!bad.some((i) => p.scene.get(i.nodes[0]).name === 'Good'), JSON.stringify(bad));
});

test('missing references: assets, materials and no-asset models', () => {
  const p = room();
  p.scene.insert(makeNode('model', { name: 'Ghost', props: { asset: 'user_missing' } }));
  p.scene.insert(makeNode('model', { name: 'Empty' }));
  p.scene.insert(makeNode('box', { name: 'Odd', props: { material: 'oops' } }));
  const c = codes(p, ['references']);
  assert.ok(c.includes('missing-asset')); assert.ok(c.includes('model-no-asset')); assert.ok(c.includes('missing-material'));
});

test('reachability: walled-off spawn area vs an enclosed pocket', () => {
  const p = new Project('t');
  p.scene.insert(makeNode('floor', { props: { w: 20, d: 20 } }));
  p.scene.insert(makeNode('playerSpawn', { p: [-6, 0, -6] }));
  // a sealed 4x4 pocket with an item inside
  for (const [x, z, r] of [[5, 3, 0], [5, 7, 0], [3, 5, 90], [7, 5, 90]]) p.scene.insert(makeNode('wall', { p: [x, 0, z], r: [0, r, 0], props: { length: 4.2 } }));
  p.scene.insert(makeNode('itemSpawn', { name: 'Key', p: [5, 0, 5], props: { item: 'key' } }));
  const c = codes(p, ['reachability']);
  assert.ok(c.includes('unreachable'), c.join(','));
});

test('no player spawn is reported', () => { const p = new Project('t'); p.scene.insert(makeNode('floor')); assert.ok(codes(p, ['spawns']).includes('no-player-spawn')); });

test('validator never throws on an empty project', () => { assert.deepEqual(validateProject(new Project('x')).counts.error, 0); });

test('walls that overlap or meet flush (corners, T-junctions, collinear) are NOT reported', () => {
  const p = room();
  const S = p.scene;
  S.insert(makeNode('wall', { name: 'N', p: [0, 0, -4], props: { length: 8.2 } }));
  S.insert(makeNode('wall', { name: 'W', p: [-4, 0, 0], r: [0, 90, 0], props: { length: 7.8 } }));        // room-tool style corner
  S.insert(makeNode('wall', { name: 'T', p: [0, 0, -2], r: [0, 90, 0], props: { length: 3.8 } }));        // T-junction into N
  S.insert(makeNode('wall', { name: 'C1', p: [10, 0, 0], props: { length: 4 } }));
  S.insert(makeNode('wall', { name: 'C2', p: [14, 0, 0], props: { length: 4 } }));                          // collinear, exactly end to end
  const gaps = validateProject(p, { only: ['wallGaps'] }).issues;
  assert.deepEqual(gaps.map((g) => g.message), []);
});

test('a window beside a wall is reported as not cutting it; one tagged as a painted overlay (the game’s window tiles) is not', () => {
  const p = room();
  p.scene.insert(makeNode('wall', { name: 'W', p: [0, 0, -4], props: { length: 6, autoOpenings: false } }));
  const win = makeNode('window', { name: 'Win', p: [0, 1, -3.8], props: { width: 0.64, height: 1.35 } });
  p.scene.insert(win);
  assert.ok(codes(p, ['openingPlacement']).includes('opening-misaligned'));
  p.scene.get(win.id).tags.push('overlay');
  assert.deepEqual(codes(p, ['openingPlacement']), []);
});

// Story workspace in a real browser: chapters and endings built with the mouse, transitions, items, notes, checks, outline export.
// Everything in the story is typed by the test (as the author would); the only data that comes from elsewhere is the READ-ONLY list of the original game's chapters.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, openStudio, sleep } from './helpers.mjs';

let h, page;
before(async () => { h = await launch({ width: 1600, height: 1000 }); page = await openStudio(h); });
after(async () => { await h?.close(); });

const ws = '#ws-story';
const story = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__studio.project.data.story)));
const stat = (k) => page.locator(`${ws} [data-stat="${k}"]`).innerText();
const nodes = async (type) => (await story()).graph.nodes.filter((n) => !type || n.type === type);
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const clickBtn = (text) => page.locator(`${ws} button`, { hasText: text }).first().click();
const titleOf = (n) => n.data.title;
async function typeTitle(index, text) {
  const f = page.locator(`${ws} .gnode`).nth(index).locator('input[aria-label="Title"]');
  await f.fill(text); await f.press('Tab');
  await page.waitForFunction(([i, t]) => window.__studio.project.data.story.graph.nodes[i]?.data.title === t, [index, text]);
}
async function connect(fromIdx, toIdx) {
  const g = (await story()).graph.nodes;
  const from = await center(page.locator(`${ws} .gport.out[data-node="${g[fromIdx].id}"]`).first()), to = await center(page.locator(`${ws} .gport.in[data-node="${g[toIdx].id}"]`).first());
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 }); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
}

test('empty story: nothing is invented — no chapters, no text, no start', async () => {
  await page.click('.tab[data-ws="story"]');
  await page.waitForSelector(`${ws} #st-stats`);
  assert.equal(await stat('chapters'), '0'); assert.equal(await stat('endings'), '0');
  assert.deepEqual((await story()).graph.nodes, []); assert.equal((await story()).start, '');
  assert.match(await page.locator('#st-start').innerText(), /No starting chapter/);
});

test('+ Chapter / + Ending add nodes; the first chapter becomes the start; titles are typed by the author', async () => {
  await clickBtn('+ Chapter');
  await page.waitForSelector(`${ws} .gnode[data-type="chapter"]`);
  const first = (await nodes('chapter'))[0];
  assert.equal((await story()).start, first.id, 'the first chapter is the start');
  assert.equal(first.data.title, ''); assert.equal(first.data.summary, '', 'no text was invented');
  await clickBtn('+ Chapter'); await clickBtn('+ Ending');
  assert.equal((await nodes()).length, 3);
  await page.locator(`${ws} button`, { hasText: 'Fit' }).first().click(); await sleep(200);
  await typeTitle(0, 'Arrival'); await typeTitle(1, 'The cellar'); await typeTitle(2, 'Daylight');
  assert.deepEqual((await nodes()).map(titleOf), ['Arrival', 'The cellar', 'Daylight']);
  await page.locator(`${ws} .gnode`).nth(0).locator('textarea[aria-label="Summary (your own words)"]').fill('The player reaches the building.');
  await page.locator(`${ws} .gnode`).nth(0).locator('textarea').press('Tab');
  await page.waitForFunction(() => window.__studio.project.data.story.graph.nodes[0].data.summary === 'The player reaches the building.');
  assert.match(await page.locator('#st-start').innerText(), /Starts with: Arrival/);
});

test('checks react as the graph is built: dead ends and unreachable chapters until the mouse connects them', async () => {
  const codes = () => page.locator(`${ws} .issue`).evaluateAll((e) => e.map((x) => x.dataset.code));
  let c = await codes();
  assert.ok(c.includes('story-unreachable') && c.includes('story-dead-end'), c.join());
  assert.equal(await stat('reachable'), '1 of 3');
  await connect(0, 1);
  await page.waitForFunction(() => window.__studio.project.data.story.graph.edges.length === 1);
  await connect(1, 2);
  await page.waitForFunction(() => window.__studio.project.data.story.graph.edges.length === 2);
  await page.waitForFunction(() => document.querySelector('#ws-story [data-stat="reachable"]').textContent === '3 of 3');
  assert.equal(await stat('paths'), '1');
  c = await codes();
  assert.deepEqual(c.filter((x) => !['story-event-unfired'].includes(x)), [], 'a connected story with an ending has no problems');
  assert.equal((await story()).graph.edges[0].data.kind, 'always');
});

test('a transition can wait for an event or a flag; the label shows it; an empty condition is flagged', async () => {
  const e = (await story()).graph.edges[0];
  await page.evaluate((id) => { const ed = window.__studio.storyWs.editor; ed.selEdge = id; ed.selection.clear(); ed.render(); }, e.id);
  await page.waitForSelector('.graph-edgepanel select[aria-label="Happens"]');
  await page.locator('.graph-edgepanel select[aria-label="Happens"]').selectOption('event');
  await page.waitForFunction(() => window.__studio.project.data.story.graph.edges[0].data.kind === 'event');
  assert.ok((await page.locator(`${ws} .issue`).evaluateAll((x) => x.map((i) => i.dataset.code))).includes('story-edge-empty'));
  const ev = page.locator('.graph-edgepanel input[aria-label="Event name (if “event”)"]');
  await ev.fill('cellar-door-opened'); await ev.press('Tab');
  await page.waitForFunction(() => window.__studio.project.data.story.graph.edges[0].data.event === 'cellar-door-opened');
  assert.ok(!(await page.locator(`${ws} .issue`).evaluateAll((x) => x.map((i) => i.dataset.code))).includes('story-edge-empty'));
  assert.match(await page.locator(`${ws} .issue[data-code="story-event-unfired"]`).innerText(), /cellar-door-opened/);
  // when the OPEN map fires that event the note goes away
  await page.evaluate(() => window.__studio.createNode('trigger', { name: 'Cellar door', props: { onEnter: 'cellar-door-opened' } }, { select: false }));
  await page.waitForFunction(() => !document.querySelector('#ws-story .issue[data-code="story-event-unfired"]'));
});

test('items: add by hand, or add the ids the map uses; used / unused / undefined are reported', async () => {
  await page.evaluate(() => { const a = window.__studio; a.createNode('door', { name: 'Cellar door', props: { locked: 'item:brass_key' } }, { select: false }); a.createNode('itemSpawn', { name: 'Pill', props: { item: 'pills' } }, { select: false }); });
  await page.click(`${ws} button[data-tab="items"]`);
  await clickBtn('+ Item');
  await page.waitForSelector('.modal-h:has-text("New item")');
  await page.locator('.modal input[type="text"]').fill('Lantern'); await page.locator('.modal .btn.primary').click();
  await page.waitForSelector(`${ws} .tree-row[data-item="lantern"]`);
  const d = page.locator(`${ws} textarea[aria-label="Description"]`); await d.fill('Lights the cellar.'); await d.press('Tab');
  await page.waitForFunction(() => window.__studio.project.data.story.items.lantern?.description === 'Lights the cellar.');
  assert.equal(Object.keys((await story()).items)[0], 'lantern');
  const n = page.locator(`${ws} input[aria-label="Name"]`); await n.fill('Old lantern'); await n.press('Tab');
  await page.waitForFunction(() => window.__studio.project.data.story.items.lantern?.name === 'Old lantern');
  assert.deepEqual(Object.keys((await story()).items), ['lantern'], 'renaming does not change the id');
  const codes = async () => (await page.locator(`${ws} .issue`).evaluateAll((e) => e.map((x) => x.dataset.code)));
  await page.waitForFunction(() => document.querySelector('#ws-story .issue[data-code="story-item-undefined"]'));
  assert.equal((await codes()).filter((c) => c === 'story-item-undefined').length, 2, 'brass_key and pills are used but not listed');
  assert.ok((await codes()).includes('story-item-unused'), 'the lantern is not used');
  await page.locator(`${ws} button`, { hasText: /Add 2 used items not listed/ }).click();
  await page.waitForFunction(() => Object.keys(window.__studio.project.data.story.items).length === 3);
  assert.deepEqual(Object.keys((await story()).items).sort(), ['brass_key', 'lantern', 'pills']);
  assert.equal((await story()).items.brass_key.description, '', 'only ids were created; no text was invented');
  assert.ok(!(await codes()).includes('story-item-undefined'));
});

test('notes are written by the author and attached to chapters from the Selection panel', async () => {
  await page.click(`${ws} button[data-tab="notes"]`);
  await clickBtn('+ Note');
  await page.waitForSelector(`${ws} .tree-row[data-note]`);
  const t = page.locator(`${ws} input[aria-label="Title"]`).first(); await t.fill('Diary page'); await t.press('Tab');
  const x = page.locator(`${ws} textarea[aria-label="Text"]`).first(); await x.fill('Day 3: the lights failed again.'); await x.press('Tab');
  await page.waitForFunction(() => Object.values(window.__studio.project.data.story.notes)[0]?.text === 'Day 3: the lights failed again.');
  // select the first chapter in the graph and attach the note
  await page.locator(`${ws} .gnode`).nth(0).locator('.gnode-head').click();
  await page.waitForSelector(`${ws} input[aria-label="Note Diary page"]`);
  await page.locator(`${ws} input[aria-label="Note Diary page"]`).check();
  await page.waitForFunction(() => window.__studio.project.data.story.graph.nodes[0].data.notes.length === 1);
});

test('the outline contains exactly what was typed, in story order, and can be exported', async () => {
  const dl = page.waitForEvent('download');
  await clickBtn('Export outline');
  const d = await dl; const md = fs.readFileSync(await d.path(), 'utf8');
  assert.match(d.suggestedFilename(), /-story\.md$/);
  assert.match(md, /## Arrival {2}\(start\)/); assert.match(md, /The player reaches the building\./); assert.match(md, /Note “Diary page”: Day 3: the lights failed again\./);
  assert.match(md, /- The cellar — when “cellar-door-opened” happens/); assert.match(md, /## Ending: Daylight/);
  assert.ok(md.indexOf('Arrival') < md.indexOf('The cellar') && md.indexOf('The cellar') < md.indexOf('Daylight'));
  assert.ok(md.includes('Old lantern'));
  for (const bad of ['Lorem', 'TODO', 'undefined', '[object']) assert.ok(!md.includes(bad), bad);
});

test('the original game\'s chapters are a read-only reference; “Add shell” copies only the title', async () => {
  const before = await story();
  await page.click(`${ws} button[data-tab="reference"]`);
  await page.waitForSelector(`${ws} [data-ref]`, { timeout: 15000 });
  const rows = await page.locator(`${ws} [data-ref]`).allInnerTexts();
  assert.equal(rows.length, 6, 'six chapters; the epilogue belongs to chapter 6');
  assert.match(rows[0], /1\. The Woods/); assert.match(rows[1], /Inside/); assert.match(rows[2], /Below/); assert.match(rows[3], /The Hidden Wing \(draft\)/); assert.match(rows[4], /The System \(draft\)/); assert.match(rows[5], /6\. Burn the Memory/);
  assert.match(await page.locator(`${ws} .note.warn`).innerText(), /Read-only reference/);
  assert.deepEqual(await story(), before, 'merely looking changed nothing');
  await page.locator(`${ws} [data-ref="ch3"] button`, { hasText: 'Add shell' }).click();
  await page.waitForFunction((n) => window.__studio.project.data.story.graph.nodes.length === n + 1, before.graph.nodes.length);
  const shell = (await nodes('chapter')).at(-1);
  assert.deepEqual([shell.data.title, shell.data.summary, shell.data.objective, shell.data.map], ['Below', '', '', 'original game: ch3']);
});

test('story edits are undoable and survive a save/load round trip; the validator reports story problems with their nodes', async () => {
  const r = await page.evaluate(async () => {
    const a = window.__studio; const { Project } = await import('/studio/js/core/project.js'); const { validateProject } = await import('/studio/js/core/validate.js');
    const before = JSON.stringify(a.project.data.story);
    const copy = Project.fromJSON ? Project.fromJSON(JSON.parse(JSON.stringify(a.project.toJSON()))) : null;
    const v = validateProject(a.project, { only: ['story'] });
    a.undo();                                            // the "Below" shell
    return { same: copy ? JSON.stringify(copy.data.story) === before : null, codes: v.issues.map((i) => i.code), withNodes: v.issues.filter((i) => i.storyNodes?.length).length, after: a.project.data.story.graph.nodes.length, nodesBefore: JSON.parse(before).graph.nodes.length };
  });
  assert.equal(r.same, true);
  assert.ok(r.codes.includes('story-unreachable'), 'the new shell chapter is not connected to the story');
  assert.ok(r.withNodes >= 1);
  assert.equal(r.after, r.nodesBefore - 1, 'undo removed the shell');
  assert.deepEqual(h.errors.filter((e) => /pageerror|console\.error/.test(e)), []);
});

// Enemy & boss workspace in a real browser: read-only references, duplicate/edit, state graph editing with the mouse,
// and the live test arena running the real AI agent.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openStudio, sleep, clickDialog } from './helpers.mjs';

let h, page;
before(async () => { h = await launch({ width: 1600, height: 1000 }); page = await openStudio(h); });
after(async () => { await h?.close(); });

const ws = '#ws-enemies';
const field = (label) => page.locator(`${ws} input[aria-label="${label}"], ${ws} select[aria-label="${label}"]`).first();
const enemies = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__studio.project.data.enemies)));
const current = () => page.evaluate(() => window.__studio.enemiesWs.current);
const setNumber = async (label, v) => { const f = field(label); await f.fill(String(v)); await f.press('Enter'); };
const arena = () => page.evaluate(() => { const s = window.__studio.enemiesWs.arena.sim; return s && { t: s.time, hp: s.agent.hp, max: s.agent.maxHp, state: s.agent.state, def: s.def.health }; });
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test('a small map with a player spawn and an enemy spawn using the Hollow reference', async () => {
  await page.evaluate(async () => {
    const a = window.__studio;
    const { createRoom } = await import('/studio/js/tools/build.js');
    createRoom(a, { cx: 0, cz: 0, y: 0, w: 12, d: 12 }, { height: 2.8, thick: 0.2, wallMaterial: 'mat_plaster', floorMaterial: 'mat_tile', ceilingMaterial: 'mat_plaster', doorSide: 'none' });
    a.select([]);
    a.createNode('playerSpawn', { name: 'Start', p: [0, 0, 4] }, { select: false });
    a.createNode('enemySpawn', { name: 'Hollow 1', p: [0, 0, -3], props: { archetype: 'ref_hollow' } }, { select: false });
  });
});

test('the list shows both game references; the Hollow is read-only and its numbers come from the game', async () => {
  await page.click('.tab[data-ws="enemies"]');
  await page.waitForSelector(`${ws} .tree-row[data-enemy]`);
  assert.deepEqual(await page.locator(`${ws} .tree-row[data-enemy]`).evaluateAll((e) => e.map((x) => x.dataset.enemy)), ['ref_hollow', 'ref_warden']);
  await page.click(`${ws} .tree-row[data-enemy="ref_hollow"]`);
  assert.equal(await field('Health').isDisabled(), true);
  assert.equal(await field('Health').inputValue(), '100');
  assert.match(await page.locator(`${ws} .note.warn`).first().innerText(), /Numbers copied from/);
  assert.equal(await page.locator(`${ws} .gnode[data-type="state"]`).count(), 9);
  assert.deepEqual(await enemies(), {}, 'the project has no enemies of its own yet');
});

test('Duplicate to edit makes an editable copy; changes reach the project and the running arena', async () => {
  await page.locator(`${ws} button`, { hasText: 'Duplicate to edit' }).click();
  const id = await current();
  assert.notEqual(id, 'ref_hollow');
  assert.equal((await enemies())[id].graph.nodes.length, 9);
  assert.equal(await field('Health').isDisabled(), false);
  await setNumber('Health', 150);
  assert.equal((await enemies())[id].health, 150);
  await page.waitForFunction(() => window.__studio.enemiesWs.arena.sim?.def.health === 150, null, { timeout: 8000 });
});

test('adding a state with the right-click menu and drawing a transition with the mouse changes the behaviour graph', async () => {
  const id = await current();
  const view = page.locator(`${ws} .graph-view`);
  const b = await view.boundingBox();
  await page.mouse.click(b.x + b.width - 60, b.y + b.height - 40, { button: 'right' });
  await page.locator('.ctx .menu-item', { hasText: 'State' }).first().click();
  const g = (await enemies())[id].graph;
  assert.equal(g.nodes.length, 10);
  const added = g.nodes.at(-1);
  assert.equal(await page.locator(`${ws} .gnode[data-type="state"]`).count(), 10);
  const edgesBefore = g.edges.length;
  await page.locator(`${ws} .graph-bar button`, { hasText: 'Fit' }).click();      // bring the new state fully into view
  await sleep(200);
  // drag from the new state's output dot to the Idle state's input dot
  const idle = g.nodes.find((n) => n.data.name === 'Idle');
  const from = await center(page.locator(`${ws} .gport.out[data-node="${added.id}"]`).first());
  const to = await center(page.locator(`${ws} .gport.in[data-node="${idle.id}"]`).first());
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 }); await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
  const after = (await enemies())[id].graph;
  assert.equal(after.edges.length, edgesBefore + 1);
  const e = after.edges.at(-1);
  assert.deepEqual([e.from.node, e.to.node, e.data.cond], [added.id, idle.id, 'always']);
  await page.evaluate(() => window.__studio.undo());
  assert.equal((await enemies())[id].graph.edges.length, edgesBefore, 'undo removes the transition again');
});

test('the test arena runs the real agent: time advances, hits and head shots apply the weak-spot multipliers', async () => {
  await page.waitForFunction(() => (window.__studio.enemiesWs.arena.sim?.time || 0) > 0.4, null, { timeout: 15000 });
  await page.locator(`${ws} .graph-bar button`, { hasText: '↺ Reset' }).last().click();
  const a0 = await arena();
  assert.equal(a0.hp, 150);
  await page.locator(`${ws} button`, { hasText: 'Hit 20' }).click();
  assert.ok(Math.abs((await arena()).hp - 130) < 0.01, 'a body hit does its listed damage');
  await page.locator(`${ws} button`, { hasText: 'Head 20' }).click();
  assert.ok(Math.abs((await arena()).hp - (130 - 20 * 2.6)) < 0.01, 'a head hit is multiplied by the head weak spot (2.6)');
  assert.match(await page.locator(`${ws} canvas`).first().evaluate((c) => c.parentElement.innerText), /hp \d+/);
});

test('boss phases can be added and edited; deleting asks first and reference enemies cannot be deleted', async () => {
  const id = await current();
  await page.locator(`${ws} .sec-h`, { hasText: 'Boss phases' }).click();          // the section starts collapsed while there are no phases
  await page.locator(`${ws} button`, { hasText: '+ Add phase' }).click();
  assert.equal((await enemies())[id].phases.length, 1);
  await setNumber('Starts below', 40);
  assert.equal((await enemies())[id].phases[0].hpBelow, 40);
  await page.locator(`${ws} button`, { hasText: 'Delete' }).click();
  await page.waitForSelector('.modal');
  await clickDialog(page, 'Cancel');
  assert.ok((await enemies())[id]);
  await page.locator(`${ws} button`, { hasText: 'Delete' }).click();
  await clickDialog(page, 'Delete');
  assert.deepEqual(await enemies(), {});
  await page.click(`${ws} .tree-row[data-enemy="ref_warden"]`);
  await page.locator(`${ws} button`, { hasText: 'Delete' }).click();
  assert.equal(await page.locator('.modal').count(), 0);
  assert.deepEqual(h.errors.filter((e) => /pageerror|console\.error/.test(e)), []);
});

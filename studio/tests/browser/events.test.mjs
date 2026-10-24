import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openStudio, menu, sleep } from './helpers.mjs';

let h, page;
before(async () => { h = await launch({ width: 1600, height: 950 }); page = await openStudio(h); });
after(async () => { await h?.close(); });
const graph = () => page.evaluate(() => { const g = Object.values(window.__studio.project.data.events.graphs)[0]; return g && JSON.parse(JSON.stringify(g)); });
const pickMenu = async (label) => page.locator('.menu-pop.ctx .menu-item', { hasText: new RegExp('^\\s*' + label + '\\s*$') }).first().click();

test('build a graph with the mouse: add nodes from the context menu, type fields, connect ports by dragging', async () => {
  await page.evaluate(() => { const a = window.__studio; a.createNode('door', { name: 'Door A', props: { doorId: 'A' } }, { select: false }); a.createNode('trigger', { name: 'Zone', props: { onEnter: 'zone-entered' } }, { select: false }); });
  await page.click('.tab[data-ws="events"]');
  await page.locator('#ws-events button', { hasText: 'New' }).click();
  const canvas = page.locator('#ws-events .graph-view');
  const box = await canvas.boundingBox();
  await canvas.click({ button: 'right', position: { x: 80, y: 80 } });
  await pickMenu('On event');
  await canvas.click({ button: 'right', position: { x: 420, y: 60 } });
  await pickMenu('Set flag');
  await canvas.click({ button: 'right', position: { x: 420, y: 190 } });
  await pickMenu('Door');
  let g = await graph();
  assert.deepEqual(g.nodes.map((n) => n.type).sort(), ['act.door', 'act.setFlag', 'on.event']);
  // fill in fields
  const field = (type, label) => page.locator(`#ws-events .gnode[data-type="${type}"] .gfield`, { hasText: label }).locator('input,select');
  await field('on.event', 'Event name').fill('zone-entered'); await field('on.event', 'Event name').press('Tab');
  await field('act.setFlag', 'Flag').fill('power'); await field('act.setFlag', 'Flag').press('Tab');
  await field('act.door', 'Door id').fill('A'); await field('act.door', 'Door id').press('Tab');
  // connect by dragging from output dot to input dot
  const dot = async (type, side) => { const b = await page.locator(`#ws-events .gnode[data-type="${type}"] .gport.${side}`).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const a = await dot('on.event', 'out'), b = await dot('act.setFlag', 'in');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  const b2 = await dot('act.setFlag', 'out'), c = await dot('act.door', 'in');
  await page.mouse.move(b2.x, b2.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 8 }); await page.mouse.up();
  g = await graph();
  assert.equal(g.edges.length, 2, 'two connections were created');
  const byType = Object.fromEntries(g.nodes.map((n) => [n.type, n]));
  assert.equal(byType['on.event'].data.name, 'zone-entered');
  assert.deepEqual(g.edges.map((e) => [e.from.node, e.to.node]).sort(), [[byType['on.event'].id, byType['act.setFlag'].id], [byType['act.setFlag'].id, byType['act.door'].id]].sort());
  assert.equal(await page.locator('#ws-events .gedge').count(), 2, 'edges are drawn');
});

test('dropping a connection on empty space offers a quick-add menu that creates and connects a node', async () => {
  const canvas = page.locator('#ws-events .graph-view');
  const o = await page.locator('#ws-events .gnode[data-type="act.door"] .gport.out').first().boundingBox();
  await page.mouse.move(o.x + 6, o.y + 6); await page.mouse.down(); await page.mouse.move(o.x + 260, o.y + 6, { steps: 6 }); await page.mouse.up();
  await pickMenu('Show text');
  const g = await graph();
  assert.equal(g.nodes.length, 4); assert.equal(g.edges.length, 3);
});

test('simulator: fire the event, graph nodes flash, state and trace update', async () => {
  await page.locator('#ws-events .gnode[data-type="act.say"] textarea').fill('You hear a click.');
  await page.locator('#ws-events .gnode[data-type="act.say"] textarea').press('Tab');
  await page.fill('#ws-events input[aria-label="Event to fire"]', 'zone-entered');
  await page.locator('#ws-events button', { hasText: /^Fire$/ }).click();
  await page.waitForSelector('#ws-events .gnode.fired');
  assert.ok(await page.locator('#ws-events .gnode.fired').count() >= 3);
  const sim = await page.locator('#ws-events .insp').innerText();
  assert.match(sim, /power\s+true/); assert.match(sim, /A\s+open/);
  assert.match(await page.locator('#ev-trace').innerText(), /event “zone-entered”/);
});

test('problems: dangling door reference is flagged; unhandled scene events offer a one-click handler', async () => {
  await page.locator('#ws-events .gnode[data-type="act.door"] .gfield', { hasText: 'Door id' }).locator('input').fill('NOPE');
  await page.keyboard.press('Tab');
  await sleep(300);
  assert.match(await page.locator('#ws-events').innerText(), /Door “NOPE”.*does not exist/);
  await page.evaluate(() => window.__studio.createNode('interaction', { name: 'Lever', props: { event: 'lever-pulled' } }, { select: false }));
  await page.evaluate(() => window.__studio.history.emit('change'));
  await sleep(300);
  await page.locator('#ws-events .issue[data-kind="unhandled"] button', { hasText: 'Add handler' }).first().click();
  const g = await graph();
  assert.ok(g.nodes.some((n) => n.type === 'on.event' && n.data.name === 'lever-pulled'));
});

test('everything in the graph editor is undoable', async () => {
  const before = (await graph()).nodes.length;
  await page.keyboard.press('Control+z'); await sleep(200);
  assert.equal((await graph()).nodes.length, before - 1);
  await page.keyboard.press('Control+Shift+z'); await sleep(200);
  assert.equal((await graph()).nodes.length, before);
});

test('project validation includes the graph problems and event wiring', async () => {
  const codes = await page.evaluate(async () => { const { validateProject } = await import('/studio/js/core/validate.js'); return validateProject(window.__studio.project).issues.map((i) => i.code); });
  assert.ok(codes.includes('ref-door'), codes.join(','));
  assert.deepEqual(h.errors.filter((e) => /pageerror/.test(e)), []);
});

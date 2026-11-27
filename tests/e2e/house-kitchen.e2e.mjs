// #858 + #874 (epic #845): the kitchen and cooking, played. The house grows to the House with the real delivery and
// Bloombot goes in by the front door; it walks into the kitchen to the stove, the counter and the table; at the stove
// the real key opens cooking; a vegetable soup is cooked with the panel's button; the backpack's Eat one eats it and
// Charge rises; a tomato salad is handed to Pylon, who thanks Bloombot for the meal; at the Home the kitchen is still
// there. Screenshots go to SHOTS_DIR (default docs/review/858-874). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';
import { grow, keyOf, press, shot as shotIn, visit, wait, walkTo, where } from './lib/house.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/858-874';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4253);
const LONG = Number(process.env.E2E_TIMEOUT) || 240_000;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const shot = (page, file) => shotIn(page, dir, file);
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const panelText = (page) => page.evaluate(() => (document.querySelector('#ocPanel.open') ? document.querySelector('#ocPanel').innerText.replace(/\s+/g, ' ').trim() : ''));

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(LONG);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false, noVistas: true } });
  await wait(2000);
  await page.evaluate(() => {
    const g = window.solarbloom;
    const sv = g.sim.state.salvage;
    sv.tier = Math.max(1, sv.tier);
    for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone']) sv.store[m] = 999;
    // morning, so the kitchen is in daylight
    const s = g.sim;
    (s.state.clock ??= { offset: 0 }).offset += (0.4 - s.clock.dayFraction()) * 2880;
  });
  await wait(1500);

  // the Cottage has no kitchen pieces; the House brings them
  await grow(page, 2);
  check(await page.evaluate(() => !window.solarbloom.sim.house.furniture().some((f) => ['stove', 'counter', 'table'].includes(f.id))), 'the Cottage has no stove, counter or table');
  await grow(page, 3);
  const pieces = await page.evaluate(() => window.solarbloom.sim.house.furniture().filter((f) => ['stove', 'counter', 'table'].includes(f.id)).map((f) => `${f.id}@${f.x},${f.z}:${window.solarbloom.sim.house.roomAt(f.x, f.z)?.id}`));
  check(pieces.length === 3 && pieces.every((p) => p.endsWith(':kitchen')), `the House brings the stove, the counter and the table, in the kitchen (${pieces.join(' ')})`);
  await shot(page, '3-house-from-door.png');

  // into the kitchen, and to each piece
  const k = await page.evaluate(() => window.solarbloom.sim.house.rooms().find((r) => r.id === 'kitchen'));
  const mid = k.x + Math.floor(k.w / 2);
  const inKitchen = await walkTo(page, mid, k.z + k.d - 1, mid, k.z);
  const w = await where(page);
  check(inKitchen && w.room === 'kitchen' && w.blocking === 0, `walks into the kitchen, in view (${w.room})`);
  await shot(page, '3-kitchen.png');
  for (const id of ['counter', 'table']) {
    const v = await visit(page, id);
    check(v.ok, `walks to the ${id} (it is there to look at: "${v.text}")`);
  }
  const stove = await visit(page, 'stove');
  check(stove.ok && /Cook at the stove/.test(stove.text), `walks to the stove: "${stove.text}"`);
  await shot(page, '3-stove.png');

  // the real key opens cooking; with nothing in the basket, every Cook waits
  await press(page, await keyOf(page, 'interact'));
  await page.waitForSelector('#ocPanel.open', { timeout: 30_000 });
  let text = await panelText(page);
  check(/The stove/.test(text) && /Vegetable soup/.test(text) && /Tomato salad/.test(text) && /Corn bake/.test(text) && /Pumpkin pie/.test(text), 'the stove opens cooking: four recipes');
  check((await page.locator('#ocPanel [data-act="cook"]:disabled').count()) === 4, 'with nothing to cook with, every Cook waits');
  await shot(page, '3-cooking-empty.png');

  await press(page, 'Escape');
  await page.waitForFunction(() => !document.querySelector('#ocPanel.open'), null, { timeout: 30_000 });

  // back with crops kept from harvests in the basket and food in the backpack: the soup and the salad can be cooked
  await page.evaluate(() => {
    const g = window.solarbloom;
    const sv = g.sim.state.salvage;
    sv.basket = { potato: 2, radish: 1, tomato: 2, lettuce: 1 };
    g.sim.inventory.add('food', 3);
  });
  await wait(500);
  await press(page, await keyOf(page, 'interact'));
  await page.waitForSelector('#ocPanel.open', { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('#ocPanel [data-act="cook"][data-arg="soup"]')?.disabled, null, { timeout: 30_000 });
  await shot(page, '3-cooking-ready.png');
  await page.click('#ocPanel [data-act="cook"][data-arg="soup"]');
  await wait(800);
  const cooked = await page.evaluate(() => ({ soup: window.solarbloom.sim.inventory.count('soup'), basket: { ...window.solarbloom.sim.state.salvage.basket }, food: window.solarbloom.sim.inventory.count('food') }));
  check(cooked.soup === 1 && !cooked.basket.potato && !cooked.basket.radish && cooked.food === 2, `Cook puts a soup in the backpack and takes its potatoes, radish and Food (${JSON.stringify(cooked)})`);
  await page.click('#ocPanel [data-act="cook"][data-arg="salad"]');
  await wait(800);
  check((await page.evaluate(() => window.solarbloom.sim.inventory.count('salad'))) === 1, 'and a tomato salad');
  text = await panelText(page);
  check(/You have 1 in your backpack/.test(text), 'the stove says how many of each meal you carry');
  await shot(page, '3-cooking-cooked.png');
  await press(page, 'Escape');
  await wait(800);

  // the backpack's Eat one: the soup tops up Charge by 40
  await page.evaluate(() => window.solarbloom.sim.charge.drainForTest());
  const before = await page.evaluate(() => window.solarbloom.sim.charge.value());
  await page.keyboard.press('Tab');
  await page.waitForSelector('#bpScreen.open');
  await page.click('#bpmat-soup');
  await page.waitForSelector('#bp-eat');
  const detail = await page.evaluate(() => document.querySelector('#bpDetail').innerText.replace(/\s+/g, ' '));
  check(/Vegetable soup/.test(detail) && /Eat one \(40 Charge\)/.test(detail) && /Cooked at the stove in your kitchen/.test(detail) && /give it to a Keeper/.test(detail), `the soup in the backpack: "${detail.slice(0, 120)}…"`);
  await shot(page, '3-backpack-soup.png');
  await page.click('#bp-eat');
  await wait(300);
  const live = await page.evaluate(() => document.querySelector('.bp-live').textContent);
  check(/Eating Vegetable soup/.test(live), `Eat one: "${live}"`);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => !document.querySelector('#bpScreen.open'));
  await page.waitForFunction((b) => window.solarbloom.sim.charge.value() >= b + 40 - 0.01 && !window.solarbloom.sim.charge.eating, before, { timeout: 60_000, polling: 250 }).catch(() => {});
  const after = await page.evaluate(() => ({ v: window.solarbloom.sim.charge.value(), soup: window.solarbloom.sim.inventory.count('soup') }));
  check(after.v >= before + 40 - 0.01 && after.soup === 0, `the soup is eaten and Charge rises by 40 or more (the house trickles too): ${before.toFixed(1)} → ${after.v.toFixed(1)}`);

  // a meal is a gift every Keeper loves: Pylon, settled, takes the salad and thanks Bloombot for it
  const pylon = await page.evaluate(() => {
    const g = window.solarbloom;
    g.sim.state.salvage.keepers.pylon = { step: 'settled' };
    g.sim.gates.open('g-mastRow', true);
    g.sim.areas.clear('mastRow', true); // its fog lifted, so Pylon and Bloombot are in sight for the shot
    g.exitHouse();
    return { ...g.sim.keepers.pose('pylon'), thanks: g.sim.keepers.story('pylon').mealThanks };
  });
  await wait(1500);
  await page.evaluate(([x, z]) => {
    const g = window.solarbloom;
    g.bot.teleport('g', Math.floor(x) + 0.5, Math.floor(z) + 1.5);
    g.bot.turnTo(Math.PI); // facing north, to Pylon
    g.bot.lastInput = 'keys';
    g.pointer.inside = false;
  }, [pylon.x, pylon.z]);
  await page.waitForFunction(() => /Pylon/.test(document.getElementById('prompt')?.innerText ?? ''), null, { timeout: 60_000, polling: 300 }).catch(() => {});
  await wait(12_000); // the lifted fog fades away (for the shot)
  const gift = await page.evaluate(() => document.getElementById('prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
  await press(page, await keyOf(page, 'interact'));
  const bubble = await page.waitForFunction((t) => (document.querySelector('.oc-bubble:not([hidden])')?.textContent.includes(t) ? document.querySelector('.oc-bubble').textContent : ''), pylon.thanks, { timeout: 30_000 }).then((h) => h.jsonValue()).catch(() => page.evaluate(() => document.querySelector('.oc-bubble')?.textContent ?? ''));
  const gave = await page.evaluate(() => ({ salad: window.solarbloom.sim.inventory.count('salad'), hearts: window.solarbloom.sim.keepers.hearts('pylon') }));
  check(gave.salad === 0 && gave.hearts === 1 && bubble.includes(pylon.thanks), `Pylon takes the salad ("${gift}") and says: "${bubble}"`);
  await shot(page, '3-pylon-meal.png');

  // the Home keeps the kitchen
  await grow(page, 4);
  const home = await page.evaluate(() => window.solarbloom.sim.house.furniture().filter((f) => ['stove', 'counter', 'table'].includes(f.id)).map((f) => window.solarbloom.sim.house.roomAt(f.x, f.z)?.id));
  check(home.length === 3 && home.every((r) => r === 'kitchen'), `at the Home the stove, the counter and the table are still in the kitchen (${home.join(', ')})`);
  const k4 = await page.evaluate(() => window.solarbloom.sim.house.rooms().find((r) => r.id === 'kitchen'));
  const mid4 = k4.x + Math.floor(k4.w / 2);
  await walkTo(page, mid4, k4.z + k4.d - 1, mid4, k4.z);
  await shot(page, '4-kitchen.png');
  const s4 = await visit(page, 'stove');
  check(s4.ok && /Cook at the stove/.test(s4.text), `the Home's stove still cooks: "${s4.text}"`);
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  failures.push(String(e));
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);

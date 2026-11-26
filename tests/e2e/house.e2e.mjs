// #782: Bloombot's house in the real game, from the ruined shed to the Home:
//  - before the fountain's first step it is the ruined shed, with no inside;
//  - at the fountain's first step, its front wall offers "Mend the house" ({interact}); the panel shows what it needs
//    (have-of-need) and "Give all I have" mends it into the Shed, drawn anew, with a toast naming the key;
//  - its door then offers "Go inside": inside, a room of the level's size, its furniture, the indoor camera;
//    a decoration goes down on the floor; the bed, radio, chest are there; "Go outside" brings Bloombot back out;
//  - the Cottage, the House (with its fenced garden) and the Home each look their own, and their rooms grow;
//  - the Home adds "Go home" to the menu, which brings Bloombot to its doorstep from far away;
//  - a reload keeps the level, the room and what was placed inside.
// Screenshots go to SHOTS_DIR (default docs/review/782). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, waitForGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/782';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4249);
const LONG = Number(process.env.E2E_TIMEOUT) || 240_000;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const keyOf = (page, action) => page.evaluate((a) => window.solarbloom.bindings.keys[a].find((k) => !/^Mouse/.test(k)), action);
const press = async (page, code) => page.keyboard.press(code.replace(/^Key/, '').replace(/^Digit/, ''));
const prompt = (page) => page.evaluate(() => document.getElementById('prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()).join(' | '));

/** Stand at a cell (centre) facing an angle (0 = south, π = north) and settle the camera. */
const stand = (page, roofId, x, z, facing, ms = 2500) =>
  page
    .evaluate(
      ([roofId, x, z, facing]) => {
        const g = window.solarbloom;
        g.bot.teleport(roofId, x, z);
        g.bot.turnTo(facing);
        g.bot.following = true;
        g.bot.lastInput = 'keys';
        g.pointer.inside = false;
        g.camera.recentre?.();
      },
      [roofId, x, z, facing],
    )
    .then(() => wait(ms));

/** A view of the house from the park, just south of its door, looking down at its front and roof. */
const view = async (page, file, v) => {
  await page.evaluate((v) => {
    const g = window.solarbloom;
    g.bot.teleport('g', v.x, v.z);
    g.bot.faceToward(v.fx, v.fz);
    g.camera.recentre?.();
    g.camera.zoomTo(v.zoom);
    g.camera.pitchBy(v.pitch);
  }, v);
  await wait(5000);
  await page.screenshot({ path: `${dir}/${file}` });
  await page.evaluate((p) => window.solarbloom.camera.pitchBy(-p), v.pitch);
};
const houseShot = (page, file) => view(page, file, { x: 4.5, z: 7.5, fx: 1, fz: 3, zoom: 0.7, pitch: 35 });
/** The House's fenced garden, west of it: Bloombot stands in it. */
const gardenShot = (page, file) => view(page, file, { x: 1, z: 7, fx: 1, fz: 2, zoom: 0.9, pitch: 30 });

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(LONG);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false, noVistas: true } });
  await wait(2000);
  const interact = await keyOf(page, 'interact');

  let s = await page.evaluate(() => ({ level: window.solarbloom.sim.house.level, inside: window.solarbloom.sim.house.hasInside() }));
  check(s.level === 0 && !s.inside, 'a new garden: the ruined shed, with no inside');
  await houseShot(page, 'house-0-ruined.png');

  // the fountain's first step (as #782's gift e2e reaches it for real), and what the house needs in the chests
  await page.evaluate(() => {
    const g = window.solarbloom;
    const sv = g.sim.state.salvage;
    sv.tier = 1;
    g.cozyCheckAt = Infinity; // the gift's toast is the other e2e's
    for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone']) sv.store[m] = 400;
    let n = 0;
    for (const t of g.sim.areas.tiles('park')) {
      if (n >= 90) break;
      if (t.blocked || t.occupantId || t.feature === 'water') continue;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = Math.max(1, t.bloom);
      g.sim.grid.touch(t);
      n++;
    }
    g.chunks.markAll();
  });

  // its front wall beside the door: "Mend the house"
  await stand(page, 'g', 3.5, 5.5, Math.PI);
  let p = await prompt(page);
  check(/Mend the house/.test(p) && !/[{}]/.test(p), `at its front wall the prompt reads "${p}"`);
  await press(page, interact);
  await page.waitForFunction(() => /Mend it into a little shed/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});
  const panel = await page.evaluate(() => document.querySelector('.oc-panel, #ocPanel, [class*="oc-"]')?.closest('[role=dialog], .panel, section')?.innerText.replace(/\s+/g, ' ') ?? document.body.innerText.replace(/\s+/g, ' '));
  check(/0 of 15/.test(panel) && /Timber/.test(panel) && /A bed/.test(panel) && /12 decorations/.test(panel), 'the panel shows what the Shed needs (0 of 15 Scrap…) and what it brings');
  await page.screenshot({ path: `${dir}/house-panel.png` });
  await page.click('[data-act="giveAll"]');
  await page.waitForFunction(() => window.solarbloom.sim.house.level === 1, null, { timeout: 60_000 }).catch(() => {});
  s = await page.evaluate(() => ({ level: window.solarbloom.sim.house.level }));
  check(s.level === 1, '"Give all I have" mends it into the Shed');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some((t) => /house is a shed now/i.test(t.innerText)), null, { timeout: 60_000, polling: 300 }).catch(() => {});
  const t1 = await toasts(page);
  check(/house is a shed now/i.test(t1) && /press [A-Z]/i.test(t1) && !/[{}]/.test(t1), `the toast: "${t1.split(' | ').find((x) => /shed now/i.test(x))?.slice(0, 150)}"`);
  await houseShot(page, 'house-1-shed.png');

  // in through the door
  await stand(page, 'g', 4.5, 6.5, Math.PI);
  p = await prompt(page);
  check(/Go inside the shed/.test(p), `at the door the prompt reads "${p}"`);
  await press(page, interact);
  await wait(4000);
  s = await page.evaluate(() => {
    const g = window.solarbloom;
    return { roof: g.bot.pose.roofId, indoors: g.camera.isIndoors, room: g.sim.grid.layer('house')?.width, shown: !!g.houseInside?.visible, dry: !!g.weatherLook().indoors };
  });
  check(s.roof === 'house' && s.indoors && s.room === 6 && s.shown, `inside: the Shed's room (${s.room} × ${s.room}), drawn, with the indoor camera`);
  check(s.dry, 'no rain or snow falls inside');
  await page.screenshot({ path: `${dir}/inside-1-shed.png` });

  // put a decoration down inside (the gift pot, made), from the build menu's piece in hand
  await page.evaluate(() => {
    const g = window.solarbloom;
    const sv = g.sim.state.salvage;
    sv.decorMade = [...new Set([...(sv.decorMade ?? []), 'pot', 'flowerbed', 'bench'])].sort();
  });
  await stand(page, 'house', 2.5, 3.5, Math.PI, 1500);
  await page.evaluate(() => window.solarbloom.selectTool('decor:pot'));
  await wait(1500);
  await press(page, await keyOf(page, 'pulse'));
  await page.waitForFunction(() => !!window.solarbloom.cozy.decorAt('house', 2, 2), null, { timeout: 60_000, polling: 300 }).catch(() => {});
  const placed = await page.evaluate(() => window.solarbloom.cozy.decorAt('house', 2, 2)?.kind ?? null);
  check(placed === 'pot', `a Flower pot goes down on the floor inside (${placed})`);
  await page.evaluate(() => window.solarbloom.selectTool('inspect'));
  // the bed, by day: refused with plain words; the radio: listens
  await stand(page, 'house', 0.5, 2.5, Math.PI, 1500);
  p = await prompt(page);
  check(/Sleep until morning/.test(p) || /bed is for the night/i.test(p), `facing the bed: "${p}"`);
  const radioX = await page.evaluate(() => window.solarbloom.sim.house.furniture().find((f) => f.id === 'radio').x);
  await stand(page, 'house', radioX + 0.5, 1.5, Math.PI, 1500);
  p = await prompt(page);
  check(/Listen to the radio/.test(p), `facing the radio: "${p}"`);
  await stand(page, 'house', 5.5, 1.5, Math.PI, 1500);
  p = await prompt(page);
  check(/Open the chest/.test(p), `facing the chest: "${p}"`);
  await page.screenshot({ path: `${dir}/inside-1-decorated.png` });

  // out again
  await stand(page, 'house', 3.5, 4.5, 0, 1500);
  p = await prompt(page);
  check(/Go outside/.test(p), `at the door inside: "${p}"`);
  await press(page, interact);
  await wait(2500);
  s = await page.evaluate(() => ({ roof: window.solarbloom.bot.pose.roofId, indoors: window.solarbloom.camera.isIndoors, shown: !!window.solarbloom.houseInside?.visible }));
  check(s.roof === 'g' && !s.indoors && !s.shown, 'out on the doorstep, the outdoor camera back, the room hidden');

  // the Cottage, the House and the Home: each its own look, each room bigger
  const names = ['', 'shed', 'cottage', 'house', 'home'];
  for (const level of [2, 3, 4]) {
    await page.evaluate(() => window.solarbloom.sim.house.giveAll());
    await page.waitForFunction((l) => window.solarbloom.sim.house.level === l, level, { timeout: 60_000 });
    await houseShot(page, `house-${level}-${names[level]}.png`);
    if (level === 3) await gardenShot(page, 'house-3-garden.png');
    await stand(page, 'g', 4.5, 6.5, Math.PI, 1500);
    await press(page, interact);
    await wait(4000);
    s = await page.evaluate(() => ({ roof: window.solarbloom.bot.pose.roofId, room: window.solarbloom.sim.grid.layer('house')?.width, furniture: window.solarbloom.sim.house.furniture().map((f) => f.id).join(',') }));
    check(s.roof === 'house' && s.room === [0, 6, 8, 10, 12][level], `the ${names[level]}: a ${s.room} × ${s.room} room (${s.furniture})`);
    await page.screenshot({ path: `${dir}/inside-${level}-${names[level]}.png` });
    if (level === 2) {
      const shelf = await page.evaluate(() => window.solarbloom.sim.house.furniture().find((f) => f.id === 'shelf'));
      await stand(page, 'house', shelf.x - 0.5, shelf.z + 0.5, Math.PI / 2, 1500);
      p = await prompt(page);
      check(/Look at the keepsake shelf/.test(p), `facing the shelf: "${p}"`);
      await stand(page, 'house', 1.5, 3.5, -Math.PI / 2, 1500);
      p = await prompt(page);
      check(/Read your journal/.test(p), `facing the desk: "${p}"`);
    }
    await page.evaluate(() => window.solarbloom.exitHouse());
    await wait(1500);
  }
  const pot = await page.evaluate(() => window.solarbloom.cozy.decorations().filter((d) => d.roofId === 'house').length);
  check(pot >= 1, `the pot placed inside is still there after three growths (${pot} inside)`);

  // the Home: Go home from far away, in the menu
  await stand(page, 'g', 9.5, 12.5, 0, 1500);
  // Esc puts the tool in hand back first (the game's own order), then opens the menu
  for (let i = 0; i < 4 && !(await page.evaluate(() => document.querySelector('#menu')?.classList.contains('open'))); i++) {
    await page.keyboard.press('Escape');
    await wait(800);
  }
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('open'), null, { timeout: 30_000 });
  const homeBtn = await page.evaluate(() => !document.querySelector('#menu-home')?.hidden);
  check(homeBtn, 'the menu offers "Go home" once the house is a Home');
  await page.screenshot({ path: `${dir}/menu-go-home.png` });
  await page.click('#menu-home');
  await wait(2500);
  s = await page.evaluate(() => ({ x: window.solarbloom.bot.pose.x, z: window.solarbloom.bot.pose.z, roof: window.solarbloom.bot.pose.roofId }));
  check(s.roof === 'g' && Math.abs(s.x - 4.5) < 0.6 && Math.abs(s.z - 5.6) < 0.8, `"Go home" brings Bloombot to its doorstep (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);

  // a reload keeps it all
  await page.evaluate(() => window.solarbloom.saveNow?.());
  await page.goto(`http://localhost:${PORT}/?slot=1&gfx=low`);
  await waitForGame(page);
  await wait(3000);
  s = await page.evaluate(() => ({ level: window.solarbloom.sim.house.level, room: window.solarbloom.sim.grid.layer('house')?.width, inside: window.solarbloom.cozy.decorations().filter((d) => d.roofId === 'house').length }));
  check(s.level === 4 && s.room === 12 && s.inside >= 1, `after a reload: the Home, its room and what stands in it (${JSON.stringify(s)})`);
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

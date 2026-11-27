// Epic #845: the house's rooms in the real game. Bloombot walks (for real, cell by cell) from the front door into
// every room and up to every piece of furniture, reads each prompt, puts a decoration down in each room, and comes
// back to the door. Each room is photographed with no player decorations, and with the camera seeing over the walls.
//   #860: the House has a kitchen, the Home a kitchen and a bedroom; inner walls sink while they stand between the
//         camera and Bloombot; a game saved in the kitchen comes back in the kitchen.
// Screenshots go to SHOTS_DIR (default docs/review/845). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, waitForGame, QUIET_CSS } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/845';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4252);
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
const shot = async (page, file) => {
  const css = await page.addStyleTag({ content: `${QUIET_CSS} #obj, #res { display: none !important; }` });
  await wait(400);
  await page.screenshot({ path: `${dir}/${file}` });
  await css.evaluate((e) => e.remove());
};

/** Walks Bloombot for real to cell (x, z) and faces (fx, fz). True once it is standing there. */
const walkTo = async (page, x, z, fx, fz) => {
  const ok = await page.evaluate(
    ([x, z, fx, fz]) => {
      const g = window.solarbloom;
      g.bot.lastInput = 'keys';
      g.pointer.inside = false;
      window.__arrived = false;
      return g.bot.goToCell(g.bot.pose.roofId, x, z, { x: fx, z: fz }, () => (window.__arrived = true));
    },
    [x, z, fx, fz],
  );
  if (!ok) return false;
  await page.waitForFunction(() => window.__arrived === true, null, { timeout: LONG, polling: 250 }).catch(() => {});
  await wait(1200);
  return page.evaluate(([x, z]) => Math.floor(window.solarbloom.bot.pose.x) === x && Math.floor(window.solarbloom.bot.pose.z) === z, [x, z]);
};

/** Walks to a free square beside a piece of furniture (not through a wall), faces it, and reads the prompt. */
const visit = async (page, id) => {
  const spot = await page.evaluate((id) => {
    const h = window.solarbloom.sim.house;
    const f = h.furniture().find((p) => p.id === id);
    const reach = h.reach();
    for (let x = f.x; x < f.x + f.w; x++)
      for (let z = f.z; z < f.z + f.d; z++)
        for (const [sx, sz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) if (reach.has(`${x + sx},${z + sz}`) && !h.wallBetween(x, z, x + sx, z + sz)) return [x + sx, z + sz, x, z];
    return null;
  }, id);
  if (!spot) return { ok: false, text: 'no square beside it' };
  const ok = await walkTo(page, ...spot);
  return { ok, text: await prompt(page) };
};

/** The room Bloombot stands in, and the inner walls' heights now. */
const where = (page) =>
  page.evaluate(() => {
    const g = window.solarbloom;
    const p = g.bot.pose;
    return { room: g.sim.house.roomAt(Math.floor(p.x), Math.floor(p.z))?.id, walls: g.houseInside.wallHeights().map((h) => +h.toFixed(2)) };
  });

const grow = async (page, level) => {
  await page.evaluate(() => window.solarbloom.exitHouse());
  await wait(800);
  await page.evaluate(() => window.solarbloom.bot.teleport('g', 4.5, 6.5)); // at the door, in reach of the chests
  await wait(1500);
  const why = await page.evaluate((l) => {
    const g = window.solarbloom;
    g.sim.bot = { roofId: 'g', x: 4.5, z: 6.5 }; // where the sim reads Bloombot (it follows the pose each frame)
    for (let i = 0; i < 4 && g.sim.house.level < l; i++) g.sim.house.giveAll();
    return g.sim.house.level < l ? `${g.sim.house.problem()} (pose ${JSON.stringify(g.bot.pose)}, paused ${JSON.stringify(g.pause?.reasons ?? null)})` : '';
  }, level);
  if (why) console.log('  the house did not grow:', why);
  await page.waitForFunction((l) => window.solarbloom.sim.house.level === l, level, { timeout: 60_000 });
  await wait(1500);
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.bot.teleport('g', 4.5, 6.5);
    g.bot.turnTo(Math.PI);
  });
  // through the front door with the real key, once the prompt offers it
  await page.waitForFunction(() => /Go inside/.test(document.getElementById('prompt')?.innerText ?? ''), null, { timeout: 60_000, polling: 300 }).catch(() => {});
  await press(page, await keyOf(page, 'interact'));
  await page.waitForFunction(() => window.solarbloom.bot.pose.roofId === 'house', null, { timeout: 60_000, polling: 300 });
  await wait(5000); // the indoor camera settles
};

const PROMPTS = { bed: /Sleep|bed is for the night/, radio: /Listen to the radio/, chest: /Open the chest/, shelf: /Look at the keepsake shelf/, desk: /Read your journal/ };

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(LONG);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false, noVistas: true } });
  await wait(2000);
  // the fountain's first step and plenty in the chests; the house grown to the Cottage with the real delivery
  await page.evaluate(() => {
    const g = window.solarbloom;
    const sv = g.sim.state.salvage;
    sv.tier = Math.max(1, sv.tier);
    for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone']) sv.store[m] = 999;
  });
  await wait(1500);

  for (const level of [3, 4]) {
    const name = level === 3 ? 'house' : 'home';
    await grow(page, level);
    let w = await where(page);
    check(w.room === 'main', `the ${name}: in through the front door, into the main room`);
    const rooms = await page.evaluate(() => window.solarbloom.sim.house.rooms().map((r) => ({ id: r.id, x: r.x, z: r.z, w: r.w, d: r.d })));
    check(rooms.length === level - 1, `the ${name} has ${rooms.map((r) => r.id).join(', ')}`);
    await shot(page, `${level}-${name}-main.png`);
    for (const r of rooms.slice(1)) {
      // the middle of the room's back half, facing the back wall
      const x = r.x + Math.floor(r.w / 2);
      const z = r.z + 1;
      const there = await walkTo(page, x, z, x, z - 1);
      w = await where(page);
      check(there && w.room === r.id, `walks into the ${r.id} (${w.room})`);
      check(w.walls.some((h) => h < 1), `the wall between the camera and the ${r.id} has sunk (${w.walls.join(', ')})`);
      await shot(page, `${level}-${name}-${r.id}.png`);
    }
    for (const id of await page.evaluate(() => window.solarbloom.sim.house.furniture().map((f) => f.id))) {
      const v = await visit(page, id);
      check(v.ok && (!PROMPTS[id] || PROMPTS[id].test(v.text)), `walks to the ${id}: "${v.text}"`);
    }
    // back to the front door, in the main room, the walls up again
    const door = await page.evaluate(() => window.solarbloom.sim.house.doorInside());
    const back = await walkTo(page, door[0], door[1], door[0], door[1] + 1);
    const p = await prompt(page);
    w = await where(page);
    check(back && /Go outside/.test(p), `walks back to the front door: "${p}"`);
    check(w.walls.every((h) => h > 2), `from the main room the inner walls stand tall (${w.walls.join(', ')})`);
  }

  // a decoration in every room of the Home, put down with Bloombot's own key
  const pulse = await keyOf(page, 'pulse');
  await page.evaluate(() => {
    const sv = window.solarbloom.sim.state.salvage;
    sv.decorMade = [...new Set([...(sv.decorMade ?? []), 'pot', 'houseplant'])].sort();
  });
  for (const [x, z, fx, fz, room] of [
    [5, 8, 5, 7, 'main'],
    [1, 2, 1, 1, 'kitchen'],
    [9, 2, 9, 1, 'bedroom'],
  ]) {
    await walkTo(page, x, z, fx, fz);
    await page.evaluate(() => window.solarbloom.selectTool('decor:houseplant'));
    await wait(1200);
    const before = await page.evaluate(() => window.solarbloom.cozy.insideCount());
    await press(page, pulse);
    await page.waitForFunction((n) => window.solarbloom.cozy.insideCount() > n, before, { timeout: 30_000, polling: 300 }).catch(() => {});
    const placed = await page.evaluate((room) => window.solarbloom.cozy.decorations().filter((d) => d.roofId === 'house' && window.solarbloom.sim.house.roomAt(d.x, d.z)?.id === room).length, room);
    check(placed >= 1, `a houseplant goes down in the ${room}`);
    await page.evaluate(() => window.solarbloom.selectTool('inspect'));
    await wait(600);
  }

  // saved in the kitchen: a reload comes back in the kitchen, its wall sunk for the camera
  await walkTo(page, 1, 1, 1, 0);
  await page.evaluate(() => window.solarbloom.saveNow?.());
  await page.goto(`http://localhost:${PORT}/?slot=1&gfx=low`);
  await waitForGame(page);
  await wait(4000);
  const w = await where(page);
  const kept = await page.evaluate(() => window.solarbloom.cozy.insideCount());
  check(w.room === 'kitchen' && w.walls.some((h) => h < 1), `after a reload Bloombot is still in the kitchen, the wall sunk (${JSON.stringify(w)})`);
  check(kept === 3, `the three houseplants are still there (${kept})`);
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

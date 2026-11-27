// Epic #845: helpers for the house e2e scripts (house-rooms, house-grow-decor): Bloombot walks for real inside the
// house, the house grows with the real delivery, and Bloombot goes in through the front door with the real key.
import { QUIET_CSS } from './start-game.mjs';

/** How long a slow step may take: E2E_TIMEOUT (ms) for slow software-rendered browsers, else 4 minutes. */
const LONG = Number(process.env.E2E_TIMEOUT) || 240_000;

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const keyOf = (page, action) => page.evaluate((a) => window.solarbloom.bindings.keys[a].find((k) => !/^Mouse/.test(k)), action);
export const press = async (page, code) => page.keyboard.press(code.replace(/^Key/, '').replace(/^Digit/, ''));
export const prompt = (page) => page.evaluate(() => document.getElementById('prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
export const shot = async (page, dir, file) => {
  const css = await page.addStyleTag({ content: `${QUIET_CSS} #obj, #res { display: none !important; }` });
  await wait(400);
  await page.screenshot({ path: `${dir}/${file}` });
  await css.evaluate((e) => e.remove());
};

/** Walks Bloombot for real to cell (x, z) and faces (fx, fz). True once it is standing there. */
export const walkTo = async (page, x, z, fx, fz) => {
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
export const visit = async (page, id) => {
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
export const where = (page) =>
  page.evaluate(() => {
    const g = window.solarbloom;
    const p = g.bot.pose;
    // every stretch of inner wall standing across the line from the camera to Bloombot's head (none should)
    const cam = g.camera.entity.getPosition();
    const floor = g.houseInside.floorY();
    const [ox, , oz] = [0, 400, 0];
    const head = { x: ox + p.x, y: floor + 0.6, z: oz + p.z };
    const blocking = g.houseInside.wallsNow().filter(({ line: [x0, z0, x1, z1], h }) => {
      // where the line from the camera to the head crosses the wall's plane
      const alongX = z0 === z1;
      const at = alongX ? oz + z0 : ox + x0;
      const a = alongX ? cam.z : cam.x;
      const b = alongX ? head.z : head.x;
      if ((a - at) * (b - at) > 0 || a === b) return false;
      const t = (at - a) / (b - a);
      const across = alongX ? cam.x + (head.x - cam.x) * t - ox : cam.z + (head.z - cam.z) * t - oz;
      const lo = alongX ? x0 : z0;
      const hi = alongX ? x1 : z1;
      const y = cam.y + (head.y - cam.y) * t;
      return across >= lo && across <= hi && y < floor + h;
    });
    return { room: g.sim.house.roomAt(Math.floor(p.x), Math.floor(p.z))?.id, walls: g.houseInside.wallHeights().map((h) => +h.toFixed(2)), blocking: blocking.length };
  });

export const grow = async (page, level) => {
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
    g.bot.lastInput = 'keys';
    g.pointer.inside = false;
  });
  // through the front door with the real key, once the prompt offers it
  await page.waitForFunction(() => /Go inside/.test(document.getElementById('prompt')?.innerText ?? ''), null, { timeout: 60_000, polling: 300 }).catch(() => {});
  await press(page, await keyOf(page, 'interact'));
  await page.waitForFunction(() => window.solarbloom.bot.pose.roofId === 'house', null, { timeout: 60_000, polling: 300 });
  // the first time in, the indoor shaders compile (slow in a software-rendered browser): wait until the camera has
  // reached Bloombot inside, then let it settle
  await page.waitForFunction(
    () => {
      const g = window.solarbloom;
      const c = g.camera.target;
      return c.y > 300 && Math.hypot(c.x - g.bot.pose.x, c.z - g.bot.pose.z) < 1.5;
    },
    null,
    { timeout: LONG, polling: 500 },
  );
  await wait(2500);
};

export const PROMPTS = { bed: /Sleep|bed is for the night/, radio: /Listen to the radio/, chest: /Open the chest/, shelf: /Look at the keepsake shelf/, desk: /Read your journal/ };

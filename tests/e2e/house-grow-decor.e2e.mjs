// #862 (epic #845): decorations are kept safe when the house grows, in the real game. The House is filled to its
// limit through the game's own placing rules (solid pieces where they shut nothing off, flat ones on the rest),
// then grows to the Home with the real delivery. The Home's furniture moves and its bedroom walls go up: every
// decoration is still there, none was handed back, none stands in furniture, and Bloombot walks for real from the
// front door into every room, up to every piece of furniture and back.
// Screenshots go to SHOTS_DIR (default docs/review/862). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';
import { grow, prompt, PROMPTS, shot as shotIn, visit, wait, walkTo, where } from './lib/house.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/862';
mkdirSync(dir, { recursive: true });
const PROBE = !!process.env.PROBE;
const PORT = Number(process.env.PORT ?? 4252);
const LONG = Number(process.env.E2E_TIMEOUT) || 240_000;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const shot = (page, file) => shotIn(page, dir, file);
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

/** Every decoration inside, as `kind@x,z` (sorted), and what the house's rules say about the floor now. */
const inside = (page) =>
  page.evaluate(() => {
    const g = window.solarbloom;
    const h = g.sim.house;
    const list = g.cozy.decorations().filter((d) => d.roofId === h.layerId);
    const inFurniture = list.filter((d) => h.furnitureAt(d.x, d.z)).map((d) => d.kind);
    return { n: list.length, kinds: list.map((d) => d.kind).sort(), inFurniture, cutOff: h.cutOff()?.id ?? null, limit: h.decorMax() };
  });

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
    sv.decorMade = [...new Set([...(sv.decorMade ?? []), 'houseplant', 'diningtable', 'pot', 'clock', 'sidetable', 'flowerbed', 'roundrug', 'cushions'])].sort();
  });
  await wait(1500);

  // the House, filled to its limit by the game's own rules
  await grow(page, 3);
  const filled = await page.evaluate(() => {
    const g = window.solarbloom;
    const h = g.sim.house;
    const limit = h.decorMax();
    const solid = ['houseplant', 'diningtable', 'pot', 'clock', 'sidetable'];
    const flat = ['flowerbed', 'roundrug', 'cushions'];
    let i = 0;
    for (const t of g.sim.grid.tilesOf(h.layerId)) {
      if (g.cozy.insideCount() >= limit) break;
      if (t.x === Math.floor(g.bot.pose.x) && t.z === Math.floor(g.bot.pose.z)) continue; // not under Bloombot
      for (const kind of [solid[i % solid.length], flat[i % flat.length]]) {
        const no = g.cozy.placeDecor(kind, 0, h.layerId, t.x, t.z);
        if (!no) {
          i++;
          break;
        }
        window.__why = { ...(window.__why ?? {}), [`${kind}: ${no}`]: (window.__why?.[`${kind}: ${no}`] ?? 0) + 1 };
      }
    }
    return g.cozy.insideCount();
  });
  const before = await inside(page);
  check(filled === before.limit, `the House is filled to its limit (${filled} of ${before.limit}; refused: ${JSON.stringify(await page.evaluate(() => window.__why))})`);
  check(before.cutOff === null, `with every room and piece still in reach of the door (${before.cutOff})`);
  await shot(page, '3-house-full.png');
  if (PROBE) throw new Error('probe: stop after filling');

  // grown to the Home with the real delivery; in through the front door with the real key
  // every hand-back the game makes from here on (the toast may be gone before we look)
  await page.evaluate(() => {
    const g = window.solarbloom;
    window.__handedBack = [];
    const hb = g.handBack.bind(g);
    g.handBack = (list) => {
      window.__handedBack.push(...list.map((d) => d.kind));
      return hb(list);
    };
  });
  await grow(page, 4);
  const after = await inside(page);
  const handedBack = await page.evaluate(() => window.__handedBack);
  check(after.n === before.n && JSON.stringify(after.kinds) === JSON.stringify(before.kinds), `grown to the Home, every decoration is still there (${after.n} of ${before.n})`);
  check(handedBack.length === 0, `none was handed back (${handedBack.join(' | ')})`);
  check(after.inFurniture.length === 0, `none stands in the Home's furniture (${after.inFurniture.join(', ')})`);
  check(after.cutOff === null, `every room and piece is in reach of the door (${after.cutOff})`);
  await shot(page, '4-home-grown-full.png');

  // Bloombot walks for real from the door into every room and up to every piece, and back to the door
  const rooms = await page.evaluate(() => window.solarbloom.sim.house.rooms().map((r) => ({ id: r.id, x: r.x, z: r.z, w: r.w, d: r.d })));
  for (const r of rooms.slice(1)) {
    const spot = await page.evaluate((r) => {
      const h = window.solarbloom.sim.house;
      const reach = h.reach();
      for (let z = r.z; z < r.z + r.d; z++) for (let x = r.x; x < r.x + r.w; x++) if (reach.has(`${x},${z}`)) return [x, z];
      return null;
    }, r);
    const there = spot && (await walkTo(page, spot[0], spot[1], spot[0], spot[1] - 1));
    const w = await where(page);
    check(!!there && w.room === r.id, `walks into the ${r.id} (${w.room})`);
    await shot(page, `4-home-grown-${r.id}.png`);
  }
  for (const id of await page.evaluate(() => window.solarbloom.sim.house.furniture().map((f) => f.id))) {
    const v = await visit(page, id);
    check(v.ok && (!PROMPTS[id] || PROMPTS[id].test(v.text)), `walks to the ${id}: "${v.text}"`);
  }
  const door = await page.evaluate(() => window.solarbloom.sim.house.doorInside());
  const back = await walkTo(page, door[0], door[1], door[0], door[1] + 1);
  const p = await prompt(page);
  check(back && /Go outside/.test(p), `walks back to the front door: "${p}"`);
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

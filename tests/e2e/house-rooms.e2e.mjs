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
import { startGame, waitForGame } from './lib/start-game.mjs';
import { grow, keyOf, press, prompt, PROMPTS, shot as shotIn, visit, wait, walkTo, where } from './lib/house.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/845';
mkdirSync(dir, { recursive: true });
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
      check(w.walls.some((h) => h < 1) && w.blocking === 0, `no wall stands between the camera and Bloombot in the ${r.id}: the near one has sunk (${w.walls.join(', ')})`);
      await shot(page, `${level}-${name}-${r.id}.png`);
    }
    for (const id of await page.evaluate(() => window.solarbloom.sim.house.furniture().map((f) => f.id))) {
      const v = await visit(page, id);
      const seen = await where(page);
      check(v.ok && (!PROMPTS[id] || PROMPTS[id].test(v.text)) && seen.blocking === 0, `walks to the ${id}, in view: "${v.text}"`);
    }
    // back to the front door, in the main room, the walls up again
    const door = await page.evaluate(() => window.solarbloom.sim.house.doorInside());
    const back = await walkTo(page, door[0], door[1], door[0], door[1] + 1);
    const p = await prompt(page);
    check(back && /Go outside/.test(p), `walks back to the front door: "${p}"`);
    // the view turned back to its usual angle (looking in from the door's side): every inner wall stands beyond
    // Bloombot, tall
    await page.evaluate(() => window.solarbloom.camera.recentre());
    await wait(3000);
    w = await where(page);
    check(w.walls.every((h) => h > 2), `from the door, looking in, the inner walls stand tall (${w.walls.join(', ')})`);
  }

  // a decoration in every room of the Home, put down with Bloombot's own key
  const pulse = await keyOf(page, 'pulse');
  await page.evaluate(() => {
    const sv = window.solarbloom.sim.state.salvage;
    sv.decorMade = [...new Set([...(sv.decorMade ?? []), 'pot', 'houseplant'])].sort();
  });
  const plants = () => page.evaluate(() => window.solarbloom.cozy.decorations().filter((d) => d.roofId === 'house').map((d) => `${d.kind}@${d.x},${d.z}`).sort());
  const down = []; // each houseplant by its square
  for (const room of ['main', 'kitchen', 'bedroom']) {
    // a square in the room where a houseplant may go (free, and shutting nothing off), with a free square beside it
    // to stand on facing it: asked of the game, not written down, as the rooms' furniture changes
    const spots = await page.evaluate((room) => {
      const g = window.solarbloom;
      const h = g.sim.house;
      const reach = h.reach();
      const out = [];
      for (const t of g.sim.grid.tilesOf('house')) {
        if (t.x === 2 && t.z === 1) continue; // where Bloombot stands to be saved in the kitchen, below
        if (h.roomAt(t.x, t.z)?.id !== room || g.cozy.canDecorate('houseplant', 'house', t.x, t.z) !== undefined) continue;
        for (const [sx, sz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
          const [x, z] = [t.x + sx, t.z + sz];
          if (reach.has(`${x},${z}`) && h.roomAt(x, z)?.id === room && !h.wallBetween(t.x, t.z, x, z) && !g.cozy.decorAt('house', x, z)) out.push([x, z, t.x, t.z]);
        }
      }
      return out;
    }, room);
    let at;
    for (const s of spots.slice(0, 8)) {
      if (!(await walkTo(page, ...s))) continue;
      await page.evaluate(() => window.solarbloom.selectTool('decor:houseplant'));
      await wait(1200);
      const aimed = await page.evaluate(() => window.solarbloom.buildAim().p?.tile);
      if (aimed && aimed.x === s[2] && aimed.z === s[3]) {
        at = s;
        break;
      }
      await page.evaluate(() => window.solarbloom.selectTool('inspect'));
    }
    const before = await plants();
    if (at) {
      await press(page, pulse);
      await page.waitForFunction((n) => window.solarbloom.cozy.insideCount() > n, before.length, { timeout: 30_000, polling: 300 }).catch(() => {});
    }
    const after = await plants();
    const sq = at && `houseplant@${at[2]},${at[3]}`;
    check(!!sq && after.includes(sq) && after.length === before.length + 1 && before.every((p) => after.includes(p)), `a houseplant goes down in the ${room} (${sq ?? 'no spot'}), and nothing else moves`);
    if (sq) down.push(sq);
    await page.evaluate(() => window.solarbloom.selectTool('inspect'));
    await wait(600);
  }
  const saved = await plants();

  // saved in the kitchen: a reload comes back in the kitchen, its wall sunk for the camera
  const inKitchen = await walkTo(page, 2, 1, 2, 0);
  check(inKitchen, 'walks back into the kitchen');
  await page.evaluate(() => window.solarbloom.saveNow?.());
  await page.goto(`http://localhost:${PORT}/?slot=1&gfx=low`);
  await waitForGame(page);
  await wait(4000);
  const w = await where(page);
  const kept = await plants();
  check(w.room === 'kitchen' && w.walls.some((h) => h < 1) && w.blocking === 0, `after a reload Bloombot is still in the kitchen, in view (${JSON.stringify(w)})`);
  check(down.length === 3 && down.every((p) => kept.includes(p)) && JSON.stringify(kept) === JSON.stringify(saved), `the three houseplants are still in their squares (saved ${saved.join(' ')}; loaded ${kept.join(' ')})`);
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

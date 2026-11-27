// E25 (#626): the second levels of Bloombot's moves, played in a real game on the Deck (1280 × 800, ?gfx=deck) at 150%
// interface size, into docs/review/move-levels/ (or argv[2]).
//   npm run build && GPU=1 node tests/e2e/move-levels-shots.mjs [outDir]
// Each place a level II move is for, with the follow camera behind Bloombot: the prompt before the second level (it
// says why not and where to get it), the prompt with it, the trip part way, where it lands, the stash there opened,
// and the way back. Then a vault forced with Pry II, and the Bloombot page's new group. Fails on any page error, a
// prompt that reads wrong, a trip that doesn't land, or a stash or vault that gives nothing.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/move-levels';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4226);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, `http://localhost:${port}`, { slot: 3, query: 'gfx=deck', settings: { uiScale: 150 } });

  // late in a game: every move learned, the city open (not yet brought back to life), a bright morning
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const sv = s.state.salvage;
    g.pause.clear('blur');
    s.pulseLoad.introduced(); // the load wheel's first-time introduction was seen long ago
    sv.tier = 4;
    for (const a of ['prune', 'hover', 'climb', 'glide']) if (!sv.abilities.includes(a)) sv.abilities.push(a);
    for (const r of ['mastRow', 'oldMarket', 'saltwind', 'elderGrove', 'cistern', 'clockPlaza', 'terraces', 'glasshouse', 'observatory', 'spireHeights']) s.gates.openRegion(r);
    // and the backstreets these places stand in or beside (the cliff east of the beach)
    for (const [x, z] of [[22, 47], [29, 21], [24, -10], [8, 48], [8, 55], [22, 54], [-8, 27]]) {
      const id = s.areas.map.areaOfCell(x, z);
      if (s.areas.fog(id) === 'hidden') s.gates.openRegion(id);
    }
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.36 - s.clock.dayFraction()) * 2880;
    g.updateCityBounds?.();
  });
  await page.addStyleTag({ content: '#obj { visibility: hidden !important; }' });

  /** Puts Bloombot on a cell facing a way (radians: 0 south, π north, π/2 east, −π/2 west), the camera behind it. */
  const stand = async (x, z, facing) => {
    await page.evaluate(({ x, z, facing }) => {
      const g = window.solarbloom;
      g.bot.teleport('g', x, z);
      Object.assign(g.bot.pose, { x, z, facing });
      g.camera.turnTo((facing * 180) / Math.PI + 180, true);
    }, { x, z, facing });
    await page.waitForTimeout(2200);
  };
  const prompt = () => page.evaluate(() => document.querySelector('#prompt')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  const pose = () => page.evaluate(() => {
    const p = window.solarbloom.bot.pose;
    return { x: p.x, z: p.z };
  });
  const level2 = (a) => page.evaluate((a) => {
    const s = window.solarbloom.sim;
    s.state.salvage.research ??= { analysed: [], done: [], running: [], levels: {} };
    const id = s.research.moveProject(a).id;
    if (!s.state.salvage.research.done.includes(id)) s.state.salvage.research.done.push(id);
  }, a);
  const shot = async (name) => {
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  · ${dir}/${name}.png`);
  };
  const toast = () => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).pop() ?? '');
  /** Presses Interact, shoots the trip part way and where it lands. */
  const go = async (name, to) => {
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(500);
    const mid = await page.evaluate(() => window.solarbloom.bot.riding);
    check(mid, `${name}: Bloombot is on its way`);
    await shot(`${name}-mid`);
    await page.waitForFunction(() => !window.solarbloom.bot.riding, null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    const p = await pose();
    check(Math.floor(p.x) === to[0] && Math.floor(p.z) === to[1], `${name}: lands on ${to} (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  };
  /** Faces a stash, opens it, checks what it gave. */
  const stash = async (name, at, facing, id, item) => {
    await stand(at[0], at[1], facing);
    const p = await prompt();
    check(/Open\s*the stash/.test(p), `${name}: the prompt offers the stash ("${p}")`);
    // from a little to one side, so the box shows past Bloombot
    await page.evaluate((f) => window.solarbloom.camera.turnTo((f * 180) / Math.PI + 180 + 40, true), facing);
    await page.waitForTimeout(900);
    await shot(`${name}-stash-shut`);
    const before = await page.evaluate((m) => window.solarbloom.sim.inventory.count(m), item);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(1200);
    const after = await page.evaluate((m) => window.solarbloom.sim.inventory.count(m), item);
    const opened = await page.evaluate((id) => window.solarbloom.sim.state.salvage.caches.includes(id), id);
    const t = await toast();
    check(after > before && opened, `${name}: the stash gives ${item} ${before} → ${after}, once`);
    check(/Someone left these here/.test(t), `${name}: a line says what was in it ("${t}")`);
    await shot(`${name}-stash`);
  };

  // ── Hover II: from the jetty's end out to the sandbar ──
  await stand(8.5, 48.5, 0);
  let p = await prompt();
  check(/Hover over to\s*the sandbar/.test(p) && /Too far to hover yet\. The crafting table in the house can work out Hover II\./.test(p), `hover: before Hover II the prompt says why not ("${p}")`);
  await shot('hover-1-before');
  await level2('hover');
  await page.waitForTimeout(400);
  p = await prompt();
  check(/Hover over to\s*the sandbar/.test(p) && !/Too far/.test(p), `hover: with Hover II it offers the trip ("${p}")`);
  await shot('hover-2-prompt');
  // the sandbar from the jetty, wide: wet sand with stones and a log on it, not glowing like a pickup
  await page.evaluate(() => window.solarbloom.camera.jumpZoom?.(window.solarbloom.camera.maxZoom));
  await page.waitForTimeout(1200);
  await shot('hover-2b-from-jetty');
  await go('hover-3', [8, 54]);
  await shot('hover-4-sandbar');
  await stash('hover-5', [8.5, 56.5], Math.PI / 2, 's-sandbar', 'glass');
  await stand(8.5, 54.5, Math.PI);
  p = await prompt();
  check(/Hover back to\s*the jetty/.test(p), `hover: the way back ("${p}")`);
  await go('hover-6-back', [8, 48]);

  // ── Glide II: from the cliff east of the beach out to the old pier, then down to the sandbar ──
  await stand(22.5, 47.5, 0);
  p = await prompt();
  check(/Glide over to\s*the old pier/.test(p) && /Too far to glide yet/.test(p), `glide: before Glide II ("${p}")`);
  await shot('glide-1-before');
  await level2('climb');
  await level2('glide');
  await page.waitForTimeout(400);
  p = await prompt();
  check(/Glide over to\s*the old pier/.test(p) && !/Too far/.test(p), `glide: with Glide II ("${p}")`);
  await shot('glide-2-prompt');
  await go('glide-3', [22, 53]);
  await shot('glide-4-pier');
  await stash('glide-5', [21.5, 55.5], Math.PI / 2, 's-oldPier', 'sunstone');
  await stand(21.5, 54.5, -Math.PI / 2);
  p = await prompt();
  check(/Glide down to\s*the sandbar/.test(p), `glide: down to the sandbar ("${p}")`);
  await shot('glide-6-down-prompt');
  await go('glide-7-down', [10, 55]);
  await shot('glide-8-sandbar');

  // ── Climb II: up an old roof in the Old Market, on up to the top roof, and down ──
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    const d = s.state.salvage.research.done;
    d.splice(d.indexOf('rb-climb2'), 1);
  });
  await stand(28.5, 21.5, Math.PI / 2);
  await stand(29.5, 21.5, Math.PI / 2);
  p = await prompt();
  check(/Climb up onto\s*the old roof/.test(p) && /There's no ladder here/.test(p), `climb: before Climb II ("${p}")`);
  await shot('climb-1-before');
  await level2('climb');
  await page.waitForTimeout(400);
  await go('climb-2', [30, 21]);
  await shot('climb-3-roof');
  await stand(32.5, 21.5, Math.PI / 2);
  p = await prompt();
  check(/Climb up onto\s*the top roof/.test(p), `climb: on up to the top roof ("${p}")`);
  await go('climb-4', [33, 21]);
  await stash('climb-5', [33.5, 20.5], Math.PI / 2, 's-marketRoof', 'gears');
  await stand(30.5, 21.5, -Math.PI / 2);
  p = await prompt();
  check(/Climb down/.test(p), `climb: down off the edge ("${p}")`);
  await go('climb-6-down', [29, 21]);
  await shot('climb-7-down');

  // the two ruins from the square, and the boathouse from the quay: old buildings, not plinths
  await stand(26.5, 25.5, Math.PI / 2 + 0.6);
  await shot('climb-8-ruins');
  await stand(-5.5, 31.5, Math.PI);
  await shot('climb-9-boathouse');

  // ── Pry II: a vault in Mast Row ──
  await stand(24.5, -9.5, Math.PI);
  p = await prompt();
  check(/Hold\s*Pry open the vault door/.test(p) && /too heavy to pry open yet/.test(p), `vault: before Pry II ("${p}")`);
  await shot('vault-1-before');
  await level2('prune');
  await page.waitForTimeout(400);
  p = await prompt();
  check(/Hold\s*Pry open the vault door/.test(p) && !/too heavy/.test(p), `vault: with Pry II ("${p}")`);
  const copper = await page.evaluate(() => window.solarbloom.sim.inventory.count('copper'));
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(1500);
  await shot('vault-2-prying');
  await page.waitForTimeout(2300);
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(800);
  const got = await page.evaluate(() => window.solarbloom.sim.inventory.count('copper'));
  const t = await toast();
  check(got > copper, `vault: forced, it gives Copper ${copper} → ${got}`);
  check(/The vault door gives/.test(t) && /Inside:/.test(t), `vault: a line says what was inside ("${t}")`);
  await shot('vault-3-open');

  // ── the Bloombot page: the second levels ──
  await page.evaluate(() => {
    const h = window.solarbloom.hud;
    h.toggleBackpack(true);
    h.backpack.show('bloombot', true);
  });
  await page.waitForTimeout(400);
  await page.focus('#bb-pry2');
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#bpScreen .bb-row')].map((r) => `${r.querySelector('.bb-name')?.textContent} · ${r.querySelector('.bb-state')?.textContent}`));
  check(rows.slice(4, 8).join(' | ') === 'Pry II · Learned | Hover II · Learned | Climb II · Learned | Glide II · Learned', `page: the second levels, learned (${rows.slice(4, 8).join(' | ')})`);
  const detail = await page.evaluate(() => document.querySelector('#bpScreen .bb-detail')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  check(/Pry II/.test(detail) && /Where to use it/i.test(detail) && /old vaults to open in Mast Row/.test(detail) && /Show me where/.test(detail), `page: Pry II says where it's used, with Show me where ("${detail}")`);
  await shot('page-late');
  // at Deck 150% a detail taller than its column scrolls (#655): Enter on the row steps to the detail's end (Show me
  // where, or its last lines), and the last line of "Where to use it" comes into view, as it does for every second level
  for (const id of ['pry2', 'hover2', 'climb2', 'glide2']) {
    await page.focus(`#bb-${id}`);
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(450);
    const end = await page.evaluate(() => {
      const d = document.querySelector('#bpScreen .bb-detail').getBoundingClientRect();
      const how = document.querySelector('#bpScreen #bb-how');
      const h = how.getBoundingClientRect();
      const a = document.activeElement;
      return { focus: a.id, howBottom: Math.round(h.bottom), detailTop: Math.round(d.top), detailBottom: Math.round(d.bottom), how: how.textContent.trim() };
    });
    check(end.howBottom <= end.detailBottom + 1 && end.howBottom > end.detailTop, `page: Enter on ${id} reaches the end of its detail, its last line in view (${JSON.stringify(end)})`);
    if (id === 'pry2') {
      check(/and Saltwind\.$/.test(end.how), `page: Pry II's last line is "...and Saltwind." ("${end.how}")`);
      await shot('page-late-end');
    }
  }
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.salvage.research.done = s.state.salvage.research.done.filter((id) => !/^rb-\w+2$/.test(id));
    s.state.salvage.abilities = ['prune', 'hover'];
    s.state.salvage.keepers.k = { step: 'request1' };
    window.solarbloom.hud.backpack.show('bloombot', true);
  });
  await page.waitForTimeout(400);
  await page.focus('#bb-pry2');
  await page.waitForTimeout(300);
  const d2 = await page.evaluate(() => document.querySelector('#bpScreen .bb-detail')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  check(/start “Pry bar” in its Research tab\. Then Bloombot learns it\./.test(d2), `page: Pry II open at the workshop says where to start it ("${d2}")`);
  await shot('page-open-at-workshop');

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

// #785: fruit trees you can actually harvest, in the real built game.
//  - a row of fruit trees, one at each stage of the day: just planted (small, growing), picked clean, in flower,
//    small green fruit, nearly ripe, ripe, and ripe but overgrown (shaggy): screenshots of each, and of the row;
//  - a tree planted for real grows up, flowers and has ripe fruit within one game day (48 minutes of play);
//  - at a ripe tree the prompt reads "Pick the ripe fruit" (a hold), the hover tip says it's ripe and to hold the
//    player's own key; holding Interact puts the fruit in the backpack (with the picking act and a fly-up);
//  - the picked tree shows no fruit until it regrows; the prompt says so;
//  - the fruit's progress saves: a reload keeps it where it was, and it ripens on from there.
// Screenshots go to SHOTS_DIR (default docs/review/785). Run after `vite build` (npm run test:fruit-trees).
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, waitForGame, QUIET_CSS } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/785';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4261);
const TIMEOUT = Number(process.env.E2E_TIMEOUT) || 240_000;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 2880;
/** Clean shots: no toasts, and not the seed wheel's one-time introduction (it shows when Seeds first reach the backpack). */
const CLEAN = `${QUIET_CSS} #loadWheel { display: none !important; }`;

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  /** Runs a function in the page with the game (`g`) and sim (`s`) in scope. */
  const game = (fn, arg) => page.evaluate(({ src, arg }) => new Function('g', 's', 'arg', `return (${src})(g, s, arg)`)(window.solarbloom, window.solarbloom.sim, arg), { src: fn.toString(), arg });
  /** The prompt as the next drawn frame leaves it. */
  const framePrompt = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(document.getElementById('prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '')))));
  const promptFor = async (re) => {
    let t = '';
    for (const until = Date.now() + 90_000; Date.now() < until; ) {
      t = await framePrompt();
      if (re.test(t)) return t;
      await wait(500);
    }
    return t;
  };
  const snap = async (name, clip) => {
    await page.screenshot({ path: `${dir}/${name}.png`, clip, timeout: TIMEOUT });
    console.log(`  📷 ${dir}/${name}.png`);
  };
  /** Passes game days for the farm systems only (the rest of the world is left alone). */
  const days = (n) =>
    game((g, s, n) => {
      for (let i = 0, steps = Math.round((n * 2880) / 30); i < steps; i++) {
        s.state.time += 30;
        s.farmExtras.tick(30);
      }
    }, n);
  /** Stands Bloombot just south of a tree, facing it, the camera behind and close in. */
  const face = (m, zoom = 0) =>
    game((g, s, { m, zoom }) => {
      g.bot.teleport('g', m.x + 0.5, m.z + 1.5);
      Object.assign(g.bot.pose, { roofId: 'g', x: m.x + 0.5, z: m.z + 1.5, facing: Math.PI });
      g.bot.walk = undefined;
      g.camera.turnTo(25, true);
      g.zoomStep = zoom; // the bot camera's zoom step (0: the close view)
    }, { m, zoom });

  await startGame(page, `http://localhost:${PORT}`, { settings: { hints: false } });
  await page.addStyleTag({ content: CLEAN });
  await wait(3000);

  // A row of eight free squares of ground near Bloombot, with free ground south of them to stand on: green it, and
  // hand over the fruit tree (Moss, Elder Grove) and what it costs.
  const row = await game((g, s) => {
    s.state.salvage.keepers.moss ??= { step: 'request1' };
    const free = (x, z) => {
      const t = s.grid.get('g', x, z);
      return t && !t.blocked && !t.occupantId && t.feature !== 'water' && !s.salvage.pileAt(x, z) && !s.cozy?.plotUnder?.('g', x, z, 1);
    };
    const bx = Math.floor(g.bot.pose.x), bz = Math.floor(g.bot.pose.z);
    for (let r = 2; r < 40; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const x0 = bx + dx, z0 = bz + dz;
          let ok = true;
          for (let i = 0; i < 8 && ok; i++) for (const z of [z0 - 1, z0, z0 + 1, z0 + 2]) ok = free(x0 + i, z);
          if (!ok) continue;
          for (let i = -1; i < 9; i++)
            for (const z of [z0 - 1, z0, z0 + 1, z0 + 2]) {
              const t = s.grid.get('g', x0 + i, z);
              if (t && free(t.x, t.z)) s.restoration.complete(t, 'pulse');
            }
          // the game itself must agree a tree can stand on every square (props like vents don't block a walk)
          let fits = true;
          for (let i = 0; i < 8 && fits; i++) { const c = s.build.check('orchard', 'g', x0 + i, z0); fits = !!(c.ok || c.spotOk); }
          if (fits) return { x0, z0 };
        }
    return null;
  });
  check(!!row, `found a row of free ground for the trees (${JSON.stringify(row)})`);
  const plant = (x, z) =>
    game((g, s, { x, z }) => {
      for (const [k, v] of Object.entries(s.build.recipe('orchard') ?? {})) {
        s.inventory.add(k, v);
        s.inventory.addToStore(k, v);
      }
      const m = s.build.place('orchard', 'g', x, z);
      return m ? { id: m.id, x: m.x, z: m.z } : { why: s.build.check('orchard', 'g', x, z).reason };
    }, { x, z });

  // ── one tree planted for real: it grows up and fruits within a game day ──
  const tree = await plant(row.x0 + 7, row.z0);
  check(!!tree.id, `planted a fruit tree (${tree.why ?? tree.id})`);
  if (!tree.id) throw new Error('no fruit tree to test');
  await face(tree);
  let p = await promptFor(/Fruit Tree: still growing/);
  check(/Look at the Fruit Tree: still growing/.test(p), `just planted, the prompt says it's growing: "${p}"`);
  await snap('01-just-planted');
  const scale = () => game((g, s, id) => g.crops.trees.get(id)?.shown ?? 0, tree.id);
  const s0 = await scale();
  await days(0.3);
  await wait(2500);
  const s1 = await scale();
  check(s0 > 0 && s1 > s0 + 0.3, `it grows up on screen (drawn at ${s0.toFixed(2)}, then ${s1.toFixed(2)})`);
  const ph = await game((g, s, id) => s.farmExtras.fruitPhase(s.machine(id)), tree.id);
  check(ph === 'blossom', `grown, it flowers (${ph})`);
  p = await promptFor(/in flower/);
  check(/Look at the Fruit Tree: in flower/.test(p), `the prompt: "${p}"`);
  await snap('02-grown-in-flower');
  await days(0.72);
  const ripeAt = await game((g, s, id) => ({ ripe: s.farmExtras.fruitReady(s.machine(id)), age: s.farmExtras.st(id).age }), tree.id);
  check(ripeAt.ripe && ripeAt.age <= 1.05, `ripe within a game day of planting (${ripeAt.age.toFixed(2)} days)`);

  // ── the row: every stage of a day side by side ──
  const looks = [
    ['young', { age: 0.06, growing: 0.06 }],
    ['bare', { age: 2, growing: 0.02, crops: 2 }],
    ['blossom', { age: 2, growing: 0.22, crops: 2 }],
    ['green', { age: 2, growing: 0.5, crops: 2 }],
    ['nearly', { age: 2, growing: 0.86, crops: 2 }],
    ['ripe', { age: 2, ready: 1, crops: 2 }],
    ['ripe overgrown', { age: 6, sincePrune: 5, ready: 1, crops: 5, overgrownCrop: true }],
  ];
  const trees = [];
  for (const [i, [name, st]] of looks.entries()) {
    const t = await plant(row.x0 + i, row.z0);
    if (!t.id) {
      check(false, `planted the ${name} tree (${t.why})`);
      continue;
    }
    await game((g, s, { id, st }) => {
      s.state.salvage.extras[id] = { ...st, sincePrune: st.sincePrune ?? 1 };
      s.bus.emit('farm.machine', { machineId: id });
    }, { id: t.id, st });
    trees.push({ ...t, name });
  }
  const phases = await game((g, s, ids) => ids.map((id) => s.farmExtras.fruitPhase(s.machine(id))), trees.map((t) => t.id));
  check(phases.join(',') === 'young,bare,blossom,green,nearly,ripe,ripe', `each tree shows its stage (${phases.join(', ')})`);
  await game((g, s, { x, z }) => {
    g.bot.teleport('g', x, z);
    Object.assign(g.bot.pose, { roofId: 'g', x, z, facing: Math.PI });
    g.camera.turnTo(20, true);
    g.zoomStep = 1;
  }, { x: row.x0 + 3.5, z: row.z0 + 2.5 });
  await wait(4000);
  await snap('03-a-day-of-fruit-row');
  for (const t of trees) {
    await face(t, 0);
    await wait(2500);
    await snap(`04-tree-${t.name.replace(/ /g, '-')}`);
  }

  // ── a ripe tree: the prompt, the hover tip, then holding Interact picks it ──
  const ripe = trees.find((t) => t.name === 'ripe');
  await face(ripe);
  p = await promptFor(/Pick the ripe fruit/);
  check(/Hold Pick the ripe fruit/.test(p) && !/\{/.test(p), `at a ripe tree the prompt asks for a hold: "${p}"`);
  // the hover tip: in Bloombot's play the pointer has a tip over the world in the map's overview (M), so open it
  // and rest the pointer on the tree
  await game((g) => g.toggleOverview());
  await wait(3000);
  let tip = '';
  for (let k = 0; k < 25 && !/Fruit Tree/.test(tip); k++) {
    const at = await game((g, s, m) => g.botTileScreen(s.grid.get('g', m.x, m.z)), ripe);
    await page.mouse.move(at.x + (k % 3) - 1, at.y + 1 + (k % 2));
    await wait(500);
    tip = await page.evaluate(() => (getComputedStyle(document.getElementById('tip')).display !== 'none' ? document.getElementById('tip').innerText.replace(/\s+/g, ' ').trim() : ''));
  }
  check(/Ripe fruit/.test(tip) && /Hold .+ to pick it/.test(tip) && !/\{/.test(tip), `the hover tip says it's ripe and to hold the key: "${tip}"`);
  await snap('05-ripe-hover-tip');
  await page.mouse.move(5, 5);
  await game((g) => g.toggleOverview());
  await wait(1500);
  await face(ripe);
  await promptFor(/Pick the ripe fruit/);
  await snap('06-ripe-prompt');
  const key = (await page.evaluate(() => window.solarbloom.bindings.keys.interact[0])).replace(/^Key/, '');
  const before = await game((g, s) => s.inventory.count('fruit') + s.inventory.stored('fruit'));
  await page.keyboard.down(key);
  await wait(450);
  const acting = await game((g) => g.bot.visuals.acting ?? '');
  await snap('07-picking');
  let after = before;
  for (let k = 0; k < 30 && after === before; k++) {
    await wait(300);
    after = await game((g, s) => s.inventory.count('fruit') + s.inventory.stored('fruit'));
  }
  await page.keyboard.up(key);
  check(after - before === 4, `holding Interact picks the fruit into the backpack (+${after - before} Fruit)`);
  check(/harvest/.test(acting), `Bloombot acts out the picking while it lasts (${acting})`);
  await wait(600);
  await snap('08-picked-fly-up');
  const bare = await game((g, s, id) => ({ phase: s.farmExtras.fruitPhase(s.machine(id)), shown: s.farmExtras.fruitShown(s.machine(id)) }), ripe.id);
  check(bare.phase === 'bare' && bare.shown === 0, `the picked tree shows no fruit (${bare.phase})`);
  p = await promptFor(/picked clean/);
  check(/Look at the Fruit Tree: picked clean/.test(p), `the prompt says so: "${p}"`);
  await wait(1500);
  await snap('09-picked-bare');

  // ── saves: the fruit's progress survives a reload, and it ripens on from there ──
  await days(0.5);
  const saved = await game((g, s, id) => ({ st: s.farmExtras.st(id), phase: s.farmExtras.fruitPhase(s.machine(id)) }), ripe.id);
  await page.evaluate(() => window.solarbloom.saveNow?.());
  await wait(500);
  await page.goto(`http://localhost:${PORT}/?slot=1`);
  await waitForGame(page);
  await page.addStyleTag({ content: CLEAN });
  await wait(2500);
  const loaded = await game((g, s, id) => ({ st: s.farmExtras.st(id), phase: s.farmExtras.fruitPhase(s.machine(id)) }), ripe.id);
  check(Math.abs((loaded.st.growing ?? 0) - (saved.st.growing ?? 0)) < 0.01 && loaded.phase === saved.phase, `after a reload the fruit is where it was (${saved.phase}, ${(saved.st.growing ?? 0).toFixed(2)} → ${loaded.phase}, ${(loaded.st.growing ?? 0).toFixed(2)})`);
  await face(ripe);
  await wait(2500);
  await snap('10-after-reload');
  await days(0.52);
  const again = await game((g, s, id) => s.farmExtras.fruitReady(s.machine(id)), ripe.id);
  check(again, 'and it ripens again a day after it was picked');
  await wait(2500);
  await snap('11-ripe-again');
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

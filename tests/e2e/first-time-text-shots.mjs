// #610 (E24): the story's lines rewritten for a first-time player, at 1280 × 800 and 150% interface size, to check
// each reads well and fits its box. Run after `vite build`: GPU=1 node tests/e2e/first-time-text-shots.mjs
// Shots go to docs/review/e24-first-time-text/ (SHOTS_DIR to change).
// - guide-first: the first guide line of a new game (the glinting piles)
// - card-rubble: the goal card once the fountain wakes, before the first pry
// - keeper-asleep / keeper-stirred / keeper-ask: a Keeper's bubble before it wakes (no name yet) and its first ask
// - toast-step2: the fountain's second step, in sentences
// - toast-park1: the park's first quarter
// - refusal-water: the deep water's refusal, pointing at the goal card
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/e24-first-time-text';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4256);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
/** every visible text box on screen is whole (nothing cut off or off screen) */
const whole = (page, sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.hidden) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && el.scrollHeight <= el.clientHeight + 1;
  }, sel);
const clearToasts = (page) => page.evaluate(() => document.querySelectorAll('#toasts > *').forEach((t) => t.remove()));

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await startGame(page, `http://localhost:${port}`, { settings: { uiScale: 150 } });
  await page.waitForTimeout(2500);

  // 1. the first guide line, as a new game shows it
  await page.waitForFunction(() => !!window.solarbloom.hud.guide.lastText, null, { timeout: 15000 }).catch(() => {});
  const g1 = await page.evaluate(() => window.solarbloom.hud.guide.lastText);
  check(/^Hold .+ beside a glinting pile to dig out what the fountain needs\.$/.test(g1), `the first guide line ("${g1}")`);
  check(await whole(page, '#guide'), 'the guide line sits whole on screen');
  await page.screenshot({ path: `${dir}/guide-first.png` });

  // 2. the goal card once the fountain wakes, before the first pry
  await page.evaluate(() => {
    const sv = window.solarbloom.sim.state.salvage;
    sv.tier = Math.max(sv.tier, 1);
    if (!sv.abilities.includes('pry')) sv.abilities.push('pry');
    window.solarbloom.hud.guide.hide();
  });
  await page.waitForTimeout(1500);
  const card = await page.evaluate(() => ({ title: document.querySelector('#objTitle')?.textContent, why: document.querySelector('#objWhy')?.textContent, next: document.querySelector('#objNext')?.textContent }));
  check(card.title === 'Pry open the rubble' && card.why === 'Another robot like Bloombot is asleep on the other side', `the card leads to the rubble ("${card.title}" / "${card.why}" / "${card.next}")`);
  check(await whole(page, '#obj'), 'the goal card sits whole on screen');
  await page.screenshot({ path: `${dir}/card-rubble.png` });

  // 3. a Keeper's bubble: asleep (no name yet), stirred, then its first ask once awake. Bloombot stands by Pylon.
  const say = async (name, lines) => {
    await page.evaluate(([name, lines]) => {
      const g = window.solarbloom;
      g.sim.bus.emit('keeper.said', { keeperId: name, lines });
    }, [name, lines]);
    await page.waitForTimeout(700);
    return page.evaluate(() => {
      const b = document.querySelector('.oc-bubble');
      return b && !b.hidden ? b.innerText.replace(/\n+/g, ' / ') : '';
    });
  };
  const pylon = await page.evaluate(() => {
    const g = window.solarbloom;
    const k = g.sim.keepers.def('pylon');
    // stand bloombot beside Pylon, so its bubble is on screen
    g.settings.noVistas = true; // no camera flight when its way opens
    g.sim.gates.open(g.sim.keepers.region('pylon').gate.id, true); // Pylon's way in, open (its street out of the fog)
    g.bot.teleport('g', k.x + 0.5, k.z + 2.5);
    return { say: k.say };
  });
  await page.waitForTimeout(3000);
  const asleep = await say('pylon', pylon.say.asleep);
  check(/^A sleeping robot \/ .*Stand beside it and press .+ to stir it\.$/.test(asleep) && !asleep.includes('Pylon'), `asleep, its bubble has no name ("${asleep}")`);
  await page.screenshot({ path: `${dir}/keeper-asleep.png` });
  const stirred = await say('pylon', pylon.say.stirred);
  check(/Bring me 5 of any one thing, like Scrap or Seeds, then press .+ to talk to me again\.$/.test(stirred), `stirred, it says what wakes it ("${stirred}")`);
  await page.screenshot({ path: `${dir}/keeper-stirred.png` });
  await page.evaluate(() => {
    window.solarbloom.sim.state.salvage.keepers.pylon = { step: 'request1' };
  });
  const ask = await say('pylon', [...pylon.say.woke, ...pylon.say.request1]);
  check(/^Pylon \/ .*The broken pots round the fountain have them/.test(ask), `awake, it names itself and says where to look ("${ask}")`);
  check(await whole(page, '.oc-bubble'), 'the bubble sits whole on screen, at its full width');
  await page.screenshot({ path: `${dir}/keeper-ask.png` });

  // 4. the fountain's second step, as its own toast
  await clearToasts(page);
  await page.evaluate(() => window.solarbloom.sim.bus.emit('fountain.tier', { tier: 2 }));
  await page.waitForFunction(() => [...document.querySelectorAll('#toasts > *')].some((t) => t.innerText.includes('The pump turns')), null, { timeout: 8000 }).catch(() => {});
  const all = await page.evaluate(() => [...document.querySelectorAll('#toasts > *')].map((t) => t.innerText.replace(/\n+/g, ' / ')));
  const step2 = all.find((t) => t.includes('The pump turns')) ?? '';
  check(/New to build: Pollinator Garden and Drone Hub\. Your backpack holds 60 of each thing\./.test(step2), `the step 2 toast reads "${step2}" (toasts: ${all.join(' | ')})`);
  check(await whole(page, '#toasts > *'), 'the step toast sits whole on screen');
  await page.screenshot({ path: `${dir}/toast-step2.png` });

  // 5. the park's first quarter
  await clearToasts(page);
  await page.evaluate(() => window.solarbloom.chunks.onParkStage(1, 0));
  await page.waitForTimeout(700);
  const park = await page.evaluate(() => document.querySelector('#toasts > *')?.innerText.replace(/\n+/g, ' / ') ?? '');
  check(/A quarter of the way there \/ Keep pulsing the ground around the fountain to wake it\.$/.test(park), `the park toast reads "${park}"`);
  await page.screenshot({ path: `${dir}/toast-park1.png` });
  await clearToasts(page);

  // 6. the deep water's refusal: what teaches hover, and where to see what the fountain needs
  const water = await page.evaluate(() => {
    const g = window.solarbloom;
    const sv = g.sim.state.salvage;
    sv.abilities = sv.abilities.filter((a) => a !== 'hover');
    const why = g.sim.gates.problem(g.sim.keepers.region('sluice').gate) // Sluice's way in is the deep water;
    g.hud.showFail(why);
    return why;
  });
  check(/^The water's too deep to wade\. Bloombot learns to hover over water at fountain step 2\. The card at the top left shows what the fountain needs\.$/.test(water ?? ''), `the deep water says "${water}"`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/refusal-water.png` });
  check(!errors.length, `no page errors ${errors.join(' | ')}`);
} catch (e) {
  failures.push(String(e));
  console.log('✗', e);
  await page.screenshot({ path: `${dir}/x-error.png` }).catch(() => {});
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failures.length ? `${failures.length} failed` : 'all good');
process.exit(failures.length ? 1 : 0);

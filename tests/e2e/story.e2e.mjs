// E23.9 (#363): the story played in a headless browser, with screenshots at the moments that matter.
// `node tests/e2e/story.e2e.mjs [journal|keepers|ending ...]` after `vite build` (all scenes when none are named).
// - journal: walk up to the first page post, read it, the Journal opens at it.
// - keepers: a woken Keeper wanders and comes home; a settled one takes a gift, becomes a friend and tends its patch.
// - ending:  the broken causeway; the last delivery: the island blooms, the causeway rises, his last page opens;
//            bloombot walks out along the causeway.
// Screenshots go to $SHOTS_DIR (default docs/review/story). The script fails on a page error or a failed check.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/story';
mkdirSync(dir, { recursive: true });
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : ['journal', 'keepers', 'ending'];
const port = 4251;
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/?slot=1&new=1`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  return { page, errors };
}
const shot = async (page, name) => {
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(`  📷 ${dir}/${name}.png`);
};
/** Teleports bloombot and waits for the ground there to load and settle. */
async function stand(page, x, z, facing) {
  await page.evaluate(([x, z, f]) => {
    const g = window.solarbloom;
    g.bot.teleport('g', x, z);
    g.bot.pose.facing = f;
  }, [x, z, facing]);
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('gone'));
  await page.waitForTimeout(2500);
}
const prompt = (page) => page.evaluate(() => document.querySelector('#prompt, .prompt, [class*=prompt]')?.textContent?.trim() ?? '');

try {
  if (scenes.includes('journal')) {
    const { page, errors } = await open();
    // his first note waits at the top of the beach steps
    await stand(page, 7.5, 13.4, Math.PI);
    const p = await prompt(page);
    check(/Read the page/.test(p), `journal: facing the post, the prompt says "Read the page" (${p})`);
    await shot(page, 'journal-1-post');
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(800);
    const text = await page.evaluate(() => document.querySelector('#bpDetail')?.textContent ?? '');
    check(/Start with the park/.test(text), 'journal: Interact opens the Journal at "Start with the park"');
    await shot(page, 'journal-2-open');
    check(!errors.length, `journal: no page errors ${errors.join(' | ')}`);
    await page.close();
  }

  if (scenes.includes('keepers')) {
    const { page, errors } = await open();
    const has = await page.evaluate(() => typeof window.solarbloom.sim.keepers.benchFriend === 'function');
    if (!has) console.log('  (keepers: this build has no E23.9.2; skipped)');
    else {
      // Mast Row open, the Pylon awake and asked for its seeds, its patch restored round it
      await page.evaluate(() => {
        const g = window.solarbloom;
        const s = g.sim;
        const sv = s.state.salvage;
        sv.tier = 1;
        if (!sv.abilities.includes('pry')) sv.abilities.push('pry');
        s.areas.clear('park', true);
        s.gates.open('g-mastRow');
        for (let z = -12; z <= -1; z++)
          for (let x = 4; x <= 16; x++) {
            const t = s.grid.get('g', x, z);
            if (t && !t.blocked && !t.occupantId && t.ground !== 'restored') s.restoration.complete(t, 'pulse');
          }
        sv.keepers.pylon = { step: 'request2' };
      });
      // far off: it wanders
      await stand(page, 14.5, -14.5, 0);
      await page.waitForTimeout(9000);
      const away = await page.evaluate(() => {
        const p = window.solarbloom.keepers?.headWorld?.('pylon');
        return p ? Math.hypot(p.x - 10.5, p.z - -3.5) : -1;
      });
      check(away > 0.4, `keepers: a woken Keeper wanders from where it sleeps (${away.toFixed(2)} tiles away)`);
      await shot(page, 'keepers-1-wandering');
      // come close: it walks home to be talked to
      await stand(page, 10.5, -1.6, Math.PI);
      await page.waitForTimeout(9000);
      const home = await page.evaluate(() => {
        const p = window.solarbloom.keepers?.headWorld?.('pylon');
        return p ? Math.hypot(p.x - 10.5, p.z - -3.5) : -1;
      });
      check(home >= 0 && home < 0.3, `keepers: with bloombot near, it walks home (${home.toFixed(2)} tiles from home)`);
      // settle it, give three gifts a day apart
      await page.evaluate(() => {
        const s = window.solarbloom.sim;
        s.state.salvage.keepers.pylon = { step: 'landmark' };
        s.keepers.settle('pylon');
        s.inventory.add('copper', 6);
      });
      await page.waitForTimeout(1500);
      await shot(page, 'keepers-2-settled');
      const p1 = await prompt(page);
      check(/Give a gift to Pylon/.test(p1), `keepers: the prompt offers a gift (${p1})`);
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(700);
      await shot(page, 'keepers-3-thanks');
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => (window.solarbloom.sim.state.time += 48 * 60));
        await page.keyboard.press('KeyE');
        await page.waitForTimeout(700);
      }
      const friend = await page.evaluate(() => window.solarbloom.sim.keepers.isFriend('pylon'));
      check(friend, 'keepers: three gifts make a friend');
      const bubble = await page.evaluate(() => document.querySelector('.oc-bubble')?.textContent ?? '');
      check(/listen/.test(bubble), `keepers: the friend beat plays (${bubble.slice(0, 80)})`);
      await shot(page, 'keepers-4-friend');
      // it tends its patch over time
      const before = await page.evaluate(() => {
        const s = window.solarbloom.sim;
        let n = 0;
        for (let z = -12; z <= -1; z++) for (let x = 4; x <= 16; x++) n += s.grid.get('g', x, z)?.bloom ?? 0;
        return n;
      });
      await page.evaluate(() => window.solarbloom.sim.advance(240));
      const after = await page.evaluate(() => {
        const s = window.solarbloom.sim;
        let n = 0;
        for (let z = -12; z <= -1; z++) for (let x = 4; x <= 16; x++) n += s.grid.get('g', x, z)?.bloom ?? 0;
        return n;
      });
      check(after > before, `keepers: a friend tends its patch (${before} → ${after} bloom steps)`);
      // the Friends list in the backpack
      await page.keyboard.press('Tab');
      await page.waitForTimeout(500);
      await page.evaluate(() => window.solarbloom.hud.backpack.open('collection'));
      await page.waitForTimeout(500);
      await shot(page, 'keepers-5-friends-list');
    }
    check(!errors.length, `keepers: no page errors ${errors.join(' | ')}`);
    await page.close();
  }

  if (scenes.includes('ending')) {
    const { page, errors } = await open();
    const has = await page.evaluate(() => !!window.solarbloom.sim.ending);
    if (!has) console.log('  (ending: this build has no E23.9.3; skipped)');
    else {
      // the end of the game: every region open and its landmark awake, tier 4 reached
      await page.evaluate(() => {
        const g = window.solarbloom;
        const s = g.sim;
        const sv = s.state.salvage;
        sv.tier = 4;
        for (const a of ['pry', 'hover', 'climb', 'glide']) if (!sv.abilities.includes(a)) sv.abilities.push(a);
        s.areas.clear('park', true);
        for (const r of s.salvage.regionById ? ['mastRow', 'oldMarket', 'saltwind', 'elderGrove', 'cistern', 'clockPlaza', 'terraces', 'glasshouse', 'observatory', 'spireHeights'] : []) {
          s.gates.openRegion(r);
          s.areas.clear(r, true);
        }
        // the backstreets on the way to the east shore, explored
        for (const id of ['bs_5_0', 'bs_6_0', 'bs_5_-1', 'bs_6_-1', 'bs_5_1', 'bs_6_1']) {
          s.gates.openRegion(id);
          s.areas.clear(id, true);
        }
        g.updateCityBounds();
      });
      await stand(page, 100.5, 8.5, Math.PI / 2);
      // before: the causeway's middle lies broken under the sea
      await page.evaluate(() => {
        const g = window.solarbloom;
        g.vista(124.5, 8, 30, () => {});
      });
      await page.waitForTimeout(5000);
      await shot(page, 'ending-1-causeway-broken');
      await page.evaluate(() => window.solarbloom.skipCinematic?.());
      await page.waitForTimeout(3000);
      // the last delivery
      await stand(page, 8.5, 12.5, Math.PI);
      await page.evaluate(() => {
        const s = window.solarbloom.sim;
        s.state.salvage.tier = 5;
        s.bus.emit('fountain.tier', { tier: 5 });
      });
      // the swiftshader browser runs few frames a second and the ending counts game time, so wait on what happens
      await page.waitForTimeout(2500);
      await shot(page, 'ending-2-bloom-starts');
      await page.waitForFunction(() => window.solarbloom.sim.time > 0 && document.querySelector('#cine')?.classList.contains('title-on'));
      await page.waitForTimeout(6000);
      await shot(page, 'ending-3-blooming');
      await page.waitForFunction(() => !document.querySelector('#cine')?.classList.contains('on'));
      await page.waitForTimeout(4000);
      await shot(page, 'ending-4-causeway-rising');
      await page.waitForTimeout(6000);
      await shot(page, 'ending-5-causeway-up');
      await page.waitForFunction(() => document.querySelector('#bpScreen')?.classList.contains('open'));
      await page.waitForTimeout(800);
      const page1 = await page.evaluate(() => document.querySelector('#bpDetail')?.textContent ?? '');
      check(/His last page/.test(page1), 'ending: the Journal opens at his last page');
      await shot(page, 'ending-6-last-page');
      const state = await page.evaluate(() => {
        const s = window.solarbloom.sim;
        return { bloomed: s.ending.bloomed, open: s.mainland.opened && !s.grid.get('g', 124, 7).blocked, fauna: Object.keys(s.state.fauna ?? {}).length };
      });
      check(state.bloomed && state.open, 'ending: the causeway can be walked');
      check(state.fauna >= 4, `ending: every kind of wildlife is back (${state.fauna})`);
      // walk out along it
      await page.evaluate(() => window.solarbloom.hud.backpack.close());
      await stand(page, 124.5, 8.5, Math.PI / 2);
      const walked = await page.evaluate(() => window.solarbloom.bot.walker.walkable('g', 125, 8));
      check(!!walked, 'ending: bloombot stands on the causeway');
      await shot(page, 'ending-7-on-causeway');
    }
    check(!errors.length, `ending: no page errors ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failures.length) {
  console.log(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nall story checks passed');

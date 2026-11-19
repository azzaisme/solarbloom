// E23.12.3 (#530): the proof, played headless in the real game. Screenshots into docs/review/e23-12/.
//
// 1. Before the first find: a cat hides long past the time its paw prints would show. Nothing on screen, in the
//    backpack's collection, in Settings › Game or in the sound names or hints at it. That means no paw chip, no meow,
//    no tile note and no cat words anywhere.
// 2. Paused, the cat's clock stands still: game time, the next cat's time and the hiding cat's hidden time don't move.
// 3. Bloombot walks up and finds it with the Interact key (a Lucky Harvest, and the first cat-only decoration).
//    From then on the hints open: the next cat leaves paw prints.
// 4. Each reward type, found the same way: Solar Surge, Mega Bloom, Drone Party, Golden Relay, Cat's Garden,
//    Fog Whisker, Ripe All Around and a Rainbow Cat's Jackpot. Each is checked in the world (charge, buffs, ground,
//    a gold relay, ripe planters) and in the reward panel's words, with a screenshot of each.
//
//   npm run build && node tests/e2e/cat-proof.e2e.mjs        (serves the build)
//   BASE=http://localhost:5181 node tests/e2e/cat-proof.e2e.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e23-12';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4392);
const server = process.env.BASE ? undefined : await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE ?? `http://localhost:${port}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`);
  if (!ok) failed++;
};
const shot = async (file) => {
  await page.screenshot({ path: `${out}/${file}` });
  console.log('shot', file);
};
/** The same word list as tests/cat-secrecy.test.ts. */
const CAT_WORD = /\b(cats?|kitt(?:y|en|ens)|meows?|paws?|pawprints?|whiskers?|purr\w*)\b|🐱|🐈|🐾|😺/i;

try {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
  });
  await page.goto(`${base}/?slot=1`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 180000 });
  if (await page.locator('#introGo').isVisible().catch(() => false)) await page.click('#introGo');
  await page.waitForTimeout(1500);

  // helpers in the page: a grown park, every recipe open, a camera that follows bloombot, meows counted
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    window.__meows = 0;
    const meow = g.sfx.meow.bind(g.sfx);
    g.sfx.meow = (...a) => (window.__meows++, meow(...a));
    for (const t of s.areas.tiles('park')) {
      if (t.blocked || t.occupantId || t.feature === 'water') continue;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = Math.max(1, t.bloom);
      s.grid.touch(t);
    }
    g.chunks.markAll();
    window.aim = (x, z, zoom = 1.5) => {
      g.bot.teleport('g', x, z);
      g.camera.recentre();
      g.camera.zoomTo(zoom);
      for (let i = 0; i < 200; i++) g.camera.update(0.05);
      g.hud.hideTip();
    };
    /** A cat hides at a free spot (the camera is on the park, so the usual out-of-view pick is skipped). */
    window.hide = (variant) => {
      s.state.cat.active = undefined;
      const spots = s.cat.candidates();
      const a = spots[window.__nextSpot++ % spots.length];
      if (!a || !s.cat.spawn(a.id)) return undefined;
      if (variant) s.state.cat.active.variant = variant;
      return { id: s.state.cat.active.id, anchor: a.id, x: a.pos[0], z: a.pos[2] };
    };
    window.__nextSpot = 0;
    /** Bloombot walks up to the cat and turns to it (the Interact key does the rest). */
    window.goTo = (c) => {
      g.bot.teleport('g', c.x + 0.9, c.z + 0.9);
      g.bot.pose.facing = Math.atan2(c.x - (c.x + 0.9), c.z - (c.z + 0.9));
      g.camera.recentre();
      for (let i = 0; i < 120; i++) g.camera.update(0.05);
    };
  });

  // ── 1. before the first find ──
  const hid = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    // where wildlife cats would come: a bench and a rug in the park
    s.state.salvage.decorMade = [...new Set([...(s.state.salvage.decorMade ?? []), 'bench', 'rug'])].sort();
    let placed = 0;
    for (const t of s.areas.tiles('park')) if (placed < 2 && !g.cozy.canDecorate('bench', 'g', t.x, t.z) && !g.cozy.placeDecor(placed ? 'rug' : 'bench', 0, 'g', t.x, t.z)) placed++;
    g.chunks.markAll();
    const c = window.hide();
    window.__c = c;
    s.state.time += 400; // hiding far past its paw-print time (90 s)
    return { c, found: s.state.cat.found, placed };
  });
  check(!!hid.c && hid.found === 0, `a cat hides before any is found (${hid.c?.anchor})`);
  // bloombot nearby, the cat in view
  await page.evaluate((c) => window.aim(c.x + 4, c.z + 4, 1.3), hid.c);
  await page.waitForTimeout(25000); // the hint meow used to come 20 s after a cat hid
  const before = await page.evaluate((CAT) => {
    const g = window.solarbloom;
    const s = g.sim;
    const re = new RegExp(CAT.src, CAT.flags);
    const t = s.grid.get('g', Math.floor(window.__c.x), Math.floor(window.__c.z));
    return {
      paw: !document.querySelector('#pawBtn')?.hidden,
      meows: window.__meows,
      words: (document.body.innerText.match(new RegExp(re.source, 'gi')) ?? []).join(' '),
      tile: g.pawHint(t),
      stats: re.test(g.hud.panels.statsHtml().replace(/<[^>]+>/g, ' ')),
      hinted: s.cat.hinted(s.state.cat.active),
    };
  }, { src: CAT_WORD.source, flags: CAT_WORD.flags });
  check(!before.paw, 'no paw-print chip');
  check(before.meows === 0, `no meow in 25 s with a cat hiding (${before.meows})`);
  check(!before.words, `no cat words on screen (${before.words})`);
  check(before.tile === '', 'the tile beside the cat has no paw-print note');
  check(!before.stats, 'Settings › Game shows no Lucky Cat line');
  check(!before.hinted, 'the cat leaves no paw prints');
  await shot('1-before-first-find.png');
  // the backpack's collection, opened as the player would
  await page.evaluate(() => window.solarbloom.hud.toggleBackpack(true));
  await page.waitForTimeout(600);
  await page.click('#bptab-collection').catch(() => {});
  await page.waitForTimeout(600);
  const bp = await page.evaluate(() => document.querySelector('#bpBody')?.innerText ?? '');
  check(bp.length > 0 && !CAT_WORD.test(bp), `the collection names no cat (${(bp.match(new RegExp(CAT_WORD.source, 'gi')) ?? []).join(' ')})`);
  await shot('1-collection-before.png');
  await page.evaluate(() => window.solarbloom.hud.toggleBackpack(false));

  // ── 2. paused: the cat's clock stands still ──
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const p0 = await page.evaluate(() => ({ paused: window.solarbloom.paused, t: window.solarbloom.sim.time, cat: JSON.stringify(window.solarbloom.sim.state.cat) }));
  await page.waitForTimeout(8000);
  const p1 = await page.evaluate(() => ({ t: window.solarbloom.sim.time, cat: JSON.stringify(window.solarbloom.sim.state.cat) }));
  check(p0.paused === true, 'Escape pauses the game');
  check(p1.t === p0.t && p1.cat === p0.cat, `8 s paused: game time and every cat timer stand still (${p0.t.toFixed(1)} → ${p1.t.toFixed(1)})`);
  await shot('2-paused.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const p2 = await page.evaluate(() => window.solarbloom.sim.time);
  await page.waitForTimeout(2000);
  const p3 = await page.evaluate(() => window.solarbloom.sim.time);
  check(p3 > p2, 'unpaused, game time runs again');

  // ── 3. finding the first cat ──
  const findWith = async (c, label) => {
    await page.evaluate((c) => window.goTo(c), c);
    await page.waitForTimeout(1200);
    const prompt = await page.evaluate(() => document.querySelector('#interactPrompt, .interact-prompt, #prompt')?.textContent ?? '');
    const found0 = await page.evaluate(() => window.solarbloom.sim.state.cat.found);
    await page.keyboard.press('e');
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ found: window.solarbloom.sim.state.cat.found, panel: document.querySelector('#catPanelBody')?.innerText ?? '', last: window.solarbloom.sim.state.cat.lastReward }));
    check(r.found === found0 + 1, `${label}: bloombot finds the cat with Interact${prompt ? ` ("${prompt.trim()}")` : ''}`);
    return r;
  };
  const first = await findWith(hid.c, 'the first cat');
  check(/Lucky Harvest/.test(first.panel) && /gift in your backpack/.test(first.panel), `a Lucky Harvest (${first.panel.replace(/\n/g, ' ')})`);
  check(/Lucky Cat statue to place in your gardens/.test(first.panel), 'and the Lucky Cat statue');
  await shot('3-first-find.png');
  const after = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    const c = window.hide();
    s.state.time += 120;
    return { c };
  });
  await page.waitForTimeout(1500);
  const opened = await page.evaluate(() => ({ paw: !document.querySelector('#pawBtn')?.hidden, hinted: window.solarbloom.sim.cat.hinted(window.solarbloom.sim.state.cat.active) }));
  check(opened.hinted && opened.paw, 'once a cat has been found, the next one leaves paw prints (the chip shows)');
  await page.evaluate((c) => window.aim(c.x + 2.5, c.z + 2.5, 1.6), after.c);
  await page.waitForTimeout(1500);
  await shot('3-paw-prints-after-first.png');
  // that cat is found too (whatever it rolls), so the reward runs below start clean
  await findWith(after.c, 'the second cat');

  // ── 4. each reward type ──
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const sv = s.state.salvage;
    sv.tier = Math.max(sv.tier, 4);
    for (const k of ['pylon', 'tally', 'tide', 'moss', 'sluice', 'tock', 'gable', 'fern', 'vega', 'atlas']) if (!sv.keepers[k] || sv.keepers[k].step === 'asleep') sv.keepers[k] = { step: 'settled' };
    s.state.progression.coreActivated = true; // the fountain awake: the fog's next area for a Fog Whisker
    s.areas.clear('park', true); // a cleared area for a Cat's Garden to grow in
    s.power.register('droneHub', { consumer: undefined }); // the hub's drones fly without a line (the grid is tested elsewhere)
    s.water && (s.water.isWatered = () => true);
    s.bot = { roofId: 'g', x: 8.5, z: 11.5 };
    const store = () => {
      for (const m of ['scrap', 'copper', 'wire', 'planks', 'glassPane', 'motor', 'seeds', 'clay', 'biomass', 'gears', 'timber']) s.inventory.addToStore(m, 40);
    };
    const build = (type) => {
      for (const t of s.areas.tiles('park').sort((a, b) => Math.hypot(a.x - 9, a.z - 15) - Math.hypot(b.x - 9, b.z - 15))) {
        store();
        if (t.occupantId || !s.build.check(type, 'g', t.x, t.z).ok) continue;
        const m = s.build.place(type, 'g', t.x, t.z);
        if (m) return m;
      }
      return undefined;
    };
    window.__relay = build('relay')?.id;
    window.__hub = build('droneHub')?.id;
    const beds = [];
    for (let i = 0; i < 2; i++) {
      const m = build('planter');
      if (m) {
        s.inventory.add('seeds', 1);
        s.farm.plant(m, 'radish');
        beds.push(m.id);
      }
    }
    window.__beds = beds;
    g.chunks.markAll();
  });
  await page.waitForTimeout(6000); // the hub's drones take off
  const setup = await page.evaluate(() => ({ relay: !!window.__relay, hub: !!window.__hub, drones: window.solarbloom.sim.state.drones.filter((d) => d.hubId === window.__hub).length, beds: window.__beds.length }));
  check(setup.relay && setup.hub && setup.drones > 0 && setup.beds === 2, `a relay, a Drone Hub with drones and two growing planters in the park (${JSON.stringify(setup)})`);

  const REWARDS = [
    ['solarFrenzy', /Solar Surge/, /Charge full/, () => { const s = window.solarbloom.sim; return s.state.buffs.some((b) => b.type === 'solarFrenzy' && b.until > s.time) && s.charge.value() >= s.charge.max - 1e-6; }],
    ['megaBloom', /Mega Bloom/, /A Mega Bloom!/, () => true],
    ['droneParty', /Drone Party/, /drones nearby work faster/, () => { const s = window.solarbloom.sim; return s.state.buffs.some((b) => b.type === 'droneParty' && b.until > s.time); }],
    ['goldenRelay', /Golden Relay/, /relay turns gold/, () => !!window.solarbloom.sim.machine(window.__relay)?.golden],
    ['catsGarden', /Cat's Garden/, /little garden blooms/, () => true],
    ['fogWhisker', /Fog Whisker/, /fog thins/, () => true],
    ['ripeAround', /Ripe All Around/, /ripen/, () => window.__beds.every((id) => window.solarbloom.sim.farm.look(window.solarbloom.sim.machine(id)).ripe)],
    ['jackpot', /Rainbow Cat: JACKPOT/, /^JACKPOT!/m, () => true],
  ];
  for (const [type, title, words, effect] of REWARDS) {
    const c = await page.evaluate((type) => {
      const s = window.solarbloom.sim;
      const c = window.hide(type === 'jackpot' ? 'rainbow' : 'standard');
      // this cat's roll lands on the reward being shown (the roll's odds are tested in the unit tests)
      window.__roll ??= s.cat.rollReward;
      s.cat.rollReward = () => type;
      window.__restored0 = s.state.stats.tilesRestored;
      window.__bloom = () => s.grid.tilesOf('g').reduce((a, t) => a + (t.ground === 'restored' ? 1 + t.bloom : 0), 0);
      window.__bloom0 = window.__bloom();
      return c;
    }, type);
    if (!c) {
      check(false, `${type}: a cat hides`);
      continue;
    }
    const r = await findWith(c, type);
    await page.evaluate(() => (window.solarbloom.sim.cat.rollReward = window.__roll));
    await page.waitForTimeout(2500); // blooms and growth run a moment
    const ok = await page.evaluate(`(${effect.toString()})()`);
    // ground restored, or (where it already was) blooming further: a Cat's Garden blooms restored grass up too. The
    // chain plays out in game time, which runs slower than the wall clock in software GL: wait for it.
    if (['megaBloom', 'catsGarden', 'fogWhisker'].includes(type)) await page.waitForFunction(() => window.__bloom() > window.__bloom0, null, { timeout: 30000 }).catch(() => {});
    const grew = await page.evaluate(() => window.__bloom() - window.__bloom0);
    const panel = r.panel.replace(/\n/g, ' ');
    check(title.test(panel) && words.test(r.panel.split('\n').slice(1).join('\n') || r.panel), `${type}: the panel says so (${panel})`);
    check(ok, `${type}: it acts in the world`);
    if (['megaBloom', 'catsGarden', 'fogWhisker'].includes(type)) check(grew > 0, `${type}: ground restored or blooming further (+${grew})`);
    if (type === 'jackpot') check(panel.split(' · ').length >= 3, `${type}: two rewards at once`);
    // the shot looks at what the reward changed: the gold relay, the hub's drones, the ripe planters
    await page.evaluate((type) => {
      const s = window.solarbloom.sim;
      const id = { goldenRelay: window.__relay, droneParty: window.__hub, ripeAround: window.__beds[0] }[type];
      const m = id && s.machine(id);
      if (m) window.aim(m.x + m.size / 2 + 1.5, m.z + m.size / 2 + 2, 1.7);
    }, type);
    await page.waitForTimeout(1200);
    await shot(`4-reward-${type}.png`);
  }
  const decor = await page.evaluate(() => ['catstatue', 'catbench', 'pawstones', 'catfountain', 'goldlantern', 'rainbowbunting'].filter((id) => window.solarbloom.sim.crafting.decorMade(id)));
  check(decor.length === 6, `every cat-only decoration found along the way (${decor.join(' ')})`);
  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
} finally {
  console.log(failed ? `cat proof: ${failed} check(s) failed` : 'cat proof: all checks passed');
  await browser.close();
  server?.httpServer.close();
  process.exitCode = failed ? 1 : 0;
}

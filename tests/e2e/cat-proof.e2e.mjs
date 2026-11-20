// E23.12.3 (#530): the proof, played headless in the real game. Screenshots into docs/review/e23-12/.
//
// 1. Before the first find: a cat hides long past the time its paw prints would show. Nothing on screen, in the
//    backpack's collection, in Settings › Game or in the sound names or hints at it. That means no paw chip, no meow,
//    no tile note and no cat words anywhere.
// 2. Paused, the cat's clock stands still: game time, the next cat's time and the hiding cat's hidden time don't move.
// 3. Bloombot walks up and finds it with the Interact key (a Lucky Harvest, and the first cat-only decoration).
//    From then on the hints open: the next cat leaves paw prints.
// 4. Each reward type, found the same way: Solar Surge, Mega Bloom, Drone Party, Golden Relay, Cat's Garden,
//    Fog Whisker, Ripe All Around and a Rainbow Cat's Jackpot. Each is checked in the world by its own effect (its
//    chain's own tiles, the buff, the gold relay, the ripe planters; both of a Jackpot's), and in the panel's words.
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
let page;
const errors = [];
/** A new game in a fresh browser context (an empty save), loaded and past the intro. */
const load = async () => {
  page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
  });
  await page.goto(`${base}/?slot=1`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 180000 });
  if (await page.locator('#introGo').isVisible().catch(() => false)) await page.click('#introGo');
  await page.waitForTimeout(1500);
};
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
const CAT_WORD = /\b(cats?|kitt(?:y|en|ens)|kitties|meows?|mews?|paws?|pawprints?|whiskers?|purr\w*|felines?|tabby|something (?:small|little)|hiding (?:nearby|close by|close|here))\b|🐱|🐈|🐾|😺|😸/i; // as tests/cat-secrecy.test.ts

/** In the page: bloombot just beyond (x, z) as seen from a heading, in the overview: the follow camera frames it. */
const addView = () =>
  page.evaluate(() => {
    const g = window.solarbloom;
    window.view = (x, z, yaw = g.camera.heading, zoom = 2, tilt = 0) => {
      const yr = (yaw * Math.PI) / 180;
      g.overviewOn = true;
      g.camera.turnTo(yaw, true);
      g.camera.pitchOffset = tilt; // a player's tilt (0: the camera's own pitch)
      // just beyond the spot; if that cell is taken, nearer the camera side instead (still within reach)
      for (const k of [0.8, 0.6, -0.8]) {
        g.bot.teleport('g', x - Math.sin(yr) * k, z - Math.cos(yr) * k);
        const b = g.bot.world();
        if (Math.hypot(b[0] - x, b[2] - z) < 1.3) break;
      }
      g.camera.zoomTo(zoom);
      for (let i = 0; i < 240; i++) g.camera.update(0.05);
    };
  });

/** Waits until the camera has stopped: at its zoom, and still across two looks (frames are slow in software GL). */
const settle = async () => {
  await page
    .waitForFunction(
      () => {
        // at its goals (the point it eases to, its zoom, its heading), and not moving between two looks
        const c = window.solarbloom.camera;
        const p = c.entity.getPosition();
        const g = c.goalPoint;
        const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
        const still = window.__camKey === key;
        window.__camKey = key;
        const there = Math.hypot(c.target.x - g.x, c.target.z - g.z) < 0.01 && Math.abs(c.zoom - c.zoomTarget) < 0.005 && Math.abs(c.yaw - c.heading) < 0.1;
        return still && there;
      },
      null,
      { timeout: 45000, polling: 500 },
    )
    .catch(() => {});
  await page.waitForTimeout(300);
};

/**
 * Before the first find a cat only answers when the player can see it: as a player would, the view turns around the
 * cat (a quarter turn at a time) until enough of it shows. Returns that heading, or undefined.
 */
const lookAround = async (c, zoom, best = false) => {
  const start = await page.evaluate(() => window.solarbloom.camera.heading);
  let top;
  for (const turn of [0, 90, 180, 270, 45, 135, 225, 315]) {
    await page.evaluate(([c, yaw, zoom]) => window.view(c.x, c.z, yaw, zoom), [c, start + turn, zoom]);
    await settle();
    const px = await page.evaluate(() => window.solarbloom.catSeenPixels(window.solarbloom.sim.state.cat.active.id));
    if (px >= 100 && !best) {
      await page.waitForTimeout(600); // the frame's own measure catches up (Game.measureCatsAfterFrame)
      return start + turn;
    }
    if (px >= 100 && (!top || px > top.px)) top = { yaw: start + turn, px };
  }
  // `best`: the heading that shows the most of the cat (for a clear shot of it)
  return top?.yaw;
};

try {
  await load();

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
    // away from every spot a cat may hide at: a bench set down on top of one would hide the cat itself
    const spots = s.cat.candidates().map((a) => a.pos);
    const clear = (t) => spots.every(([x, , z]) => Math.hypot(t.x + 0.5 - x, t.z + 0.5 - z) > 3);
    for (const t of s.areas.tiles('park')) if (placed < 2 && clear(t) && !g.cozy.canDecorate('bench', 'g', t.x, t.z) && !g.cozy.placeDecor(placed ? 'rug' : 'bench', 0, 'g', t.x, t.z)) placed++;
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

  // ── 1b. the pointer is no detector: before the first find it only finds a cat the player can really see ──
  // "Seen" is measured on the frame (Game.catVisible): the screen pixels where the cat itself is drawn in front.
  await addView();
  await page.keyboard.press('m'); // the overview, as the player opens it
  await settle();
  /**
   * Optionally frames a view (bloombot just beyond the spot, the overview's free pointer), then puts the pointer on
   * the cat and reads what it shows: the tip, bloombot's prompt, and how much of the cat is drawn.
   */
  const pointAtCat = async (view, file) => {
    if (view) {
      await page.evaluate((v) => window.view(v.x, v.z, v.yaw, v.zoom, v.tilt ?? 0), view);
      await settle(); // the follow camera settles
    }
    const at = await page.evaluate(() => {
      const g = window.solarbloom;
      g.overviewOn = true;
      g.hud.hideTip();
      const id = g.sim.state.cat.active.id;
      const sc = g.camera.onScreen(g.cat.targetWorld(id), 0);
      const c = g.cat.targetWorld(id);
      const b = g.bot.world();
      return sc && { x: sc.x, y: sc.y, px: g.catSeenPixels(id), visible: g.catVisible(id), botDist: Math.hypot(b[0] - c.x, b[2] - c.z) };
    });
    if (!at) return undefined;
    await page.mouse.move(at.x + 40, at.y + 40);
    await page.waitForTimeout(150);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    // A hand on the mouse never rests quite still. Headless frames can take longer than the 1.5 s the pointer counts
    // as recent (after that bloombot's own preview takes the tip back), so the pointer keeps moving by a pixel, as a
    // player's would, until the tip is up; it keeps moving through the shot.
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      let k = 0;
      const app = window.solarbloom.app;
      // at the start of every frame, however slow the frame (software GL here can take longer than 1.5 s)
      window.__jiggle = () => el?.dispatchEvent(new PointerEvent('pointermove', { clientX: x + (k++ % 2), clientY: y, pointerType: 'mouse', pointerId: 1, bubbles: true }));
      window.__jiggle();
      app.on('frameupdate', window.__jiggle);
    }, at);
    await page.waitForFunction(() => document.querySelector('#tip')?.style.display !== 'none' && document.querySelector('#tip')?.innerText.trim(), null, { timeout: 15000, polling: 100 }).catch(() => {});
    const read = await page.evaluate(({ x, y }) => {
      const t = document.querySelector('#tip');
      const g = window.solarbloom;
      const el = document.elementFromPoint(x, y);
      return {
        tip: t && t.style.display !== 'none' ? t.innerText : '',
        prompt: document.querySelector('#prompt')?.innerText ?? '',
        under: el ? `${el.tagName}#${el.id}.${el.className}` : 'none',
        hit: g.catHit(x, y) ?? 'none',
      };
    }, at);
    // the tip shows while the pointer moves (bloombot's own preview takes over once it rests): the shot is taken then
    if (file && read.tip) {
      // the shot must show the tip: a watcher notes if it is hidden at any moment while the frame is captured, and
      // then the shot is taken again (headless frames are slow; on a real screen the tip simply stays up)
      // While a screenshot is taken, headless software-GL frames take 3-4 s, so even a move every frame leaves the
      // pointer "idle" (over 1.5 s) by the time bloombot's own preview looks, and it takes the tip back. For the
      // capture only, the pointer counts as in use, as a hand resting on the mouse does: the tip itself is the game's
      // own, shown by onHover through catHit's real sight check, and its words were checked above through real input.
      await page.evaluate(() => {
        const g = window.solarbloom;
        g.pointerRecent = () => true;
      });
      let held = false;
      for (let n = 0; n < 8 && !held; n++) {
        await page.waitForFunction(() => document.querySelector('#tip')?.style.display !== 'none', null, { timeout: 15000, polling: 50 }).catch(() => {});
        await page.evaluate(() => {
          const t = document.querySelector('#tip');
          window.__tipHeld = t.style.display !== 'none';
          window.__tipWatch?.disconnect();
          window.__tipWatch = new MutationObserver(() => { if (t.style.display === 'none') window.__tipHeld = false; });

          window.__tipWatch.observe(t, { attributes: true, attributeFilter: ['style'] });
        });
        await shot(file);
        held = await page.evaluate(() => {
          window.__tipWatch.disconnect();
          return window.__tipHeld && document.querySelector('#tip').style.display !== 'none';
        });
      }
      await page.evaluate(() => delete window.solarbloom.pointerRecent); // back to the class's own
      check(held, `${file}: the tip is on screen in the shot`);
    } else if (file) await shot(file);
    await page.evaluate(() => window.solarbloom.app.off('frameupdate', window.__jiggle));
    return { ...at, ...read };
  };
  const flat = (t) => t.replace(/\n/g, ' ') || 'nothing';
  // (a) the overview as M opens it: the cat is a few pixels across
  const far = await pointAtCat(undefined, '1-pointer-overview.png');
  check(!!far && !far.visible && far.px < 100, `overview: too little of the cat shows to make out (${far?.px} px of it drawn)`);
  check(!!far && !CAT_WORD.test(far.tip), `overview: the pointer on its spot says nothing of a cat (${flat(far?.tip ?? '')})`);
  // (b), a cat behind a building, runs last in a game of its own (section 6): it grows more of the city.
  // (c) close, in plain view: the player can see it, so the pointer may ask, and bloombot beside it says hello.
  // M again leaves the overview's glide first (it holds the zoom), then the view is framed.
  await page.keyboard.press('m');
  await settle();
  const seenYaw = await lookAround(hid.c, 2.6, true);
  check(seenYaw !== undefined, `close up, a heading the cat can be seen from (${seenYaw?.toFixed(0)}°)`);
  const near = await pointAtCat({ x: hid.c.x, z: hid.c.z, yaw: seenYaw, zoom: 2.6 }, '1-pointer-in-view.png');
  check(!!near && near.visible && near.px >= 100, `close and in plain view: the cat is drawn (${near?.px} px of it)`);
  check(!!near && /is that a cat/.test(near.tip), `close and in plain view: the pointer asks "…is that a cat?" (${flat(near?.tip ?? '')}; under ${near?.under}, hit ${near?.hit})`);
  check(!!near && near.botDist < 1.6 && /Say hello/.test(near.prompt), `close and in plain view: bloombot beside it offers "Say hello" (${flat(near?.prompt ?? '')})`);
  // back to bloombot's view
  await page.mouse.move(5, 5);
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.overviewOn = false;
    g.hud.hideTip();
    window.aim(window.__c.x + 4, window.__c.z + 4, 1.3);
  });

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
    const known = await page.evaluate(() => window.solarbloom.sim.cat.known);
    if (known) {
      await page.evaluate((c) => window.goTo(c), c);
      await page.waitForTimeout(1200);
    } else {
      check((await lookAround(c, 1.6)) !== undefined, `${label}: the view turns until the cat can be seen`);
    }
    const prompt = await page.evaluate(() => document.querySelector('#interactPrompt, .interact-prompt, #prompt')?.textContent ?? '');
    const found0 = await page.evaluate(() => window.solarbloom.sim.state.cat.found);
    await page.keyboard.press('e');
    await page.waitForTimeout(1500);
    await page.evaluate(() => (window.solarbloom.overviewOn = false));
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
  // the HUD shows the chip on its next refresh (game time runs slow in software GL): wait for it
  await page.waitForFunction(() => !document.querySelector('#pawBtn')?.hidden, null, { timeout: 20000 }).catch(() => {});
  const opened = await page.evaluate(() => ({ paw: !document.querySelector('#pawBtn')?.hidden, hinted: window.solarbloom.sim.cat.hinted(window.solarbloom.sim.state.cat.active) }));
  check(opened.hinted && opened.paw, `once a cat has been found, the next one leaves paw prints (hinted ${opened.hinted}, chip ${opened.paw})`);
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

  // Each reward's own effect, measured in the world. Chain events say which tiles a reward's own chain touched
  // (cause 'mega' for a Mega Bloom, 'cat' for a Cat's Garden or a Fog Whisker), so the drones' ordinary work and
  // spreading blooms never count for it.
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    window.__ev = [];
    s.bus.on('chain.event', ({ event }) => window.__ev.push({ type: event.type, target: event.target, cause: event.cause }));
    const tileOf = (id) => {
      const [, x, z] = id.split(':').map(Number);
      return s.grid.get('g', x, z);
    };
    window.__snap = () => {
      window.__ev = [];
      window.__s0 = {
        t: s.time,
        food: s.inventory.count('food') + s.inventory.stored('food'),
        party: s.state.buffs.filter((b) => b.type === 'droneParty').length,
        gold: s.machinesOfType('relay').filter((m) => m.golden).length,
        fog: Object.fromEntries(s.areas.revealed().map((id) => [id, s.areas.fog(id)])),
        // the tiles a Fog Whisker would restore now (a fixed walk in from the fog edge, so known before the claim)
        whisker: s.cat.fogWhiskerTiles().map((t) => t.id),
      };
    };
    /**
     * The park was cleared for the setup, so it has hardly any dead ground left for a Mega Bloom to spread through:
     * a patch of it goes back to dead earth (as an unfinished garden would be) before a Mega Bloom's cat is found.
     */
    window.__deadPatch = (n = 14) => {
      const ok = (t) => t && t.ground === 'restored' && !t.blocked && !t.occupantId && t.feature !== 'water' && !s.isCoreTile(t) && s.areas.areaOf(t) === 'park';
      const start = s.areas.tiles('park').filter(ok).sort((a, b) => Math.hypot(b.x - 9, b.z - 15) - Math.hypot(a.x - 9, a.z - 15))[0];
      const out = [start];
      const seen = new Set([start.id]);
      for (let i = 0; i < out.length && out.length < n; i++)
        for (const nb of s.grid.neighbors(out[i])) {
          if (seen.has(nb.id) || !ok(nb) || out.length >= n) continue;
          seen.add(nb.id);
          out.push(nb);
        }
      for (const t of out) {
        t.ground = 'polluted';
        t.bloom = 0;
        t.pollution = 1;
        s.grid.touch(t);
      }
      g.chunks.markAll();
      return out.length;
    };
    /** The tiles a cat chain touched (restored or grown), split by whether their area was clear of fog before. */
    const catTiles = (cause) => {
      const ids = [...new Set(window.__ev.filter((e) => e.cause === cause && (e.type === 'RESTORE' || e.type === 'GROW')).map((e) => e.target))];
      return ids.map(tileOf).filter(Boolean).map((t) => ({ t, wasClear: window.__s0.fog[s.areas.areaOf(t)] === 'cleared' }));
    };
    window.__verify = (kind) => {
      const s0 = window.__s0;
      switch (kind) {
        case 'harvest': {
          const d = s.inventory.count('food') + s.inventory.stored('food') - s0.food;
          return { ok: d > 0, detail: `+${d} food` };
        }
        case 'surge': {
          const on = s.state.buffs.some((b) => b.type === 'solarFrenzy' && b.until > s.time);
          return { ok: on && s.charge.value() >= s.charge.max - 1e-6, detail: `surge ${on}, charge ${s.charge.value().toFixed(1)}/${s.charge.max}` };
        }
        case 'party': {
          const n = s.state.buffs.filter((b) => b.type === 'droneParty').length;
          return { ok: n > s0.party && s.state.buffs.some((b) => b.type === 'droneParty' && b.until > s.time), detail: `${n - s0.party} new party` };
        }
        case 'golden': {
          const n = s.machinesOfType('relay').filter((m) => m.golden).length;
          return { ok: n > s0.gold, detail: `${n - s0.gold} relay turned gold` };
        }
        case 'mega': {
          const ids = [...new Set(window.__ev.filter((e) => e.cause === 'mega' && e.type === 'RESTORE').map((e) => e.target))];
          const restored = ids.map(tileOf).filter((t) => t?.ground === 'restored').length;
          // its own chain through the dead patch: at least 4 tiles (TUNING.cat.megaBloomTiles is 8), capped at
          // TUNING.cat.megaBloomMax (30); the drones' work and ordinary spread aren't counted
          return { ok: ids.length >= 4 && restored === ids.length && ids.length <= 30, detail: `${restored}/${ids.length} of its own tiles restored`, tiles: ids };
        }
        case 'garden': {
          // its own tiles (at most TUNING.cat.catsGardenTiles, 6), all in one cleared area, each restored and grown
          const own = catTiles('cat').filter((x) => x.wasClear);
          const grown = (t) => window.__ev.some((e) => e.cause === 'cat' && e.type === 'GROW' && e.target === t.id);
          const done = own.filter((x) => x.t.ground === 'restored' && x.t.bloom >= 1 && grown(x.t));
          const areas = new Set(own.map((x) => s.areas.areaOf(x.t)));
          const ok = own.length > 0 && own.length <= 6 && areas.size === 1 && done.length === own.length;
          return { ok, detail: `${done.length}/${own.length} of its tiles restored and grown, in ${[...areas].join(', ')}`, tiles: own.map((x) => x.t.id) };
        }
        case 'whisker': {
          // its own tiles (at most TUNING.cat.fogWhiskerTiles × 2), all in one area that was still fogged, now restored
          const own = catTiles('cat').filter((x) => !x.wasClear);
          const areas = new Set(own.map((x) => s.areas.areaOf(x.t)));
          const done = own.filter((x) => x.t.ground === 'restored');
          // exactly the tiles the whisker walks in from the fog edge (known before the claim), every one restored
          const same = own.length === s0.whisker.length && own.every((x) => s0.whisker.includes(x.t.id));
          const ok = own.length > 0 && same && areas.size === 1 && done.length === own.length;
          return { ok, detail: `${done.length}/${own.length} fogged tiles restored, in ${[...areas].map((a) => `${a} (was ${window.__s0.fog[a] ?? 'hidden'})`).join(', ')}`, tiles: own.map((x) => x.t.id) };
        }
        case 'ripe':
          return { ok: window.__beds.every((id) => s.farm.look(s.machine(id)).ripe), detail: 'both planters ripe' };
      }
      return { ok: false, detail: `unknown ${kind}` };
    };
  });
  // the words of each reward, and the world check it stands for
  const KINDS = [
    [/gift in your backpack/, 'harvest'],
    [/Charge full/, 'surge'],
    [/A Mega Bloom!/, 'mega'],
    [/drones nearby work faster/, 'party'],
    [/relay turns gold/, 'golden'],
    [/little garden blooms/, 'garden'],
    [/fog thins/, 'whisker'],
    [/ripen/, 'ripe'],
  ];
  const kindsIn = (text) => KINDS.filter(([re]) => re.test(text)).map(([, k]) => k);
  const REWARDS = [
    ['fogWhisker', /Fog Whisker/, ['whisker']], // first: the hub's drones work the beach as the run goes on
    ['solarFrenzy', /Solar Surge/, ['surge']],
    ['megaBloom', /Mega Bloom/, ['mega']],
    ['droneParty', /Drone Party/, ['party']],
    ['goldenRelay', /Golden Relay/, ['golden']],
    ['catsGarden', /Cat's Garden/, ['garden']],
    ['ripeAround', /Ripe All Around/, ['ripe']],
    ['jackpot', /Rainbow Cat: JACKPOT/, undefined], // two of the others, whichever the jackpot draws
  ];
  for (const [type, title, expected] of REWARDS) {
    const c = await page.evaluate((type) => {
      const s = window.solarbloom.sim;
      const c = window.hide(type === 'jackpot' ? 'rainbow' : 'standard');
      // this cat's roll lands on the reward being shown (the roll's odds are tested in the unit tests)
      window.__roll ??= s.cat.rollReward;
      s.cat.rollReward = () => type;
      if (type === 'megaBloom' || type === 'catsGarden' || type === 'jackpot') window.__deadPatch();
      window.__snap();
      return c;
    }, type);
    if (!c) {
      check(false, `${type}: a cat hides`);
      continue;
    }
    const r = await findWith(c, type);
    await page.evaluate(() => (window.solarbloom.sim.cat.rollReward = window.__roll));
    const body = r.panel.split('\n').slice(1).join(' ');
    const kinds = kindsIn(body);
    check(title.test(r.panel), `${type}: the panel names it (${r.panel.replace(/\n/g, ' ')})`);
    if (expected) check(JSON.stringify(kinds) === JSON.stringify(expected), `${type}: its words say what it does (${kinds.join(', ')})`);
    else check(kinds.length === 2 && /^JACKPOT!/.test(body.trim()), `${type}: a Jackpot of two different rewards (${kinds.join(', ')})`);
    // the chains play out in game time, slower than the wall clock in software GL: wait for each effect (up to 40 s)
    const results = {};
    for (const k of kinds) {
      await page.waitForFunction((k) => window.__verify(k).ok, k, { timeout: 40000 }).catch(() => {});
      results[k] = await page.evaluate((k) => window.__verify(k), k);
      check(results[k].ok, `${type}: ${k} happened in the world (${results[k].detail})`);
    }
    // the shot looks at what the reward changed: the gold relay, the hub, the planters, the reward's own tiles
    await page.evaluate(
      ([type, tiles]) => {
        const s = window.solarbloom.sim;
        const g = window.solarbloom;
        g.hud.closePlotPicker(); // a seed menu bloombot's last press may have opened
        g.hud.loadWheel.shown = 0; // the pulse load wheel's one-time introduction closes on its own: not in the shots
        const id = { goldenRelay: window.__relay, droneParty: window.__hub, ripeAround: window.__beds[0] }[type];
        const m = id && s.machine(id);
        if (m) return window.aim(m.x + m.size / 2 + 1.5, m.z + m.size / 2 + 2, 1.7);
        if (tiles?.length) {
          const xs = tiles.map((t) => Number(t.split(':')[1]) + 0.5);
          const zs = tiles.map((t) => Number(t.split(':')[2]) + 0.5);
          const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
          const cz = zs.reduce((a, b) => a + b, 0) / zs.length;
          if (type === 'fogWhisker') {
            // its tiles seen from further out, with the fog it thinned around them: the free (overview) camera, since
            // the follow camera keeps bloombot's zoom step
            window.aim(cx + 1.5, cz + 2.5, 1.5);
            g.overviewOn = true;
            g.bot.following = false;
            g.camera.glide(cx, 0, cz, 0.75);
            for (let i = 0; i < 240; i++) g.camera.update(0.05);
          } else window.aim(cx + 1.5, cz + 2.5, 1.5);
        }
      },
      [type, Object.values(results).find((x) => x.tiles?.length)?.tiles],
    );
    await page.waitForTimeout(2500);
    await shot(`4-reward-${type}.png`);
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.overviewOn = false;
      g.bot.following = true;
    });
  }
  const decor = await page.evaluate(() => ['catstatue', 'catbench', 'pawstones', 'catfountain', 'goldlantern', 'rainbowbunting'].filter((id) => window.solarbloom.sim.crafting.decorMade(id)));
  check(decor.length === 6, `every cat-only decoration found along the way (${decor.join(' ')})`);
  // ── 5. the decorate tray: the six cat pieces, ready to place ──
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.hud.hideTip();
    document.querySelector('#catPanel')?.classList.remove('open');
    window.aim(9, 16, 1.4);
  });
  await page.keyboard.press('q'); // the Build menu key (Q) opens the tray, as the player would
  await page.waitForTimeout(900);
  const tray = await page.evaluate(() => {
    // headless Chrome under software GL leaves the tray's 0.2 s slide-in on its first frame (opacity 0): finish it
    for (const a of document.getAnimations()) a.finish();
    const open = document.querySelector('#buildTray')?.classList.contains('open');
    const seen = (b) => {
      for (let e = b; e && e !== document.body; e = e.parentElement) {
        const c = getComputedStyle(e);
        if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) < 0.9) return false;
      }
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    };
    const shown = ['catstatue', 'catbench', 'pawstones', 'catfountain', 'goldlantern', 'rainbowbunting'].filter((id) => {
      const b = document.querySelector(`#hotbar [data-tool="decor:${id}"]`);
      return b && !b.hidden && seen(b);
    });
    return { open, shown };
  });
  check(tray.open && tray.shown.length === 6, `the decorate tray shows all six, on screen (${tray.shown.join(' ')})`);
  await shot('5-decorate-tray.png');
  await page.keyboard.press('q');
  await page.close();
  await load();
  check(await page.evaluate(() => window.solarbloom.sim.state.cat.found === 0 && !window.solarbloom.sim.cat.known), 'a new game: no cat found yet');
  // ── 6. a cat behind something solid, in a new game (no cat found yet) ──
  // A building, a grown tree, a ruin and a landmark each hide a cat. The park has too few of them close to its
  // hiding spots, so two more areas are grown and cleared and the park blooms in full (so trees are grown): their
  // city nooks sit among buildings, trees and ruins. Each view is chosen from the map, not from the sight check: a
  // hiding spot and a tile near it where that thing stands (Game.standingAt), the camera turned so it is on the line
  // to the cat (a lower tilt is tried too, as a player would tilt to look past). A depth pick then says what is
  // drawn at the cat's spot: it must be that thing, in front of the cat. Then the GPU sight and the CPU fallback
  // (core/CatSight cpuSeenPixels, what WebGPU uses) must both find the cat hidden.
  await addView();
  const pairs = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.progression.coreActivated = true;
    for (let n = 0; n < 2; n++) {
      const id = s.areas.nextGoal();
      if (!id) break;
      for (const t of s.areas.tiles(id)) {
        if (t.blocked || t.occupantId || t.feature === 'water') continue;
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = 4;
        s.grid.touch(t);
      }
      s.areas.clear(id, true);
    }
    // the park in full bloom too: its trees grown beside its own hiding spots
    for (const t of s.areas.tiles('park')) {
      if (t.blocked || t.occupantId || t.feature === 'water') continue;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = 4;
      s.grid.touch(t);
    }
    g.chunks.markAll();
    s.state.cat.active = undefined;
    // every spot a cat may hide at: the renderer's "under the HUD on this screen" filter is set aside (headless
    // default) while the spot is chosen and the cat hides, so the pick doesn't depend on where the camera was
    window.__anchorView = s.cat.anchorView;
    s.cat.anchorView = () => 'offscreen';
    const near = { building: [1.5, 5], tree: [1.2, 4], ruin: [1, 4], landmark: [1.5, 5] };
    const out = { building: [], tree: [], ruin: [], landmark: [] };
    for (const a of s.cat.candidates()) {
      const [cx, cy, cz] = a.pos;
      for (let dx = -5; dx <= 5; dx++)
        for (let dz = -5; dz <= 5; dz++) {
          const x = Math.floor(cx) + dx;
          const z = Math.floor(cz) + dz;
          s.grid.get('g', x, z); // generates the chunk if need be
          const kind = g.standingAt(x, z);
          if (!kind) continue;
          const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
          if (d < near[kind][0] || d > near[kind][1]) continue;
          out[kind].push({ kind, anchor: a.id, cx, cy, cz, bx: x, bz: z, d, yaw: (Math.atan2(x + 0.5 - cx, z + 0.5 - cz) * 180) / Math.PI });
        }
    }
    for (const k of Object.keys(out)) out[k].sort((p, q) => p.d - q.d);
    return out;
  });
  await page.waitForTimeout(2500); // the grown areas draw
  /**
   * What is drawn frontmost across the cat's screen box, from depth picks at five points (its middle and four points
   * around it): covering the cat means being in front of all of it, not only its middle.
   */
  const drawnAtCat = () =>
    page.evaluate(async () => {
      const g = window.solarbloom;
      const id = g.sim.state.cat.active.id;
      const box = g.sight.box(g.cat.rootOf(id));
      if (!box) return undefined;
      const out = [];
      for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.75], [0.75, 0.75]]) {
        const pick = await g.sight.at(box.x + box.w * fx, box.y + box.h * fy);
        const p = pick.point;
        // `rise`: how far above the ground there the point is (on the thing itself, not the bare ground of its tile)
        out.push({ path: pick.path, point: p, kind: p && g.standingAt(Math.floor(p.x), Math.floor(p.z)), rise: p ? p.y - g.groundY(p.x, p.z) : 0 });
      }
      return out;
    });
  for (const kind of ['building', 'tree', 'ruin', 'landmark']) {
    let behind;
    const tries = [];
    for (const p of pairs[kind].slice(0, 14)) {
      await page.evaluate((p) => {
        const s = window.solarbloom.sim;
        if (s.state.cat.active?.anchorId === p.anchor) return;
        s.state.cat.active = undefined;
        s.cat.spawn(p.anchor);
      }, p);
      if (!(await page.evaluate((p) => window.solarbloom.sim.state.cat.active?.anchorId === p.anchor, p))) {
        tries.push(`${p.anchor}: no cat hid there`);
        continue;
      }
      await page.waitForTimeout(300); // the cat's model goes in on the next frame
      for (const [zoom, tilt] of [[1.6, 0], [1.6, -14], [2.4, -14], [1.6, -22]]) {
        let drawn;
        for (let n = 0; n < 2 && !drawn; n++) {
          await page.evaluate(([p, zoom, tilt]) => window.view(p.cx, p.cz, p.yaw, zoom, tilt), [p, zoom, tilt]);
          await settle();
          drawn = await drawnAtCat();
        }
        // at every point: that thing (for a tree, its crown spreading past its own tile), in front of the cat
        const on = (d) => !!d.point && (d.kind === kind || (kind === 'tree' && Math.hypot(d.point.x - p.bx - 0.5, d.point.z - p.bz - 0.5) < 1.5)) && d.rise > 0.05 && !d.path.some((n) => /cat/i.test(n));
        tries.push(`${p.anchor}@${p.bx},${p.bz} z${zoom} t${tilt}: ${drawn ? drawn.map((d) => (on(d) ? kind : d.path.some((n) => /cat/i.test(n)) ? 'cat' : d.kind ?? 'ground')).join('/') : 'off screen'}`);
        if (drawn && drawn.every(on)) {
          behind = { p, drawn, zoom, tilt };
          break;
        }
      }
      if (behind) break;
    }
    check(!!behind, `a hiding spot with a ${kind} on the line to it, from the map (${behind ? `${behind.p.anchor}, the ${kind} at ${behind.p.bx},${behind.p.bz}, heading ${behind.p.yaw.toFixed(0)}°, tilt ${behind.tilt}` : `none of ${pairs[kind].length} pairs: ${tries.join(' | ')}`})`);
    if (!behind) continue;
    const { p, drawn, zoom, tilt } = behind;
    check(true, `depth picks across the cat's screen box: the ${kind} is drawn in front at all five points, ${Math.min(...drawn.map((d) => d.rise)).toFixed(2)}+ above the ground there (${drawn[0].path.slice(0, 3).join(' < ')})`);
    const hiddenCat = await pointAtCat({ x: p.cx, z: p.cz, yaw: p.yaw, zoom, tilt }, `1-pointer-behind-${kind}.png`);
    const cpu = await page.evaluate(() => window.solarbloom.catSeenPixelsCpu(window.solarbloom.sim.state.cat.active.id));
    check(!!hiddenCat && !hiddenCat.visible && hiddenCat.px < 100, `behind the ${kind}: the cat is not seen (${hiddenCat?.px} px of it drawn)`);
    check(cpu < 100, `behind the ${kind}: the CPU fallback (WebGPU's) doesn't see it either (${cpu.toFixed(0)} px)`);
    check(!!hiddenCat && !CAT_WORD.test(hiddenCat.tip), `behind the ${kind}: the pointer on its spot says nothing of a cat (${flat(hiddenCat?.tip ?? '')})`);
    check(!!hiddenCat && hiddenCat.botDist < 1.6 && !/Say hello/.test(hiddenCat.prompt), `behind the ${kind}: bloombot right beside it doesn't offer "Say hello" (${flat(hiddenCat?.prompt ?? '')})`);
  }
  await page.evaluate(() => {
    window.solarbloom.sim.cat.anchorView = window.__anchorView;
    window.solarbloom.camera.pitchOffset = 0;
  });
  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
} finally {
  console.log(failed ? `cat proof: ${failed} check(s) failed` : 'cat proof: all checks passed');
  await browser.close();
  server?.httpServer.close();
  process.exitCode = failed ? 1 : 0;
}

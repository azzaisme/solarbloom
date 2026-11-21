// #620 (E24): Bloombot's upgrade path, played in a real game on the Deck (1280 × 800, ?gfx=deck) at 150% interface
// size, and at 1280 × 720 at 100%. Checks and shots:
//   - the Bloombot tab in the backpack, reached with the keyboard (E moves a tab on), early (nothing learned) and late
//     (every move, some upgrade levels); its rows read by arrows, Enter steps to Show me where, Enter again closes the
//     backpack and marks the way;
//   - Bloombot itself early and late, from behind and from the front: a mark per move (#627; a leaf by the sprout per level of Wider pulse), a glowing cell
//     per level of Bigger charge, a pocket per level of Roomier backpack;
//   - the moment when it grows: the first one points to the page, later ones don't.
// Shots go to docs/review/e25/ (SHOTS_DIR overrides; #620's first set is in docs/review/e24-620/).
//   npm run build && node tests/e2e/bloombot-page.e2e.mjs      (GPU=1: the real GPU, d3d11; otherwise SwiftShader)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review/e25';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4266);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

/** The page as drawn: its rows (name and state) and the detail column. */
function pageNow() {
  const t = (e) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return {
    tab: document.querySelector('#bpScreen [role=tab][aria-selected=true]')?.textContent?.trim() ?? '',
    rows: [...document.querySelectorAll('#bpScreen .bb-row')].map((r) => `${r.querySelector('.bb-name')?.textContent} · ${r.querySelector('.bb-state')?.textContent}`),
    detail: t(document.querySelector('#bpScreen .bb-detail')),
    focus: document.activeElement?.id ?? '',
  };
}

/** Grows Bloombot: every move, all three park milestones (#622), four Keepers' knacks (#625), and levels of the upgrades it wears. */
function growLate() {
  const s = window.solarbloom.sim;
  const sv = s.state.salvage;
  for (const a of ['pry', 'hover', 'climb', 'glide']) if (!sv.abilities.includes(a)) sv.abilities.push(a);
  sv.research ??= { analysed: [], done: [], running: [], levels: {} };
  sv.research.done.push('rb-cells', 'rb-backpack', 'rb-pulse', 'rb-efficiency');
  Object.assign(sv.research.levels, { chargeCells: 3, backpack: 2, pulseRadius: 1 });
  s.state.progression.parkGrowth = 3;
  // #625: Pylon, Tally, Moss and Gable woken (Tide is woken for real later, for its moment)
  for (const k of ['pylon', 'tally', 'moss', 'gable']) sv.keepers[k] = { step: 'request1' };
}

/**
 * A close look at Bloombot: facing south, the camera behind it (back) or in front of it (front). Photo mode, since
 * the play camera stops well short of a close-up; its bar is hidden for the shot, and the caller leaves it after.
 */
async function closeUp(page, side) {
  await page.evaluate((side) => {
    const g = window.solarbloom;
    if (!g.photo.active) g.photo.enter();
    if (!g.photo.clean) g.photo.action('backpack'); // its bar hidden (the backpack key's toggle)
    g.bot.pose.facing = 0;
    g.camera.jumpZoom(g.camera.maxZoom);
    g.camera.turnTo(side === 'back' ? 180 + 30 : 0 + 25, true);
    g.camIdle = 0;
  }, side);
  await page.waitForTimeout(900);
}

/** A shot of the whole screen, and a close crop around Bloombot so its parts can be judged. */
async function botShots(page, path) {
  await page.screenshot({ path: `${path}.png` });
  const c = await page.evaluate(() => {
    const g = window.solarbloom;
    const p = g.bot.visuals.root.getPosition().clone();
    p.y += 0.45;
    const s = g.camera.toScreen(p);
    return { x: s.x, y: s.y };
  });
  const vw = page.viewportSize();
  const w = 480, h = 480;
  const x = Math.max(0, Math.min(vw.width - w, c.x - w / 2));
  const y = Math.max(0, Math.min(vw.height - h, c.y - h / 2));
  await page.screenshot({ path: `${path}-close.png`, clip: { x, y, width: w, height: h }, scale: 'css' });
}

try {
  for (const [w, h, query, pct, label] of [
    [1280, 800, '&gfx=deck', 150, 'deck-150'],
    [1280, 720, '', 100, '1280x720'],
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${port}/?slot=1&new=1${query}`);
    await page.waitForFunction(() => window.solarbloom?.bot?.visuals?.loaded && document.querySelector('#loading')?.classList.contains('gone'));
    await page.evaluate((pct) => {
      const g = window.solarbloom;
      g.pause.clear('blur');
      g.hud.setUiScale(pct);
      // a clear stretch of the park to stand in for the close-ups
      const [fx, fz] = g.sim.areas.info('park').landmark;
      g.bot.teleport('g', fx - 2.5, fz + 4.5);
    }, pct);
    await page.waitForTimeout(1200);
    const L = label;
    const shot = (n) => page.screenshot({ path: `${out}/${n}-${label}.png` });

    // ── 1. early: Bloombot as it starts, and its page ──
    await closeUp(page, 'back');
    const early = await page.evaluate(() => window.solarbloom.bot.visuals.growthPieces.map((p) => p.name));
    check(early.length === 0, `${L}: a new Bloombot wears nothing extra (${early.join(', ')})`);
    await botShots(page, `${out}/1-bloombot-early-back-${label}`);
    await closeUp(page, 'front');
    await botShots(page, `${out}/2-bloombot-early-front-${label}`);
    await page.evaluate(() => window.solarbloom.photo.exit());

    // the backpack, then E to the next tab: Bloombot's page
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => window.solarbloom.hud.backpackOpen);
    await page.evaluate(() => window.solarbloom.hud.backpack.show('items', true));
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(400);
    let p = await page.evaluate(pageNow);
    check(/Bloombot/.test(p.tab), `${L}: E moves from Items to the Bloombot tab ("${p.tab}")`);
    check(p.rows.length === 31 && p.rows[0] === 'Pry · Next' && p.rows.slice(1, 4).every((r) => / · Later$/.test(r)), `${L}: four moves, Pry next (${p.rows.slice(0, 4).join(' | ')})`);
    check(p.rows.slice(4, 8).join(' | ') === 'Pry II · Later | Hover II · Later | Climb II · Later | Glide II · Later', `${L}: #626: and their second levels, all later (${p.rows.slice(4, 8).join(' | ')})`);
    check(/^Spreading pulse · \d+ of 20$/.test(p.rows[8]) && p.rows[9] === 'Steady charge · Later' && p.rows[10] === 'Nimble hands · Later', `${L}: #622: three park milestones, the first counting the park (${p.rows.slice(8, 11).join(' | ')})`);
    // #625: ten knacks, one per Keeper; only Tide, on the beach beside the park, can be reached yet
    check(p.rows.slice(11, 21).every((r, i) => (i === 2 ? r === 'Beachcomber · Next' : / · Later$/.test(r))), `${L}: #625: ten knacks, Tide's next (${p.rows.slice(11, 21).join(' | ')})`);
    check(p.rows.slice(21).every((r) => / · Level 0 of [235]$/.test(r)) && p.rows.length === 31, `${L}: ten upgrades, none started (${p.rows.slice(21).join(' | ')})`);
    check(/Bring the fountain what it asks for and it teaches this/.test(p.detail) && /Show me where/.test(p.detail), `${L}: Pry says how to learn it, with Show me where ("${p.detail}")`);
    await shot('3-page-early');
    // the detail's end is above the footer, or the detail scrolls to it (the wheel, and Show me where at its foot)
    const reach = await page.evaluate(() => {
      const d = document.querySelector('#bpScreen .bb-detail');
      const foot = document.querySelector('#bpScreen .sheet-foot');
      const r = d.getBoundingClientRect();
      const f = foot?.getBoundingClientRect();
      const scrolls = getComputedStyle(d).overflowY === 'auto' && d.scrollHeight > d.clientHeight + 1;
      d.scrollTop = d.scrollHeight;
      const last = d.lastElementChild.getBoundingClientRect();
      return { bottom: Math.round(r.bottom), foot: Math.round(f?.top ?? innerHeight), scrolls, lastBottom: Math.round(last.bottom), detailBottom: Math.round(r.bottom) };
    });
    check(reach.bottom <= reach.foot + 1 && reach.lastBottom <= reach.detailBottom + 1, `${L}: the detail ends above the footer and its last line can be reached (${JSON.stringify(reach)})`);

    // ── 2. late: every move, some upgrades ──
    await page.evaluate(() => window.solarbloom.hud.toggleBackpack(false));
    await page.evaluate(growLate);
    await page.waitForTimeout(500);
    const late = await page.evaluate(() => window.solarbloom.bot.visuals.growthPieces.map((p) => p.name));
    // #627: a mark for each move, a leaf for each level of Wider pulse, a cell, a pocket
    const n = (pre) => late.filter((x) => x.startsWith(pre)).length;
    check(n('grow-marks-') === 4 && n('grow-leaves-') === 1 && n('grow-cells-') === 3 && n('grow-pockets-') === 2, `${L}: grown, it wears four move marks, a leaf, three cells and two pockets (${late.join(', ')})`);
    check(n('grow-knacks-') === 4, `${L}: #625: a bead for each of the four knacks (${late.join(', ')})`);
    check(late.includes('grow-bud-tip') && late.includes('grow-collar-ring') && n('grow-cuffs-') === 2, `${L}: #622: and what the park grew: a bud, a collar and two cuffs (${late.join(', ')})`);
    await closeUp(page, 'back');
    await botShots(page, `${out}/4-bloombot-late-back-${label}`);
    await closeUp(page, 'front');
    await botShots(page, `${out}/5-bloombot-late-front-${label}`);
    await page.evaluate(() => window.solarbloom.photo.exit());

    await page.evaluate(() => {
      const h = window.solarbloom.hud;
      h.toggleBackpack(true);
      h.backpack.show('bloombot', true);
    });
    await page.waitForTimeout(300);
    p = await page.evaluate(pageNow);
    check(p.rows.slice(0, 4).every((r) => / · Learned$/.test(r)), `${L}: every move learned (${p.rows.slice(0, 4).join(' | ')})`);
    check(p.rows.slice(8, 11).every((r) => / · Grown$/.test(r)), `${L}: #622: every park milestone grown (${p.rows.slice(8, 11).join(' | ')})`);
    check(['Quick charge · Learned', 'Eye for value · Learned', 'Beachcomber · Next', 'Green thumb · Learned'].every((r, i) => p.rows[11 + i] === r) && p.rows[17] === 'Easy rest · Learned', `${L}: #625: the knacks learned (${p.rows.slice(11, 21).join(' | ')})`);
    check(p.rows.includes('Bigger charge · Level 3 of 5') && p.rows.includes('Roomier backpack · Level 2 of 5') && p.rows.includes('Wider pulse · Level 1 of 5'), `${L}: upgrade levels show (${p.rows.slice(11).join(' | ')})`);
    // the arrows move through the rows; the one in focus fills the detail
    await page.focus('#bb-backpack');
    await page.waitForTimeout(200);
    p = await page.evaluate(pageNow);
    check(/Roomier backpack/.test(p.detail) && /Go to the crafting table in the house and make level 3 in its Upgrade tab\. It takes /.test(p.detail), `${L}: the upgrade in focus says how to get its next level ("${p.detail}")`);
    await shot('6-page-late');
    // #625: a knack's detail, and the next one's way
    await page.focus('#bb-knack-moss');
    await page.waitForTimeout(200);
    p = await page.evaluate(pageNow);
    check(/Green thumb/.test(p.detail) && /Moss taught Bloombot this when it woke in Elder Grove\./.test(p.detail), `${L}: #625: a learned knack says who taught it ("${p.detail}")`);
    // the longest "how" on the page: Enter on its row steps to the detail's end (Show me where, or its last lines when
    // the detail is too tall to show whole), and that end is in view
    // (the longest with Show me where, and the longest without: a Keeper not reached yet)
    const longest = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#bpScreen .bb-row')];
      const best = { where: ['', 0], none: ['', 0] };
      for (const r of rows) {
        r.focus();
        const n = document.querySelector('#bpScreen #bb-how')?.textContent.length ?? 0;
        const k = document.querySelector('#bpScreen #bb-where') ? 'where' : 'none';
        if (n > best[k][1]) best[k] = [r.id, n];
      }
      return [best.where[0], best.none[0]];
    });
    for (const [i, row] of longest.entries()) {
      await page.focus(`#${row}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      const end = await page.evaluate(() => {
        const d = document.querySelector('#bpScreen .bb-detail').getBoundingClientRect();
        const a = document.activeElement;
        const r = a.getBoundingClientRect();
        return { focus: a.id, top: Math.round(r.top), bottom: Math.round(r.bottom), detailTop: Math.round(d.top), detailBottom: Math.round(d.bottom), how: document.querySelector('#bpScreen #bb-how').textContent };
      });
      const fits = end.focus === 'bb-where' || end.focus === 'bb-how' || end.focus === row; // a row whose detail fits keeps the focus
      check(fits && (end.focus === row || (end.bottom <= end.detailBottom + 1 && end.top >= end.detailTop - 1)), `${L}: #625: the longest detail ${i ? 'without' : 'with'} Show me where (${row}) can be read to its end with the keys (${JSON.stringify(end)})`);
      await shot(`9-page-longest-${i ? 'no-button' : 'button'}`);
    }
    await page.focus('#bb-knack-tide');
    await page.waitForTimeout(200);
    p = await page.evaluate(pageNow);
    check(/Beachcomber/.test(p.detail) && /Tide is a robot asleep in Saltwind Beach\. Pulse it to stir it, then bring it 5 of anything to wake it\./.test(p.detail) && /Show me where/.test(p.detail), `${L}: #625: the next knack says how to wake its Keeper, with Show me where ("${p.detail}")`);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    p = await page.evaluate(pageNow);
    check(p.focus.startsWith('bb-') && p.focus !== 'bb-backpack', `${L}: the arrows move the focus between rows (now ${p.focus})`);
    await page.focus('#bb-backpack');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    p = await page.evaluate(pageNow);
    check(p.focus === 'bb-where', `${L}: Enter steps to Show me where (${p.focus})`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const went = await page.evaluate(() => ({ open: window.solarbloom.hud.backpackOpen, mark: window.solarbloom.wayMark }));
    check(!went.open && !!went.mark, `${L}: Show me where closes the backpack and marks the house (${JSON.stringify(went)})`);

    // ── 3. the moment it grows: the first one points to the page ──
    const say = async (fire, want = 'level|can ') => {
      await page.evaluate(fire);
      await page.waitForFunction((want) => [...document.querySelectorAll('#toasts .toast')].some((t) => new RegExp(want).test(t.textContent)), want, { timeout: 8000 }).catch(() => {});
      return page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent.trim()).pop() ?? '');
    };
    await page.evaluate(() => {
      const ideas = window.solarbloom.sim.state.progression.ideas;
      const i = ideas.indexOf('bloombotPage');
      if (i >= 0) ideas.splice(i, 1);
    });
    const first = await say(() => window.solarbloom.sim.bus.emit('research.upgraded', { id: 'pulseRadius', level: 2 }));
    check(/^Bloombot got better: Wider pulse, level 2 of 5/.test(first) && /See what's next on its page in the backpack \(Tab or I\)\./.test(first), `${L}: the first moment names the upgrade and points to the page ("${first}")`);
    await shot('7-grew');
    await page.waitForTimeout(6500);
    const second = await say(() => window.solarbloom.sim.bus.emit('research.upgraded', { id: 'backpack', level: 3 }));
    check(second === 'Bloombot got better: Roomier backpack, level 3 of 5', `${L}: later moments just say what grew ("${second}")`);
    await page.waitForTimeout(4000);
    // #622: the park's milestone, with what it does
    const park = await say(() => window.solarbloom.sim.bus.emit('bloombot.parkGrew', { step: 1, id: 'spill' }), 'park helped');
    check(park === 'The park helped Bloombot grow: Spreading pulseA pulse on dry ground wakes the patch beside it too.', `${L}: #622: the park's moment names what grew and what it does ("${park}")`);
    await page.waitForTimeout(800); // past its fade in
    await shot('8-park-grew');
    await page.waitForTimeout(6000);

    // ── 4. #625: waking Tide for real: it teaches its knack in its own words, and the moment says so ──
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.bot.teleport('g', 10.5, 17.5);
      g.sim.keepers.pulse('tide');
      g.sim.inventory.add('scrap', 5);
    });
    await page.waitForTimeout(600);
    const woke = await page.evaluate(() => window.solarbloom.sim.keepers.interact('tide'));
    const knack = await say(() => {}, 'taught Bloombot');
    check(woke === 'woke' && knack === 'Tide taught Bloombot a knack: BeachcomberJunk piles you have dug fill back up a fifth sooner.', `${L}: #625: waking Tide teaches its knack, with a moment ("${woke}", "${knack}")`);
    const beads = await page.evaluate(() => window.solarbloom.bot.visuals.growthPieces.filter((x) => x.name.startsWith('grow-knacks-')).length);
    check(beads === 5, `${L}: #625: and Bloombot wears a fifth bead (${beads})`);
    await page.waitForTimeout(800);
    await shot('10-knack-woke');
    // the second bubble: the knack in Tide's own words, then its first request
    const said = await page
      .waitForFunction(() => document.querySelector('.oc-bubble:not([hidden])')?.textContent.includes('The sea always brings things back.') && document.querySelector('.oc-bubble').textContent, undefined, { timeout: 12000 })
      .then((h) => h.jsonValue())
      .catch(() => page.evaluate(() => document.querySelector('.oc-bubble')?.textContent ?? ''));
    check(/^TideThe sea always brings things back\. The piles you dig will fill up again sooner than you think\.The lock's hinges are gone\./.test(said), `${L}: #625: Tide teaches it in its own words, then asks for its first request ("${said}")`);
    await page.waitForTimeout(400);
    await shot('11-knack-said');

    check(!errors.length, `${L}: no page errors ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]).catch(() => {});
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);

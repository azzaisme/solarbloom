// #629 (E25): the Bloombot page's live look at Bloombot, in a real game at 1280 × 800 and 150% interface size (the
// Deck), and at 1280 × 720. Checks and shots:
//   - the page shows Bloombot itself, drawn (not blank) above the detail, alone on the paper;
//   - choosing a row (arrow keys, or the mouse) turns the view to that row's part, makes it glow, and shows what its
//     next level adds as a see-through ghost: a cell for Bigger charge, the lamp for Lantern, Climb's mark, the bud;
//   - at a top level there is no ghost; the view stops when the page closes or another tab opens;
//   - the detail's last line can still be reached under the view.
// Shots go to docs/review/e25-629/ (SHOTS_DIR overrides).
//   npm run build && GPU=1 node tests/e2e/bloombot-turntable-shots.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review/e25-629';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4274);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const SIZES = [
  { label: 'deck-150', w: 1280, h: 800, ui: 150 },
  { label: '1280x720', w: 1280, h: 720, ui: 100 },
  { label: '1280x800', w: 1280, h: 800, ui: 100 },
];

/** what the view shows now: Bloombot's share of the canvas, what glows, the ghost, where the camera is going */
const view = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('#bbView');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let drawn = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) drawn++;
    const g = window.solarbloom;
    return { drawn: drawn / (c.width * c.height), ...g.bot.visuals.focusView, target: g.turntable.target, showing: g.turntable.showing, focus: g.turntable.focusPart };
  });
/**
 * What of the detail is in sight now: its name (in the head), what it does, the view, and how to get it whole (its
 * heading and lines below the head and above the bottom, and above Show me where).
 */
const headSeen = (page) =>
  page.evaluate(() => {
    const D = document.querySelector('#bpDetail');
    const d = D.getBoundingClientRect();
    const head = D.querySelector('.bb-head').getBoundingClientRect();
    const seen = (sel) => {
      const r = D.querySelector(sel)?.getBoundingClientRect();
      return !!r && r.height > 0 && r.top >= head.bottom - 1 && r.bottom <= d.bottom + 1;
    };
    const name = D.querySelector('h3').getBoundingClientRect();
    const h4 = D.querySelector('h4').getBoundingClientRect();
    const how = D.querySelector('#bb-how').getBoundingClientRect();
    const btn = D.querySelector('#bb-where')?.getBoundingClientRect();
    const v = document.querySelector('#bbView')?.getBoundingClientRect();
    return {
      name: name.top >= d.top - 1 && name.bottom <= head.bottom + 1,
      does: seen('.bb-does'),
      view: seen('.bb-view'),
      how: h4.top >= head.bottom - 1 && how.bottom <= (btn ? btn.top : d.bottom) + 1 && how.bottom <= d.bottom + 1,
      button: !btn || (btn.top >= head.bottom - 1 && btn.bottom <= d.bottom + 1),
      viewSize: v ? [Math.round(v.width), Math.round(v.height)] : null,
      focus: document.activeElement?.id,
      at: { top: Math.round(d.top), does: Math.round(D.querySelector('.bb-does').getBoundingClientRect().top), scroll: Math.round(D.scrollTop), head: Math.round(head.bottom), h4: Math.round(h4.top), how: Math.round(how.bottom), btn: btn && Math.round(btn.top), bottom: Math.round(d.bottom) },
    };
  });
/** chooses a row by clicking it, like the mouse */
const click = (page, id) => page.click(`#bb-${id}`);

for (const S of SIZES) {
  const page = await browser.newPage({ viewport: { width: S.w, height: S.h } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const L = S.label;
  try {
    await page.goto(`http://localhost:${port}/?slot=1&new=1&gfx=deck`);
    await page.waitForFunction(() => window.solarbloom?.bot?.visuals?.loaded && document.querySelector('#loading')?.classList.contains('gone'));
    await page.evaluate((ui) => {
      const g = window.solarbloom;
      g.pause.clear('blur');
      g.hud.setUiScale(ui);
      const sv = g.sim.state.salvage;
      sv.tier = Math.max(sv.tier, 1);
      sv.abilities = ['pry', 'hover'];
      sv.keepers.pylon = { step: 'request1' };
      sv.research ??= { analysed: [], done: [], running: [], levels: {} };
      sv.research.done.push('rb-cells', 'rb-backpack', 'rb-pulse', 'rb-efficiency', 'rb-sprint', 'rb-lantern', 'rb-eye');
      sv.research.levels = { chargeCells: 2, backpack: 1, pulseRadius: 3, sprint: 2, keenEye: 1 };
      g.sim.state.progression.parkGrowth = 1;
      const [fx, fz] = g.sim.areas.info('park').landmark;
      g.bot.teleport('g', fx - 2.5, fz + 4.5);
      g.bot.pose.facing = ui === 150 ? 0.4 : 2.6;
    }, S.ui);
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.solarbloom.hud.toggleBackpack(true);
      window.solarbloom.hud.backpack.show('bloombot', true);
    });
    await page.waitForTimeout(900);
    let v = await view(page);
    check(!!v && v.showing && v.drawn > 0.04 && v.drawn < 0.6, `${L}: the page shows Bloombot, drawn alone on the paper (${v && (v.drawn * 100).toFixed(1)}% of the view)`);

    // Bigger charge, level 2 of 5: its cells glow, the third shows as a ghost, the view looks from behind
    await click(page, 'chargeCells');
    await page.waitForTimeout(900);
    v = await view(page);
    check(v.focus === 'cells' && v.glowing.length === 2 && v.ghosts.join() === 'ghost-grow-cells-2' && v.target.yaw > 120, `${L}: Bigger charge: two cells glow, the third is a ghost, seen from behind (${JSON.stringify(v)})`);
    // and really from behind: the camera is on the far side of Bloombot from its face
    const behind = await page.evaluate(() => {
      const g = window.solarbloom;
      const r = g.bot.visuals.root;
      const f = r.forward;
      const c = g.turntable.cam.getPosition();
      const p = r.getPosition();
      return (c.x - p.x) * f.x + (c.z - p.z) * f.z; // its face looks down +z, the back of its forward
    });
    check(behind > 0, `${L}: the cells' view is from behind Bloombot, whichever way it faces (${behind.toFixed(2)})`);
    await page.screenshot({ path: `${out}/1-cells-${L}.png` });

    // Lantern (not bought yet): nothing glows, the lamp of level 1 shows as a ghost
    await click(page, 'lantern');
    await page.waitForTimeout(900);
    v = await view(page);
    check(v.focus === 'lamp' && !v.glowing.length && v.ghosts.includes('ghost-grow-lamp-bulb'), `${L}: Lantern: its lamp to come shows as a ghost (${v.ghosts.join(', ')})`);
    let h = await headSeen(page);
    check(h.focus === 'bb-where' && h.name && h.how && h.button, `${L}: Lantern chosen: the focus steps to Show me where, with the name and the whole of how to get it in sight (${JSON.stringify(h)})`);
    await page.screenshot({ path: `${out}/2-lantern-ghost-${L}.png` });

    // the keys: Enter on a row steps to its Show me where, the head still in sight; right from the list reaches it too
    await page.focus('#bb-sprint');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    h = await headSeen(page);
    check(h.focus === 'bb-where' && h.name && h.how && h.button, `${L}: Enter on Longer stride steps to Show me where, its name and how to get it in sight (${JSON.stringify(h)})`);
    // every row with a Show me where, chosen: how to get it is never under the head, the longest included
    const rowIds = await page.evaluate(() => [...document.querySelectorAll('#bpScreen [data-bb]')].map((b) => b.dataset.bb));
    const hidden = [];
    let longest = { id: '', n: 0 };
    for (const id of rowIds) {
      await click(page, id);
      await page.waitForTimeout(150);
      const hs = await headSeen(page);
      const n = await page.evaluate(() => document.querySelector('#bb-how').textContent.length);
      if (hs.focus === 'bb-where' && n > longest.n) longest = { id, n };
      if (hs.focus === 'bb-where' && !(hs.name && hs.how && hs.button)) hidden.push(`${id} ${JSON.stringify(hs.at)}`);
    }
    check(!hidden.length && longest.id, `${L}: all ${rowIds.length} rows: with Show me where focused, how to get it is whole and in sight (longest: ${longest.id}, ${longest.n} letters) ${hidden.join(' | ')}`);
    await click(page, longest.id);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/8-longest-how-${L}.png` });
    // chosen by the arrows (the focus stays on the row), the detail shows from its top: name, what it does, Bloombot
    await page.focus('#bb-chargeCells');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(500);
    h = await headSeen(page);
    check(h.focus === 'bb-chargeCells' && h.name && h.does && h.view && h.viewSize[1] >= 90, `${L}: on a row, the detail shows what it does and Bloombot (${JSON.stringify(h)})`);
    await page.focus('#bb-luckyPulse');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    h = await headSeen(page);
    check(h.focus === 'bb-where' && h.name, `${L}: right from the list reaches Show me where (${h.focus})`);
    // the arrow keys move the focus, and the view follows
    await page.focus('#bb-lantern');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => document.activeElement?.id);
    v = await view(page);
    check(/^bb-/.test(after) && after !== 'bb-lantern' && v.focus !== 'lamp', `${L}: an arrow moves the focus (${after}) and the view turns to its part (${v.focus})`);

    // a move: Hover is had (its mark glows), Climb is next (its mark a ghost)
    await click(page, 'hover');
    await page.waitForTimeout(700);
    v = await view(page);
    check(v.focus === 'marks' && v.glowing.join() === 'grow-marks-hover' && !v.ghosts.length, `${L}: Hover, learned: its own mark glows (${v.glowing.join(', ')})`);
    await click(page, 'climb');
    await page.waitForTimeout(700);
    v = await view(page);
    check(v.ghosts.join() === 'ghost-grow-marks-climb', `${L}: Climb, next: its mark to come shows as a ghost (${v.ghosts.join(', ')})`);
    await page.screenshot({ path: `${out}/3-climb-mark-${L}.png` });

    // Longer stride: the view goes down to the feet
    await click(page, 'sprint');
    await page.waitForTimeout(1200);
    v = await view(page);
    check(v.focus === 'feet' && v.target.up < 0.5 && v.ghosts.length > 0, `${L}: Longer stride: the view looks lower, at the feet, and level 3's heel fins are a ghost (${v.ghosts.join(', ')})`);
    await page.screenshot({ path: `${out}/4-feet-${L}.png` });

    // a park milestone: Steady charge (the collar), next
    await click(page, 'thrift');
    await page.waitForTimeout(1000);
    v = await view(page);
    check(v.focus === 'collar' && v.ghosts.join() === 'ghost-grow-collar-ring', `${L}: Steady charge, next: the collar shows as a ghost (${v.ghosts.join(', ')})`);
    await page.screenshot({ path: `${out}/5-collar-${L}.png` });

    // #625: the Keepers' knacks: Pylon (woken) has its bead, which glows in Pylon's colour; Tally's is to come
    await click(page, 'knack-pylon');
    await page.waitForTimeout(1000);
    v = await view(page);
    check(v.focus === 'knacks' && v.glowing.join() === 'grow-knacks-pylon' && !v.ghosts.length, `${L}: Pylon's knack, learned: its bead glows (${v.glowing.join(', ')})`);
    await click(page, 'knack-tally');
    await page.waitForTimeout(700);
    v = await view(page);
    check(v.ghosts.join() === 'ghost-grow-knacks-tally', `${L}: Tally's knack, to come: its bead shows as a ghost (${v.ghosts.join(', ')})`);
    await page.screenshot({ path: `${out}/7-knack-${L}.png` });

    // the detail's last line can be reached, and the head stays in sight over it
    const reach = await page.evaluate(() => {
      const d = document.querySelector('#bpDetail');
      d.scrollTop = d.scrollHeight;
      const r = d.getBoundingClientRect();
      const last = d.lastElementChild.getBoundingClientRect();
      const name = d.querySelector('h3').getBoundingClientRect();
      return { last: Math.round(last.bottom), bottom: Math.round(r.bottom), name: Math.round(name.top), top: Math.round(r.top), scrolled: d.scrollTop };
    });
    check(reach.last <= reach.bottom + 1 && reach.name >= reach.top - 1, `${L}: the detail's last line can be reached, the name still in sight above it (${JSON.stringify(reach)})`);

    // another tab, and closing: the view stops
    await page.evaluate(() => window.solarbloom.hud.backpack.show('items'));
    await page.waitForTimeout(300);
    v = await page.evaluate(() => window.solarbloom.turntable.showing);
    check(v === false, `${L}: on another tab the view stops`);
    await page.evaluate(() => window.solarbloom.hud.backpack.show('bloombot'));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.solarbloom.hud.toggleBackpack(false));
    await page.waitForTimeout(300);
    v = await page.evaluate(() => ({ showing: window.solarbloom.turntable.showing, ghosts: window.solarbloom.bot.visuals.focusView.ghosts.length }));
    check(!v.showing && v.ghosts === 0, `${L}: closed, the view stops and leaves no ghost in the world (${JSON.stringify(v)})`);

    // late: a top level has no ghost
    await page.evaluate(() => {
      const sv = window.solarbloom.sim.state.salvage;
      sv.research.levels.chargeCells = 5;
      window.solarbloom.hud.toggleBackpack(true);
      window.solarbloom.hud.backpack.show('bloombot', true);
    });
    await page.waitForTimeout(600);
    await click(page, 'chargeCells');
    await page.waitForTimeout(900);
    v = await view(page);
    check(v.glowing.length === 5 && !v.ghosts.length, `${L}: Bigger charge at the top: five cells glow, no ghost (${JSON.stringify(v)})`);
    await page.screenshot({ path: `${out}/6-cells-top-${L}.png` });
    await page.evaluate(() => window.solarbloom.hud.toggleBackpack(false));
    check(!errors.length, `${L}: no page errors ${errors.join(' | ')}`);
  } catch (e) {
    failed++;
    console.log('✗', L, e);
    await page.screenshot({ path: `${out}/x-error-${L}.png` }).catch(() => {});
  }
  await page.close();
}
await browser.close();
server.httpServer.close();
console.log(failed ? `${failed} failed` : 'all good');
process.exit(failed ? 1 : 0);

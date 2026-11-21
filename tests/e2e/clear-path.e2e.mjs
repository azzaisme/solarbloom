// E24 "A clear path" (#605–#608), played in a real game: the goal card (the goal, what it brings, every part
// counted from the start, the next step and Show me where), the guide's first line and the waymark's spot on the first
// pile, Show me where turning the camera, a barricade's plain refusal, the park's count while greening, the park
// part done (its line and the glinting piles), and a Keeper's request under the fountain goal. At 1280 × 720 (100%)
// and on the Deck (1280 × 800, ?gfx=deck) at 150% interface size; each check also asks that the new pieces sit on
// screen without covering the prompt or each other. Shots go to docs/review/e24/ (SHOTS_DIR overrides).
//   npm run build && node tests/e2e/clear-path.e2e.mjs      (GPU=1: the real GPU, d3d11; otherwise SwiftShader)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review/e24';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4258);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

/** The new pieces' boxes: on screen, and not covering the prompt, the card, the charge or the dock (nor each other). */
function layout() {
  const box = (sel) => {
    const e = document.querySelector(sel);
    if (!e || e.hidden || e.offsetParent === null) return undefined;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : undefined;
  };
  const hit = (a, b) => a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const inside = (r) => !r || (r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight);
  const mine = { guide: box('#guide'), tally: box('#tally'), card: box('#obj') };
  // the minimap with its N badge, which stands above the disc (#620: the badge was what hid the card's button)
  const mm = box('#minimap');
  const nb = box('#minimap .mm-n');
  const minimap = mm && nb ? new DOMRect(Math.min(mm.left, nb.left), Math.min(mm.top, nb.top), Math.max(mm.right, nb.right) - Math.min(mm.left, nb.left), Math.max(mm.bottom, nb.bottom) - Math.min(mm.top, nb.top)) : mm;
  const others = { prompt: box('#prompt'), charge: box('#res'), dock: box('#dock'), minimap };
  const bad = [];
  for (const [n, r] of Object.entries(mine)) {
    if (!inside(r)) bad.push(`${n} off screen`);
    for (const [m, o] of Object.entries(others)) if (hit(r, o)) bad.push(`${n} covers ${m}`);
  }
  if (hit(mine.guide, mine.tally)) bad.push('guide covers tally');
  if (hit(mine.guide, mine.card) || hit(mine.tally, mine.card)) bad.push('a line covers the card');
  return bad;
}

/** The card as drawn. */
function cardNow() {
  const t = (s) => document.querySelector(s)?.textContent?.trim() ?? '';
  const where = document.querySelector('#objWhere');
  return {
    title: t('#objTitle'),
    why: document.querySelector('#objWhy')?.hidden ? '' : t('#objWhy'),
    parts: [...document.querySelectorAll('#objParts li')].map((l) => l.textContent.trim()),
    next: document.querySelector('#objNextRow')?.hidden ? '' : t('#objNext'),
    where: !!where && !where.hidden ? where.textContent.trim() : '',
  };
}

try {
  for (const [w, h, query, pct, label] of [
    [1280, 720, '', 100, '1280x720'],
    [1280, 800, '&gfx=deck', 150, 'deck-150'],
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((pct) => {
      // the interface size, as Settings saves it (the game reads it on load)
      try {
        const k = Object.keys(localStorage).find((x) => /settings/i.test(x));
        const s = k ? JSON.parse(localStorage.getItem(k)) : {};
        localStorage.setItem(k ?? 'solarbloom.settings', JSON.stringify({ ...s, uiScale: pct }));
      } catch {
        /* the game's default */
      }
    }, pct);
    await page.goto(`http://localhost:${port}/?slot=1&new=1${query}`);
    await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
    await page.evaluate((pct) => {
      const g = window.solarbloom;
      g.pause.clear('blur');
      g.hud.setUiScale(pct);
    }, pct);
    const shot = (n) => page.screenshot({ path: `${out}/${n}-${label}.png` });
    const L = `${label}`;

    // ── 1. a new game: the goal and all its parts, the first guide line, the arrow on the first pile ──
    await page.waitForFunction(() => !!window.solarbloom.hud.guide.lastText, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    const c1 = await page.evaluate(cardNow);
    check(c1.title === 'Wake the fountain' && c1.why === 'Bloombot learns to pry open rubble', `${L}: the goal and what it brings ("${c1.title}" · "${c1.why}")`);
    check(c1.parts.length === 3 && /Scrap.*0 of 20/.test(c1.parts[0]) && /Seeds.*0 of 6/.test(c1.parts[1]) && /Park.*of 60/.test(c1.parts[2]), `${L}: every part counted from the start (${c1.parts.join(' | ')})`);
    check(!!c1.next && /Show me where/.test(c1.where), `${L}: the next step under it, with Show me where ("${c1.next}" · "${c1.where}")`);
    // the owner's test: the card says what to press, with the player's own key (never a {placeholder})
    check(/hold \S+ beside one/.test(c1.next) && !/[{}]/.test(c1.next), `${L}: the card names the key to press ("${c1.next}")`);
    const g1 = await page.evaluate(() => window.solarbloom.hud.guide.lastText);
    const start = await page.evaluate(() => ({ pulses: window.solarbloom.sim.state.stats.pulses ?? 0, ideas: [...(window.solarbloom.sim.state.progression.ideas ?? [])] }));
    check(start.pulses === 0 && !start.ideas.includes('pulse') && !start.ideas.includes('park'), `${L}: a new game hasn't pulsed yet, so its pulse line is still to come (${JSON.stringify(start)})`);
    check(/^Hold .+ beside a glinting pile to dig out what the fountain needs\.$/.test(g1 ?? ''), `${L}: the first guide line ("${g1}")`);
    const arrow = await page.evaluate(() => {
      const g = window.solarbloom;
      // #609: the waymark stands on the goal spot (Game.goal, looked up twice a second); at the start bloombot is
      // right beside the pile, so the light itself has faded and the minimap pin tucks under bloombot
      const spot = g.goal && g.goal.cell;
      const pile = g.sim.advisor.nearestPile(['scrap', 'seeds']);
      return { spot, pile: pile && { x: pile.x, z: pile.z, material: pile.material } };
    });
    check(!!arrow.spot && !!arrow.pile && arrow.spot.x === arrow.pile.x && arrow.spot.z === arrow.pile.z, `${L}: the waymark's spot is the first pile (${JSON.stringify(arrow)})`);
    let bad = await page.evaluate(layout);
    check(!bad.length, `${L}: the card and the guide line sit clear of everything ${bad.join(', ')}`);
    await shot('1-new-game');

    // ── 2. Show me where (H): the spot is marked and (#632) a trail runs along the ground to it; the camera stays ──
    // (a new game starts beside its first pile, and a trail that starts where it ends counts as walked and fades:
    // step well away from it first)
    await page.evaluate(() => {
      const g = window.solarbloom;
      const [fx, fz] = g.sim.areas.info('park').landmark;
      g.bot.teleport('g', fx + 9.5, fz + 9.5);
      g.trail.clear();
    });
    await page.waitForTimeout(600);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(1600);
    const after = await page.evaluate(() => {
      const g = window.solarbloom;
      const w = g.wayMark;
      const way = g.trail.way;
      return { mark: !!w, trail: g.trail.showing, points: way?.points?.length ?? 0, reached: way?.reached };
    });
    check(after.mark && after.trail && after.points > 1 && after.reached === true, `${L}: Show me where marks the spot and lays a trail to it (${JSON.stringify(after)})`);
    await shot('2-show-me-where');

    // ── 3. a barricade's plain refusal ──
    const gate = await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      const r = s.gates;
      for (let z = -2; z < 30; z++)
        for (let x = -4; x < 30; x++) {
          const gd = r.gateAt(x, z);
          if (!gd || gd.kind !== 'barricade') continue;
          for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            if (!g.bot.walker.walkable('g', x + dx, z + dz) || r.gateAt(x + dx, z + dz)) continue;
            g.bot.teleport('g', x + dx + 0.5, z + dz + 0.5);
            g.bot.pose.facing = Math.atan2(-dx, -dz);
            return r.problem(gd);
          }
        }
      return undefined;
    });
    await page.waitForFunction(() => !!document.querySelector('#prompt .pr-why'), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);
    const why = await page.evaluate(() => document.querySelector('#prompt .pr-why')?.textContent ?? '');
    check(why === 'Rubble blocks the way. Wake the fountain and Bloombot will learn to pry it open.' && why === gate, `${L}: the barricade says what to do ("${why}")`);
    bad = await page.evaluate(layout);
    check(!bad.length, `${L}: the refusal sits clear of everything ${bad.join(', ')}`);
    await shot('3-blocked');

    // ── 4. greening the park: its count where the player is looking ──
    const tally = await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      const [fx, fz] = s.areas.info('park').landmark;
      g.bot.teleport('g', fx + 0.5, fz + 3.5);
      let n = 0;
      for (const t of s.areas.tiles('park')) {
        if (n >= 14) break;
        if (t.ground === 'restored' || !s.restoration.checkPulse(t).ok) continue;
        s.restoration.complete(t, 'pulse', undefined, true);
        n++;
      }
      return { text: g.hud.guide.tallyText, have: s.fountain.condition().have };
    });
    check(new RegExp(`^Park ${tally.have} of 60$`).test(tally.text ?? ''), `${L}: greening shows the park's count ("${tally.text}")`);
    await page.waitForTimeout(300);
    const c4 = await page.evaluate(cardNow);
    check(c4.parts.some((p) => new RegExp(`Park.*${tally.have} of 60`).test(p)), `${L}: and the card counts it too (${c4.parts[2]})`);
    bad = await page.evaluate(layout);
    check(!bad.length, `${L}: the count sits clear of everything ${bad.join(', ')}`);
    await shot('4-park-count');

    // ── 5. the park part done, the Scrap and Seeds still short: its line, and the piles glint ──
    const done = await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      for (const t of s.areas.tiles('park')) {
        if (s.fountain.condition().done) break;
        if (t.ground === 'restored' || !s.restoration.checkPulse(t).ok) continue;
        s.restoration.complete(t, 'pulse', undefined, true);
      }
      // the earlier ideas as already said, and no gap to wait out: the park-done line is next
      for (const id of ['salvage', 'pulse', 'park', 'fountain']) if (!s.state.progression.ideas.includes(id)) s.state.progression.ideas.push(id);
      g.ideaAt = -Infinity;
      g.ideaCheckAt = 0;
      const pile = s.advisor.nearestPile(['scrap', 'seeds']);
      g.bot.teleport('g', pile.x + 0.5, pile.z + 3.5);
      g.bot.pose.facing = Math.PI;
      return s.fountain.condition().done;
    });
    await page.waitForFunction(() => /still needs Scrap/.test(window.solarbloom.hud.guide.lastText ?? ''), null, { timeout: 20000 }).catch(() => {});
    const g5 = await page.evaluate(() => window.solarbloom.hud.guide.lastText);
    check(done && /^The fountain still needs Scrap and Seeds\. Hold .+ by the glinting piles to find them\.$/.test(g5 ?? ''), `${L}: the park part done says so, and where to look ("${g5}")`);
    const glints = await page.evaluate(async () => {
      const g = window.solarbloom;
      const burst = g.vfx.burst.bind(g.vfx);
      let gold = 0;
      g.vfx.burst = (p, n, o) => {
        gold++;
        return burst(p, n, o);
      };
      g.glintAt = 0;
      g.updatePileGlints();
      g.vfx.burst = burst;
      return { gold };
    });
    check(glints.gold > 0, `${L}: piles of what's short glint (${glints.gold} nearby)`);
    await page.waitForTimeout(500);
    bad = await page.evaluate(layout);
    check(!bad.length, `${L}: the line sits clear of everything ${bad.join(', ')}`);
    await shot('5-park-done');

    // ── 5b. the fountain awake, nothing pried yet: the rubble is the goal, and Show me where points at it ──
    await page.evaluate(() => {
      const s = window.solarbloom.sim;
      s.state.salvage.tier = 1;
      if (!s.state.salvage.abilities.includes('pry')) s.state.salvage.abilities.push('pry');
      window.solarbloom.hud.objective.adviceAt = -Infinity;
    });
    await page.waitForFunction(() => /^Pry open the rubble/.test(document.querySelector('#objTitle')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
    const c5 = await page.evaluate(cardNow);
    check(c5.title === 'Pry open the rubble' && c5.why === 'Another robot like Bloombot is asleep on the other side' && /Show me where/.test(c5.where), `${L}: once the fountain wakes, the rubble is the goal ("${c5.title}" · "${c5.next}")`);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(1600);
    const r5 = await page.evaluate(() => {
      const g = window.solarbloom;
      const w = g.wayMark;
      return w ? { gate: !!g.sim.gates.gateAt(w.x, w.z) } : null;
    });
    check(!!r5?.gate, `${L}: and Show me where marks the rubble (${JSON.stringify(r5)})`);
    bad = await page.evaluate(layout);
    check(!bad.length, `${L}: the card sits clear of everything ${bad.join(', ')}`);
    await shot('5b-pry-goal');

    // ── 6. a Keeper's request sits under the fountain goal ──
    const keeper = await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      s.state.salvage.tier = 1;
      if (!s.state.salvage.abilities.includes('pry')) s.state.salvage.abilities.push('pry');
      const gateId = 'g-mastRow';
      if (!s.state.salvage.opened.includes(gateId)) s.state.salvage.opened.push(gateId);
      // the Mast Row's Keeper, found where it stands (the page can't import the data)
      let id;
      for (let z = -60; z < 10 && !id; z++)
        for (let x = -10; x < 60 && !id; x++) {
          const k = s.keepers.at(x, z);
          if (k && k.region === 'mastRow') id = k.id;
        }
      if (id) s.state.salvage.keepers[id] = { step: 'request1' };
      return { id, pinned: s.keepers.pinned()?.text ?? null };
    });
    await page.waitForTimeout(1200);
    const g6 = await page.evaluate(() => window.solarbloom.hud.guide.text);
    check(!/park alive/.test(g6 ?? ''), `${L}: the park-done line goes once the fountain moves on ("${g6 ?? ''}")`);
    const c6 = await page.evaluate(cardNow);
    check(c6.title === 'The pump turns' && !!keeper.pinned && c6.next.includes(keeper.pinned), `${L}: the Keeper's request sits under the fountain goal ("${c6.title}" · "${c6.next}")`);
    bad = await page.evaluate(layout);
    check(!bad.length, `${L}: the card sits clear of everything ${bad.join(', ')}`);
    await shot('6-keeper-under-goal');

    // ── 7. #613: running low names where to rest; Show me where leads there; standing there shows it charging ──
    await page.evaluate(() => {
      const g = window.solarbloom;
      const [fx, fz] = g.sim.areas.info('park').landmark;
      g.bot.teleport('g', fx + 9.5, fz + 9.5);
      g.sim.charge.drainForTest();
      g.hud.objective.adviceAt = -Infinity;
    });
    await page.waitForFunction(() => /running low/.test(document.querySelector('#objNext')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
    const c7 = await page.evaluate(cardNow);
    check(/^Bloombot is running low\. Stand still by the (fountain|house) for a while to charge up\.$/.test(c7.next) && c7.title === 'The pump turns', `${L}: running low says where to rest, under the goal ("${c7.next}")`);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(400);
    const rest = await page.evaluate(() => {
      const g = window.solarbloom;
      const w = g.wayMark;
      if (!w) return undefined;
      g.bot.teleport(w.roofId, w.x + 0.5, w.z + 0.5);
      return w;
    });
    await page.waitForFunction(() => /Charging up/.test(window.solarbloom.hud.guide.tallyText ?? ''), null, { timeout: 15000 }).catch(() => {});
    const chip = await page.evaluate(() => ({ text: window.solarbloom.hud.guide.tallyText, resting: window.solarbloom.sim.charge.resting }));
    check(!!rest && chip.resting && chip.text === 'Charging up', `${L}: at the spot Show me where marked, standing still shows it charging (${JSON.stringify(chip)})`);
    bad = await page.evaluate(layout);
    check(!bad.length, `${L}: the charging chip sits clear of everything ${bad.join(', ')}`);
    await shot('7-charging');

    // ── 8. #620: the card never sits on the minimap, at any fountain step, with the longest line under it ──
    for (let tier = 0; tier < 5; tier++) {
      for (const low of [false, true]) {
        const said = await page.evaluate(
          ({ tier, low }) => {
            const g = window.solarbloom;
            const sv = g.sim.state.salvage;
            sv.tier = tier;
            sv.abilities = ['pry', 'hover', 'climb', 'glide'].slice(0, tier);
            if (low) g.sim.charge.drainForTest();
            else g.sim.charge.refillForTest();
            g.hud.objective.adviceAt = -Infinity;
            return tier;
          },
          { tier, low },
        );
        await page.waitForTimeout(1300);
        const c8 = await page.evaluate(cardNow);
        bad = (await page.evaluate(layout)).filter((b) => b.startsWith('card'));
        const fit = await page.evaluate(() => ({ card: document.querySelector('#obj').className, map: document.querySelector('#minimap').className }));
        check(!bad.length, `${L}: fountain step ${said + 1}${low ? ', running low' : ''}: the card clears the minimap and the charge ${bad.join(', ')} ("${c8.title}" · ${c8.parts.length} parts · "${c8.next}" · ${JSON.stringify(fit)})`);
        // the title on one line, and the card no wider than its own width (tall over the corner, never wide over the scene)
        const shape = await page.evaluate(() => {
          const h = document.querySelector('#objTitle');
          const lh = parseFloat(getComputedStyle(h).lineHeight);
          const card = document.querySelector('#obj');
          const zoom = card.getBoundingClientRect().width / card.offsetWidth;
          const why = document.querySelector('#objWhy');
          return { lines: Math.round(h.getBoundingClientRect().height / zoom / lh), width: card.offsetWidth, whyCut: why.scrollWidth > why.clientWidth + 1 };
        });
        check(shape.lines === 1 && shape.width <= 380 && !shape.whyCut, `${L}: fountain step ${said + 1}${low ? ', running low' : ''}: "${c8.title}" on one line, the card ${shape.width} wide (${JSON.stringify(shape)})`);
        if (tier === 3 && low) await shot('8-step-4-low');
      }
    }

    check(!errors.length, `${L}: no page errors ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]).catch(() => {});
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);

// #875 (epic #845): moving the house's built-in furniture, played. The house grows to the House with the real delivery
// and Bloombot goes in by the front door. Facing the bed the prompt offers Pulse to "Move the bed"; the real key picks
// it up (a hologram in Bloombot's hands), the turn key turns it, and the real key puts it down where the hologram
// shows; the bed's prompt works from its new spot. The radio is carried into the kitchen and played there. The house
// grows to the Home: the moves are kept, and a piece on the new fireplace's floor steps aside. Aimed where it would
// cut off the way, or at another piece, the hologram turns red and nothing moves; Back leaves a piece where it was;
// the fireplace is built in. The layout survives a reload. Screenshots go to
// SHOTS_DIR (default docs/review/875). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, waitForGame } from './lib/start-game.mjs';
import { grow, keyOf, press, prompt, shot as shotIn, visit, wait, walkTo } from './lib/house.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/875';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4255);
const LONG = Number(process.env.E2E_TIMEOUT) || 240_000;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const shot = (page, file) => shotIn(page, dir, file);
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const piece = (page, id) => page.evaluate((id) => {
  const f = window.solarbloom.sim.house.furniture().find((p) => p.id === id);
  return f && { x: f.x, z: f.z, w: f.w, d: f.d, rot: f.rot };
}, id);
/** Where the piece in hand would go now (the hologram), and why not, if it can't. */
const aim = (page, id) => page.evaluate((id) => {
  const g = window.solarbloom;
  const a = g.buildAim();
  if (!a.p?.tile) return undefined;
  const to = g.pieceAnchor(id, a.p.tile);
  return to && { x: to.x, z: to.z, w: to.w, d: to.d, rot: to.rot, why: g.furnitureProblem(a.p.roofId, to) ?? '' };
}, id);
/**
 * Stands Bloombot (for real) on each of `stands` ([x, z, faceX, faceZ]) in turn until the piece in hand would fit where it
 * is aimed (and `ok` likes the spot).
 */
const findSpot = async (page, id, stands, ok) => {
  for (const [x, z, fx, fz] of stands) {
    if (!(await walkTo(page, x, z, fx, fz))) continue;
    await wait(600);
    const a = await aim(page, id);
    if (a && !a.why && (!ok || ok(a))) return a;
  }
  return undefined;
};
/** Squares Bloombot can stand on in room `rid` (any room if unset), each facing a neighbour in the same room. */
const standsIn = (page, rid) => page.evaluate((rid) => {
  const h = window.solarbloom.sim.house;
  const out = [];
  for (const k of h.reach()) {
    const [x, z] = k.split(',').map(Number);
    if (rid && h.roomAt(x, z)?.id !== rid) continue;
    for (const [sx, sz] of [[0, 1], [1, 0], [-1, 0], [0, -1]])
      if ((!rid || h.roomAt(x + sx, z + sz)?.id === rid) && !h.wallBetween(x, z, x + sx, z + sz)) out.push([x, z, x + sx, z + sz]);
  }
  return out;
}, rid);
/** Picks a piece up for real: Bloombot faces it and presses Pulse. */
const pickUp = async (page, id) => {
  const v = await visit(page, id);
  await press(page, await keyOf(page, 'pulse'));
  await wait(800);
  return v.ok && (await page.evaluate(() => window.solarbloom.hud.currentTool)) === `furniture:${id}`;
};
const putDown = async (page) => {
  await press(page, await keyOf(page, 'pulse'));
  await wait(1500);
};
const same = (a, b) => !!a && !!b && a.x === b.x && a.z === b.z && a.rot === b.rot;

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(LONG);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false, noVistas: true } });
  await wait(2000);
  await page.evaluate(() => {
    const g = window.solarbloom;
    const sv = g.sim.state.salvage;
    sv.tier = Math.max(1, sv.tier);
    for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone']) sv.store[m] = 999;
    const s = g.sim;
    (s.state.clock ??= { offset: 0 }).offset += ((0.4 - s.clock.dayFraction() + 1) % 1) * 2880; // a morning
  });
  await wait(1500);

  // ── the House (level 3): the bed moved and turned with the real keys ──
  await grow(page, 3);
  check((await page.evaluate(() => window.solarbloom.sim.state.salvage.houseLayout)) === undefined, 'a new game starts with today’s layout (nothing moved)');
  const start = await piece(page, 'bed');
  await shot(page, '3-before.png');
  const bed = await visit(page, 'bed');
  const text = await prompt(page);
  check(bed.ok && /Sleep|bed is for the night/.test(text) && /Move the bed/.test(text), `facing the bed, the prompt offers to move it: "${text}"`);
  await press(page, await keyOf(page, 'pulse'));
  await wait(800);
  check((await page.evaluate(() => window.solarbloom.hud.currentTool)) === 'furniture:bed', 'the real key picks the bed up (in Bloombot’s hands)');
  check(same(await piece(page, 'bed'), start), 'it stays where it was until it is put down');
  await press(page, await keyOf(page, 'rotate'));
  await wait(400);
  const rot = await page.evaluate(() => window.solarbloom.buildRot);
  check(rot === (start.rot + 1) % 4, `the turn key turns it (a quarter turn: ${rot})`);
  // somewhere in the open middle of the main room (clear of where the Home puts its new rooms and pieces)
  const mid = (a) => a.x >= 1 && a.x + a.w <= 7 && a.z >= 5 && a.z + a.d <= 9;
  const to = await findSpot(page, 'bed', (await standsIn(page, 'main')).filter(([, , fx, fz]) => fx >= 1 && fx <= 6 && fz >= 5 && fz <= 8), mid);
  check(!!to, `a spot where it fits (${JSON.stringify(to)})`);
  const tip = await page.evaluate(() => document.getElementById('tip')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
  check(/to put it here/.test(tip + (await prompt(page))), `its hologram shows where it will go ("${tip}")`);
  await shot(page, '3-bed-in-hand.png');
  await putDown(page);
  const moved = await piece(page, 'bed');
  check(same(moved, to) && moved.w === 2 && moved.d === 1, `the real key puts it down there, turned (${JSON.stringify(moved)})`);
  check((await page.evaluate(() => window.solarbloom.hud.currentTool)) === 'pulse', 'and Bloombot’s hands are free again');
  const blocked = await page.evaluate(([b, s]) => {
    const g = window.solarbloom;
    const at = (x, z) => g.sim.grid.get('house', x, z).blocked;
    let on = true;
    for (let x = b.x; x < b.x + b.w; x++) for (let z = b.z; z < b.z + b.d; z++) on &&= at(x, z);
    let off = true;
    for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) off &&= !at(x, z) || !!g.sim.house.furnitureAt(x, z);
    return on && off;
  }, [moved, start]);
  check(blocked, 'its new squares are taken, its old ones free');
  const again = await visit(page, 'bed');
  check(again.ok && /Sleep|bed is for the night/.test(again.text), `the bed's prompt works from its new spot: "${again.text}"`);
  await shot(page, '3-bed-moved.png');

  // ── the radio carried into the kitchen, and played there ──
  check(await pickUp(page, 'radio'), 'the radio picked up');
  const radioTo = await findSpot(page, 'radio', await standsIn(page, 'kitchen'));
  check(!!radioTo, `a spot in the kitchen (${JSON.stringify(radioTo)})`);
  await putDown(page);
  const radio = await piece(page, 'radio');
  const radioRoom = await page.evaluate((r) => window.solarbloom.sim.house.roomAt(r.x, r.z)?.id, radio);
  check(same(radio, radioTo) && radioRoom === 'kitchen', `the radio stands in the kitchen (${JSON.stringify(radio)}, ${radioRoom})`);
  const tune = await visit(page, 'radio');
  check(tune.ok && /Listen to the radio/.test(tune.text), `its prompt works in the kitchen: "${tune.text}"`);
  await shot(page, '3-radio-in-kitchen.png');
  // the chest put on the floor the Home's fireplace will need (straight in the sim: the real keys are shown above)
  const chestWhy = await page.evaluate(() => window.solarbloom.sim.house.move('chest', 0, 8, 0));
  check(chestWhy === undefined, `the chest set on the floor the fireplace will need (${chestWhy ?? 'moved'})`);

  // ── the Home (level 4), grown with the real delivery: moves kept; a piece in the way steps aside ──
  await grow(page, 4);
  const bed4 = await piece(page, 'bed');
  const radio4 = await piece(page, 'radio');
  const chest4 = await piece(page, 'chest');
  check(same(bed4, moved), `the bed is still where it was put after the house grew (${JSON.stringify(bed4)})`);
  check(same(radio4, radio), `the radio is still in the kitchen (${JSON.stringify(radio4)})`);
  const aside = await page.evaluate((c) => {
    const h = window.solarbloom.sim.house;
    const fire = h.furniture().find((p) => p.id === 'fireplace');
    let clear = true;
    for (let x = c.x; x < c.x + c.w; x++) for (let z = c.z; z < c.z + c.d; z++) clear &&= h.furnitureAt(x, z)?.id === 'chest';
    return { fire: fire && [fire.x, fire.z], clear, reach: h.cutOff() === undefined };
  }, chest4);
  check(!!chest4 && !(chest4.x === 0 && chest4.z === 8) && aside.clear && aside.reach && JSON.stringify(aside.fire) === '[0,7]', `the chest, in the new fireplace's way, stepped aside (to ${JSON.stringify(chest4)}), not lost; everything still in reach`);
  const bedAgain = await visit(page, 'bed');
  check(bedAgain.ok && /Sleep|bed is for the night/.test(bedAgain.text), `the bed's prompt still works after the growth: "${bedAgain.text}"`);
  await shot(page, '4-after-growth.png');

  // ── refused: where it would cut Bloombot's way to a room or a piece ──
  check(await pickUp(page, 'chest'), 'the chest picked up');
  // every square where the chest would cut off the way, with a free square beside it to stand on facing it
  const cuts = await page.evaluate(() => {
    const g = window.solarbloom;
    const h = g.sim.house;
    const reach = h.reach();
    const R = h.room();
    const out = [];
    for (let x = 0; x < R; x++)
      for (let z = 0; z < R; z++) {
        const why = h.placeProblem('chest', x, z, g.buildRot);
        if (!/block the way/.test(why ?? '')) continue;
        for (const [sx, sz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
          const k = `${x + sx},${z + sz}`;
          if (reach.has(k) && !h.wallBetween(x, z, x + sx, z + sz) && !h.furnitureAt(x + sx, z + sz)) out.push([x + sx, z + sz, x, z]);
        }
      }
    return out;
  });
  // stand at each until the aim is on that square (a tall piece beside it can catch the aim first)
  let cut;
  let blocks;
  for (const c of cuts.slice(0, 12)) {
    if (!(await walkTo(page, ...c))) continue;
    await wait(800);
    cut = c;
    blocks = await aim(page, 'chest');
    if (blocks && blocks.x === c[2] && blocks.z === c[3]) break;
  }
  check(!!blocks && /block the way (to|into)/.test(blocks.why), `aimed where it would cut off the way, the hologram is red and says why ("${blocks?.why}" at ${JSON.stringify(cut?.slice(2))})`);
  await shot(page, '4-chest-would-block.png');
  const chestBefore = await piece(page, 'chest');
  await press(page, await keyOf(page, 'pulse'));
  await wait(600);
  check(same(await piece(page, 'chest'), chestBefore), 'the real key there moves nothing');
  // and aimed at another piece
  const side = await page.evaluate((b) => {
    const h = window.solarbloom.sim.house;
    const reach = h.reach();
    for (let x = b.x; x < b.x + b.w; x++)
      for (let z = b.z; z < b.z + b.d; z++)
        for (const [sx, sz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (reach.has(`${x + sx},${z + sz}`) && !h.wallBetween(x, z, x + sx, z + sz)) return [x + sx, z + sz, x, z];
    return null;
  }, bed4);
  if (side) await walkTo(page, ...side);
  await wait(800);
  const bad = await aim(page, 'chest');
  check(!!bad && /stands here/.test(bad.why), `aimed at the bed, the hologram is red and says why ("${bad?.why}")`);
  await shot(page, '4-chest-on-bed.png');
  await press(page, 'Escape');
  await wait(600);
  check((await page.evaluate(() => window.solarbloom.hud.currentTool)) === 'pulse' && same(await piece(page, 'chest'), chestBefore), 'Back leaves the chest where it was');

  // the door and the fireplace
  const door = await page.evaluate(() => {
    const g = window.solarbloom;
    const [dx, dz] = g.sim.house.doorInside();
    const f = g.sim.house.furniture().find((p) => p.id === 'radio');
    return g.furnitureProblem('house', { ...f, x: dx, z: dz });
  });
  check(door === 'Keep the door of the house clear', `never on the door's square ("${door}")`);
  const fire = await visit(page, 'fireplace');
  const firePrompt = await prompt(page);
  check(fire.ok && /Sit by the fire/.test(firePrompt) && !/Move/.test(firePrompt), `the fireplace is built in: no Move on its prompt ("${firePrompt}")`);

  // ── the top-down build view, inside the Home: the mouse, a drag, a decoration's press and the pad ──
  const camNow = () => page.evaluate(() => {
    const c = window.solarbloom.camera;
    return { building: c.building, indoors: c.isIndoors, pitch: c.pitch, dist: c.dist, shown: !!window.solarbloom.houseInside?.visible };
  });
  /** Where a square of the house's floor is on screen, and whether it is well inside the window (clear of the HUD). */
  const screenOf = (x, z) => page.evaluate(([x, z]) => {
    const g = window.solarbloom;
    const v = g.camera.toScreen(g.tileVec(g.sim.grid.get('house', x, z), 0.05));
    return { x: v.x, y: v.y, ok: v.x > 60 && v.x < innerWidth - 60 && v.y > 80 && v.y < innerHeight - 140 };
  }, [x, z]);
  const aimedAt = () => page.evaluate(() => { const t = window.solarbloom.buildAim().p?.tile; return t ? [t.x, t.z] : null; });
  const inHand = () => page.evaluate(() => window.solarbloom.hud.currentTool);
  const counts = () => page.evaluate(() => ({ decor: window.solarbloom.cozy.decorCount(), laid: ['footpath', 'road', 'grass'].reduce((n, k) => n + window.solarbloom.sim.paths.count(k), 0) }));
  /** Squares of room `rid` where piece `id` (as turned now) would fit whole, on screen, nearest Bloombot first. */
  const fitsIn = (id, rid) => page.evaluate(([id, rid]) => {
    const g = window.solarbloom;
    const h = g.sim.house;
    const b = g.bot.pose;
    const out = [];
    for (let x = 0; x < h.room(); x++)
      for (let z = 0; z < h.room(); z++) {
        const to = g.pieceAnchor(id, { x, z });
        if (!to || g.furnitureProblem('house', to)) continue;
        let inside = true;
        for (let i = to.x; i < to.x + to.w; i++) for (let j = to.z; j < to.z + to.d; j++) inside &&= h.roomAt(i, j)?.id === rid;
        if (!inside) continue;
        const v = g.camera.toScreen(g.tileVec(g.sim.grid.get('house', x, z), 0.05));
        if (v.x > 60 && v.x < innerWidth - 60 && v.y > 80 && v.y < innerHeight - 140) out.push({ x, z, to: { x: to.x, z: to.z, rot: to.rot }, d: Math.hypot(x + 0.5 - b.x, z + 0.5 - b.z) });
      }
    return out.sort((a, c) => a.d - c.d);
  }, [id, rid]);
  /** The real mouse over a square of the floor (it aims there once it has moved). */
  const pointAt = async (x, z) => {
    const s = await screenOf(x, z);
    await page.mouse.move(s.x - 6, s.y - 6);
    await page.mouse.move(s.x, s.y, { steps: 3 });
    await wait(700);
    return s;
  };

  /** Bloombot has finished what it was doing (putting a piece down plays a short build move, and a press waits for it). */
  const idle = () => page.waitForFunction(() => !window.solarbloom.bot.visuals.busy, null, { timeout: 60_000, polling: 100 });
  /** What the prompt shows now: the glyphs on its Turn line, and whether it is free of any dash or unbound input. */
  const promptGlyphs = () =>
    page.evaluate(() => {
      const el = document.getElementById('prompt');
      const html = el?.innerHTML ?? '';
      const text = el?.innerText ?? '';
      const turn = [...(el?.querySelectorAll('.pr-glyph') ?? [])]
        .filter((g) => /Turn/.test(g.nextElementSibling?.textContent ?? ''))
        .flatMap((g) => [...g.querySelectorAll('svg[aria-label]')].map((s) => s.getAttribute('aria-label')));
      return { ok: !!el && !text.includes('—') && !html.includes('Not bound') && !html.includes('—'), turn };
    });

  // picked up, the camera looks down into the room from the room's own view: no higher, the room still drawn
  const camBefore = await camNow();
  check(await pickUp(page, 'radio'), 'the radio picked up for the build view');
  await wait(1500);
  const camUp = await camNow();
  check(camUp.building && camUp.indoors && camUp.pitch > 65, `with a piece in hand the view looks down into the room (pitch ${camUp.pitch.toFixed(0)}°, still the indoor view)`);
  check(Math.abs(camUp.dist - camBefore.dist) < 0.6 && camUp.shown, `and keeps the room's distance, so it never lifts through the roof (${camBefore.dist.toFixed(1)} → ${camUp.dist.toFixed(1)}), the room still drawn`);
  const centre = await page.evaluate(() => window.solarbloom.pick(innerWidth / 2, innerHeight / 2)?.roofId);
  check(centre === 'house', `the middle of the screen is the room's floor, not a wall or the roof (${centre})`);
  await shot(page, '5-build-view-in-the-home.png');

  // the mouse: the radio put down in every room of the Home, each where the pointer is
  const rooms = await page.evaluate(() => window.solarbloom.sim.house.rooms().map((r) => r.id));
  for (const [i, rid] of rooms.entries()) {
    if (i > 0) check(await pickUp(page, 'radio'), `the radio picked up again (for the ${rid})`);
    const st = (await standsIn(page, rid))[0];
    if (st) await walkTo(page, ...st);
    await wait(800);
    const spots = (await fitsIn('radio', rid)).filter((s) => !(s.x === Math.floor(st?.[0]) && s.z === Math.floor(st?.[1])));
    const spot = spots[Math.min(2, spots.length - 1)];
    if (!spot) {
      check(false, `a free square on screen in the ${rid} for the radio`);
      continue;
    }
    await pointAt(spot.x, spot.z);
    const at = await aimedAt();
    const tip = await page.evaluate(() => document.getElementById('tip')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
    check(JSON.stringify(at) === JSON.stringify([spot.x, spot.z]) && /to put it here/.test(tip), `in the ${rid}, the hologram is under the mouse pointer (${JSON.stringify(at)}): "${tip}"`);
    // the prompt shows only inputs the player has: on keys Turn back has no key, so R alone, never a dash
    const pr = await promptGlyphs();
    check(pr.ok && pr.turn.length === 1 && /^R( key)?$/.test(pr.turn[0]), `in the ${rid}, the prompt's Turn line shows R alone, no dash (${JSON.stringify(pr)})`);
    await shot(page, `5-mouse-${rid}.png`);
    await idle();
  await page.mouse.down();
    await page.mouse.up();
    await wait(1200);
    const r = await piece(page, 'radio');
    const room = await page.evaluate((r) => window.solarbloom.sim.house.roomAt(r.x, r.z)?.id, r);
    check(r?.x === spot.to.x && r?.z === spot.to.z && room === rid && (await inHand()) === 'pulse', `a click puts it down there, in the ${rid} (${JSON.stringify(r)}), hands free again`);
  }
  const tuneThere = await visit(page, 'radio');
  check(tuneThere.ok && /Listen to the radio/.test(tuneThere.text), `the radio's prompt works where the mouse put it: "${tuneThere.text}"`);

  // a press held and moved across the floor puts a piece down whole where it was pressed: never a run, Fill or not
  for (const fill of [false, true]) {
    check(await pickUp(page, 'chest'), `the chest picked up (Fill ${fill ? 'on' : 'off'})`);
    if (fill) await press(page, await keyOf(page, 'fillMode'));
    await wait(400);
    check((await page.evaluate(() => window.solarbloom.fillOn)) === fill, `Fill is ${fill ? 'on' : 'off'}`);
    const st = (await standsIn(page, 'main'))[0];
    await walkTo(page, ...st);
    await wait(800);
    const spots = await fitsIn('chest', 'main');
    const from = spots[1];
    const far = spots.find((s) => Math.abs(s.x - from.x) + Math.abs(s.z - from.z) >= 3);
    const before = await counts();
    await pointAt(from.x, from.z);
    await idle();
  await page.mouse.down();
    const end = await screenOf(far.x, far.z);
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await wait(500);
    await page.mouse.up();
    await wait(1200);
    const c = await piece(page, 'chest');
    const after = await counts();
    check(c?.x === from.to.x && c?.z === from.to.z && (await inHand()) === 'pulse', `pressed at ${JSON.stringify([from.x, from.z])} and dragged to ${JSON.stringify([far.x, far.z])}, the chest goes down whole where it was pressed (${JSON.stringify(c)})`);
    check(after.decor === before.decor && after.laid === before.laid, 'and nothing else is laid along the way');
    if (fill) {
      await page.evaluate(() => window.solarbloom.selectTool('decor:pot'));
      await wait(300);
      await press(page, await keyOf(page, 'fillMode'));
      await page.evaluate(() => window.solarbloom.selectTool('pulse'));
      await wait(300);
    }
  }
  await shot(page, '5-chest-dragged.png');

  // a houseplant in hand pressed on a piece and moved: the piece comes up to move, no run of houseplants
  await page.evaluate(() => {
    const sv = window.solarbloom.sim.state.salvage;
    sv.decorMade = [...new Set([...(sv.decorMade ?? []), 'houseplant'])].sort();
    window.solarbloom.selectTool('decor:houseplant');
  });
  await wait(1200);
  const ch = await piece(page, 'chest');
  const beforePlant = await counts();
  await pointAt(ch.x, ch.z);
  const onChest = await page.evaluate(() => document.getElementById('tip')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
  check(/pick it up and move it/.test(onChest), `a houseplant in hand, pointed at the chest: "${onChest}"`);
  await idle();
  await page.mouse.down();
  const sideways = await screenOf(Math.min(ch.x + 3, 11), ch.z);
  await page.mouse.move(sideways.x, sideways.y, { steps: 8 });
  await wait(400);
  await page.mouse.up();
  await wait(1000);
  check((await inHand()) === 'furniture:chest' && (await counts()).decor === beforePlant.decor, `the press picks the chest up (${await inHand()}) and lays no houseplants`);
  await press(page, 'Escape');
  await wait(600);
  check(same(await piece(page, 'chest'), ch), 'Back leaves the chest where it was');

  // a pad: X picks the radio up, RB turns it, the right stick moves the build cursor, A puts it down
  await page.evaluate(() => {
    const pad = { id: 'virtual pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    navigator.getGamepads = () => [pad, null, null, null];
    window.__pad = pad;
  });
  /** A pad button pressed for at least two frames (the pad is read once a frame, and a slow browser draws few). */
  const button = async (i) => {
    await idle();
    const f0 = await page.evaluate((i) => { Object.assign(window.__pad.buttons[i], { pressed: true, value: 1 }); return window.solarbloom.frameNo; }, i);
    await page.waitForFunction((f0) => window.solarbloom.frameNo >= f0 + 2, f0, { timeout: 60_000, polling: 50 });
    await page.evaluate((i) => Object.assign(window.__pad.buttons[i], { pressed: false, value: 0 }), i);
    await wait(500);
  };
  const stick = (x, y) => page.evaluate(([x, y]) => { window.__pad.axes[2] = x; window.__pad.axes[3] = y; }, [x, y]);
  const cursorTo = async (x, z) => {
    for (let i = 0; i < 120; i++) {
      const at = await page.evaluate(() => { const g = window.solarbloom; const c = g.cursor ?? { x: 0, z: 0 }; return { x: g.bot.pose.x + c.x, z: g.bot.pose.z + c.z, yaw: g.camera.yaw }; });
      const dx = x + 0.5 - at.x, dz = z + 0.5 - at.z;
      if (Math.hypot(dx, dz) < 0.25) break;
      const yr = (at.yaw * Math.PI) / 180;
      const rx = dx * Math.cos(yr) - dz * Math.sin(yr), ry = -dx * Math.sin(yr) - dz * Math.cos(yr);
      const m = Math.max(1, Math.hypot(rx, ry) / 0.6);
      await stick(rx / m, -ry / m);
      await wait(60);
    }
    await stick(0, 0);
    await wait(600);
  };
  const radioWas = await piece(page, 'radio');
  await visit(page, 'radio');
  await button(2);
  check((await inHand()) === 'furniture:radio', 'on a pad, X picks the radio up');
  await button(5);
  const padRot = await page.evaluate(() => window.solarbloom.buildRot);
  check(padRot === (radioWas.rot + 1) % 4, `RB turns it (${radioWas.rot} → ${padRot})`);
  const padPrompt = await promptGlyphs();
  check(padPrompt.ok && padPrompt.turn.length === 2 && /LB|L1/.test(padPrompt.turn[0]) && /RB|R1/.test(padPrompt.turn[1]), `on a pad the prompt's Turn line shows both bumpers, no dash (${JSON.stringify(padPrompt)})`);
  const padSpot = (await fitsIn('radio', await page.evaluate(() => { const b = window.solarbloom.bot.pose; return window.solarbloom.sim.house.roomAt(Math.floor(b.x), Math.floor(b.z))?.id; }))).find((s) => s.d >= 2.5);
  check(!!padSpot, `a free square a few steps away for the pad cursor (${JSON.stringify(padSpot)})`);
  if (padSpot) {
    await cursorTo(padSpot.x, padSpot.z);
    const padAim = await aimedAt();
    check(JSON.stringify(padAim) === JSON.stringify([padSpot.x, padSpot.z]) && (await page.evaluate(() => window.solarbloom.bot.lastInput)) === 'pad', `the right stick moves the build cursor across the floor (${JSON.stringify(padAim)})`);
    await shot(page, '5-pad-cursor.png');
    await button(0);
    await wait(800);
    const padPut = await piece(page, 'radio');
    check(padPut?.x === padSpot.to.x && padPut?.z === padSpot.to.z && padPut?.rot === padRot && (await inHand()) === 'pulse', `A puts it down there, turned (${JSON.stringify(padPut)})`);
  }
  await page.evaluate(() => {
    navigator.getGamepads = () => [];
    window.solarbloom.bot.lastInput = 'keys';
  });
  await wait(600);
  await shot(page, '5-after-build-view.png');
  const layout = await Promise.all(['bed', 'radio', 'chest'].map((id) => piece(page, id)));

  // saved: a reload keeps every move
  await page.evaluate(() => window.solarbloom.saveNow?.());
  await page.goto(`http://localhost:${PORT}/?slot=1&gfx=low`);
  await waitForGame(page);
  await wait(4000);
  const after = await Promise.all(['bed', 'radio', 'chest'].map((id) => piece(page, id)));
  check(same(after[0], bed4) && after.every((p, i) => same(p, layout[i])), `after a reload the bed, the radio and the chest stand where they were (${JSON.stringify(after)})`);
  await shot(page, '4-after-reload.png');
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

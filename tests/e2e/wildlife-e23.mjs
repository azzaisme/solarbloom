// E23.2.4 (#374, #415, #416): a headless play-through of wildlife visits. The park is grown through all five diversity
// tiers (Bare, Some variety, Lively, Thriving, Rare mix), and at each one bloombot sits on a mended bench and then
// meditates at a real charger on the grid, while the animals come over. Every settled animal is measured against
// what is really drawn (tests/e2e/body-probe.js): bloombot's skinned surface in its pose, the bench's seat and
// backrest (from its model, assets/raw/models/final/bench.glb) and the charger's pad, so none sinks into bloombot,
// the bench or the pad, and the ones on bloombot touch it rather than float. Then the visitor log is opened and
// scrolled with real key presses, and again with pad buttons.
// `node tests/e2e/wildlife-e23.mjs [outDir]` after `vite build` (DIST=<dir> serves a copied build; GPU=1 uses the
// graphics card; GFX=low|medium|high picks the tier, High by default).
// Writes JPEG screenshots and prints what each shows and the measurements; fails on page errors or broken checks.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e23-2-4';
mkdirSync(out, { recursive: true });
const strip = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/^export /gm, '');
const server = await preview({ root: process.cwd(), build: { outDir: process.env.DIST ?? 'dist' }, preview: { port: 4251 + Math.floor(Math.random() * 400), strictPort: false }, logLevel: 'silent' });
const URL0 = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const checks = [];
const check = (ok, what) => {
  checks.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
const notes = [];
const shots = [];
const until = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
async function shot(page, name, what) {
  for (let i = 0; i < 4; i++) if (await until(page, () => window.solarbloom.chunks.pending === 0 && !window.solarbloom.camera.cinematic)) break;
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 84 });
  shots.push(`${name}.jpg: ${what}`);
}
/** The same view cropped close round bloombot (its middle projected to the screen), so the animals on it show. */
async function close(page, name, what) {
  const at = await page.evaluate(() => {
    const g = window.solarbloom;
    const cam = g.app.root.findComponents('camera').find((c) => c.enabled);
    const p = g.bot.visuals.model.getPosition().clone();
    p.y += 0.35;
    const s = cam.worldToScreen(p);
    return { x: s.x, y: s.y };
  });
  const w = 520;
  const h = 390;
  const clip = { x: Math.max(0, Math.min(1280 - w, at.x - w / 2)), y: Math.max(0, Math.min(800 - h, at.y - h / 2)), width: w, height: h };
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 90, clip });
  shots.push(`${name}.jpg: ${what} (close)`);
}
const PAD = { A: 0, B: 1, LB: 4, RB: 5, UP: 12, DOWN: 13 };
/** A pad button held for a few frames, then let go (the game reads the pad each frame). */
async function pad(page, b) {
  await page.evaluate((b) => Object.assign(window.__pad.buttons[b], { pressed: true, value: 1 }), b);
  await page.waitForTimeout(250);
  await page.evaluate((b) => Object.assign(window.__pad.buttons[b], { pressed: false, value: 0 }), b);
  await page.waitForTimeout(300);
}
async function key(page, code) {
  await page.keyboard.press(code);
  await page.waitForTimeout(300);
}

// ── the bench's seat and backrest, from its model (world units at the drawn scale, from the bench's middle) ──
const BENCH_SCALE = 0.58; // ChunkRenderer.PROP_MODELS.bench
const benchParts = (() => {
  const b = readFileSync('assets/raw/models/final/bench.glb');
  const n = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + n));
  const bin = b.subarray(20 + n + 8);
  const pts = [];
  for (const p of j.meshes[0].primitives) {
    const a = j.accessors[p.attributes.POSITION];
    const v = j.bufferViews[a.bufferView];
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < a.count; i++) {
      const o = off + i * (v.byteStride ?? 12);
      pts.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)].map((q) => q * BENCH_SCALE));
    }
  }
  const boxOf = (sel) => {
    const s = pts.filter(sel);
    return { min: [0, 1, 2].map((k) => Math.min(...s.map((p) => p[k]))), max: [0, 1, 2].map((k) => Math.max(...s.map((p) => p[k]))) };
  };
  const S = BENCH_SCALE;
  // the model, read by hand (its slats are long boxes, so their vertices are all at the ends): the iron ends at
  // |x| 0.67-0.73 (model units), the seat slats between them at heights 0.38-0.475, the backrest rails from 0.6 up
  // behind the seat
  const inner = 0.67 * S;
  const between = (b) => ({ min: [-inner, b.min[1], b.min[2]], max: [inner, b.max[1], b.max[2]] });
  const seat = between(boxOf((p) => p[1] >= 0.38 * S && p[1] <= 0.475 * S && p[2] >= -0.2 * S && p[2] <= 0.27 * S));
  const back = between(boxOf((p) => p[1] >= 0.6 * S && p[2] <= -0.2 * S));
  const endL = boxOf((p) => p[0] >= 0.69 * S);
  const endR = boxOf((p) => p[0] <= -0.69 * S);
  return { seat, back, endL, endR };
})();
notes.push(`bench (from bench.glb): seat top ${benchParts.seat.max[1].toFixed(3)}, seat z ${benchParts.seat.min[2].toFixed(3)}..${benchParts.seat.max[2].toFixed(3)}, backrest z ${benchParts.back.min[2].toFixed(3)}..${benchParts.back.max[2].toFixed(3)} y ${benchParts.back.min[1].toFixed(3)}..${benchParts.back.max[1].toFixed(3)}, ends at x ±${benchParts.endL.min[0].toFixed(3)}`);
const bench = { x: 10, z: 6 };

/** Grows park ground near the bench step by step (as pulses would), up to `tier`; returns the park's diversity. */
const grow = (page, tier) =>
  page.evaluate(
    ({ tier, bench }) => {
      const s = window.solarbloom.sim;
      const near = s.areas
        .tiles('park')
        .filter((t) => t.ground === 'polluted' && !t.blocked && !t.occupantId && !t.prop && t.feature !== 'water')
        .sort((a, b) => Math.hypot(a.x - bench.x, a.z - bench.z) - Math.hypot(b.x - bench.x, b.z - bench.z));
      const set = (n, bloom, plant) => {
        for (const t of near.splice(0, n)) {
          t.ground = 'restored';
          t.bloom = bloom;
          t.pollution = 0;
          if (plant) t.plant = plant;
          s.grid.touch(t);
        }
      };
      if (tier === 'variety') {
        set(6, 1);
        set(2, 2);
      } else if (tier === 'lively') {
        set(5, 2);
        set(6, 3);
      } else if (tier === 'thriving') {
        set(4, 2, 'meadow');
        set(2, 3, 'grove');
        s.state.fauna = { ...(s.state.fauna ?? {}), butterflies: 1, birds: 2 };
      } else if (tier === 'rare') {
        set(3, 3, 'rare');
        set(4, 3, 'grove');
        // and water plants: a restored pond tile, if the park has water
        const pond = s.areas.tiles('park').find((t) => t.feature === 'water' && t.ground !== 'restored');
        if (pond) {
          pond.ground = 'restored';
          pond.pollution = 0;
          s.grid.touch(pond);
        }
      }
      return s.wildlife.diversity('park');
    },
    { tier, bench },
  );

/** Every settled animal, measured against bloombot's real surface, the bench or the pad; one row per animal. */
const measure = (page, seat) =>
  page.evaluate(
    ({ seat, parts }) => {
      const g = window.solarbloom;
      const s = g.sim;
      const P = window.__probe;
      const now = s.time;
      const body = P.points(g.bot.visuals.model);
      const skin = P.tris(g.bot.visuals.model);
      const ON_BOT = ['landOn', 'head', 'shoulderL', 'shoulderR', 'lap', 'nest'];
      const rows = [];
      // the bench's seat and backrest in the world (the bench faces +z: it is not turned)
      const shift = (b, cx, cy, cz) => ({ min: [b.min[0] + cx, b.min[1] + cy, b.min[2] + cz], max: [b.max[0] + cx, b.max[1] + cy, b.max[2] + cz] });
      let solids = [];
      let surface;
      if (seat.kind === 'bench') {
        const b = s.rest.sitting.bench;
        if (b.facing) throw new Error('the measured bench must face +z');
        const gy = g.bot.seat.y;
        solids = [
          { name: 'seat', box: shift(parts.seat, b.x + 0.5, gy, b.z + 0.5) },
          { name: 'backrest', box: shift(parts.back, b.x + 0.5, gy, b.z + 0.5) },
          { name: 'left end', box: shift(parts.endL, b.x + 0.5, gy, b.z + 0.5) },
          { name: 'right end', box: shift(parts.endR, b.x + 0.5, gy, b.z + 0.5) },
        ];
        surface = { name: 'seat', top: parts.seat.max[1] + gy, box: solids[0].box };
      } else {
        const m = s.machine(s.rest.sitting.machineId);
        const gy = seat.groundY;
        const pad = { min: [m.x, gy, m.z], max: [m.x + m.size, gy + 0.1, m.z + m.size] }; // MachineVisuals.charger: the pad's top at 0.1
        solids = [{ name: 'pad', box: pad }];
        surface = { name: 'pad', top: gy + 0.1, box: pad };
      }
      // bloombot itself: nothing of it inside the seat, the backrest, the bench's ends or the pad
      const botIn = solids.map((x) => `${x.name} ${P.inside(body, x.box, 0.008)}`);
      const botClear = solids.every((x) => P.inside(body, x.box, 0.008) === 0);
      // and how low it comes over the seat or pad (its lowest point there, less the top)
      const sb = surface.box;
      const over = body.filter((p) => p[0] > sb.min[0] && p[0] < sb.max[0] && p[2] > sb.min[2] && p[2] < sb.max[2]);
      const low = over.length ? Math.min(...over.map((p) => p[1])) - surface.top : NaN;
      botIn.push(`lowest over the ${surface.name} ${low.toFixed(3)} from its top`);
      for (const a of g.visitors.root.children) {
        if (!a.enabled) continue;
        const kind = a.name.replace('visitor-', '');
        const v = s.wildlife.visits.find((x) => x.id === kind);
        if (!v || now < v.arrive + 0.3 || v.perch === 'passBy' || (v.leave !== undefined && now >= v.leave)) continue;
        const me = P.points(a);
        const box = P.box(a);
        const he = [0, 1, 2].map((k) => (box.max[k] - box.min[k]) / 2);
        const c = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2);
        // into bloombot, both ways: the animal's own points inside bloombot's surface (deeper than a hair), and
        // bloombot's inside the animal's
        const near = me.filter((p) => p[0] > box.min[0] - 1 && P.gap(body, p) < 0.3);
        const where = {};
        for (const p of near) {
          const m = P.insideMesh(skin, p);
          if (m && P.dist(skin, p) > 0.006) where[m] = (where[m] ?? 0) + 1;
        }
        const sunk = Object.values(where).reduce((s, k) => s + k, 0);
        // and bloombot's points inside the animal (its own surface, deeper than a hair)
        const mine = P.tris(a);
        const core = body.filter((p) => P.inside([p], box) && P.insideMesh(mine, p) && P.dist(mine, p) > 0.006).length;
        const into = sunk + core;
        const intoText = into ? `${sunk} of its points sunk into bloombot${sunk ? ` (${Object.entries(where).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}, ${core} of bloombot's inside it` : '';
        // the solids: the animal's own points inside the seat, the backrest or the pad
        const inSolid = solids
          .map((x) => [x.name, P.inside(me, x.box, 0.008), `its bounds x ${box.min[0].toFixed(3)}..${box.max[0].toFixed(3)} y ${box.min[1].toFixed(3)}..${box.max[1].toFixed(3)} z ${box.min[2].toFixed(3)}..${box.max[2].toFixed(3)}, the ${x.name}'s x ${x.box.min[0].toFixed(3)}..${x.box.max[0].toFixed(3)} y ${x.box.min[1].toFixed(3)}..${x.box.max[1].toFixed(3)} z ${x.box.min[2].toFixed(3)}..${x.box.max[2].toFixed(3)}`])
          .filter(([, k]) => k > 0);
        let rests = true;
        let on = '';
        if (ON_BOT.includes(v.perch)) {
          // touching: the nearest of its lowest points (the bottom fifth of it) to bloombot's surface
          const band = me.filter((p) => p[1] <= box.min[1] + he[1] * 0.4);
          let touch = Infinity;
          for (const p of band) touch = Math.min(touch, P.dist(skin, p));
          // and the other way: bloombot's corners to its faces (a flat butterfly on a round arm touches it mid-wing,
          // far from any of its own corners); only bloombot's corners under its middle height count
          const midY = (box.min[1] + box.max[1]) / 2;
          for (const q of body)
            if (q[1] <= midY && q[0] > box.min[0] - 0.02 && q[0] < box.max[0] + 0.02 && q[2] > box.min[2] - 0.02 && q[2] < box.max[2] + 0.02) touch = Math.min(touch, P.dist(mine, q));
          on = `bloombot (its underside ${touch.toFixed(3)} from its surface)`;
          rests = touch <= 0.015;
        } else {
          const over = (b) => c[0] > b.min[0] && c[0] < b.max[0] && c[2] > b.min[2] && c[2] < b.max[2];
          const floor = surface && over(surface.box) ? surface.top : g.groundY(c[0], c[2]);
          on = `${surface && over(surface.box) ? surface.name : 'ground'} (feet ${(box.min[1] - floor).toFixed(3)} above it)`;
          rests = Math.abs(box.min[1] - floor) <= 0.03;
        }
        const rst = g.visitors.rests?.get(v);
        const act = g.visitors.byVisit?.get(v);
        const why = rst ? ` [rest ${[rst.d.x, rst.d.y, rst.d.z].map((n) => n.toFixed(3)).join(',')}, turned ${rst.turn.toFixed(2)}, ${rst.found ? 'found' : 'still looking'}; its shape ${(act?.shape?.length ?? 0) / 3} points, ${(act?.faces?.tris?.length ?? 0) / 9} faces, foot ${JSON.stringify(act?.foot, (k, n) => (typeof n === 'number' ? +n.toFixed(3) : n))}; anchor ${(() => { const o = { x: 0, y: 0, z: 0, copy(p) { Object.assign(this, { x: p.x, y: p.y, z: p.z }); return this; }, add(p) { this.x += p.x; this.y += p.y; this.z += p.z; return this; } }; g.bot.visuals.visitPoint(v.perch, o); const me0 = P.box(a); return `${[o.x, o.y, o.z].map((n) => n.toFixed(3)).join(',')}, its root ${[a.getPosition().x, a.getPosition().y, a.getPosition().z].map((n) => n.toFixed(3)).join(',')}, its bounds y ${me0.min[1].toFixed(3)}..${me0.max[1].toFixed(3)}`; })()}]` : '';
        rows.push({ kind, perch: v.perch, into, intoText, why, inSolid, rests, on, ok: into === 0 && !inSolid.length && rests });
      }
      // the inside test reads faces the right way round: bloombot's middle is inside it, a point over its head is not
      const bb = P.box(g.bot.visuals.model);
      const mid = [0, 1, 2].map((k) => (bb.min[k] + bb.max[k]) / 2);
      const sane = !!P.insideMesh(skin, [mid[0], bb.min[1] + (bb.max[1] - bb.min[1]) * 0.35, mid[2]]) && !P.insideMesh(skin, [mid[0], bb.max[1] + 0.05, mid[2]]);
      return { sane, botIn, botClear, rows, plan: s.wildlife.visits.map((v) => `${v.id}@${v.perch}`) };
    },
    { seat, parts: benchParts },
  );

/** Waits until every planned visitor has arrived (the passers-by have been and gone). */
const settle = (page) =>
  until(
    page,
    () => {
      const w = window.solarbloom.sim.wildlife;
      const now = window.solarbloom.sim.time;
      return w.visits.every((v) => now >= v.arrive + 1.2 && (v.perch !== 'passBy' || now >= v.leave + 2));
    },
    undefined,
    180000,
  );

/** The camera close in front of bloombot, a little to one side. */
const frame = (page, side = 25, zoom = 7) =>
  page.evaluate(({ side, zoom }) => {
    const g = window.solarbloom;
    const facing = g.bot.seat?.facing ?? g.bot.pose.facing;
    g.camera.turnTo((facing * 180) / Math.PI + side, true);
    g.camera.jumpZoom(zoom);
  }, { side, zoom });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(`${strip('./gamepad-driver.js')}\ninstallVirtualPad();\n${strip('./body-probe.js')}\ninstallBodyProbe();`);
  await page.goto(`${URL0}?slot=1&new=1&gfx=${process.env.GFX ?? 'high'}`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  console.log('renderer', await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; }));
  check(await until(page, () => !!window.solarbloom.bot.visuals.model), "bloombot's model has loaded (the checks measure its real surface)");
  // what placing the animals costs a frame (resting them on bloombot's real surface is worked out in the game)
  await page.evaluate(() => {
    const v = window.solarbloom.visitors;
    const run = v.update.bind(v);
    window.__visitCost = [];
    let last;
    window.__visitWall = 0;
    v.update = (...args) => {
      const t0 = performance.now();
      run(...args);
      if (args[2].length) {
        window.__visitCost.push(performance.now() - t0);
        if (last !== undefined) window.__visitWall += t0 - last; // the wall time of the frames with visitors
        last = t0;
      } else last = undefined;
    };
    // and where it goes: bloombot's skinned surface, and resting each animal (the full looks counted apart)
    const parts = (window.__visitParts = { surface: [0, 0, 0], rest: [0, 0, 0], looks: 0 });
    const time = (obj, name, key) => {
      const f = obj[name].bind(obj);
      obj[name] = (...a) => {
        const t0 = performance.now();
        const out = f(...a);
        const dt = performance.now() - t0;
        parts[key][0] += dt;
        parts[key][1]++;
        parts[key][2] = Math.max(parts[key][2], dt);
        return out;
      };
    };
    time(window.solarbloom.bot.visuals, 'surface', 'surface');
    const restFor = v.restFor.bind(v);
    v.restFor = (a, visit, ...rest) => {
      const was = v.rests.get(visit)?.found;
      const t0 = performance.now();
      const out = restFor(a, visit, ...rest);
      const dt = performance.now() - t0;
      parts.rest[0] += dt;
      parts.rest[1]++;
      parts.rest[2] = Math.max(parts.rest[2], dt);
      if (!was && v.rests.get(visit)?.found) parts.looks++;
      return out;
    };
  });

  // the mended bench, and a real charger on the grid in the park (powered by two panels), both in the same area
  const charger = await page.evaluate((b) => {
    const g = window.solarbloom;
    const s = g.sim;
    s.inventory.add('scrap', 3);
    s.rest.mend(s.rest.benchAt(b.x, b.z));
    s.power.skyOverride = () => ({ sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 }); // clear noon for the panels
    const at = (x, z) => s.grid.get('g', x, z);
    const free = (x, z, lvl) => {
      const t = at(x, z);
      return !!t && !t.blocked && !t.occupantId && !t.prop && !t.ramp && t.feature !== 'water' && (t.level ?? 0) === lvl;
    };
    const spot = s.areas
      .tiles('park')
      .filter((t) => Math.hypot(t.x - b.x, t.z - b.z) > 3 && [[0, 0], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1], [0, 2], [-1, 2], [1, 2], [0, -1]].every(([dx, dz]) => free(t.x + dx, t.z + dz, t.level ?? 0)))
      .sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0];
    const check = s.build.check.bind(s.build);
    const pay = s.inventory.pay.bind(s.inventory);
    s.build.check = () => ({ ok: true, cost: {}, spotOk: true });
    s.inventory.pay = () => true;
    // placed for real (placement checks and recipes bypassed: this is a look test, the rules have unit tests); the
    // machines' own tiles only, so the park stays bare until it is grown
    const put = (type, x, z) => s.build.place(type, 'g', x, z);
    put('solar', spot.x - 1, spot.z);
    put('solar', spot.x + 1, spot.z);
    const m = put('charger', spot.x, spot.z);
    s.build.check = check;
    s.inventory.pay = pay;
    return { x: spot.x, z: spot.z, id: m?.id, area: s.areas.areaOf(spot) };
  }, bench);
  check(!!charger.id && charger.area === 'park', `a real charger built in the park (${charger.x}, ${charger.z}), powered by two panels`);

  const sitBench = async (how) => {
    await page.evaluate((b) => {
      const g = window.solarbloom;
      g.bot.following = true;
      g.bot.teleport('g', b.x, b.z + 1);
      Object.assign(g.bot.pose, { x: b.x + 0.5, z: b.z + 1.6, facing: Math.PI });
    }, bench);
    await page.waitForTimeout(700);
    if (how === 'pad') await pad(page, PAD.A);
    else await key(page, 'KeyE');
    return until(page, () => window.solarbloom.sim.rest.sitting?.kind === 'bench');
  };
  const sitCharger = async (how) => {
    await page.evaluate((c) => {
      const g = window.solarbloom;
      g.bot.following = true;
      g.bot.teleport('g', c.x, c.z + 1);
      Object.assign(g.bot.pose, { x: c.x + 0.5, z: c.z + 1.6, facing: Math.PI });
    }, charger);
    await page.waitForTimeout(700);
    if (how === 'pad') await pad(page, PAD.A);
    else await key(page, 'KeyE');
    return until(page, () => window.solarbloom.sim.rest.sitting?.kind === 'charger');
  };
  const stand = async (how) => {
    if (how === 'pad') await pad(page, PAD.B);
    else await key(page, 'KeyE');
    const up = await until(page, () => !window.solarbloom.sim.rest.sitting);
    const gone = await until(page, () => window.solarbloom.sim.wildlife.visits.length === 0, undefined, 30000);
    return up && gone;
  };

  const TIERS = [
    ['bare', 'Bare'],
    ['variety', 'Some variety'],
    ['lively', 'Lively'],
    ['thriving', 'Thriving'],
    ['rare', 'Rare mix'],
  ];
  const counts = {};
  let n = 30;
  for (const [tier, name] of TIERS) {
    const d = await grow(page, tier);
    check(d.tier === tier, `the park grown to ${name} (score ${d.score}; ${d.kinds.join(', ') || 'nothing growing'})`);
    for (const [where, how] of [['bench', tier === 'lively' || tier === 'rare' ? 'pad' : 'key'], ['charger', tier === 'variety' || tier === 'thriving' ? 'pad' : 'key']]) {
      const sat = where === 'bench' ? await sitBench(how) : await sitCharger(how);
      check(sat, `${name}: ${how === 'pad' ? 'pad A' : 'E'} ${where === 'bench' ? 'sits on the bench' : 'meditates at the charger'}`);
      const ok = await settle(page);
      const plan = await page.evaluate(() => window.solarbloom.sim.wildlife.visits.map((v) => `${v.id}@${v.perch}`));
      counts[`${tier}/${where}`] = plan.length;
      check(ok, `${name} at the ${where}: ${plan.length ? plan.join(', ') : 'nobody came'}`);
      if (tier === 'bare') check(plan.every((p) => p.endsWith('@passBy')), `${name}: at most a butterfly passing by`);
      const groundY = await page.evaluate((c) => window.solarbloom.groundY(c.x + 0.5, c.z + 0.5), charger);
      const m = await measure(page, { kind: where, groundY });
      check(m.sane, `${name} at the ${where}: the inside test reads bloombot's faces the right way (its middle inside, over its head outside)`);
      check(m.botClear, `${name} at the ${where}: bloombot clear of the ${where === 'bench' ? 'seat and backrest' : 'pad'} (its points inside: ${m.botIn.join(', ')})`);
      for (const r of m.rows)
        check(r.ok, `${name} at the ${where}: ${r.kind}@${r.perch} sits on ${r.on}${r.into ? `, ${r.intoText}` : ''}${r.inSolid.length ? `, inside the ${r.inSolid.map(([k, c, b]) => `${k} (${c}; ${b})`).join(', ')}` : ''}${r.ok ? '' : r.why}`);
      if (tier !== 'bare') {
        await frame(page, where === 'bench' ? 25 : 30, 7);
        await shot(page, `${n}-${tier}-${where}`, `${name} at the ${where}: ${plan.join(', ')}`);
        await close(page, `${n}c-${tier}-${where}`, `${name} at the ${where}: ${plan.join(', ')}`);
        n++;
      }
      if (process.env.PROFILE && tier === 'thriving' && where === 'bench') {
        // PROFILE=1: where a while of sitting with the animals spends its time (the top functions by their own time)
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        await cdp.send('Profiler.start');
        await page.waitForTimeout(15000);
        const { profile } = await cdp.send('Profiler.stop');
        const self = new Map();
        const dt = (profile.endTime - profile.startTime) / profile.samples.length / 1000;
        const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        for (const id of profile.samples) {
          const f = byId.get(id).callFrame;
          const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
          self.set(key, (self.get(key) ?? 0) + dt);
        }
        console.log('profile (15 s sitting with the animals, ms of own time):');
        for (const [k, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${ms.toFixed(0).padStart(6)}  ${k}`);
      }
      check(await stand(how), `${name}: ${how === 'pad' ? 'pad B' : 'E'} stands bloombot up and the animals leave`);
    }
  }
  const cost = await page.evaluate(() => {
    const c = window.__visitCost.slice().sort((a, b) => a - b);
    const p = window.__visitParts;
    const part = ([t, n, m]) => `${n} calls, ${(t / Math.max(1, n)).toFixed(2)} ms each, ${m.toFixed(1)} ms at worst`;
    const share = c.reduce((s, x) => s + x, 0) / window.__visitWall;
    return { share, frames: c.length, mean: c.reduce((s, x) => s + x, 0) / c.length, p99: c[Math.floor(c.length * 0.99)], max: c[c.length - 1], parts: `skinning bloombot: ${part(p.surface)}; resting the animals: ${part(p.rest)}, ${p.looks} full looks` };
  });
  // (its share of the time, as the machine may be busy with other things: the milliseconds grow with it)
  check(cost.share < 0.05, `placing the animals is cheap: ${(cost.share * 100).toFixed(1)}% of the time while they visit; ${cost.mean.toFixed(2)} ms a frame on average, ${cost.p99.toFixed(1)} ms at the 99th percentile, ${cost.max.toFixed(1)} ms at worst (${cost.frames} frames with visitors; ${cost.parts})`);
  check(counts['lively/bench'] > counts['variety/bench'] && counts['thriving/bench'] > counts['lively/bench'] && counts['rare/bench'] >= counts['thriving/bench'], `more come the more diverse the park (bench: ${TIERS.map(([t]) => counts[`${t}/bench`]).join(' → ')})`);

  // ── zooming in while sitting ──
  await sitBench('key');
  check(await page.evaluate(() => window.solarbloom.camera.maxZoom >= 7), 'sitting lets the camera zoom in close (REST.visitZoom)');
  await stand('key');
  check(await until(page, () => window.solarbloom.camera.maxZoom < 5, undefined, 5000), 'standing puts the usual zoom limit back');

  // ── the visitor log, with real keys and then with pad buttons ──
  const logged = await page.evaluate(() => Object.keys(window.solarbloom.sim.state.wildlife?.log ?? {}));
  check(logged.length >= 8, `the visitor log took them in: ${logged.join(', ')}`);
  const tabIs = (page) => page.evaluate(() => document.querySelector('#bpBody')?.getAttribute('aria-labelledby'));
  /** The Visitors group has the focus and is fully in view in the backpack's scrolling body. */
  const visitorsShown = (page) =>
    page.evaluate(() => {
      const f = document.activeElement;
      const title = f?.querySelector?.('h3')?.textContent ?? '';
      const body = document.querySelector('#bpBody');
      const r = f.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      return { focused: /^Visitors\b/.test(title), title, inView: r.top >= b.top - 1 && r.bottom <= b.bottom + 1, text: f.innerText };
    });
  const toVisitors = async (page, step) => {
    for (let i = 0; i < 12; i++) {
      const v = await visitorsShown(page);
      if (v.focused) return v;
      await step();
    }
    return visitorsShown(page);
  };
  // keyboard: I opens it, E moves along the tabs to Collection, the arrows move down the groups to Visitors
  await key(page, 'KeyI');
  check(await until(page, () => window.solarbloom.hud.backpackOpen, undefined, 5000), 'I opens the backpack');
  for (let i = 0; i < 6 && (await tabIs(page)) !== 'bptab-collection'; i++) await key(page, 'KeyE');
  check((await tabIs(page)) === 'bptab-collection', 'E moves along the tabs to Collection');
  const kb = await toVisitors(page, () => key(page, 'ArrowDown'));
  check(kb.focused && kb.inView && /Sat with you/.test(kb.text), `the arrow keys move down to the Visitors group, scrolled into view (focus: ${kb.title})`);
  await shot(page, '40-visitor-log-keyboard', 'the visitor log, reached with the keyboard (I, E to Collection, arrows down to Visitors)');
  await key(page, 'Escape');
  check(await until(page, () => !window.solarbloom.hud.backpackOpen, undefined, 5000), 'Esc closes it');
  // pad: d-pad up opens it, RB moves along the tabs, d-pad down moves down the groups, B closes it
  await pad(page, PAD.UP);
  check(await until(page, () => window.solarbloom.hud.backpackOpen, undefined, 5000), 'd-pad up opens the backpack');
  for (let i = 0; i < 6 && (await tabIs(page)) !== 'bptab-collection'; i++) await pad(page, PAD.RB);
  check((await tabIs(page)) === 'bptab-collection', 'RB moves along the tabs to Collection');
  const gp = await toVisitors(page, () => pad(page, PAD.DOWN));
  check(gp.focused && gp.inView && /Sat with you/.test(gp.text), `the d-pad moves down to the Visitors group, scrolled into view (focus: ${gp.title})`);
  await shot(page, '41-visitor-log-pad', 'the visitor log, reached with the pad (d-pad up, RB to Collection, d-pad down to Visitors)');
  await pad(page, PAD.B);
  check(await until(page, () => !window.solarbloom.hud.backpackOpen, undefined, 5000), 'B closes it');
  await page.close();
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(notes.join('\n'));
console.log(checks.join('\n'));
console.log(shots.map((s) => `  ${s}`).join('\n'));
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}

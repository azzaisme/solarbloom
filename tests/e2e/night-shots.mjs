// E23.7.5: headless review shots of the moonlit night, in docs/review/night/ (or argv[2]).
// `npm run build` first (or this runs on whatever dist/ holds), then `node tests/e2e/night-shots.mjs [outDir]`.
// A new old-city game with a small powered farm and night lights on Saltwind Beach, shot at noon, dusk, midnight and
// dawn, in clear weather and in rain, at desktop size and at Steam Deck size (1280 × 800, ?gfx=deck), plus the Power
// view at midnight. It logs the picture's mean colour for each shot: night must be blue and must not be dark.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/night';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4237, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
const QUICK = !!process.env.QUICK; // one size, midnight only: for tuning
const SIZES = [
  // desktop on the high tier: headless auto-detects the low one, which has no bloom
  { name: 'desktop', width: 1920, height: 1080, query: '&gfx=high' },
  { name: 'deck', width: 1280, height: 800, query: '&gfx=deck' },
];
const TIMES = { dusk: 0.662, midnight: 0.83, dawn: 0.996 };
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
try {
  for (const size of QUICK ? SIZES.slice(0, 1) : SIZES) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.setDefaultTimeout(300_000);
    await page.goto(`http://localhost:4237/?slot=1${size.query}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom && !!window.solarbloom.sim);
    await page.waitForTimeout(4000);
    await page.addStyleTag({ content: '#hint, #intro, .toast, #toasts { display: none !important; }' });
    // The game's own camera: bloombot stands at (x, z) and the camera follows it at the game's zoom, as a player
    // sees it (only the yaw is turned, as a player can).
    const shot = async (name, x, z, yaw = 0, wait = 5000) => {
      await page.evaluate(({ x, z, yaw }) => {
        const g = window.solarbloom;
        g.bot.teleport('g', x, z);
        g.bot.following = true;
        g.camera.turnTo(yaw);
        for (let i = 0; i < 300; i++) g.camera.update(0.05);
      }, { x, z, yaw });
      await page.waitForTimeout(wait);
      const file = `${dir}/${name}-${size.name}.png`;
      const png = await page.screenshot({ path: file });
      // the picture's mean colour (0–255), from a small copy of the screenshot
      const mean = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 40;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, 64, 40);
        const d = x.getImageData(0, 0, 64, 40).data;
        const m = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k] += d[i + k];
        return m.map((v) => Math.round(v / (d.length / 4)));
      }, png.toString('base64'));
      console.log(`  ✓ ${file}  mean rgb ${mean.join(',')}`);
      return mean;
    };
    // A small powered farm and night lights (placement checks and recipes bypassed: this is a look test).
    await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      s.state.salvage.tier = 3;
      const check = s.build.check.bind(s.build);
      const pay = s.inventory.pay.bind(s.inventory);
      s.build.check = () => ({ ok: true, cost: {}, spotOk: true });
      s.inventory.pay = () => true;
      const put = (type, x, z, size = 1) => {
        for (let dz = 0; dz < size; dz++)
          for (let dx = 0; dx < size; dx++) {
            const t = s.grid.get('g', x + dx, z + dz);
            t.ground = 'restored';
            t.blocked = false;
            t.bloom = 1;
            t.pollution = 0;
            s.grid.touch(t);
          }
        return s.build.place(type, 'g', x, z) ?? {};
      };
      put('solar', 7, 43);
      put('solar', 8, 43);
      put('battery', 6, 43).charge = 4200;
      put('relay', 5, 40);
      put('relay', 12, 40);
      put('windTurbine', 10, 43);
      put('charger', 8, 41);
      put('droneHub', 13, 42, 2);
      s.build.check = check;
      s.inventory.pay = pay;
      const cz = (s.state.cozy ??= {});
      cz.decorUnlocked = [...(cz.decorUnlocked ?? []), 'lamppost', 'uplight', 'porchlight', 'tablelight', 'fairylights', 'paperlanterns', 'glasslanterns'];
      // E23.6.1 (#489): a light opens once it has been made at the crafting table
      s.state.salvage.decorMade = [...new Set([...(s.state.salvage.decorMade ?? []), ...cz.decorUnlocked, 'festoon', 'pathlight', 'lantern', 'solarstake', 'glowpod', 'solarlamppost'])].sort();
      g.cozy.checkDecorUnlocks();
      const kinds = ['lamppost', 'pathlight', 'lantern', 'solarstake', 'glowpod', 'uplight', 'tablelight', 'porchlight'];
      let n = 0;
      for (let z = 36; z <= 47 && n < 24; z++)
        for (let x = 0; x <= 15 && n < 24; x++) {
          const t = s.grid.get('g', x, z);
          if (!t || t.occupantId || t.feature === 'water' || (x + z) % 3) continue;
          const was = { g: t.ground, b: t.blocked };
          t.ground = 'restored';
          t.bloom = 1;
          t.pollution = 0;
          t.blocked = false;
          const k = kinds[n % kinds.length];
          if (g.cozy.canDecorate(k, 'g', x, z)) {
            Object.assign(t, { ground: was.g, blocked: was.b });
            continue;
          }
          s.grid.touch(t);
          g.cozy.placeDecor(k, n % 4, 'g', x, z);
          g.chunks.markTile(t);
          n++;
        }
      const relays = s.state.machines.filter((m) => m.type === 'relay');
      s.lights.hang('festoon', 'g', relays[0].x, relays[0].z);
      for (const l of s.lights.all()) if (l.def.power === 'solar') s.lights.nodeOf(l.key).charge = 300;
    });
    const at = (f, weather) =>
      page.evaluate(({ f, weather }) => {
        const s = window.solarbloom.sim;
        s.weather.forceForTest(weather, 1e9);
        (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
        // the lamps fade in over a few game seconds, which headless frames take minutes to play: skip the fade
        // (power-lights.test covers it) and set them straight to how dark it is now
        s.lights.dark = s.power.sky().dark;
      }, { f, weather });
    await at(0.3, 'sunny');
    const noon = await shot('noon-clear', 7, 42, 20, 8000);
    for (const weather of QUICK ? ['sunny'] : ['sunny', 'rain']) {
      const w = weather === 'sunny' ? 'clear' : 'rain';
      for (const [name, f] of Object.entries(TIMES).filter(([n]) => !QUICK || n === 'midnight')) {
        await at(f, weather);
        const mean = await shot(`${name}-${w}`, 7, 42, 20, 8000);
        if (name !== 'midnight') continue;
        const share = lum(mean) / lum(noon);
        console.log(`    midnight is ${(share * 100).toFixed(0)}% as bright as noon; blue − red = ${mean[2] - mean[0]}`);
        // moonlit, not dimmed: blue leads, and the picture keeps a good share of the day's brightness
        if (mean[2] <= mean[0] || share < 0.3) {
          failed = true;
          console.error(`    ✗ ${name}-${w}: not a readable blue night`);
        }
      }
    }
    await at(TIMES.midnight, 'sunny');
    await shot('midnight-lamps', 4, 39, 200, 6000);
    // the Power view on the moonlit night: the grid must still stand out
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.selectTool('battery');
      if (!g.powerOverlay.visible) g.togglePowerView();
    });
    await shot('midnight-power-view', 8, 43, 20, 6000);
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.togglePowerView();
      g.selectTool('pulse');
    });
    if (errors.length) {
      failed = true;
      console.error('page errors:\n' + [...new Set(errors)].slice(0, 5).join('\n'));
    }
    await page.close();
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);

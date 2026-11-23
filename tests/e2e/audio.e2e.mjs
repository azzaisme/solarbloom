// Phase 8 (A04, A09): the sound of restoration, in the real game. A new garden in headless Chromium:
//  1. dead ground: only the thin wind (no leaves, meadow, insects, birds), no music before the first restoration;
//  2. restore everything around bloombot: within seconds the local soundscape rises (leaves, meadow, birds) and the
//     music begins after its opening rest; the wind steps back;
//  3. walk back into the wasteland: life fades behind, the wind returns, nothing cuts off abruptly;
//  4. a 50-bloom chain and a landmark together: capped voices, no clipping (peak after the limiter);
//  5. hidden page → silent master; back → fades in.
// The final output (after the limiter) is recorded to docs/audio/captures/dead-to-living.webm, and the sound-state
// log to docs/audio/captures/dead-to-living.json. Run after `vite build` (npm run test:audio).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = 'docs/audio/captures';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4241);
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/?slot=1&new=1&audiodebug&gfx=low`);
  await page.waitForFunction(() => window.solarbloom?.bot && window.solarbloom.loadSteps?.().models === 1, null, { timeout: 240000, polling: 500 });
  await wait(1500);
  check(await page.evaluate(() => window.__audio().state === 'locked'), 'no sound before the first gesture (autoplay rules)');
  await page.mouse.click(640, 400);
  await page.waitForFunction(() => window.__audio().state === 'running', null, { polling: 500 });

  // start recording the final output
  await page.evaluate(() => {
    const s = window.solarbloom.sfx.director.captureStream();
    const rec = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 96000 });
    window.__chunks = [];
    rec.ondataavailable = (e) => window.__chunks.push(e.data);
    rec.start(1000);
    window.__rec = rec;
    window.__log = [];
    window.__logT = setInterval(() => {
      const d = window.__audio();
      window.__log.push({ t: +(performance.now() / 1000).toFixed(1), stage: d.stage, life: +d.area.life.toFixed(3), beds: Object.fromEntries(Object.entries(d.beds).map(([k, v]) => [k, +v.toFixed(3)])), music: d.music, rms: +d.out.rms.toFixed(1), peak: +d.out.peak.toFixed(1), voices: d.voices, wildlife: d.wildlife[0] });
    }, 500);
  });

  /** Average output RMS (dB) and the snapshot, over `ms`. */
  const listen = async (ms) => {
    const n = Math.max(1, Math.round(ms / 250));
    let sum = 0;
    let peak = -120;
    for (let i = 0; i < n; i++) {
      await wait(250);
      const o = await page.evaluate(() => window.__audio().out);
      sum += Math.pow(10, o.rms / 10);
      peak = Math.max(peak, o.peak);
    }
    const snap = await page.evaluate(() => window.__audio());
    return { rms: 10 * Math.log10(sum / n), peak, snap };
  };

  // 1. dead ground
  const dead = await listen(9000);
  console.log('   dead:', dead.snap.stage, dead.snap.beds, `${dead.rms.toFixed(1)} dB`, dead.snap.music);
  check(dead.snap.stage === 'barren' || dead.snap.area.life < 0.12, `the start is barren (life ${dead.snap.area.life.toFixed(2)})`);
  check(dead.snap.beds.wind > 0.05, 'a thin wind is there');
  check(dead.snap.beds.leaves + dead.snap.beds.meadow + dead.snap.beds.night < 0.02, 'no garden sounds over dead ground');
  check(!/\(/.test(dead.snap.music) || !dead.snap.restoredOnce, `no music before anything is restored (${dead.snap.music})`);

  // 2. restore everything within 12 tiles of bloombot, fully grown
  const restored = await page.evaluate(() => {
    const g = window.solarbloom;
    const p = g.bot.pose;
    let n = 0;
    for (let dz = -13; dz <= 13; dz++)
      for (let dx = -13; dx <= 13; dx++) {
        const t = g.sim.grid.get(p.roofId, Math.floor(p.x) + dx, Math.floor(p.z) + dz);
        if (!t || t.blocked || t.occupantId) continue;
        if (t.ground !== 'restored') g.sim.restoration.complete(t, 'drone', undefined, true);
        t.bloom = 3;
        n++;
      }
    g.sfx.at(g.bot.pose && { x: p.x, y: 0, z: p.z }, (q) => q.restored(0));
    return n;
  });
  console.log(`   restored ${restored} tiles round bloombot`);
  await wait(4000);
  const early = await page.evaluate(() => window.__audio());
  check(early.area.life < 0.85, `life returns gradually, not in a jump (after 4 s: ${early.area.life.toFixed(2)})`);
  const alive = await listen(14000);
  console.log('   alive:', alive.snap.stage, alive.snap.beds, `${alive.rms.toFixed(1)} dB`, alive.snap.music, alive.snap.wildlife);
  check(alive.snap.area.life > 0.6, `the restored patch sounds alive (life ${alive.snap.area.life.toFixed(2)}, ${alive.snap.stage})`);
  check(alive.snap.beds.leaves > 0.08, 'leaves move in the restored ground');
  check(alive.snap.beds.wind < dead.snap.beds.wind * 0.7, 'the dry wind stepped back');
  check(alive.rms > dead.rms + 3, `living ground is audibly fuller than dead ground (${dead.rms.toFixed(1)} → ${alive.rms.toFixed(1)} dB)`);
  check(/Nocturne/.test(alive.snap.music), `the score has begun after its opening rest (${alive.snap.music})`);
  check(alive.rms < -14, `…but never a loud wall of sound (${alive.rms.toFixed(1)} dB RMS)`);

  // 3. back into the wasteland: teleport 60 tiles away to dead ground
  const away = await page.evaluate(() => {
    const g = window.solarbloom;
    const p = g.bot.pose;
    for (const [dx, dz] of [[60, 0], [-60, 0], [0, 60], [0, -60], [45, 45], [-45, -45]]) {
      const x = p.x + dx;
      const z = p.z + dz;
      const t = g.sim.grid.get(p.roofId, Math.floor(x), Math.floor(z));
      if (t && !t.blocked && t.ground === 'polluted' && t.feature !== 'water') {
        g.bot.teleport(p.roofId, x, z);
        return true;
      }
    }
    return false;
  });
  if (away) {
    await wait(2000);
    const mid = await page.evaluate(() => window.__audio());
    check(mid.area.life > 0.2, `leaving, life fades behind rather than cutting off (2 s later: ${mid.area.life.toFixed(2)})`);
    const back = await listen(12000);
    console.log('   wasteland again:', back.snap.stage, back.snap.beds, back.snap.music);
    check(back.snap.area.life < 0.15, `the wasteland is sparse again (life ${back.snap.area.life.toFixed(2)})`);
    check(back.snap.beds.wind > alive.snap.beds.wind, 'the wind returns');
  } else check(false, 'found dead ground to walk back into');

  // 4. a 50-bloom chain over a landmark cue: capped, unclipped
  const stress = await page.evaluate(async () => {
    const s = window.solarbloom.sfx;
    s.landmark();
    let maxVoices = 0;
    let peak = -120;
    for (let i = 1; i <= 50; i++) {
      s.bloom(i);
      if (i % 3 === 0) s.coin();
      s.drone('restorer');
      await new Promise((r) => setTimeout(r, 40));
      const d = window.__audio();
      maxVoices = Math.max(maxVoices, d.voices);
      peak = Math.max(peak, d.out.peak);
    }
    s.chainEnd(50);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      peak = Math.max(peak, window.__audio().out.peak);
    }
    return { maxVoices, peak };
  });
  console.log('   stress:', stress);
  check(stress.maxVoices <= 24, `a 50-bloom chain stays within the voice pool (${stress.maxVoices})`);
  check(stress.peak < -0.3, `no clipping: peak ${stress.peak.toFixed(1)} dBFS after the limiter`);

  // 5. hidden page → quiet master
  await page.evaluate(() => window.solarbloom.pause.set('hidden'));
  await page.evaluate(() => window.solarbloom.pause.onReasons?.());
  await wait(1500);
  const hidden = await page.evaluate(() => window.__audio());
  check(hidden.out.rms < -70, `a hidden page goes quiet (${hidden.out.rms.toFixed(0)} dB)`);
  await page.evaluate(() => {
    window.solarbloom.pause.clear('hidden');
    window.solarbloom.pause.onReasons?.();
  });
  await wait(3000);

  const { b64, log } = await page.evaluate(async () => {
    clearInterval(window.__logT);
    await new Promise((r) => {
      window.__rec.onstop = r;
      window.__rec.stop();
    });
    const blob = new Blob(window.__chunks, { type: 'audio/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), log: window.__log };
  });
  writeFileSync(`${dir}/dead-to-living.webm`, Buffer.from(b64, 'base64'));
  writeFileSync(`${dir}/dead-to-living.json`, JSON.stringify(log, null, 0).replace(/\},\{/g, '},\n{'));
  console.log(`   capture: ${dir}/dead-to-living.webm (${(b64.length * 0.75 / 1024).toFixed(0)} KB), ${log.length} log rows`);
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

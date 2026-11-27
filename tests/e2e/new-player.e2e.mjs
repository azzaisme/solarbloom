// E24.1 (#611): a first-time player, played by a script that only follows what is on screen.
//
// It starts a fresh game from the title, as a new player does, and plays with the keyboard. Each moment it reads
// what the game shows (the goal card, the prompt in front of bloombot, the toasts) and picks its next step from
// those words alone:
//   - "Bring 6 Scrap and 2 Seeds to the fountain": salvage piles of what is missing, then take it all to the fountain;
//   - "Salvage …" on the prompt: hold Interact;
//   - a count on the card ("Restore the park … 12 of 60" and the like): pulse dead ground near the fountain;
//   - "Pry" or "barricade" on the card, the prompt or a toast it read: hold Interact at a barricade.
// Where to go comes from what a player can see: a thing on screen, or close by. With nothing in sight it looks
// round (turns the camera), then strolls. Walking is the game's own path to a spot, as a click on it would be.
//
// It times three moments, from the moment the world is on screen: the first salvage, the fountain waking (tier 1)
// and the first barricade pried. It fails when the player ever has no next step on screen for more than a few
// seconds (no goal on the card, no prompt), when it reads words it can't act on for too long, or when a moment
// isn't reached within the time limit. It writes $SHOTS_DIR/new-player.json (the times, every step it took and
// why) and a screenshot at each moment.
//
//   node tests/e2e/new-player.e2e.mjs        after `vite build`; GPU=1 runs on the real GPU (d3d11), else SwiftShader
//   LIMIT=1800 (seconds of play before it gives up), PORT, SHOTS_DIR (default docs/review/e24-new-player)
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { preview } from "vite";
import { startGameFromTitle } from "./lib/start-game.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dir = process.env.SHOTS_DIR ?? "docs/review/e24-new-player";
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4252);
const LIMIT = Number(process.env.LIMIT ?? 1800);
/** how long the screen may show no next step before it counts as a dead end (s) */
const GAP = 4;
/** how long it may read words it can't act on before it gives up (s) */
const LOST = Number(process.env.LOST ?? 180);
/** CARD_ONLY=1: a player who misses every toast (they come and go): the goal card and the prompt must carry it alone */
const CARD_ONLY = !!process.env.CARD_ONLY;
const server = process.env.BASE_URL
  ? undefined
  : await preview({ preview: { port, strictPort: true }, logLevel: "silent" });
const base = process.env.BASE_URL ?? `http://localhost:${port}`;
const browser = await chromium.launch({
  args: process.env.GPU
    ? [
        "--use-gl=angle",
        "--use-angle=d3d11",
        "--enable-gpu",
        "--ignore-gpu-blocklist",
      ]
    : [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
});
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(240_000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
// every toast as it appears (a player reads them as they come)
await page.addInitScript(() => {
  window.__toasts = [];
  new MutationObserver((ms) => {
    for (const m of ms)
      for (const n of m.addedNodes)
        if (n.nodeType === 1 && n.parentElement?.id === "toasts")
          window.__toasts.push({
            at: performance.now(),
            text: n.innerText
              .split(/\n/)
              .map((l) => l.trim())
              .filter(Boolean)
              .join(" / "),
          });
  }).observe(document, { childList: true, subtree: true });
});

/** What the screen says right now: the goal card, the prompt, and toasts since `since` (page ms). */
const read = (since) =>
  page.evaluate((since) => {
    const vis = (e) =>
      !!e &&
      !e.hidden &&
      getComputedStyle(e).display !== "none" &&
      getComputedStyle(e).visibility !== "hidden" &&
      e.getBoundingClientRect().width > 0;
    const obj = document.querySelector("#obj");
    const txt = (sel) => {
      const e = obj?.querySelector(sel);
      return vis(e) ? (e.textContent ?? "").trim() : "";
    };
    const card = vis(obj)
      ? [txt("#objTitle"), txt("#objNext")].filter(Boolean).join(" · ")
      : "";
    // #605: every part of the goal as a chip ("Scrap 4 of 20", "Park 12 of 60")
    const parts = vis(obj?.querySelector("#objParts"))
      ? [...obj.querySelectorAll("#objParts li")].map((l) => {
          // the chip: its icon, its name (the bare text), and "a of b" in bold
          const label = [...l.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
          const m = /(\d+) of (\d+)/.exec(l.querySelector("b")?.textContent ?? "");
          return m ? { label, have: +m[1], need: +m[2] } : undefined;
        }).filter(Boolean)
      : [];
    const hand = parts.find((p) => /^(Park|Landmarks awake)$/.test(p.label));
    const count =
      hand && hand.have < hand.need ? `${hand.have} of ${hand.need}` : "";
    const pr = document.querySelector("#prompt");
    const prompt = vis(pr)
      ? [...pr.querySelectorAll("*")]
          .filter((e) => !e.children.length)
          .map((e) => e.textContent.trim())
          .filter(Boolean)
          .join(" ")
      : "";
    const toasts = window.__toasts
      .filter((t) => t.at > since)
      .map((t) => t.text);
    const g = window.solarbloom;
    return {
      card,
      parts,
      count,
      prompt,
      toasts,
      now: performance.now(),
      sim: g.sim.time,
      pack: { ...g.sim.state.salvage.pack },
    };
  }, since);

/** The moments, read from the game (what happened, not what the script did). */
const moments = () =>
  page.evaluate(() => {
    const sv = window.solarbloom.sim.state.salvage;
    return {
      salvaged: Object.keys(sv.piles).length > 0,
      woke: sv.tier >= 1,
      pried: sv.opened.length > 0 ? sv.opened.slice() : [],
    };
  });

/**
 * Things a player can see from where bloombot stands: on screen (in the picture, not too far) or close by.
 * kind: 'pile' (with its material), 'fountain', 'hedge', 'dead' (dead ground to pulse).
 */
const sights = (kind, what) =>
  page.evaluate(
    ([kind, what]) => {
      const g = window.solarbloom,
        s = g.sim,
        b = g.bot,
        c = g.camera.cam;
      const V = g.camera.goal.constructor; // pc.Vec3
      const bx = b.pose.x,
        bz = b.pose.z;
      const out = [];
      const onScreen = (x, z) => {
        const y = g.camera.ground ? g.camera.ground(x + 0.5, z + 0.5) : 0;
        const p = c.worldToScreen(new V(x + 0.5, y, z + 0.5));
        return (
          p &&
          p.z > 0 &&
          p.x > 0 &&
          p.x < innerWidth &&
          p.y > 60 &&
          p.y < innerHeight
        );
      };
      const R = 28;
      for (let z = Math.floor(bz) - R; z <= bz + R; z++)
        for (let x = Math.floor(bx) - R; x <= bx + R; x++) {
          const d = Math.hypot(x + 0.5 - bx, z + 0.5 - bz);
          if (d > R) continue;
          let hit;
          if (kind === "pile") {
            const p = s.salvage.pileAt(x, z);
            if (p && (!what || p.material === what) && !s.salvage.problem(p.id))
              hit = { id: p.id, material: p.material };
          } else if (kind === "barricade") {
            const gt = s.gates.gateAt(x, z);
            if (gt && gt.kind === "barricade" && !s.gates.isOpen(gt.id))
              hit = { id: gt.id };
          } else if (kind === "dead") {
            const t = s.grid.get("g", x, z);
            if (
              t &&
              !t.occupantId &&
              !t.blocked &&
              t.feature !== "water" &&
              (t.ground === "polluted" ||
                t.ground === "prepared" ||
                t.ground === "dead") &&
              s.areas.areaOf(t) === "park"
            )
              hit = { id: t.id };
          }
          if (!hit) continue;
          if (d > 6 && !onScreen(x, z)) continue;
          out.push({ ...hit, x, z, d });
        }
      if (kind === "fountain") {
        const f = s.state.machines.find(
          (m) => m.type === "core" && s.areas.areaOf(m) === "park",
        );
        if (f) {
          const d = Math.hypot(f.x + f.size / 2 - bx, f.z + f.size / 2 - bz);
          if (
            d <= 6 ||
            onScreen(f.x + f.size / 2 - 0.5, f.z + f.size / 2 - 0.5)
          )
            out.push({ id: f.id, x: f.x, z: f.z, size: f.size, d });
        }
      }
      return out.sort((a, b) => a.d - b.d);
    },
    [kind, what ?? null],
  );

/** Spots bloombot could not get to, and when (a player leaves those alone for a while). */
const noWay = new Map();
const reachable = (t) =>
  !(
    noWay.has(`${t.x},${t.z}`) &&
    Date.now() - noWay.get(`${t.x},${t.z}`) < 60_000
  );
/** Walks to touch (x, z, size) the way a click there sends bloombot; resolves true on arrival. */
async function walkTo(x, z, size = 1, onto = false) {
  const ok = await walkOnce(x, z, size, onto);
  if (!ok) noWay.set(`${x},${z}`, Date.now());
  return ok;
}
async function walkOnce(x, z, size, onto) {
  const ok = await page.evaluate(
    ([x, z, size, onto]) => {
      const b = window.solarbloom.bot;
      window.__arrived = false;
      return b.goTo("g", x, z, size, () => (window.__arrived = true), onto);
    },
    [x, z, size, onto],
  );
  if (!ok) return false;
  return page
    .waitForFunction(
      () => window.__arrived || !window.solarbloom.bot.walking,
      null,
      { timeout: 90_000, polling: 250 },
    )
    .then(() => page.evaluate(() => window.__arrived))
    .catch(() => false);
}

const promptText = () =>
  page.evaluate(() => {
    const pr = document.querySelector("#prompt");
    return !pr || pr.hidden
      ? ""
      : [...pr.querySelectorAll("*")]
          .filter((e) => !e.children.length)
          .map((e) => e.textContent.trim())
          .filter(Boolean)
          .join(" ");
  });
/** Holds Interact (E) for `secs`, as a player holds it for a held action. */
async function hold(secs) {
  await page.keyboard.down("KeyE");
  await page.waitForTimeout(secs * 1000);
  await page.keyboard.up("KeyE");
  await page.waitForTimeout(400);
}
/** Turns the camera a quarter (a player looking round). */
const lookRound = () =>
  page.evaluate(() => (window.solarbloom.camera.yaw += Math.PI / 2));

const steps = [];
const log = (what, why) => {
  const e = { t: +(Date.now() - t0) / 1000, what, why };
  steps.push(e);
  console.log(
    `  ${e.t.toFixed(1).padStart(6)} s  ${what}${why ? `   ← ${why}` : ""}`,
  );
};

let t0 = Date.now();
const times = { salvage: undefined, fountain: undefined, pry: undefined };
const simAt = {};
const shot = (name) => page.screenshot({ path: `${dir}/${name}.png` });
const parseWant = (r) => {
  // #605's card: the material chips still short ("Scrap 4 of 20" wants 16 more: handed in and carried both count),
  // or none short while the next step says to take them "to the fountain" (an empty list: go and hand them in)
  const mats = (r.parts ?? []).filter((p) => !/^(Park|Landmarks awake)$/.test(p.label));
  const left = mats.filter((p) => p.have < p.need).map((p) => ({ n: p.need - p.have, name: p.label }));
  if (left.length) return left;
  return mats.length && /to the fountain/i.test(r.card) ? [] : undefined;
};

try {
  await startGameFromTitle(page, base, { slot: 1, clock: "game" });
  await page.waitForTimeout(1500);
  t0 = Date.now();
  const simStart = await page.evaluate(() => window.solarbloom.sim.time);
  await shot("0-start");
  let readSince = 0;
  const heard = []; // toasts it read, newest last
  let blankSince;
  let lostSince;
  let looked = 0;
  let last = "";
  let hint; // when, and where, the screen first said to pry

  while ((Date.now() - t0) / 1000 < LIMIT) {
    const m = await moments();
    const now = (Date.now() - t0) / 1000;
    const simNow =
      (await page.evaluate(() => window.solarbloom.sim.time)) - simStart;
    if (m.salvaged && times.salvage === undefined)
      ((times.salvage = now),
        (simAt.salvage = simNow),
        log("★ first salvage"),
        await shot("1-first-salvage"));
    if (m.woke && times.fountain === undefined)
      ((times.fountain = now),
        (simAt.fountain = simNow),
        log("★ the fountain wakes"),
        await shot("2-fountain-awake"));
    if (m.pried.length && times.pry === undefined)
      ((times.pry = now),
        (simAt.pry = simNow),
        log(`★ first barricade pried (${m.pried[0]})`),
        await shot("3-first-pry"));
    if (times.pry !== undefined) break;

    const r = await read(readSince);
    readSince = r.now;
    for (const t of r.toasts) {
      if (CARD_ONLY) {
        log(`(a toast comes and goes, unread: "${t}")`);
        continue;
      }
      heard.push(t);
      log(`reads a toast: "${t}"`);
    }
    // a next step on screen: the card's goal, or a prompt in front of bloombot
    if (!r.card && !r.prompt) {
      blankSince ??= now;
      if (now - blankSince > GAP) {
        check(
          false,
          `the screen showed no next step for over ${GAP} s (at ${now.toFixed(0)} s)`,
        );
        await shot("x-no-next-step");
        break;
      }
    } else blankSince = undefined;
    const said = `${r.card}${r.count ? ` · ${r.count}` : ""}`;
    if (said !== last) {
      log(`reads the card: "${said}"`);
      last = said;
    }

    // what to do, from the words alone
    const words = `${r.card} ${heard.slice(-3).join(" ")}`;
    let acted = false;
    const want = parseWant(r);
    if (m.woke && /\bpry\b|barricade/i.test(words)) {
      const onCard = /\bpry\b|barricade/i.test(r.card);
      hint ??= {
        at: now,
        from: onCard ? "the goal card" : "a toast",
        text: onCard
          ? r.card
          : heard.filter((h) => /\bpry\b|barricade/i.test(h)).pop(),
      };
      const b = (await sights("barricade")).filter(reachable)[0];
      if (b) {
        log(
          `walks to the barricade at ${b.x}, ${b.z}`,
          "a toast said to pry one open",
        );
        if (await walkTo(b.x, b.z)) {
          const p = await promptText();
          log(`faces it: the prompt says "${p}"`);
          if (/Pry/.test(p)) {
            await hold(2.6);
            acted = true;
          }
        }
      }
    } else if (want) {
      // what is still missing from the backpack, by the names on the card
      // what is still missing from the backpack (a material's name on the card, lower case, is its id)
      const short = await page.evaluate((want) => {
        const s = window.solarbloom.sim;
        return want
          .map((w) => ({
            id: w.name.toLowerCase(),
            name: w.name,
            need: w.n, // #605's chips count what is carried too
          }))
          .filter((w) => w.need > 0);
      }, want);
      if (!short.length) {
        const f = (await sights("fountain"))[0];
        if (f) {
          log(
            "walks to the fountain with everything it asks for",
            `the card says "${r.card}"`,
          );
          if (await walkTo(f.x, f.z, f.size)) {
            const p = await promptText();
            log(`faces it: the prompt says "${p}"`);
            if (/fountain/i.test(p)) {
              await page.keyboard.press("KeyE");
              // its panel opens: a player reads it, presses "Give all I have", and closes it
              const give = await page
                .waitForSelector(
                  '#ocPanel.open [data-act="giveAll"]:not([disabled])',
                  { timeout: 8000 },
                )
                .catch(() => null);
              const label = give ? (await give.textContent()).trim() : "";
              log(
                give
                  ? `the fountain's panel opens: presses "${label}"`
                  : "the fountain's panel has nothing to press",
              );
              if (give) await give.click();
              await page.waitForTimeout(800);
              await page.keyboard.press("Escape");
              await page.waitForTimeout(400);
              acted = !!give;
            }
          }
        }
      } else {
        const need = short[0];
        const pile = (await sights("pile", need.id)).filter(reachable)[0];
        if (pile) {
          log(
            `walks to a pile of ${pile.material} at ${pile.x}, ${pile.z}`,
            `the card wants ${need.need} more ${need.name}`,
          );
          if (await walkTo(pile.x, pile.z)) {
            const p = await promptText();
            log(`faces it: the prompt says "${p}"`);
            if (/Salvage/.test(p)) {
              await hold(1.0);
              acted = true;
            }
          }
        }
      }
    } else if (r.count) {
      // a count to raise by hand (the fountain's condition): pulse dead ground near it
      const t = (await sights("dead")).filter(reachable)[0];
      if (t) {
        log(
          `walks to dead ground at ${t.x}, ${t.z} and pulses`,
          `the card counts "${said}"`,
        );
        if (await walkTo(t.x, t.z)) {
          await page.keyboard.press("Space");
          await page.waitForTimeout(700);
          acted = true;
        }
      }
    } else if (m.woke && /\bPry\b/.test(r.prompt)) {
      // walked up to a barricade: the prompt itself says what to do
      hint ??= { at: now, from: "the prompt", text: r.prompt };
      log("holds Interact", `the prompt says "${r.prompt}"`);
      await hold(2.6);
      acted = true;
    } else if (/Salvage/.test(r.prompt)) {
      log("holds Interact", `the prompt says "${r.prompt}"`);
      await hold(1.0);
      acted = true;
    }

    if (acted) {
      lostSince = undefined;
      looked = 0;
      continue;
    }
    lostSince ??= now;
    if (now - lostSince > LOST) {
      check(
        false,
        `for ${LOST} s it found nothing on screen to do about "${said}"${heard.length ? ` (last toast: "${heard[heard.length - 1]}")` : ""}`,
      );
      await shot("x-lost");
      break;
    }
    // nothing in sight: look round, then stroll a little toward the park's middle and beyond
    if (looked < 4) {
      looked++;
      log("looks round (turns the camera)", `nothing in sight for "${said}"`);
      await lookRound();
      await page.waitForTimeout(800);
    } else {
      looked = 0;
      const spot = await page.evaluate(() => {
        const b = window.solarbloom.bot.pose;
        const a = Math.random() * Math.PI * 2;
        return {
          x: Math.round(b.x + Math.cos(a) * 9),
          z: Math.round(b.z + Math.sin(a) * 9),
        };
      });
      log(`strolls toward ${spot.x}, ${spot.z}`, "still nothing in sight");
      await walkTo(spot.x, spot.z, 1, true);
    }
  }

  const fmt = (s) =>
    s === undefined
      ? "not reached"
      : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  console.log(
    `\nTimes from the world on screen (wall clock; game seconds in brackets):`,
  );
  console.log(
    `  first salvage:          ${fmt(times.salvage)} (${simAt.salvage?.toFixed(0) ?? "–"})`,
  );
  console.log(
    `  the fountain wakes:     ${fmt(times.fountain)} (${simAt.fountain?.toFixed(0) ?? "–"})`,
  );
  console.log(
    `  first barricade pried:  ${fmt(times.pry)} (${simAt.pry?.toFixed(0) ?? "–"})`,
  );
  console.log(
    CARD_ONLY
      ? "  (card and prompt only: every toast went unread)"
      : "  (reading the toasts as they came)",
  );
  check(times.salvage !== undefined, `a first salvage (${fmt(times.salvage)})`);
  check(
    times.fountain !== undefined,
    `the fountain wakes (${fmt(times.fountain)})`,
  );
  check(times.pry !== undefined, `a first barricade pried (${fmt(times.pry)})`);
  check(
    !errors.length,
    `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`,
  );
  if (hint)
    console.log(
      `  told to pry by ${hint.from}, ${(hint.at - (times.fountain ?? 0)).toFixed(0)} s after the fountain woke: "${hint.text}"`,
    );
  writeFileSync(
    `${dir}/new-player.json`,
    JSON.stringify(
      {
        gpu: !!process.env.GPU,
        cardOnly: CARD_ONLY,
        limit: LIMIT,
        times,
        gameSeconds: simAt,
        pryHint: hint,
        steps,
        errors,
      },
      null,
      2,
    ),
  );
} catch (e) {
  check(
    false,
    `the play-through ran: ${String(e?.message ?? e).slice(0, 200)}`,
  );
  await shot("x-error").catch(() => {});
  writeFileSync(
    `${dir}/new-player.json`,
    JSON.stringify(
      {
        gpu: !!process.env.GPU,
        limit: LIMIT,
        times,
        gameSeconds: simAt,
        steps,
        errors,
        crash: String(e?.message ?? e),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server?.close();
}
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);

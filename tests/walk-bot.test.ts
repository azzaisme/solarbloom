import { describe, expect, it } from 'vitest';
import { mmss, runBotAsync, type BotReport } from './bots';

/**
 * E20.3 (#286): how the game paces when bloombot has to walk. The same decisions as the active pacing bot, once
 * acting anywhere at once (the cursor path every earlier pacing number used) and once walking to each target.
 * Prints a table for PROGRESS.md; `npm run bot:walk`. Not in the quick suite (a minute or two).
 */
const MINUTES = Number(process.env.WALK_MINUTES ?? 30);
const SEEDS = [7, 21];

const firstArea = (r: BotReport) => {
  const t = Object.entries(r.firsts)
    .filter(([k]) => k.startsWith('area') && k !== 'areaStep')
    .map(([, v]) => v);
  return t.length ? Math.min(...t) : -1;
};

describe('E20.3: walking pacing bot', () => {
  it(`compares cursor and walking play over ${MINUTES} minutes`, { timeout: 900000 }, async () => {
    const rows: string[] = [];
    rows.push('| Seed | Play | Hub | Fountain | First area | Tiles | By bloombot | By helpers | Walking | Trips | Unreachable |');
    rows.push('|---|---|---|---|---|---|---|---|---|---|---|');
    const pairs: BotReport[][] = [];
    for (const seed of SEEDS) {
      const pair: BotReport[] = [];
      pairs.push(pair);
      for (const walk of [false, true]) {
        const r = await runBotAsync({ seed, minutes: MINUTES, walk });
        pair.push(r);
        const hub = r.machines.find((m) => m.type === 'droneHub')?.t;
        const share = (n: number) => `${n} (${Math.round((100 * n) / Math.max(1, r.restoredBy.player + r.restoredBy.helpers))}%)`;
        rows.push(
          `| ${seed} | ${walk ? 'walking' : 'cursor'} | ${mmss(hub)} | ${mmss(r.fountain)} | ${mmss(firstArea(r))} | ${r.tilesRestored} | ${share(r.restoredBy.player)} | ${share(r.restoredBy.helpers)} | ${r.walk ? mmss(r.walk.seconds) : '—'} | ${r.walk?.trips ?? '—'} | ${r.walk?.unreachable ?? '—'} |`,
        );
      }
    }
    console.log(`\nE20.3 walking pacing bot (${MINUTES} min)\n${rows.join('\n')}\nfirsts (walking, seed ${SEEDS[0]}): ${JSON.stringify(pairs[0][1].firsts)}\n`);
    for (const [cursor, walked] of pairs) {
      // Sanity, not targets: the walking bot gets somewhere and restores a fair share of what the cursor bot does.
      expect(walked.walk!.trips).toBeGreaterThan(0);
      expect(walked.tilesRestored).toBeGreaterThan(cursor.tilesRestored * 0.3);
    }
  });
});

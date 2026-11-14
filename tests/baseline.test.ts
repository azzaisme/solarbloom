import { describe, expect, it } from 'vitest';
import { KINDS } from '../src/core/Economy';
import { mmss, runBot, type BotReport } from './bots';

/**
 * Phase 4 E00.3: the first-15-minute baseline, measured by scripted bots (not people). Prints a report;
 * `BASELINE=1 npx vitest run tests/baseline.test.ts` for the full per-minute log.
 */
const SEEDS = [7, 21, 99];
const MIN = 15;

function line(r: BotReport) {
  const f = r.firsts;
  const ups = r.upgrades.slice(0, 6).map((u) => `${u.id}@${mmss(u.t)}`).join(' ');
  const cap = KINDS.map((k) => `${k[0]}${r.capped[k]}s`).join('/');
  const over = KINDS.map((k) => `${k[0]}${Math.round(r.overflow[k])}`).join('/');
  return (
    `seed ${r.seed} ${r.mode}: upgrade ${mmss(f.upgrade)} condenser ${mmss(f.condenser)} garden ${mmss(f.pollinator)} hub-fits-cap ${mmss(r.hubFitsCap)} hub-affordable ${mmss(r.hubAffordable)} hub ${mmss(f.droneHub)} ` +
    `tree ${mmss(f.motherTree)} cat ${mmss(f.cat)} frenzy ${mmss(f.frenzy)} (${r.frenzies}×) chain5 ${mmss(f.chain5)} chain10 ${mmss(f.chain10)} fountain ${mmss(r.fountain)} | park ${r.parkRestored} tiles ${r.tilesRestored} ` +
    `maxCombo ${r.maxCombo} gap ${r.longestGap}s stuck ${r.stuck}s capped ${cap} lost ${over} earned🌿 ${Math.round(r.earned.biomass)} pulses ${r.pulses}\n    upgrades: ${ups}`
  );
}

describe('Phase 4 baseline (scripted bots)', () => {
  it('records the first 15 minutes, active and hands-off', { timeout: 120_000 }, () => {
    const verbose = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BASELINE;
    for (const seed of SEEDS) {
      const a = runBot({ seed, minutes: MIN });
      const h = runBot({ seed, minutes: MIN, mode: 'handsOff' });
      const after = (r: BotReport, k: 'tiles' | 'biomass') => {
        const at = h.handsOffAt ?? 0;
        const snap = r.minutesLog.find((m) => m.m * 60 >= at);
        const end = r.minutesLog[r.minutesLog.length - 1];
        return k === 'tiles' ? end.tiles - (snap?.tiles ?? 0) : r.earned.biomass;
      };
      // eslint-disable-next-line no-console
      console.log(`${line(a)}\n${line(h)}\n    hands-off from ${mmss(h.handsOffAt)}: tiles after that ${after(h, 'tiles')} vs active ${after(a, 'tiles')} (${Math.round((100 * after(h, 'tiles')) / Math.max(1, after(a, 'tiles')))}%)`);
      if (verbose) for (const r of [a, h]) for (const m of r.minutesLog) console.log(`  ${r.mode} ${m.m}m park ${m.parkRestored} tiles ${m.tiles} res ${JSON.stringify(m.res)} caps ${JSON.stringify(m.caps)} rates/min ${JSON.stringify(m.rates)}`);
      expect(a.tilesRestored).toBeGreaterThan(0);
    }
  });
});

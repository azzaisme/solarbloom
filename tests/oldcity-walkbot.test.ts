import { describe, expect, it } from 'vitest';
import { FIRST_STEPS } from '../src/ui/OldCityGuide';
import { mmss, runOldCityBot } from './oldcity-bot';

/**
 * E21.12 / E21.23: the Old City's walking bot (`npm run bot:oldcity`, seeds 7 and 21). It plays the first fifteen
 * minutes on foot and reports the time to tier 1 (E21's 8–12 minute target is superseded by E23, #354); it checks
 * every first-fifteen-minutes hint shows in order with none skipped, and never more than 3 minutes idle. Not in the quick suite (a minute).
 */
const SEEDS = [7, 21];

describe('E21.12: the walking bot\'s first fifteen minutes', () => {
  for (const seed of SEEDS)
    it(`seed ${seed}: reaches tier 1 (time reported), every hint in order`, { timeout: 600_000 }, () => {
      const r = runOldCityBot(seed, 25);
      console.log(
        `\nE21.12 walking bot, seed ${seed}: first salvage ${mmss(r.firsts.salvage)} · first pulse ${mmss(r.firsts.pulse)} · Seeds ${mmss(r.firsts.seeds)} · tier 1 ${mmss(r.firsts.tier1)} · barricade ${mmss(r.firsts.gate)} · Keeper ${mmss(r.firsts.keeper)} · Solar Panel ${mmss(r.firsts.solar)} · walking ${mmss(r.walked)} · longest idle ${r.longestIdle} s\n  steps ${r.steps.join(' → ')}\n  ${r.hints.map((h, i) => `${r.steps[i]}: ${h}`).join('\n  ')}\n`,
      );
      // E21.12's 8–12 minute target for tier 1 is superseded by E23 (#354, A living world), which reworks pulses,
      // charge and salvage: the bot reports the time (above) and only checks that tier 1 is reached.
      expect(r.firsts.tier1).toBeDefined();
      expect(r.longestIdle).toBeLessThanOrEqual(180);
      // every step, in order, none skipped: a barricade, a Keeper, then (E23.1.4) the first Solar Panel, Tally's craft
      expect(r.steps).toEqual(Array.from({ length: FIRST_STEPS }, (_, i) => i));
      expect(r.firsts.keeper).toBeDefined();
      expect(r.firsts.solar).toBeGreaterThan(r.firsts.keeper);
      // E23.3 (#480): the Solar Panel bloombot built joins the grid and supplies power
      if (r.grid) {
        console.log(`  grid: solar panel on a network ${r.grid.onNetwork}, supply ${r.grid.supply.toFixed(1)} W`);
        expect(r.grid.onNetwork).toBe(true);
        expect(r.grid.supply).toBeGreaterThan(0);
      }
      // E23.10.1 (#405): never stranded at zero charge (checked once E23.2.1's charge is on the sim)
      if (r.charge) {
        console.log(`  charge: lowest ${r.charge.min.toFixed(2)} · ${r.charge.atZero.toFixed(0)} s at zero · ${r.charge.stranded.toFixed(0)} s stranded`);
        expect(r.charge.stranded).toBe(0);
      }
    });
});

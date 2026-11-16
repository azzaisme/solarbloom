import { describe, expect, it } from 'vitest';
import { playCity } from './city-bot';

const fmt = (s?: number) => (s === undefined || !isFinite(s) ? '—' : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`);

describe('pacing in the endless city (scripted player)', () => {
  // One test per seed: a single synchronous test over ~60 s starves the Vitest worker's RPC (CI timeout).
  for (const seed of [7, 21])
  it(`after the fountain, keeps clearing areas at a steady pace with no dead time (seed ${seed})`, { timeout: 900000 }, async () => {
    {
      const r = await playCity(seed, 3, 60);
      const gaps = r.clears.map((t, i) => t - (i ? r.clears[i - 1] : r.fountain ?? 0));
      const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : Infinity;
      // eslint-disable-next-line no-console
      console.log(
        `city seed ${seed}: fountain ${fmt(r.fountain)} · ${r.clears.length} areas in 60 min · first ${fmt(r.clears[0])} · avg ${fmt(avg)} per area · slowest ${fmt(Math.max(...gaps))} · stuck ${Math.round(r.stuck)}s · max chain ×${r.maxCombo} · big chains by you ${r.sim.state.stats.bigChains?.player ?? 0} / automation ${r.sim.state.stats.bigChains?.auto ?? 0}`,
      );
      expect(r.fountain).toBeDefined();
      expect(r.clears.length).toBeGreaterThanOrEqual(8);
      expect(avg).toBeLessThan(6 * 60);
      expect(r.stuck).toBeLessThan(60 * 60 * 0.02);
      // Active play stays the most powerful thing: the player's own taps start most big chains.
      const big = r.sim.state.stats.bigChains ?? { player: 0, auto: 0 };
      expect(big.player).toBeGreaterThan(big.auto);
    }
  });
});

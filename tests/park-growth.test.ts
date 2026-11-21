import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState } from '../src/core/GameState';
import { PARK_GROWTH, PARK_GROWTH_TUNING } from '../src/data/bloombot';
import { SALVAGE } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { BLOOMBOT_GROUPS, bloombotRows, parkRows, stateWords } from '../src/ui/BloombotPage';
import { bannedIn, WORDS } from '../src/ui/words';

/**
 * #622 (E25): greening the park grows Bloombot. Three milestones (20, 40 and 60 park tiles alive) each give a small
 * first growth, kept once earned, that does something real: a pulse that wakes one more tile, charge that goes a
 * tenth further, quicker salvage. Each shows on the Bloombot page and as a part on Bloombot.
 */
const restorePark = (sim: Sim, n: number) => {
  let done = 0;
  for (const t of sim.areas.tiles(PARK)) {
    if (done >= n) break;
    if (t.ground === 'restored' || !sim.restoration.checkPulse(t).ok) continue;
    t.ground = 'restored';
    t.pollution = 0;
    t.bloom = 1;
    sim.grid.touch(t);
    done++;
  }
  return done;
};
/** Greens the park up to `n` tiles alive in all. */
const greenTo = (sim: Sim, n: number) => restorePark(sim, Math.max(0, n - sim.areas.counts(PARK).restored));
const fresh = () => new Sim(createInitialState(7));
const grew = (sim: Sim) => {
  const got: string[] = [];
  sim.bus.on('bloombot.parkGrew', ({ id }) => got.push(id));
  return got;
};

describe('#622: greening the park grows Bloombot', () => {
  it('three milestones, at 20, 40 and 60 tiles, each with a plain name and line', () => {
    expect(PARK_GROWTH.map((g) => [g.tiles, g.name])).toEqual([
      [20, 'Spreading pulse'],
      [40, 'Steady charge'],
      [60, 'Nimble hands'],
    ]);
    for (const g of PARK_GROWTH) {
      expect(bannedIn(g.does), g.does).toEqual([]);
      expect(g.does).toMatch(/\.$/);
      expect(g.does).not.toMatch(/\btiles?\b/);
    }
  });

  it('a new game has grown nothing; each milestone comes once, in order, with its own moment', () => {
    const sim = fresh();
    const got = grew(sim);
    sim.parkGrowth.check();
    expect(sim.parkGrowth.step).toBe(0);
    greenTo(sim, 20);
    sim.parkGrowth.check();
    expect(got).toEqual(['spill']);
    greenTo(sim, 60);
    sim.parkGrowth.check();
    expect(got).toEqual(['spill', 'thrift', 'quick']);
    sim.parkGrowth.check();
    expect(got.length).toBe(3);
    expect(sim.state.progression.parkGrowth).toBe(3);
  });

  it('it comes from the game tick, not only when asked', () => {
    const sim = fresh();
    const got = grew(sim);
    greenTo(sim, 20);
    for (let i = 0; i < 4; i++) sim.tick(0.25);
    expect(got).toEqual(['spill']);
  });

  it('kept once earned, even if the park loses ground', () => {
    const sim = fresh();
    greenTo(sim, 40);
    sim.parkGrowth.check();
    for (const t of sim.areas.tiles(PARK)) if (t.ground === 'restored') t.ground = 'polluted';
    sim.parkGrowth.check();
    expect(sim.parkGrowth.step).toBe(2);
  });

  it('a save from before E25 catches up quietly: no burst of moments', () => {
    const state = createInitialState(7);
    delete state.progression.parkGrowth;
    const sim = new Sim(state);
    const got = grew(sim);
    greenTo(sim, 45);
    sim.parkGrowth.check();
    expect(sim.parkGrowth.step).toBe(2);
    expect(got).toEqual([]);
    greenTo(sim, 60);
    sim.parkGrowth.check();
    expect(got).toEqual(['quick']);
  });

  it('Spreading pulse: a pulse on dry ground wakes one tile beside it too', () => {
    const before = fresh();
    const after = fresh();
    after.state.progression.parkGrowth = 1;
    const pick = (sim: Sim) => sim.areas.tiles(PARK).find((t) => sim.restoration.checkPulse(t).ok && sim.restoration.spillTiles(t).length === (sim === after ? 1 : 0) && t.ground !== 'restored')!;
    const count = (sim: Sim) => {
      const t = pick(sim);
      let extra: string[] = [];
      sim.bus.on('pulse.fired', (e) => (extra = e.extra));
      expect(sim.restoration.pulse(t.id)).toBe(true);
      return extra.length;
    };
    expect(count(before)).toBe(0);
    expect(count(after)).toBe(PARK_GROWTH_TUNING.spill);
  });

  it('Steady charge: a pulse costs a tenth less', () => {
    const sim = fresh();
    const base = sim.charge.cost('pulse');
    const run = sim.charge.cost('sprint');
    sim.state.progression.parkGrowth = 2;
    expect(sim.charge.cost('pulse')).toBeCloseTo(base * PARK_GROWTH_TUNING.chargeFactor, 6);
    expect(sim.charge.cost('sprint')).toBeCloseTo(run * PARK_GROWTH_TUNING.chargeFactor, 6);
  });

  it('Nimble hands: salvaging takes a quarter less time', () => {
    const sim = fresh();
    expect(sim.upgrades.salvageHold).toBe(SALVAGE.holdSeconds);
    sim.state.progression.parkGrowth = 3;
    expect(sim.upgrades.salvageHold).toBeCloseTo(SALVAGE.holdSeconds * PARK_GROWTH_TUNING.holdFactor, 6);
  });

  it('the Bloombot page: its own group, counting the goal card\'s Park number, the next one first', () => {
    const sim = fresh();
    greenTo(sim, 12);
    sim.parkGrowth.check();
    const rows = parkRows(sim);
    expect(rows.map((r) => `${r.name} ${r.state}`)).toEqual(['Spreading pulse next', 'Steady charge later', 'Nimble hands later']);
    const n = sim.areas.counts(PARK).restored;
    expect(stateWords(rows[0])).toBe(`${n} of 20`);
    expect(rows[0].how).toBe(`Keep bringing the park back to life around the fountain. This grows at 20 on the goal card's Park count, and it's at ${n} now.`);
    expect(rows[0].where?.name).toBe('the fountain');
    expect(rows.map((r) => r.part)).toEqual(['bud', 'collar', 'cuffs']);
    expect(BLOOMBOT_GROUPS.map((g) => g.title)).toEqual(['Moves', 'Stronger moves', 'Grown with the park', 'Upgrades']); // #626 adds the second levels
    greenTo(sim, 20);
    sim.parkGrowth.check();
    expect(parkRows(sim)[0]).toMatchObject({ state: 'have', how: 'Grown with the park.', where: undefined });
    expect(stateWords(parkRows(sim)[0])).toBe('Grown');
    for (const r of bloombotRows(sim)) for (const line of [r.does, r.how]) expect(bannedIn(line), line).toEqual([]);
  });

  it('the moment names what grew, plainly', () => {
    const t = WORDS.bloombot.park('Spreading pulse', PARK_GROWTH[0].does);
    expect(t).toBe('The park helped Bloombot grow: Spreading pulse<small>A pulse on dry ground wakes the patch beside it too.</small>');
    expect(bannedIn(t)).toEqual([]);
  });
});

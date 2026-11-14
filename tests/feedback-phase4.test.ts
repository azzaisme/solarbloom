import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';

describe('Phase 4 E03: the pulse preview is exactly what the pulse does', () => {
  it('footprint() is pure and matches the tiles the next pulse restores, at every Wide Pulse level and on Overcharge', () => {
    for (const [broad, over] of [[0, 0], [1, 0], [2, 0], [3, 0], [0, 3]]) {
      const sim = new Sim(createInitialState(11));
      const s = sim.state;
      s.caps.energy = s.caps.water = 1000;
      s.resources.energy = s.resources.water = 1000;
      s.upgrades.broadPulse = broad;
      s.upgrades.overcharge = over;
      if (over) s.progression.pulseCharge = 99; // the next pulse is Overcharged
      const t = sim.areas.tiles(PARK).find((x) => x.ground === 'polluted' && sim.restoration.checkPulse(x).ok && sim.grid.neighbors(x).length === 4)!;
      const before = JSON.stringify(s);
      const preview = sim.restoration.footprint(t).map((f) => f.tile.id);
      expect(JSON.stringify(s)).toBe(before); // previewing changes nothing
      let fired: string[] = [];
      sim.bus.on('pulse.fired', ({ extra }) => (fired = extra));
      expect(sim.restoration.pulse(t.id)).toBe(true);
      expect(fired).toEqual(preview);
      if (broad || over) expect(preview.length).toBeGreaterThan(0);
    }
  });
});

describe('Phase 4 E04: power progression', () => {
  it('Pulse Reach footprints grow 1 → 9 → 25 → 69 → 161 tiles on open ground', () => {
    const sizes: number[] = [];
    for (let lvl = 0; lvl <= 4; lvl++) {
      const sim = new Sim(createInitialState(3));
      sim.state.upgrades.broadPulse = lvl;
      const r = sim.restoration.pulseRadius();
      let n = 0;
      for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) if (dx * dx + dz * dz <= r * r + 1e-9) n++;
      sizes.push(n);
    }
    expect(sizes).toEqual([1, 9, 25, 69, 161]);
  });

  it('park milestones pay once each, in order, and survive save/load without paying twice', async () => {
    const { SaveService } = await import('../src/app/SaveService');
    const { TUNING } = await import('../src/data/tuning');
    const sim = new Sim(createInitialState(5));
    const paid: number[] = [];
    sim.bus.on('milestone.reached', ({ at }) => paid.push(at));
    sim.tick();
    const tiles = sim.areas.tiles(PARK).filter((t) => sim.restoration.isEligible(t));
    for (const t of tiles.slice(0, 22)) {
      sim.restoration.complete(t, 'pulse');
      sim.tick();
    }
    expect(paid).toEqual([5, 10, 20]);
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    const again: number[] = [];
    copy.bus.on('milestone.reached', ({ at }) => again.push(at));
    copy.advance(1);
    expect(again).toEqual([]);
    expect(copy.progression.nextMilestone()?.at).toBe(TUNING.parkMilestones[3].at);
  });

  it('an older save that already passed milestones does not get a windfall', () => {
    const sim = new Sim(createInitialState(5));
    for (const t of sim.areas.tiles(PARK).filter((x) => sim.restoration.isEligible(x)).slice(0, 40)) sim.restoration.complete(t, 'pulse');
    delete sim.state.progression.parkMilestones;
    const paid: number[] = [];
    sim.bus.on('milestone.reached', ({ at }) => paid.push(at));
    sim.advance(1);
    expect(paid).toEqual([]);
  });
});

describe('Phase 4 E05: evolving tiles', () => {
  it('stages only go up, Radiant pays the most, and counts once toward restored tiles and as full bloom', async () => {
    const { TUNING } = await import('../src/data/tuning');
    const sim = new Sim(createInitialState(9));
    const s = sim.state;
    s.caps.energy = s.caps.water = 1000;
    s.resources.energy = s.resources.water = 1000;
    const t = sim.areas.tiles(PARK).find((x) => x.ground === 'polluted' && sim.restoration.checkPulse(x).ok)!;
    sim.restoration.complete(t, 'pulse');
    const rates: number[] = [];
    const seen: number[] = [t.bloom];
    for (let i = 0; i < 6; i++) {
      rates.push(sim.production.tileBiomassRate(t));
      sim.restoration.pulse(t.id);
      seen.push(t.bloom);
    }
    expect(seen).toEqual([1, 2, 3, 4, 4, 4, 4]);
    for (let i = 1; i < 4; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    expect(sim.progression.restoredCount('home')).toBe(1);
    expect(sim.progression.fullBloomCount('home')).toBe(1);
    expect(t.bloom).toBe(TUNING.restore.maxBloom);
    const saver = new (await import('../src/app/SaveService')).SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(s))!);
    expect(copy.grid.byTileId(t.id)!.bloom).toBe(4);
  });
});

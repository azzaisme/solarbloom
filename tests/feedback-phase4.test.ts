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

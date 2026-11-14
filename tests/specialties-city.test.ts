import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

function cityWith(type: string, seed = 2) {
  for (let sd = seed; sd < seed + 40; sd++) {
    const sim = new Sim(createInitialState(sd));
    const st = sim.state;
    st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
    st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
    st.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    for (let r = 1; r <= 4; r++)
      for (let cz = -r; cz <= r; cz++)
        for (let cx = -r; cx <= r; cx++) {
          const id = sim.areas.map.areaOfChunk(cx, cz);
          if (sim.areas.info(id).type !== type) continue;
          sim.areas.reveal(id);
          return { sim, id };
        }
  }
  throw new Error(`no ${type} area`);
}

describe('rooftop specialties in the city (City 12.2)', () => {
  it('a grove’s landmark is an Elder Tree: blooms around it charge it and it releases a Canopy Burst', () => {
    const { sim, id } = cityWith('grove');
    const tree = sim.areas.landmark(id)!;
    expect(sim.chains.isElder(tree)).toBe(true);
    // Clear the grove so the fog doesn't get in the way of this test.
    sim.areas.clear(id, true);
    tree.charge = TUNING.neighbourhood.canopy.threshold - 1;
    let bursts = 0;
    sim.bus.on('canopy.burst', () => bursts++);
    const near = sim.grid.tilesNear(tree, 2).find((t) => !t.blocked && !t.occupantId && t.ground !== 'restored')!;
    sim.restoration.complete(near, 'pulse');
    sim.advance(6);
    expect(bursts).toBe(1);
    expect(tree.charge).toBe(0);
  });

  it('Reservoir Gardens grow only in reservoir and canal areas of the city', () => {
    const { sim, id } = cityWith('reservoir');
    sim.areas.clear(id, true);
    expect(sim.build.isUnlocked('reservoirGarden')).toBe(true);
    const inside = sim.areas.tiles(id).find((t) => !t.blocked && !t.occupantId)!;
    inside.ground = 'restored';
    inside.bloom = 1;
    expect(sim.build.check('reservoirGarden', GROUND, inside.x, inside.z).spotOk).toBe(true);
    const park = sim.areas.tiles(PARK).find((t) => !t.blocked && !t.occupantId)!;
    park.ground = 'restored';
    const out = sim.build.check('reservoirGarden', GROUND, park.x, park.z);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/reservoir or canal/);
  });
});

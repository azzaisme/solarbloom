import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { packChunk, unpackChunk } from '../src/core/TilePack';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { ProgressRings } from '../src/rendering/transitions/ProgressRings';
import * as pc from 'playcanvas';

function park() {
  const sim = new Sim(createInitialState(6));
  sim.state.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  return sim;
}
const dead = (sim: Sim) => sim.areas.tiles(PARK).filter((t) => sim.restoration.isEligible(t));

describe('VFX 1: the ground a pulse heals washes in with its wave', () => {
  it('a pulsed tile takes the wave: its start, radius and seconds, from when the wave leaves', () => {
    const sim = park();
    const t = dead(sim)[0];
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(t.tr?.k).toBe('restore');
    sim.transitions.wash(t, -0.6, 0.25, 3.2, 0.79, 0.14);
    const tr = t.tr!;
    expect(tr.w).toEqual([-0.6, 0.25, 3.2, 0.79]);
    expect(tr.t0).toBeCloseTo(sim.time + 0.14, 3);
    // long enough for the wave and the plants after it, far shorter than the old 12 s sequence
    expect(tr.d).toBeCloseTo(Math.max(TUNING.transitions.wash, 0.79 + TUNING.transitions.washAfter), 3);
    expect(tr.d).toBeLessThan(TUNING.transitions.restore.pulse);
    expect(tr.dir).toBeUndefined();
  });

  it('only a restore starting is washed: not a Cultivator transition, not other kinds', () => {
    const sim = park();
    const t = dead(sim)[1];
    sim.transitions.begin(t, 'restore', 5, { g: true });
    sim.transitions.wash(t, 0, 0, 3, 0.8);
    expect(t.tr?.w).toBeUndefined();
    sim.transitions.begin(t, 'bloom', 3);
    sim.transitions.wash(t, 0, 0, 3, 0.8);
    expect(t.tr?.w).toBeUndefined();
  });

  it('the wave is saved with the tile and comes back on load', () => {
    const sim = park();
    const t = sim.grid.get(GROUND, 3, 3)!;
    t.tr = { k: 'restore', t0: 10.5, d: 2.6, from: 40, w: [1.25, -0.5, 3.4, 0.81] };
    const c = sim.grid.chunkAt(GROUND, 0, 0)!;
    const packed = packChunk(c, sim.state.seed, sim.grid.layer(GROUND)!);
    t.tr = undefined;
    unpackChunk(c, packed);
    expect(sim.grid.get(GROUND, 3, 3)!.tr).toEqual({ k: 'restore', t0: 10.5, d: 2.6, from: 40, w: [1.25, -0.5, 3.4, 0.81] });
  });

  it('no progress ring on pulsed ground (it heals in front of you)', () => {
    const sim = park();
    const t = dead(sim)[2];
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(t.ground).toBe('growing');
    const rings = new ProgressRings(sim, new pc.Entity());
    rings.update(4, { x: t.x, z: t.z });
    expect(rings.visible).toBe(0);
  });
});

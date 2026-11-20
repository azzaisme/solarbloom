import { describe, expect, it, vi } from 'vitest';
import type { RampDef } from '../src/data/oldcity';

// No flight in the world faces west. The causeway's two ramps face east, one down and one up: described facing west
// instead (each one's ends swapped) they are the same ground, so the pipe over them must come out the same.
vi.mock('../src/core/Mainland', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/Mainland')>();
  return { ...real, causewayRamps: () => real.causewayRamps().map((r): RampDef => ({ ...r, dir: 'w', from: r.to, to: r.from })) };
});

const { createInitialState } = await import('../src/core/GameState');
const { causewayRamps } = await import('../src/core/Mainland');
const { rampAt } = await import('../src/core/Height');
const { Sim } = await import('../src/gameplay/Sim');
const { checkFlight } = await import('./pipe-flights');

describe('E23.4.2: a pipe on a flight facing west', () => {
  it('runs as one straight slope over both causeway ramps, turned to face west, rising and falling', () => {
    const sim = new Sim(createInitialState(7));
    const ramps = causewayRamps();
    expect(ramps.map((r) => r.dir)).toEqual(['w', 'w']);
    for (const r of ramps) expect(rampAt(r.x, r.z)!.ramp.dir).toBe('w'); // the world reads them so: the heights and tiles too
    expect(ramps.map((r) => checkFlight(sim, r)).sort()).toEqual(['falling', 'rising']);
  });
});

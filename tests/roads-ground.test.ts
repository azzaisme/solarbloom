// City 16.5–16.7: the road network in generated ground (generation 4; E23.1.1: generations 2–3 are gone with old saves).
// Heavier than tests/roads.test.ts (whole grids), so it runs in the full suite only.
import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND_GEN, OLD_CITY_GEN } from '../src/core/GameState';
import { buildingAt } from '../src/core/Generation';
import { Grid } from '../src/core/Grid';
import { roadPlanFor } from '../src/core/RoadPlan';

const SEEDS = [1, 42, 9001];

describe('City 16.5–16.7: generation 4 ground', { timeout: 60000 }, () => {
  const groundOf = (seed: number, gen: number) => new Grid(seed, createInitialState(seed).layers.map((l) => ({ ...l, gen })));

  it('the city generator is generation 4; new games start on the Old City (generation 5)', () => {
    expect(GROUND_GEN).toBe(4);
    expect(createInitialState(5).layers.find((l) => l.kind === 'ground')!.gen).toBe(OLD_CITY_GEN); // E23.1.1: every game
  });

  it('no building, rooftop or obstacle sits on a road or lane, and road tiles are road or paving', () => {
    for (const seed of SEEDS) {
      const g = groundOf(seed, 4);
      const plan = roadPlanFor(seed, 4);
      for (let z = -96; z < 96; z++)
        for (let x = -96; x < 96; x++) {
          const r = plan.roadAt(x, z);
          if (!r) continue;
          const t = g.get('g', x, z)!;
          expect(buildingAt(seed, x, z, 4), `building on road at ${x},${z}`).toBeUndefined();
          expect(plan.map.underRoof(plan.map.areaOfCell(x, z), x, z)).toBe(false);
          expect(t.blocked, `blocked road at ${x},${z} (${t.feature})`).toBe(false);
          expect(t.feature).toBe(r.tier === 'lane' ? 'paving' : 'road');
        }
    }
  });

  it('buildings along arterials front the road and keep a storey more within the theme cap', () => {
    const seed = 42;
    const plan = roadPlanFor(seed, 4);
    let fronting = 0;
    let all = 0;
    for (let cz = -6; cz <= 6; cz++)
      for (let cx = -6; cx <= 6; cx++) {
        for (let z = cz * 16; z < cz * 16 + 16; z++)
          for (let x = cx * 16; x < cx * 16 + 16; x++) {
            const b = buildingAt(seed, x, z, 4);
            if (!b || b.x !== x || b.z !== z) continue;
            all++;
            let near = false;
            for (let i = -1; i <= b.w && !near; i++) for (let j = -1; j <= b.d && !near; j++) if (plan.roadAt(b.x + i, b.z + j)) near = true;
            if (near) fronting++;
          }
      }
    expect(all).toBeGreaterThan(100);
    // Most buildings front a street rather than standing back in a yard.
    expect(fronting / all).toBeGreaterThan(0.6);
  });
});

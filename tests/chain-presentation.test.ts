import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { CROSS, openIsland, streetCross } from './helpers';
import { Sim } from '../src/gameplay/Sim';
import { bloomVoice, ChainSummary, VfxBudget } from '../src/ui/ChainSummary';

/** E23.1.1: the whole island open, with a cross of street corridors over it (see helpers' CROSS). */
function bigChainCity() {
  const sim = openIsland(new Sim(createInitialState(11)));
  streetCross(sim);
  return sim;
}

describe('readable huge chains (City 10.6)', () => {
  it('a ×200+ chain is summarised per area with a running total, the area the wave is in first', () => {
    const sim = bigChainCity();
    const summary = new ChainSummary(sim);
    let blooms = 0;
    let snapshot: { lines: string[]; areas: number; total: number } | undefined;
    sim.bus.on('chain.event', ({ event }) => {
      if (event.type === 'RESTORE' || event.type === 'GROW' || event.type === 'LUSH') blooms++;
      const tr = summary.biggest();
      if (tr && tr.total === 40) snapshot = { lines: summary.lines(tr), areas: tr.perArea.size, total: tr.total };
    });
    let biggest = 0;
    sim.bus.on('chain.ended', ({ combo }) => (biggest = Math.max(biggest, combo)));
    sim.restoration.complete(sim.grid.get(GROUND, CROSS.start[0], CROSS.start[1])!, 'pulse');
    let peak = 0;
    for (let i = 0; i < 600 && sim.chains.activeRuns > 0; i++) {
      sim.advance(0.1);
      const tr = summary.biggest();
      if (tr) {
        peak = Math.max(peak, tr.total);
        expect([...tr.perArea.values()].reduce((a, b) => a + b, 0)).toBe(tr.total);
      }
    }
    expect(biggest).toBeGreaterThanOrEqual(200);
    expect(peak).toBeGreaterThan(40);
    expect(snapshot).toBeDefined();
    // At most three areas named, then the running total.
    expect(snapshot!.lines.length).toBeLessThanOrEqual(4);
    expect(snapshot!.lines[snapshot!.lines.length - 1]).toBe(`40 blooms across ${snapshot!.areas} areas`);
    expect(snapshot!.lines[0]).toMatch(/×\d+$/);
    // Finished chains are forgotten.
    expect(summary.tracks.size).toBe(0);
    expect(blooms).toBeGreaterThan(40);
  });

  it('the wave front glides towards new blooms instead of jumping', () => {
    const sim = bigChainCity();
    const summary = new ChainSummary(sim);
    const jumps: number[] = [];
    const raw: number[] = [];
    let last: [number, number] | undefined;
    let lastBloom: [number, number] | undefined;
    sim.bus.on('chain.event', ({ event }) => {
      if (event.type !== 'RESTORE' && event.type !== 'GROW') return;
      const t = sim.grid.byTileId(event.target)!;
      if (lastBloom) raw.push(Math.hypot(t.x - lastBloom[0], t.z - lastBloom[1]));
      lastBloom = [t.x, t.z];
    });
    sim.restoration.complete(sim.grid.get(GROUND, CROSS.start[0], CROSS.start[1])!, 'pulse');
    for (let i = 0; i < 300 && sim.chains.activeRuns > 0; i++) {
      sim.advance(0.1);
      const tr = summary.biggest();
      if (!tr) continue;
      if (last) jumps.push(Math.hypot(tr.fx - last[0], tr.fz - last[1]));
      last = [tr.fx, tr.fz];
    }
    expect(jumps.length).toBeGreaterThan(10);
    // Blooms jump between branches of the chain; the front moves far less.
    expect(Math.max(...raw)).toBeGreaterThan(30);
    expect(Math.max(...jumps)).toBeLessThan(Math.max(...raw) / 2);
  });

  it('chain audio changes instead of stacking: few voices per second, rising pitch, new textures', () => {
    let last = -1;
    let voices = 0;
    const steps: number[] = [];
    const types = new Set<string>();
    // 1,000 events over 10 s (a huge chain at 100 blooms a second).
    for (let i = 1; i <= 1000; i++) {
      const v = bloomVoice(i, i * 0.01, last);
      if (!v) continue;
      last = i * 0.01;
      voices++;
      steps.push(v.step);
      types.add(`${v.type}${v.octave ? '+8va' : ''}`);
    }
    expect(voices).toBeLessThan(120); // vs 1,000 stacked tones
    for (let k = 1; k < steps.length; k++) expect(steps[k]).toBeGreaterThanOrEqual(steps[k - 1]);
    expect(types.size).toBe(3);
  });

  it('VFX coalesce under a per-frame budget', () => {
    const b = new VfxBudget(18);
    let shown = 0;
    for (let i = 0; i < 100; i++) if (b.take(1)) shown++;
    expect(shown).toBe(18);
    expect(b.take(2)).toBe(true);
  });
});


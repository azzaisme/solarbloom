import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { REGIONS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);
const region = (id: string) => REGIONS.find((r) => r.id === id)!;

/** An Old City just past tier 1: the park cleared, the ring-1 regions revealed behind their barricades. */
function tier1(seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.state.salvage!.tier = 1;
  sim.areas.clear(PARK, true);
  return sim;
}

/** Brings `share` of an area's tiles back to life (#hedge-line: what a hedge's lock waits on). */
function green(sim: Sim, area: string, share: number) {
  const tiles = sim.areas.tiles(area);
  for (const t of tiles.slice(0, Math.ceil(tiles.length * share))) {
    t.ground = 'restored';
    sim.grid.touch(t);
  }
}

describe('#hedge-line: a hedge lock needs a third of the ground on the near side alive (owner, 27 Nov 2026)', () => {
  it('Prune alone is not enough: the park has to be a third alive, and the prompt says how far along it is', () => {
    const sim = tier1();
    sim.state.salvage!.abilities.push('prune');
    const g = region('oldMarket').gate;
    expect(sim.gates.aliveArea(g)).toBe(PARK);
    expect(sim.gates.problem(g)).toMatch(/^The hedge won't give yet\. Bring a third of the park back to life first \(\d+% so far\)\.$/);
    expect(sim.gates.open(g.id)).toBe(false);
    green(sim, PARK, 0.2);
    expect(sim.gates.problem(g)).toMatch(/Bring a third of the park/);
    green(sim, PARK, 0.5);
    expect(sim.gates.aliveShare(g)).toBeGreaterThanOrEqual(1 / 3);
    expect(sim.gates.problem(g)).toBeUndefined();
    expect(sim.gates.open(g.id)).toBe(true);
  });

  it('the boardwalk hedge counts Saltwind itself, the open ground it stands in', () => {
    const sim = tier1();
    const g = region('saltwind').gate;
    expect(sim.gates.aliveArea(g)).toBe('saltwind');
    expect(g.needs.alive).toBeCloseTo(1 / 3);
  });

  it('every hedge gate needs Prune and a third alive', () => {
    for (const r of REGIONS.filter((q) => q.gate.kind === 'hedge')) {
      expect(r.gate.needs.ability).toBe('prune');
      expect(r.gate.needs.alive).toBeCloseTo(1 / 3);
    }
  });
});

describe('E21.5: gates', () => {
  it('revealed regions are sealed, and their seal says what is in the way (nothing is bought)', () => {
    const sim = tier1();
    expect(sim.areas.sealed('mastRow')).toBe(true);
    expect(sim.areas.sealText('mastRow')).toBe('Mast Row is overgrown. Wake the fountain and Bloombot will learn to prune a way through.');
    expect(sim.areas.sealed('saltwind')).toBe(false); // the beach is open from the start
  });

  it('a barricade refuses without Pry and opens with it, its region and the backstreets beside it', () => {
    const sim = tier1();
    const g = region('mastRow').gate;
    expect(sim.gates.problem(g)).toBe('A dead hedge blocks the way. Wake the fountain and Bloombot will learn to prune a way through.');
    expect(sim.gates.open(g.id)).toBe(false);
    sim.state.salvage!.abilities.push('prune');
    green(sim, PARK, 0.5);
    expect(sim.gates.open(g.id)).toBe(true);
    expect(sim.areas.sealed('mastRow')).toBe(false);
    expect(sim.areas.fog('bs_2_-1')).not.toBe('hidden');
    for (const [x, z] of g.cells) expect(sim.grid.get(GROUND, x, z)!.blocked).toBe(false);
    expect(sim.areas.sealed('oldMarket')).toBe(true);
  });

  it('the beach\'s barricade opens the boardwalk but no region', () => {
    const sim = tier1();
    sim.state.salvage!.abilities.push('prune');
    const g = region('saltwind').gate;
    green(sim, 'saltwind', 0.5);
    expect(sim.gates.open(g.id)).toBe(true);
    expect(sim.gates.isOpen(g.id)).toBe(true);
    expect(sim.areas.sealed('mastRow')).toBe(true);
  });

  it('deep water needs Hover; the lock bridge rises when the Sea Lock wakes', () => {
    const sim = tier1();
    const water = region('cistern').gate;
    expect(sim.gates.problem(water)).toMatch(/hover/);
    sim.state.salvage!.abilities.push('hover');
    expect(sim.gates.problem(water)).toBeUndefined();
    const sim2 = tier1();
    const lock = region('clockPlaza').gate;
    expect(sim2.gates.problem(lock)).toMatch(/the lock down on the beach/);
    sim2.bus.emit('landmark.woken', { region: 'saltwind' });
    expect(sim2.gates.isOpen(lock.id)).toBe(true);
  });

  it('the broken bridge is a repair delivery; climb and cliff gates need their abilities', () => {
    const sim = tier1();
    const bridge = region('glasshouse').gate;
    expect(sim.gates.problem(bridge)).toMatch(/mend it/);
    sim.bot = { roofId: GROUND, x: -30, z: 0 };
    sim.inventory.add('timber', 30);
    sim.inventory.add('copper', 20);
    sim.inventory.add('gears', 10);
    expect(sim.gates.open(bridge.id)).toBe(true);
    expect(sim.inventory.count('timber')).toBe(0);
    expect(sim.gates.problem(region('terraces').gate)).toMatch(/climb/);
    expect(sim.gates.problem(region('observatory').gate)).toMatch(/glide/i);
    expect(sim.gates.problem(region('spireHeights').gate)).toMatch(/climb/);
  });

  it('opened gates stay open after reload, byte for byte', () => {
    const sim = tier1(21);
    sim.state.salvage!.abilities.push('prune');
    green(sim, PARK, 0.5);
    sim.gates.open(region('mastRow').gate.id);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(back.gates.isOpen('g-mastRow')).toBe(true);
    expect(back.areas.sealed('mastRow')).toBe(false);
    expect(back.grid.get(GROUND, 7, -1)!.blocked).toBe(false);
    expect(saver.serialize(back.state)).toBe(json);
  });

  it('bloombot can never stand in a sealed region', () => {
    const sim = tier1();
    const w = new Walker(sim);
    for (const [x, z] of [[8, -5], [20, 8], [-8, 8]]) expect(w.walkable(GROUND, x, z), `${x},${z}`).toBe(false);
    const p = { roofId: GROUND, x: 8.5, z: 0.5, facing: Math.PI };
    for (let i = 0; i < 30; i++) w.move(p, 0, -0.1);
    expect(p.z).toBeGreaterThanOrEqual(0);
  });
});

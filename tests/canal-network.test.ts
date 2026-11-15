import { big } from '../src/core/Big';
import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { CHUNK } from '../src/core/Hash';
import type { MachineData, TileData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

/** A cleared canal area whose water row (local z 3–4) runs the width of one of its chunks. */
function canalCity(seed = 2) {
  for (let sd = seed; sd < seed + 40; sd++) {
    const sim = new Sim(createInitialState(sd));
    const st = sim.state;
    st.caps.energy = big(1e7); st.caps.water = big(1e7);
    st.resources.energy = big(1e6); st.resources.water = big(1e6); st.resources.biomass = big(1e6);
    st.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    for (let r = 1; r <= 4; r++)
      for (let cz = -r; cz <= r; cz++)
        for (let cx = -r; cx <= r; cx++) {
          const id = sim.areas.map.areaOfChunk(cx, cz);
          if (id === PARK || sim.areas.info(id).type !== 'canal') continue;
          sim.areas.reveal(id);
          sim.areas.clear(id, true);
          const water = (lx: number) => sim.grid.get(GROUND, cx * CHUNK + lx, cz * CHUNK + 3)!;
          if (![0, 15].every((lx) => water(lx).feature === 'water')) continue;
          return { sim, id, x0: cx * CHUNK, z0: cz * CHUNK };
        }
  }
  throw new Error('no canal area');
}

function clean(t: TileData) {
  t.ground = 'restored';
  t.bloom = 1;
  t.pollution = 0;
}

/** Restores the canal row between two local x (inclusive), both water lanes. */
function cleanCanal(sim: Sim, x0: number, z0: number, from: number, to: number) {
  for (let lx = from; lx <= to; lx++)
    for (const lz of [3, 4]) {
      const t = sim.grid.get(GROUND, x0 + lx, z0 + lz)!;
      clean(t);
      sim.grid.touch(t);
    }
}

function place(sim: Sim, type: MachineData['type'], x: number, z: number): MachineData {
  const t = sim.grid.get(GROUND, x, z)!;
  t.blocked = false;
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  t.occupantId = m.id;
  return m;
}

/** Ground around a garden in full bloom: nothing left for a spill to water. */
function lushAround(sim: Sim, g: MachineData) {
  for (const t of sim.grid.tilesNear(g, TUNING.neighbourhood.reservoir.radius + 1)) {
    if (t.occupantId || t.blocked || t.feature === 'water') continue;
    t.ground = 'restored';
    t.bloom = TUNING.restore.maxBloom;
    t.pollution = 0;
    sim.grid.touch(t);
  }
}

/** Dry ground around a garden so its spill has something to water. */
function dryAround(sim: Sim, g: MachineData) {
  for (const t of sim.grid.tilesNear(g, TUNING.neighbourhood.reservoir.radius)) {
    if (t.occupantId || t.blocked || t.feature === 'water') continue;
    t.ground = 'prepared';
    t.bloom = 0;
    t.pollution = 0;
    sim.grid.touch(t);
  }
}

describe('canal water network (City 10.3)', () => {
  it('clean canal water links the gardens and condensers on its banks; dirty water or a gap does not', () => {
    const { sim, x0, z0 } = canalCity();
    const a = place(sim, 'reservoirGarden', x0 + 1, z0 + 5);
    const b = place(sim, 'reservoirGarden', x0 + 14, z0 + 5);
    const c = place(sim, 'condenser', x0 + 8, z0 + 2);
    expect(sim.canals.of(a)).toBeUndefined(); // the canal is still polluted
    cleanCanal(sim, x0, z0, 0, 5);
    cleanCanal(sim, x0, z0, 11, 15);
    expect(sim.canals.connected(a, b)).toBe(false); // a gap at x 6–10
    expect(sim.canals.of(c)).toBeUndefined(); // c's bank is in the gap
    cleanCanal(sim, x0, z0, 6, 10);
    expect(sim.canals.connected(a, b)).toBe(true);
    expect(sim.canals.connected(a, c)).toBe(true);
    const net = sim.canals.of(a)!;
    expect(net.gardens.map((g) => g.id)).toEqual([a.id, b.id].sort());
    expect(net.condensers.map((g) => g.id)).toEqual([c.id]);
    // The path runs along the water from bank to bank.
    const path = sim.canals.path(a, b);
    expect(path.length).toBeGreaterThanOrEqual(12);
    for (const id of path) expect(net.tiles.has(id)).toBe(true);
  });

  it('a condenser on the canal fills the emptiest garden on the network', () => {
    const { sim, x0, z0 } = canalCity();
    cleanCanal(sim, x0, z0, 0, 15);
    const a = place(sim, 'reservoirGarden', x0 + 1, z0 + 5);
    const b = place(sim, 'reservoirGarden', x0 + 14, z0 + 5);
    const c = place(sim, 'condenser', x0 + 8, z0 + 2);
    a.charge = 2;
    const flows: string[] = [];
    sim.bus.on('canal.flow', (e) => flows.push(`${e.kind}:${e.from}>${e.to}:${e.path.length > 0}`));
    c.charge = TUNING.condenser.threshold;
    sim.advance(0.1);
    expect(b.charge).toBe(TUNING.neighbourhood.reservoir.fillPerCharge);
    expect(a.charge).toBe(2);
    expect(flows[0]).toBe(`fill:${c.id}>${b.id}:true`);
  });

  it('a full basin also spills at one other connected garden, chosen deterministically, once per chain', () => {
    const run = () => {
      const { sim, x0, z0 } = canalCity();
      cleanCanal(sim, x0, z0, 0, 15);
      const a = place(sim, 'reservoirGarden', x0 + 1, z0 + 5);
      const b = place(sim, 'reservoirGarden', x0 + 7, z0 + 5);
      const c = place(sim, 'reservoirGarden', x0 + 13, z0 + 5);
      lushAround(sim, a);
      lushAround(sim, b);
      dryAround(sim, c); // c has the most dry ground: it gets the spill
      const overflows: string[] = [];
      sim.bus.on('reservoir.overflow', (e) => overflows.push(e.machineId));
      const flows: string[] = [];
      sim.bus.on('canal.flow', (e) => flows.push(`${e.from}>${e.to}`));
      b.charge = 1;
      c.charge = 2;
      a.charge = TUNING.neighbourhood.reservoir.threshold;
      sim.advance(5);
      return { sim, a, b, c, overflows, flows };
    };
    const r = run();
    expect(r.overflows).toEqual([r.a.id, r.c.id]);
    expect(r.flows).toEqual([`${r.a.id}>${r.c.id}`]);
    expect(r.a.charge).toBe(0); // the source emptied…
    expect(r.c.charge).toBe(2); // …the receiving basin keeps its own water
    expect(r.b.charge).toBe(1);
    // Same city, same choice.
    const again = run();
    expect(again.flows).toEqual(r.flows);
  });

  it('with ten gardens on one canal, every chain crosses at most once and nothing loops', () => {
    const { sim, x0, z0 } = canalCity();
    cleanCanal(sim, x0, z0, 0, 15);
    const gardens = [1, 3, 5, 7, 9, 11, 13].map((lx) => place(sim, 'reservoirGarden', x0 + lx, z0 + 5)).concat([2, 6, 10].map((lx) => place(sim, 'reservoirGarden', x0 + lx, z0 + 2)));
    expect(sim.canals.of(gardens[0])!.gardens).toHaveLength(10);
    for (const g of gardens) g.charge = TUNING.neighbourhood.reservoir.threshold; // every basin full at once
    const perChain = new Map<number, string[]>();
    let overflows = 0;
    sim.bus.on('reservoir.overflow', () => overflows++);
    sim.bus.on('canal.flow', (e) => {
      if (e.kind !== 'overflow') return;
      const list = perChain.get(e.chainId!) ?? [];
      list.push(`${e.from}>${e.to}`);
      perChain.set(e.chainId!, list);
    });
    sim.advance(20);
    expect(perChain.size).toBe(10); // each garden's own spill is a chain, and each crosses the canal once
    for (const list of perChain.values()) expect(list).toHaveLength(1);
    expect(overflows).toBe(20); // 10 own spills + 10 routed, no more
    expect(sim.chains.activeRuns).toBe(0);
    for (const g of gardens) expect(g.charge).toBe(0);
  });
});

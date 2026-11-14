import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { AreaMap, PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import { Grid } from '../src/core/Grid';
import type { MachineData } from '../src/core/types';
import { CITY_GEN } from '../src/data/city';
import { ROOF_TEMPLATES as ROOF_BY_ID } from '../src/data/templates';
import { Sim } from '../src/gameplay/Sim';

const saver = new SaveService(undefined);

function city(seed: number) {
  const sim = new Sim(createInitialState(seed));
  const st = sim.state;
  st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
  st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
  st.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  return sim;
}

/** The nearest rooftop-cluster area to the park. */
function nearestCluster(map: AreaMap): string | undefined {
  for (let r = 1; r <= 10; r++)
    for (let cz = -r; cz <= r; cz++)
      for (let cx = -r; cx <= r; cx++) {
        const id = map.areaOfChunk(cx, cz);
        if (map.rooftop(id)) return id;
      }
  return undefined;
}

/** A cluster area revealed the honest way (a neighbour cleared), and its sim. */
function revealedCluster(seed = 1) {
  for (let s = seed; s < seed + 20; s++) {
    const sim = city(s);
    const id = nearestCluster(sim.areas.map);
    if (!id) continue;
    sim.areas.clear(sim.areas.info(id).neighbours.find((n) => n !== id)!, true);
    if (sim.areas.fog(id) !== 'hidden') return { sim, id };
  }
  throw new Error('no cluster');
}

function machine(sim: Sim, type: MachineData['type'], roofId: string, x: number, z: number, size = 1) {
  const t = sim.grid.get(roofId, x, z)!;
  t.blocked = false;
  const m: MachineData = { id: sim.newId('m'), type, roofId, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  for (const c of sim.grid.footprint(roofId, x, z, size)) if (c) c.occupantId = m.id;
  sim.bus.emit('machine.built', { machine: m });
  return m;
}

describe('rooftop cluster areas (City 12.1)', () => {
  it('generation 3 places a few rooftop clusters on streets, plazas and markets away from the park; older generations none', () => {
    let found = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g3 = new AreaMap(seed, 3);
      const g2 = new AreaMap(seed, 2);
      const seen = new Set<string>();
      let clusters = 0;
      for (let cz = -10; cz <= 10; cz++)
        for (let cx = -10; cx <= 10; cx++) {
          const id = g3.areaOfChunk(cx, cz);
          if (seen.has(id)) continue;
          seen.add(id);
          const a3 = g3.info(id);
          const a2 = g2.info(id);
          expect(a2.type).not.toBe('rooftops');
          if (a3.type !== 'rooftops') {
            expect(a3.type).toBe(a2.type); // nothing else changes
            continue;
          }
          clusters++;
          expect(CITY_GEN.rooftops.from).toContain(a2.type);
          expect(a3.distance).toBeGreaterThanOrEqual(CITY_GEN.rooftops.minDistance);
          // The roof's Core stands right over the landmark cell, and the roof sits on the landmark's chunk.
          const r = g3.rooftop(id)!;
          expect(r.x + r.core[0]).toBe(a3.landmark[0]);
          expect(r.z + r.core[1]).toBe(a3.landmark[1]);
          expect(Math.floor(r.x / 16)).toBe(Math.floor((r.x + r.width - 1) / 16));
          expect(ROOF_BY_ID[r.template]).toBeDefined();
        }
      expect(clusters / seen.size).toBeLessThan(0.15);
      found += clusters;
    }
    expect(found).toBeGreaterThan(6);
  });

  it('the ground under a roof is the building holding it up (roads and canals run on underneath)', () => {
    const seed = 2;
    const g = new Grid(seed, createInitialState(seed).layers);
    const map = new AreaMap(seed, 3);
    const id = nearestCluster(map)!;
    const r = map.rooftop(id)!;
    for (let z = r.z; z < r.z + r.depth; z++)
      for (let x = r.x; x < r.x + r.width; x++) {
        const t = g.get(GROUND, x, z)!;
        if (t.feature === 'road' || t.feature === 'water') expect(t.blocked).toBe(false);
        else expect(t.feature).toBe('building');
      }
  });

  it('revealing a cluster adds its roof; a Bloom Relay in range reaches it, one out of range does not', () => {
    const { sim, id } = revealedCluster(1);
    const roof = sim.clusters.roof(id)!;
    expect(roof).toBeDefined();
    expect(sim.state.layers.some((l) => l.id === roof.id)).toBe(true);
    expect(sim.grid.isPlayable(roof.id)).toBe(false);
    // The landmark is the roof's Core, and roof machines belong to the area.
    const lm = sim.areas.landmark(id)!;
    expect(lm.roofId).toBe(roof.id);
    expect(sim.areas.areaOf(lm)).toBe(id);
    // A relay far away doesn't reach it.
    const far = sim.areas.tiles(PARK).find((t) => !t.blocked && !t.occupantId && Math.hypot(t.x - roof.origin[0], t.z - roof.origin[2]) > 30);
    if (far) {
      machine(sim, 'relay', GROUND, far.x, far.z);
      expect(sim.grid.isPlayable(roof.id)).toBe(false);
    }
    // One right next to the roof does.
    const near = sim.clusters.relaySpots(id)[0];
    const unlocked: string[] = [];
    sim.bus.on('layer.unlocked', ({ layerId }) => unlocked.push(layerId));
    machine(sim, 'relay', GROUND, near.x, near.z);
    expect(sim.grid.isPlayable(roof.id)).toBe(true);
    expect(unlocked).toEqual([roof.id]);
    // Roof tiles can be restored now, at the template's cost scaled by the area's distance.
    const t = sim.grid.tilesOf(roof.id).find((x) => !x.blocked && !x.occupantId && x.ground !== 'restored')!;
    expect(sim.restoration.checkPulse(t).ok).toBe(true);
    const mult = (ROOF_BY_ID[roof.template!].pulseCostMult ?? 1) * sim.areas.info(id).difficulty;
    expect(sim.restoration.pulseCost(t).water).toBe(Math.ceil((t.ground === 'prepared' ? 1 : 1) * mult));
  });

  it('is playable end to end: reach the roof, restore it, restore the share, wake the Rooftop Core', () => {
    const { sim, id } = revealedCluster(3);
    const hub = sim.clusters.relaySpots(id).find((t) => sim.grid.footprint(GROUND, t.x, t.z, 2).every((c) => c && !c.blocked && !c.occupantId))!;
    machine(sim, 'droneHub', GROUND, hub.x, hub.z, 2);
    for (let i = 0; i < 900 && !sim.milestones.specialty(id).met; i++) {
      const st = sim.state.resources;
      st.energy = st.water = st.biomass = 1e6;
      const step = sim.advisor.specialtyStep(id);
      if (step?.action.kind === 'build') sim.build.place(step.action.type, GROUND, step.action.x, step.action.z);
      else if (step?.action.kind === 'focus') sim.restoration.pulse(sim.grid.get(step.action.layer ?? GROUND, step.action.x, step.action.z)!.id);
      else {
        const e = sim.areas.entryTiles(id).find((t) => sim.restoration.checkPulse(t).ok);
        if (e) sim.restoration.pulse(e.id);
      }
      sim.advance(1);
    }
    expect(sim.milestones.specialty(id).met).toBe(true);
    expect(sim.clusters.counts(id).restored).toBeGreaterThanOrEqual(sim.milestones.specialty(id).need);
    // The share on the ground, then the wake.
    for (const t of sim.areas.tiles(id)) {
      if (!isRestorable(t, sim.state.machines) || t.ground === 'restored' || sim.areas.counts(id).restored >= sim.areas.need(id)) continue;
      t.ground = 'restored';
      t.bloom = 1;
      sim.grid.touch(t);
    }
    expect(sim.areas.ready(id)).toBe(true);
    expect(sim.areas.clear(id)).toBe(true);
    expect(sim.areas.fog(id)).toBe('cleared');
  });

  it('roofs, their reach and their tiles survive a reload; old saves stay on their generation', () => {
    const { sim, id } = revealedCluster(5);
    const roof = sim.clusters.roof(id)!;
    const near = sim.clusters.relaySpots(id)[0];
    machine(sim, 'relay', GROUND, near.x, near.z);
    const t = sim.grid.tilesOf(roof.id).find((x) => !x.blocked && !x.occupantId)!;
    sim.restoration.complete(t, 'pulse');
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.grid.isPlayable(roof.id)).toBe(true);
    expect(copy.grid.get(roof.id, t.x, t.z)!.ground).toBe('restored');
    expect(copy.areas.landmark(id)!.roofId).toBe(roof.id);
    expect(copy.grid.rooftops).toEqual([]); // city roofs are not campaign rooftops
    // A generation-2 save never grows clusters.
    const old = createInitialState(5);
    old.layers[0].gen = 2;
    const oldSim = new Sim(old);
    expect(nearestCluster(oldSim.areas.map)).toBeUndefined();
  });
});

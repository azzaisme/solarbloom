import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';
import { TUNING } from '../src/data/tuning';

const saver = new SaveService(undefined);
const N = TUNING.district.minAwake;

function setup(seed = 8) {
  const sim = new Sim(createInitialState(seed));
  const st = sim.state;
  st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
  st.resources.energy = st.resources.water = st.resources.biomass = 1000;
  st.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  return sim;
}

/** Clears `n` areas of the park's district as one connected group, growing outward from the park. */
function clearConnected(sim: Sim, n: number): string {
  const d = sim.districts.districtOf(PARK);
  const members = new Set(sim.districts.members(d));
  const done = [PARK];
  while (done.length < n) {
    const next = done.flatMap((a) => sim.areas.info(a).neighbours).find((a) => members.has(a) && !done.includes(a));
    if (!next) throw new Error('district too small');
    sim.areas.clear(next, true);
    done.push(next);
  }
  return d;
}

/** A machine standing in a cleared district area. */
function placeMachine(sim: Sim, areaId: string): MachineData {
  const t = sim.areas.tiles(areaId).find((t) => !t.blocked && !t.occupantId)!;
  const m: MachineData = { id: sim.newId('m'), type: 'solar', roofId: GROUND, x: t.x, z: t.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  t.occupantId = m.id;
  return m;
}

describe('district-wide blooms (City 10.7)', () => {
  it('membership is static and complete: every area of a district has its landmark in it', () => {
    const sim = setup();
    const d = sim.districts.districtOf(PARK);
    const members = sim.districts.members(d);
    expect(members).toContain(PARK);
    expect(members.length).toBeGreaterThan(N);
    for (const a of members) expect(sim.districts.districtOf(a)).toBe(d);
    expect(new Sim(createInitialState(8)).districts.members(d)).toEqual(members);
  });

  it('becomes available only with enough neighbouring landmarks awake', () => {
    const sim = setup();
    const ready: string[] = [];
    sim.bus.on('district.ready', ({ districtId }) => ready.push(districtId));
    const d = clearConnected(sim, N - 1);
    expect(sim.districts.awakeGroup(d)).toBe(N - 1);
    expect(sim.districts.available(d)).toBe(false);
    expect(sim.districts.bloom(d)).toBe(false);
    expect(sim.state.districts).toBeUndefined();
    clearConnected(sim, N);
    expect(sim.districts.available(d)).toBe(true);
    expect(sim.districts.ready()).toContain(d);
    expect(ready).toEqual([d]);
  });

  it('scattered landmarks that are not neighbours do not count', () => {
    const sim = setup();
    const d = sim.districts.districtOf(PARK);
    const picked: string[] = [];
    for (const a of sim.districts.members(d)) {
      if (a === PARK || sim.areas.info(PARK).neighbours.includes(a)) continue;
      if (picked.some((p) => sim.areas.info(p).neighbours.includes(a))) continue;
      picked.push(a);
    }
    expect(picked.length).toBeGreaterThanOrEqual(N - 1);
    for (const a of picked) sim.areas.clear(a, true);
    expect(sim.districts.awakeGroup(d)).toBe(1);
    expect(sim.districts.available(d)).toBe(false);
  });

  it('pays once, makes the district lusher and never touches a machine', () => {
    const sim = setup();
    const d = clearConnected(sim, N);
    const area = sim.districts.members(d).find((a) => a !== PARK && sim.areas.fog(a) === 'cleared')!;
    placeMachine(sim, area);
    // Some restored ground to grow lusher.
    const tiles = sim.areas.tiles(area).filter((t) => !t.occupantId && isRestorable(t, sim.state.machines));
    for (const t of tiles.slice(0, 20)) {
      t.ground = 'restored';
      t.bloom = 1;
      t.pollution = 0;
      sim.grid.touch(t);
    }
    const machinesBefore = JSON.stringify(sim.state.machines);
    const occupied = sim.areas.tiles(area).filter((t) => t.occupantId).map((t) => `${t.id}:${t.ground}:${t.bloom}`);
    const before = { ...sim.state.resources };
    const expected = sim.districts.reward();

    expect(sim.districts.bloom(d)).toBe(true);
    expect(JSON.stringify(sim.state.machines)).toBe(machinesBefore);
    expect(sim.areas.tiles(area).filter((t) => t.occupantId).map((t) => `${t.id}:${t.ground}:${t.bloom}`)).toEqual(occupied);
    for (const t of tiles.slice(0, 20)) expect(t.bloom).toBe(2);
    for (const t of tiles) expect(t.ground).toBe('restored');
    expect(sim.state.resources.energy - before.energy).toBe(expected.energy);
    expect(sim.state.resources.biomass - before.biomass).toBe(expected.biomass);
    // Areas still in fog are not touched.
    for (const a of sim.districts.members(d)) if (sim.areas.fog(a) !== 'cleared') expect(sim.areas.tiles(a).every((t) => t.ground !== 'restored' || t.bloom <= 1)).toBe(true);

    // Never again, not even after a reload.
    const paid = { ...sim.state.resources };
    expect(sim.districts.bloom(d)).toBe(false);
    expect(sim.state.resources).toEqual(paid);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.districts.claimed(d)).toBe(true);
    expect(copy.districts.available(d)).toBe(false);
    expect(copy.districts.ready()).not.toContain(d);
    expect(copy.districts.bloom(d)).toBe(false);
    expect(copy.state.resources).toEqual(paid);
  });

  it('a replay changes nothing and pays nothing', () => {
    const sim = setup();
    const d = clearConnected(sim, N);
    expect(sim.districts.replay(d)).toBe(false); // nothing to replay yet
    sim.districts.bloom(d);
    const saved = saver.serialize(sim.state);
    const events: boolean[] = [];
    sim.bus.on('district.bloom', (e) => events.push(e.replay));
    expect(sim.districts.replay(d)).toBe(true);
    expect(sim.districts.replay(d)).toBe(true);
    expect(events).toEqual([true, true]);
    expect(saver.serialize(sim.state)).toBe(saved);
  });

  it('each later district bloom pays a little more', () => {
    const sim = setup();
    const first = sim.districts.reward();
    sim.state.districts = { dX: 0 };
    expect(sim.districts.reward().biomass).toBeGreaterThan(first.biomass);
  });

  it('the rooftop campaign has no district blooms', () => {
    const sim = new Sim(createInitialState(3, { rooftops: true }));
    expect(sim.districts.ready()).toEqual([]);
  });
});

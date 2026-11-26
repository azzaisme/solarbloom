import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { KEEPERS, REGIONS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);
const MAST = REGIONS[0];

function mastRow(seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.state.salvage!.tier = 2;
  sim.state.salvage!.abilities.push('pry', 'hover');
  sim.areas.clear('park', true);
  sim.gates.open('g-mastRow');
  return sim;
}
/** A Drone Hub standing in Mast Row, placed as a save would hold it. */
function hub(sim: Sim, x = 12, z = -12): MachineData {
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const t = sim.grid.get(GROUND, x + dx, z + dz)!;
    t.ground = 'restored';
    t.blocked = false;
    sim.grid.touch(t);
  }
  const m: MachineData = { id: sim.newId('m'), type: 'droneHub', roofId: GROUND, x, z, size: 2, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  for (const t of sim.grid.footprint(GROUND, x, z, 2)) if (t) t.occupantId = m.id;
  sim.grid.indexMachine(m);
  sim.drones.spawn(m);
  // E23.3.3: helpers run on the grid. Two solar panels touching the hub power it (a clear day without E23.7).
  for (const sx of [x + 2, x + 3]) {
    const t = sim.grid.get(GROUND, sx, z)!;
    t.ground = 'restored';
    t.blocked = false;
    const p: MachineData = { id: sim.newId('m'), type: 'solar', roofId: GROUND, x: sx, z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(p);
    t.occupantId = p.id;
    sim.grid.indexMachine(p);
  }
  // E23.6.3: a restorer runs on Biomass from a Storage chest beside its hub
  const ct = sim.grid.get(GROUND, x, z + 2)!;
  Object.assign(ct, { ground: 'restored', blocked: false });
  const chest: MachineData = { id: sim.newId('m'), type: 'chest', roofId: GROUND, x, z: z + 2, size: 1, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(chest);
  ct.occupantId = chest.id;
  sim.grid.indexMachine(chest);
  sim.inventory.addToStore('biomass', 100);
  return m;
}
const mastRestored = (sim: Sim) => sim.areas.counts('mastRow').restored;

describe('E21.9: bloombot first', () => {
  it('helpers do nothing in a fresh region, and start once bloombot has done its share', () => {
    const sim = mastRow();
    hub(sim);
    const before = mastRestored(sim);
    sim.advance(60);
    expect(mastRestored(sim)).toBe(before);
    expect(sim.areas.helpersMayWork('mastRow')).toBe(false);
    // bloombot's own pulses count toward the share
    const target = sim.areas.shareTarget('mastRow');
    expect(target).toBe(Math.ceil(Math.ceil(sim.areas.counts('mastRow').restorable / 2) / 4));
    let n = 0;
    // nearest the hub first, so its helper has dead ground in reach once the share is met
    const spots: [number, number][] = [];
    for (let z = -30; z < -2; z++) for (let x = 1; x < 30; x++) spots.push([x, z]);
    spots.sort((a, b) => (a[0] - 12) ** 2 + (a[1] + 12) ** 2 - ((b[0] - 12) ** 2 + (b[1] + 12) ** 2));
    for (const [x, z] of spots) {
      if ((sim.state.areas.mastRow.byBot ?? 0) >= target) break;
      const t = sim.grid.get(GROUND, x, z)!;
      sim.charge.sleep(); // E23.2.1: kept topped up (this test is about the share, not the charge)
      if (!sim.restoration.checkPulse(t).ok || t.ground === 'restored') continue;
      sim.restoration.pulse(t.id);
      sim.advance(2);
      n++;
    }
    expect(sim.state.areas.mastRow.byBot).toBeGreaterThanOrEqual(target);
    expect(sim.areas.helpersMayWork('mastRow')).toBe(true);
    let helped = 0;
    sim.bus.on('tile.restored', ({ tile, source }) => {
      if (source === 'drone' && sim.areas.areaOf(tile) === 'mastRow') helped++;
    });
    sim.advance(60);
    expect(helped).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(0);
    // drone work never counts as bloombot's
    const byBot = sim.state.areas.mastRow.byBot;
    sim.advance(30);
    expect(sim.state.areas.mastRow.byBot).toBe(byBot);
  }, 30_000);

  it('helpers never wake a landmark: a fully restored region waits for bloombot\'s delivery', () => {
    const sim = mastRow();
    for (const t of sim.areas.tiles('mastRow')) if (!t.blocked && !t.occupantId) sim.restoration.complete(t, 'drone');
    expect(sim.areas.fog('mastRow')).not.toBe('cleared');
    expect(sim.areas.ready('mastRow')).toBe(false); // the Pylon has not asked yet
    sim.state.salvage!.keepers.pylon = { step: 'landmark' };
    // #787: and its works (the Signal Mast's junction box) must run: helpers never start them either
    expect(sim.areas.ready('mastRow')).toBe(false);
    sim.works.start('mastRow');
    expect(sim.areas.ready('mastRow')).toBe(true);
    sim.advance(30);
    expect(sim.areas.fog('mastRow')).not.toBe('cleared');
    // bloombot hands over the delivery at the mast (from the store: a woken fountain is a way in only nearby)
    sim.bot = { roofId: GROUND, x: MAST.landmark.x + 0.5, z: MAST.landmark.z + 2.5 };
    sim.inventory.add('copper', 12);
    expect(sim.landmarks.interact('mastRow')).toBe('gave');
    sim.inventory.add('copper', 8);
    sim.inventory.add('scrap', 10);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(back.state)).toBe(json);
    back.bot = sim.bot;
    expect(back.landmarks.interact('mastRow')).toBe('woke');
    expect(back.areas.fog('mastRow')).toBe('cleared');
    expect(back.keepers.step('pylon')).toBe('settled');
    // a woken landmark is a way into the store (E23.7.4 dropped the Reclaimer its seam used to take)
    expect(back.inventory.nearStore(back.bot)).toBe(true);
    expect(back.salvage.woken(MAST)).toBe(true);
    expect(back.areas.helpersMayWork('mastRow')).toBe(true);
  });

  it('each of the ten lasting rewards takes effect', () => {
    const sim = mastRow();
    const wake = (region: string) => {
      const r = REGIONS.find((q) => q.id === region)!;
      sim.state.areas[region] = { fog: 'thinning', revealedAt: 0 };
      for (const t of sim.areas.tiles(region)) if (!t.blocked && !t.occupantId) { t.ground = 'restored'; t.bloom = 1; t.pollution = 0; sim.grid.touch(t); }
      sim.state.salvage!.keepers[r.keeper] = { step: 'landmark' };
      sim.works.start(region); // #787: its works run (tests/region-works.test.ts builds them for real)
      sim.bot = { roofId: GROUND, x: r.landmark.x + 0.5, z: r.landmark.z - 0.5 };
      for (const [k, v] of Object.entries(KEEPERS.find((q) => q.id === r.keeper)!.landmark)) sim.inventory.addToStore(k as 'scrap', v!), sim.inventory.withdraw(k as 'scrap', v!);
      expect(sim.landmarks.interact(region), region).toBe('woke');
    };
    // Mast Row: every landmark beacon on the minimap
    wake('mastRow');
    expect(sim.landmarks.has('beacons')).toBe(true);
    // Old Market: Tally trades 3 for 1
    expect(sim.landmarks.trade('scrap', 'glass')).toBe(false);
    wake('oldMarket');
    sim.inventory.add('scrap', 3);
    expect(sim.landmarks.trade('scrap', 'glass')).toBe(true);
    expect(sim.inventory.count('glass')).toBeGreaterThanOrEqual(1);
    // Saltwind Beach: the lock bridge to Clock Plaza rises
    wake('saltwind');
    expect(sim.gates.isOpen('g-clockPlaza')).toBe(true);
    // Elder Grove: loose Seeds give double
    wake('elderGrove');
    const seeds = sim.inventory.count('seeds');
    sim.salvage.salvage('pk-e1');
    expect(sim.inventory.count('seeds') - seeds).toBe(6);
    // Cistern Basin: Water Condensers fill twice as fast (E23.1.4: no water store left to double)
    expect(sim.landmarks.condenserMult()).toBe(1);
    wake('cistern');
    expect(sim.landmarks.condenserMult()).toBe(2);
    // Clock Plaza: helpers 25% faster
    const h = sim.upgrades.droneSpeed(undefined);
    wake('clockPlaza');
    expect(sim.upgrades.droneSpeed(undefined)).toBeCloseTo(h * 1.25, 6);
    // The Terraces: batteries hold twice as much (E23.1.4: the grid's batteries, not an energy counter)
    expect(sim.landmarks.batteryMult()).toBe(1);
    wake('terraces');
    expect(sim.landmarks.batteryMult()).toBe(2);
    // Glasshouse Gardens: the Heart Seed; Observatory Hill: the Star Lens (and caches on the map); Spire Heights: lifts
    wake('glasshouse');
    expect(sim.state.salvage!.items).toContain('heartSeed');
    wake('observatory');
    expect(sim.state.salvage!.items).toContain('starLens');
    expect(sim.landmarks.has('starLens')).toBe(true);
    wake('spireHeights');
    expect(sim.landmarks.has('lifts')).toBe(true);
    expect(sim.fountain.landmarksAwake()).toBe(10);
  });
});

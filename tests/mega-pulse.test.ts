import { describe, expect, it, vi } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { wakeNextArea } from './helpers';

function city(seed = 6) {
  const sim = new Sim(createInitialState(seed));
  const st = sim.state;
  st.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  return sim;
}

const deadTiles = (sim: Sim) => sim.areas.tiles(PARK).filter((t) => sim.restoration.isEligible(t));

describe('Mega Pulse and scaled Overcharge (City 11.5)', () => {
  it('manual taps charge the meter, and a Mega Pulse restores the previewed ground all round', () => {
    const sim = city();
    let ready = 0;
    let released = 0;
    sim.bus.on('mega.ready', () => ready++);
    sim.bus.on('mega.released', () => released++);
    for (let i = 0; i < TUNING.mega.charge; i++) {
      expect(sim.restoration.megaReady()).toBe(false);
      expect(sim.restoration.pulse(deadTiles(sim)[0].id)).toBe(true);
    }
    expect(sim.restoration.megaReady()).toBe(true);
    expect(ready).toBe(1);
    sim.advance(3);
    const combos: { combo: number; starter: string }[] = [];
    sim.bus.on('chain.ended', (e) => combos.push(e));
    const tap = deadTiles(sim)[5];
    expect(sim.restoration.pulse(tap.id)).toBe(true);
    expect(sim.restoration.megaReady()).toBe(true);
    expect(released).toBe(0);
    sim.advance(3);
    const { origin, targets } = deadTiles(sim).map(origin => ({ origin, targets: sim.restoration.megaTargets(origin) })).sort((a, b) => b.targets.length - a.targets.length)[0];
    // VFX 1: a circle round where Bloombot stands, nearest first, its depth the distance in whole tiles
    const dist = ({ tile }: { tile: { x: number; z: number } }) => Math.hypot(tile.x - origin.x, tile.z - origin.z);
    for (let i = 1; i < targets.length; i++) expect(dist(targets[i])).toBeGreaterThanOrEqual(dist(targets[i - 1]));
    for (const t of targets) expect(t.depth).toBe(Math.round(dist(t)));
    expect(targets.some(({ tile }) => tile.z < origin.z)).toBe(true);
    expect(targets.some(({ tile }) => tile.z > origin.z)).toBe(true);
    const wave = new Set<string>();
    sim.bus.on('tile.restored', ({ tile, source }) => { if (source === 'mega') wave.add(tile.id); });
    expect(sim.restoration.playerPulse(origin.id, targets)).toBe(true);
    expect(released).toBe(1);
    expect(sim.state.progression.megaCharge).toBe(0);
    sim.advance(30);
    const big = combos.reduce((a, e) => (e.combo > a.combo ? e : a), { combo: 0, starter: '' });
    expect(big.combo).toBeGreaterThanOrEqual(20);
    expect(big.combo).toBeLessThanOrEqual(sim.restoration.megaBudget() + 40); // budget plus what it sets off
    expect(big.starter).toBe('player');
    expect(origin.ground).toBe('restored');
    expect(wave).toEqual(new Set(targets.map(({ tile }) => tile.id)));
  });

  it('blocks another pulse or tree nurture until the cooldown expires', () => {
    const sim = city();
    const tile = deadTiles(sim)[0];
    sim.restoration.complete(tile, 'drone', undefined, true);
    expect(sim.restoration.playerPulse(tile.id)).toBe(true);
    const bloom = tile.bloom;
    expect(sim.restoration.playerPulse(tile.id)).toBe(false);
    expect(tile.bloom).toBe(bloom);
    sim.advance(TUNING.mega.cooldown + 0.1);
    expect(sim.restoration.playerPulse(tile.id)).toBe(true);
    expect(tile.bloom).toBeGreaterThan(bloom);
  });

  it('the Mega Pulse grows with the city, capped', () => {
    const sim = city();
    const first = sim.restoration.megaBudget();
    expect(first).toBe(TUNING.mega.baseTiles);
    // E23.1.1: the Old City is one fixed island, then the mainland past the causeway: the next area to wake is an
    // open one, else the region behind the nearest gate (opened here as a player would), else the mainland
    const wakeNext = () => wakeNextArea(sim);
    for (let i = 0; i < 10; i++) expect(wakeNext()).toBe(true);
    expect(sim.restoration.megaBudget()).toBe(TUNING.mega.baseTiles + 10 * TUNING.mega.tilesPerArea);
    const toCap = Math.ceil((TUNING.mega.maxTiles - TUNING.mega.baseTiles) / TUNING.mega.tilesPerArea);
    const clearedCount = vi.spyOn(sim.areas, 'clearedCount').mockReturnValue(toCap + 5);
    expect(sim.restoration.megaBudget()).toBe(TUNING.mega.maxTiles);
    clearedCount.mockRestore();
  });

  it('the meter is saved', async () => {
    const { SaveService } = await import('../src/app/SaveService');
    const sim = city();
    for (let i = 0; i < 7; i++) sim.restoration.pulse(deadTiles(sim)[0].id);
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.state.progression.megaCharge).toBe(7);
  });

  it('chains remember who started them: taps are the player, drones and condensers are automation', () => {
    const sim = city();
    // The park's old drone would start chains of its own: switch it off for this test.
    const old = TUNING.drone.old as { enabled: boolean };
    old.enabled = false;
    sim.state.drones = [];
    try {
    const ended: string[] = [];
    sim.bus.on('chain.ended', (e) => ended.push(e.starter));
    // Gardens in two places, so restoring next to each makes a real chain.
    const spots = deadTiles(sim);
    const garden = (g: (typeof spots)[number]) => {
      const m: MachineData = { id: sim.newId('m'), type: 'pollinator', roofId: GROUND, x: g.x, z: g.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
      sim.state.machines.push(m);
      sim.grid.indexMachine(m);
      g.occupantId = m.id;
      return sim.grid.neighbors(g).filter((n) => sim.restoration.isEligible(n));
    };
    const a = garden(spots[0]);
    const b = garden(spots.find((t) => Math.abs(t.x - spots[0].x) + Math.abs(t.z - spots[0].z) > 8 && !t.occupantId)!);
    sim.restoration.pulse(a[0].id);
    sim.advance(6);
    sim.restoration.complete(b[0], 'drone');
    sim.advance(6);
    expect(ended).toEqual(['player', 'auto']);
    } finally {
      old.enabled = true;
    }
  });

  it('Overcharge boosts scale with the Overcharge upgrade', () => {
    const sim = city();
    const m: MachineData = { id: sim.newId('m'), type: 'pollinator', roofId: GROUND, x: 3, z: 3, size: 1, boostUntil: 0, timer: 0, charge: 0 };
    m.overchargeUntil = sim.time + 10;
    expect(sim.chains.consumeOvercharge(m)).toBe(1);
    expect(sim.chains.consumeOvercharge(m)).toBe(0); // used up
    sim.state.upgrades.overcharge = 2;
    m.overchargeUntil = sim.time + 10;
    expect(sim.chains.consumeOvercharge(m)).toBe(3);
  });
});

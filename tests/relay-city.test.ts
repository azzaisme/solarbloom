import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData, TileData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import type { ChainEvent } from '../src/gameplay/BloomChainSystem';
import { relayLinkId } from '../src/gameplay/RelaySystem';
import { Sim } from '../src/gameplay/Sim';
import { openIsland } from './helpers';

/** The open island, rich (tests make their own patch mossy, so blooms have somewhere to go). */
function city(seed = 6) {
  const sim = new Sim(createInitialState(seed));
  // E23.1.1: the island open (every gate, every landmark awake)
  return openIsland(sim);
}

function mossy(sim: Sim, x0: number, z0: number, x1: number, z1: number) {
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const t = sim.grid.get(GROUND, x, z)!;
      if (t.occupantId) continue;
      t.blocked = false;
      t.ground = 'prepared';
      t.pollution = 0;
      t.bloom = 0;
      sim.grid.touch(t);
    }
}

function relay(sim: Sim, x: number, z: number): MachineData {
  const t = sim.grid.get(GROUND, x, z)!;
  t.blocked = false;
  const m: MachineData = { id: sim.newId('m'), type: 'relay', roofId: GROUND, x, z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  t.occupantId = m.id;
  return m;
}

function collect(sim: Sim) {
  const events: ChainEvent[] = [];
  const sent: { from: string; to: string; linkId: string; chainId: number }[] = [];
  const ended: { combo: number; crossings: number }[] = [];
  sim.bus.on('chain.event', (e) => events.push(e.event));
  sim.bus.on('relay.city', (e) => sent.push(e));
  sim.bus.on('chain.ended', (e) => ended.push(e));
  return { events, sent, ended };
}

const beside = (sim: Sim, m: MachineData): TileData => sim.grid.get(GROUND, m.x + 1, m.z)!;

describe('buildable Bloom Relays (City 10.4)', () => {
  it('a bloom beside a relay sends exactly one pulse that blooms the ground around the linked relay', () => {
    const sim = city();
    mossy(sim, -20, -4, 20, 4);
    const a = relay(sim, -10, 0);
    const b = relay(sim, 4, 0);
    const c = collect(sim);
    sim.restoration.complete(beside(sim, a), 'pulse');
    sim.advance(4);
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]).toMatchObject({ from: a.id, to: b.id, linkId: relayLinkId(a, b) });
    expect(c.events.filter((e) => e.type === 'RELAY')).toHaveLength(1);
    const remote = c.events.filter((e) => e.cause === 'relay' && (e.type === 'RESTORE' || e.type === 'GROW'));
    expect(remote.length).toBeGreaterThanOrEqual(TUNING.relay.targets);
    // The first wave lands around the far relay.
    for (const e of remote.slice(0, TUNING.relay.targets)) {
      const t = sim.grid.byTileId(e.target)!;
      expect(Math.abs(t.x - b.x) + Math.abs(t.z - b.z)).toBeLessThanOrEqual(TUNING.relay.remoteRadius * 2);
    }
    expect(c.ended).toHaveLength(1);
    expect(c.ended[0].crossings).toBeGreaterThanOrEqual(1);
    expect(sim.state.links[relayLinkId(a, b)].crossings).toBe(1);
  });

  it('never fires from outside its zone, between relays out of range, or while the link recharges', () => {
    const sim = city();
    mossy(sim, -30, -4, 30, 4);
    const a = relay(sim, -10, 0);
    const far = relay(sim, 20, 0); // 30 tiles away: out of range
    const c = collect(sim);
    expect(sim.relays.linked(a)).toEqual([]);
    sim.restoration.complete(beside(sim, a), 'pulse');
    sim.advance(3);
    expect(c.sent).toHaveLength(0);
    const b = relay(sim, 2, 0);
    expect(sim.relays.linked(a).map((m) => m.id)).toEqual([b.id]);
    sim.restoration.complete(sim.grid.get(GROUND, a.x - 4, a.z)!, 'pulse'); // not beside it
    sim.advance(3);
    expect(c.sent).toHaveLength(0);
    sim.restoration.complete(sim.grid.get(GROUND, a.x, a.z + 1)!, 'pulse');
    sim.advance(2);
    expect(c.sent).toHaveLength(1);
    sim.restoration.complete(sim.grid.get(GROUND, a.x, a.z - 1)!, 'pulse'); // beside it, but recharging
    sim.advance(1);
    expect(c.sent).toHaveLength(1);
    sim.advance(TUNING.relay.cooldown);
    sim.restoration.complete(sim.grid.get(GROUND, a.x - 1, a.z)!, 'pulse');
    sim.advance(2);
    expect(c.sent.filter((x) => x.from === a.id)).toHaveLength(2);
    void far;
  });

  it('only lands on valid tiles: never in hidden fog, never on machines or obstacles', () => {
    const sim = city(9);
    mossy(sim, -20, -4, 20, 4);
    const a = relay(sim, -8, 0);
    // A relay standing in a hidden area far out (as if placed by a save from elsewhere): nothing there can bloom.
    const hiddenId = [...Array(40)].map((_, i) => sim.areas.map.areaOfChunk(9 + (i % 5), 9 + Math.floor(i / 5))).find((id) => sim.areas.fog(id) === 'hidden')!;
    const [hx, hz] = sim.areas.info(hiddenId).landmark;
    sim.relays.range = () => 1e6; // link across the map for this check
    const h = relay(sim, hx + 3, hz);
    const c = collect(sim);
    sim.restoration.complete(beside(sim, a), 'pulse');
    sim.advance(4);
    expect(c.sent.filter((x) => x.to === h.id)).toHaveLength(0);
    for (const e of c.events.filter((x) => x.cause === 'relay' && x.type !== 'RELAY')) {
      const t = sim.grid.byTileId(e.target)!;
      expect(t.blocked).toBe(false);
      expect(sim.areas.fog(sim.areas.areaOf(t)!)).not.toBe('hidden');
      expect(sim.machine(t.occupantId)?.type ?? 'none').not.toBe('relay');
    }
  });

  it('Relay Lens reaches further and blooms more per pulse', () => {
    const sim = city();
    mossy(sim, -30, -4, 30, 4);
    const a = relay(sim, -10, 0);
    const b = relay(sim, 10, 0); // 20 apart: out of base range
    expect(sim.relays.linked(a)).toEqual([]);
    relay(sim, -20, 3); // a relay exists, so the upgrade is available
    const before = sim.relays.targets(a);
    expect(sim.upgrades.grant('relayLens', a.id)).toBeGreaterThan(0); // Phase 5 E12: per relay
    expect(sim.relays.linked(a).map((m) => m.id)).toContain(b.id);
    expect(sim.relays.linked(b).map((m) => m.id)).toContain(a.id); // the stronger lens links both ways
    expect(sim.relays.targets(a)).toBe(before + 1);
  });

  it('a ring of 10 relays: one chain fires every link at most once, travels the ring and ends', () => {
    const sim = city(4);
    // E23.1.1: round the Mast Row, north of the park (every tile of the ring on the open island)
    const [cx, cz] = [16, -30];
    mossy(sim, cx - 40, cz - 40, cx + 40, cz + 40);
    const ring: MachineData[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ring.push(relay(sim, cx + Math.round(Math.cos(a) * 24), cz + Math.round(Math.sin(a) * 24)));
    }
    // Neighbours in the ring are ~15 apart (in range); across the ring they aren't.
    for (let i = 0; i < 10; i++) expect(sim.relays.linked(ring[i]).map((m) => m.id)).toContain(ring[(i + 1) % 10].id);
    const c = collect(sim);
    sim.restoration.complete(beside(sim, ring[0]), 'pulse');
    for (let i = 0; i < 400 && sim.chains.activeRuns > 0; i++) sim.advance(0.1);
    expect(sim.chains.activeRuns).toBe(0);
    const perLink = new Map<string, number>();
    for (const x of c.sent) perLink.set(x.linkId, (perLink.get(x.linkId) ?? 0) + 1);
    for (const n of perLink.values()) expect(n).toBe(1);
    // The pulse went all the way round: every other relay of the ring received one (the first sends both ways).
    expect(new Set(c.sent.map((x) => x.to))).toEqual(new Set(ring.slice(1).map((m) => m.id)));
    expect(new Set(c.sent.map((x) => x.chainId)).size).toBe(1);
    expect(c.ended).toHaveLength(1);
  });

  it('placement: from fountain tier 1, on restored or mossy ground; cooldowns survive a reload', () => {
    const sim = city();
    mossy(sim, -6, -6, 6, 6);
    // E23.1.1: one rule set: the Relay unlocks with its recipe at its fountain tier (E21.3), not after a Drone Hub.
    // E23.3.2.3: Relays are the grid's poles, so that is tier 1, with the first panels.
    const tier = sim.state.salvage.tier;
    sim.state.salvage.tier = 0;
    expect(sim.build.check('relay', GROUND, 2, 2).reason).toMatch(/fountain tier 1/i);
    sim.state.salvage.tier = tier;
    expect(sim.build.check('relay', GROUND, 2, 2).ok).toBe(true);
    const polluted = sim.areas.tiles(PARK).find((t) => t.ground === 'polluted' && !t.blocked && !t.occupantId);
    if (polluted) expect(sim.build.check('relay', GROUND, polluted.x, polluted.z).ok).toBe(false);
    // A link's recharge is saved.
    const a = sim.build.place('relay', GROUND, 2, 2)!;
    const b = sim.build.place('relay', GROUND, 6, 6)!;
    sim.restoration.complete(sim.grid.get(GROUND, 3, 2)!, 'pulse');
    sim.advance(1);
    const id = relayLinkId(a, b);
    expect(sim.relays.ready(id)).toBe(false);
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.relays.ready(id)).toBe(false);
    expect(copy.state.links[id].crossings).toBe(1);
  });
});

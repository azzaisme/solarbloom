import { afterEach, describe, expect, it } from 'vitest';
import type { ChainEvent } from '../src/gameplay/BloomChainSystem';
import { Sim } from '../src/gameplay/Sim';
import { LINK_BY_ID, LINKS, type RoofLinkDef } from '../src/data/rooftops';
import { TUNING } from '../src/data/tuning';
import { createInitialState } from '../src/core/GameState';
import { awakenSeed, ground, makeSim, rich } from './helpers';

function collect(sim: Sim) {
  const events: ChainEvent[] = [];
  const ended: { chainId: number; combo: number; roofs: string[]; crossings: number; bonus: number }[] = [];
  const sent: { linkId: string; fromRoof: string; toRoof: string }[] = [];
  sim.bus.on('chain.event', (e) => events.push(e.event));
  sim.bus.on('chain.ended', (e) => ended.push(e));
  sim.bus.on('relay.sent', (e) => sent.push(e));
  return { events, ended, sent };
}

/** A neighbourhood with every link built and every roof playable. */
function connected(seed = 5) {
  const sim = new Sim(createInitialState(seed));
  rich(sim);
  awakenSeed(sim);
  sim.hood.buildLink('seed-reservoir');
  sim.state.progression.cores.r2 = true;
  sim.hood.buildLink('seed-canopy');
  for (const r of sim.state.rooftops) for (const t of r.tiles) if (!t.blocked && !t.occupantId) ground(sim, r.id, t.x, t.z, 'prepared');
  return sim;
}

describe('cross-roof Bloom Chains', () => {
  const extra: RoofLinkDef[] = [];
  afterEach(() => {
    for (const l of extra) {
      LINKS.splice(LINKS.indexOf(l), 1);
      delete LINK_BY_ID[l.id];
    }
    extra.length = 0;
  });

  it('a chain effect beside the Seed relay sends exactly one pulse that blooms the Reservoir', () => {
    const sim = connected();
    const { events, ended, sent } = collect(sim);
    sim.restoration.complete(sim.grid.get('r1', 6, 2)!, 'pulse'); // next to relay tile (7,2)
    sim.advance(4);
    expect(sent.filter((x) => x.linkId === 'seed-reservoir')).toHaveLength(1);
    const relay = events.filter((e) => e.type === 'RELAY');
    expect(relay).toHaveLength(1);
    expect(relay[0].roofId).toBe('r2');
    const remote = events.filter((e) => e.cause === 'relay' && (e.type === 'RESTORE' || e.type === 'GROW'));
    expect(remote).toHaveLength(TUNING.neighbourhood.relay.targets);
    for (const e of remote) expect(e.target.startsWith('r2:')).toBe(true);
    expect(sim.grid.byTileId(remote[0].target)!.ground).toBe('restored');
    expect(ended).toHaveLength(1);
    expect(ended[0].roofs).toEqual(['r1', 'r2']);
    expect(ended[0].crossings).toBe(1);
    expect(sim.state.links['seed-reservoir'].crossings).toBe(1);
  });

  it('never crosses an unbuilt link, from outside the relay zone, or while the relay recharges', () => {
    const sim = makeSim();
    rich(sim);
    awakenSeed(sim);
    for (const t of sim.grid.roof('r1')!.tiles) if (!t.blocked && !t.occupantId) ground(sim, 'r1', t.x, t.z, 'prepared');
    const c = collect(sim);
    sim.restoration.complete(sim.grid.get('r1', 6, 2)!, 'pulse');
    sim.advance(3);
    expect(c.sent).toHaveLength(0); // bridge not built

    const sim2 = connected();
    const c2 = collect(sim2);
    sim2.restoration.complete(sim2.grid.get('r1', 4, 4)!, 'pulse'); // far from any relay
    sim2.advance(3);
    expect(c2.sent).toHaveLength(0);
    sim2.restoration.complete(sim2.grid.get('r1', 6, 2)!, 'pulse');
    sim2.advance(2);
    expect(c2.sent).toHaveLength(1);
    sim2.restoration.complete(sim2.grid.get('r1', 7, 3)!, 'pulse'); // in the zone, but recharging
    sim2.advance(2);
    expect(c2.sent).toHaveLength(1);
    sim2.advance(TUNING.neighbourhood.relay.cooldown);
    sim2.restoration.complete(sim2.grid.get('r1', 7, 1)!, 'pulse');
    sim2.advance(2);
    expect(c2.sent).toHaveLength(2);
  });

  it('remote blooms prefer synergy spots, so the chain carries on over there', () => {
    const sim = connected();
    ground(sim, 'r2', 1, 5, 'restored');
    sim.build.place('pollinator', 'r2', 1, 5);
    const { events, ended } = collect(sim);
    sim.restoration.complete(sim.grid.get('r1', 6, 2)!, 'pulse');
    sim.advance(5);
    const remote = events.find((e) => e.cause === 'relay' && e.type === 'RESTORE')!;
    const t = sim.grid.byTileId(remote.target)!;
    expect(Math.abs(t.x - 1) + Math.abs(t.z - 5)).toBe(1); // next to the remote garden
    expect(events.some((e) => e.type === 'POLLINATE' && e.target.startsWith('r2:'))).toBe(true);
    expect(ended[0].combo).toBeGreaterThanOrEqual(4);
  });

  it('cyclic relay layouts terminate: each link crossed at most once per chain, every tile changes once', () => {
    // Close the triangle for this test: Reservoir ↔ Canopy.
    const loop: RoofLinkDef = { id: 'test-loop', name: 'Loop', from: 'r2', to: 'r3', fromTile: [0, 6], toTile: [9, 2], cost: { biomass: 0, energy: 0 }, requiresCore: 'r1' };
    LINKS.push(loop);
    LINK_BY_ID[loop.id] = loop;
    extra.push(loop);
    const sim = connected(9);
    sim.hood.buildLink('test-loop');
    sim.upgrades.purchase('relay2');
    // Gardens beside every relay tile so each arrival can reach the next relay.
    for (const l of LINKS) {
      for (const [roof, [x, z]] of [[l.from, l.fromTile], [l.to, l.toTile]] as const) {
        const r = sim.grid.roof(roof)!;
        const spot = [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]].find(([a, b]) => a >= 0 && b >= 0 && a < r.width && b < r.depth && !sim.grid.get(roof, a, b)!.occupantId && !sim.grid.get(roof, a, b)!.blocked);
        if (spot) {
          ground(sim, roof, spot[0], spot[1], 'restored');
          sim.build.place('pollinator', roof, spot[0], spot[1]);
        }
      }
    }
    const { events, ended, sent } = collect(sim);
    const changed = new Map<string, number>();
    sim.bus.on('tile.restored', ({ tile }) => changed.set(tile.id, (changed.get(tile.id) ?? 0) + 1));
    sim.restoration.complete(sim.grid.get('r1', 7, 3)!, 'pulse'); // in the Skybridge relay zone (a garden sits at 6,2)
    sim.advance(30);
    expect(sim.chains.activeRuns).toBe(0);
    expect(sim.chains.pendingSteps).toBe(0);
    const byChain = new Map<number, string[]>();
    for (const s of events.filter((e) => e.type === 'RELAY')) byChain.set(s.chainId, [...(byChain.get(s.chainId) ?? []), s.target]);
    for (const links of byChain.values()) expect(new Set(links).size).toBe(links.length);
    expect(sent.length).toBeGreaterThanOrEqual(2); // it really did travel on
    expect(sent.length).toBeLessThanOrEqual(LINKS.length);
    for (const n of changed.values()) expect(n).toBe(1);
    expect(new Set(ended.map((e) => e.chainId)).size).toBe(ended.length); // one reward per chain
    expect(events.length).toBeLessThan(TUNING.chain.maxEvents * 3);
  });

  it('is deterministic with relays: same state + same action = same events', () => {
    const run = () => {
      const sim = connected(21);
      const { events } = collect(sim);
      sim.restoration.complete(sim.grid.get('r1', 0, 4)!, 'pulse'); // next to the Canopy relay (0,5)
      sim.advance(6);
      return events.map((e) => `${e.type}:${e.target}:${e.cause}`).join('|');
    };
    const a = run();
    expect(a).toContain('RELAY:seed-canopy');
    expect(run()).toBe(a);
  });

  it('Relay II sends two remote blooms; a Golden Relay adds one more, once', () => {
    const sim = connected();
    sim.upgrades.purchase('relay2');
    sim.state.relayBonus = TUNING.cat.goldenRelayExtra;
    const { events } = collect(sim);
    sim.restoration.complete(sim.grid.get('r1', 6, 2)!, 'pulse');
    sim.advance(4);
    const first = events.filter((e) => e.cause === 'relay' && (e.type === 'RESTORE' || e.type === 'GROW')).length;
    expect(first).toBe(TUNING.neighbourhood.relay.targetsRelay2 + TUNING.cat.goldenRelayExtra);
    expect(sim.state.relayBonus).toBe(0);
    sim.advance(TUNING.neighbourhood.relay.cooldownRelay2);
    events.length = 0;
    sim.restoration.complete(sim.grid.get('r1', 7, 3)!, 'pulse');
    sim.advance(4);
    expect(events.filter((e) => e.cause === 'relay' && (e.type === 'RESTORE' || e.type === 'GROW')).length).toBe(TUNING.neighbourhood.relay.targetsRelay2);
  });
});

import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import { MACHINES } from '../src/data/machines';
import { PARK_SET } from '../src/data/oldcity';
import { LEGACY_RECLAIMER, SALVAGE } from '../src/data/salvage';
import { gameDays } from '../src/data/time';
import { SALVAGE_FIELDS } from '../src/data/mainland';
import { chunkPiles } from '../src/core/Mainland';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);
const oldSim = (seed = 7) => new Sim(createInitialState(seed));
const pile = (id: string) => PARK_SET.piles.find((p) => p.id === id)!;

describe('E21.2: salvage piles', () => {
  it('the park holds 60 Scrap and 18 Seeds', () => {
    const sim = oldSim();
    expect(sim.salvage.looseLeft('scrap', 'park')).toBe(60);
    expect(sim.salvage.looseLeft('seeds', 'park')).toBe(18);
    const t = sim.grid.get(GROUND, 8, 9)!;
    expect(t.blocked).toBe(true);
    expect(sim.salvage.pileAt(8, 9)?.id).toBe('pk-s1');
  });

  it('a small pile empties in two goes, and the tile under it can then be pulsed', () => {
    const sim = oldSim();
    expect(sim.salvage.salvage('pk-s1')).toBe(3);
    expect(sim.salvage.left('pk-s1')).toBe(3);
    expect(sim.grid.get(GROUND, 8, 9)!.blocked).toBe(true);
    expect(sim.salvage.salvage('pk-s1')).toBe(3);
    expect(sim.salvage.left('pk-s1')).toBe(0);
    expect(sim.inventory.count('scrap')).toBe(6);
    const t = sim.grid.get(GROUND, 8, 9)!;
    expect(t.blocked).toBe(false);
    expect(sim.salvage.pileAt(8, 9)).toBeUndefined();
    expect(sim.restoration.checkPulse(t).ok).toBe(true);
    expect(sim.restoration.pulse(t.id)).toBe(true);
    // a large one takes eight
    let n = 0;
    while (sim.salvage.left('pk-s5') > 0 && n < 20) sim.salvage.salvage('pk-s5'), n++;
    expect(n).toBe(8);
  });

  it('a full stack leaves the pile untouched', () => {
    const sim = oldSim();
    sim.inventory.add('scrap', 40);
    const fails: string[] = [];
    sim.bus.on('action.failed', (e) => fails.push(e.reason));
    expect(sim.salvage.salvage('pk-s3')).toBe(0);
    expect(sim.salvage.left('pk-s3')).toBe(12);
    expect(fails[0]).toMatch(/stack is full: leave some in the storage at the fountain/); // #606: plain words
    // one unit of room takes one unit
    sim.inventory.take('scrap', 1);
    expect(sim.salvage.salvage('pk-s3')).toBe(1);
    expect(sim.salvage.left('pk-s3')).toBe(11);
  });

  it('an emptied pile stays empty across save and load (it only refills with play, E23.7.4)', () => {
    const sim = oldSim(21);
    sim.salvage.salvage('pk-s1');
    sim.salvage.salvage('pk-s1');
    sim.salvage.salvage('pk-e1');
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(back.salvage.left('pk-s1')).toBe(0);
    expect(back.grid.get(GROUND, 8, 9)!.blocked).toBe(false);
    expect(back.salvage.left('pk-e1')).toBe(3);
    expect(back.grid.get(GROUND, pile('pk-e1').x, pile('pk-e1').z)!.blocked).toBe(true);
    expect(saver.serialize(back.state)).toBe(json);
  });
});

describe('E23.7.4: salvage respawns', () => {
  const fullDays = SALVAGE.refillDays;

  it('an emptied pile refills a unit at a time over a few game days, and stands on its tile again', { timeout: 120_000 }, () => {
    const sim = oldSim(31);
    const p = pile('pk-s1'); // small: 6 units
    sim.salvage.salvage('pk-s1');
    sim.salvage.salvage('pk-s1');
    expect(sim.salvage.left('pk-s1')).toBe(0);
    expect(sim.grid.get(GROUND, p.x, p.z)!.blocked).toBe(false);
    const refills: number[] = [];
    sim.bus.on('pile.refilled', (e) => e.pileId === 'pk-s1' && refills.push(e.left));
    // a third of the way: about a third back, and the pile is standing again
    sim.advance(gameDays(fullDays / 3) + 6);
    expect(sim.salvage.left('pk-s1')).toBe(2);
    expect(sim.grid.get(GROUND, p.x, p.z)!.blocked).toBe(true);
    expect(sim.salvage.pileAt(p.x, p.z)?.id).toBe('pk-s1');
    // the rest of the way: full, and it drops out of the save (untouched piles are full)
    sim.advance(gameDays((fullDays * 2) / 3) + 6);
    expect(sim.salvage.left('pk-s1')).toBe(6);
    expect(sim.state.salvage!.piles['pk-s1']).toBeUndefined();
    expect(refills).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('a storm blows fresh salvage in: every pile full at once', () => {
    const sim = oldSim(32);
    sim.salvage.salvage('pk-s1');
    sim.salvage.salvage('pk-s1');
    sim.salvage.salvage('pk-s5');
    expect(sim.salvage.left('pk-s5')).toBe(21);
    sim.weather.forceForTest('storm', 600);
    expect(sim.salvage.left('pk-s1')).toBe(6);
    expect(sim.salvage.left('pk-s5')).toBe(24);
    expect(sim.grid.get(GROUND, pile('pk-s1').x, pile('pk-s1').z)!.blocked).toBe(true);
    expect(Object.keys(sim.state.salvage!.piles)).toEqual([]);
  });

  it('a pile never comes back under a machine or on top of bloombot; it waits, then returns at once', { timeout: 120_000 }, () => {
    const sim = oldSim(33);
    const p = pile('pk-s1');
    sim.salvage.salvage('pk-s1');
    sim.salvage.salvage('pk-s1');
    sim.bot = { roofId: GROUND, x: p.x + 0.5, z: p.z + 0.5 };
    sim.advance(gameDays(fullDays) + 6);
    expect(sim.grid.get(GROUND, p.x, p.z)!.blocked).toBe(false);
    expect(sim.salvage.pileAt(p.x, p.z)).toBeUndefined();
    sim.weather.forceForTest('storm', 60); // not even a storm drops a pile on bloombot
    expect(sim.grid.get(GROUND, p.x, p.z)!.blocked).toBe(false);
    sim.bot = { roofId: GROUND, x: p.x + 3.5, z: p.z + 0.5 };
    sim.advance(6);
    expect(sim.salvage.left('pk-s1')).toBe(6);
    expect(sim.grid.get(GROUND, p.x, p.z)!.blocked).toBe(true);
  });

  it('restored ground under a returning pile stays restored', { timeout: 120_000 }, () => {
    const sim = oldSim(34);
    const p = pile('pk-s1');
    sim.salvage.salvage('pk-s1');
    sim.salvage.salvage('pk-s1');
    const t = sim.grid.get(GROUND, p.x, p.z)!;
    t.ground = 'restored';
    t.bloom = 2;
    sim.grid.touch(t);
    sim.salvage.blowIn();
    expect(t.blocked).toBe(true);
    expect(t.ground).toBe('restored');
  });

  it('mainland piles refill on their own, quicker clock (SALVAGE_FIELDS.respawnDays)', () => {
    const sim = oldSim(37);
    let ml: ReturnType<typeof chunkPiles> extends Map<string, infer P> ? P : never = undefined as never;
    for (let cx = 9; cx < 30 && !ml; cx++) for (let cz = -10; cz < 10 && !ml; cz++) for (const p of chunkPiles(cx, cz).values()) ml ??= p;
    expect(ml).toBeDefined();
    expect(sim.salvage.perUnit(ml)).toBeCloseTo(gameDays(SALVAGE_FIELDS.respawnDays) / SALVAGE.units[ml.size], 6);
    expect(sim.salvage.perUnit(pile('pk-s1'))).toBeCloseTo(gameDays(SALVAGE.refillDays) / SALVAGE.units.small, 6);
  });

  it("the Terraces' Salvage Lore blueprint makes piles refill twice as fast", () => {
    const sim = oldSim(35);
    const per = sim.salvage.perUnit(pile('pk-s1'));
    sim.state.salvage!.blueprints.push('salvageLore');
    expect(sim.salvage.perUnit(pile('pk-s1'))).toBeCloseTo(per / 2, 6);
  });

  it('a part-refilled pile survives a save byte for byte, and keeps refilling', { timeout: 120_000 }, () => {
    const sim = oldSim(36);
    sim.salvage.salvage('pk-s3'); // medium: 12, now 9
    sim.advance(gameDays(fullDays / 12) + 6); // one unit back
    expect(sim.salvage.left('pk-s3')).toBe(10);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(back.state)).toBe(json);
    back.advance(gameDays(fullDays / 12) + 6);
    expect(back.salvage.left('pk-s3')).toBe(11);
  });

  it('an old save loads without its Reclaimers: each is taken down and refunded to the store, and Mk 2 becomes Salvage Lore', () => {
    const sim = oldSim(38);
    // a save from before E23.7.4: a placed Reclaimer, its undelivered fraction, and the Terraces' old blueprint
    const json = JSON.parse(saver.serialize(sim.state));
    json.machines.push({ id: 'm900', type: 'reclaimer', roofId: GROUND, x: 23, z: -8, size: 2, boostUntil: 0, timer: 0, charge: 0 });
    json.salvage.reclaim = { m900: 0.5 };
    json.salvage.blueprints = ['networks', 'reclaimerMk2'];
    json.salvage.store = { copper: 4 };
    const back = new Sim(saver.deserialize(JSON.stringify(json))!);
    expect(back.state.machines.some((m) => (m.type as string) === 'reclaimer')).toBe(false);
    expect(back.state.salvage!.store).toEqual({ copper: 4 + LEGACY_RECLAIMER.refund.copper!, scrap: LEGACY_RECLAIMER.refund.scrap, timber: LEGACY_RECLAIMER.refund.timber });
    expect((back.state.salvage as unknown as { reclaim?: unknown }).reclaim).toBeUndefined();
    expect(back.state.salvage!.blueprints).toEqual(['networks', 'salvageLore']);
    expect(back.salvage.perUnit(pile('pk-s1'))).toBeCloseTo(gameDays(SALVAGE.refillDays) / SALVAGE.loreRefill / SALVAGE.units.small, 6);
    // and a save written now loads byte for byte (nothing left to migrate)
    const again = saver.serialize(back.state);
    expect(saver.serialize(new Sim(saver.deserialize(again)!).state)).toBe(again);
  });

  it('there is no offline income: the Reclaimer is gone', () => {
    const sim = oldSim();
    expect((sim.salvage as unknown as { offline?: unknown }).offline).toBeUndefined();
    expect(Object.keys(MACHINES)).not.toContain('reclaimer');
  });
});

import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MaterialId } from '../src/core/types';
import { ARC_BEATS, FRIENDSHIP, KEEPER_HELP, KEEPER_STORIES } from '../src/data/keepers';
import { KEEPERS, KEEPSAKES, REGIONS } from '../src/data/oldcity';
import { MATERIALS } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { collection } from '../src/ui/BackpackModel';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);
const roundTrip = (sim: Sim) => {
  const json = saver.serialize(sim.state);
  const back = new Sim(saver.deserialize(json)!);
  expect(saver.serialize(back.state)).toBe(json);
  back.bot = sim.bot;
  return back;
};

/** Every line a Keeper says, as a flat list (for wording checks). */
function allLines(id: string): string[] {
  const k = KEEPERS.find((x) => x.id === id)!;
  const st = KEEPER_STORIES[id];
  return [...Object.values(k.say).flat(), ...Object.values(st.arc).flat(), st.thanks, ...st.chatter, st.personality];
}

describe('E23.9.2: Keepers as friends', () => {
  it('every Keeper has a personality, likes, gifts both ways and an arc of four beats in data', () => {
    expect(Object.keys(KEEPER_STORIES).sort()).toEqual(KEEPERS.map((k) => k.id).sort());
    for (const k of KEEPERS) {
      const st = KEEPER_STORIES[k.id];
      expect(st.personality.length, k.id).toBeGreaterThan(20);
      for (const b of ARC_BEATS) {
        expect(st.arc[b].length, `${k.id} ${b}`).toBeGreaterThanOrEqual(1);
        expect(st.arc[b].length, `${k.id} ${b}`).toBeLessThanOrEqual(2);
      }
      expect(st.likes.length).toBeGreaterThan(0);
      // at least one thing it loves can be found today
      expect(st.likes.some((m) => m in MATERIALS), k.id).toBe(true);
      for (const m of Object.keys(st.giftBack)) expect(m in MATERIALS, `${k.id} gives ${m}`).toBe(true);
      expect(st.chatter.length).toBeGreaterThanOrEqual(3);
      expect(KEEPSAKES.some((ks) => ks.region === k.region), k.id).toBe(true);
    }
  });

  it('no Keeper talks about people coming back, and none mentions a cat', () => {
    for (const k of KEEPERS)
      for (const l of allLines(k.id)) {
        expect(l, k.id).not.toMatch(/\bpeople\b|\bcustomers?\b.*back|\bcat\b|lucky/i);
        expect(l.length, `${k.id}: ${l}`).toBeLessThan(140);
      }
  });

  it('Pylon\'s arc plays from waking to friendship: taker, turning, tender, friend; saving at every step', () => {
    let sim = new Sim(createInitialState(7, 'oldcity'));
    sim.state.salvage!.tier = 1;
    sim.state.salvage!.abilities.push('pry');
    sim.areas.clear('park', true);
    sim.gates.open('g-mastRow');
    sim.bot = { roofId: GROUND, x: 10.5, z: -2.5 };
    const said: string[][] = [];
    const watch = (s: Sim) => s.bus.on('keeper.said', (e) => said.push(e.lines));
    watch(sim);
    const arc = KEEPER_STORIES.pylon.arc;
    // waking: it remembers the old way
    sim.keepers.pulse('pylon');
    sim.inventory.add('scrap', 5);
    expect(sim.keepers.interact('pylon')).toBe('woke');
    expect(said.at(-1)).toContain(arc.taker[0]);
    sim.inventory.add('seeds', 8);
    expect(sim.keepers.interact('pylon')).toBe('done');
    // its patch comes back: it notices
    const p = REGIONS[0].patch;
    for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) sim.restoration.complete(sim.grid.get(GROUND, x, z)!, 'pulse');
    expect(sim.keepers.step('pylon')).toBe('landmark');
    expect(said.at(-1)).toContain(arc.turning[0]);
    sim = roundTrip(sim);
    watch(sim);
    // its landmark wakes: the new way
    sim.keepers.settle('pylon');
    expect(said.at(-1)).toContain(arc.tender[0]);
    expect(sim.keepers.isFriend('pylon')).toBe(false);
    expect(sim.keepers.benchFriend('mastRow')).toBeUndefined();
    // gifts: one a game day, things it loves
    expect(sim.keepers.giftFor('pylon')).toBeUndefined();
    expect(sim.keepers.hint('pylon')).toMatch(/loves Copper/);
    sim.inventory.add('copper', 3);
    const before = sim.inventory.count('copper');
    expect(sim.keepers.interact('pylon')).toBe('gave');
    expect(sim.keepers.hearts('pylon')).toBe(1);
    // the first gift: it gives something back
    expect(sim.inventory.count('copper') + sim.inventory.stored('copper')).toBe(before - 1 + (KEEPER_STORIES.pylon.giftBack.copper ?? 0));
    expect(said.at(-1)).toEqual([KEEPER_STORIES.pylon.thanks]);
    // not twice in one day
    expect(sim.keepers.giftFor('pylon')).toBeUndefined();
    expect(sim.keepers.interact('pylon')).toBe('talked');
    expect(sim.keepers.hearts('pylon')).toBe(1);
    sim = roundTrip(sim);
    watch(sim);
    for (let h = 2; h <= FRIENDSHIP.giftsToFriend; h++) {
      sim.state.time += FRIENDSHIP.giftEverySeconds;
      expect(sim.keepers.giftFor('pylon')).toBe('copper');
      expect(sim.keepers.interact('pylon')).toBe('gave');
      expect(sim.keepers.hearts('pylon')).toBe(h);
    }
    // friends: the friend beat, its keepsake, and it will sit on a bench in its own region
    expect(said.at(-1)).toEqual(arc.friend);
    expect(sim.keepers.isFriend('pylon')).toBe(true);
    expect(sim.state.salvage!.items).toContain('ks-mast');
    expect(sim.keepers.friends()).toEqual(['pylon']);
    expect(sim.keepers.benchFriend('mastRow')).toBe('pylon');
    expect(sim.keepers.benchFriend('oldMarket')).toBeUndefined();
    sim = roundTrip(sim);
    watch(sim);
    // a friend takes no more gifts, and chats in turn
    sim.state.time += FRIENDSHIP.giftEverySeconds;
    expect(sim.keepers.giftFor('pylon')).toBeUndefined();
    sim.keepers.interact('pylon');
    sim.keepers.interact('pylon');
    expect(said.slice(-2)).toEqual([[KEEPER_STORIES.pylon.chatter[0]], [KEEPER_STORIES.pylon.chatter[1]]]);
    // the backpack's collection lists it as a friend, and the keepsake as found
    const groups = collection(sim);
    expect(groups.find((g) => g.title === 'Friends')!.rows[0].name).toBe('Pylon, a friend');
    expect(groups.find((g) => g.title === 'Keepsakes')!.rows.find((r) => r.name === 'Tram sign')?.found).toBe(true);
  });

  it('a Keeper dozes at night, and so does its tending (the E23.7 clock)', () => {
    const sim = new Sim(createInitialState(7, 'oldcity'));
    sim.state.salvage!.tier = 1;
    sim.state.salvage!.abilities.push('pry');
    sim.areas.clear('park', true);
    sim.gates.open('g-mastRow');
    for (let z = -8; z <= -5; z++) for (let x = 8; x <= 12; x++) { const t = sim.grid.get(GROUND, x, z)!; if (!t.blocked && t.ground !== 'restored') sim.restoration.complete(t, 'pulse'); }
    sim.state.salvage!.keepers.pylon = { step: 'landmark' };
    sim.keepers.settle('pylon');
    const started: unknown[] = [];
    sim.bus.on('keeper.tending', (e) => started.push(e));
    // on to the night, then a whole tending period of it
    while (!sim.clock.isNight()) sim.state.time += 60;
    for (let s = 0; s < KEEPER_HELP.tendEverySeconds * 2 && sim.clock.isNight(); s++) {
      sim.state.time += 1;
      sim.keepers.tick(1);
    }
    expect(started).toEqual([]);
    // morning: it sets off again
    while (sim.clock.isNight()) sim.state.time += 60;
    for (let s = 0; s < KEEPER_HELP.tendEverySeconds * 2; s++) {
      sim.state.time += 1;
      sim.keepers.tick(1);
    }
    expect(started.length).toBeGreaterThan(0);
  });

  it('every Keeper loves a tomato once the farm grows them', () => {
    const sim = new Sim(createInitialState(7, 'oldcity'));
    for (const k of KEEPERS) expect(sim.keepers.likes(k.id)).toContain(FRIENDSHIP.everyoneLikes);
    void (FRIENDSHIP.everyoneLikes as MaterialId);
  });

  it('settled Keepers help out: they tend their region a bloom step at a time, friends twice as often', () => {
    const sim = new Sim(createInitialState(7, 'oldcity'));
    sim.state.salvage!.tier = 1;
    sim.state.salvage!.abilities.push('pry');
    sim.areas.clear('park', true);
    sim.gates.open('g-mastRow');
    const p = REGIONS[0].patch;
    const tiles = [];
    for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) tiles.push(sim.grid.get(GROUND, x, z)!);
    // Pylon sleeps at (10, -4); restore a tile beside it
    const near = sim.grid.get(GROUND, 10, -6)!;
    sim.restoration.complete(near, 'pulse');
    for (let z = -8; z <= -5; z++) for (let x = 8; x <= 12; x++) { const t = sim.grid.get(GROUND, x, z)!; if (!t.blocked && t.ground !== 'restored') sim.restoration.complete(t, 'pulse'); }
    const area: ReturnType<typeof sim.grid.get>[] = [];
    for (let z = -8; z <= -5; z++) for (let x = 8; x <= 12; x++) area.push(sim.grid.get(GROUND, x, z));
    const bloomSum = () => area.reduce((a, t) => a + (t?.bloom ?? 0), 0);
    const before = bloomSum();
    // awake but not settled: no help yet
    sim.state.salvage!.keepers.pylon = { step: 'landmark' };
    const tended: unknown[] = [];
    sim.bus.on('keeper.tended', (e) => tended.push(e));
    sim.keepers.tick(KEEPER_HELP.tendEverySeconds + 1);
    expect(tended).toEqual([]);
    sim.keepers.settle('pylon');
    const t0 = sim.time;
    // tick at fixed times: exactly one tending per period
    // it sets off at each period, walks to its tile and tends it; the tile blooms when it is done, not before
    const started: unknown[] = [];
    sim.bus.on('keeper.tending', (e) => started.push(e));
    for (let s = 1; s <= KEEPER_HELP.tendEverySeconds * 2 + 30; s++) {
      sim.state.time = t0 + s;
      sim.keepers.tick(1);
      if (started.length === 1 && !tended.length) expect(sim.keepers.tendingAt('pylon')).toBeDefined();
    }
    expect(started.length).toBe(2);
    expect(tended.length).toBe(2);
    // each tending is one bloom step on a tile beside it
    expect(bloomSum()).toBe(before + 2);
    // a friend tends twice as often
    sim.state.salvage!.keepers.pylon = { ...sim.keepers.state('pylon'), hearts: FRIENDSHIP.giftsToFriend };
    tended.length = 0;
    for (let s = 1; s <= KEEPER_HELP.tendEverySeconds * 2; s++) {
      sim.state.time += 1;
      sim.keepers.tick(1);
    }
    expect(tended.length).toBeGreaterThanOrEqual(2 * KEEPER_HELP.friendMult - 1);
    expect(tended.length).toBeLessThanOrEqual(2 * KEEPER_HELP.friendMult);
    void tiles;
  });
});

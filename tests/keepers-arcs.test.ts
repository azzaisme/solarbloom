import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MaterialId } from '../src/core/types';
import { FRIENDSHIP, KEEPER_STORIES } from '../src/data/keepers';
import { KEEPERS, KEEPSAKES, REGIONS } from '../src/data/oldcity';
import { MATERIALS } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);

/** Save and load: the story must come back exactly. */
function roundTrip(sim: Sim): Sim {
  const json = saver.serialize(sim.state);
  const back = new Sim(saver.deserialize(json)!);
  expect(saver.serialize(back.state)).toBe(json);
  back.bot = sim.bot;
  return back;
}

/**
 * E23.9.2.1–10 (#454–#463): every Keeper's arc plays from waking to friendship, as a player would play it: pulse it,
 * wake it with 5 of anything, bring what it asks for, restore its patch, wake its landmark, then three gifts it
 * loves on three days. Each beat speaks its lines; the story survives a save at every step.
 */
describe('E23.9.2: every Keeper, from waking to friendship', () => {
  for (const k of KEEPERS) {
    it(`${k.name} (${k.region})`, () => {
      const r = REGIONS.find((q) => q.id === k.region)!;
      const story = KEEPER_STORIES[k.id];
      let sim = new Sim(createInitialState(7));
      const sv = sim.state.salvage!;
      sv.tier = 4;
      sv.abilities.push('pry', 'hover', 'climb', 'glide');
      sim.areas.clear('park', true);
      sim.gates.open(r.gate.id, true);
      sim.gates.openRegion(r.id);
      sim.bot = { roofId: GROUND, x: k.x + 0.5, z: k.z + 1.5 };
      const said: string[][] = [];
      const watch = (s: Sim) => s.bus.on('keeper.said', (e) => e.keeperId === k.id && said.push(e.lines));
      watch(sim);
      expect(sim.keepers.visible(k.id), 'its region is open').toBe(true);

      // 1. taker: it wakes remembering the old way
      expect(sim.keepers.pulse(k.id)).toBe(true);
      sim.inventory.add('scrap', 5);
      expect(sim.keepers.interact(k.id)).toBe('woke');
      expect(said.at(-1)).toContain(story.arc.taker[0]);
      sim = roundTrip(sim);
      watch(sim);

      // its first request
      for (const [m, n] of Object.entries(k.request1) as [MaterialId, number][]) sim.inventory.add(m, n);
      expect(sim.keepers.interact(k.id)).toBe('done');
      expect(sim.keepers.step(k.id)).toBe('request2');

      // 2. turning: its patch comes back
      const p = r.patch;
      for (let z = p.z; z < p.z + p.d; z++)
        for (let x = p.x; x < p.x + p.w; x++) {
          const t = sim.grid.get(GROUND, x, z)!;
          if (!t.blocked && !t.occupantId && t.ground !== 'restored') sim.restoration.complete(t, 'pulse');
        }
      expect(sim.keepers.step(k.id)).toBe('landmark');
      expect(said.at(-1)).toContain(story.arc.turning[0]);
      sim = roundTrip(sim);
      watch(sim);

      // 3. tender: its landmark wakes (the region restored enough, its delivery handed in)
      for (const t of sim.areas.tiles(r.id)) if (sim.areas.counts(r.id).restored < sim.areas.need(r.id) && sim.restoration.isEligible(t)) sim.restoration.complete(t, 'pulse');
      // biomass is a backpack item like the rest (E23.5.1)
      for (const [m, n] of Object.entries(k.landmark) as [MaterialId, number][]) sim.inventory.addToStore(m, n);
      sim.bot = { roofId: GROUND, x: k.x + 0.5, z: k.z + 1.5 };
      // the store is reached from anywhere once it's near; hand everything over from the pack to be sure
      for (const [m, n] of Object.entries(k.landmark) as [MaterialId, number][]) sim.inventory.withdraw(m, n);
      // #787: a gated region's landmark waits on its works (tests/region-works.test.ts builds them for real)
      if (sim.works.gated(r.id)) {
        expect(sim.landmarks.problem(r.id)).toContain(sim.works.def(r.id)!.dark);
        sim.works.start(r.id);
      }
      expect(sim.landmarks.interact(r.id)).toBe('woke');
      expect(sim.keepers.step(k.id)).toBe('settled');
      expect(said.at(-1)).toContain(story.arc.tender[0]);
      sim = roundTrip(sim);
      watch(sim);

      // Tally: trading opens with the Market Hall
      if (k.id === 'tally') {
        expect(sim.landmarks.canTrade()).toBe(true);
        sim.inventory.add('scrap', 3);
        const glass = sim.inventory.count('glass');
        expect(sim.landmarks.trade('scrap', 'glass')).toBe(true);
        expect(sim.inventory.count('glass')).toBe(glass + 1);
      }

      // 4. friend: three gifts it loves, one a day
      const love = story.likes.find((m) => m in MATERIALS) as MaterialId;
      sim.inventory.add(love, FRIENDSHIP.giftsToFriend);
      for (let h = 1; h <= FRIENDSHIP.giftsToFriend; h++) {
        expect(sim.keepers.giftFor(k.id), `gift ${h}`).toBe(love);
        expect(sim.keepers.interact(k.id)).toBe('gave');
        expect(sim.keepers.hearts(k.id)).toBe(h);
        if (h < FRIENDSHIP.giftsToFriend) {
          expect(said.at(-1)).toEqual([story.thanks]);
          expect(sim.keepers.giftFor(k.id), 'one gift a day').toBeUndefined();
          sim.state.time += FRIENDSHIP.giftEverySeconds;
        }
      }
      expect(sim.keepers.isFriend(k.id)).toBe(true);
      expect(said.at(-1)).toEqual(story.arc.friend);
      const ks = KEEPSAKES.find((q) => q.region === k.region)!;
      expect(sim.state.salvage!.items).toContain(ks.id);
      sim = roundTrip(sim);
      watch(sim);
      // a friend chats, and (Tally) still trades
      sim.keepers.interact(k.id);
      expect(said.at(-1)).toEqual([story.chatter[0]]);
      expect(sim.keepers.benchFriend(k.region)).toBe(k.id);
      if (k.id === 'tally') {
        expect(sim.keepers.giftFor('tally')).toBeUndefined();
        sim.inventory.add('timber', 3);
        expect(sim.landmarks.trade('timber', 'gears')).toBe(true);
      }
    }, 120_000);
  }
});

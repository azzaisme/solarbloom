import { describe, expect, it } from 'vitest';
import type { AbilityId, MaterialId } from '../src/core/types';
import { KEEPERS, REGIONS, type RegionId } from '../src/data/oldcity';
import { TIERS, type MaterialCost } from '../src/data/salvage';
import { createInitialState } from '../src/core/GameState';
import { heldUnlocks, isUnlocked, isUsable } from '../src/gameplay/Unlocks';
import { allUnlocks, REGION_UNLOCKS, unlockSource, type UnlockSource } from '../src/data/unlocks';

/**
 * E23.8.2 (#400): what each region unlocks, and a reachability proof.
 *
 * The island is modelled from data: a region is entered through its gate (an ability from a fountain tier, another
 * region's landmark, or a repair), a tier needs a number of landmarks and a delivery, and a landmark needs its Keeper's
 * request and its own delivery. Materials come from the park (scrap, seeds) and from each region entered; once Old
 * Market is reached Tally trades any material for any other, so the model treats every material as available then
 * (the most permissive case, so the fewest guarantees). Entering a region wakes its Keeper, which hands over its unlocks.
 *
 * Every order of play the gates allow is explored (a set of entered regions is a state: 2^10 of them). For each region
 * we take the unlocks held in *every* state from which it can be entered: its hard needs must be among those.
 */

const HOME_MATERIALS: MaterialId[] = ['scrap', 'seeds'];
const ALL_MATERIALS: MaterialId[] = ['scrap', 'seeds', 'copper', 'timber', 'glass', 'clay', 'gears', 'sunstone'];
/** Physical reach the gate data doesn't spell out: the Observatory cliff is glided to from the edge of The Terraces. */
const REACH_VIA: Partial<Record<RegionId, RegionId>> = { observatory: 'terraces' };

const ids = REGIONS.map((r) => r.id);
const bit = (id: RegionId) => 1 << ids.indexOf(id);
const has = (s: number, id: RegionId) => (s & bit(id)) !== 0;

function materials(s: number): Set<MaterialId> {
  if (has(s, 'oldMarket')) return new Set(ALL_MATERIALS);
  return new Set([...HOME_MATERIALS, ...REGIONS.filter((r) => has(s, r.id)).map((r) => r.material)]);
}

const payable = (cost: MaterialCost | undefined, m: Set<MaterialId>) => Object.keys(cost ?? {}).every((k) => k === 'biomass' || m.has(k as MaterialId));

function landmarks(s: number): Set<RegionId> {
  const m = materials(s);
  return new Set(KEEPERS.filter((k) => has(s, k.region) && payable(k.request1, m) && payable(k.landmark, m)).map((k) => k.region));
}

function abilities(s: number): Set<AbilityId> {
  const m = materials(s);
  const n = landmarks(s).size;
  const out = new Set<AbilityId>();
  for (const t of TIERS) if (t.ability && (t.needs.landmarks ?? 0) <= n && payable(t.delivery, m)) out.add(t.ability);
  return out;
}

function canEnter(s: number, id: RegionId): boolean {
  const r = REGIONS.find((q) => q.id === id)!;
  const via = REACH_VIA[id];
  if (via && !has(s, via)) return false;
  const n = r.gate.needs;
  if (n.landmark && landmarks(s).has(n.landmark)) return true;
  if (n.repair && !payable(n.repair, materials(s))) return false;
  if (n.ability && !abilities(s).has(n.ability)) return false;
  return true;
}

function held(s: number): Set<string> {
  const from: UnlockSource[] = ['home', ...ids.filter((id) => has(s, id))];
  return new Set(from.flatMap((f) => REGION_UNLOCKS[f].map((u) => u.id)));
}

/** For each region: the unlocks held in every state it can be entered from. */
function explore() {
  const seen = new Set<number>([0]);
  const queue = [0];
  const guaranteed = new Map<RegionId, Set<string>>();
  while (queue.length) {
    const s = queue.shift()!;
    for (const id of ids) {
      if (has(s, id) || !canEnter(s, id)) continue;
      const h = held(s);
      const g = guaranteed.get(id);
      guaranteed.set(id, g ? new Set([...g].filter((u) => h.has(u))) : h);
      const t = s | bit(id);
      if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }
  return { guaranteed, full: seen.has((1 << ids.length) - 1) };
}

describe('E23.8.2: what each region unlocks', () => {
  it('Home and every region hand something over, and every id is unique', () => {
    expect(REGION_UNLOCKS.home.length).toBeGreaterThan(0);
    for (const r of REGIONS) expect(REGION_UNLOCKS[r.id].length, r.id).toBeGreaterThan(0);
    const all = allUnlocks().map((u) => u.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it('every need and use names a real unlock', () => {
    for (const u of allUnlocks()) for (const n of [...(u.needs ?? []), ...(u.uses ?? [])]) expect(unlockSource(n), `${u.id} → ${n}`).toBeDefined();
  });

  it('ring 1 unlocks do not depend on each other', () => {
    const ring1 = new Set(REGIONS.filter((r) => r.ring === 1).map((r) => r.id));
    for (const u of allUnlocks()) {
      if (u.from === 'home' || !ring1.has(u.from)) continue;
      for (const n of u.needs ?? []) {
        const src = unlockSource(n)!;
        expect(src === 'home' || src === u.from, `${u.id} needs ${n} from ${src}`).toBe(true);
      }
    }
  });

  it('every region can be reached, so every unlock is handed over', () => {
    const { guaranteed, full } = explore();
    expect(full).toBe(true);
    for (const id of ids) expect(guaranteed.has(id), id).toBe(true);
  });

  it('every unlock is reachable with what is held when it is needed (every order of play)', () => {
    const { guaranteed } = explore();
    const bad: string[] = [];
    for (const u of allUnlocks()) {
      const ok = new Set([...REGION_UNLOCKS.home.map((q) => q.id), ...(u.from === 'home' ? [] : REGION_UNLOCKS[u.from].map((q) => q.id)), ...(u.from === 'home' ? [] : guaranteed.get(u.from)!)]);
      for (const n of u.needs ?? []) if (!ok.has(n)) bad.push(`${u.from}: ${u.id} needs ${n}, not held in every order`);
    }
    expect(bad).toEqual([]);
  });

  it('the Observatory always comes after The Terraces (it is glided to from their edge)', () => {
    expect(explore().guaranteed.get('observatory')!.has('feedTank')).toBe(true);
  });

  it("a new game holds Home's unlocks; a region's arrive when its Keeper wakes", () => {
    const st = createInitialState(7);
    expect(heldUnlocks(st)).toEqual(REGION_UNLOCKS.home.map((u) => u.id));
    expect(isUnlocked(st, 'craftingTable')).toBe(true);
    expect(isUnlocked(st, 'pump')).toBe(false);
    st.salvage!.keepers.sluice = { step: 'asleep' };
    expect(isUnlocked(st, 'pump')).toBe(false);
    st.salvage!.keepers.sluice = { step: 'request1' };
    expect(isUnlocked(st, 'pump')).toBe(true);
    expect(isUsable(st, 'pump')).toBe(true);
    expect(isUnlocked(st, 'not-a-region-unlock')).toBe(true);
  });

  it('an unlock waits for its hard needs before it is usable', () => {
    const st = createInitialState(7);
    st.salvage!.keepers.tock = { step: 'settled' };
    expect(isUsable(st, 'mulcher')).toBe(true);
    expect(isUnlocked(st, 'powerPole')).toBe(false);
  });
});

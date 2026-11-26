import type { MaterialId } from '../core/types';
import { regionById } from '../core/OldCityLayout';
import { REGIONS, type RegionDef, type RewardId } from '../data/oldcity';
import { MATERIAL_IDS, MATERIALS, TRADE } from '../data/salvage';
import { costText } from './KeeperSystem';
import type { Sim } from './Sim';

/** E21.9 (§8): what each lasting reward does. */
export const REWARD_EFFECT = {
  /** Clock Plaza: helpers work this much faster */
  helperSpeed: 1.25,
  /** Cistern Basin: Water Condensers fill this much faster (E23.1.4; water storage left with the counters) */
  condenserMult: 2,
  /** The Terraces: batteries hold this much more (E23.1.4; energy storage left with the counters) */
  batteryMult: 2,
};

/**
 * E21.9 (§8, §9): waking an Old City region's landmark. Bloombot always wakes it by hand: when half the region is
 * restored and its Keeper's second request is done, Interact at the landmark hands over the landmark delivery
 * (a bit at a time is fine). Waking clears the region (helpers may work there, it becomes a travel point and a
 * way into the store, settles its Keeper, and applies the region's lasting reward.
 */
export class LandmarkSystem {
  constructor(private sim: Sim) {}


  /** Lasting rewards in effect. */
  has(r: RewardId): boolean {
    return !!this.sim.state.salvage?.rewards?.includes(r);
  }

  /** The region whose landmark stands at (x, z) (its 2×2 footprint), if any. */
  regionAt(x: number, z: number): RegionDef | undefined {
    return REGIONS.find((r) => x >= r.landmark.x && x <= r.landmark.x + 1 && z >= r.landmark.z && z <= r.landmark.z + 1);
  }

  /** Why a landmark can't be woken now (undefined: hand over the delivery). */
  problem(regionId: string): string | undefined {
    const r = regionById(regionId);
    if (!r) return 'Nothing to wake here';
    const a = this.sim.areas;
    if (a.fog(r.id) === 'cleared') return `The ${r.landmark.name} is awake`;
    const need = a.need(r.id);
    const done = a.counts(r.id).restored;
    if (done < need) return `Turn more of ${r.name} green first: ${done} of ${need}`;
    const k = this.sim.keepers.def(r.keeper);
    if (this.sim.keepers.step(r.keeper) !== 'landmark') return `${k.name} has something to ask first`;
    // #787: a gated region's landmark waits on its works (power, water or drones: only building gives them)
    const w = this.sim.works.def(r.id);
    if (w && !this.sim.works.running(r.id)) return `The ${r.landmark.name} can't wake yet. ${w.dark} ${w.how}`;
    return undefined;
  }

  /**
   * Interact at a landmark: hands over what bloombot has toward its delivery; when the delivery is complete the
   * landmark wakes. Returns 'woke', 'gave', or undefined (refused, with a reason on the bus).
   */
  interact(regionId: string): 'woke' | 'gave' | undefined {
    const s = this.sim;
    const why = this.problem(regionId);
    if (why) {
      s.bus.emit('action.failed', { reason: why });
      return undefined;
    }
    const r = regionById(regionId)!;
    const id = r.keeper;
    const st = s.keepers.state(id);
    const given = { ...(st.given ?? {}) };
    let gave = false;
    for (const [k, v] of Object.entries(s.keepers.wants(id) ?? {}) as [MaterialId, number][]) {
      const n = Math.min(v, s.inventory.available(k));
      if (n > 0 && s.inventory.pay({ [k]: n })) {
        given[k] = (given[k] ?? 0) + n;
        gave = true;
      }
    }
    s.state.salvage!.keepers[id] = { step: 'landmark', given };
    if (Object.keys(s.keepers.wants(id) ?? {}).length) {
      if (!gave) s.bus.emit('action.failed', { reason: `The ${r.landmark.name} needs ${costText(s.keepers.wants(id)!)}` });
      return gave ? 'gave' : undefined;
    }
    this.wake(r);
    return 'woke';
  }

  /** The landmark wakes: the region clears, its Keeper settles, its reward applies. */
  private wake(r: RegionDef) {
    const s = this.sim;
    s.areas.clear(r.id, true);
    s.keepers.settle(r.keeper);
    this.reward(s.keepers.def(r.keeper).reward);
    s.bus.emit('landmark.woken', { region: r.id });
  }

  /** Applies a lasting reward (once). */
  reward(id: RewardId) {
    const sv = this.sim.state.salvage!;
    if ((sv.rewards ??= []).includes(id)) return;
    sv.rewards.push(id);
    if (id === 'heartSeed' || id === 'starLens') (sv.items ??= []).includes(id) || sv.items.push(id);
    if (id === 'energyCap') this.sim.power.invalidate();
  }

  /** Clock Plaza's reward: helpers (drones, Cultivators) work 25% faster. */
  helperSpeed(): number {
    return this.has('helpersFast') ? REWARD_EFFECT.helperSpeed : 1;
  }

  /** Cistern Basin's reward: Water Condensers fill twice as fast. */
  condenserMult(): number {
    return this.has('waterCap') ? REWARD_EFFECT.condenserMult : 1;
  }

  /** The Terraces' reward: batteries hold twice as much. */
  batteryMult(): number {
    return this.has('energyCap') ? REWARD_EFFECT.batteryMult : 1;
  }

  // ───────────── Tally's trade (§3: no dead ends) ─────────────

  /** Tally trades 3 of one material for 1 of another, once the Market Hall is awake. */
  canTrade(): boolean {
    return this.has('trade');
  }

  trade(give: MaterialId, get: MaterialId): boolean {
    const s = this.sim;
    if (!this.canTrade() || give === get) return false;
    // E23.8.3.2: mainland-only materials (steel) are found, never traded for
    if (MATERIALS[get].mainlandOnly) return false;
    if (!s.inventory.canPay({ [give]: TRADE.give })) {
      s.bus.emit('action.failed', { reason: `Tally wants ${TRADE.give} ${MATERIALS[give].name}` });
      return false;
    }
    if (s.inventory.room(get) < TRADE.get) {
      s.bus.emit('action.failed', { reason: `You can't carry more ${MATERIALS[get].name}` });
      return false;
    }
    s.inventory.pay({ [give]: TRADE.give });
    s.inventory.add(get, TRADE.get);
    return true;
  }

  /** Materials Tally can give (not the mainland's own: steel is only found there). */
  tradeTargets(): MaterialId[] {
    return MATERIAL_IDS.filter((m) => !MATERIALS[m].mainlandOnly);
  }

  /** Materials bloombot could trade away (at least 3 within reach). */
  tradable(): MaterialId[] {
    return MATERIAL_IDS.filter((m) => this.sim.inventory.available(m) >= TRADE.give);
  }
}

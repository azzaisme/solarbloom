import { HOME } from './ProgressionSystem';
import type { CatRewardType, CatSpot, CatVariant, MachineData, MaterialId, TileData } from '../core/types';
import { hashString, tileRandom } from '../core/Hash';

const CAT_SALT = hashString('lucky-cat');
import { PARK } from '../core/Areas';
import { GROUND } from '../core/GameState';
import { AREA_TYPES } from '../data/city';
import { CAT_ANCHORS, type CatAnchor } from '../data/templates';
import { CAT_DECOR, CAT_DECOR_OF_VARIANT, DECOR_OPTION } from '../data/cozy';
import { TUNING } from '../data/tuning';
import { MATERIALS } from '../data/salvage';
import { regionOfCell } from '../core/OldCityLayout';
import { strengthOf } from '../core/RegionStrengths';
import type { Sim } from './Sim';

/** Where a cat was found (rewards that act nearby start from here). */
export interface CatAt {
  roofId: string;
  x: number;
  z: number;
}

export interface CatReward {
  type: CatRewardType;
  summary: string;
}

export const CAT_REWARD_NAMES: Record<CatRewardType, string> = {
  luckyHarvest: 'Lucky Harvest',
  solarFrenzy: 'Solar Surge',
  megaBloom: 'Mega Bloom',
  droneParty: 'Drone Party',
  jackpot: 'JACKPOT',
  goldenRelay: 'Golden Relay',
  catsGarden: "Cat's Garden",
  fogWhisker: 'Fog Whisker',
  ripeAround: 'Ripe All Around',
};

/** How an anchor looks from the current camera: on screen, off screen (reachable by panning) or under the HUD. */
export type AnchorView = 'visible' | 'offscreen' | 'covered';

/**
 * Hidden Lucky Cat: spawning, claiming and rewards. Visual hiding/VFX live in the renderer.
 * `anchorView` is injected by the renderer: anchors under the HUD or in view are never used (E20.1, #284),
 * but a cat can hide on any playable rooftop (the player can pan there; it never expires).
 */
export class LuckyCatSystem {
  anchorView: (a: CatAnchor) => AnchorView = () => 'offscreen'; // headless (bots, tests): nothing is in view

  constructor(private sim: Sim) {}

  anchor(id: string | undefined): CatAnchor | undefined {
    if (!id) return undefined;
    if (id.startsWith('nook:')) return this.nookAnchor(id);
    return CAT_ANCHORS.find((a) => a.id === id);
  }

  /**
   * City nooks: generated beside each cleared area's obstacles (benches, stalls, pillars…). A nook id is
   * `nook:x:z` (the free tile the cat sits on); its look and hint come from the obstacle next to it.
   */
  private nookAnchor(id: string): CatAnchor | undefined {
    const [, xs, zs] = id.split(':');
    const x = Number(xs);
    const z = Number(zs);
    const t = this.sim.grid.get(GROUND, x, z);
    if (!t) return undefined;
    const ob = this.sim.grid.neighbors(t).find((n) => n.blocked && n.prop);
    if (!ob) return undefined;
    const dx = (ob.x - x) * 0.32;
    const dz = (ob.z - z) * 0.32;
    const area = this.sim.areas.areaOf(t);
    const type = area ? AREA_TYPES[this.sim.areas.info(area).type] : undefined;
    return { id, roofId: GROUND, pos: [x + 0.5 + dx, 0.08, z + 0.5 + dz], rotY: 200 + ((x * 37 + z * 11) % 60), needsFreeTile: [x, z], hint: ob.prop === 'building' ? 'beside an old building' : `beside a ${type?.obstacleName ?? 'quiet corner'}` };
  }

  /** Up to three nooks per cleared area (deterministic: the first obstacles in tile order). */
  private cityNooks(): CatAnchor[] {
    const s = this.sim;
    if (!s.grid.isPlayable(GROUND)) return [];
    const out: CatAnchor[] = [];
    const cleared = s.areas.revealed().filter((id) => id !== PARK && s.areas.fog(id) === 'cleared');
    // Most recently cleared first, and only a handful: the cat stays near where the player has been.
    cleared.sort((a, b) => (s.state.areas[b].clearedAt ?? 0) - (s.state.areas[a].clearedAt ?? 0));
    for (const id of cleared.slice(0, 12)) {
      let n = 0;
      for (const t of s.areas.tiles(id)) {
        if (n >= 3) break;
        if (!t.blocked || !t.prop) continue;
        const spot = s.grid.neighbors(t).find((nb) => !nb.blocked && !nb.occupantId && s.areas.areaOf(nb) === id);
        if (!spot) continue;
        const a = this.nookAnchor(`nook:${spot.x}:${spot.z}`);
        if (a) {
          out.push(a);
          n++;
        }
      }
    }
    return out;
  }

  candidates(): CatAnchor[] {
    const s = this.sim;
    // Phase 5 E15: never two cats in one spot (an invasion hides several at once).
    const taken = new Set(this.spots().map((c) => c.anchorId));
    return [...CAT_ANCHORS, ...this.cityNooks()].filter((a) => {
      if (taken.has(a.id)) return false;
      const roof = s.grid.roof(a.roofId);
      if (!roof || !roof.unlocked || roof.preview) return false;
      if (a.needsFreeTile) {
        const t = s.grid.get(a.roofId, a.needsFreeTile[0], a.needsFreeTile[1]);
        if (!t || t.occupantId) return false;
      }
      if (this.concealed(a)) return false;
      return this.anchorView(a) !== 'covered';
    });
  }

  /**
   * Phase 5 E15: a spot right behind something tall (a city building or a superstructure between it and the
   * camera, which looks from +x +z) would hide the whole cat: never used.
   */
  concealed(a: CatAnchor): boolean {
    const s = this.sim;
    const x = a.needsFreeTile ? a.needsFreeTile[0] : Math.floor(a.pos[0]);
    const z = a.needsFreeTile ? a.needsFreeTile[1] : Math.floor(a.pos[2]);
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1]] as const) {
      const t = s.grid.get(a.roofId, x + dx, z + dz);
      if (!t) continue;
      if (t.feature === 'building') return true;
      const m = s.occupant(t);
      if (m && (m.tier ?? 1) >= 3) return true;
    }
    return false;
  }

  /** Phase 5 E15: every cat hiding right now (the regular one first, then invasion cats). */
  spots(): CatSpot[] {
    const c = this.sim.state.cat;
    return c.active ? [c.active, ...(c.invasion ?? [])] : [...(c.invasion ?? [])];
  }

  find(catId: string): CatSpot | undefined {
    return this.spots().find((c) => c.id === catId);
  }

  /**
   * E23.12.3 (#530, epic rule 8): has bloombot found a cat yet? Until it has, nothing shows, names or hints at one:
   * no paw prints, meows, tooltips, wildlife cats, stats or collection entries. Finding the first one is the surprise.
   */
  get known(): boolean {
    return this.sim.state.cat.found > 0;
  }

  /**
   * Phase 5 E15: hiding long enough to leave paw prints (a gentle hint; nothing is lost by ignoring it). E23.12.3:
   * never before the first cat is found.
   */
  hinted(spot: CatSpot): boolean {
    return this.known && this.sim.time - spot.spawnedAt >= TUNING.cat.hintAfter; // E20.1: drones never hint a cat
  }

  /** Phase 5 E15: a new cat's id and rarity. The very first cat is always a standard one (onboarding). */
  private newSpot(anchorId: string): CatSpot {
    const c = this.sim.state.cat;
    c.seq = (c.seq ?? 0) + 1;
    const id = `c${c.seq}`;
    return { id, anchorId, spawnedAt: this.sim.time, variant: c.seq === 1 && c.found === 0 ? 'standard' : this.rollVariant(id) };
  }

  /** 80 / 18 / 2 (tuning), from a hash of the seed and cat id: deterministic, and the game's rng is untouched. */
  rollVariant(id: string): CatVariant {
    const V = TUNING.cat.variants;
    const n = /^c\d+$/.test(id) ? Number(id.slice(1)) : hashString(id);
    const r = tileRandom(this.sim.state.seed, CAT_SALT, n, 0, 15);
    const x = r * (V.standard.weight + V.golden.weight + V.rainbow.weight);
    if (x < V.rainbow.weight) return 'rainbow';
    if (x < V.rainbow.weight + V.golden.weight) return 'golden';
    return 'standard';
  }

  /**
   * Phase 5 E15 Lucky Cat Invasion: up to `n` extra cats in different spots, each with its own reward. They stay
   * until found (no timer). Returns how many hid.
   */
  invade(n: number): number {
    const c = this.sim.state.cat;
    let hid = 0;
    for (let i = 0; i < n; i++) {
      const a = this.pickAnchor(this.candidates());
      if (!a) break;
      const spot = this.newSpot(a.id);
      c.invasion = [...(c.invasion ?? []), spot];
      hid++;
      this.sim.bus.emit('cat.spawned', { anchorId: a.id, catId: spot.id, variant: spot.variant, invasion: true });
    }
    return hid;
  }

  /**
   * E20.1 (#284): picks a hiding spot the player has to go and find. Never one in view (`anchorView` 'visible') and
   * never within `TUNING.cat.minFromBot` tiles of bloombot; a spot within `preferWithin` tiles (a short walk) is
   * preferred when there is one. Undefined when every candidate is in view: the spawn retries a little later.
   */
  private pickAnchor(cands: CatAnchor[]): CatAnchor | undefined {
    const hidden = cands.filter((a) => this.anchorView(a) !== 'visible' && !this.nearBot(a, TUNING.cat.minFromBot));
    if (!hidden.length) return undefined;
    const near = hidden.filter((a) => this.nearBot(a, TUNING.cat.preferWithin));
    return this.sim.rng.pick(near.length ? near : hidden);
  }

  /** Within `tiles` of bloombot on the same layer (false when there is no bloombot, as in the bots). */
  private nearBot(a: CatAnchor, tiles: number): boolean {
    const b = this.sim.state.bot;
    if (!b || b.roofId !== a.roofId) return false;
    return Math.hypot(a.pos[0] - b.x, a.pos[2] - b.z) <= tiles;
  }

  /** A machine was built on the cat's nook: it hops to another spot instead of blocking the build. */
  relocateIfBlocked(): void {
    for (const spot of this.spots()) {
      const a = this.anchor(spot.anchorId);
      if (!a?.needsFreeTile) continue;
      const t = this.sim.grid.get(a.roofId, a.needsFreeTile[0], a.needsFreeTile[1]);
      if (!t?.occupantId) continue;
      const next = this.pickAnchor(this.candidates().filter((x) => x.id !== a.id));
      if (!next) continue; // nowhere else: it stays put (still clickable)
      spot.anchorId = next.id; // same id, spawn time and rarity: nothing lost or gained
      this.sim.bus.emit('cat.moved', { from: a.id, anchorId: next.id, catId: spot.id });
    }
  }

  restoredCount() {
    return this.sim.progression.restoredCount(HOME);
  }

  tick() {
    const c = this.sim.state.cat;
    const t = this.sim.time;
    // E20.1 (#284): a cat waits until bloombot finds it (no stash); the next one's timer starts from the find.
    if (c.active) return;
    if (!c.firstSpawned) {
      const ready = (t >= TUNING.cat.firstMinTime && this.restoredCount() >= TUNING.cat.firstMinRestored) || t >= TUNING.cat.firstForceTime;
      if (ready) this.spawn();
    } else if (c.nextSpawnAt >= 0 && t >= c.nextSpawnAt) {
      this.spawn();
    }
  }

  spawn(anchorId?: string): boolean {
    const c = this.sim.state.cat;
    if (c.active) return false;
    const cands = this.candidates();
    const a = anchorId ? cands.find((x) => x.id === anchorId) : this.pickAnchor(cands);
    if (!a) {
      c.nextSpawnAt = this.sim.time + 10;
      return false;
    }
    c.active = this.newSpot(a.id);
    c.firstSpawned = true;
    c.nextSpawnAt = this.sim.time + this.sim.rng.range(TUNING.cat.laterMin, TUNING.cat.laterMax);
    this.sim.bus.emit('cat.spawned', { anchorId: a.id, catId: c.active.id, variant: c.active.variant });
    return true;
  }

  /**
   * Cat's Garden: a small cluster of dead or plain tiles on one playable rooftop (rng-chosen, deterministic),
   * grown outward from a seed tile.
   */
  catsGardenTiles(): TileData[] {
    const s = this.sim;
    const ok = (t: TileData) => !t.occupantId && !t.blocked && !s.isCoreTile(t) && (s.restoration.isEligible(t) || (t.ground === 'restored' && t.bloom < 2));
    let seeds: TileData[];
    if (this.city()) {
      // In the city: one of the player's cleared areas (away from the park when possible). Never fog.
      const areas = s.areas.revealed().filter((id) => s.areas.fog(id) === 'cleared' && s.areas.tiles(id).some(ok));
      if (!areas.length) return [];
      const away = areas.filter((id) => id !== PARK);
      const pool = away.length ? away : areas;
      const id = pool[Math.floor(this.sim.rng.next() * pool.length)];
      seeds = s.areas.tiles(id).filter(ok);
    } else return [];
    const start = seeds[Math.floor(this.sim.rng.next() * seeds.length)];
    const home = s.areas.areaOf(start);
    const out: TileData[] = [start];
    const seen = new Set([start.id]);
    for (let i = 0; i < out.length && out.length < TUNING.cat.catsGardenTiles; i++) {
      for (const n of s.grid.neighbors(out[i])) {
        if (seen.has(n.id) || !ok(n) || s.areas.areaOf(n) !== home) continue;
        seen.add(n.id);
        out.push(n);
        if (out.length >= TUNING.cat.catsGardenTiles) break;
      }
    }
    return out;
  }

  /**
   * Fog Whisker: up to N tiles of the next fogged area, grown outward from its fog edge in order, so each
   * restoration opens the next (the cat never skips the fog's rules, it just walks them quickly).
   */
  fogWhiskerTiles(): TileData[] {
    const s = this.sim;
    if (!s.grid.isPlayable(GROUND) || !s.state.progression.coreActivated) return [];
    const id = s.areas.nextGoal();
    if (!id || s.areas.fog(id) === 'cleared') return [];
    const out: TileData[] = [];
    const seen = new Set<string>();
    const queue = s.areas.entryTiles(id).slice(0, 2);
    for (const t of queue) seen.add(t.id);
    const cap = this.fogWhiskerCap(id);
    while (queue.length && out.length < cap) {
      const t = queue.shift()!;
      out.push(t);
      for (const n of s.grid.neighbors(t)) {
        if (seen.has(n.id) || n.blocked || n.occupantId || n.ground === 'restored' || s.areas.areaOf(n) !== id) continue;
        seen.add(n.id);
        queue.push(n);
      }
    }
    return out;
  }

  /**
   * How many tiles a Fog Whisker restores in an area: more in harder (further) areas, but never enough to reach
   * its wake requirement on its own (the last tiles are always the player's).
   */
  fogWhiskerCap(id: string): number {
    const s = this.sim;
    const scaled = Math.round(TUNING.cat.fogWhiskerTiles * Math.min(2, s.areas.info(id).difficulty));
    return Math.max(0, Math.min(scaled, s.areas.need(id) - s.areas.counts(id).restored - 1));
  }

  /** Summary for the discovery panel. */
  discoveries() {
    const log = this.sim.state.cat.log ?? [];
    const spots = new Set(log.map((e) => e.anchorId));
    const rewards: Partial<Record<CatRewardType, number>> = {};
    for (const e of log) rewards[e.reward] = (rewards[e.reward] ?? 0) + 1;
    return {
      found: this.sim.state.cat.found,
      anchors: this.city() ? [] : CAT_ANCHORS.filter((a) => this.sim.grid.roof(a.roofId)).map((a) => ({ id: a.id, hint: a.hint, found: spots.has(a.id) })),
      byType: this.city() ? this.discoveriesByType() : [],
      rewards,
    };
  }

  /** The area type a logged find happened in (park anchors count as the park). */
  private areaTypeOf(anchorId: string): string {
    const a = this.anchor(anchorId);
    if (!a || a.roofId !== GROUND) return 'park';
    const [x, z] = a.needsFreeTile ?? [Math.floor(a.pos[0]), Math.floor(a.pos[2])];
    const id = this.sim.areas.areaOf({ roofId: GROUND, x, z });
    return id ? this.sim.areas.info(id).type : 'park';
  }

  /**
   * Finds grouped by area type ("Canal nooks: 3 cats, 2/8 kinds of reward"), so the log stays a few lines long
   * however big the city grows. Every type is listed, so undiscovered ones read as a goal.
   */
  discoveriesByType(): { type: string; name: string; icon: string; cats: number; kinds: number; totalKinds: number; nooks: number }[] {
    const log = this.sim.state.cat.log ?? [];
    const per = new Map<string, { cats: number; kinds: Set<string>; nooks: Set<string> }>();
    for (const e of log) {
      const type = this.areaTypeOf(e.anchorId);
      const p = per.get(type) ?? { cats: 0, kinds: new Set(), nooks: new Set() };
      p.cats++;
      p.kinds.add(e.reward);
      p.nooks.add(e.anchorId);
      per.set(type, p);
    }
    const totalKinds = Object.keys(CAT_REWARD_NAMES).length;
    return Object.values(AREA_TYPES).map((d) => {
      const p = per.get(d.type);
      return { type: d.type, name: d.name, icon: d.icon, cats: p?.cats ?? 0, kinds: p?.kinds.size ?? 0, totalKinds, nooks: p?.nooks.size ?? 0 };
    });
  }

  /** The endless city (ground layer) rather than the legacy rooftop layout. */
  private city() {
    return this.sim.grid.isPlayable(GROUND);
  }

  /**
   * E23.12 (#528) Golden Relay: the relay nearest the cat that isn't gold yet (relays are power poles, E23.3.2).
   * Undefined when there is none: it is never rolled then.
   */
  goldenRelayTarget(at?: CatAt): MachineData | undefined {
    const relays = this.sim.machinesOfType('relay').filter((m) => !m.golden);
    if (!relays.length) return undefined;
    if (!at) return relays[0];
    const d = (m: MachineData) => (m.roofId === at.roofId ? Math.hypot(m.x + m.size / 2 - at.x, m.z + m.size / 2 - at.z) : 1e9);
    return relays.reduce((a, b) => (d(b) < d(a) ? b : a));
  }

  goldenRelayAvailable(at?: CatAt) {
    return !!this.goldenRelayTarget(at);
  }

  catsGardenAvailable() {
    return this.catsGardenTiles().length > 0;
  }

  /**
   * E23.12 (#528) Drone Party is only offered when drones are working near the cat: a hub with its own drones within
   * `TUNING.cat.partyRadius` tiles (anywhere when the cat's spot is unknown).
   */
  partyAvailable(at?: CatAt): boolean {
    const s = this.sim;
    const busy = new Set(s.state.drones.filter((d) => !d.expiresAt).map((d) => d.hubId));
    return s.state.machines.some(
      (m) => busy.has(m.id) && (!at || (m.roofId === at.roofId && Math.hypot(m.x + m.size / 2 - at.x, m.z + m.size / 2 - at.z) <= TUNING.cat.partyRadius)),
    );
  }

  /** Where a cat sits (its anchor), for the rewards that act nearby. */
  spotAt(spot: CatSpot): CatAt | undefined {
    const a = this.anchor(spot.anchorId);
    return a && { roofId: a.roofId, x: a.pos[0], z: a.pos[2] };
  }

  /**
   * E23.12 (#528) Lucky Harvest's gift: food, biomass and what the cat's region is known for (its material: copper on
   * Mast Row, clay in the Cistern Basin…; seeds in the park and backstreets). Fertile soil gives more biomass.
   */
  giftAt(at: CatAt | undefined, mult: number): Partial<Record<MaterialId, number>> {
    const G = TUNING.cat.gift;
    const r = at && at.roofId === GROUND ? regionOfCell(at.x, at.z) : undefined;
    const local: MaterialId = r ? (Object.values(MATERIALS).find((m) => m.id !== 'scrap' && m.home.includes(r.id))?.id ?? 'scrap') : 'seeds';
    const soil = r ? strengthOf(r.id, 'soil') : 1;
    const out: Partial<Record<MaterialId, number>> = {};
    const put = (m: MaterialId, n: number) => (out[m] = (out[m] ?? 0) + Math.max(1, Math.round(n)));
    put('food', G.food * mult);
    put('biomass', G.biomass * mult * soil);
    put(local, G.local * mult);
    return out;
  }

  /**
   * E23.12.2 (#529) Ripe all around: the planters within `TUNING.cat.ripeRadius` tiles of bloombot (of the cat when
   * there is no bloombot, as in the bots) with a crop still growing. Empty: the reward is never rolled.
   */
  ripeTargets(at?: CatAt): MachineData[] {
    const s = this.sim;
    const b = s.bot ?? s.state.bot; // live where the game sets it, else the last saved spot
    const from = b ? { roofId: b.roofId, x: b.x, z: b.z } : at;
    return s.farm.planters().filter((m) => {
      if (!s.farm.bed(m).crop || s.farm.look(m).ripe) return false;
      return !from || (m.roofId === from.roofId && Math.hypot(m.x + m.size / 2 - from.x, m.z + m.size / 2 - from.z) <= TUNING.cat.ripeRadius);
    });
  }

  /**
   * E23.12.2 (#529): the cat-only decoration this cat leaves: a Golden or Rainbow Cat its own piece while bloombot
   * doesn't have it, otherwise the next missing one in order (the rarer cats' pieces last). Undefined once bloombot
   * has them all: from then on a cat gives only its reward.
   */
  nextDecor(variant: CatVariant = 'standard'): string | undefined {
    const left = CAT_DECOR.filter((id) => !this.sim.crafting.decorMade(id));
    if (!left.length) return undefined;
    const own = CAT_DECOR_OF_VARIANT[variant];
    if (own && left.includes(own)) return own;
    const rare = new Set(Object.values(CAT_DECOR_OF_VARIANT));
    return left.find((id) => !rare.has(id)) ?? left[0];
  }

  rollReward(at?: CatAt): CatRewardType {
    const w = TUNING.cat.weights;
    const table: [CatRewardType, number][] = [
      ['luckyHarvest', w.luckyHarvest],
      ['solarFrenzy', w.solarFrenzy],
      ['megaBloom', w.megaBloom],
      ['droneParty', this.partyAvailable(at) ? w.droneParty : 0],
      ['jackpot', w.jackpot],
      ['goldenRelay', this.goldenRelayAvailable(at) ? w.goldenRelay : 0],
      ['catsGarden', this.catsGardenAvailable() ? w.catsGarden : 0],
      ['fogWhisker', this.fogWhiskerTiles().length ? w.fogWhisker : 0],
      ['ripeAround', this.ripeTargets(at).length ? w.ripeAround : 0],
    ];
    const total = table.reduce((a, [, x]) => a + x, 0);
    let r = this.sim.rng.next() * total;
    for (const [type, x] of table) {
      if ((r -= x) < 0) return type;
    }
    return 'luckyHarvest';
  }

  /**
   * Claims a cat exactly once: the regular one by default, or any hiding cat by id (Phase 5 E15). Returns
   * undefined if there is no such cat (already claimed, a stale id, a second tap): nothing is paid.
   */
  claim(catId?: string): CatReward | undefined {
    const s = this.sim;
    const c = s.state.cat;
    const spot = catId === undefined ? c.active : this.find(catId);
    if (!spot || c.claimed?.includes(spot.id)) return undefined;
    // Removed and recorded first: a second click, a reload or a stale id can never pay twice.
    const regular = spot === c.active;
    if (regular) c.active = undefined;
    else c.invasion = (c.invasion ?? []).filter((x) => x !== spot);
    c.claimed = [...(c.claimed ?? []), spot.id].slice(-24);
    const first = c.found === 0;
    c.found++;
    s.state.stats.catsFound++;
    const V = TUNING.cat.variants;
    const variant: CatVariant = spot.variant ?? 'standard';
    const vmult = V[variant].mult;
    // The hidden-time bonus is capped (waiting never beats playing), and so is the whole multiplier.
    const hidden = Math.min(1, (s.time - spot.spawnedAt) / TUNING.cat.hiddenBonusCapSec);
    const mult = Math.min(TUNING.cat.maxRewardMult, (1 + TUNING.cat.hiddenBonusMax * hidden) * vmult);
    // A Rainbow Cat always gives two different rewards (a jackpot); the first cat a Lucky Harvest.
    const at = this.spotAt(spot);
    const type: CatRewardType = first ? 'luckyHarvest' : variant === 'rainbow' ? 'jackpot' : this.rollReward(at);
    const parts = [this.apply(type, mult, at)];
    // Saved-up rewards from saves made before E20.1 (#284), when a missed cat stashed extras: paid once, then gone.
    const extras = regular ? (c.stash ?? 0) : 0;
    for (let i = 0; i < extras; i++) parts.push(this.apply('luckyHarvest', 1, at));
    if (regular) c.stash = 0;
    // E23.12.2 (#529): every cat also leaves a cat-only decoration until bloombot has them all
    const decor = this.nextDecor(variant);
    if (decor && s.crafting.giveDecor(decor)) parts.push(`${DECOR_OPTION[decor].icon} ${DECOR_OPTION[decor].name} to place in your gardens`);
    const summary = parts.join(' · ');
    c.lastReward = type;
    c.log = [...(c.log ?? []), { anchorId: spot.anchorId, reward: type, at: s.time, variant }];
    if (regular) c.nextSpawnAt = s.time + s.rng.range(TUNING.cat.laterMin, TUNING.cat.laterMax);
    s.bus.emit('cat.found', { anchorId: spot.anchorId, reward: type, summary, extras, catId: spot.id, variant });
    return { type, summary };
  }

  /**
   * Pays one reward. `mult` scales it (rarity and hidden time, capped); `at` is where the cat sat. E23.12 (#528):
   * every reward pays out in the world (the backpack, charge, the grid, drones, restored ground), never in a
   * counter, and its words are the world's own: no numbers.
   */
  private apply(type: CatRewardType, mult: number, at: CatAt | undefined): string {
    const s = this.sim;
    const parts: string[] = [];
    const harvest = () => {
      const gift = this.giftAt(at, mult);
      for (const [m, n] of Object.entries(gift) as [MaterialId, number][]) {
        const left = s.inventory.add(m, n);
        if (left > 0) s.inventory.addToStore(m, left); // a full backpack: the rest waits in the store
      }
      const names = Object.keys(gift).map((m) => MATERIALS[m as MaterialId].name.toLowerCase());
      parts.push(`A gift in your backpack: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
    };
    const surge = () => {
      s.charge.recharge(s.charge.max, 'cat');
      const secs = TUNING.cat.surgeSeconds * mult;
      // Phase 5 E15: stacked surges never run past surgeMaxSeconds from now.
      const cap = s.time + TUNING.cat.surgeMaxSeconds;
      const here = at && { roofId: at.roofId, x: at.x, z: at.z };
      const same = (b: { at?: { roofId: string; x: number; z: number } }) => b.at?.roofId === here?.roofId && b.at?.x === here?.x && b.at?.z === here?.z;
      const existing = s.state.buffs.find((b) => b.type === 'solarFrenzy' && b.until > s.time && same(b));
      if (existing) existing.until = Math.min(cap, existing.until + secs);
      else s.state.buffs.push({ type: 'solarFrenzy', until: Math.min(cap, s.time + secs), at: here });
      s.bus.emit('buff.started', { type: 'solarFrenzy', seconds: secs });
      parts.push('Charge full, and the solar panels nearby shine brighter for a while');
    };
    // Each reward returns true when it acted as itself. Unable to act, it gives a gift instead (never nothing), or,
    // inside a jackpot (`fallback` false), does nothing so the jackpot can pick another.
    const mega = (fallback = true): boolean => {
      const ok = s.chains.startMega(Math.min(TUNING.cat.megaBloomMax, Math.round(TUNING.cat.megaBloomTiles * mult)));
      if (ok) parts.push('A Mega Bloom!');
      else if (fallback) harvest(); // everything nearby already blooms
      return ok;
    };
    const party = (fallback = true): boolean => {
      if (!this.partyAvailable(at)) {
        if (fallback) harvest();
        return false;
      }
      const secs = Math.min(TUNING.cat.partyMaxSeconds, TUNING.cat.dronePartySeconds * mult);
      s.state.buffs.push({ type: 'droneParty', until: s.time + secs, at: at && { roofId: at.roofId, x: at.x, z: at.z } });
      s.bus.emit('buff.started', { type: 'droneParty', seconds: secs });
      parts.push('The drones nearby work faster for a while');
      return true;
    };
    const golden = (fallback = true): boolean => {
      const relay = this.goldenRelayTarget(at);
      if (!relay) {
        if (fallback) harvest();
        return false;
      }
      relay.golden = true;
      s.power.invalidate();
      s.bus.emit('cat.goldenRelay', { machineId: relay.id });
      parts.push('A relay turns gold: it carries power further');
      return true;
    };
    const garden = (fallback = true): boolean => {
      const tiles = this.catsGardenTiles();
      if (!tiles.length || !s.chains.startCatGarden(tiles)) {
        if (fallback) harvest();
        return false;
      }
      const area = s.areas.areaOf(tiles[0]);
      const where = area ? `the ${AREA_TYPES[s.areas.info(area).type].name.toLowerCase()}` : s.grid.roof(tiles[0].roofId)!.name;
      parts.push(`A little garden blooms in ${where}`);
      return true;
    };
    const whisker = (fallback = true): boolean => {
      const tiles = this.fogWhiskerTiles();
      if (!tiles.length || !s.chains.startCatGarden(tiles)) {
        if (fallback) harvest();
        return false;
      }
      const a = s.areas.info(s.areas.areaOf(tiles[0])!);
      parts.push(`The fog thins over the ${AREA_TYPES[a.type].name.toLowerCase()}`);
      return true;
    };
    const ripe = (fallback = true): boolean => {
      const n = this.ripeTargets(at).filter((m) => s.farm.ripenNow(m)).length;
      if (!n) {
        if (fallback) harvest(); // nothing growing nearby any more
        return false;
      }
      parts.push(n === 1 ? 'The planter nearby ripens at once' : 'The planters nearby ripen all at once');
      return true;
    };
    switch (type) {
      case 'luckyHarvest':
        harvest();
        break;
      case 'solarFrenzy':
        surge();
        break;
      case 'megaBloom':
        mega();
        break;
      case 'droneParty':
        party();
        break;
      case 'goldenRelay':
        golden();
        break;
      case 'catsGarden':
        garden();
        break;
      case 'fogWhisker':
        whisker();
        break;
      case 'ripeAround':
        ripe();
        break;
      case 'jackpot': {
        // Two different rewards from the pool, in a random order; one that can't act here is skipped, never doubled
        // into a second gift (the gift and the surge always act, so there are always two).
        const pool: ((fallback?: boolean) => boolean)[] = [() => (harvest(), true), () => (surge(), true), mega, party, golden, garden, whisker, ripe];
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(s.rng.next() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        parts.push('JACKPOT!');
        let given = 0;
        for (const r of pool) if (given < 2 && r(false)) given++;
        break;
      }
    }
    return parts.join(' · ');
  }
}

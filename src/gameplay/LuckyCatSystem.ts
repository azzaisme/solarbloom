import { fmt } from '../core/Big';
import { HOME } from './ProgressionSystem';
import type { CatRewardType, CatSpot, CatVariant, MachineData, TileData } from '../core/types';
import { hashString, tileRandom } from '../core/Hash';

const CAT_SALT = hashString('lucky-cat');
import { PARK } from '../core/Areas';
import { GROUND } from '../core/GameState';
import { AREA_TYPES } from '../data/city';
import { CAT_ANCHORS, type CatAnchor } from '../data/templates';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

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
};

/** How an anchor looks from the current camera: on screen, off screen (reachable by panning) or under the HUD. */
export type AnchorView = 'visible' | 'offscreen' | 'covered';

/**
 * Hidden Lucky Cat: spawning, claiming and rewards. Visual hiding/VFX live in the renderer.
 * `anchorView` is injected by the renderer: anchors under the HUD are never used; on-screen ones are preferred,
 * but a cat can hide on any playable rooftop (the player can pan there; it never expires).
 */
export class LuckyCatSystem {
  anchorView: (a: CatAnchor) => AnchorView = () => 'visible';

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

  /** Phase 5 E15: hiding long enough to leave paw prints (a gentle hint; nothing is lost by ignoring it). */
  hinted(spot: CatSpot): boolean {
    return this.sim.time - spot.spawnedAt >= TUNING.cat.hintAfter;
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

  /** Picks a hiding spot: one in view most of the time, otherwise anywhere on a playable rooftop. */
  private pickAnchor(cands: CatAnchor[]): CatAnchor | undefined {
    if (!cands.length) return undefined;
    const rng = this.sim.rng;
    const visible = cands.filter((a) => this.anchorView(a) === 'visible');
    const pool = visible.length && (rng.next() < TUNING.cat.preferVisible || visible.length === cands.length) ? visible : cands;
    return rng.pick(pool);
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
    if (c.active) {
      // A missed cat never blocks rewards: when the next one would have appeared, it saves up an extra.
      if (c.nextSpawnAt >= 0 && t >= c.nextSpawnAt) {
        c.stash = Math.min(TUNING.cat.stashMax, (c.stash ?? 0) + 1);
        c.nextSpawnAt = t + this.sim.rng.range(TUNING.cat.laterMin, TUNING.cat.laterMax);
        this.sim.bus.emit('cat.stash', { stash: c.stash });
      }
      return;
    }
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

  /** Golden Relay's extra corridor blooms: grows with the city, capped. */
  goldenCorridorTiles(): number {
    return Math.min(TUNING.cat.goldenCorridorMax, TUNING.cat.goldenCorridorTiles + Math.floor(this.sim.areas.clearedCount() / 10));
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
   * Golden Relay needs a way to send it (a built bridge, or in the city a green corridor of street gardens)
   * and no unspent one; Cat's Garden needs somewhere new to bloom. Never useless.
   */
  goldenRelayAvailable() {
    const s = this.sim;
    if (s.state.relayBonus > 0) return false;
    return s.state.machines.some((m) => s.chains.isCorridor(m) && s.chains.corridorNext(m).length > 0);
  }

  catsGardenAvailable() {
    return this.catsGardenTiles().length > 0;
  }

  /** The drone hub a Drone Party launches from: in the city, the hub nearest the fog the player is pushing into. */
  partyHub(): MachineData | undefined {
    const s = this.sim;
    const hubs = s.state.machines.filter((m) => m.type === 'droneHub');
    if (hubs.length <= 1 || !this.city()) return hubs[0];
    const goal = s.areas.nextGoal();
    const entry = goal ? s.areas.entryTiles(goal)[0] : undefined;
    if (!entry) return hubs[0];
    return hubs.reduce((a, b) => (Math.hypot(b.x - entry.x, b.z - entry.z) < Math.hypot(a.x - entry.x, a.z - entry.z) ? b : a));
  }

  rollReward(): CatRewardType {
    const hasHub = this.sim.state.machines.some((m) => m.type === 'droneHub');
    const w = TUNING.cat.weights;
    const table: [CatRewardType, number][] = [
      ['luckyHarvest', w.luckyHarvest],
      ['solarFrenzy', w.solarFrenzy],
      ['megaBloom', w.megaBloom],
      ['droneParty', hasHub ? w.droneParty : 0],
      ['jackpot', w.jackpot],
      ['goldenRelay', this.goldenRelayAvailable() ? w.goldenRelay : 0],
      ['catsGarden', this.catsGardenAvailable() ? w.catsGarden : 0],
      ['fogWhisker', this.fogWhiskerTiles().length ? w.fogWhisker : 0],
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
    const type: CatRewardType = first ? 'luckyHarvest' : variant === 'rainbow' ? 'jackpot' : this.rollReward();
    const parts = [this.apply(type, mult, hidden, vmult)];
    // Saved-up rewards from while the regular cat was hiding: extra Lucky Harvests.
    const extras = regular ? (c.stash ?? 0) : 0;
    for (let i = 0; i < extras; i++) parts.push(this.apply('luckyHarvest', 1, 0));
    if (regular) c.stash = 0;
    const summary = parts.join(' · ');
    c.lastReward = type;
    c.log = [...(c.log ?? []), { anchorId: spot.anchorId, reward: type, at: s.time, variant }];
    if (regular) c.nextSpawnAt = s.time + s.rng.range(TUNING.cat.laterMin, TUNING.cat.laterMax);
    s.bus.emit('cat.found', { anchorId: spot.anchorId, reward: type, summary, extras, catId: spot.id, variant });
    return { type, summary };
  }

  /** `mult`: everything scales by it (capped); `vmult`: the rarity's share, which also lengthens a harvest. */
  private apply(type: CatRewardType, mult: number, hidden: number, vmult = 1): string {
    const s = this.sim;
    const parts: string[] = [];
    const harvest = () => {
      // Sustained rate: a cat found mid-Frenzy doesn't pay ×10 (Phase 4 E08.4).
      const rate = s.production.rates(true).biomass;
      const secs = (TUNING.cat.harvestSecondsMin + (TUNING.cat.harvestSecondsMax - TUNING.cat.harvestSecondsMin) * hidden) * vmult;
      // Phase 5 E12: biomass is uncapped, so the whole harvest always lands.
      const got = s.econ.add('biomass', rate.mul(secs).max(TUNING.cat.harvestMin));
      const w = s.econ.add('water', 10 * mult);
      const e = s.econ.add('energy', 15 * mult);
      if (got.gt(0)) s.bus.emit('resource.gain', { kind: 'biomass', amount: got, reason: 'cat' });
      if (w.gt(0)) s.bus.emit('resource.gain', { kind: 'water', amount: w, reason: 'cat' });
      if (e.gt(0)) s.bus.emit('resource.gain', { kind: 'energy', amount: e, reason: 'cat' });
      parts.push(`+${fmt(got)}🌿 +${fmt(w)}💧 +${fmt(e)}⚡`);
    };
    const frenzy = () => {
      const secs = TUNING.cat.frenzySeconds * mult;
      // Phase 5 E15: stacked surges never run past surgeMaxSeconds from now.
      const cap = s.time + TUNING.cat.surgeMaxSeconds;
      const existing = s.state.buffs.find((b) => b.type === 'solarFrenzy');
      if (existing) existing.until = Math.min(cap, Math.max(existing.until, s.time) + secs);
      else s.state.buffs.push({ type: 'solarFrenzy', until: Math.min(cap, s.time + secs) });
      s.bus.emit('buff.started', { type: 'solarFrenzy', seconds: secs });
      parts.push(`Solar ×${TUNING.cat.frenzyMult} for ${Math.round(secs)} s`);
    };
    const mega = () => {
      const ok = s.chains.startMega(Math.min(TUNING.cat.megaBloomMax, Math.round(TUNING.cat.megaBloomTiles * mult)));
      parts.push(ok ? 'A free Mega Bloom!' : 'Everything is already blooming!');
      if (!ok) harvest();
    };
    const party = () => {
      const hub = this.partyHub();
      if (!hub) return harvest();
      const secs = Math.min(TUNING.cat.partyMaxSeconds, TUNING.cat.dronePartySeconds * mult);
      s.drones.spawn(hub, secs);
      s.drones.spawn(hub, secs);
      parts.push(`2 party drones for ${Math.round(secs)} s`);
    };
    const golden = () => {
      if (!this.goldenRelayAvailable()) return harvest(); // degrade gracefully, never useless
      s.state.relayBonus = this.city() ? this.goldenCorridorTiles() : TUNING.cat.goldenRelayExtra;
      s.bus.emit('cat.goldenRelay', {});
      parts.push(
        this.city()
          ? `Your next green corridor hop blooms +${s.state.relayBonus} extra tiles`
          : `Your next cross-roof chain sends +${TUNING.cat.goldenRelayExtra} extra remote bloom`,
      );
    };
    const garden = () => {
      const tiles = this.catsGardenTiles();
      if (!tiles.length || !s.chains.startCatGarden(tiles)) return harvest();
      const area = s.areas.areaOf(tiles[0]);
      const where = area ? `the ${AREA_TYPES[s.areas.info(area).type].name.toLowerCase()}` : s.grid.roof(tiles[0].roofId)!.name;
      parts.push(`A little garden blooms in ${where} (${tiles.length} tiles)`);
    };
    const whisker = () => {
      const tiles = this.fogWhiskerTiles();
      if (!tiles.length || !s.chains.startCatGarden(tiles)) return harvest();
      const a = s.areas.info(s.areas.areaOf(tiles[0])!);
      parts.push(`The fog thins over the ${AREA_TYPES[a.type].name.toLowerCase()} (${tiles.length} tiles)`);
    };
    switch (type) {
      case 'luckyHarvest':
        harvest();
        break;
      case 'solarFrenzy':
        frenzy();
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
      case 'jackpot': {
        // Two different compatible rewards together.
        const pool: (() => void)[] = [harvest, frenzy, mega];
        if (s.state.machines.some((m) => m.type === 'droneHub')) pool.push(party);
        if (this.goldenRelayAvailable()) pool.push(golden);
        if (this.catsGardenAvailable()) pool.push(garden);
        const i = Math.floor(s.rng.next() * pool.length);
        let j = Math.floor(s.rng.next() * (pool.length - 1));
        if (j >= i) j++;
        parts.push('JACKPOT!');
        pool[i]();
        pool[j]();
        break;
      }
    }
    return parts.join(' · ');
  }
}

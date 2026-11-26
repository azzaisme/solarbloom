import { GROUND } from '../core/GameState';
import { hashString } from '../core/Hash';
import type { TileData } from '../core/types';
import { DIVERSITY, ON_BOT, PERCH_FROM, SINGLE_PERCHES, TIERS, VISIT, VISITORS, type DiversityTier, type Perch, type VisitorDef } from '../data/wildlife';
import { PLANT_LOAD, PULSE_LOAD } from '../data/pulse';
import { treeSpot, treeStage, treeWorldOf, type TreeWorld } from '../rendering/TreePlacement';
import { gameSecondsOf } from './Clock';
import type { Sim } from './Sim';

/** An area's diversity: the score, its tier and what it came from (E23.2.4.1). */
export interface Diversity {
  area: string;
  score: number;
  tier: DiversityTier;
  /** kinds of plant growing (grass, wildflowers, shrubs, meadow, rare, grove, each tree species, water plants) */
  kinds: string[];
  /** restored tiles, and the share of them in bloom (flowers or more) */
  restored: number;
  bloomShare: number;
  /** fauna kinds arrived on the island, wildlife homes built in the area, pollinators drawn there */
  fauna: number;
  homes: number;
  pollinators: number;
}

/** One animal coming over while bloombot sits (E23.2.4.2). Times are sim seconds. */
export interface Visit {
  id: string;
  perch: Perch;
  /** its place among visitors sharing a perch (perchNear, sniff, passBy): spaced out by VISIT.spacing */
  slot: number;
  /** where it comes from: an angle around bloombot (radians) */
  from: number;
  /** it sets off, it has arrived (logged then), it sets off again (passers-by, or bloombot stood) */
  start: number;
  arrive: number;
  leave?: number;
  /** written to the log (on arriving) */
  logged?: boolean;
}

/** What a tile grows, for counting kinds of plant. */
function plantKinds(t: TileData, areaType: string | undefined, out: Set<string>, trees: TreeWorld, now?: number) {
  if (t.ground !== 'restored') return;
  if (t.feature === 'water') {
    out.add('water plants');
    return;
  }
  const bloom = t.bloom || 1;
  out.add('grass');
  if (bloom >= 2) out.add('wildflowers');
  if (bloom >= 3) out.add('shrubs');
  if (t.plant) out.add(t.plant === 'meadow' ? 'meadow' : t.plant === 'rare' ? 'rare plant' : 'grove');
  // a tree counts once it has grown past a sapling (trees grow over game days)
  if (areaType && !t.occupantId && (treeStage(t, bloom, now) ?? 0) >= 2) {
    const spot = treeSpot(t, areaType, trees);
    if (spot) out.add(`${spot.species} trees`);
  }
}

/**
 * E23.2.4 (#374): wildlife visits by diversity. `sim.wildlife`:
 *
 * - **Diversity** (`diversity(area)`): a score per area from what the ecosystem reads (kinds of plant, how much is
 *   in bloom, fauna arrived, wildlife homes, pollinators), five tiers. The tile part is recounted only when one of
 *   the area's tiles changes; the same area always gives the same tier.
 * - **Visits:** while bloombot sits (a bench or a charger), animals come over one after another: more, and closer,
 *   the more diverse the area (`VISIT`, `PERCH_FROM`). Who comes and where they settle is seeded by the area and
 *   how many times bloombot has sat down (no Math.random). They leave when bloombot stands.
 * - **The visitor log** (`state.wildlife.log`): every kind that has come to sit with bloombot, where and how often.
 *
 * Animals are wild: visits never tame one (E23.2.5's friendship only listens). No visitor is a cat, and nothing
 * here reads the Lucky Cat system.
 */
export class WildlifeSystem {
  /** who is coming, here or leaving while bloombot sits (empty when standing) */
  visits: Visit[] = [];
  /** the area bloombot sits in (undefined when standing) */
  area?: string;
  private cache = new Map<string, { kinds: string[]; restored: number; bloomed: number; pollinators: number }>();

  constructor(private sim: Sim) {
    sim.grid.touchListeners.push((t) => {
      if (t.roofId !== GROUND || !this.cache.size) return;
      const a = sim.areas.areaOf(t);
      if (a) this.cache.delete(a);
    });
    sim.bus.on('rest.sat', () => this.begin());
    sim.bus.on('rest.stood', () => this.end());
  }


  private get st() {
    return (this.sim.state.wildlife ??= { sits: 0, log: {} });
  }

  // ───────── E23.2.4.1: diversity ─────────

  diversity(area: string): Diversity {
    const s = this.sim;
    let c = this.cache.get(area);
    if (!c) {
      const kinds = new Set<string>();
      const type = s.areas.info(area).type;
      let restored = 0;
      let bloomed = 0;
      let pollinators = 0;
      for (const t of s.areas.tiles(area)) {
        if (t.ground !== 'restored') continue;
        restored++;
        if ((t.bloom || 1) >= 2) bloomed++;
        if (t.plant) pollinators += PULSE_LOAD[PLANT_LOAD[t.plant]].pollinators;
        plantKinds(t, type, kinds, treeWorldOf(s), gameSecondsOf(s.state));
      }
      c = { kinds: [...kinds].sort(), restored, bloomed, pollinators };
      this.cache.set(area, c);
    }
    const fauna = s.ecosystem.unlocked().length;
    const homes = s.state.machines.filter((m) => DIVERSITY.homeTypes.includes(m.type) && s.areas.areaOf(m) === area).length;
    const bloomShare = c.restored ? c.bloomed / c.restored : 0;
    const score =
      c.restored < DIVERSITY.minRestored
        ? 0
        : Math.round(
            c.kinds.length * DIVERSITY.perKind +
              bloomShare * DIVERSITY.bloom +
              fauna * DIVERSITY.perFauna +
              homes * DIVERSITY.perHome +
              Math.floor(c.pollinators / 10) * DIVERSITY.perTenPollinators,
          );
    return { area, score, tier: tierOf(score, c.kinds), kinds: c.kinds, restored: c.restored, bloomShare, fauna, homes, pollinators: c.pollinators };
  }

  // ───────── E23.2.4.2: visits ─────────

  /** Where bloombot sits now (a bench's centre, a charger's footprint centre), or undefined. */
  seat(): { x: number; z: number } | undefined {
    const r = this.sim.rest.sitting;
    if (!r) return undefined;
    if (r.kind === 'bench') return { x: r.bench.x + 0.5, z: r.bench.z + 0.5 };
    const m = this.sim.machine(r.machineId);
    return m ? { x: m.x + m.size / 2, z: m.z + m.size / 2 } : undefined;
  }

  /** Plans who comes over (called when bloombot sits down). */
  begin() {
    this.visits = [];
    this.area = undefined;
    const at = this.seat();
    if (!at) return;
    const area = this.sim.areas.areaOf({ roofId: GROUND, x: Math.floor(at.x), z: Math.floor(at.z) });
    if (!area) return;
    this.area = area;
    const n = this.st.sits++;
    this.visits = planVisits(this.diversity(area).tier, `${this.sim.state.seed}|${area}|${n}`, this.sim.time, this.night());
  }

  /** Everyone sets off home (bloombot stood up). */
  end() {
    const now = this.sim.time;
    // everyone sets off now (one still on its way turns back); they are gone once they have walked or flown off
    for (const v of this.visits) if (v.leave === undefined || v.leave > now) v.leave = now;
    this.area = undefined;
  }

  private night(): boolean {
    return !this.sim.clock.gameIsDay();
  }

  /** Visitors near bloombot right now (arrived and not yet gone). */
  here(): Visit[] {
    const now = this.sim.time;
    return this.visits.filter((v) => now >= v.arrive && (v.leave === undefined || now < v.leave));
  }

  tick() {
    if (!this.visits.length) return;
    const now = this.sim.time;
    for (const v of this.visits) {
      if (now < v.arrive || v.logged || (v.leave !== undefined && v.leave <= v.arrive)) continue;
      v.logged = true;
      if (this.area) this.log(v.id, this.area);
      this.sim.bus.emit('wildlife.arrived', { id: v.id, perch: v.perch, area: this.area ?? '' });
    }
    // forget the ones that have left (bloombot stood up, or a passer-by went on its way)
    if (!this.sim.rest.sitting) this.visits = this.visits.filter((v) => v.leave === undefined || now < v.leave + VISIT.leave);
  }

  // ───────── E23.2.4.3: the visitor log ─────────

  private log(id: string, area: string) {
    const log = this.st.log;
    const first = !log[id];
    const e = (log[id] ??= { first: this.sim.time, where: [], count: 0 });
    e.count++;
    if (!e.where.includes(area)) e.where.push(area);
    this.sim.bus.emit('wildlife.logged', { id, first });
  }

  /** Every visitor kind, with what the log knows (in VISITORS order). */
  logRows(): { def: VisitorDef; seen?: { count: number; where: string[] } }[] {
    const log = this.sim.state.wildlife?.log ?? {};
    return VISITORS.map((def) => ({ def, seen: log[def.id] ? { count: log[def.id].count, where: log[def.id].where } : undefined }));
  }
}

/** The tier a score reaches. "Rare mix" also needs many kinds of plant, a region's rare plant among them. */
export function tierOf(score: number, kinds: readonly string[]): DiversityTier {
  let tier: DiversityTier = 'bare';
  for (const t of TIERS) if (t !== 'rare' && score >= DIVERSITY.tiers[t]) tier = t;
  if (tier === 'thriving' && score >= DIVERSITY.tiers.rare && kinds.length >= DIVERSITY.rareKinds && kinds.includes('rare plant')) tier = 'rare';
  return tier;
}

const rank = (t: DiversityTier) => TIERS.indexOf(t);
const rnd = (key: string) => hashString(key) / 4294967296;

/**
 * Who comes over at a tier, and where each settles (pure: the same key always gives the same visits).
 * Each visitor takes the first perch in its list that the tier allows and that is free; one that finds none
 * stays away. A bare area: a butterfly passes by, some of the time.
 */
export function planVisits(tier: DiversityTier, key: string, now: number, night: boolean): Visit[] {
  const allowed = (p: Perch) => rank(PERCH_FROM[p]) <= rank(tier);
  const count = VISIT.count[tier];
  if (tier === 'bare' && rnd(`${key}|bare`) >= VISIT.bareChance) return [];
  const pool = VISITORS.filter((v) => rank(v.from) <= rank(tier) && (!v.rare || tier === 'rare') && (!v.night || night))
    .map((v) => ({ v, r: rnd(`${key}|${v.id}`) - (v.rare ? 1 : 0) - (rank(v.from) === rank(tier) ? 0.5 : 0) })) // the tier's own (and rare) visitors first
    .sort((a, b) => a.r - b.r)
    .map((x) => x.v);
  const held = new Set<Perch>();
  const shared = new Map<Perch, number>();
  const out: Visit[] = [];
  for (const v of pool) {
    if (out.length >= count) break;
    const perch = v.perches.find((p) => allowed(p) && !(SINGLE_PERCHES.includes(p) && held.has(p)) && !(p === 'nest' && held.has('head')) && !(p === 'head' && held.has('nest')));
    if (!perch) continue;
    if (SINGLE_PERCHES.includes(perch)) held.add(perch);
    const slot = shared.get(perch) ?? 0;
    shared.set(perch, slot + 1);
    const start = now + VISIT.first + out.length * VISIT.every;
    const arrive = start + VISIT.approach;
    out.push({ id: v.id, perch, slot, from: rnd(`${key}|${v.id}|from`) * Math.PI * 2, start, arrive, leave: perch === 'passBy' ? arrive + VISIT.passSeconds : undefined });
  }
  return out;
}

/** Does a visit climb on bloombot (rather than staying beside it)? */
export const onBot = (p: Perch) => ON_BOT.includes(p);

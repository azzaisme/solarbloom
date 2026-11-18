import { areaMapFor, AreaMap, OldCityMap, PARK, SEA, type AreaInfo } from '../core/Areas';
import { regionById } from '../core/OldCityLayout';
import { GROUND, isRestorable } from '../core/GameState';
import type { AreaMode, FogState, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import { big, fmt, type Decimal } from '../core/Big';
import type { Sim } from './Sim';

type Big = Decimal;

/** Two significant figures (1,234 → 1,200; 87,654 → 88,000), so prices read cleanly. */
function roundNice(x: Decimal): Decimal {
  if (x.lte(100)) return x.ceil();
  const p = big(10).pow(Math.floor(x.log10()) - 1);
  return x.div(p).ceil().mul(p);
}

/**
 * The fog over the endless city. Every area starts hidden. When a neighbour clears, an area becomes
 * Frontier: heavy fog, and only tiles touching clear ground can be restored, so the fog recedes tile by tile.
 * Restoring thins it; once enough is restored the area's landmark can be woken, which clears it and turns its
 * hidden neighbours into Frontier. Nothing ever waits on a timer.
 */
export class AreaSystem {
  readonly map: AreaMap;

  constructor(private sim: Sim) {
    this.map = areaMapFor(sim.state.seed, sim.grid.layer(GROUND)?.gen ?? 1);
    sim.state.areas ??= { [PARK]: { fog: 'thinning', revealedAt: 0 } };
    for (const id of Object.keys(sim.state.areas)) this.placeLandmark(id);
    sim.grid.touchListeners.push((t) => {
      if (t.roofId === GROUND) this.countCache.delete(this.map.areaOfCell(t.x, t.z));
    });
  }

  /** Restored / restorable per area, recounted only after a tile in the area changed. */
  private countCache = new Map<string, { restored: number; restorable: number; fullBloom: number; growable: number }>();

  /** The landmark machine (a Core on the ground layer) of a revealed area, if placed. */
  landmark(id: string) {
    const [x, z] = this.landmarkCell(id);
    const layer = this.landmarkLayer(id);
    return this.sim.state.machines.find((m) => m.type === 'core' && m.roofId === layer && m.x === x && m.z === z);
  }

  /** City 12.1: a rooftop cluster's landmark is its roof's Core (standing right over the landmark cell). */
  private landmarkLayer(id: string): string {
    return this.map.rooftop(id) ? `roof:${id}` : GROUND;
  }

  private landmarkCell(id: string): [number, number] {
    const plan = this.map.rooftop(id);
    return plan ? plan.core : this.info(id).landmark;
  }

  /** Every revealed area has its landmark (a 2×2 Core). Idempotent. E21.4: Old City backstreets have none. */
  private placeLandmark(id: string) {
    if (this.info(id).noLandmark) return;
    if (this.landmark(id)) return;
    const s = this.sim;
    if (this.map.rooftop(id)) s.clusters.ensure(id, this.map);
    const [x, z] = this.landmarkCell(id);
    const layer = this.landmarkLayer(id);
    const m = { id: s.newId('m'), type: 'core' as const, roofId: layer, x, z, size: 2, boostUntil: 0, timer: 0, charge: 0 };
    s.state.machines.push(m);
    s.grid.indexMachine(m);
    for (const t of s.grid.footprint(layer, x, z, 2)) if (t) t.occupantId = m.id;
    this.countCache.delete(id);
  }

  info(id: string): AreaInfo {
    return this.map.info(id);
  }

  /** The area a tile or machine belongs to: by cell on the ground; a city rooftop belongs to its cluster's area. */
  areaOf(t: Pick<TileData, 'roofId' | 'x' | 'z'>): string | undefined {
    return t.roofId === GROUND ? this.map.areaOfCell(t.x, t.z) : this.sim.grid.layer(t.roofId)?.cluster;
  }

  /** A sealed area (region unlocks) is still hidden fog to everything in the game until it is bought. */
  fog(id: string): FogState {
    if ((id === SEA || id.startsWith('out_')) && this.map instanceof OldCityMap) return 'cleared'; // E21.4 / E21.26: the sea all round is always in view
    const st = this.sim.state.areas[id];
    return !st || st.sealed ? 'hidden' : st.fog;
  }

  // ───────────── region unlocks (18 Nov 2026) ─────────────

  /** Revealed next to clear ground, but sealed until the player pays its price. */
  sealed(id: string): boolean {
    return !!this.sim.state.areas[id]?.sealed;
  }

  /** Every sealed area, nearest the park first. */
  sealedAreas(): string[] {
    return Object.keys(this.sim.state.areas)
      .filter((id) => this.sealed(id))
      .sort((a, b) => this.info(a).distance - this.info(b).distance || (a < b ? -1 : 1));
  }

  /** The price to unlock a sealed area (as set when it appeared). */
  unlockCost(id: string): { biomass: Big; energy: Big } | undefined {
    const p = this.sim.state.areas[id]?.price;
    return p ? { biomass: big(p.biomass), energy: big(p.energy) } : undefined;
  }

  /** The price a newly revealed area gets: grows with areas already unlocked, and with income (see TUNING). */
  private priceNow(): { biomass: string; energy: number } {
    const U = TUNING.city.unlock;
    const s = this.sim;
    const n = Object.values(s.state.areas).filter((a) => a.unlockedAt !== undefined).length;
    const income = s.production.rates(true).biomass.mul(U.incomeSeconds);
    const biomass = big(U.biomass * Math.pow(U.growth, n)).max(income);
    const cap = s.econ.cap('energy');
    let energy = U.energy * Math.pow(U.energyGrowth, n);
    if (cap) energy = Math.min(energy, Math.floor(cap.toNumber() * U.capShare));
    return { biomass: roundNice(biomass).toString(), energy: Math.max(1, Math.round(energy)) };
  }

  /** E21.5: the Old City opens by clearing the way, never by buying it. */
  private get oldCity(): boolean {
    return this.map instanceof OldCityMap;
  }

  /** E21.5: what an Old City area's seal says: its region's gate, or (a backstreet) the region beside it. */
  sealText(id: string): string {
    const r = regionById(id);
    if (r) return `${r.name} is behind the clouds. ${r.gate.blocked}`;
    return 'Behind the clouds — open a region beside it first';
  }

  /** E21.5: after GateSystem lifts an Old City seal. */
  afterUnseal(id: string) {
    this.placeLandmark(id);
    this.countCache.delete(id);
    this.sim.bus.emit('area.revealed', { areaId: id });
  }

  /** Why an area can't be unlocked now, or undefined if it can. */
  unlockProblem(id: string): string | undefined {
    if (!this.sealed(id)) return 'Already open';
    if (this.oldCity) return this.sealText(id);
    const cost = this.unlockCost(id)!;
    const short = this.sim.econ.shortfall(cost);
    if (short) return `Needs ${fmt(cost.biomass)} 🌿 and ${fmt(cost.energy)} ⚡`;
    return undefined;
  }

  /** Pays the price and lifts the seal: the area becomes ordinary frontier fog with a guaranteed way in. */
  unlock(id: string): boolean {
    const s = this.sim;
    const why = this.unlockProblem(id);
    if (why) {
      s.bus.emit('action.failed', { reason: why });
      return false;
    }
    if (!s.econ.spend(this.unlockCost(id)!)) return false;
    const st = s.state.areas[id];
    st.sealed = undefined;
    st.price = undefined;
    st.unlockedAt = s.time;
    st.revealedAt = s.time;
    this.countCache.delete(id);
    this.ensureEntry(id);
    s.bus.emit('area.unlocked', { areaId: id });
    return true;
  }

  /** Tiles of an area (generating its chunks if needed). */
  tiles(id: string): TileData[] {
    const out: TileData[] = [];
    for (const [cx, cz] of this.info(id).chunks) {
      const c = this.sim.grid.chunkAt(GROUND, cx, cz);
      if (c) for (const t of c.tiles) if (t) out.push(t);
    }
    return out;
  }

  /** Clear ground: a cleared area, or any restored tile. Off the ground layer everything is clear. */
  isClear(t: TileData): boolean {
    if (t.roofId !== GROUND) return true;
    return t.ground === 'restored' || this.fog(this.map.areaOfCell(t.x, t.z)) === 'cleared';
  }

  /** May play change this tile? Hidden: never. Frontier/thinning: only next to clear ground (the park: anywhere). */
  canTouch(t: TileData): boolean {
    if (t.roofId !== GROUND) return true;
    const id = this.map.areaOfCell(t.x, t.z);
    const fog = this.fog(id);
    if (fog === 'hidden') return false;
    if (fog === 'cleared' || id === PARK || t.ground === 'restored') return true;
    if (this.oldCity) return true; // E21.5: an opened Old City region can be restored anywhere (no receding frontier)
    return this.sim.grid.neighbors(t).some((n) => this.isClear(n));
  }

  /** Why a tile can't be touched (tooltips, failed actions). */
  fogReason(t: TileData): string | undefined {
    if (t.roofId !== GROUND || this.canTouch(t)) return undefined;
    const id = this.map.areaOfCell(t.x, t.z);
    if (this.sealed(id) && this.oldCity) return this.sealText(id);
    if (this.sealed(id)) return `Sealed in thick fog — unlock it for ${fmt(this.unlockCost(id)!.biomass)} 🌿 and ${fmt(this.unlockCost(id)!.energy)} ⚡`;
    return this.fog(id) === 'hidden' ? 'Lost in the fog — clear a neighbouring area first' : 'Thick fog — restore a tile next to clear ground first';
  }

  // ───────────── progress ─────────────

  counts(id: string): { restored: number; restorable: number; fullBloom: number; growable: number } {
    const hit = this.countCache.get(id);
    if (hit) return hit;
    const machines = this.sim.state.machines;
    let restored = 0;
    let restorable = 0;
    let fullBloom = 0;
    let growable = 0; // free tiles that can still bloom or grow
    for (const t of this.tiles(id)) {
      if (!isRestorable(t, machines)) continue;
      restorable++;
      const full = t.ground === 'restored' && t.bloom >= TUNING.restore.fullBloom;
      if (t.ground === 'restored') {
        restored++;
        if (full) fullBloom++;
      }
      if (!full && !t.occupantId) growable++;
    }
    const c = { restored, restorable, fullBloom, growable };
    this.countCache.set(id, c);
    return c;
  }

  // ───────────── E21.9: bloombot first ─────────────

  /** Counts a tile bloombot restored itself (its own pulse), in the Old City only. */
  countBot(t: TileData) {
    if (!this.oldCity || t.roofId !== GROUND) return;
    const id = this.areaOf(t);
    const st = id ? this.sim.state.areas[id] : undefined;
    if (!st || id === PARK) return;
    st.byBot = (st.byBot ?? 0) + 1;
  }

  /** Bloombot's share of an Old City area: a quarter of the tiles that wake its landmark. */
  shareTarget(id: string): number {
    return Math.max(1, Math.ceil(this.need(id) / 4));
  }

  /** Has bloombot done its share here? */
  shareMet(id: string): boolean {
    return (this.sim.state.areas[id]?.byBot ?? 0) >= this.shareTarget(id);
  }

  /**
   * May helpers (drones, Cultivators, Mother Tree pulses) work here? Always under classic rules; in the Old City
   * only in the park, in woken regions, and where bloombot has done its share.
   */
  helpersMayWork(id: string | undefined): boolean {
    if (!this.oldCity || !id || id === PARK) return true;
    return this.fog(id) === 'cleared' || this.shareMet(id);
  }

  /** Tiles to restore before the landmark can be woken: a share of the area, capped (scaled by difficulty). */
  need(id: string): number {
    if (this.oldCity) return Math.max(1, Math.ceil(this.counts(id).restorable / 2)); // E21.9: half the region
    const c = this.counts(id);
    const cap = Math.round(TUNING.city.clearCap * this.info(id).difficulty);
    const mult = this.sim.upgrades.wakeNeedMult; // Fog Lanterns
    return Math.max(1, Math.ceil(Math.min(c.restorable * TUNING.city.clearShare, cap) * mult));
  }

  /** 0 = untouched, 1 = everything restored. */
  share(id: string): number {
    const c = this.counts(id);
    return c.restored / Math.max(1, c.restorable);
  }

  /** Fog density for presentation: 1 heavy … fogThin just before clearing, 0 when cleared. */
  density(id: string): number {
    const fog = this.fog(id);
    if (fog === 'cleared') return 0;
    if (fog === 'hidden') return TUNING.city.fogFull;
    const k = Math.min(1, this.counts(id).restored / this.need(id));
    return TUNING.city.fogFull + (TUNING.city.fogThin - TUNING.city.fogFull) * k;
  }

  /** The landmark can be woken: enough restored, its specialty action done (City 09.1), not yet cleared. */
  ready(id: string): boolean {
    const f = this.fog(id);
    // E21.9: an Old City region is ready when half of it is restored and its Keeper's second request is done
    if (this.oldCity) {
      const r = regionById(id);
      return !!r && (f === 'frontier' || f === 'thinning') && this.counts(id).restored >= this.need(id) && this.sim.keepers.step(r.keeper) === 'landmark';
    }
    return (f === 'frontier' || f === 'thinning') && this.counts(id).restored >= this.need(id) && this.sim.milestones.met(id);
  }

  /** Announces an area that has just become ready (once). */
  checkReady(id: string) {
    if (this.ready(id) && !this.announced.has(id)) {
      this.announced.add(id);
      this.sim.bus.emit('area.ready', { areaId: id });
    }
  }

  /** A ground tile was restored: its area's fog starts thinning. */
  onRestored(t: TileData) {
    if (t.roofId === GROUND) this.sim.keepers?.onRestored(t.x, t.z); // E21.8: a Keeper's patch
    const id = this.areaOf(t);
    if (!id) return;
    const st = this.sim.state.areas[id];
    if (st?.fog === 'frontier') {
      st.fog = 'thinning';
      this.sim.bus.emit('area.fogChanged', { areaId: id, fog: 'thinning' });
    }
    this.checkSteps(id);
    this.checkReady(id);
  }

  /**
   * Phase 5 E12: rewarded steps at 25 / 50 / 75% of the tiles a landmark needs (not the park: it has its own
   * milestones). Marked paid before paying, so a reload can never pay twice; unique restored tiles only.
   */
  checkSteps(id: string) {
    const st = this.sim.state.areas[id];
    if (!st || id === PARK || st.fog === 'cleared') return;
    const A = TUNING.areaSteps;
    const share = this.counts(id).restored / this.need(id);
    const s = this.sim;
    while ((st.steps ?? 0) < A.at.length && share >= A.at[st.steps ?? 0]) {
      const step = st.steps ?? 0;
      st.steps = step + 1;
      const bio = s.production.rates(true).biomass.mul(A.incomeSeconds[step]).max(A.min);
      const credited = { biomass: s.econ.add('biomass', bio), energy: s.econ.add('energy', A.energy), water: s.econ.add('water', A.water) };
      s.bus.emit('area.step', { areaId: id, step: step + 1, share: A.at[step], credited });
    }
  }
  private announced = new Set<string>();

  /** Wakes an area's landmark: clears its fog (claimed once, before anything else) and reveals its neighbours. */
  clear(id: string, force = false): boolean {
    const s = this.sim;
    if (!force && !this.ready(id)) {
      s.bus.emit('action.failed', { reason: this.fog(id) === 'cleared' ? 'Already clear' : this.counts(id).restored >= this.need(id) ? `The landmark wants something more: ${this.sim.milestones.specialty(id).label}` : 'Restore more of this area first' });
      return false;
    }
    if (this.fog(id) === 'cleared') return false;
    const st = (s.state.areas[id] ??= { fog: 'thinning', revealedAt: s.time });
    st.fog = 'cleared';
    st.clearedAt = s.time;
    this.typeCache = undefined;
    s.upgrades.applyCaps();
    s.bus.emit('area.cleared', { areaId: id });
    for (const nb of this.info(id).neighbours) this.reveal(nb);
    // No production re-sum: tile rates don't depend on fog, and the area bonus is read live by rates().
    return true;
  }

  /** Hidden → Frontier, guaranteeing a way in. */
  reveal(id: string) {
    const s = this.sim;
    if (s.state.areas[id]) return;
    if (this.map instanceof OldCityMap && (id === SEA || id.startsWith('out_'))) return; // E21.4: the sea and the cloud beyond
    s.state.areas[id] = { fog: 'frontier', revealedAt: s.time };
    // E21.5: in the Old City a revealed area stays sealed (no price) until its gate is opened
    if (this.oldCity && id !== PARK) s.state.areas[id].sealed = true;
    else if (TUNING.city.unlock.enabled && id !== PARK) Object.assign(s.state.areas[id], { sealed: true, price: this.priceNow() });
    this.placeLandmark(id);
    if (!this.sealed(id)) this.ensureEntry(id);
    s.bus.emit('area.revealed', { areaId: id });
  }

  /** Tiles of a fogged area that can be restored right now. */
  entryTiles(id: string): TileData[] {
    return this.tiles(id).filter((t) => !t.blocked && !t.occupantId && t.ground !== 'restored' && this.canTouch(t));
  }

  /**
   * Reachability guarantee: a Frontier area always has at least one restorable tile on an edge it shares with
   * clear ground. If generated obstacles cover that whole edge, one of them is cleared (and saved).
   */
  ensureEntry(id: string): boolean {
    if (this.entryTiles(id).length) return false;
    const edge = this.tiles(id).filter((t) => t.blocked && this.sim.grid.neighbors(t).some((n) => this.isClear(n)));
    const t = edge[0];
    if (!t) return false;
    t.blocked = false;
    t.unblocked = true;
    this.sim.transitions.unblock(t);
    this.sim.grid.touch(t);
    return true;
  }

  /**
   * The next goal in the city: an area whose landmark can be woken (nearest the park first), otherwise the
   * fogged area that is furthest along, otherwise the nearest frontier.
   */
  nextGoal(): string | undefined {
    const open = this.revealed().filter((id) => this.fog(id) !== 'cleared' && id !== PARK);
    if (!open.length) return undefined;
    const ready = open.filter((id) => this.ready(id)).sort((a, b) => this.info(a).distance - this.info(b).distance);
    if (ready.length) return ready[0];
    return open.sort((a, b) => this.share(b) - this.share(a) || this.info(a).distance - this.info(b).distance || (a < b ? -1 : 1))[0];
  }

  /** Cleared areas other than the park, by type (cached until the next clear). */
  clearedByType(): Record<string, number> {
    if (this.typeCache) return this.typeCache;
    const out: Record<string, number> = {};
    for (const [id, st] of Object.entries(this.sim.state.areas)) if (st.fog === 'cleared' && id !== PARK) out[this.info(id).type] = (out[this.info(id).type] ?? 0) + 1;
    this.typeCache = out;
    return out;
  }
  private typeCache?: Record<string, number>;

  clearedCount(): number {
    return Object.values(this.clearedByType()).reduce((a, b) => a + b, 0);
  }

  /** Permanent income from cleared areas (soft-scaled per type). */
  bonusIncome(): { energy: number; water: number; biomass: number } {
    // Cached until the cleared set or Lit Landmarks changes (asked every tick by production).
    const types = this.clearedByType();
    const mult = this.sim.upgrades.landmarkBonusMult;
    if (this.bonusCache && this.bonusCache.types === types && this.bonusCache.mult === mult) return this.bonusCache.out;
    const out = this.computeBonus();
    this.bonusCache = { types, mult, out };
    return out;
  }
  private bonusCache?: { types: Record<string, number>; mult: number; out: { energy: number; water: number; biomass: number } };

  private computeBonus(): { energy: number; water: number; biomass: number } {
    const out = { energy: 0, water: 0, biomass: 0 };
    const C = TUNING.city;
    for (const [type, n] of Object.entries(this.clearedByType())) {
      const b = C.bonuses[type] ?? {};
      const k = Math.pow(n, C.bonusExponent) * this.sim.upgrades.landmarkBonusMult;
      for (const r of ['energy', 'water', 'biomass'] as const) out[r] += (b[r] ?? 0) * k;
    }
    return out;
  }

  /** Extra storage share from cleared areas (diminishing). */
  storageBonus(): number {
    return TUNING.city.storagePerArea * Math.pow(this.clearedCount(), TUNING.city.storageExponent);
  }

  /** An area's automation switch (undefined = normal). */
  mode(id: string | undefined): AreaMode | undefined {
    return id ? this.sim.state.areas[id]?.mode : undefined;
  }

  /** Sets an area's automation switch (a revealed area only); undefined goes back to normal. */
  setMode(id: string, mode: AreaMode | undefined): boolean {
    const st = this.sim.state.areas[id];
    if (!st) return false;
    if (mode) st.mode = mode;
    else delete st.mode;
    this.sim.bus.emit('area.modeChanged', { areaId: id, mode });
    return true;
  }

  /** Revealed areas (frontier, thinning or cleared). Sealed areas are left out: they are still fog (sealedAreas()). */
  revealed(): string[] {
    const a = this.sim.state.areas;
    return Object.keys(a).filter((id) => !a[id].sealed);
  }
}

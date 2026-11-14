import { areaMapFor, AreaMap, PARK, type AreaInfo } from '../core/Areas';
import { GROUND, isRestorable } from '../core/GameState';
import type { AreaMode, FogState, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/**
 * The fog over the endless city. Every area starts hidden. When a neighbour clears, an area becomes
 * Frontier: heavy fog, and only tiles touching clear ground can be restored, so the fog recedes tile by tile.
 * Restoring thins it; once enough is restored the area's landmark can be woken, which clears it and turns its
 * hidden neighbours into Frontier. Nothing ever waits on a timer.
 */
export class AreaSystem {
  readonly map: AreaMap;

  constructor(private sim: Sim) {
    this.map = areaMapFor(sim.state.seed);
    sim.state.areas ??= { [PARK]: { fog: 'thinning', revealedAt: 0 } };
    for (const id of Object.keys(sim.state.areas)) this.placeLandmark(id);
    sim.grid.touchListeners.push((t) => {
      if (t.roofId === GROUND) this.countCache.delete(this.map.areaOfCell(t.x, t.z));
    });
  }

  /** Restored / restorable per area, recounted only after a tile in the area changed. */
  private countCache = new Map<string, { restored: number; restorable: number }>();

  /** The landmark machine (a Core on the ground layer) of a revealed area, if placed. */
  landmark(id: string) {
    const [x, z] = this.info(id).landmark;
    return this.sim.state.machines.find((m) => m.type === 'core' && m.roofId === GROUND && m.x === x && m.z === z);
  }

  /** Every revealed area has its landmark (a 2×2 Core). Idempotent. */
  private placeLandmark(id: string) {
    if (this.landmark(id)) return;
    const [x, z] = this.info(id).landmark;
    const s = this.sim;
    const m = { id: s.newId('m'), type: 'core' as const, roofId: GROUND, x, z, size: 2, boostUntil: 0, timer: 0, charge: 0 };
    s.state.machines.push(m);
    s.grid.indexMachine(m);
    for (const t of s.grid.footprint(GROUND, x, z, 2)) if (t) t.occupantId = m.id;
    this.countCache.delete(id);
  }

  info(id: string): AreaInfo {
    return this.map.info(id);
  }

  areaOf(t: Pick<TileData, 'roofId' | 'x' | 'z'>): string | undefined {
    return t.roofId === GROUND ? this.map.areaOfCell(t.x, t.z) : undefined;
  }

  fog(id: string): FogState {
    return this.sim.state.areas[id]?.fog ?? 'hidden';
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
    return this.sim.grid.neighbors(t).some((n) => this.isClear(n));
  }

  /** Why a tile can't be touched (tooltips, failed actions). */
  fogReason(t: TileData): string | undefined {
    if (t.roofId !== GROUND || this.canTouch(t)) return undefined;
    return this.fog(this.map.areaOfCell(t.x, t.z)) === 'hidden' ? 'Lost in the fog — clear a neighbouring area first' : 'Thick fog — restore a tile next to clear ground first';
  }

  // ───────────── progress ─────────────

  counts(id: string): { restored: number; restorable: number } {
    const hit = this.countCache.get(id);
    if (hit) return hit;
    const machines = this.sim.state.machines;
    let restored = 0;
    let restorable = 0;
    for (const t of this.tiles(id)) {
      if (!isRestorable(t, machines)) continue;
      restorable++;
      if (t.ground === 'restored') restored++;
    }
    const c = { restored, restorable };
    this.countCache.set(id, c);
    return c;
  }

  /** Tiles to restore before the landmark can be woken: a share of the area, capped (scaled by difficulty). */
  need(id: string): number {
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

  /** The landmark can be woken (milestone met, area not yet cleared). City 09 adds specialty actions. */
  ready(id: string): boolean {
    const f = this.fog(id);
    return (f === 'frontier' || f === 'thinning') && this.counts(id).restored >= this.need(id);
  }

  /** A ground tile was restored: its area's fog starts thinning. */
  onRestored(t: TileData) {
    const id = this.areaOf(t);
    if (!id) return;
    const st = this.sim.state.areas[id];
    if (st?.fog === 'frontier') {
      st.fog = 'thinning';
      this.sim.bus.emit('area.fogChanged', { areaId: id, fog: 'thinning' });
    }
    if (this.ready(id) && !this.announced.has(id)) {
      this.announced.add(id);
      this.sim.bus.emit('area.ready', { areaId: id });
    }
  }
  private announced = new Set<string>();

  /** Wakes an area's landmark: clears its fog (claimed once, before anything else) and reveals its neighbours. */
  clear(id: string, force = false): boolean {
    const s = this.sim;
    if (!force && !this.ready(id)) {
      s.bus.emit('action.failed', { reason: this.fog(id) === 'cleared' ? 'Already clear' : 'Restore more of this area first' });
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
    s.state.areas[id] = { fog: 'frontier', revealedAt: s.time };
    this.placeLandmark(id);
    this.ensureEntry(id);
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

  /** Revealed areas (frontier, thinning or cleared). */
  revealed(): string[] {
    return Object.keys(this.sim.state.areas);
  }
}

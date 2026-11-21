import { isMainlandArea } from '../core/Mainland';
import { areaMapFor, AreaMap, PARK, SEA, type AreaInfo } from '../core/Areas';
import { regionById } from '../core/OldCityLayout';
import { GROUND, isRestorable } from '../core/GameState';
import type { AreaMode, FogState, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';


/**
 * The fog over the Old City. Every area starts hidden. When a neighbour clears, an area comes into view sealed
 * behind its gate (the mainland's districts open straight away). An open region can be restored anywhere;
 * restoring thins its fog, and once half is restored and its Keeper asks, its landmark wakes and clears it.
 * Nothing ever waits on a timer.
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

  /** The landmark machine (a 2×2 Core on the ground) of a revealed area, if placed. */
  landmark(id: string) {
    const [x, z] = this.info(id).landmark;
    return this.sim.state.machines.find((m) => m.type === 'core' && m.roofId === GROUND && m.x === x && m.z === z);
  }

  /** Every revealed area has its landmark (a 2×2 Core). Idempotent. E21.4: Old City backstreets have none. */
  private placeLandmark(id: string) {
    if (this.info(id).noLandmark) return;
    if (this.landmark(id)) return;
    const s = this.sim;
    const [x, z] = this.info(id).landmark;
    const m = { id: s.newId('m'), type: 'core' as const, roofId: GROUND, x, z, size: 2, boostUntil: 0, timer: 0, charge: 0 };
    s.state.machines.push(m);
    s.grid.indexMachine(m);
    for (const t of s.grid.footprint(GROUND, x, z, 2)) if (t) t.occupantId = m.id;
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
    if (id === SEA || id.startsWith('out_')) return 'cleared'; // E21.4 / E21.26: the sea all round is always in view
    const st = this.sim.state.areas[id];
    return !st || st.sealed ? 'hidden' : st.fog;
  }

  // ───────────── region unlocks (18 Nov 2026) ─────────────

  /** Revealed next to clear ground, but sealed until its gate opens (GateSystem). Nothing is ever bought. */
  sealed(id: string): boolean {
    return !!this.sim.state.areas[id]?.sealed;
  }

  /** Every sealed area, nearest the park first. */
  sealedAreas(): string[] {
    return Object.keys(this.sim.state.areas)
      .filter((id) => this.sealed(id))
      .sort((a, b) => this.info(a).distance - this.info(b).distance || (a < b ? -1 : 1));
  }


  /**
   * E21.5: what an Old City area's seal says: its region's gate, or (a backstreet) the region beside it. #606: where
   * it is and what to do, in plain words (the gate's own `how`).
   */
  sealText(id: string): string {
    const r = regionById(id);
    if (r) return `${r.name} is behind the clouds. ${r.gate.how}`;
    return 'The clouds hide this street. Open the way into a place beside it first.';
  }

  /** E21.5: after GateSystem lifts an Old City seal. */
  afterUnseal(id: string) {
    this.placeLandmark(id);
    this.countCache.delete(id);
    this.sim.bus.emit('area.revealed', { areaId: id });
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

  /** May play change this tile? Hidden fog: never. A revealed region: anywhere (E21.5: no receding frontier). */
  canTouch(t: TileData): boolean {
    if (t.roofId !== GROUND) return true;
    const id = this.map.areaOfCell(t.x, t.z);
    const fog = this.fog(id);
    if (fog === 'hidden') return false;
    return true; // E21.5: a revealed region can be restored anywhere (no receding frontier); gates keep bloombot out of sealed ones
  }

  /** Why a tile can't be touched (tooltips, failed actions). */
  fogReason(t: TileData): string | undefined {
    if (t.roofId !== GROUND || this.canTouch(t)) return undefined;
    const id = this.map.areaOfCell(t.x, t.z);
    if (this.sealed(id)) return this.sealText(id);
    return this.fog(id) === 'hidden' ? 'The fog is too thick here. Bring the place next to it back to life first.' : 'Thick fog. Pulse the ground next to the living ground to push it back.';
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

  /** Counts a tile bloombot restored itself (its own pulse). */
  countBot(t: TileData) {
    if (t.roofId !== GROUND) return;
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

  /** May helpers (drones, Cultivators, Mother Tree pulses) work here? In the park, in woken regions, and where bloombot has done its share (E21.9). */
  helpersMayWork(id: string | undefined): boolean {
    if (!id || id === PARK) return true;
    return this.fog(id) === 'cleared' || this.shareMet(id);
  }

  /** Tiles to restore before the landmark can be woken: half the region (E21.9), less with Fog Lanterns. */
  need(id: string): number {
    return Math.max(1, Math.ceil((this.counts(id).restorable / 2) * this.sim.upgrades.wakeNeedMult));
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

  /** E21.9: a region's landmark can be woken: half of it restored and its Keeper's second request done, not yet cleared. */
  ready(id: string): boolean {
    const f = this.fog(id);
    const r = regionById(id);
    return !!r && (f === 'frontier' || f === 'thinning') && this.counts(id).restored >= this.need(id) && this.sim.keepers.step(r.keeper) === 'landmark';
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
    this.checkReady(id);
  }

  private announced = new Set<string>();

  /** Wakes an area's landmark: clears its fog (claimed once, before anything else) and reveals its neighbours. */
  clear(id: string, force = false): boolean {
    const s = this.sim;
    if (!force && !this.ready(id)) {
      s.bus.emit('action.failed', { reason: this.fog(id) === 'cleared' ? 'Already clear' : 'Pulse more of the ground here green first' });
      return false;
    }
    if (this.fog(id) === 'cleared') return false;
    const st = (s.state.areas[id] ??= { fog: 'thinning', revealedAt: s.time });
    st.fog = 'cleared';
    st.clearedAt = s.time;
    this.typeCache = undefined;
    s.bus.emit('area.cleared', { areaId: id });
    for (const nb of this.info(id).neighbours) this.reveal(nb);
    return true;
  }

  /** Hidden → in view (sealed behind its gate, except on the mainland). */
  reveal(id: string) {
    const s = this.sim;
    if (s.state.areas[id]) return;
    if (id === SEA || id.startsWith('out_')) return; // E21.4: the sea and the cloud beyond
    s.state.areas[id] = { fog: 'frontier', revealedAt: s.time };
    // E21.5: in the Old City a revealed area stays sealed until its gate is opened (E23.1.5: fog is never bought)
    // E23.8.3.1: the mainland has no gates and no prices: past the causeway, restoring a district reveals the next, open
    if (id !== PARK && !isMainlandArea(id)) s.state.areas[id].sealed = true;
    this.placeLandmark(id);
    s.bus.emit('area.revealed', { areaId: id });
  }

  /** Tiles of a fogged area that can be restored right now. */
  entryTiles(id: string): TileData[] {
    return this.tiles(id).filter((t) => !t.blocked && !t.occupantId && t.ground !== 'restored' && this.canTouch(t));
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

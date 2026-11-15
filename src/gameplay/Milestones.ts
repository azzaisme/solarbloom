import { PARK } from '../core/Areas';
import { GROUND } from '../core/GameState';
import { distToFootprint } from '../core/Grid';
import type { TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export type SpecialtyKind = 'fullBloom' | 'corridor' | 'solarBoost' | 'canalFlow' | 'chain' | 'overflow' | 'canopy' | 'roofBloom';

export interface Specialty {
  kind: SpecialtyKind;
  need: number;
  have: number;
  met: boolean;
  /** checklist line, e.g. "Set off a green corridor (0/1)" */
  label: string;
  /** one line on how */
  hint: string;
}

/** A canal flow plan: two bank tiles joined by the area's own water (a garden at one end, a condenser at the other). */
export interface CanalPlan {
  garden: [number, number];
  condenser: [number, number];
  /** water tiles joining them, in order */
  path: [number, number][];
}

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * City 09.1: the area milestone generator. Besides restoring a share of its tiles, each area's landmark asks for
 * one specialty action of its type (data: TUNING.milestones), sized by distance from the park with a cap.
 * The generator checks the area's own layout first: a type whose action the layout can't support (no water
 * to carry a canal flow, no paving for a corridor…) falls back to growing a share of its tiles to full bloom,
 * which is always possible. Progress is counted from game events while the area is in fog and saved.
 */
export class MilestoneSystem {
  private kindCache = new Map<string, SpecialtyKind>();
  private planCache = new Map<string, CanalPlan | null>();

  constructor(private sim: Sim) {
    const bus = sim.bus;
    const areaOfMachine = (id: string) => {
      const m = sim.machine(id);
      return m ? sim.areas.areaOf(m) : undefined;
    };
    bus.on('corridor.sent', ({ from }) => this.bump(areaOfMachine(from), 'corridor'));
    bus.on('solar.boost', ({ machineId }) => this.bump(areaOfMachine(machineId), 'solarBoost'));
    bus.on('reservoir.overflow', ({ machineId }) => this.bump(areaOfMachine(machineId), 'overflow'));
    bus.on('canopy.burst', ({ machineId }) => this.bump(areaOfMachine(machineId), 'canopy'));
    bus.on('canal.flow', ({ from, to }) => {
      const a = areaOfMachine(from);
      const b = areaOfMachine(to);
      this.bump(a, 'canalFlow');
      if (b !== a) this.bump(b, 'canalFlow');
    });
    bus.on('chain.ended', ({ combo, areaIds }) => {
      for (const id of areaIds ?? []) {
        if (this.kind(id) !== 'chain' || !this.counting(id)) continue;
        const st = sim.state.areas[id]!;
        if (combo > (st.spec ?? 0)) {
          st.spec = combo;
          this.progressed(id);
        }
      }
    });
    // Full bloom and rooftop restores are counted live: any tile change can complete them.
    sim.grid.touchListeners.push((t) => {
      const cl = t.roofId !== GROUND ? sim.grid.layer(t.roofId)?.cluster : undefined;
      if (cl && t.ground === 'restored' && this.counting(cl)) this.pending.add(cl);
      if (t.roofId !== GROUND || t.ground !== 'restored' || t.bloom < TUNING.restore.fullBloom) return;
      const id = sim.areas.map.areaOfCell(t.x, t.z);
      if (this.counting(id) && this.kind(id) === 'fullBloom') this.pending.add(id);
    });
  }
  /** Full-bloom areas to re-check at the next tick (touches happen mid-chain). */
  private pending = new Set<string>();

  tick() {
    if (!this.pending.size) return;
    for (const id of this.pending) this.progressed(id);
    this.pending.clear();
  }

  /** Counted only while the area is in fog (frontier or thinning) and not the park. */
  private counting(id: string | undefined): id is string {
    if (!id || id === PARK) return false;
    const f = this.sim.areas.fog(id);
    return f === 'frontier' || f === 'thinning';
  }

  private bump(id: string | undefined, kind: SpecialtyKind) {
    if (!this.counting(id) || this.kind(id) !== kind) return;
    const st = this.sim.state.areas[id]!;
    st.spec = (st.spec ?? 0) + 1;
    this.progressed(id);
  }

  private announced = new Set<string>();
  private progressed(id: string) {
    const sp = this.specialty(id);
    this.sim.bus.emit('area.specialty', { areaId: id, have: sp.have, need: sp.need, met: sp.met });
    if (sp.met && !this.announced.has(id)) {
      this.announced.add(id);
      this.sim.areas.checkReady(id);
    }
  }

  // ───────────── the generator ─────────────

  /** The specialty kind an area asks for: its type's, unless its layout can't support it. */
  kind(id: string): SpecialtyKind {
    const hit = this.kindCache.get(id);
    if (hit) return hit;
    const def = TUNING.milestones[this.sim.areas.info(id).type];
    const k: SpecialtyKind = def && this.supports(id, def.kind) ? def.kind : 'fullBloom';
    this.kindCache.set(id, k);
    return k;
  }

  /** Size before the share cap: base + perChunk × distance, capped. */
  private size(id: string, kind: SpecialtyKind): number {
    const a = this.sim.areas.info(id);
    const def = TUNING.milestones[a.type];
    const d = def && def.kind === kind ? def : TUNING.milestones.park;
    let n = Math.min(d.max, Math.floor(d.base + d.perChunk * a.distance));
    if (d.share !== undefined) n = Math.min(n, Math.floor((kind === 'roofBloom' ? this.sim.clusters.counts(id).restorable : this.sim.areas.counts(id).restorable) * d.share));
    return Math.max(1, n);
  }

  /** Does the area's own generated layout allow this action (ignoring machines and fog)? */
  supports(id: string, kind: SpecialtyKind): boolean {
    const s = this.sim;
    const tiles = s.areas.tiles(id).filter((t) => !t.blocked);
    const free = (t: TileData) => !t.blocked && t.feature !== 'water' && !s.isCoreTile(t);
    switch (kind) {
      case 'fullBloom':
      case 'chain':
        return true; // shares of restorable tiles
      case 'roofBloom':
        return !!s.areas.map.rooftop(id);
      case 'solarBoost':
        // A panel spot with a restorable tile beside it.
        return tiles.some((t) => free(t) && s.grid.neighbors(t).some((n) => !n.blocked && !s.isCoreTile(n) && s.areas.areaOf(n) === id));
      case 'overflow': {
        // A garden spot with a condenser spot within reach (both in the area).
        const R = TUNING.neighbourhood.reservoir.condenserRange;
        return tiles.some((g) => free(g) && s.grid.tilesNear({ roofId: GROUND, x: g.x, z: g.z, size: 1 }, R).some((c) => free(c) && s.areas.areaOf(c) === id));
      }
      case 'corridor': {
        // Two street/path spots in the area, close together (well inside corridor range).
        const paved = (t: TileData | undefined): t is TileData => !!t && free(t) && (t.feature === 'road' || t.feature === 'paving') && s.areas.areaOf(t) === id;
        const offs = [[1, 0], [0, 1], [2, 0], [0, 2], [1, 1], [-1, 1]];
        return tiles.some((a) => paved(a) && offs.some(([dx, dz]) => paved(s.grid.get(GROUND, a.x + dx, a.z + dz))));
      }
      case 'canopy': {
        const lm = s.areas.landmark(id) ?? { type: 'core' as const, roofId: GROUND, x: s.areas.info(id).landmark[0], z: s.areas.info(id).landmark[1] };
        if (!s.chains.isElder(lm)) return false;
        const [x, z] = s.areas.info(id).landmark;
        const r = TUNING.neighbourhood.canopy.chargeRadius;
        // Enough ground around the tree to charge it (each tile blooms, then grows twice).
        return s.grid.tilesNear({ roofId: GROUND, x, z, size: 2 }, r).filter((t) => !t.blocked).length * 3 >= TUNING.neighbourhood.canopy.threshold * 2;
      }
      case 'canalFlow':
        return !!this.canalPlan(id);
    }
  }

  /**
   * A canal flow the area's own water can carry: two land tiles beside the area's water, joined by the shortest
   * stretch of it that keeps the condenser's bank out of reach of the garden (so the water must use the canal).
   * Static.
   */
  canalPlan(id: string): CanalPlan | undefined {
    if (this.planCache.has(id)) return this.planCache.get(id) ?? undefined;
    const s = this.sim;
    const g = s.grid;
    const inArea = (t: TileData | undefined): t is TileData => !!t && s.areas.areaOf(t) === id;
    const water = s.areas.tiles(id).filter((t) => t.feature === 'water' && !t.blocked);
    const isWater = (t: TileData | undefined): t is TileData => inArea(t) && t.feature === 'water' && !t.blocked;
    const land = (t: TileData | undefined): t is TileData => inArea(t) && !t.blocked && t.feature !== 'water' && !s.isCoreTile(t);
    let best: CanalPlan | undefined;
    let bestLen = 0;
    const seen = new Set<string>();
    for (const start of water) {
      if (seen.has(start.id)) continue;
      // BFS over one connected body of water, remembering paths.
      const prev = new Map<string, string | null>([[start.id, null]]);
      const order = [start];
      for (let i = 0; i < order.length; i++) {
        const t = order[i];
        seen.add(t.id);
        for (const [dx, dz] of ORTHO) {
          const n = g.get(GROUND, t.x + dx, t.z + dz);
          if (isWater(n) && !prev.has(n.id)) {
            prev.set(n.id, t.id);
            order.push(n);
          }
        }
      }
      // A bank tile for each water tile (first land neighbour, deterministic).
      const bankOf = (t: TileData) => [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dz]) => g.get(GROUND, t.x + dx, t.z + dz)).find(land);
      const banked = order.filter((t) => bankOf(t));
      if (banked.length < 2) continue;
      // The shortest workable flow: from the first banked tile (in world order), the nearest banked tile along the
      // water whose bank is out of the condenser's own reach. Short paths mean little water to restore.
      const R = TUNING.neighbourhood.reservoir.condenserRange;
      const a = [...banked].sort((p, q) => p.z - q.z || p.x - q.x)[0];
      const ga = bankOf(a)!;
      const par = new Map<string, TileData | null>([[a.id, null]]);
      const q = [a];
      let end: TileData | undefined;
      for (let i = 0; i < q.length && !end; i++) {
        const t = q[i];
        const b = bankOf(t);
        if (b && distToFootprint(b.x, b.z, ga.x, ga.z, 1) > R) {
          end = t;
          break;
        }
        for (const [dx, dz] of ORTHO) {
          const n = g.get(GROUND, t.x + dx, t.z + dz);
          if (isWater(n) && !par.has(n.id)) {
            par.set(n.id, t);
            q.push(n);
          }
        }
      }
      if (!end) continue;
      const path: TileData[] = [];
      for (let t: TileData | null = end; t; t = par.get(t.id) ?? null) path.push(t);
      path.reverse();
      if (!best || path.length < bestLen) {
        const cb = bankOf(end)!;
        bestLen = path.length;
        best = { garden: [ga.x, ga.z], condenser: [cb.x, cb.z], path: path.map((t) => [t.x, t.z]) };
      }
    }
    this.planCache.set(id, best ?? null);
    return best;
  }

  // ───────────── status ─────────────

  specialty(id: string): Specialty {
    const kind = this.kind(id);
    const need = this.size(id, kind);
    const s = this.sim;
    const st = s.state.areas[id];
    const cleared = s.areas.fog(id) === 'cleared';
    let have = st?.spec ?? 0;
    if (kind === 'fullBloom') have = Math.max(have, s.areas.counts(id).fullBloom);
    if (kind === 'roofBloom') have = Math.max(have, s.clusters.counts(id).restored);
    // Safety valve: once every free tile here is in full bloom nothing can happen any more, so the landmark is
    // content with that (a fully bloomed area never stalls).
    const c = s.areas.counts(id);
    const met = cleared || have >= need || (c.restored >= s.areas.need(id) && (c.growable === 0 || this.stuck(id, kind)));
    const shown = Math.min(have, need);
    const text: Record<SpecialtyKind, [string, string]> = {
      fullBloom: [`Grow ${need} tiles to full bloom (${shown}/${need})`, 'Pulse green tiles here to grow them, or let gardens and drones nurture them.'],
      corridor: [`Pass a chain along a green corridor${need > 1 ? ` ${need} times` : ''} (${shown}/${need})`, 'Build two Pollinator Gardens on the paving here, close together, and start a chain beside one.'],
      solarBoost: [`Boost a Solar Panel with a bloom ${need} times (${shown}/${need})`, 'Build a Solar Panel here and restore or grow the tiles right next to it.'],
      canalFlow: [`Send water along the canal${need > 1 ? ` ${need} times` : ''} (${shown}/${need})`, 'Restore the canal water, then build a Reservoir Garden on one bank and a Water Condenser further along.'],
      chain: [`Set off a ×${need} Bloom Chain here (best ×${have})`, 'Build Pollinator Gardens here and pulse next to them: their blooms set each other off.'],
      overflow: [`Overflow a Reservoir Garden here${need > 1 ? ` ${need} times` : ''} (${shown}/${need})`, 'Build a Reservoir Garden here with a Water Condenser within 2 tiles to fill its basin.'],
      roofBloom: [`Restore ${need} tiles on the rooftop (${shown}/${need})`, 'Build a Bloom Relay on the street within reach of the rooftop to get up there, then restore its tiles.'],
      canopy: [`Release a Canopy Burst from the Elder Tree (${shown}/${need})`, 'Restore and grow the tiles around the Elder Tree: every bloom within 3 tiles charges it.'],
    };
    return { kind, need, have, met, label: text[kind][0], hint: text[kind][1] };
  }

  /**
   * Safety valve for actions that need room to bloom beside a machine (corridor, solar boost, chain): stuck
   * when none of the area's machines of that type has a tile beside it that can still bloom, and a new one
   * costs more than storage can ever hold right now. Then the landmark settles for the restored share.
   */
  private stuck(id: string, kind: SpecialtyKind): boolean {
    const s = this.sim;
    const tooDear = (type: 'relay' | 'droneHub' | 'solar' | 'pollinator') => {
      const cost = s.build.cost(type);
      return (['energy', 'water', 'biomass'] as const).some((k) => (cost[k] ?? 0) > s.state.caps[k]);
    };
    if (kind === 'roofBloom') {
      // The roof can't be reached and the relay that would reach it can never be afforded right now.
      const roof = s.clusters.roof(id);
      if (!roof || s.grid.isPlayable(roof.id)) return false;
      return s.build.isUnlocked('relay') ? tooDear('relay') : tooDear('droneHub');
    }
    const type = kind === 'solarBoost' ? 'solar' : kind === 'corridor' || kind === 'chain' ? 'pollinator' : undefined;
    if (!type) return false;
    const max = TUNING.restore.maxBloom;
    const roomy = s.state.machines.some(
      (m) =>
        m.type === type &&
        s.areas.areaOf(m) === id &&
        s.grid.tilesNear(m, 1).some((n) => s.restoration.isEligible(n) || (n.ground === 'restored' && !n.occupantId && n.bloom < max)),
    );
    if (roomy) return false;
    const cost = s.build.cost(type);
    return (['energy', 'water', 'biomass'] as const).some((k) => (cost[k] ?? 0) > s.state.caps[k]);
  }

  /** The landmark's specialty is done (always true for the park and cleared areas). */
  met(id: string): boolean {
    if (id === PARK || !this.sim.grid.isPlayable(GROUND)) return true;
    return this.specialty(id).met;
  }
}

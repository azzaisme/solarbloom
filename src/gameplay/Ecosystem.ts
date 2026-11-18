import { CHUNK } from '../core/Hash';
import { decorKey } from '../core/Decor';
import { GROUND } from '../core/GameState';
import { generateTile } from '../core/Generation';
import { bloomCounts } from '../core/TilePack';
import type { Chunk } from '../core/Grid';
import type { TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import { isBuilt } from '../data/machines';
// Pure, deterministic placement (type-only imports from TreeGen): the same tree tiles the renderer draws.
import { treeSpot } from '../rendering/TreePlacement';
import type { Sim } from './Sim';

/**
 * Phase 5 E16: the living ecosystem, simulation side.
 *
 * - **Biodiversity** is a score derived from the world (tile stages, tree species and ground kinds in bloom,
 *   landmarks woken, superstructures built, fauna that has arrived). It is never stored, never spent and never
 *   feeds production: it is a progress readout.
 * - **Fauna unlocks** are one-time flags (`state.fauna`, sim time of arrival) set when a configurable condition
 *   first holds (TUNING.ecosystem.fauna). An unlock only changes what the renderer shows; it pays nothing.
 *
 * Counting is incremental: per-chunk tallies, recounted only for chunks touched since the last pass, at most
 * once per `recountSeconds`. Saved chunks that aren't loaded yet are estimated from their packed data, a few
 * per pass, so a returning save shows the right score without generating the whole city at once.
 */

export type FaunaId = 'butterflies' | 'birds' | 'koi' | 'robots';
export const FAUNA: FaunaId[] = ['butterflies', 'birds', 'koi', 'robots'];

/** What the score and the unlocks are derived from. */
export interface BioCounts {
  /** restored tiles by bloom stage (index 1 Restored, 2 Blooming, 3 Thriving, 4 Radiant) */
  stages: [number, number, number, number, number];
  /** tree tiles (TreePlacement) at Thriving or above */
  thrivingTrees: number;
  /** tree species growing at Blooming or above */
  species: number;
  /** ground kinds (lawn, paving, water, clay…) with at least one restored tile */
  features: number;
  /** restored water tiles (ponds and canals) */
  water: number;
  /** landmarks woken (cleared areas; the park's fountain counts once it flows) */
  landmarks: number;
  /** superstructures finished */
  supers: number;
  /** whether the park's fountain flows */
  fountain: boolean;
}

export interface Biodiversity {
  score: number;
  rank: string;
  /** next rank's name and the score it needs (undefined at the top) */
  next?: { rank: string; at: number };
  parts: { stages: number; species: number; features: number; landmarks: number; supers: number; fauna: number };
}

/** The score from counts (pure). Blooming tiles count three times a freshly restored one, Radiant ten times. */
export function biodiversity(c: BioCounts, faunaCount: number): Biodiversity {
  const W = TUNING.ecosystem.score;
  const stages = c.stages.reduce((a, n, i) => a + n * (W.stage[i] ?? 0), 0);
  const parts = {
    stages: Math.floor(stages),
    species: c.species * W.species,
    features: c.features * W.feature,
    landmarks: c.landmarks * W.landmark,
    supers: c.supers * W.superstructure,
    fauna: faunaCount * W.fauna,
  };
  const score = parts.stages + parts.species + parts.features + parts.landmarks + parts.supers + parts.fauna;
  const ranks = TUNING.ecosystem.ranks;
  let i = 0;
  while (i + 1 < ranks.length && score >= ranks[i + 1][0]) i++;
  const nx = ranks[i + 1];
  return { score, rank: ranks[i][1], next: nx ? { rank: nx[1], at: nx[0] } : undefined, parts };
}

/** Whether a fauna kind's condition holds for these counts (pure; TUNING.ecosystem.fauna). */
export function faunaConditionMet(id: FaunaId, c: BioCounts): boolean {
  const F = TUNING.ecosystem.fauna;
  switch (id) {
    case 'butterflies':
      return c.stages[2] + c.stages[3] + c.stages[4] >= F.butterflies.bloomingTiles;
    case 'birds':
      return c.thrivingTrees >= F.birds.thrivingTreeTiles;
    case 'koi':
      return (F.koi.fountain && c.fountain) || c.water >= F.koi.waterTiles;
    case 'robots':
      return c.landmarks >= F.robots.landmarks;
  }
}

/** One line for each fauna kind: what it needs, for the HUD (pure). */
export function faunaGoal(id: FaunaId, c: BioCounts): { label: string; have: number; need: number } {
  const F = TUNING.ecosystem.fauna;
  switch (id) {
    case 'butterflies':
      return { label: 'blooming tiles', have: c.stages[2] + c.stages[3] + c.stages[4], need: F.butterflies.bloomingTiles };
    case 'birds':
      return { label: 'thriving tree tiles', have: c.thrivingTrees, need: F.birds.thrivingTreeTiles };
    case 'koi':
      return { label: F.koi.fountain ? 'a flowing fountain or restored water tiles' : 'restored water tiles', have: c.fountain ? F.koi.waterTiles : c.water, need: F.koi.waterTiles };
    case 'robots':
      return { label: 'landmarks woken', have: c.landmarks, need: F.robots.landmarks };
  }
}

export const FAUNA_INFO: Record<FaunaId, { name: string; icon: string; line: string }> = {
  butterflies: { name: 'Butterflies', icon: '🦋', line: 'They drift between the flowers you grew.' },
  birds: { name: 'Songbirds', icon: '🐦', line: 'They nest in your thriving trees and hop across the lawns.' },
  koi: { name: 'Koi', icon: '🐟', line: 'They glide through the clean water.' },
  robots: { name: 'Garden robots', icon: '🤖', line: 'Friendly helpers potter about your superstructures. Just for company.' },
};

interface ChunkTally {
  stages: number[];
  thrivingTrees: number;
  water: number;
  /** bit per tree species / ground kind present */
  species: number;
  features: number;
}

const SPECIES_BIT: Record<string, number> = { oak: 1, cherry: 2, birch: 4, pine: 8, willow: 16 };
const FEATURE_BIT: Record<string, number> = { lawn: 1, paving: 2, road: 4, water: 8, clay: 16, litter: 32 };
const bits = (n: number) => {
  let c = 0;
  for (; n; n &= n - 1) c++;
  return c;
};

export class EcosystemSystem {
  private tallies = new Map<string, ChunkTally>();
  private started = false;
  private dirty = new Set<string>();
  /** saved chunks not loaded yet, still to estimate */
  private pendingTodo: string[] = [];
  private nextAt = 0;
  private counts: BioCounts = { stages: [0, 0, 0, 0, 0], thrivingTrees: 0, species: 0, features: 0, water: 0, landmarks: 0, supers: 0, fountain: false };

  constructor(private sim: Sim) {
    sim.grid.touchListeners.push((t) => this.dirty.add(chunkKeyOf(t)));
  }

  /** Fauna kinds that have arrived (in unlock order). */
  unlocked(): FaunaId[] {
    const f = this.sim.state.fauna ?? {};
    return FAUNA.filter((id) => f[id] !== undefined).sort((a, b) => f[a]! - f[b]!);
  }

  has(id: FaunaId): boolean {
    return this.sim.state.fauna?.[id] !== undefined;
  }

  /** Latest counts (refreshed by `tick`/`refresh`). */
  get bio(): BioCounts {
    return this.counts;
  }

  score(): Biodiversity {
    return biodiversity(this.counts, this.unlocked().length);
  }

  tick() {
    if (this.sim.time < this.nextAt) return;
    this.nextAt = this.sim.time + TUNING.ecosystem.recountSeconds;
    this.refresh();
  }

  /**
   * Recounts touched chunks and checks unlocks. Reads the world, writes only `state.fauna` (never resources,
   * tiles, machines or stats).
   */
  refresh(all = false) {
    const s = this.sim;
    if (all || !this.started) {
      // Full pass: every loaded chunk, then saved chunks not loaded yet (estimated a few per pass from here on).
      this.started = true;
      this.tallies.clear();
      this.dirty.clear();
      for (const l of s.grid.playableLayers()) for (const c of s.grid.loadedChunks(l.id)) this.tallies.set(c.key, this.tallyChunk(c));
      this.pendingTodo = Object.keys(s.grid.pending).filter((k) => !this.tallies.has(k));
    } else {
      // Only chunks with a tile touched since the last pass (new, untouched chunks hold nothing restored; a saved
      // chunk that loads keeps its estimate until one of its tiles changes).
      for (const key of this.dirty) {
        const [layer, cx, cz] = key.split('|');
        const c = s.grid.peek(layer, Number(cx) * CHUNK, Number(cz) * CHUNK) ? s.grid.chunkAt(layer, Number(cx), Number(cz)) : undefined;
        if (c) this.tallies.set(key, this.tallyChunk(c));
      }
      this.dirty.clear();
    }
    let budget = all ? Infinity : TUNING.ecosystem.pendingChunksPerRecount;
    while (budget-- > 0 && this.pendingTodo.length) {
      const key = this.pendingTodo.pop()!;
      if (this.tallies.has(key)) continue;
      const packed = s.grid.pending[key];
      if (packed) this.tallies.set(key, this.tallyPacked(key, packed));
      else {
        // it loaded meanwhile: count it for real
        const [layer, cx, cz] = key.split('|');
        if (s.grid.peek(layer, Number(cx) * CHUNK, Number(cz) * CHUNK)) this.tallies.set(key, this.tallyChunk(s.grid.chunkAt(layer, Number(cx), Number(cz))!));
      }
    }

    const c: BioCounts = { stages: [0, 0, 0, 0, 0], thrivingTrees: 0, species: 0, features: 0, water: 0, landmarks: 0, supers: 0, fountain: !!s.state.progression.coreActivated };
    let species = 0;
    let features = 0;
    const playable = new Map<string, boolean>();
    for (const [key, t] of this.tallies) {
      const layer = key.slice(0, key.indexOf('|'));
      let ok = playable.get(layer);
      if (ok === undefined) playable.set(layer, (ok = s.grid.isPlayable(layer)));
      if (!ok) continue;
      for (let i = 1; i <= 4; i++) c.stages[i] += t.stages[i] ?? 0;
      c.thrivingTrees += t.thrivingTrees;
      c.water += t.water;
      species |= t.species;
      features |= t.features;
    }
    c.species = bits(species);
    c.features = bits(features);
    for (const a of Object.values(s.state.areas)) if (a.fog === 'cleared') c.landmarks++;
    if (c.fountain && s.state.areas.park?.fog !== 'cleared') c.landmarks++;
    c.supers = s.state.machines.filter((m) => (m.tier ?? 1) >= 3 && isBuilt(m)).length;
    this.counts = c;
    this.checkUnlocks();
  }

  private checkUnlocks() {
    const s = this.sim;
    for (const id of FAUNA) {
      if (s.state.fauna?.[id] !== undefined) continue;
      if (!faunaConditionMet(id, this.counts)) continue;
      s.state.fauna = { ...(s.state.fauna ?? {}), [id]: s.time };
      s.bus.emit('fauna.unlocked', { id });
    }
  }

  private areaTypeOfChunk(layer: string, cx: number, cz: number): string | undefined {
    if (layer !== GROUND) return undefined; // trees grow on the city ground (rooftops have planters, no trees)
    return this.sim.areas.info(this.sim.areas.map.areaOfChunk(cx, cz)).type;
  }

  private tallyChunk(ch: Chunk): ChunkTally {
    const out: ChunkTally = { stages: [0, 0, 0, 0, 0], thrivingTrees: 0, water: 0, species: 0, features: 0 };
    const type = this.areaTypeOfChunk(ch.layer, ch.cx, ch.cz);
    for (const t of ch.tiles) if (t) this.tallyTile(out, t, type);
    return out;
  }

  private tallyTile(out: ChunkTally, t: Pick<TileData, 'ground' | 'bloom' | 'feature' | 'x' | 'z' | 'blocked' | 'occupantId'>, type: string | undefined) {
    if (t.ground !== 'restored') return;
    const stage = Math.max(1, Math.min(4, t.bloom || 1));
    out.stages[stage]++;
    const f = t.feature ?? 'lawn';
    out.features |= FEATURE_BIT[f] ?? 0;
    if (f === 'water') {
      out.water++;
      return;
    }
    if (!type || t.occupantId) return;
    const spot = treeSpot(t, type);
    if (!spot) return;
    if (stage >= 2) out.species |= SPECIES_BIT[spot.species] ?? 0;
    if (stage >= 3) out.thrivingTrees++;
  }

  /** Estimate for a saved chunk that isn't loaded: stages from the packed columns, the rest from generation. */
  private tallyPacked(key: string, packed: string): ChunkTally {
    const out: ChunkTally = { stages: bloomCounts(packed), thrivingTrees: 0, water: 0, species: 0, features: 0 };
    const [layerId, cxs, czs] = key.split('|');
    const layer = this.sim.grid.layer(layerId);
    if (!layer) return out;
    const cx = Number(cxs);
    const cz = Number(czs);
    const type = this.areaTypeOfChunk(layerId, cx, cz);
    const N = CHUNK * CHUNK;
    out.stages = [0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      if (packed[i] !== 'r') continue;
      const x = cx * CHUNK + (i % CHUNK);
      const z = cz * CHUNK + Math.floor(i / CHUNK);
      const g = generateTile(this.sim.grid.seed, layer, x, z);
      if (!g) continue;
      const occupied =
        this.sim.grid.machinesInChunk(key).some((m) => x >= m.x && x < m.x + m.size && z >= m.z && z < m.z + m.size) ||
        this.sim.grid.decorInChunk(key).includes(decorKey(layerId, x, z)); // E19.2: decorations occupy like machines
      this.tallyTile(out, { ground: 'restored', bloom: Number(packed[N + i]) || 1, feature: g.feature, x, z, blocked: g.blocked, occupantId: occupied ? 'm' : undefined }, type);
    }
    return out;
  }
}

function chunkKeyOf(t: Pick<TileData, 'roofId' | 'x' | 'z'>): string {
  return `${t.roofId}|${Math.floor(t.x / CHUNK)}|${Math.floor(t.z / CHUNK)}`;
}

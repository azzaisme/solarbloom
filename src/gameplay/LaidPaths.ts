import { GROUND } from '../core/GameState';
import { CHUNK, generateTile } from '../core/Generation';
import { chunkKey, type Chunk } from '../core/Grid';
import { onJetty, regionPond } from '../core/OldCityLayout';
import type { LaidKind, TileData } from '../core/types';
import type { TileFeature } from '../data/city';
import type { Sim } from './Sim';

export const laidKey = (x: number, z: number) => `${x},${z}`;
const parse = (k: string) => k.split(',').map(Number) as [number, number];

/** What each kind turns the ground into (the renderer, the walker and the map read the tile's feature as ever). */
export const LAID_FEATURE: Record<LaidKind, TileFeature> = { footpath: 'paving', road: 'road', grass: 'lawn' };
export const LAID_KINDS: readonly LaidKind[] = ['footpath', 'road', 'grass'];
export const LAID_NAME: Record<LaidKind, string> = { footpath: 'Footpath', road: 'Road', grass: 'Grass' };
/** The name inside a sentence: "a footpath", "a road", "grass". */
export const LAID_A: Record<LaidKind, string> = { footpath: 'a footpath', road: 'a road', grass: 'grass' };

/** Ground a path may be laid over: open, natural ground (what the seed made it). */
const NATURAL = new Set<TileFeature>(['lawn', 'clay', 'litter', 'sand']);
/** Ground grass may be laid over: the city's paving (a market, a plaza, a walk) and bare ground. Its roads stay. */
const GRASSABLE = new Set<TileFeature>(['paving', 'clay', 'litter', 'sand']);

/**
 * Footpaths, roads and grass Bloombot lays in build mode, square by square (a drag lays a run or fills a patch: see
 * core/BuildShape). A laid square is the ground itself, not something standing on it: it turns the tile's
 * `feature` to paving or road, so it draws, walks and maps like the park's own paths, and Bloombot, machines and
 * decorations go on top as before. Grass is the other way round: it turns the city's paving (a market's floor, a
 * plaza) or bare ground into lawn, which is dead or green as the square was, and is pulsed and planted like any lawn. Free to lay and to lift; lifting gives back the ground the seed made.
 *
 * Saved sparsely (`state.laid`, sorted `x,z` lists), and stamped onto tiles as their chunks load, as machines'
 * occupancy is. The tile's `laid` and overridden `feature` are never packed with the tile.
 *
 * `onPath` is what BotController's sprint asks (E23.6.7: sprinting along a laid path costs less charge).
 */
export class LaidPaths {
  /** kind by `x,z` */
  private at = new Map<string, LaidKind>();
  /** laid squares by ground chunk, for stamping a chunk as it loads */
  private byChunk = new Map<string, string[]>();
  /** bumped whenever a square is laid or lifted */
  version = 0;

  constructor(private sim: Sim) {
    for (const kind of LAID_KINDS) for (const k of sim.state.laid?.[kind] ?? []) this.index(k, kind);
    // chunks that loaded before this system existed
    for (const c of sim.grid.loadedChunks(GROUND)) this.stampChunk(c);
  }

  private ck(k: string): string {
    const [x, z] = parse(k);
    return chunkKey(GROUND, Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  }

  private index(k: string, kind: LaidKind) {
    this.at.set(k, kind);
    const ck = this.ck(k);
    const list = this.byChunk.get(ck);
    if (!list) this.byChunk.set(ck, [k]);
    else if (!list.includes(k)) list.push(k);
  }

  private unindex(k: string) {
    this.at.delete(k);
    const ck = this.ck(k);
    const next = (this.byChunk.get(ck) ?? []).filter((q) => q !== k);
    if (next.length) this.byChunk.set(ck, next);
    else this.byChunk.delete(ck);
  }

  /** A chunk just loaded: its laid squares take their feature. */
  stampChunk(c: Chunk) {
    if (c.layer !== GROUND) return;
    for (const k of this.byChunk.get(c.key) ?? []) {
      const [x, z] = parse(k);
      const t = c.tiles[(z - c.cz * CHUNK) * CHUNK + (x - c.cx * CHUNK)];
      if (t) this.stamp(t, this.at.get(k)!);
    }
  }

  private stamp(t: TileData, kind: LaidKind) {
    t.laid = kind;
    t.feature = LAID_FEATURE[kind];
  }

  /** Writes the saved lists from the index (sorted, so saves are byte-identical; absent when nothing is laid). */
  private write() {
    const s = this.sim.state;
    const out: Partial<Record<LaidKind, string[]>> = {};
    for (const kind of LAID_KINDS) {
      const list = [...this.at].filter(([, v]) => v === kind).map(([k]) => k).sort();
      if (list.length) out[kind] = list;
    }
    if (Object.keys(out).length) s.laid = out;
    else delete s.laid;
    this.version++;
  }

  /** What is laid on a ground square. */
  kindAt(x: number, z: number): LaidKind | undefined {
    return this.at.get(laidKey(x, z));
  }

  /** How many squares are laid (of one kind, or of both). */
  count(kind?: LaidKind): number {
    if (!kind) return this.at.size;
    let n = 0;
    for (const v of this.at.values()) if (v === kind) n++;
    return n;
  }

  /** E23.6.7: is this point (ground cell units) on a laid footpath or road? */
  onPath(px: number, pz: number): boolean {
    const k = this.at.get(laidKey(Math.floor(px), Math.floor(pz)));
    return !!k && k !== 'grass';
  }

  /** Why this kind can't be laid here (undefined: it can). */
  layProblem(kind: LaidKind, roofId: string, x: number, z: number): string | undefined {
    const s = this.sim;
    if (roofId !== GROUND) return kind === 'grass' ? 'Grass goes on the ground' : `A ${LAID_NAME[kind].toLowerCase()} goes on the ground`;
    const t = s.grid.get(GROUND, x, z);
    if (!t) return 'Nothing here';
    if (t.laid === kind) return kind === 'grass' ? 'Grass is already here' : `A ${LAID_NAME[kind].toLowerCase()} is already here`;
    // grass over a laid path, or a path over laid grass: lifting it gives that ground back
    if (t.laid && (t.laid === 'grass') !== (kind === 'grass')) return `Lift the ${LAID_NAME[t.laid].toLowerCase()} first`;
    // what the seed made this square (a laid square shows what was laid, not what is under it)
    const f = (t.laid ? generateTile(s.grid.seed, s.grid.layer(GROUND)!, x, z)?.feature : t.feature) ?? 'lawn';
    if (f === 'water') return 'Not in the water';
    if (kind === 'grass') {
      if (f === 'lawn') return 'Grass already grows here';
      if (f === 'road') return 'The city’s roads stay';
      if (onJetty(x, z)) return 'Not on the jetty';
      if (t.blocked || !GRASSABLE.has(f)) return 'Something is in the way';
    } else {
      if (f === 'paving' || f === 'road') return 'This ground is already paved';
      if (t.blocked || !NATURAL.has(f)) return 'Something is in the way';
    }
    if (t.ramp) return 'Not on steps or a slope';
    if (regionPond(x, z, s.state.layers.find((l) => l.kind === 'ground')?.dryPonds)) return 'That’s a Keeper’s pond';
    if (s.areas.fog(s.areas.map.areaOfCell(x, z)) === 'hidden') return 'Not under the fog';
    if (t.occupantId) return 'Something stands here';
    return undefined;
  }

  /** Lays one square (free). Laying the other kind over a laid square swaps it. */
  lay(kind: LaidKind, roofId: string, x: number, z: number): boolean {
    const why = this.layProblem(kind, roofId, x, z);
    if (why) {
      this.sim.bus.emit('action.failed', { reason: why });
      return false;
    }
    const t = this.sim.grid.get(GROUND, x, z)!;
    const k = laidKey(x, z);
    if (this.at.has(k)) this.unindex(k);
    this.index(k, kind);
    this.stamp(t, kind);
    this.write();
    return true;
  }

  /** Lifts one laid square: the ground the seed made comes back, as green or as dead as it was. */
  lift(x: number, z: number): boolean {
    const k = laidKey(x, z);
    if (!this.at.has(k)) return false;
    this.unindex(k);
    const t = this.sim.grid.peek(GROUND, x, z);
    if (t) {
      const layer = this.sim.grid.layer(GROUND)!;
      t.laid = undefined;
      t.feature = generateTile(this.sim.grid.seed, layer, x, z)?.feature;
    }
    this.write();
    return true;
  }
}

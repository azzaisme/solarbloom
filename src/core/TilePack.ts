import { CHUNK, generateTile } from './Generation';
import type { Chunk } from './Grid';
import type { GroundState, LayerData, PlantKind, RestoreSource, TileData, TileTransition, TransitionKind } from './types';

/**
 * Save encoding for one chunk: only what play changed. A chunk identical to generation packs to ''.
 * Otherwise four columns, compact and very compressible:
 *   ground (1 char/tile) · bloom (1 digit/tile) · pollution (2 base-36 chars/tile) · '|' · extras
 * where extras lists tiles with a growth timer, a grow source, a lush timer, an entry fix or a transition:
 * `i,growth,src,lush,u,tr,lushAt,plant,drySince;…` (`tr` = `kind:t0:duration:dir:from:g`).
 * Occupancy is not saved: it is rebuilt from the machine list. Variant and blocked come from generation.
 */
const G2C: Record<GroundState, string> = { polluted: 'p', prepared: 'm', growing: 'g', restored: 'r' };
const C2G: Record<string, GroundState> = { p: 'polluted', m: 'prepared', g: 'growing', r: 'restored' };
const SOURCES: RestoreSource[] = ['pulse', 'broad', 'drone', 'chain', 'condenser', 'mega', 'pollinate', 'motherTree', 'relay', 'overflow', 'canopy', 'cat', 'neighbourhood', 'super', 'cultivator'];
const K2C: Record<TransitionKind, string> = { soften: 's', moss: 'm', restore: 'r', bloom: 'b', unblock: 'u' };
const C2K: Record<string, TransitionKind> = { s: 'soften', m: 'moss', r: 'restore', b: 'bloom', u: 'unblock' };

function packTr(tr: TileTransition): string {
  return `${K2C[tr.k]}:${r3(tr.t0)}:${r3(tr.d)}:${tr.dir ?? ''}:${tr.from ?? ''}:${tr.g ? 1 : ''}`;
}
function unpackTr(s: string): TileTransition | undefined {
  const [k, t0, d, dir, from, g] = s.split(':');
  if (!C2K[k] || !Number.isFinite(Number(t0)) || !(Number(d) > 0)) return undefined;
  const tr: TileTransition = { k: C2K[k], t0: Number(t0), d: Number(d) };
  if (dir) tr.dir = Number(dir);
  if (from) tr.from = Number(from);
  if (g === '1') tr.g = 1;
  return tr;
}
/** E23.2.2: what a loaded pulse grew (the extras' eighth field). */
const P2C: Record<PlantKind, string> = { meadow: 'm', rare: 'r', grove: 'g' };
const C2P: Record<string, PlantKind> = { m: 'meadow', r: 'rare', g: 'grove' };
const N = CHUNK * CHUNK;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function same(a: TileData, b: TileData) {
  return a.ground === b.ground && a.bloom === b.bloom && Math.round(a.pollution) === b.pollution && !a.growthRemainingSec && !a.growSource && !a.lushUntil && !a.unblocked && !a.tr && !a.plant && a.drySince === undefined;
}

export function packChunk(c: Chunk, seed: number, layer: LayerData): string {
  let changed = false;
  for (let i = 0; i < N && !changed; i++) {
    const t = c.tiles[i];
    if (!t) continue;
    const base = generateTile(seed, layer, t.x, t.z)!;
    if (!same(t, base)) changed = true;
  }
  if (!changed) return '';
  // Built with arrays + join: join yields flat strings, so stringifying a big save stays fast
  // (repeated += makes rope strings that V8 must flatten on first use).
  const g: string[] = new Array(N);
  const b: string[] = new Array(N);
  const p: string[] = new Array(N);
  const extras: string[] = [];
  for (let i = 0; i < N; i++) {
    const t = c.tiles[i];
    if (!t) {
      g[i] = '-';
      b[i] = '0';
      p[i] = '00';
      continue;
    }
    g[i] = G2C[t.ground];
    b[i] = String(Math.max(0, Math.min(9, t.bloom)));
    const pv = Math.max(0, Math.min(1295, Math.round(t.pollution)));
    p[i] = pv < 36 ? '0' + pv.toString(36) : pv.toString(36);
    if (t.growthRemainingSec || t.growSource || t.lushUntil || t.unblocked || t.tr || t.plant || t.drySince !== undefined) {
      const fields = [
        i,
        t.growthRemainingSec ? r3(t.growthRemainingSec) : '',
        t.growSource ? SOURCES.indexOf(t.growSource) : '',
        t.lushUntil ? r3(t.lushUntil) : '',
        t.unblocked ? 'u' : '',
        t.tr ? packTr(t.tr) : '',
        t.lushUntil && t.lushAt !== undefined ? r3(t.lushAt) : '',
      ];
      if (t.plant || t.drySince !== undefined) fields.push(t.plant ? P2C[t.plant] : '');
      if (t.drySince !== undefined) fields.push(r3(t.drySince));
      extras.push(fields.join(','));
    }
  }
  return [g.join(''), b.join(''), p.join(''), '|', extras.join(';')].join('');
}

/** E23.2.2: what a loaded pulse grew, by tile index, in a packed chunk (without generating it). */
export function plantsOf(packed: string): Map<number, PlantKind> {
  const out = new Map<number, PlantKind>();
  const bar = packed.indexOf('|', N * 4);
  if (bar < 0) return out;
  for (const e of packed.slice(bar + 1).split(';')) {
    if (!e) continue;
    const f = e.split(',');
    const p = f[7] ? C2P[f[7]] : undefined;
    if (p) out.set(Number(f[0]), p);
  }
  return out;
}

/** Restored tiles per bloom level (index 1..4) in a packed chunk, without generating it. */
export function bloomCounts(packed: string): number[] {
  const out = [0, 0, 0, 0, 0];
  if (packed.length < N * 2) return out;
  for (let i = 0; i < N; i++) if (packed[i] === 'r') out[Math.max(1, Math.min(4, Number(packed[N + i]) || 1))]++;
  return out;
}

export function hasRestored(packed: string): boolean {
  const i = packed.indexOf(G2C.restored);
  return i >= 0 && i < N;
}

/**
 * True if a packed chunk has a tile mid-growth or mid gameplay-time transition (it must be loaded so they finish).
 * Visual-only transitions don't need it: they continue from sim time whenever the chunk loads.
 */
export function hasGrowth(packed: string): boolean {
  const i = packed.indexOf('g');
  if (i >= 0 && i < N) return true;
  const bar = packed.indexOf('|', N * 4);
  return bar >= 0 && /:1(,|;|$)/.test(packed.slice(bar));
}

/** Applies a packed chunk over freshly generated tiles. Unknown or malformed data leaves tiles as generated. */
export function unpackChunk(c: Chunk, packed: string) {
  if (!packed || packed.length < N * 4) return;
  const bar = packed.indexOf('|', N * 4);
  for (let i = 0; i < N; i++) {
    const t = c.tiles[i];
    if (!t) continue;
    const gc = packed[i];
    if (!C2G[gc]) continue;
    t.ground = C2G[gc];
    t.bloom = Number(packed[N + i]) || 0;
    t.pollution = parseInt(packed.slice(2 * N + 2 * i, 2 * N + 2 * i + 2), 36) || 0;
    t.growthRemainingSec = 0;
    t.growSource = undefined;
    t.lushUntil = undefined;
    t.lushAt = undefined;
    t.tr = undefined;
    t.plant = undefined;
    t.drySince = undefined;
  }
  if (bar < 0) return;
  for (const e of packed.slice(bar + 1).split(';')) {
    if (!e) continue;
    const [is, gs, ss, ls, us, trs, las, ps, ds] = e.split(',');
    const t = c.tiles[Number(is)];
    if (!t) continue;
    if (gs) t.growthRemainingSec = Number(gs);
    if (ss) t.growSource = SOURCES[Number(ss)];
    if (ls) t.lushUntil = Number(ls);
    if (us === 'u') {
      t.unblocked = true;
      t.blocked = false;
    }
    if (trs) t.tr = unpackTr(trs);
    if (las && t.lushUntil) t.lushAt = Number(las);
    if (ps && C2P[ps]) t.plant = C2P[ps];
    if (ds && t.ground === 'restored' && Number.isFinite(Number(ds)) && Number(ds) >= 0) t.drySince = Number(ds);
  }
}

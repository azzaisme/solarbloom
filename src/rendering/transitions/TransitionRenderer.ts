import type * as pc from 'playcanvas';
import type { TileData, TileTransition } from '../../core/types';
import { TUNING } from '../../data/tuning';
import type { Sim } from '../../gameplay/Sim';
import type { TreeGeo } from '../TreeGen';
import { FEATURE, fromTile, KIND, surfaceState } from './EndStates';
import { transitionMaterial } from './TransitionMaterial';
import { linHex, packHex, TrMeshBuilder, type Pen } from './TrMeshBuilder';
import { PALETTE } from '../Materials';
import { seaTintAt, WATER } from '../Water';

/** E27.1 (#679): the sea's and the shallows' slab colours */
const SEA_HEXES = new Set([...PALETTE.ground.sea, ...PALETTE.ground.shallows]);

/** Something primitives can be added to (the chunk renderer's static builder, or a transition builder). */
export interface Sink {
  /** `glow` (0–1, Look 1.9): emissive via vertex alpha in the static chunk mesh; transition meshes ignore it. */
  add(type: 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'sphereHi' | 'disc', hex: string, p: [number, number, number], s: [number, number, number] | number, glow?: number): void;
  grey: number;
  /** a tip colour for the next primitives' upper vertices (grass tufts); '' = none */
  tip?: string;
}
/** Something tree/shrub geometry can be stamped into. */
export interface GeoSink {
  add(g: TreeGeo, x: number, y: number, z: number, rotY: number, scale: number): void;
  grey: number;
}

/**
 * The few hooks the chunk renderer gives the framework (Look 6.12 keeps its footprint in ChunkRenderer small).
 * `tile`/`far` draw a tile (or a "from" copy of it) into a sink; slabs go through `slabCap` when it's set.
 */
export interface ChunkHost {
  tile(sink: Sink, t: TileData, h: number): void;
  far(sink: Sink, t: TileData, h: number): void;
  setFoliage(f: GeoSink | undefined): void;
  /** draws with the chunk's prop level overridden (area-clear waves) */
  withLevel(level: number, fn: () => void): void;
  /** Look 3.8 (#135): draws one tile's area-edge dressing (rail, ivy, banners, clutter) into `sink` */
  edges(sink: Sink, t: TileData, h: number): void;
  slabCap?: (hex: string, p: [number, number, number], s: [number, number, number]) => void;
  /** E23.13: draws the tile's ground slab into `sink` (as a box, or rounded off where it pokes out into water) */
  slab?(sink: Sink, hex: string, p: [number, number, number], s: [number, number, number]): void;
}

const NULL_SINK: Sink & GeoSink = { add() {}, grey: 0 };

type Win = [number, number];
/** In/out windows (progress) for incoming props, outgoing props, per transition kind. */
const WINDOWS: Record<TileTransition['k'] | 'wake' | 'edge', { in: Win; out: Win }> = {
  soften: { in: [0, 0], out: [2, 3] },
  moss: { in: [0.3, 1], out: [0.1, 0.6] },
  restore: { in: [0.7, 1], out: [0, 0.12] },
  bloom: { in: [0, 0.75], out: [0.55, 0.95] },
  unblock: { in: [0.45, 1], out: [0, 0.6] },
  wake: { in: [0.3, 1], out: [0, 0.5] },
  // Look 3.8 (#135): area edges (rails, ivy, banners). The window closes at 0.6 so the per-piece stagger (up to
  // 60% of the window) still finishes before the end, and the vines are full-grown when the chunk folds back.
  edge: { in: [0.25, 0.6], out: [0, 0.3] },
};

export type Tier = 'low' | 'medium' | 'high';

/**
 * Look 6.12 (#181): the renderer side of living transitions. One object for the whole city:
 *
 * - keeps the **visual clock** (sim time, smoothed between sim steps, scaled by the dev time-scale) and pushes it to
 *   the transition material each frame; nothing else runs per frame;
 * - decides, when a chunk is rebuilt, which tiles draw through the transition path (living surface always; props
 *   of tiles mid-transition into the transition mesh with their windows; everything else static);
 * - knows when each chunk's last transition ends, so the chunk is rebuilt once, folding finished tiles back into
 *   the static mesh;
 * - runs renderer-only waves (area clears: props wake and the ground un-greys from the landmark outward, the fog
 *   rolls back as a front);
 * - offers the dev scrubber and time-scale, reduced motion and the quality tier.
 */
export class TransitionRenderer {
  /** visual clock, in sim seconds */
  time = 0;
  /** dev: visual durations × this (2 = half speed) */
  durScale = 1;
  reducedMotion = false;
  tier: Tier = 'high';
  /** dev: freezes one tile's transition at a progress */
  scrub?: { x: number; z: number; p: number };
  /** dev/captures: holds the visual clock at this sim time (frame strips) */
  hold?: number;
  /**
   * Transitions still playing on screen after the sim swept them (the dev time-scale stretches visuals past the
   * sim's duration), so a later chunk rebuild doesn't cut them short. Bounded by what's on screen.
   */
  private memo = new Map<string, TileTransition>();
  readonly material: pc.StandardMaterial;
  /** tiles drawn mid-transition in the last chunk builds (perf readout) */
  readonly liveByChunk = new Map<string, number>();
  private waves = new Map<string, { t0: number; ox: number; oz: number; end: number; from: number; edgesOnly: boolean }>();

  constructor(readonly sim: Sim) {
    this.material = transitionMaterial();
    const S = TUNING.transitions.restoreStages;
    this.material.setParameter('uTrStages', [S.fracture[1], S.heave[1], S.crumble[1], S.knit[0]]);
    this.material.setParameter('uTrLush', [TUNING.transitions.lushSoak, TUNING.transitions.lushDry, 0]);
    this.applyPalette();
    this.setSeaNight(0);
  }

  /** E27.1 (#679): how far into night it is (0 day … 1 deep night): the sea's day lift fades back out. */
  setSeaNight(n: number) {
    this.material.setParameter('uTrSea', seaTintAt(n));
  }

  /**
   * Look 2 hook: the in-between colours (soil, moss, crack interiors, rust streaks, the glow of life underneath)
   * read PALETTE keys, so a palette pass carries through every transition. Call again if PALETTE changes at runtime.
   */
  applyPalette() {
    const set = (u: string, hex: string) => this.material.setParameter(u, linHex(hex));
    set('uTrSoil', PALETTE.soilDark);
    set('uTrMoss', PALETTE.moss);
    set('uTrCrack', PALETTE.crack);
    set('uTrRust', PALETTE.rust);
    set('uTrLife', PALETTE.coreGlow);
  }

  /** Once per frame: `simTime` is the sim clock plus the fraction of a step not yet simulated. */
  sync(simTime: number) {
    // Smooth, monotonic, never far from the sim (a catch-up jumps with it).
    if (this.hold !== undefined) this.time = this.hold;
    else this.time = Math.abs(simTime - this.time) > 0.5 ? simTime : Math.max(this.time, simTime);
    const m = this.material;
    m.setParameter('uTrTime', this.time);
    m.setParameter('uTrDurScale', this.durScale);
    m.setParameter('uTrMotion', this.reducedMotion ? 0 : 1);
    m.setParameter('uTrDetail', this.tier === 'low' ? 0 : 1);
    m.setParameter('uTrScrub', this.scrub ? [this.scrub.x, this.scrub.z, this.scrub.p, 1] : [0, 0, 0, 0]);
    for (const [id, w] of this.waves) if (this.time > w.end + 0.5) this.waves.delete(id);
  }

  /** When a transition ends on screen (visual clock). */
  endOf(tr: TileTransition): number {
    return tr.t0 + tr.d * this.durScale;
  }

  /** Progress of a tile's transition on screen (0..1; 1 = none). */
  progress(t: TileData): number {
    const tr = t.tr;
    if (!tr) return 1;
    if (this.scrub && Math.floor(this.scrub.x) === t.x && Math.floor(this.scrub.z) === t.z) return this.scrub.p;
    return Math.max(0, Math.min(1, (this.time - tr.t0) / (tr.d * this.durScale)));
  }

  /** The transition to draw for a tile: its own, or one the sim swept that is still playing on screen. */
  private trOf(t: TileData): TileTransition | undefined {
    if (t.tr) {
      if (this.durScale !== 1) this.memo.set(t.id, t.tr);
      return t.tr;
    }
    const m = this.memo.get(t.id);
    if (m && this.time < this.endOf(m)) return m;
    if (m) this.memo.delete(t.id);
    return undefined;
  }

  private live(t: TileData, tr: TileTransition | undefined): boolean {
    if (!tr) return false;
    if (this.scrub && this.scrub.x === t.x && this.scrub.z === t.z) return true;
    return this.time < this.endOf(tr);
  }

  // ───────────── area waves (renderer only) ─────────────

  /** An area cleared: its props wake and its ground un-greys in a wave from (ox, oz), the fog rolls back. */
  areaWave(areaId: string, ox: number, oz: number, radius: number, opts: { from?: number; edgesOnly?: boolean } = {}) {
    const A = TUNING.transitions.areaWave;
    if (this.reducedMotion) return; // reduced motion: no rolling, one gentle change (the chunk rebuild)
    this.waves.set(areaId, { t0: this.time, ox, oz, end: this.time + Math.min(A.max, radius * A.perTile) + A.prop, from: opts.from ?? 0, edgesOnly: !!opts.edgesOnly });
  }

  /**
   * Look 3.8 (#135): one tile's area edge while a wave rolls over it. The old dressing shrinks away and the new
   * one (fuller ivy, banners, tidy clutter) grows in as the front passes, so vines visibly grow instead of
   * popping. Returns when it ends on screen, or 0 when no wave is running there (the caller draws it statically).
   */
  edgeTile(host: ChunkHost, area: string, t: TileData, h: number, tb: TrMeshBuilder, fb: GeoSink, grey: number): number {
    const w = this.waves.get(area);
    if (!w || this.tier === 'low') return 0;
    const d = TUNING.transitions.areaWave.prop;
    const t0 = w.t0 + (this.waveDelay(area, t.x, t.z) ?? 0);
    if (this.time >= t0 + d) return 0;
    const top = h + 0.08;
    tb.grey = grey;
    const win = WINDOWS.edge;
    const before = tb.verts;
    host.setFoliage({ add: (g, x, y, z, r, s) => tb.addGeo(g, x, y, z, r, s), grey });
    this.pen(tb, t0, d, 1, win.in, [2, 3], top);
    host.edges(tb, t, h);
    this.pen(tb, t0, d, 1, [0, 0], win.out, top);
    host.withLevel(w.from, () => host.edges(tb, t, h));
    host.setFoliage(fb);
    // most tiles have no edge: they aren't drawn as transitions (keeps the live-tile readout honest)
    return tb.verts > before ? t0 + d : 0;
  }

  /** Delay (s) before the wave reaches (x, z) in this area, or undefined when no wave is running there. */
  waveDelay(areaId: string, x: number, z: number): number | undefined {
    const w = this.waves.get(areaId);
    if (!w) return undefined;
    const A = TUNING.transitions.areaWave;
    return Math.min(A.max, Math.hypot(x + 0.5 - w.ox, z + 0.5 - w.oz) * A.perTile);
  }

  /** True while the wave hasn't reached (x, z) yet (the tile keeps its fogged look). */
  waveAhead(areaId: string, x: number, z: number): boolean {
    const w = this.waves.get(areaId);
    if (!w || w.edgesOnly) return false;
    return this.time < w.t0 + (this.waveDelay(areaId, x, z) ?? 0);
  }

  /** Areas with a wave rolling (their chunks rebuild a few times a second while it runs). */
  waving(areaId: string): boolean {
    const w = this.waves.get(areaId);
    return !!w && this.time <= w.end;
  }

  /** The fog front for a cleared area: origin, current radius, softness; undefined when not rolling. */
  fogFront(areaId: string): [number, number, number, number] | undefined {
    const w = this.waves.get(areaId);
    if (!w) return undefined;
    const A = TUNING.transitions.areaWave;
    const k = Math.max(0, (this.time - w.t0) / A.fog);
    const reach = (w.end - w.t0 - A.prop) / A.perTile + 4;
    return [w.ox, w.oz, k * k * reach * 1.15, 3];
  }

  // ───────────── chunk building ─────────────

  private pen(b: TrMeshBuilder, t0: number, d: number, mode: number, w: Win, out: Win, groundY: number) {
    const p: Pen = b.pen;
    p.t0 = t0;
    p.d = d;
    p.mode = mode;
    p.inA = w[0];
    p.inB = w[1];
    p.outA = out[0];
    p.outB = out[1];
    p.groundY = groundY;
  }

  /**
   * Draws one tile for a chunk build. Its slab goes to the living surface (`sb`); its props go to the static
   * builder, or, while it's mid-transition, to the transition builder (`tb`) as incoming props, the outgoing props
   * of the look it came from, and the transitional pieces of the restore sequence. Returns when the tile's
   * transition ends on screen (0 when it isn't drawn as one), so the chunk knows when to fold it back.
   */
  buildTile(host: ChunkHost, t: TileData, h: number, far: boolean, B: { b: Sink; fb: GeoSink; sb: TrMeshBuilder; tb: TrMeshBuilder }, area?: string): number {
    const tr = this.trOf(t);
    if (tr !== t.tr) t = { ...t, tr };
    const live = this.live(t, tr);
    // Waves (area clear): a blocked prop wakes when the wave reaches it.
    const wd = area !== undefined && t.blocked && t.feature !== 'building' && !this.waves.get(area)?.edgesOnly ? this.waveDelay(area, t.x, t.z) : undefined;
    const waking = wd !== undefined && this.time < (this.waves.get(area!)!.t0 + wd + TUNING.transitions.areaWave.prop);
    const detailed = !far && this.tier !== 'low';
    let rec: { hex: string; p: [number, number, number]; s: [number, number, number] } | undefined;
    host.slabCap = (hex, p, s) => {
      if (!rec) rec = { hex, p: [...p], s: [...s] };
    };
    const top = h + 0.08;
    const tb = B.tb;
    tb.grey = B.b.grey;
    const kind = tr?.k;
    const decoLive = live && detailed && kind !== 'soften';
    let end = 0;
    const gAdapter: GeoSink = { add: (g, x, y, z, r, s) => tb.addGeo(g, x, y, z, r, s), grey: tb.grey };
    if (waking) {
      // old prop out, woken prop in
      const w = WINDOWS.wake;
      const t0 = this.waves.get(area!)!.t0 + wd!;
      const d = TUNING.transitions.areaWave.prop;
      host.setFoliage(gAdapter);
      this.pen(tb, t0, d, 1, w.in, [2, 3], top);
      host.tile(tb, t, h);
      this.pen(tb, t0, d, 1, [0, 0], w.out, top);
      host.withLevel(0, () => host.tile(tb, t, h));
      end = t0 + d;
    } else if (decoLive && tr) {
      const w = WINDOWS[tr.k];
      host.setFoliage(gAdapter);
      this.pen(tb, tr.t0, tr.d * this.durScale, 1, w.in, [2, 3], top);
      if (far) host.far(tb, t, h);
      else host.tile(tb, t, h);
    } else {
      host.setFoliage(B.fb);
      if (far) host.far(B.b, t, h);
      else host.tile(B.b, t, h);
    }
    const to = rec;
    rec = undefined;
    let fromHex = to?.hex;
    if (live && tr) {
      const ft = fromTile(t, tr);
      if (ft) {
        if (decoLive) {
          const w = WINDOWS[tr.k];
          this.pen(tb, tr.t0, tr.d * this.durScale, 1, [0, 0], w.out, top);
          host.tile(tb, ft, h);
        } else {
          host.setFoliage(NULL_SINK);
          if (far) host.far(NULL_SINK, ft, h);
          else host.tile(NULL_SINK, ft, h);
        }
        fromHex = (rec as typeof to)?.hex ?? fromHex;
      }
      if (decoLive && tr.k === 'restore') this.restorePieces(tb, t, tr, h, fromHex ?? '#8a8a8a');
      end = Math.max(end, this.endOf(tr));
    }
    host.slabCap = undefined;
    host.setFoliage(B.fb);
    if (!to) return end;
    // The living surface.
    const sb = B.sb;
    sb.grey = B.b.grey;
    sb.pen.mode = 3;
    const now = this.time;
    const lush = t.lushUntil && t.lushUntil > now ? t.lushUntil : 0;
    sb.surf = {
      t0: live && tr ? tr.t0 : -1e6,
      d: live && tr ? tr.d : 1,
      from: packHex(fromHex ?? to.hex, sb.grey),
      fromPol: live && tr && tr.from !== undefined && tr.k !== 'bloom' ? tr.from : t.pollution,
      toPol: t.pollution,
      code: (live && tr ? KIND[tr.k] : 0) * 8 + surfaceState(t),
      // Look 6.7: with no transition of its own, dead ground cracks from the side facing living ground, so hairline
      // cracks creep outward from restored tiles and connect across borders (shared edge points). Visual only.
      dir: live && tr ? (tr.dir ?? 0) : t.ground === 'polluted' || t.ground === 'prepared' ? this.sim.transitions.livingEdge(t) : 0,
      // E27.1 (#679): the open sea and its shallows are tinted by night (Water.seaTintAt); a surf tile being restored
      // has clear water as its target colour, so it keeps the water's own transition
      feature: SEA_HEXES.has(to.hex) ? FEATURE.sea : (FEATURE[t.feature ?? 'lawn'] ?? 0),
      lushAt: lush ? (t.lushAt ?? lush - TUNING.neighbourhood.reservoir.lushSeconds) : 0,
      lushUntil: lush,
    };
    if (host.slab) host.slab(sb, to.hex, to.p, to.s);
    else sb.add('box', to.hex, to.p, to.s);
    sb.surf = undefined;
    return end;
  }

  /**
   * The restore sequence's transitional pieces (Look 6.4, 6.5): the slab top split into four fragments that heave
   * and sink, roots that snake up from the cracks and are churned under, and seedlings that unfurl and give way to
   * the turf. Cheap: a dozen primitives per tile, moved by the vertex shader.
   */
  private restorePieces(tb: TrMeshBuilder, t: TileData, tr: TileTransition, h: number, slabHex: string) {
    const S = TUNING.transitions.restoreStages;
    const d = tr.d * this.durScale;
    const x = t.x + 0.5;
    const z = t.z + 0.5;
    const top = h + 0.08;
    let s = (t.variant * 2654435761) >>> 0;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const f = t.feature ?? 'lawn';
    const hard = f === 'water' || f === 'paving'; // these keep their surface: no slab fragments or roots (Look 6.17)
    if (f === 'water') {
      // debris sinks, then lily pads and reeds grow
      for (let i = 0; i < 3; i++) {
        this.pen(tb, tr.t0, d, 1, [0, 0], [0.05, 0.4], top);
        tb.add('box', PALETTE.soilDark, [x + (rnd() - 0.5) * 0.6, top - WATER.drop + 0.015, z + (rnd() - 0.5) * 0.6], [0.12, 0.03, 0.08]);
      }
      for (let i = 0; i < 3; i++) {
        this.pen(tb, tr.t0, d, 1, [0.5, 0.85], [2, 3], top);
        tb.add('cylinder', PALETTE.leafVein, [x + (rnd() - 0.5) * 0.6, top - WATER.drop + 0.006, z + (rnd() - 0.5) * 0.6], [0.2, 0.01, 0.2]);
      }
      return;
    }
    if (!hard) {
      // slab fragments: four quarters split near the middle (the crack lines)
      const cx = 0.5 + (rnd() - 0.5) * 0.16;
      const cz = 0.5 + (rnd() - 0.5) * 0.16;
      const quads: [number, number, number, number][] = [
        [0.02, 0.02, cx - 0.02, cz - 0.02],
        [cx + 0.02, 0.02, 0.98, cz - 0.02],
        [0.02, cz + 0.02, cx - 0.02, 0.98],
        [cx + 0.02, cz + 0.02, 0.98, 0.98],
      ];
      for (const [a0, b0, a1, b1] of quads) {
        this.pen(tb, tr.t0, d, 2, [S.fracture[1], S.heave[1]], [S.heave[1], S.crumble[1]], top);
        tb.add('box', slabHex, [t.x + (a0 + a1) / 2, top + 0.018, t.z + (b0 + b1) / 2], [a1 - a0, 0.036, b1 - b0]);
      }
      // dust and grit kicked up as they heave (tiny cubes that pop and settle)
      for (let i = 0; i < 4; i++) {
        this.pen(tb, tr.t0, d, 1, [S.fracture[0], S.fracture[1] + 0.05], [S.heave[0] + 0.06, S.heave[1]], top);
        tb.add('box', PALETTE.debris, [x + (rnd() - 0.5) * 0.7, top + 0.05 + rnd() * 0.06, z + (rnd() - 0.5) * 0.7], 0.035);
      }
    }
    if (f === 'paving') {
      // tiny flowers come up in the joints
      for (let i = 0; i < 4; i++) {
        this.pen(tb, tr.t0, d, 1, [0.55, 0.85], [2, 3], top);
        tb.add('sphere', PALETTE.flower[i % PALETTE.flower.length], [x + (rnd() - 0.5) * 0.7, top + 0.025, z + (rnd() - 0.5) * 0.7], 0.05);
      }
      return;
    }
    // roots along the cracks
    for (let i = 0; i < 3; i++) {
      const ax = x + (rnd() - 0.5) * 0.5;
      const az = z + (rnd() - 0.5) * 0.5;
      const ht = 0.12 + rnd() * 0.1;
      this.pen(tb, tr.t0, d, 4, [S.fracture[1] + 0.04, S.heave[1] + 0.08], [S.crumble[1], S.sprout[0] + 0.15], top);
      tb.add('cylinder', i % 2 ? PALETTE.trunk : PALETTE.soilDark, [ax, top + ht / 2, az], [0.028, ht, 0.028]);
      tb.add('sphere', PALETTE.soilDark, [ax + 0.02, top + ht, az], [0.05, 0.03, 0.05]);
    }
    // seedlings: a stem and two cotyledon leaves each
    for (let i = 0; i < 5; i++) {
      const ax = x + (rnd() - 0.5) * 0.66;
      const az = z + (rnd() - 0.5) * 0.66;
      this.pen(tb, tr.t0, d, 1, [S.sprout[0], S.sprout[1]], [S.knit[0] + 0.12, 1], top);
      tb.add('cylinder', PALETTE.stem, [ax, top + 0.04, az], [0.016, 0.08, 0.016]);
      tb.add('sphere', PALETTE.leafFin, [ax - 0.025, top + 0.085, az], [0.05, 0.016, 0.03]);
      tb.add('sphere', PALETTE.leafFin, [ax + 0.025, top + 0.085, az], [0.05, 0.016, 0.03]);
    }
  }
}

/** The transition builders for one chunk build (surface + decoration). */
export function chunkBuilders() {
  return { sb: new TrMeshBuilder(), tb: new TrMeshBuilder() };
}

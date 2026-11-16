import type { Big } from '../core/Big';
import { CHUNK } from '../core/Hash';
import type { Theme } from '../data/city';
import { CITY_GEN } from '../data/city';
import { GROUND, isRestorable } from '../core/GameState';
import type { ResourceKind } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export const THEME_NAMES: Record<Theme, string> = { oldtown: 'Old Town', docks: 'the Docks', towers: 'the Towers', parkland: 'the Parklands' };

export interface DistrictStatus {
  id: string;
  name: string;
  /** areas whose landmark stands in this district */
  areas: string[];
  /** the largest group of neighbouring awake landmarks */
  awake: number;
  need: number;
  claimed: boolean;
  available: boolean;
}

/**
 * City 10.7: district-wide blooms, the city's generalised Neighbourhood Bloom. A district is one theme region
 * (CITY_GEN.districtChunks square); an area belongs to the district its landmark stands in. Once enough
 * neighbouring landmarks in a district are awake, its bloom can be set off once: a resource reward, and every
 * free tile of its cleared areas grows lusher (dead ground restored, restored ground one bloom level up).
 * Machines are never touched. Claimed before anything else, so a reload can never pay twice; replays change
 * nothing.
 */
export class DistrictSystem {
  private memberCache = new Map<string, string[]>();

  constructor(private sim: Sim) {
    sim.bus.on('area.cleared', ({ areaId }) => {
      const d = this.districtOf(areaId);
      if (!this.claimed(d) && !this.announced.has(d) && this.available(d)) {
        this.announced.add(d);
        sim.bus.emit('district.ready', { districtId: d });
      }
    });
  }
  private announced = new Set<string>();

  /** District id of an area (by its landmark's chunk). */
  districtOf(areaId: string): string {
    const [x, z] = this.sim.areas.info(areaId).landmark;
    const n = CITY_GEN.districtChunks;
    return `d${Math.floor(Math.floor(x / CHUNK) / n)}_${Math.floor(Math.floor(z / CHUNK) / n)}`;
  }

  private region(id: string): [number, number] {
    const m = /^d(-?\d+)_(-?\d+)$/.exec(id);
    if (!m) throw new Error(`bad district id ${id}`);
    return [Number(m[1]), Number(m[2])];
  }

  /** Every area belonging to a district (static: a pure function of the seed). */
  members(id: string): string[] {
    const hit = this.memberCache.get(id);
    if (hit) return hit;
    const [rx, rz] = this.region(id);
    const n = CITY_GEN.districtChunks;
    const map = this.sim.areas.map;
    const out = new Set<string>();
    for (let cz = rz * n; cz < (rz + 1) * n; cz++)
      for (let cx = rx * n; cx < (rx + 1) * n; cx++) {
        const a = map.areaOfChunk(cx, cz);
        if (this.districtOf(a) === id) out.add(a);
      }
    const list = [...out].sort();
    this.memberCache.set(id, list);
    return list;
  }

  /** "the Towers" (mid-sentence). */
  name(id: string): string {
    const [rx, rz] = this.region(id);
    const n = CITY_GEN.districtChunks;
    return THEME_NAMES[this.sim.areas.map.theme(rx * n, rz * n)];
  }

  /** "The Towers" (to start a sentence). */
  title(id: string): string {
    const n = this.name(id);
    return n[0].toUpperCase() + n.slice(1);
  }

  /** Size of the largest connected group of cleared areas in the district (neighbours within it). */
  awakeGroup(id: string): number {
    const areas = this.sim.areas;
    const awake = new Set(this.members(id).filter((a) => areas.fog(a) === 'cleared'));
    let best = 0;
    const seen = new Set<string>();
    for (const start of awake) {
      if (seen.has(start)) continue;
      let size = 0;
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const a = stack.pop()!;
        size++;
        for (const nb of areas.info(a).neighbours)
          if (awake.has(nb) && !seen.has(nb)) {
            seen.add(nb);
            stack.push(nb);
          }
      }
      best = Math.max(best, size);
    }
    return best;
  }

  claimed(id: string): boolean {
    return this.sim.state.districts?.[id] !== undefined;
  }

  /** The bloom can be set off (not yet claimed, enough neighbouring landmarks awake). */
  available(id: string): boolean {
    return !this.claimed(id) && this.sim.grid.isPlayable(GROUND) && this.awakeGroup(id) >= TUNING.district.minAwake;
  }

  status(id: string): DistrictStatus {
    return {
      id,
      name: this.name(id),
      areas: this.members(id),
      awake: this.awakeGroup(id),
      need: TUNING.district.minAwake,
      claimed: this.claimed(id),
      available: this.available(id),
    };
  }

  /** Districts with a revealed area, nearest the park first. */
  known(): string[] {
    const ids = new Set(this.sim.areas.revealed().map((a) => this.districtOf(a)));
    return [...ids].sort((a, b) => {
      const [ax, az] = this.region(a);
      const [bx, bz] = this.region(b);
      return ax * ax + az * az - (bx * bx + bz * bz) || (a < b ? -1 : 1);
    });
  }

  /** Districts whose bloom can be set off now. */
  ready(): string[] {
    return this.known().filter((d) => this.available(d));
  }

  /** The reward the next district bloom pays (before storage caps). */
  reward(): Record<'energy' | 'water' | 'biomass', number> {
    const D = TUNING.district;
    const k = 1 + D.rewardGrowth * Object.keys(this.sim.state.districts ?? {}).length;
    return { energy: Math.round(D.reward.energy * k), water: Math.round(D.reward.water * k), biomass: Math.round(D.reward.biomass * k) };
  }

  /** Sets off a district's bloom: once only. Never moves, removes or changes a machine. */
  bloom(id: string): boolean {
    const s = this.sim;
    if (!this.available(id)) {
      if (!this.claimed(id)) s.bus.emit('action.failed', { reason: `Wake ${TUNING.district.minAwake} neighbouring landmarks in this district first` });
      return false;
    }
    const reward = this.reward();
    (s.state.districts ??= {})[id] = s.time; // claimed first: reloading can never pay twice
    const restored: string[] = [];
    const lusher: string[] = [];
    const max = TUNING.restore.maxBloom;
    // Look 6.18: the bloom rolls out from the district's first landmark (visual only: the sim changes at once).
    const W = TUNING.transitions.wave;
    const origin = this.members(id).map((a) => s.areas.landmark(a)).find((m) => !!m);
    const delayOf = (t: { x: number; z: number }) => (origin ? Math.min(W.max, W.perTile * Math.hypot(t.x - origin.x, t.z - origin.z)) : 0);
    for (const a of this.members(id)) {
      if (s.areas.fog(a) !== 'cleared') continue;
      for (const t of s.areas.tiles(a)) {
        if (t.occupantId || !isRestorable(t, s.state.machines)) continue;
        if (t.ground !== 'restored') {
          s.transitions.restore(t, 'neighbourhood', t.ground === 'polluted' ? t.pollution : 0, { quiet: true, delay: delayOf(t) });
          t.ground = 'restored';
          t.bloom = Math.max(1, t.bloom);
          restored.push(t.id);
        } else if (t.bloom < max) {
          t.bloom++;
          s.transitions.bloom(t, t.bloom, true, delayOf(t));
          lusher.push(t.id);
        } else continue;
        t.pollution = 0;
        t.growthRemainingSec = 0;
        t.growSource = undefined;
        s.grid.touch(t);
      }
    }
    s.state.stats.tilesRestored += restored.length;
    const got: Partial<Record<ResourceKind, Big>> = {};
    for (const k of ['energy', 'water', 'biomass'] as const) got[k] = s.econ.add(k, reward[k]);
    s.production.markDirty();
    s.bus.emit('district.bloom', { districtId: id, restored, lusher, reward: got, replay: false });
    return true;
  }

  /** Plays a claimed district's bloom again: presentation only, nothing changes and nothing is paid. */
  replay(id: string): boolean {
    if (!this.claimed(id)) return false;
    this.sim.bus.emit('district.bloom', { districtId: id, restored: [], lusher: [], reward: {}, replay: true });
    return true;
  }
}

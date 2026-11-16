import { fmt, type Big } from '../core/Big';
import { PARK } from '../core/Areas';
import { GROUND } from '../core/GameState';
import { Rng } from '../core/Rng';
import type { TileData, WorldEventActive, WorldEventsState, WorldEventType } from '../core/types';
import { TUNING } from '../data/tuning';
import type { ActiveModifier } from './Modifiers';
import type { Sim } from './Sim';

export const WORLD_EVENT_INFO: Record<WorldEventType, { name: string; icon: string; effect: string }> = {
  supernova: { name: 'Solar Supernova', icon: '🌞', effect: `Solar ×${TUNING.events.supernova.mult}` },
  migration: { name: 'Great Migration', icon: '🦋', effect: 'Butterflies grow your gardens' },
  rain: { name: 'Super Rain', icon: '🌧️', effect: `Water ×${TUNING.events.rain.mult} and irrigation waves` },
  invasion: { name: 'Lucky Cat Invasion', icon: '🐾', effect: 'Cats are hiding around the city' },
};

export const WORLD_EVENTS: WorldEventType[] = ['supernova', 'migration', 'rain', 'invasion'];

/** Where the player is looking (injected by the game; headless runs use the park's middle). */
export interface Focus {
  roofId: string;
  x: number;
  z: number;
}

/**
 * Phase 5 E15: world events. A seeded scheduler in simulation time (its own random stream, saved): the first
 * opportunity 3–6 active minutes after automation unlocks (the first Drone Hub), then every 3–6 minutes after
 * the previous event ends. One event at a time. Pausing stops the clock, offline time never runs it, and a
 * missed event costs nothing (there is nothing to miss: effects start by themselves and need no response).
 *
 * Effects are boosts through `Modifiers` (Supernova solar ×10, Super Rain water ×3) and bounded tile work from
 * a saved queue (Great Migration up to 20 tiles, Super Rain 3 waves of up to 12): every tile is visited once,
 * so pause, reload or overlapping boosts can't repeat it. With nothing eligible an event pays a little steady
 * income instead and says so, never "0 tiles".
 */
export class WorldEventSystem {
  /** Injected by the game (the camera's target); events act where the player is. */
  focus: () => Focus | undefined = () => undefined;

  constructor(private sim: Sim) {}

  get state(): WorldEventsState {
    return (this.sim.state.events ??= { nextAt: -1, rng: (this.sim.state.seed ^ 0x5eed15) >>> 0, count: 0, byType: {} });
  }

  get active(): WorldEventActive | undefined {
    const a = this.sim.state.events?.active;
    return a && this.sim.time < a.until ? a : undefined;
  }

  /** Seconds left of the running event (0 when none). */
  remaining(): number {
    const a = this.active;
    return a ? a.until - this.sim.time : 0;
  }

  private roll(): number {
    const st = this.state;
    const r = new Rng(st.rng);
    const v = r.next();
    st.rng = r.state;
    return v;
  }

  private range(min: number, max: number) {
    return min + (max - min) * this.roll();
  }

  /** Automation is unlocked once a Drone Hub stands. */
  unlocked(): boolean {
    return this.sim.machinesOfType('droneHub').length > 0;
  }

  /** Boosts of the running event (Modifiers composes them with everything else). */
  modifiers(): ActiveModifier[] {
    const a = this.active;
    if (!a) return [];
    const left = a.until - this.sim.time;
    const E = TUNING.events;
    if (a.type === 'supernova') return [{ label: 'Solar Supernova', stat: 'solar', value: E.supernova.mult, left, category: 'event' }];
    if (a.type === 'rain') return [{ label: 'Super Rain', stat: 'water', value: E.rain.mult, left, category: 'event' }];
    return [];
  }

  private focusTile(): TileData | undefined {
    const s = this.sim;
    const f = this.focus();
    if (f) {
      const t = s.grid.get(f.roofId, Math.floor(f.x), Math.floor(f.z));
      if (t) return t;
    }
    const [x, z] = s.areas.info(PARK).landmark;
    return s.grid.get(GROUND, x, z);
  }

  private growable(t: TileData): boolean {
    return t.ground === 'restored' && !t.occupantId && !t.blocked && t.bloom < TUNING.restore.maxBloom;
  }

  /**
   * Great Migration targets: up to N restored tiles that can still grow, least grown first, nearest the player.
   * If there are none near the player, anywhere in the revealed city.
   */
  migrationTargets(): TileData[] {
    const s = this.sim;
    const M = TUNING.events.migration;
    const f = this.focusTile();
    if (!f) return [];
    const order = (a: TileData, b: TileData) => a.bloom - b.bloom || Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z) || (a.id < b.id ? -1 : 1);
    let pool = s.grid.tilesNear({ roofId: f.roofId, x: f.x, z: f.z, size: 1 }, M.reach).filter((t) => this.growable(t));
    if (!pool.length && s.grid.isPlayable(GROUND)) pool = s.areas.revealed().flatMap((id) => s.areas.tiles(id)).filter((t) => this.growable(t));
    return pool.sort(order).slice(0, M.tiles);
  }

  /** A Super Rain wave: connected open ground from a water machine (or the player's view), nearest first. */
  rainTargets(exclude: ReadonlySet<string> = new Set()): TileData[] {
    const s = this.sim;
    const R = TUNING.events.rain;
    const water = s.machinesOfType('condenser').filter((m) => !m.project || m.project.stage >= 3);
    const origin = water.length ? water[Math.floor(this.roll() * water.length)] : undefined;
    const f = origin ? { roofId: origin.roofId, x: origin.x, z: origin.z, size: origin.size } : (() => {
      const t = this.focusTile();
      return t ? { roofId: t.roofId, x: t.x, z: t.z, size: 1 } : undefined;
    })();
    if (!f) return [];
    const out: TileData[] = [];
    const seen = new Set<string>();
    let frontier = s.grid.footprint(f.roofId, f.x, f.z, f.size).filter((t): t is TileData => !!t);
    for (const t of frontier) seen.add(t.id);
    for (const t of frontier) if (!exclude.has(t.id) && (s.restoration.isEligible(t, false) || this.growable(t))) out.push(t);
    for (let ring = 0; ring < R.waveRadius && out.length < R.waveTiles && frontier.length; ring++) {
      const next: TileData[] = [];
      for (const t of frontier)
        for (const n of s.grid.neighbors(t)) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          if (n.blocked || (n.occupantId && (!origin || n.occupantId !== origin.id))) continue;
          next.push(n);
          if (out.length < R.waveTiles && !exclude.has(n.id) && (s.restoration.isEligible(n, false) || this.growable(n))) out.push(n);
        }
      frontier = next;
    }
    return out.slice(0, R.waveTiles);
  }

  /** Relative chance of each event now (0: not relevant or just happened). */
  weights(): Record<WorldEventType, number> {
    const s = this.sim;
    const W = TUNING.events.weights;
    const w: Record<WorldEventType, number> = {
      supernova: W.supernova,
      // Prefer events that do something here: a Migration with nothing to grow or a Rain with no condenser is rarer.
      migration: this.migrationTargets().length ? W.migration : W.migration * 0.25,
      rain: s.machinesOfType('condenser').length ? W.rain : W.rain * 0.3,
      invasion: s.state.cat.firstSpawned && !(s.state.cat.invasion?.length) ? W.invasion : 0,
    };
    const last = this.state.last;
    if (last) w[last] = 0;
    return w;
  }

  private pick(): WorldEventType {
    const w = this.weights();
    const total = WORLD_EVENTS.reduce((a, k) => a + w[k], 0);
    let r = this.roll() * total;
    for (const k of WORLD_EVENTS) if ((r -= w[k]) < 0) return k;
    return 'supernova';
  }

  /** Steady biomass income for `seconds` (no temporary boosts), at least the floor. */
  private fallbackPay(seconds: number): Big {
    const s = this.sim;
    const got = s.econ.add('biomass', s.production.rates(true).biomass.mul(seconds).max(TUNING.events.fallbackMin));
    if (got.gt(0)) s.bus.emit('resource.gain', { kind: 'biomass', amount: got, reason: 'event' });
    return got;
  }

  /**
   * Starts an event now (the scheduler, or a dev/test trigger). False, and nothing changes, while another runs.
   * `type` defaults to a seeded pick.
   */
  trigger(type?: WorldEventType): boolean {
    const s = this.sim;
    if (this.active) return false;
    const st = this.state;
    const kind = type ?? this.pick();
    const E = TUNING.events;
    const t = s.time;
    st.count++;
    st.byType[kind] = (st.byType[kind] ?? 0) + 1;
    st.last = kind;
    st.nextAt = -1; // the next opportunity is counted from this one's end
    const a: WorldEventActive = { type: kind, n: st.count, startedAt: t, until: t };
    if (kind === 'supernova') {
      a.until = t + E.supernova.seconds;
    } else if (kind === 'migration') {
      a.until = t + E.migration.seconds;
      const tiles = this.migrationTargets();
      if (tiles.length) {
        a.queue = tiles.map((x) => x.id);
        a.seen = [...a.queue];
        a.nextStepAt = t + 0.4;
        a.done = 0;
      } else {
        a.fallback = `Everything near you is already radiant: the butterflies bring pollen worth +${fmt(this.fallbackPay(E.fallbackSeconds.migration))}🌿`;
      }
    } else if (kind === 'rain') {
      a.until = t + E.rain.seconds;
      a.queue = [];
      a.done = 0;
      a.waves = 0;
      a.nextStepAt = t;
    } else {
      const n = s.cat.invade(E.invasion.cats);
      a.until = t + 8; // just the banner; the cats themselves stay until found
      a.done = n;
      if (!n) a.fallback = `The cats found nowhere to hide and left a gift: +${fmt(this.fallbackPay(E.fallbackSeconds.migration))}🌿`;
    }
    st.active = a;
    if (kind === 'supernova' || kind === 'rain') s.production.markDirty();
    s.bus.emit('world.started', { type: kind, seconds: a.until - t, tiles: a.queue?.length ?? a.done ?? 0, fallback: a.fallback });
    if (kind === 'rain') this.rainWave(a);
    return true;
  }

  /** One Super Rain wave (bounded: TUNING.events.rain.waves per event, evenly spread over its time). */
  private rainWave(a: WorldEventActive) {
    a.waves = (a.waves ?? 0) + 1;
    const tiles = this.rainTargets(new Set(a.seen));
    if (tiles.length) {
      a.queue = [...(a.queue ?? []), ...tiles.map((x) => x.id)];
      a.seen = [...(a.seen ?? []), ...tiles.map((x) => x.id)];
      this.sim.bus.emit('world.wave', { type: 'rain', tiles: tiles.map((x) => x.id) });
    } else {
      // Nothing dry or growable nearby: the rain still pays (a little steady income), and says what it did.
      const got = this.fallbackPay(TUNING.events.fallbackSeconds.rain);
      a.fallback = `Nothing left to water: rain-fed growth +${fmt(got)}🌿`;
      this.sim.bus.emit('world.wave', { type: 'rain', tiles: [], fallback: a.fallback });
    }
    a.nextStepAt = Math.min(a.nextStepAt ?? this.sim.time, this.sim.time + 0.3);
  }

  /** Visits one queued tile (grows or waters it, if it still can). Each id leaves the queue exactly once. */
  private step(a: WorldEventActive) {
    const s = this.sim;
    const id = a.queue!.shift()!;
    const t = s.grid.byTileId(id);
    if (!t) return;
    if (a.type === 'rain' && t.ground !== 'restored' && s.restoration.isEligible(t, false)) {
      s.restoration.complete(t, 'overflow', undefined, true);
      a.done = (a.done ?? 0) + 1;
    } else if (this.growable(t)) {
      s.restoration.grow(t, undefined, 'auto', true);
      a.done = (a.done ?? 0) + 1;
    }
    s.bus.emit('world.tile', { type: a.type, tileId: id });
  }

  private end(a: WorldEventActive) {
    const s = this.sim;
    const st = this.state;
    st.active = undefined;
    st.nextAt = s.time + this.range(TUNING.events.laterMin, TUNING.events.laterMax);
    if (a.type === 'supernova' || a.type === 'rain') s.production.markDirty();
    s.bus.emit('world.ended', { type: a.type, done: a.done ?? 0, fallback: a.fallback });
  }

  tick() {
    const s = this.sim;
    const st = this.state;
    const a = st.active;
    if (a) {
      const R = TUNING.events.rain;
      // Waves evenly through the rain (bounded count), then the queued tiles a few per second.
      if (a.type === 'rain' && (a.waves ?? 0) < R.waves && s.time >= a.startedAt + (a.waves ?? 0) * (R.seconds / R.waves)) this.rainWave(a);
      if (a.queue?.length) {
        const total = TUNING.events[a.type === 'rain' ? 'rain' : 'migration'].seconds;
        const gap = a.type === 'rain' ? 0.2 : Math.max(0.15, (total * 0.8) / TUNING.events.migration.tiles);
        // Every queued tile is visited before the event ends, even if the clock jumps (catch-up).
        while (a.queue.length && (s.time >= (a.nextStepAt ?? 0) || s.time >= a.until)) {
          this.step(a);
          a.nextStepAt = (a.nextStepAt ?? s.time) + gap;
        }
      }
      if (s.time >= a.until && !a.queue?.length) this.end(a);
      return;
    }
    if (st.nextAt < 0) {
      if (this.unlocked()) st.nextAt = s.time + this.range(TUNING.events.firstMin, TUNING.events.firstMax);
      return;
    }
    if (s.time >= st.nextAt) this.trigger();
  }
}

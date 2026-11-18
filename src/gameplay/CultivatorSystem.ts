import { distToFootprint } from '../core/Grid';
import type { CultivatorUnit, MachineData, TileData } from '../core/types';
import { isBuilt } from '../data/machines';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';
import { WATER_NET } from '../data/water';

const C = () => TUNING.cultivator;

/**
 * Look 6.8 (#177): the Cultivator, a solar tiller. The one Look 6 transition that takes gameplay time (spike #170):
 * each tiller drives to dead ground near its dock and pushes it through softening (pollution falls at a steady
 * rate) → moss → growing → restored, drawing energy while it works instead of paying pulse costs. It parks when the
 * energy store is below the drones' reserve, so the player's taps always have something left.
 *
 * Its tiles use the drones' reservation set (a drone and a tiller never take the same tile), its restores are
 * `cultivator` restores (they can set off chains, like a drone's), and its transitions carry the gameplay flag so
 * the UI can show progress and a tap can knock them along, within TUNING.cultivator.knock.
 */
export class CultivatorSystem {
  constructor(private sim: Sim) {}

  docks(): MachineData[] {
    return this.sim.machinesOfType('cultivator').filter((m) => isBuilt(m));
  }

  private level(m: MachineData, id: string) {
    return m.upg?.[id] ?? 0;
  }
  speed(m: MachineData) {
    return (1 + C().speedPerLevel * this.level(m, 'cultSpeed')) * (this.sim.landmarks?.helperSpeed() ?? 1); // E21.9: Clock Plaza
  }
  width(m: MachineData) {
    return 1 + this.level(m, 'cultWidth');
  }
  radius(m: MachineData) {
    return this.level(m, 'cultRoute') ? C().routeRadius : C().radius;
  }
  unitsWanted(m: MachineData) {
    return 1 + this.level(m, 'cultSecond');
  }

  /** Tiles being cultivated right now (the area panel's count). */
  working(): TileData[] {
    const out: TileData[] = [];
    for (const m of this.docks()) for (const u of m.cult?.units ?? []) for (const id of u.work) {
      const t = this.sim.grid.byTileId(id);
      if (t) out.push(t);
    }
    return out;
  }

  /** The tiller working this tile, if any. */
  unitOn(tileId: string): { m: MachineData; u: CultivatorUnit } | undefined {
    for (const m of this.docks()) for (const u of m.cult?.units ?? []) if (u.work.includes(tileId)) return { m, u };
    return undefined;
  }

  private ensureUnits(m: MachineData) {
    m.cult ??= { units: [], done: 0 };
    while (m.cult.units.length < this.unitsWanted(m)) m.cult.units.push({ px: m.x + 0.5, pz: m.z + 0.5, work: [], rot: 0 });
    // keep the shared reservations in step with what the tillers hold (also after a reload)
    for (const u of m.cult.units) for (const id of u.work) this.sim.drones.external.add(id);
  }

  /** Can a tiller take this tile (dead, reachable, nobody else on it)? */
  private takeable(t: TileData): boolean {
    if (t.ground !== 'polluted' && t.ground !== 'prepared') return false;
    if (t.occupantId) return false;
    return this.sim.restoration.isEligible(t) && this.sim.restoration.helperMay(t); // E21.9: bloombot's share first
  }

  /**
   * Next job: in rows. The nearest dead tile to the tiller inside the dock's reach, preferring its current row;
   * with Fog Seeker, tiles at the fog's edge count as much closer. Then up to `width − 1` neighbours in that row.
   */
  findJob(m: MachineData, u: CultivatorUnit): TileData[] {
    const s = this.sim;
    const R = this.radius(m);
    const seek = this.level(m, 'cultRoute') > 0;
    let best: TileData | undefined;
    let bestScore = Infinity;
    for (const t of s.grid.tilesWithin(m.roofId, m.x, m.z, R + m.size)) {
      if (distToFootprint(t.x, t.z, m.x, m.z, m.size) > R || !this.takeable(t)) continue;
      const dx = t.x + 0.5 - u.px;
      const dz = t.z + 0.5 - u.pz;
      let score = Math.abs(dx) + Math.abs(dz) * 1.6; // rows: moving along x is cheaper than changing row
      if (seek && s.grid.neighbors(t).some((n) => !s.areas.isClear(n))) score -= 6;
      if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) < 1e-9 && best && t.id < best.id)) {
        best = t;
        bestScore = score;
      }
    }
    if (!best) return [];
    const out = [best];
    const w = this.width(m);
    for (let k = 1; out.length < w && k <= 2; k++)
      for (const dx of [k, -k]) {
        if (out.length >= w) break;
        const n = s.grid.get(best.roofId, best.x + dx, best.z);
        if (n && distToFootprint(n.x, n.z, m.x, m.z, m.size) <= R && this.takeable(n)) out.push(n);
      }
    return out;
  }

  private claim(u: CultivatorUnit, tiles: TileData[]) {
    u.work = tiles.map((t) => t.id);
    u.knocks = 0;
    for (const t of tiles) this.sim.drones.external.add(t.id);
  }

  private release(u: CultivatorUnit, id: string) {
    u.work = u.work.filter((w) => w !== id);
    this.sim.drones.external.delete(id);
  }

  /** Energy the tillers may draw: never below the drones' reserve share of the store. */
  private canDraw(amount: number): boolean {
    const e = this.sim.econ;
    const cap = e.cap('energy');
    const floor = cap ? cap.toNumber() * TUNING.drone.reserve : 0;
    return e.get('energy').toNumber() - amount >= floor;
  }

  tick(dt: number) {
    const docks = this.docks();
    if (!docks.length) return;
    const s = this.sim;
    for (const m of docks) {
      this.ensureUnits(m);
      const sp = this.speed(m);
      for (const u of m.cult!.units) {
        // drop tiles something else finished (a pulse, a chain) or that became unreachable
        for (const id of [...u.work]) {
          const t = s.grid.byTileId(id);
          if (!t || t.ground === 'restored' || t.occupantId) this.release(u, id);
        }
        if (!u.work.length) {
          if ((u.retryAt ?? 0) > s.time) continue;
          const job = this.findJob(m, u);
          if (!job.length) {
            u.retryAt = s.time + 1;
            // nothing to do: drive home and park on the dock
            this.drive(u, m.x + 0.5, m.z + 0.5, sp, dt);
            continue;
          }
          this.claim(u, job);
        }
        const lead = s.grid.byTileId(u.work[0])!;
        if (!this.drive(u, lead.x + 0.5, lead.z + 0.5, sp, dt)) continue;
        // at the tiles: work them, if the sun allows
        const draw = C().energyPerSec * u.work.length * dt;
        const growing = u.work.every((id) => s.grid.byTileId(id)?.ground === 'growing');
        if (!growing) {
          if (!this.canDraw(draw)) {
            u.parked = true;
            continue;
          }
          s.econ.spend({ energy: draw });
        }
        u.parked = false;
        for (const id of [...u.work]) this.work(m, u, s.grid.byTileId(id)!, sp, dt);
      }
    }
  }

  /** Moves a tiller toward (x, z). True once it's there. */
  private drive(u: CultivatorUnit, x: number, z: number, sp: number, dt: number): boolean {
    const dx = x - u.px;
    const dz = z - u.pz;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const step = C().driveSpeed * sp * dt;
    u.rot = Math.atan2(dx, dz);
    if (step >= d) {
      u.px = x;
      u.pz = z;
      return true;
    }
    u.px += (dx / d) * step;
    u.pz += (dz / d) * step;
    return false;
  }

  /** One tick of work on one tile: softening, then growth (which the restoration system completes). */
  private work(m: MachineData, u: CultivatorUnit, t: TileData, sp: number, dt: number) {
    const s = this.sim;
    if (t.ground === 'polluted') {
      const rate = C().softenRate * sp;
      if (t.tr?.k !== 'soften' || !t.tr.g) {
        // the softening phase starts: its transition runs for the time it will really take
        s.transitions.begin(t, 'soften', t.pollution / rate, { from: t.pollution, dir: s.transitions.livingEdge(t), g: true });
        s.bus.emit('tile.transition', { tile: t });
      }
      t.pollution = Math.max(0, t.pollution - rate * dt);
      s.grid.touch(t);
      if (t.pollution > 1e-6) return;
      t.ground = 'prepared';
      u.knocks = 0;
    }
    if (t.ground === 'prepared') {
      s.restoration.beginGrowth(t, 'cultivator', C().growSeconds / sp);
      if (t.tr) t.tr.g = 1;
      s.bus.emit('tile.transition', { tile: t });
      return;
    }
    if (t.ground === 'restored') this.finished(m, u, t);
  }

  /** Called by the restoration system when a tiller's tile finishes growing. */
  onRestored(t: TileData) {
    const on = this.unitOn(t.id);
    if (on) this.finished(on.m, on.u, t);
  }

  private finished(m: MachineData, u: CultivatorUnit, t: TileData) {
    this.release(u, t.id);
    m.cult!.done++;
    // E23.4.1: tilling drinks from the water nearby (the land around shows it when that runs low)
    this.sim.water.drawNear(t, WATER_NET.draw.cultivatorPerTile);
    if (this.level(m, 'cultSeed') && t.bloom < C().seedBloom) {
      t.bloom = C().seedBloom;
      this.sim.transitions.bloom(t, t.bloom, true);
      this.sim.production.markDirty();
      this.sim.grid.touch(t);
      this.sim.bus.emit('tile.transition', { tile: t });
    }
  }

  /**
   * A tap on a tile a tiller is working: knocks its current phase along by a share (at most `max` per phase, `gap`
   * seconds apart). True if it moved.
   */
  knock(t: TileData): boolean {
    const on = this.unitOn(t.id);
    if (!on) return false;
    const K = C().knock;
    const u = on.u;
    const s = this.sim;
    if ((u.knocks ?? 0) >= K.max || s.time - (u.knockAt ?? -1e9) < K.gap) return false;
    const sp = this.speed(on.m);
    if (t.ground === 'polluted' && t.tr?.k === 'soften') {
      const total = (t.tr.from ?? 100) / (C().softenRate * sp);
      t.pollution = Math.max(0, t.pollution - K.share * (t.tr.from ?? 100));
      t.tr.t0 = Math.round((t.tr.t0 - total * K.share) * 1000) / 1000;
    } else if (t.ground === 'growing') {
      t.growthRemainingSec = Math.max(0.05, t.growthRemainingSec - K.share * (C().growSeconds / sp));
    } else return false;
    u.knocks = (u.knocks ?? 0) + 1;
    u.knockAt = s.time;
    s.grid.touch(t);
    s.bus.emit('tile.knocked', { tile: t });
    return true;
  }

  /** Seconds left on a tiller's tile (inspect panel, pulse reason), or undefined when no tiller works it. */
  remaining(t: TileData): number | undefined {
    const on = this.unitOn(t.id);
    if (!on) return undefined;
    const sp = this.speed(on.m);
    if (t.ground === 'polluted') return t.pollution / (C().softenRate * sp) + C().growSeconds / sp;
    if (t.ground === 'growing') return t.growthRemainingSec;
    return C().growSeconds / sp;
  }
}

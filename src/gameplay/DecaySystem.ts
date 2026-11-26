import { hasRestored } from '../core/TilePack';
import type { TileData } from '../core/types';
import type { Sim } from './Sim';

const CHECK_SECONDS = 5;
const WILT_SECONDS = 120;
const DEATH_SECONDS = 240;

/** Upkeep for restored ground. Time here follows the running simulation, including away from the camera. */
export class DecaySystem {
  private restored = new Map<string, TileData>();
  private initialized = false;
  private lastCheck = 0;
  private cozy = false;

  constructor(private sim: Sim) {
    sim.grid.touchListeners.push((t) => this.track(t));
  }

  private track(t: TileData) {
    if (t.ground === 'restored' && t.feature !== 'water' && !t.blocked) this.restored.set(t.id, t);
    else this.restored.delete(t.id);
  }

  private trackSaved() {
    const grid = this.sim.grid;
    // Untouched chunks stay lazy. Only chunks with restored tiles need to participate in upkeep.
    for (const [key, packed] of Object.entries(grid.pending)) {
      if (!hasRestored(packed)) continue;
      const [layer, cx, cz] = key.split('|');
      grid.chunkAt(layer, Number(cx), Number(cz));
    }
    for (const chunk of grid.loadedChunks()) for (const t of chunk.tiles) if (t) this.track(t);
    this.initialized = true;
  }

  setCozyMode(on: boolean) {
    if (on === this.cozy) return;
    this.cozy = on;
    if (!on) return;
    if (!this.initialized) this.trackSaved();
    for (const t of this.restored.values()) this.tend(t);
  }

  thirsty(t: TileData): boolean {
    return !this.cozy && t.drySince !== undefined;
  }

  wilting(t: TileData): boolean {
    return !this.cozy && this.dryFor(t, WILT_SECONDS);
  }

  private dryFor(t: TileData, seconds: number): boolean {
    return t.drySince !== undefined && this.sim.time - t.drySince >= seconds;
  }

  irrigate(t: TileData): boolean {
    return this.dryFor(t, WILT_SECONDS / 2) && this.tend(t);
  }

  tend(t: TileData): boolean {
    if (t.drySince === undefined) return false;
    const changedLook = this.dryFor(t, WILT_SECONDS);
    t.drySince = undefined;
    this.sim.grid.touch(t);
    if (changedLook) this.sim.bus.emit('tile.decayChanged', { tile: t });
    return true;
  }

  tick() {
    const { sim } = this;
    if (this.cozy || sim.fountain.tier === 0 || sim.time - this.lastCheck < CHECK_SECONDS) return;
    if (!this.initialized) this.trackSaved();
    const previous = this.lastCheck;
    this.lastCheck = sim.time;
    const raining = sim.weather.rain() > 0;
    for (const t of this.restored.values()) {
      if (!sim.grid.isPlayable(t.roofId) || t.occupantId || raining || sim.water.isWatered(t)) {
        this.tend(t);
        continue;
      }
      if (t.drySince === undefined) {
        t.drySince = sim.time;
        sim.grid.touch(t);
        continue;
      }
      if (sim.time - t.drySince >= DEATH_SECONDS) {
        t.ground = 'polluted';
        t.pollution = 25;
        t.bloom = 0;
        t.plant = undefined;
        t.tr = undefined;
        t.lushUntil = undefined;
        t.lushAt = undefined;
        this.tend(t);
      } else if (previous - t.drySince < WILT_SECONDS && this.wilting(t)) {
        sim.bus.emit('tile.decayChanged', { tile: t });
      }
    }
  }
}

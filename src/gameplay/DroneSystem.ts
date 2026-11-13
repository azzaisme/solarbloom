import { distToFootprint } from '../core/Grid';
import type { DroneData, MachineData, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export type DroneStatus = 'working' | 'napping' | 'waitingEnergy' | 'travelling';

/**
 * Drone AI runs purely on grid targets. Positions are roof-local continuous coordinates;
 * the renderer interpolates and adds the bobbing.
 */
export class DroneSystem {
  private status = new Map<string, DroneStatus>();

  constructor(private sim: Sim) {}

  isReserved(tileId: string): boolean {
    return this.sim.state.drones.some((d) => d.targetTileId === tileId);
  }

  statusOf(d: DroneData): DroneStatus {
    return this.status.get(d.id) ?? 'napping';
  }

  spawn(hub: MachineData, temporarySec?: number): DroneData {
    const d: DroneData = {
      id: this.sim.newId('d'),
      hubId: hub.id,
      mode: 'idle',
      px: hub.x + hub.size / 2,
      pz: hub.z + hub.size / 2,
      timer: 0.6,
      jobs: 0,
      expiresAt: temporarySec ? this.sim.time + temporarySec : undefined,
    };
    this.sim.state.drones.push(d);
    this.sim.bus.emit('drone.spawned', { droneId: d.id });
    return d;
  }

  radius() {
    return this.sim.upgrades.droneRadius;
  }

  /** Chain Intelligence: how likely a tile is to set off a synergy if restored now. */
  private synergyScore(t: TileData): number {
    const s = this.sim;
    let score = 0;
    for (const m of s.state.machines) {
      if (m.roofId !== t.roofId) continue;
      const d = distToFootprint(t.x, t.z, m.x, m.z, m.size);
      if (m.type === 'pollinator' && d >= 1 && d <= s.upgrades.pollinatorReach) score += 3;
      else if (m.type === 'solar' && d === 1 && m.boostUntil <= s.time) score += 1.5;
      else if (m.type === 'motherTree' && d >= 1 && d <= s.upgrades.treeRadius && m.charge >= TUNING.motherTree.threshold * 0.6) score += 4;
    }
    return score;
  }

  /** Permanent drones a hub should have: the first hub gets a second with the upgrade. */
  private wanted(hub: MachineData): number {
    const firstHub = this.sim.state.machines.find((m) => m.type === 'droneHub');
    return 1 + (firstHub?.id === hub.id ? this.sim.upgrades.level('secondDrone') : 0);
  }

  findJob(d: DroneData): TileData | undefined {
    const s = this.sim;
    const hub = s.machine(d.hubId);
    if (!hub) return undefined;
    const roof = s.grid.roof(hub.roofId);
    if (!roof) return undefined;
    let best: TileData | undefined;
    let bestD = Infinity;
    const intel = s.upgrades.level('chainIntel') > 0;
    for (const t of roof.tiles) {
      if (distToFootprint(t.x, t.z, hub.x, hub.z, hub.size) > this.radius()) continue;
      if (!s.restoration.isEligible(t)) continue;
      const dx = t.x + 0.5 - d.px;
      const dz = t.z + 0.5 - d.pz;
      // Prefer mossy tiles (cheaper), then nearest; Chain Intelligence strongly prefers synergy tiles.
      let score = dx * dx + dz * dz + (t.ground === 'prepared' ? 0 : 1.5);
      if (intel) score -= this.synergyScore(t) * 6;
      if (score < bestD - 1e-9) {
        bestD = score;
        best = t;
      }
    }
    if (best) return best;
    // Nothing left to restore in range: nurture green tiles toward full bloom instead.
    for (const t of roof.tiles) {
      if (distToFootprint(t.x, t.z, hub.x, hub.z, hub.size) > this.radius()) continue;
      if (t.ground !== 'restored' || t.occupantId || t.bloom >= TUNING.restore.maxBloom || this.isReserved(t.id)) continue;
      const dx = t.x + 0.5 - d.px;
      const dz = t.z + 0.5 - d.pz;
      let score = dx * dx + dz * dz + t.bloom * 2;
      if (intel) score -= this.synergyScore(t) * 6;
      if (score < bestD - 1e-9) {
        bestD = score;
        best = t;
      }
    }
    return best;
  }

  private moveToward(d: DroneData, tx: number, tz: number, dt: number): boolean {
    const speed = TUNING.drone.flySpeed * this.sim.upgrades.droneFlyMult;
    const dx = tx - d.px;
    const dz = tz - d.pz;
    const dist = Math.hypot(dx, dz);
    const step = speed * dt;
    if (dist <= step) {
      d.px = tx;
      d.pz = tz;
      return true;
    }
    d.px += (dx / dist) * step;
    d.pz += (dz / dist) * step;
    return false;
  }

  tick(dt: number) {
    const s = this.sim;
    for (const hub of s.state.machines) {
      if (hub.type !== 'droneHub') continue;
      const have = s.state.drones.filter((d) => d.hubId === hub.id && d.expiresAt === undefined).length;
      for (let i = have; i < this.wanted(hub); i++) this.spawn(hub);
    }
    for (const d of [...s.state.drones]) {
      const hub = s.machine(d.hubId);
      if (!hub) continue;
      const free = d.mode === 'idle' || d.mode === 'cooldown' || d.mode === 'returning';
      if (d.expiresAt !== undefined && s.time >= d.expiresAt && free) {
        s.state.drones = s.state.drones.filter((x) => x !== d);
        this.status.delete(d.id);
        s.bus.emit('drone.despawned', { droneId: d.id });
        continue;
      }
      switch (d.mode) {
        case 'idle': {
          d.timer -= dt;
          if (d.timer > 0) break;
          const job = this.findJob(d);
          if (!job) {
            this.status.set(d.id, 'napping');
            const hx = hub.x + hub.size / 2;
            const hz = hub.z + hub.size / 2;
            if (Math.hypot(d.px - hx, d.pz - hz) > 0.05) d.mode = 'returning';
            d.timer = TUNING.drone.retrySeconds;
            break;
          }
          const cost = s.restoration.pulseCost(job);
          if (!s.econ.spend(cost)) {
            this.status.set(d.id, 'waitingEnergy');
            d.timer = TUNING.drone.retrySeconds;
            break;
          }
          d.targetTileId = job.id;
          d.mode = 'flying';
          this.status.set(d.id, 'travelling');
          s.bus.emit('drone.jobStarted', { droneId: d.id, tileId: job.id });
          break;
        }
        case 'flying': {
          const t = d.targetTileId ? s.grid.byTileId(d.targetTileId) : undefined;
          if (!t) {
            d.mode = 'idle';
            break;
          }
          if (this.moveToward(d, t.x + 0.5, t.z + 0.5, dt)) {
            d.mode = 'working';
            d.timer = TUNING.drone.workSeconds;
            this.status.set(d.id, 'working');
          }
          break;
        }
        case 'working': {
          d.timer -= dt;
          if (d.timer > 0) break;
          const t = d.targetTileId ? s.grid.byTileId(d.targetTileId) : undefined;
          d.targetTileId = undefined;
          if (t && t.ground !== 'restored' && t.ground !== 'growing') {
            s.restoration.beginGrowth(t, 'drone', TUNING.pulse.growSeconds);
            d.jobs++;
            s.state.stats.droneJobs++;
          } else if (t && t.ground === 'restored' && t.bloom < TUNING.restore.maxBloom) {
            s.restoration.grow(t);
            d.jobs++;
            s.state.stats.droneJobs++;
          }
          d.mode = 'cooldown';
          d.timer = TUNING.drone.cycleSeconds * s.upgrades.droneCycleMult;
          break;
        }
        case 'cooldown': {
          d.timer -= dt;
          if (d.timer <= 0) {
            d.mode = 'idle';
            d.timer = 0;
          }
          break;
        }
        case 'returning': {
          if (this.moveToward(d, hub.x + hub.size / 2, hub.z + hub.size / 2, dt)) {
            d.mode = 'idle';
            d.timer = TUNING.drone.retrySeconds;
          } else if (this.findJob(d)) {
            d.mode = 'idle';
            d.timer = 0;
          }
          break;
        }
      }
    }
  }
}

export function hubCoverage(sim: Sim, hub: MachineData): TileData[] {
  return sim.grid.tilesNear(hub, sim.upgrades.droneRadius);
}

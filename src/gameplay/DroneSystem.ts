import { GROUND } from '../core/GameState';
import { distToFootprint } from '../core/Grid';
import { KINDS } from '../core/Economy';
import type { Cost, DroneData, MachineData, TileData } from '../core/types';
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

  /** Tiles drones are on their way to (kept as a set: findJob asks for every tile in reach). */
  private reserved = new Set<string>();
  private reservedFor: DroneData[] | undefined;
  private reservedCount = -1;

  isReserved(tileId: string): boolean {
    const ds = this.sim.state.drones;
    if (this.reservedFor !== ds || this.reservedCount !== ds.length) {
      this.reserved.clear();
      for (const d of ds) if (d.targetTileId) this.reserved.add(d.targetTileId);
      this.reservedFor = ds;
      this.reservedCount = ds.length;
    }
    return this.reserved.has(tileId);
  }

  private setTarget(d: DroneData, tileId: string | undefined) {
    this.isReserved(''); // make sure the set matches the drone list first
    if (d.targetTileId) this.reserved.delete(d.targetTileId);
    d.targetTileId = tileId;
    if (tileId) this.reserved.add(tileId);
  }

  /**
   * City 11.4: where the camera is. Drones whose hub is further than `radius` tiles from it fly by the clock
   * (same timing, no per-tick moves); undefined (headless) simulates every flight in full.
   */
  focus?: { x: number; z: number; radius: number };

  private isFar(hub: MachineData): boolean {
    const f = this.focus;
    if (!f || hub.roofId !== GROUND) return false;
    return Math.hypot(hub.x + hub.size / 2 - f.x, hub.z + hub.size / 2 - f.z) > f.radius;
  }

  /** A far flight's position right now (on the straight line it would have flown). */
  private farPos(d: DroneData, t: TileData): [number, number] {
    const f = d.far!;
    const k = f.t1 > f.t0 ? Math.min(1, Math.max(0, (this.sim.time - f.t0) / (f.t1 - f.t0))) : 1;
    return [f.fx + (t.x + 0.5 - f.fx) * k, f.fz + (t.z + 0.5 - f.fz) * k];
  }

  statusOf(d: DroneData): DroneStatus {
    return this.status.get(d.id) ?? 'napping';
  }

  spawn(hub: MachineData, temporarySec?: number, old = false): DroneData {
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
    if (old) d.old = true;
    this.sim.state.drones.push(d);
    this.sim.bus.emit('drone.spawned', { droneId: d.id });
    return d;
  }

  radius() {
    return this.sim.upgrades.droneRadius;
  }

  /** Roof the drone is over right now. */
  roofOf(d: DroneData): string {
    return d.roofId ?? this.sim.machine(d.hubId)?.roofId ?? GROUND;
  }

  /** World position (x, surface y, z) of a drone. */
  worldOf(d: DroneData): [number, number, number] {
    const g = this.sim.grid;
    const r = g.roof(this.roofOf(d))!;
    const t = d.far && d.targetTileId ? g.byTileId(d.targetTileId) : undefined;
    const [px, pz] = t ? this.farPos(d, t) : [d.px, d.pz];
    return [r.origin[0] + px, r.origin[1] + r.height, r.origin[2] + pz];
  }



  /**
   * Hubs in the city link into networks (any two within `networkRange`, transitively). A drone works the
   * whole network's reach; on rooftops it keeps to its own hub's range.
   */
  network(hub: MachineData): MachineData[] {
    if (hub.roofId !== GROUND || hub.type !== 'droneHub') return [hub];
    const s = this.sim;
    const R = this.sim.upgrades.networkRange;
    const out = [hub];
    const seen = new Set([hub.id]);
    for (let i = 0; i < out.length; i++) {
      const h = out[i];
      for (const o of s.grid.machinesNear(GROUND, h.x, h.z, R + 1)) {
        if (o.type !== 'droneHub' || seen.has(o.id)) continue;
        if (distToFootprint(o.x, o.z, h.x, h.z, h.size) - (o.size - 1) > R) continue;
        seen.add(o.id);
        out.push(o);
      }
    }
    return out;
  }

  /** Tiles a hub's drones may work: its network's combined reach (rows in order, no duplicates). */
  networkTiles(hub: MachineData): TileData[] {
    // The old drone keeps to its own short range around the old solar lamp.
    if (hub.type !== 'droneHub') return this.sim.grid.tilesInRange(hub, TUNING.drone.old.radius);
    const hubs = this.network(hub);
    if (hubs.length === 1) return this.sim.grid.tilesInRange(hub, this.radius());
    const seen = new Set<string>();
    const out: TileData[] = [];
    for (const h of hubs)
      for (const t of this.sim.grid.tilesInRange(h, this.radius())) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        out.push(t);
      }
    return out;
  }

  /** Moves toward a point on its own layer. True on arrival. */
  private travel(d: DroneData, _roofId: string, x: number, z: number, dt: number): boolean {
    return this.moveToward(d, x, z, dt);
  }

  /** Chain Intelligence: how likely a tile is to set off a synergy if restored now. */
  private synergyScore(t: TileData): number {
    const s = this.sim;
    let score = 0;
    for (const m of s.grid.machinesNear(t.roofId, t.x, t.z, s.chains.synergyReach())) {
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
    const inRange = this.networkTiles(hub);
    // Area switches: "Focus the frontier" on the hub's area makes its drones push hard into the fog.
    const focus = s.areas.mode(s.areas.areaOf(hub)) === 'frontier';
    const edgeBonus = TUNING.drone.frontierBonus * (focus ? TUNING.drone.focusMult : 1);
    const edge = (t: TileData) => (t.roofId === GROUND && s.areas.fog(s.areas.areaOf(t)!) !== 'cleared' && s.areas.canTouch(t) ? edgeBonus : 0);
    const modeOf = (t: TileData) => (t.roofId === GROUND ? s.areas.mode(s.areas.areaOf(t)) : undefined);
    const nurturable = (t: TileData) => t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom && !this.isReserved(t.id);
    let best: TileData | undefined;
    let bestD = Infinity;
    const intel = s.upgrades.level('chainIntel') > 0;
    for (const t of inRange) {
      const mode = modeOf(t);
      if (mode === 'off') continue; // "Leave this area alone"
      const dx = t.x + 0.5 - d.px;
      const dz = t.z + 0.5 - d.pz;
      let score: number;
      if (s.restoration.isEligible(t)) {
        // Prefer mossy tiles (cheaper), then nearest; Chain Intelligence strongly prefers synergy tiles.
        score = dx * dx + dz * dz + (t.ground === 'prepared' ? 0 : 1.5) - edge(t);
      } else if (mode === 'bloom' && !focus && nurturable(t)) {
        // "Keep this area blooming": its green tiles compete with (and usually beat) restoration elsewhere.
        score = dx * dx + dz * dz + t.bloom * 2 - TUNING.drone.bloomBonus;
      } else continue;
      if (intel) score -= this.synergyScore(t) * 6;
      if (score < bestD - 1e-9) {
        bestD = score;
        best = t;
      }
    }
    if (best) return best;
    // Nothing left to restore in range: nurture green tiles toward full bloom instead.
    for (const t of inRange) {
      if (!nurturable(t) || modeOf(t) === 'off') continue;
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

  /**
   * Phase 4 E01: pays for a drone job unless that would take a store below the drone reserve (a share of its
   * cap kept for the player's own taps). All-or-nothing, like any purchase.
   */
  payJob(cost: Cost): boolean {
    const s = this.sim;
    for (const k of KINDS) if ((cost[k] ?? 0) > 0 && s.econ.get(k) - (cost[k] ?? 0) < TUNING.drone.reserve * s.econ.cap(k) - 1e-9) return false;
    return s.econ.spend(cost);
  }

  /** Tiles per second (the old drone is slow and ignores upgrades). */
  speedOf(d: DroneData): number {
    return d.old ? TUNING.drone.old.flySpeed : TUNING.drone.flySpeed * this.sim.upgrades.droneFlyMult;
  }

  /** The old solar lamp the old drone lives by (the park's starter panel), if this game has one. */
  private oldHome(): MachineData | undefined {
    if (!TUNING.drone.old.enabled) return undefined;
    return this.sim.state.machines.find((m) => m.starter && m.type === 'solar' && m.roofId === GROUND);
  }

  private moveToward(d: DroneData, tx: number, tz: number, dt: number): boolean {
    const speed = this.speedOf(d);
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
    const permanent = new Map<string, number>();
    for (const d of s.state.drones) if (d.expiresAt === undefined) permanent.set(d.hubId, (permanent.get(d.hubId) ?? 0) + 1);
    for (const hub of s.machinesOfType('droneHub')) {
      const have = permanent.get(hub.id) ?? 0;
      for (let i = have; i < this.wanted(hub); i++) this.spawn(hub);
    }
    // The old drone (also added to games saved before it existed).
    const home = this.oldHome();
    if (home && !permanent.has(home.id)) this.spawn(home, undefined, true);
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
          const cost = d.old ? {} : s.restoration.pulseCost(job); // the old drone runs on sunlight
          if (!this.payJob(cost)) {
            this.status.set(d.id, 'waitingEnergy');
            d.timer = TUNING.drone.retrySeconds;
            break;
          }
          this.setTarget(d, job.id);
          d.mode = 'flying';
          // Far from the camera the flight is timed, not stepped: same arrival tick, no per-tick moves.
          if (job.roofId === hub.roofId && this.roofOf(d) === hub.roofId && this.isFar(hub)) {
            const speed = this.speedOf(d);
            d.far = { fx: d.px, fz: d.pz, t0: s.time, t1: s.time + Math.hypot(job.x + 0.5 - d.px, job.z + 0.5 - d.pz) / speed };
          }
          this.status.set(d.id, 'travelling');
          s.bus.emit('drone.jobStarted', { droneId: d.id, tileId: job.id });
          break;
        }
        case 'flying': {
          const t = d.targetTileId ? s.grid.byTileId(d.targetTileId) : undefined;
          if (!t) {
            d.mode = 'idle';
            d.far = undefined;
            break;
          }
          if (d.far) {
            if (s.time >= d.far.t1 - 1e-9) {
              d.px = t.x + 0.5;
              d.pz = t.z + 0.5;
              d.far = undefined;
              d.mode = 'working';
              d.timer = d.old ? TUNING.drone.old.workSeconds : TUNING.drone.workSeconds;
              this.status.set(d.id, 'working');
            } else if (!this.isFar(hub)) {
              // The camera arrived: carry on from where it would be by now, flying for real.
              [d.px, d.pz] = this.farPos(d, t);
              d.far = undefined;
            }
            break;
          }
          if (this.travel(d, t.roofId, t.x + 0.5, t.z + 0.5, dt)) {
            d.mode = 'working';
            d.timer = d.old ? TUNING.drone.old.workSeconds : TUNING.drone.workSeconds;
            this.status.set(d.id, 'working');
          }
          break;
        }
        case 'working': {
          d.timer -= dt;
          if (d.timer > 0) break;
          const t = d.targetTileId ? s.grid.byTileId(d.targetTileId) : undefined;
          this.setTarget(d, undefined);
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
          d.timer = d.old ? TUNING.drone.old.cycleSeconds : TUNING.drone.cycleSeconds * s.upgrades.droneCycleMult;
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
          if (this.travel(d, hub.roofId, hub.x + hub.size / 2, hub.z + hub.size / 2, dt)) {
            d.mode = 'idle';
            d.timer = TUNING.drone.retrySeconds;
          } else if (this.roofOf(d) === hub.roofId && this.findJob(d)) {
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

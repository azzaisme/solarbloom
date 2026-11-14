import { GROUND } from '../core/GameState';
import { distToFootprint, relayLocal } from '../core/Grid';
import { LINKS, type RoofLinkDef } from '../data/rooftops';
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

  /** Roof the drone is over right now. */
  roofOf(d: DroneData): string {
    return d.roofId ?? this.sim.machine(d.hubId)?.roofId ?? 'r1';
  }

  /** World position (x, roof-surface y, z) of a drone, including mid-bridge crossings. */
  worldOf(d: DroneData): [number, number, number] {
    const g = this.sim.grid;
    if (d.cross) {
      const l = LINKS.find((x) => x.id === d.cross!.linkId)!;
      const a = this.pylonWorld(l, d.cross.fromRoof);
      const b = this.pylonWorld(l, d.cross.fromRoof === l.from ? l.to : l.from);
      const k = d.cross.t;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
    const r = g.roof(this.roofOf(d))!;
    return [r.origin[0] + d.px, r.origin[1] + r.height, r.origin[2] + d.pz];
  }

  private pylonWorld(l: RoofLinkDef, roofId: string): [number, number, number] {
    const r = this.sim.grid.roof(roofId)!;
    const [px, pz] = relayLocal(r, l.from === roofId ? l.fromTile : l.toTile);
    return [r.origin[0] + px, r.origin[1] + r.height, r.origin[2] + pz];
  }

  /**
   * Hubs in the city link into networks (any two within `networkRange`, transitively). A drone works the
   * whole network's reach; on rooftops it keeps to its own hub's range.
   */
  network(hub: MachineData): MachineData[] {
    if (hub.roofId !== GROUND) return [hub];
    const s = this.sim;
    const R = TUNING.drone.networkRange;
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

  /** Drone Dispatch: an idle drone helps on a connected rooftop, near the arriving relay. */
  private findRemoteJob(d: DroneData): TileData | undefined {
    const s = this.sim;
    if (s.upgrades.level('droneDispatch') <= 0) return undefined;
    const hub = s.machine(d.hubId);
    if (!hub) return undefined;
    let best: TileData | undefined;
    let bestScore = Infinity;
    for (const l of s.hood.linksOf(hub.roofId)) {
      const remote = l.from === hub.roofId ? l.to : l.from;
      if (!s.grid.isPlayable(remote)) continue;
      const [rx, rz] = l.from === remote ? l.fromTile : l.toTile;
      for (const t of s.grid.tilesWithin(remote, rx, rz, this.radius())) {
        const dist = Math.abs(t.x - rx) + Math.abs(t.z - rz);
        if (!s.restoration.isEligible(t)) continue;
        const score = dist + (t.ground === 'prepared' ? 0 : 1.5);
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
    }
    return best;
  }

  /** Moves toward a point on any roof, flying over the bridge when it's on another roof. True on arrival. */
  private travel(d: DroneData, roofId: string, x: number, z: number, dt: number): boolean {
    const s = this.sim;
    const here = this.roofOf(d);
    if (d.cross) {
      const l = LINKS.find((q) => q.id === d.cross!.linkId)!;
      const a = this.pylonWorld(l, d.cross.fromRoof);
      const to = d.cross.fromRoof === l.from ? l.to : l.from;
      const b = this.pylonWorld(l, to);
      const len = Math.max(0.5, Math.hypot(b[0] - a[0], b[2] - a[2]));
      d.cross.t += (TUNING.drone.flySpeed * s.upgrades.droneFlyMult * dt) / len;
      if (d.cross.t >= 1) {
        const r = s.grid.roof(to)!;
        const [px, pz] = relayLocal(r, l.from === to ? l.fromTile : l.toTile);
        d.roofId = to;
        d.px = px;
        d.pz = pz;
        d.cross = undefined;
      }
      return false;
    }
    if (here === roofId) return this.moveToward(d, x, z, dt);
    const l = s.hood.linksOf(here).find((q) => q.from === roofId || q.to === roofId);
    if (!l) {
      // No bridge any more (shouldn't happen): hop home.
      d.roofId = roofId;
      d.px = x;
      d.pz = z;
      return true;
    }
    const [px, pz] = relayLocal(s.grid.roof(here)!, l.from === here ? l.fromTile : l.toTile);
    if (this.moveToward(d, px, pz, dt)) d.cross = { linkId: l.id, fromRoof: here, t: 0 };
    return false;
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
    const edge = (t: TileData) => (t.roofId === GROUND && s.areas.fog(s.areas.areaOf(t)!) !== 'cleared' && s.areas.canTouch(t) ? TUNING.drone.frontierBonus : 0);
    let best: TileData | undefined;
    let bestD = Infinity;
    const intel = s.upgrades.level('chainIntel') > 0;
    for (const t of inRange) {
      if (!s.restoration.isEligible(t)) continue;
      const dx = t.x + 0.5 - d.px;
      const dz = t.z + 0.5 - d.pz;
      // Prefer mossy tiles (cheaper), then nearest; Chain Intelligence strongly prefers synergy tiles.
      let score = dx * dx + dz * dz + (t.ground === 'prepared' ? 0 : 1.5) - edge(t);
      if (intel) score -= this.synergyScore(t) * 6;
      if (score < bestD - 1e-9) {
        bestD = score;
        best = t;
      }
    }
    if (best) return best;
    // Nothing left to restore in range: nurture green tiles toward full bloom instead.
    for (const t of inRange) {
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
          if (this.roofOf(d) !== hub.roofId) {
            d.mode = 'returning'; // finished a dispatch job: head home over the bridge
            break;
          }
          const job = this.findJob(d) ?? this.findRemoteJob(d);
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
          if (this.travel(d, t.roofId, t.x + 0.5, t.z + 0.5, dt)) {
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
          if (this.travel(d, hub.roofId, hub.x + hub.size / 2, hub.z + hub.size / 2, dt)) {
            d.mode = 'idle';
            d.timer = TUNING.drone.retrySeconds;
          } else if (!d.cross && this.roofOf(d) === hub.roofId && this.findJob(d)) {
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

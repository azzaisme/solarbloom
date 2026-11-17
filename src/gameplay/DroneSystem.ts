import { Economy } from '../core/Economy';
import { GROUND, machinesStamp } from '../core/GameState';
import { distToFootprint } from '../core/Grid';
import { KINDS } from '../core/Economy';
import type { Cost, DroneData, DroneRole, MachineData, TileData } from '../core/types';
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
    return this.reserved.has(tileId) || this.external.has(tileId);
  }

  /**
   * Look 6.8: tiles other workers (the Cultivator's tillers) have claimed. Same reservation check as drones of
   * every role, so a drone and a tiller never take the same tile.
   */
  readonly external = new Set<string>();

  /** E18: claims a tile for a role drone's job (same reservation set as every drone). */
  claimTile(d: DroneData, tileId: string) {
    this.setTarget(d, tileId);
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

  /**
   * Phase 5 E13: a hub merged away. Its drones go at once; a job in flight is dropped (nothing was paid yet, and
   * its tile is released for any other drone), so no restore is ever paid twice or lost half-done.
   */
  removeHub(hubId: string) {
    const s = this.sim;
    const mine = s.state.drones.filter((d) => d.hubId === hubId);
    if (!mine.length) return;
    s.state.drones = s.state.drones.filter((d) => d.hubId !== hubId); // a new list: the reservation set rebuilds
    for (const d of mine) {
      this.status.delete(d.id);
      s.bus.emit('drone.despawned', { droneId: d.id });
    }
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

  /** A hub's work radius (Phase 5 E12: Work Radius is bought per hub). */
  radius(hub: MachineData) {
    return this.sim.upgrades.droneRadius(hub);
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
  private netCache = new Map<string, MachineData[]>();
  private netStamp = '';
  network(hub: MachineData): MachineData[] {
    if (hub.roofId !== GROUND || hub.type !== 'droneHub') return [hub];
    const stamp = `${machinesStamp(this.sim.state.machines)}|${this.sim.upgrades.networkRange}`;
    if (stamp !== this.netStamp) {
      this.netCache.clear();
      this.netStamp = stamp;
    }
    let v = this.netCache.get(hub.id);
    if (!v) this.netCache.set(hub.id, (v = this.computeNetwork(hub)));
    return v;
  }

  private computeNetwork(hub: MachineData): MachineData[] {
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
  /** Cached tile lists (hub reach and network reach); dropped whenever hubs or reach upgrades change. */
  private tileCache = new Map<string, TileData[]>();
  private tileCacheStamp = '';
  /** E18: a role's own cached tile list (dropped with the others when hubs or reach upgrades change). */
  cachedTiles(key: string, make: () => TileData[]): TileData[] {
    return this.cached(key, make);
  }

  private cached(key: string, make: () => TileData[]): TileData[] {
    const stamp = `${machinesStamp(this.sim.state.machines)}|${this.sim.upgrades.version}`;
    if (stamp !== this.tileCacheStamp) {
      this.tileCache.clear();
      this.tileCacheStamp = stamp;
    }
    let v = this.tileCache.get(key);
    if (!v) this.tileCache.set(key, (v = make()));
    return v;
  }

  /** Tiles within one hub's own reach. */
  ownTiles(hub: MachineData): TileData[] {
    return this.cached(`own|${hub.id}`, () => this.sim.grid.tilesInRange(hub, this.radius(hub)));
  }

  networkTiles(hub: MachineData): TileData[] {
    // The old drone keeps to its own short range around the old solar lamp.
    if (hub.type !== 'droneHub') return this.cached(`old|${hub.id}`, () => this.sim.grid.tilesInRange(hub, TUNING.drone.old.radius));
    const hubs = this.network(hub);
    if (hubs.length === 1) return this.ownTiles(hub);
    return this.cached(`net|${hubs.map((h) => h.id).sort().join(',')}`, () => this.mergeTiles(hubs));
  }

  private mergeTiles(hubs: MachineData[]): TileData[] {
    const seen = new Set<string>();
    const out: TileData[] = [];
    for (const h of hubs)
      for (const t of this.sim.grid.tilesInRange(h, this.radius(h))) {
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
  synergyScore(t: TileData): number {
    const u = this.sim.upgrades;
    const s = this.sim;
    let score = 0;
    for (const m of s.grid.machinesNear(t.roofId, t.x, t.z, s.chains.synergyReach())) {
      const d = distToFootprint(t.x, t.z, m.x, m.z, m.size);
      if (m.type === 'pollinator' && d >= 1 && d <= u.pollinatorReach(m)) score += 3;
      else if (m.type === 'solar' && d === 1 && m.boostUntil <= s.time) score += 1.5;
      else if (m.type === 'motherTree' && d >= 1 && d <= u.treeRadius(m) && m.charge >= TUNING.motherTree.threshold * 0.6) score += 4;
    }
    return score;
  }

  /** Permanent drones a hub should have (Drone Squad, bought per hub). */
  private wanted(hub: MachineData): number {
    return this.sim.upgrades.squad(hub);
  }

  /**
   * The drone's next job: its own hub's reach first, then the rest of the hub's network (Phase 4 E07: with many
   * linked hubs, scanning the whole network for every drone was the city's biggest per-tick cost).
   */
  findJob(d: DroneData): TileData | undefined {
    const hub = this.sim.machine(d.hubId);
    if (!hub) return undefined;
    const own = hub.type === 'droneHub' ? this.ownTiles(hub) : this.networkTiles(hub);
    const job = this.findJobIn(d, hub, own);
    if (job || hub.type !== 'droneHub' || this.network(hub).length === 1) return job;
    return this.findJobIn(d, hub, this.networkTiles(hub));
  }

  private findJobIn(d: DroneData, hub: MachineData, inRange: TileData[]): TileData | undefined {
    const s = this.sim;
    // Area switches: "Focus the frontier" on the hub's area makes its drones push hard into the fog.
    const focus = s.areas.mode(s.areas.areaOf(hub)) === 'frontier';
    const edgeBonus = TUNING.drone.frontierBonus * (focus ? TUNING.drone.focusMult : 1);
    const edge = (t: TileData) => (t.roofId === GROUND && s.areas.fog(s.areas.areaOf(t)!) !== 'cleared' && s.areas.canTouch(t) ? edgeBonus : 0);
    const modeOf = (t: TileData) => (t.roofId === GROUND ? s.areas.mode(s.areas.areaOf(t)) : undefined);
    const nurturable = (t: TileData) => t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom && !this.isReserved(t.id);
    let best: TileData | undefined;
    let bestD = Infinity;
    const intel = s.upgrades.chainIntel(hub);
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
      // Phase 4 E05: finish tiles to full bloom (what goals count) before taking any on to Radiant.
      let score = dx * dx + dz * dz + t.bloom * 2 + (t.bloom >= TUNING.restore.fullBloom ? 400 : 0);
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
    const saving = s.advisor.savingFor(); // Phase 5 E12: leave what the player is saving up for
    // Pacing pass: and a superstructure stage waiting to be paid (otherwise its water share never filled).
    const stage = s.supers.pendingStage();
    const upgrade = s.upgrades.pendingParts(); // E18.7: and a drone upgrade's energy or water part
    for (const k of KINDS) {
      const p = Economy.part(cost, k);
      const cap = s.econ.cap(k);
      if (!cap || p.lte(0)) continue; // biomass is uncapped: no reserve to keep
      let floor = cap.mul(TUNING.drone.reserve);
      if (saving) floor = floor.max(Economy.part(saving, k).min(cap.mul(TUNING.machineCostMaxShare)));
      if (stage) floor = floor.max(Economy.part(stage, k).min(cap.mul(TUNING.machineCostMaxShare)));
      if (upgrade) floor = floor.max(Economy.part(upgrade, k).min(cap.mul(TUNING.machineCostMaxShare)));
      if (s.econ.get(k).sub(p).lt(floor.sub(1e-9))) return false;
    }
    return s.econ.spend(cost);
  }

  /** Tiles per second (the old drone is slow and ignores upgrades). */
  speedOf(d: DroneData): number {
    const v = d.old ? TUNING.drone.old.flySpeed : TUNING.drone.flySpeed * this.sim.upgrades.droneSpeed(this.sim.machine(d.hubId)) * this.sim.mods.droneSpeedMult();
    return d.role === 'scout' ? v * TUNING.drone.roles.scout.speed : v; // E18.3: Scouts fly 1.5x as fast
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

  /** E18: an idle drone of a non-Restorer role looks for its role's job (see DroneRoles). */
  private roleIdle(d: DroneData, hub: MachineData, role: DroneRole) {
    const s = this.sim;
    const home = () => {
      const hx = hub.x + hub.size / 2;
      const hz = hub.z + hub.size / 2;
      if (Math.hypot(d.px - hx, d.pz - hz) > 0.05) d.mode = 'returning';
    };
    if (role === 'harvester') {
      // Harvesters stay by their hub; while a store is full they're at work (DroneRoles.tick converts the loss).
      this.status.set(d.id, s.roles.harvesting() ? 'working' : 'napping');
      home();
      d.timer = TUNING.drone.retrySeconds;
      return;
    }
    const r = s.roles.start(d, hub, role);
    if (r !== 'started') {
      this.status.set(d.id, r === 'broke' ? 'waitingEnergy' : 'napping');
      if (r === 'none') home();
      d.timer = TUNING.drone.retrySeconds;
      return;
    }
    d.mode = 'flying';
    const p = s.roles.targetPoint(d)!;
    if (this.roofOf(d) === hub.roofId && this.isFar(hub)) {
      d.far = { fx: d.px, fz: d.pz, t0: s.time, t1: s.time + Math.hypot(p[0] - d.px, p[1] - d.pz) / this.speedOf(d) };
    }
    this.status.set(d.id, 'travelling');
    const m = d.targetMachineId ? s.machine(d.targetMachineId) : undefined;
    const tileId = d.targetTileId ?? (m ? s.grid.get(m.roofId, m.x, m.z)?.id : undefined);
    if (tileId) s.bus.emit('drone.jobStarted', { droneId: d.id, tileId });
  }

  /** E18: a role drone's flight to its tile or machine (timed when far from the camera, like any drone). */
  private roleFly(d: DroneData, hub: MachineData, dt: number) {
    const s = this.sim;
    const p = s.roles.targetPoint(d);
    if (!p) {
      // Its target is gone (machine merged away): drop the job. It was paid; nothing refunds, nothing repeats.
      this.setTarget(d, undefined);
      d.targetMachineId = undefined;
      d.role = undefined;
      d.far = undefined;
      d.mode = 'idle';
      return;
    }
    const arrive = () => {
      d.px = p[0];
      d.pz = p[1];
      d.far = undefined;
      d.mode = 'working';
      d.timer = TUNING.drone.workSeconds;
      this.status.set(d.id, 'working');
    };
    if (d.far) {
      if (s.time >= d.far.t1 - 1e-9) arrive();
      else if (!this.isFar(hub)) {
        const f = d.far;
        const k = f.t1 > f.t0 ? Math.min(1, Math.max(0, (s.time - f.t0) / (f.t1 - f.t0))) : 1;
        d.px = f.fx + (p[0] - f.fx) * k;
        d.pz = f.fz + (p[1] - f.fz) * k;
        d.far = undefined;
      }
      return;
    }
    if (this.moveToward(d, p[0], p[1], dt)) arrive();
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
          // E18: a hub with another role sends its drones on that role's job (Restorers carry on below, unchanged).
          const role = s.roles.roleFor(d, hub);
          if (role !== 'restorer') {
            this.roleIdle(d, hub, role);
            break;
          }
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
          if (d.role) {
            this.roleFly(d, hub, dt);
            break;
          }
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
          if (d.role) {
            // E18: the job this drone paid for, in the role it paid for it under (even if its hub switched since).
            // Its own claim is released first, as a Restorer's is (a reserved tile isn't eligible to restore).
            const job = { role: d.role, tileId: d.targetTileId, machineId: d.targetMachineId };
            this.setTarget(d, undefined);
            d.targetMachineId = undefined;
            d.role = undefined;
            s.roles.complete(d, job);
            d.mode = 'cooldown';
            d.timer = TUNING.drone.cycleSeconds / s.upgrades.droneSpeed(hub) / s.mods.droneSpeedMult();
            break;
          }
          const t = d.targetTileId ? s.grid.byTileId(d.targetTileId) : undefined;
          this.setTarget(d, undefined);
          if (t && t.ground !== 'restored' && t.ground !== 'growing') {
            s.restoration.beginGrowth(t, 'drone', TUNING.pulse.growSeconds);
            // Phase 4 E07: Drone Sweep restores a few tiles around it for free (never another drone's target).
            const sweep = d.old ? 0 : s.upgrades.droneSweep(s.machine(d.hubId)) + (d.swarm ? TUNING.super.megahub.sweep : 0);
            if (sweep > 0) {
              const around = s.grid
                .neighbors(t)
                .concat(s.grid.tilesNear({ roofId: t.roofId, x: t.x, z: t.z, size: 1 }, 1))
                .filter((n, i, a) => a.indexOf(n) === i && n !== t && s.restoration.isEligible(n))
                .sort((a, b) => Math.abs(a.x - t.x) + Math.abs(a.z - t.z) - (Math.abs(b.x - t.x) + Math.abs(b.z - t.z)) || a.pollution - b.pollution || (a.id < b.id ? -1 : 1));
              for (const n of around.slice(0, sweep)) s.restoration.beginGrowth(n, 'drone', TUNING.pulse.growSeconds + 0.15);
            }
            d.jobs++;
            s.state.stats.droneJobs++;
            if (!d.swarm) s.supers.onDroneJob(s.machine(d.hubId));
          } else if (t && t.ground === 'restored' && t.bloom < TUNING.restore.maxBloom) {
            s.restoration.grow(t);
            d.jobs++;
            s.state.stats.droneJobs++;
            if (!d.swarm) s.supers.onDroneJob(s.machine(d.hubId));
          }
          d.mode = 'cooldown';
          d.timer = d.old ? TUNING.drone.old.cycleSeconds : TUNING.drone.cycleSeconds / s.upgrades.droneSpeed(s.machine(d.hubId)) / s.mods.droneSpeedMult();
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
          } else if (this.roofOf(d) === hub.roofId && s.roles.roleFor(d, hub) === 'restorer' && this.findJob(d)) {
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
  return sim.grid.tilesNear(hub, sim.upgrades.droneRadius(hub));
}

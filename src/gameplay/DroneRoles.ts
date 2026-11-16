import { big, Decimal } from '../core/Big';
import { Economy } from '../core/Economy';
import { GROUND } from '../core/GameState';
import { distToFootprint } from '../core/Grid';
import type { Cost, DroneData, DroneRole, MachineData, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import { tierOf } from '../data/machines';
import { HOME } from './ProgressionSystem';
import type { Sim } from './Sim';

/**
 * E18: drone roles (epic #199). A Drone Hub's role decides what its drones do; every number lives in
 * TUNING.drone.roles. The Restorer is today's drone and runs DroneSystem's own code path untouched, so a game
 * where every hub stays a Restorer plays (and saves) exactly as before E18.
 *
 * - Gardener: grows a restored tile and 2 neighbours one stage, paying only the target's nurture water.
 * - Scout: restores at the fog's edge from 1.5× the reach, paying +1 ⚡ per 4 tiles flown past the base radius.
 * - Courier: takes charge to machines (Mother Tree, solar panel, relay, condenser, Reservoir Garden).
 * - Spark (P1): starts one Bloom Chain from a garden cluster, at most once per hub per 30 s.
 * - Harvester (P1): turns income lost to full stores into biomass, keeping 70% as its running cost.
 */
export const ROLES: DroneRole[] = ['restorer', 'gardener', 'scout', 'courier', 'spark', 'harvester'];

export const ROLE_INFO: Record<DroneRole, { name: string; icon: string; job: string; upgrades: string }> = {
  restorer: { name: 'Restorer', icon: '🛸', job: 'Restores grey ground, then grows green tiles', upgrades: 'Every drone upgrade applies' },
  gardener: { name: 'Gardener', icon: '🌱', job: 'Waters green tiles so 3 grow at once; runs on water only', upgrades: 'Sweep: +1 tile grown per level' },
  scout: { name: 'Scout', icon: '🔭', job: 'Pushes back the fog from farther away; pays energy for distance', upgrades: 'Chain Intelligence has no effect' },
  courier: { name: 'Courier', icon: '📦', job: 'Carries charge to Mother Trees, panels, relays and condensers', upgrades: 'Sweep: one more machine per 2 levels' },
  spark: { name: 'Spark', icon: '✨', job: 'Starts a Bloom Chain in a garden cluster (once per 30 s)', upgrades: 'Dash, Radius and Squad apply' },
  harvester: { name: 'Harvester', icon: '🧺', job: 'Turns income lost to full stores into biomass', upgrades: 'Squad applies' },
};

/** Machines a Courier serves. */
const COURIER_TYPES = new Set<MachineData['type']>(['motherTree', 'solar', 'relay', 'condenser', 'reservoirGarden']);

export class DroneRoles {
  /** Seconds this session with income lost to a full store (the Harvester unlock; not saved). */
  lostSeconds = 0;
  /** Harvester totals this session: lost income collected and biomass paid out (tests check paid ≤ collected). */
  readonly harvest = { collected: 0, paid: 0 };
  private lastOverflow = 0;
  /** E18.4: when each machine last took a Courier delivery (sim time). */
  private delivered = new Map<string, number>();
  /** E18.6: when each hub last sparked a chain (sim time). */
  private sparked = new Map<string, number>();

  constructor(private sim: Sim) {}

  // ───────────── which role ─────────────

  /** The role a hub's drones take (slot 1 on a Fleet Hub). */
  roleOf(hub: MachineData | undefined): DroneRole {
    return hub?.role ?? 'restorer';
  }

  /**
   * The role a drone takes for its next job. The old drone stays a Restorer. A Fleet Hub splits its permanent
   * drones between its two slots (odd counts favour slot 1); a Megahub may set a role per drone (E18.8).
   */
  roleFor(d: DroneData, hub: MachineData | undefined): DroneRole {
    if (!hub || d.old || hub.type !== 'droneHub') return 'restorer';
    if (!hub.role2 && !hub.droneRoles) return hub.role ?? 'restorer';
    if (hub.droneRoles) {
      // Megahub: by order among all its drones (its swarm too).
      const i = this.sim.state.drones.filter((x) => x.hubId === hub.id).indexOf(d);
      const r = i >= 0 ? hub.droneRoles[i] : undefined;
      if (r) return r;
    }
    if (hub.role2) {
      // Fleet Hub: its permanent drones split evenly between the slots (odd counts favour slot 1).
      const mine = this.sim.state.drones.filter((x) => x.hubId === hub.id && x.expiresAt === undefined);
      const i = mine.indexOf(d);
      if (i >= Math.ceil(mine.length / 2)) return hub.role2;
    }
    return hub.role ?? 'restorer';
  }

  // ───────────── unlocks, refits, switching ─────────────

  /** Why a role can't be chosen yet (undefined = unlocked). */
  lockedReason(role: DroneRole): string | undefined {
    const s = this.sim;
    const has = (type: MachineData['type'], n = 1) => s.machinesOfType(type).length >= n;
    const R = TUNING.drone.roles;
    switch (role) {
      case 'restorer':
        return undefined;
      case 'gardener':
        if (!has('condenser')) return 'Build a Water Condenser first (Gardeners run on water)';
        if (!s.state.progression.coreActivated && s.progression.fullBloomCount(HOME) < R.gardener.unlockFullBloom) return `Grow ${R.gardener.unlockFullBloom} tiles to full bloom first`;
        return undefined;
      case 'scout':
        return s.areas.revealed().some((id) => s.areas.info(id).distance === 1 && s.areas.fog(id) !== 'cleared') ? undefined : 'Wake the fountain to reveal the fog first';
      case 'courier':
        return has('motherTree') || has('relay') ? undefined : 'Build a Mother Tree or a Bloom Relay first';
      case 'spark':
        return has('pollinator', R.spark.unlockGardens) ? undefined : `Build ${R.spark.unlockGardens} Pollinator Gardens first`;
      case 'harvester':
        return this.lostSeconds >= R.harvester.unlockLostSeconds || this.anyOwns('harvester') ? undefined : 'Unlocks once full stores have lost income for a minute';
    }
  }

  private anyOwns(role: DroneRole) {
    return this.sim.machinesOfType('droneHub').some((h) => this.owns(h, role));
  }

  owns(hub: MachineData, role: DroneRole): boolean {
    return role === 'restorer' || !!hub.roles?.includes(role);
  }

  /** One-time refit price for this hub (free when owned). The biomass part grows per other hub refitted to the role. */
  refitPrice(hub: MachineData, role: DroneRole): Cost {
    if (this.owns(hub, role)) return {};
    const base = TUNING.drone.roles.refit[role];
    const others = this.sim.machinesOfType('droneHub').filter((h) => h !== hub && this.owns(h, role)).length;
    const out: Cost = { biomass: big(base.biomass).mul(Decimal.pow(TUNING.drone.roles.refitGrowth, others)).ceil() };
    for (const k of ['energy', 'water'] as const) {
      const v = base[k];
      if (!v) continue;
      const cap = this.sim.econ.cap(k);
      out[k] = cap ? Math.min(v, Math.max(1, Math.floor(cap.toNumber() * TUNING.machineCostMaxShare))) : v;
    }
    return out;
  }

  /** Can the hub take this role now? `reason` names what's missing. */
  check(hubId: string, role: DroneRole, slot = 1): { ok: boolean; reason?: string; price: Cost } {
    const hub = this.sim.machine(hubId);
    if (!hub || hub.type !== 'droneHub') return { ok: false, reason: 'That hub is gone', price: {} };
    if (!ROLES.includes(role)) return { ok: false, reason: 'Unknown role', price: {} };
    if (slot === 2 && tierOf(hub) < 2) return { ok: false, reason: 'Only a Fleet Hub has a second role', price: {} };
    const price = this.refitPrice(hub, role);
    const locked = this.owns(hub, role) ? undefined : this.lockedReason(role);
    if (locked) return { ok: false, reason: locked, price };
    const short = this.sim.econ.shortfall(price);
    if (short) return { ok: false, reason: `Need ${Economy.part(price, short).ceil().toString()} ${short === 'energy' ? '⚡' : short === 'water' ? '💧' : '🌿'}`, price };
    return { ok: true, price };
  }

  /**
   * Gives the hub a role: pays the refit once if it doesn't own it yet (all or nothing), else switches for free.
   * Drones finish the job they already paid for (their own `role`), then follow the new one. Nothing is refunded.
   */
  choose(hubId: string, role: DroneRole, slot = 1): boolean {
    const st = this.check(hubId, role, slot);
    const hub = this.sim.machine(hubId);
    if (!st.ok || !hub) {
      this.sim.bus.emit('action.failed', { reason: st.reason ?? 'Unavailable' });
      return false;
    }
    const current = slot === 2 ? hub.role2 ?? hub.role ?? 'restorer' : this.roleOf(hub);
    if (current === role && (slot === 1 || hub.role2)) return true;
    const refit = !this.owns(hub, role);
    if (refit && !this.sim.econ.spend(st.price)) return false;
    if (refit) (hub.roles ??= []).push(role);
    if (slot === 2) hub.role2 = role;
    else if (role === 'restorer') delete hub.role;
    else hub.role = role;
    this.sim.bus.emit('drone.roleChanged', { hubId, role, refit, slot: slot === 2 ? 2 : undefined });
    return true;
  }

  /**
   * E18.8: roles after merging hubs. Slot 1 keeps the anchor's role; slot 2 takes the most common other role among
   * the three (ties: the earlier hub); owned refits carry over. Unset slot 2 = every drone takes slot 1.
   */
  mergeRoles(anchor: MachineData, partners: MachineData[]): { slot1: DroneRole; slot2?: DroneRole; owned: DroneRole[] } {
    const slot1 = this.roleOf(anchor);
    const counts = new Map<DroneRole, number>();
    for (const h of [anchor, ...partners])
      for (const r of [h.role ?? 'restorer', ...(h.role2 ? [h.role2] : [])]) if (r !== slot1) counts.set(r, (counts.get(r) ?? 0) + 1);
    let slot2: DroneRole | undefined;
    for (const [r, n] of counts) if (!slot2 || n > counts.get(slot2)!) slot2 = r;
    const owned = [...new Set([anchor, ...partners].flatMap((h) => h.roles ?? []))];
    return { slot1, slot2, owned };
  }

  /** E18.8: a Megahub drone's own role (by drone order); `undefined` clears it back to the hub's role. */
  chooseForDrone(hubId: string, index: number, role: DroneRole | undefined): boolean {
    const hub = this.sim.machine(hubId);
    if (!hub || tierOf(hub) < 3 || index < 0 || index >= TUNING.super.megahub.drones) return false;
    if (role && !this.owns(hub, role)) {
      // A role new to this hub: pay its refit once (all or nothing), without changing the hub's own role.
      const st = this.check(hubId, role);
      if (!st.ok || !this.sim.econ.spend(st.price)) {
        this.sim.bus.emit('action.failed', { reason: st.reason ?? 'Unavailable' });
        return false;
      }
      (hub.roles ??= []).push(role);
      this.sim.bus.emit('drone.roleChanged', { hubId, role, refit: true });
    }
    hub.droneRoles ??= [];
    while (hub.droneRoles.length <= index) hub.droneRoles.push(null);
    hub.droneRoles[index] = role ?? null;
    if (hub.droneRoles.every((r) => !r)) delete hub.droneRoles;
    return true;
  }

  // ───────────── jobs ─────────────

  /**
   * Starts a job for a non-Restorer drone: finds a target, pays for it (reserve and "save up" apply through
   * payJob) and claims it. 'none' = nothing to do (nap), 'broke' = something to do but not affordable now.
   */
  start(d: DroneData, hub: MachineData, role: DroneRole): 'none' | 'broke' | 'started' {
    switch (role) {
      case 'gardener':
        return this.startTile(d, this.gardenTarget(d, hub), (t) => ({ water: Economy.part(this.sim.restoration.pulseCost(t), 'water') }), role);
      case 'scout':
        return this.startTile(d, this.scoutTarget(d, hub), (t) => this.scoutCost(hub, t), role);
      case 'courier':
        return this.startCourier(d, hub);
      case 'spark':
        return this.startSpark(d, hub);
      default:
        return 'none'; // the Harvester never flies to a target (see tick)
    }
  }

  private startTile(d: DroneData, t: TileData | undefined, price: (t: TileData) => Cost, role: DroneRole): 'none' | 'broke' | 'started' {
    if (!t) return 'none';
    if (!this.sim.drones.payJob(price(t))) return 'broke';
    d.role = role;
    this.sim.drones.claimTile(d, t.id);
    return 'started';
  }

  /** Where a non-Restorer drone flies (tile or machine centre), roof-local. */
  targetPoint(d: DroneData): [number, number] | undefined {
    if (d.targetMachineId) {
      const m = this.sim.machine(d.targetMachineId);
      return m ? [m.x + m.size / 2, m.z + m.size / 2] : undefined;
    }
    const t = d.targetTileId ? this.sim.grid.byTileId(d.targetTileId) : undefined;
    return t ? [t.x + 0.5, t.z + 0.5] : undefined;
  }

  /** Arrived and worked: does the job the drone paid for (its claim is already released by the caller). */
  complete(d: DroneData, job: { role?: DroneRole; tileId?: string; machineId?: string }) {
    const s = this.sim;
    const hub = s.machine(d.hubId);
    const role = job.role ?? 'restorer';
    const tileIds: string[] = [];
    const machineIds: string[] = [];
    let done = false;
    if (role === 'gardener') {
      const t = job.tileId ? s.grid.byTileId(job.tileId) : undefined;
      if (t && this.growable(t)) {
        for (const g of [t, ...this.gardenNeighbours(t, hub)]) {
          s.restoration.grow(g);
          tileIds.push(g.id);
        }
        done = true;
      }
    } else if (role === 'scout') {
      const t = job.tileId ? s.grid.byTileId(job.tileId) : undefined;
      if (t && s.restoration.isEligible(t)) {
        s.restoration.beginGrowth(t, 'drone', TUNING.pulse.growSeconds);
        tileIds.push(t.id);
        const sweep = s.upgrades.droneSweep(hub) + (d.swarm ? TUNING.super.megahub.sweep : 0);
        if (sweep > 0) {
          // Free restores around it, fog-edge tiles first.
          const around = s.grid
            .tilesNear({ roofId: t.roofId, x: t.x, z: t.z, size: 1 }, 1)
            .filter((n) => n !== t && s.restoration.isEligible(n) && !s.drones.isReserved(n.id))
            .sort((a, b) => this.edge(b) - this.edge(a) || Math.abs(a.x - t.x) + Math.abs(a.z - t.z) - (Math.abs(b.x - t.x) + Math.abs(b.z - t.z)) || (a.id < b.id ? -1 : 1));
          for (const n of around.slice(0, sweep)) {
            s.restoration.beginGrowth(n, 'drone', TUNING.pulse.growSeconds + 0.15);
            tileIds.push(n.id);
          }
        }
        done = true;
      }
    } else if (role === 'courier') {
      const m = job.machineId ? s.machine(job.machineId) : undefined;
      if (m && this.deliver(m)) {
        machineIds.push(m.id);
        // Drone Sweep: one more machine per 2 levels, free, nearest first (the 8 s limit still applies).
        const extra = Math.floor(s.upgrades.levelOf(hub, 'droneSweep') / 2);
        if (extra > 0 && hub) for (const o of this.courierCandidates(d, hub).filter((o) => o !== m).slice(0, extra)) if (this.deliver(o)) machineIds.push(o.id);
        done = true;
      }
    } else if (role === 'spark') {
      const m = job.machineId ? s.machine(job.machineId) : undefined;
      if (m && this.spark(m)) {
        machineIds.push(m.id);
        done = true;
      }
    }
    if (done) {
      d.jobs++;
      s.state.stats.droneJobs++;
      if (!d.swarm) s.supers.onDroneJob(hub);
      s.bus.emit('drone.roleWork', { droneId: d.id, role, tileIds, machineIds });
    }
  }

  // ───────────── Gardener ─────────────

  private growable(t: TileData) {
    return t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom;
  }

  /** Restored tiles below Radiant: full bloom first, then Radiant (today's nurture score); "Keep blooming" first. */
  private gardenTarget(d: DroneData, hub: MachineData): TileData | undefined {
    const s = this.sim;
    const intel = s.upgrades.chainIntel(hub);
    const pick = (tiles: TileData[]) => {
      let best: TileData | undefined;
      let bestD = Infinity;
      for (const t of tiles) {
        if (!this.growable(t) || s.drones.isReserved(t.id)) continue;
        const mode = t.roofId === GROUND ? s.areas.mode(s.areas.areaOf(t)) : undefined;
        if (mode === 'off') continue;
        const dx = t.x + 0.5 - d.px;
        const dz = t.z + 0.5 - d.pz;
        let score = dx * dx + dz * dz + t.bloom * 2 + (t.bloom >= TUNING.restore.fullBloom ? 400 : 0) - (mode === 'bloom' ? TUNING.drone.bloomBonus * 4 : 0);
        if (intel) score -= s.drones.synergyScore(t) * 6;
        if (score < bestD - 1e-9) {
          bestD = score;
          best = t;
        }
      }
      return best;
    };
    return this.inReach(hub, pick);
  }

  /** The target's orthogonal neighbours that can still grow (2, +1 per Drone Sweep level), not another drone's target. */
  private gardenNeighbours(t: TileData, hub: MachineData | undefined): TileData[] {
    const s = this.sim;
    const n = TUNING.drone.roles.gardener.neighbours + s.upgrades.levelOf(hub, 'droneSweep');
    return s.grid
      .neighbors(t)
      .filter((g) => this.growable(g) && !s.drones.isReserved(g.id) && (g.roofId !== GROUND || s.areas.mode(s.areas.areaOf(g)) !== 'off'))
      .sort((a, b) => (a.bloom >= TUNING.restore.fullBloom ? 1 : 0) - (b.bloom >= TUNING.restore.fullBloom ? 1 : 0) || a.bloom - b.bloom || (a.id < b.id ? -1 : 1))
      .slice(0, n);
  }

  // ───────────── Scout ─────────────

  /** Fog-edge bonus of a tile (the drones' frontier test); "Focus the frontier" multiplies it. */
  private edge(t: TileData): number {
    const s = this.sim;
    if (t.roofId !== GROUND) return 0;
    const id = s.areas.areaOf(t);
    if (!id || s.areas.fog(id) === 'cleared' || !s.areas.canTouch(t)) return 0;
    return TUNING.drone.frontierBonus * (s.areas.mode(id) === 'frontier' ? TUNING.drone.focusMult : 1);
  }

  /** A Scout's own reach: its hub's radius plus half again the base radius (before Work Radius). */
  scoutReach(hub: MachineData): number {
    return this.sim.drones.radius(hub) + Math.round((TUNING.drone.roles.scout.reach - 1) * TUNING.drone.hubRadius);
  }

  private scoutTiles(hub: MachineData): TileData[] {
    return this.sim.drones.cachedTiles(`scout|${hub.id}`, () => this.sim.grid.tilesInRange(hub, this.scoutReach(hub)));
  }

  /** Fog-edge tiles only; with none in reach, any restorable tile (nearest). Never nurtures. */
  private scoutTarget(d: DroneData, hub: MachineData): TileData | undefined {
    const s = this.sim;
    const search = (tiles: TileData[], edgeOnly: boolean) => {
      let best: TileData | undefined;
      let bestD = Infinity;
      for (const t of tiles) {
        if (!s.restoration.isEligible(t) || s.drones.isReserved(t.id)) continue;
        if (t.roofId === GROUND && s.areas.mode(s.areas.areaOf(t)) === 'off') continue;
        const e = this.edge(t);
        if (edgeOnly && e <= 0) continue;
        const dx = t.x + 0.5 - d.px;
        const dz = t.z + 0.5 - d.pz;
        const score = dx * dx + dz * dz + (t.ground === 'prepared' ? 0 : 1.5) - e;
        if (score < bestD - 1e-9) {
          bestD = score;
          best = t;
        }
      }
      return best;
    };
    const own = this.scoutTiles(hub);
    const net = this.sim.drones.network(hub).length > 1 ? this.sim.drones.networkTiles(hub) : undefined;
    return search(own, true) ?? (net && search(net, true)) ?? search(own, false) ?? (net && search(net, false));
  }

  /** Restore pulse cost plus 1 ⚡ for every 4 tiles flown past the hub's base radius. */
  scoutCost(hub: MachineData, t: TileData): Cost {
    const c = this.sim.restoration.pulseCost(t);
    const dist = distToFootprint(t.x, t.z, hub.x, hub.z, hub.size);
    const extra = Math.floor(Math.max(0, dist - TUNING.drone.hubRadius) / TUNING.drone.roles.scout.tilesPerEnergy);
    return extra > 0 ? { ...c, energy: Economy.part(c, 'energy').add(extra) } : c;
  }

  // ───────────── Courier ─────────────

  private machineReserved(id: string, except?: DroneData) {
    return this.sim.state.drones.some((x) => x !== except && x.targetMachineId === id);
  }

  /** Would a delivery do anything here right now (and is it past its 8 s limit)? */
  courierUseful(m: MachineData): boolean {
    const s = this.sim;
    if ((this.delivered.get(m.id) ?? -Infinity) + TUNING.drone.roles.courier.everySeconds > s.time + 1e-9) return false;
    switch (m.type) {
      case 'motherTree':
        return m.charge < TUNING.motherTree.threshold;
      case 'solar':
        return m.boostUntil <= s.time;
      case 'condenser':
        return m.charge < TUNING.condenser.threshold;
      case 'reservoirGarden':
        return m.charge < TUNING.neighbourhood.reservoir.threshold;
      case 'relay':
        return this.relayLinks(m).some((id) => !s.relays.ready(id));
    }
    return false;
  }

  private relayLinks(m: MachineData): string[] {
    const s = this.sim;
    return s.relays.linked(m).map((o) => (m.id < o.id ? `relay:${m.id}|${o.id}` : `relay:${o.id}|${m.id}`)).filter((id) => s.state.links[id]);
  }

  /** How close a machine is to firing (0–1), for Chain Intelligence. */
  private closeness(m: MachineData): number {
    switch (m.type) {
      case 'motherTree':
        return m.charge / TUNING.motherTree.threshold;
      case 'condenser':
        return m.charge / TUNING.condenser.threshold;
      case 'reservoirGarden':
        return m.charge / TUNING.neighbourhood.reservoir.threshold;
      case 'relay': {
        const s = this.sim;
        const left = Math.min(...this.relayLinks(m).map((id) => Math.max(0, s.state.links[id].readyAt - s.time)));
        return 1 - Math.min(1, left / TUNING.relay.cooldown);
      }
    }
    return 0.5;
  }

  /** Machines in this hub's reach a Courier could serve now, best first. */
  private courierCandidates(d: DroneData, hub: MachineData): MachineData[] {
    const s = this.sim;
    const R = s.drones.radius(hub);
    const intel = s.upgrades.chainIntel(hub);
    const hubs = s.drones.network(hub);
    const seen = new Set<string>();
    const out: { m: MachineData; score: number }[] = [];
    for (const h of hubs)
      for (const m of s.grid.machinesNear(h.roofId, h.x, h.z, s.drones.radius(h) + h.size + 2)) {
        if (seen.has(m.id) || !COURIER_TYPES.has(m.type) || m.project) continue;
        seen.add(m.id);
        if (distToFootprint(m.x, m.z, h.x, h.z, h.size) - (m.size - 1) > s.drones.radius(h)) continue;
        if (m.roofId === GROUND && s.areas.mode(s.areas.areaOf(m)) === 'off') continue;
        if (this.machineReserved(m.id, d) || !this.courierUseful(m)) continue;
        const dx = m.x + m.size / 2 - d.px;
        const dz = m.z + m.size / 2 - d.pz;
        out.push({ m, score: dx * dx + dz * dz - (intel ? this.closeness(m) * 400 : 0) });
      }
    void R;
    return out.sort((a, b) => a.score - b.score || (a.m.id < b.m.id ? -1 : 1)).map((x) => x.m);
  }

  courierCost(m: MachineData): Cost {
    return { ...TUNING.drone.roles.courier.cost[m.type] };
  }

  private startCourier(d: DroneData, hub: MachineData): 'none' | 'broke' | 'started' {
    const cands = this.courierCandidates(d, hub);
    if (!cands.length) return 'none';
    // If one store is low, serve the machines it can still pay for.
    for (const m of cands.slice(0, 6)) {
      if (!this.sim.drones.payJob(this.courierCost(m))) continue;
      d.role = 'courier';
      d.targetMachineId = m.id;
      return 'started';
    }
    return 'broke';
  }

  /** One delivery (bounded: at most once per machine per 8 s). True if it did anything. */
  deliver(m: MachineData): boolean {
    const s = this.sim;
    const C = TUNING.drone.roles.courier;
    if (!this.courierUseful(m)) return false;
    this.delivered.set(m.id, s.time);
    switch (m.type) {
      case 'motherTree':
        // Charge only: a full tree releases its Bloom Pulse through its normal path (the next chain charge).
        m.charge = Math.min(TUNING.motherTree.threshold, m.charge + C.treeCharge);
        break;
      case 'solar':
        m.boostUntil = Math.max(m.boostUntil, s.time + TUNING.solarBloomBoost.seconds);
        s.bus.emit('solar.boost', { machineId: m.id });
        break;
      case 'condenser':
        m.charge = Math.min(TUNING.condenser.threshold, m.charge + C.storeCharge);
        break;
      case 'reservoirGarden':
        m.charge = Math.min(TUNING.neighbourhood.reservoir.threshold, m.charge + C.storeCharge);
        break;
      case 'relay':
        for (const id of this.relayLinks(m)) {
          const st = s.state.links[id];
          if (st.readyAt > s.time) st.readyAt = s.time + (st.readyAt - s.time) * (1 - C.relayCut);
        }
        break;
    }
    s.production.markDirty();
    return true;
  }

  // ───────────── Spark ─────────────

  /** Gardens in reach with enough other gardens in their chain reach to make a chain worth starting. */
  private sparkTarget(d: DroneData, hub: MachineData): MachineData | undefined {
    const s = this.sim;
    const reach = s.chains.synergyReach();
    let best: MachineData | undefined;
    let bestD = Infinity;
    for (const m of s.grid.machinesNear(hub.roofId, hub.x, hub.z, s.drones.radius(hub) + hub.size + 2)) {
      if (m.type !== 'pollinator' || m.project || this.machineReserved(m.id, d)) continue;
      if (distToFootprint(m.x, m.z, hub.x, hub.z, hub.size) - (m.size - 1) > s.drones.radius(hub)) continue;
      if (m.roofId === GROUND && s.areas.mode(s.areas.areaOf(m)) === 'off') continue;
      const cluster = s.grid.machinesNear(m.roofId, m.x, m.z, reach + m.size).filter((o) => o !== m && o.type === 'pollinator').length;
      if (cluster < TUNING.drone.roles.spark.cluster || !this.sparkTile(m)) continue;
      const dist = Math.hypot(m.x + m.size / 2 - d.px, m.z + m.size / 2 - d.pz);
      if (dist < bestD - 1e-9) {
        bestD = dist;
        best = m;
      }
    }
    return best;
  }

  /** The tile beside a garden the spark grows (or restores) to set the chain off. */
  private sparkTile(m: MachineData): TileData | undefined {
    const s = this.sim;
    const near = s.grid.tilesNear(m, 1).filter((t) => !t.occupantId && !s.drones.isReserved(t.id));
    return near.find((t) => this.growable(t)) ?? near.find((t) => s.restoration.isEligible(t));
  }

  private startSpark(d: DroneData, hub: MachineData): 'none' | 'broke' | 'started' {
    const S = TUNING.drone.roles.spark;
    if ((this.sparked.get(hub.id) ?? -Infinity) + S.everySeconds > this.sim.time + 1e-9) return 'none';
    const m = this.sparkTarget(d, hub);
    if (!m) return 'none';
    if (!this.sim.drones.payJob({ energy: S.energy })) return 'broke';
    this.sparked.set(hub.id, this.sim.time); // the per-hub limit counts from the paid trip
    d.role = 'spark';
    d.targetMachineId = m.id;
    return 'started';
  }

  /** Sets a chain off beside the garden (normal caps, depth and fast-forward; counted as automation). */
  private spark(m: MachineData): boolean {
    const s = this.sim;
    const t = this.sparkTile(m);
    if (!t) return false;
    if (this.growable(t)) s.restoration.grow(t, undefined, 'auto');
    else s.restoration.complete(t, 'drone');
    return true;
  }

  // ───────────── Harvester, unlock tracking ─────────────

  /** Once per sim tick (after production): lost-income seconds, and Harvesters turning lost income into biomass. */
  tick(dt: number) {
    const s = this.sim;
    const lost = s.log.overflow.energy + s.log.overflow.water;
    const delta = Math.max(0, lost - this.lastOverflow);
    this.lastOverflow = lost;
    if (delta > 0) this.lostSeconds += dt;
    if (delta <= 0) return;
    let drones = 0;
    for (const d of s.state.drones) if (!d.old && this.roleFor(d, s.machine(d.hubId)) === 'harvester') drones++;
    if (!drones) return;
    const H = TUNING.drone.roles.harvester;
    // Only income nobody else used (it was already lost); the Frenzy overflow rule is untouched.
    const collected = Math.min(delta, drones * H.perDronePerSec * dt);
    const paid = collected * (1 - H.keep) * H.rate;
    this.harvest.collected += collected;
    if (paid > 0) {
      const got = s.econ.add('biomass', paid);
      this.harvest.paid += got.toNumber();
    }
  }

  /** Is a Harvester at work right now (a store full and losing income)? */
  harvesting(): boolean {
    const s = this.sim;
    return s.econ.isFull('energy') || s.econ.isFull('water');
  }

  // ───────────── shared ─────────────

  /** Search the hub's own reach first, then its network's (as Restorers do). */
  private inReach(hub: MachineData, pick: (tiles: TileData[]) => TileData | undefined): TileData | undefined {
    const s = this.sim;
    return pick(s.drones.ownTiles(hub)) ?? (s.drones.network(hub).length > 1 ? pick(s.drones.networkTiles(hub)) : undefined);
  }

  /** E18 offline: Gardener and Scout work through the drone-job path; Courier, Spark and Harvester don't work offline. */
  offlineJob(d: DroneData, hub: MachineData, role: DroneRole): 'none' | 'broke' | { restored: number; grown: number } {
    const s = this.sim;
    if (role === 'gardener') {
      const t = this.gardenTarget(d, hub);
      if (!t) return 'none';
      if (!s.drones.payJob({ water: Economy.part(s.restoration.pulseCost(t), 'water') })) return 'broke';
      const all = [t, ...this.gardenNeighbours(t, hub)];
      for (const g of all) s.restoration.grow(g, undefined, 'auto', true);
      return { restored: 0, grown: all.length };
    }
    if (role === 'scout') {
      const t = this.scoutTarget(d, hub);
      if (!t) return 'none';
      if (!s.drones.payJob(this.scoutCost(hub, t))) return 'broke';
      s.restoration.complete(t, 'drone', undefined, true);
      return { restored: 1, grown: 0 };
    }
    return 'none';
  }
}

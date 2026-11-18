import { PARK } from '../core/Areas';
import { regionOfCell } from '../core/OldCityLayout';
import type { MachineData, PlanterState, WeatherKind } from '../core/types';
import { CROP_HOMES, CROP_IDS, CROPS, PLANTER, SEED_FINDS, STARTING_CROPS, type CropId, type Like } from '../data/crops';
import { DAY_SECONDS, gameDays } from '../data/farm';
import type { Sim } from './Sim';

/**
 * What the farm borrows from other sub-epics, each optional until it lands: watering from E23.4 (`sim.water`), the
 * clock and weather from E23.7. Without them every planter is watered, night is the second half of each 48-minute
 * day, and the weather is whatever E21's state holds (clear when unset).
 */
interface FarmHooks {
  water?: { isWatered?(t: { roofId: string; x: number; z: number }): boolean; isRunning?(t: { roofId: string; x: number; z: number }): boolean };
  clock?: { isNight?(): boolean };
  weather?: { kind?(): WeatherKind };
}

/** Why a planter is (or isn't) growing right now, for tests, tooltips and the crop visuals. */
export interface PlanterLook {
  crop?: CropId;
  /** 0..1 of the way to ripe */
  progress: number;
  /** 0 empty, 1 sprout … PLANTER.stages ripe */
  stage: number;
  ripe: boolean;
  /** no water: growth paused, leaves droop (never dies) */
  wilting: boolean;
  /** a hard need unmet (no night, no running water, no flooded bed): resting, not wilting */
  resting: boolean;
  /** growth per game day right now (0 = paused) */
  rate: number;
  /** soft likes met and unmet */
  met: Like[];
  unmet: Like[];
}

/**
 * E23.5.2 (#387, #426–#428): planter boxes. A planter is a machine; what grows in it lives in the save's
 * `salvage.planters`. A planted crop grows in game days while watered, at full rate when everything it likes is
 * met, slower when not; with no water it wilts and simply waits (crops never die). A ripe crop is harvested into
 * the backpack (food, biomass from the spent plants, seeds) and the bed is empty again. Seeds for new crops are
 * found by exploring: gathering a region's restored ground and emptying its piles turns up that region's packets.
 * Old-city rules only.
 */
export class FarmSystem {
  constructor(private sim: Sim) {
    sim.bus.on('biomass.gathered', (e) => this.onGathered(e.x, e.z));
    sim.bus.on('pile.salvaged', (e) => {
      if (e.left <= 0) this.findIn(this.regionAt(e.x, e.z));
    });
    sim.bus.on('machine.removed', ({ machine }) => this.forget(machine.id));
  }

  get on(): boolean {
    return !!this.sim.state.salvage;
  }

  private get hooks(): FarmHooks {
    return this.sim as unknown as FarmHooks;
  }

  // ───────────── state ─────────────

  bed(m: MachineData | string): PlanterState {
    const id = typeof m === 'string' ? m : m.id;
    return this.sim.state.salvage?.planters?.[id] ?? {};
  }

  private write(m: MachineData, st: PlanterState) {
    const sv = this.sim.state.salvage!;
    const clean = Object.fromEntries(Object.entries(st).filter(([, v]) => v !== undefined && v !== false && v !== 0)) as PlanterState;
    if (Object.keys(clean).length) (sv.planters ??= {})[m.id] = clean;
    else if (sv.planters) delete sv.planters[m.id];
  }

  planters(): MachineData[] {
    return this.sim.machinesOfType('planter');
  }

  /** Crops whose seeds bloombot has found (the starting ones included). */
  known(): CropId[] {
    const found = (this.sim.state.salvage?.crops ?? []) as CropId[];
    return [...STARTING_CROPS, ...found.filter((c) => !STARTING_CROPS.includes(c))];
  }

  knows(c: CropId): boolean {
    return this.known().includes(c);
  }

  // ───────────── the world around a planter ─────────────

  isWatered(m: MachineData): boolean {
    if (this.weather() === 'rain') return true;
    return this.hooks.water?.isWatered?.(m) ?? true;
  }

  isNight(): boolean {
    const hook = this.hooks.clock?.isNight?.();
    if (hook !== undefined) return hook;
    const offset = (this.sim.state.salvage?.clockOffset ?? 0) / DAY_SECONDS;
    const f = (gameDays(this.sim) + offset) % 1;
    return f >= 0.5;
  }

  weather(): WeatherKind {
    return this.hooks.weather?.kind?.() ?? this.sim.state.salvage?.weather?.kind ?? 'clear';
  }

  /** Is something tall beside the planter (a machine, a building, a blocked tile)? */
  private shaded(m: MachineData): boolean {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const t = this.sim.grid.peek(m.roofId, m.x + dx, m.z + dz);
        if (!t) continue;
        const occ = this.sim.occupant(t);
        if (t.blocked || (occ && occ.type !== 'planter')) return true;
      }
    return false;
  }

  /** Water flowing beside the planter (E23.4's network when it lands, else a canal or the sea next to it). */
  private runningWater(m: MachineData): boolean {
    const hook = this.hooks.water?.isRunning?.(m);
    if (hook !== undefined) return hook;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const t = this.sim.grid.peek(m.roofId, m.x + dx, m.z + dz);
      if (t?.feature === 'water') return true;
    }
    return false;
  }

  private near(m: MachineData, reach: number, ok: (o: MachineData) => boolean): boolean {
    for (const o of this.sim.state.machines) {
      if (o.id === m.id || o.roofId !== m.roofId || !ok(o)) continue;
      if (Math.max(Math.abs(o.x - m.x), Math.abs(o.z - m.z)) <= reach) return true;
    }
    return false;
  }

  /** Fed with fertiliser, or beans growing next door. */
  fertilised(m: MachineData): boolean {
    if (this.bed(m).fed) return true;
    return this.near(m, PLANTER.beansReach, (o) => o.type === 'planter' && this.bed(o).crop === 'beans');
  }

  /** Pollinators within reach: a lavender and mint bed, or a Pollinator Garden. */
  pollinated(m: MachineData): boolean {
    return this.near(m, PLANTER.pollinatorReach, (o) => o.type === 'pollinator' || (o.type === 'planter' && this.bed(o).crop === 'herbs'));
  }

  /** Is one like met at this planter right now? */
  likeMet(m: MachineData, like: Like): boolean {
    const st = this.bed(m);
    const w = this.weather();
    switch (like) {
      case 'sun':
        return !this.isNight() && (w === 'clear' || w === 'windy');
      case 'rain':
        return w === 'rain';
      case 'wind':
        return w === 'windy';
      case 'shade':
        return this.shaded(m);
      case 'trellis':
        return !!st.trellis;
      case 'flooded':
        return !!st.flooded;
      case 'fertiliser':
        return this.fertilised(m);
      case 'runningWater':
        return this.runningWater(m);
      case 'night':
        return this.isNight();
      case 'saltAir':
        return this.regionAt(m.x, m.z) === 'saltwind';
    }
  }

  /** Everything about a planter now: its stage, whether it wilts or rests, how fast it grows and why. */
  look(m: MachineData): PlanterLook {
    const st = this.bed(m);
    const crop = st.crop as CropId | undefined;
    if (!crop || !CROPS[crop]) return { progress: 0, stage: 0, ripe: false, wilting: false, resting: false, rate: 0, met: [], unmet: [] };
    const def = CROPS[crop];
    const progress = Math.min(1, (st.grown ?? 0) / def.days);
    const ripe = progress >= 1;
    const stage = ripe ? PLANTER.stages : 1 + Math.min(PLANTER.stages - 2, Math.floor(progress * (PLANTER.stages - 1)));
    const wilting = !ripe && !this.isWatered(m);
    const resting = !ripe && def.needs.some((n) => !this.likeMet(m, n));
    const met = def.likes.filter((l) => this.likeMet(m, l));
    const unmet = def.likes.filter((l) => !met.includes(l));
    let rate = 0;
    if (!ripe && !wilting && !resting) {
      rate = PLANTER.unmetLike ** unmet.length;
      if (crop !== 'pumpkin' && this.fertilised(m)) rate *= PLANTER.fertilisedBoost;
      if (this.pollinated(m)) rate *= PLANTER.pollinatorBoost;
    }
    return { crop, progress, stage, ripe, wilting, resting, rate, met, unmet };
  }

  // ───────────── growing ─────────────

  /** Per sim step: every planted bed grows by its rate (in game days). */
  tick(dt: number) {
    if (!this.on) return;
    const list = this.planters();
    if (!list.length) return;
    const days = dt / DAY_SECONDS;
    for (const m of list) {
      const st = this.bed(m);
      if (!st.crop) continue;
      const lk = this.look(m);
      if (lk.rate <= 0) continue;
      const def = CROPS[st.crop as CropId];
      const was = lk.stage;
      const grown = Math.min(def.days, (st.grown ?? 0) + lk.rate * days);
      this.write(m, { ...st, grown: Math.round(grown * 1e6) / 1e6 });
      const now = this.look(m);
      if (now.stage !== was) this.sim.bus.emit('planter.changed', { machineId: m.id });
      if (now.ripe && !lk.ripe) this.sim.bus.emit('planter.ripe', { machineId: m.id, crop: st.crop });
    }
  }

  // ───────────── what bloombot does at a planter ─────────────

  /** Why a crop can't be planted here now (undefined: it can). */
  plantProblem(m: MachineData, crop: CropId): string | undefined {
    if (!this.on || m.type !== 'planter') return 'Not a planter';
    if (this.bed(m).crop) return 'Something is already growing here';
    if (!this.knows(crop)) return 'No seeds for that yet';
    if (!this.sim.inventory.canPay({ seeds: PLANTER.seedCost })) return 'Needs Seeds';
    return undefined;
  }

  plant(m: MachineData, crop: CropId): boolean {
    const why = this.plantProblem(m, crop);
    if (why) {
      this.sim.bus.emit('action.failed', { reason: why });
      return false;
    }
    this.sim.inventory.pay({ seeds: PLANTER.seedCost });
    this.write(m, { ...this.bed(m), crop, grown: 0 });
    this.sim.bus.emit('planter.changed', { machineId: m.id });
    return true;
  }

  /** Harvests a ripe bed into the backpack (anything over a stack goes to the store). Returns what it gave. */
  harvest(m: MachineData): { food: number; biomass: number; seeds: number } | undefined {
    const lk = this.look(m);
    if (!lk.ripe || !lk.crop) {
      this.sim.bus.emit('action.failed', { reason: lk.crop ? 'Not ripe yet' : 'Nothing growing here' });
      return undefined;
    }
    const got = CROPS[lk.crop].harvest;
    const inv = this.sim.inventory;
    for (const k of ['food', 'biomass', 'seeds'] as const) if (got[k] > 0) inv.addToStore(k, inv.add(k, got[k]));
    const st = this.bed(m);
    this.write(m, { trellis: st.trellis, flooded: st.flooded });
    this.sim.bus.emit('planter.harvested', { machineId: m.id, crop: lk.crop, ...got });
    this.sim.bus.emit('planter.changed', { machineId: m.id });
    return got;
  }

  /** Feeds a bed one fertiliser (it lasts until the next harvest). */
  feed(m: MachineData): boolean {
    const st = this.bed(m);
    if (st.fed) return false;
    if (!this.sim.inventory.pay({ fertiliser: PLANTER.feedCost })) {
      this.sim.bus.emit('action.failed', { reason: 'Needs Fertiliser' });
      return false;
    }
    this.write(m, { ...st, fed: true });
    this.sim.bus.emit('planter.changed', { machineId: m.id });
    return true;
  }

  /** Builds an extra onto a planter: a trellis (Timber) or a flooded bed (Clay). */
  addExtra(m: MachineData, extra: 'trellis' | 'flooded'): boolean {
    const st = this.bed(m);
    if (st[extra]) return false;
    if (!this.sim.inventory.pay(PLANTER.extras[extra])) {
      this.sim.bus.emit('action.failed', { reason: extra === 'trellis' ? 'Needs Timber' : 'Needs Clay' });
      return false;
    }
    this.write(m, { ...st, [extra]: true });
    this.sim.bus.emit('planter.changed', { machineId: m.id });
    return true;
  }

  /** A removed planter takes its bed with it. */
  forget(id: string) {
    const p = this.sim.state.salvage?.planters;
    if (p) delete p[id];
  }

  // ───────────── seeds from exploring (E23.5.2.3) ─────────────

  /** The region a cell belongs to ('park' for the park), if any. */
  regionAt(x: number, z: number): string | undefined {
    const r = regionOfCell(x, z);
    if (r) return r.id;
    return this.sim.areas?.map?.areaOfCell(x, z) === PARK ? 'park' : undefined;
  }

  /** The next seed packet a region still holds (undefined: none left). */
  nextIn(region: string | undefined): CropId | undefined {
    if (!region) return undefined;
    return (CROP_HOMES[region] ?? []).find((c) => !this.knows(c));
  }

  /** Finds a region's next seed packet. Returns the crop found, if any. */
  findIn(region: string | undefined): CropId | undefined {
    const c = this.nextIn(region);
    if (!c || !this.on) return undefined;
    (this.sim.state.salvage!.crops ??= []).push(c);
    this.sim.bus.emit('seeds.found', { crop: c, region: region! });
    return c;
  }

  private onGathered(x: number, z: number) {
    const region = this.regionAt(x, z);
    if (!region || !this.nextIn(region)) return;
    const sv = this.sim.state.salvage!;
    const n = ((sv.seedFinds ??= {})[region] ?? 0) + 1;
    if (n >= SEED_FINDS.gathersPerPacket) {
      delete sv.seedFinds[region];
      this.findIn(region);
    } else sv.seedFinds[region] = n;
  }

  /** Every crop, known or not (the picker greys out the unknown). */
  all(): CropId[] {
    return CROP_IDS;
  }
}

export const isPlanter = (m: MachineData | undefined): m is MachineData => m?.type === 'planter';

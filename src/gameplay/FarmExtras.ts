import { GROUND } from '../core/GameState';
import { keeperById } from '../core/OldCityLayout';
import type { ExtraState, MachineData, MachineType } from '../core/types';
import { CROP_IDS, CROPS, type CropId } from '../data/crops';
import { DAY_SECONDS } from '../data/time';
import { WATER_NET } from '../data/water';
import { FRUIT_IDS, fruitOfArea, type FruitId } from '../data/fruit';
import { BEEHIVE, type OrchardSeasonRule, type FruitPhase, DIVERSITY, FISH_POND, FLOWERING, GARDEN_REQUESTS, HOME, HOMES, KEEPER_GARDEN, MUSHROOM_LOG, ORCHARD, WORM_BIN, type GardenRequest, type GardenReward, type Habitat, type HomeKind } from '../data/farmExtras';
import { machineStrengthAt } from '../core/RegionStrengths';
import type { Sim } from './Sim';
import type { PipeNet } from './WaterPipes';

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** #785: which of `steps` looks a 0…1 progress shows (the last step only when it is complete). */
export const fruitStep = (k: number, steps: number): number => (k >= 1 ? steps : Math.min(steps - 1, Math.floor(Math.max(0, k) * steps)));

/** The E23.5.4 machine types. */
export const EXTRA_TYPES = ['beehive', 'fishPond', 'orchard', 'mushroomLog', 'wormBin', 'birdBox', 'batBox', 'hedgehogHouse', 'butterflyGarden'] as const satisfies readonly MachineType[];
export type ExtraType = (typeof EXTRA_TYPES)[number];
export const isExtra = (t: string): t is ExtraType => (EXTRA_TYPES as readonly string[]).includes(t);
export const isHome = (t: string): t is HomeKind => t in HOMES;

/**
 * E23.5.4 (#389, #429–#434): beyond planters. Each thing to tend plugs into an existing system:
 *  - beehives settle near flowers and herbs, fill with honey (a strong snack: food) and speed crops in reach;
 *  - fish ponds kept filled from the water network fertilise the planters their water reaches;
 *  - orchards are planted once, fruit every few game days, and give timber when pruned;
 *  - mushroom logs, fed compost, grow food at night or in fog while shaded; worm bins, fed scraps, make compost bins
 *    next to them work twice as fast;
 *  - wildlife homes each want their own habitat; once it is right their creature moves in (and moves out gently if
 *    it goes wrong). Creatures are wild, never kept;
 *  - Keeper gardens: a planter near a woken Keeper grows what the Keeper asks for; harvesting it there fulfils the
 *    request (a decoration, a seed packet from far away, or a recipe).
 * Every kind tended in an area, and every creature living there, adds to the area's diversity. Old-city rules only.
 */
export class FarmExtras {
  constructor(private sim: Sim) {
    sim.bus.on('machine.removed', ({ machine }) => this.forget(machine.id));
    sim.bus.on('planter.harvested', (e) => this.onHarvest(e.machineId, e.crop as CropId));
  }

  get on(): boolean {
    return !!this.sim.state.salvage;
  }

  st(m: MachineData | string): ExtraState {
    const id = typeof m === 'string' ? m : m.id;
    return this.sim.state.salvage?.extras?.[id] ?? {};
  }

  private write(m: MachineData, st: ExtraState) {
    const sv = this.sim.state.salvage!;
    const clean = Object.fromEntries(Object.entries(st).filter(([, v]) => v !== undefined && v !== 0 && v !== false)) as ExtraState;
    for (const [k, v] of Object.entries(clean)) if (typeof v === 'number') (clean as Record<string, number>)[k] = Math.round(v * 1e6) / 1e6;
    if (Object.keys(clean).length) (sv.extras ??= {})[m.id] = clean;
    else if (sv.extras) delete sv.extras[m.id];
  }

  private changed(m: MachineData) {
    this.sim.bus.emit('farm.machine', { machineId: m.id });
  }

  private forget(id: string) {
    const sv = this.sim.state.salvage;
    if (sv?.extras) delete sv.extras[id];
  }

  // ───────────── looking around ─────────────

  private tilesNear(m: MachineData, reach: number) {
    const out = [];
    for (let dx = -reach; dx <= reach + m.size - 1; dx++)
      for (let dz = -reach; dz <= reach + m.size - 1; dz++) {
        const t = this.sim.grid.peek(m.roofId, m.x + dx, m.z + dz);
        if (t) out.push(t);
      }
    return out;
  }

  private machinesNear(m: MachineData, reach: number, ok: (o: MachineData) => boolean): MachineData[] {
    return this.sim.state.machines.filter((o) => o.id !== m.id && o.roofId === m.roofId && ok(o) && Math.max(Math.abs(o.x - m.x), Math.abs(o.z - m.z)) <= reach + Math.max(0, m.size - 1));
  }

  /** Flowering things in reach: restored ground in flower (bloom 2+) and flower or herb beds. */
  flowersNear(m: MachineData, reach: number): number {
    const ground = this.tilesNear(m, reach).filter((t) => t.ground === 'restored' && t.bloom >= 2 && !t.occupantId).length;
    const beds = this.machinesNear(m, reach, (o) => o.type === 'planter' && FLOWERING.crops.includes(this.sim.farm.bed(o).crop as CropId)).length;
    return ground + beds * FLOWERING.bedWeight;
  }

  /** Night on the GAME clock (E23.7.1), never the sky: the same play time in both clock modes. */
  private isNight(): boolean {
    return this.sim.farm.isNight();
  }

  private foggy(): boolean {
    return this.sim.farm.weather() === 'fog';
  }

  // ───────────── E23.5.4.1 beehives ─────────────

  /** A hive's bees settle once enough flowers and herbs grow near it. */
  hiveSettled(m: MachineData): boolean {
    return this.flowersNear(m, BEEHIVE.reach) >= BEEHIVE.minFlowers;
  }

  /** Crop growth multiplier from settled hives near a planter (FarmSystem reads it). */
  cropBoost(planter: MachineData): number {
    return this.machinesNear(planter, BEEHIVE.reach, (o) => o.type === 'beehive' && this.hiveSettled(o)).length ? BEEHIVE.cropBoost : 1;
  }

  // ───────────── E23.5.4.2 fish ponds ─────────────

  /**
   * E23.4: a pond is kept filled from the real water near it (a canal or pond within `waterReach` still holding
   * water), or by a pipe carrying water beside it (E23.4.2).
   */
  pondFilled(m: MachineData): boolean {
    const t = this.sim.grid.get(m.roofId, m.x, m.z);
    return this.pondLevel(m) > WATER_NET.dryBelow || (!!t && this.sim.water.pipes.feeds(t));
  }

  /** 0…1: the level of the water near a pond that keeps it filled (the fullest body within `waterReach`). */
  pondLevel(m: MachineData): number {
    const t = this.sim.grid.get(m.roofId, m.x, m.z);
    return t ? this.sim.water.wetness(t, FISH_POND.waterReach) : 0;
  }

  /** Does a filled fish pond's water reach this planter: within `feedReach`, or piped from it (E23.4.2)? */
  pondFeeds(planter: MachineData): boolean {
    for (const p of this.sim.machinesOfType('fishPond')) {
      if (!this.pondFilled(p)) continue;
      if (Math.max(Math.abs(p.x - planter.x), Math.abs(p.z - planter.z)) <= FISH_POND.feedReach + p.size - 1) return true;
      if (this.pipedTo(p, planter)) return true;
    }
    return false;
  }

  /**
   * E23.4.2 (#430): a pond's water piped to a planter: a run of pipe that touches the pond also passes within
   * `pipeReach` of the planter.
   */
  pipedTo(pond: MachineData, planter: MachineData): boolean {
    if (pond.roofId !== GROUND || planter.roofId !== GROUND) return false;
    const pipes = this.sim.water.pipes;
    const runs = new Set<PipeNet>();
    for (const t of this.sim.grid.footprint(pond.roofId, pond.x, pond.z, pond.size))
      for (const [dx, dz] of SIDES) {
        const net = t && pipes.netAt(t.x + dx, t.z + dz);
        if (net) runs.add(net);
      }
    if (!runs.size) return false;
    const R = WATER_NET.pipeReach;
    for (const net of runs)
      for (const k of net.tiles) {
        const [x, z] = k.split(',').map(Number);
        if (Math.max(Math.abs(x - planter.x), Math.abs(z - planter.z)) <= R + planter.size - 1) return true;
      }
    return false;
  }

  // ───────────── E23.5.4.3 orchards ─────────────

  /** Ripe fruit waiting on the tree? */
  fruitReady(m: MachineData): boolean {
    return (this.st(m).ready ?? 0) >= 1;
  }

  /** 0 just planted … 1 a grown tree (it fruits from then on). */
  treeGrowth(m: MachineData): number {
    return Math.max(0, Math.min(1, (this.st(m).age ?? 0) / ORCHARD.grownDays));
  }

  /** 0 just picked (or planted) … 1 ripe: how far today's fruit has come. */
  ripeness(m: MachineData): number {
    const st = this.st(m);
    if ((st.ready ?? 0) >= 1) return 1;
    return Math.max(0, Math.min(1, (st.growing ?? 0) / ORCHARD.fruitDays));
  }

  /** What the tree shows now (see FruitPhase). */
  fruitPhase(m: MachineData): FruitPhase {
    if (this.fruitReady(m)) return 'ripe';
    if (this.treeGrowth(m) < 1) return 'young';
    const r = this.fruitShown(m)!;
    if (r < ORCHARD.blossomUntil) return r >= ORCHARD.bareUntil && this.seasonRule().blossom ? 'blossom' : 'bare';
    return r < ORCHARD.nearlyRipe ? 'green' : 'nearly';
  }

  /** #785: the fruit this tree bears, by where it grows (data/fruit: apples in the park, pears in the market…). */
  fruitOf(m: MachineData): FruitId {
    return fruitOfArea(this.sim.areas?.areaOf(m));
  }

  /**
   * #785 → #830: what the season lets a fruit tree do. Until seasons arrive (`sim.seasons`), every day is its own
   * little year: bare after picking, then flowers, then fruit. With seasons, ORCHARD.seasons says (flowers in spring,
   * fruit in summer and autumn, resting in winter).
   */
  seasonRule(): OrchardSeasonRule {
    const season = (this.sim as unknown as { seasons?: { season(): string } }).seasons?.season();
    return (season !== undefined && ORCHARD.seasons[season]) || ORCHARD.daily;
  }

  /** Game days until the fruit is ripe (0 when it is), at the tree's own pace (fertile soil is quicker). */
  daysToRipe(m: MachineData): number {
    if (this.fruitReady(m)) return 0;
    const pace = machineStrengthAt('orchard', m.x, m.z);
    return Math.max(0, ORCHARD.fruitDays - (this.st(m).growing ?? 0)) / Math.max(1e-6, pace);
  }

  /** Does the tree want pruning (it fruits less until pruned)? */
  overgrown(m: MachineData): boolean {
    return (this.st(m).sincePrune ?? 0) >= ORCHARD.pruneDays;
  }

  /** What picking this tree would give right now (0: nothing ripe). */
  fruitYield(m: MachineData): number {
    if (!this.fruitReady(m)) return 0;
    // an overgrown tree gives less, except in Cozy Mode (there it only looks shaggy)
    const less = this.st(m).overgrownCrop && !this.sim.decay.cozyMode;
    return Math.max(1, Math.round(ORCHARD.fruit * (less ? ORCHARD.overgrownFruit : 1)));
  }

  /** Why a tree can't be picked now, in words (undefined: it can). */
  pickProblem(m: MachineData): string | undefined {
    if (this.fruitReady(m)) return undefined;
    if (this.fruitPhase(m) === 'young') return 'The tree is still growing';
    const rule = this.seasonRule();
    return rule.ripens ? 'The fruit isn’t ripe yet' : rule.blossom ? 'It’s flowering: fruit comes in summer' : 'It’s resting until spring';
  }

  /** Picks the ripe fruit into the backpack (the store takes what doesn't fit); the tree starts the next day's fruit. */
  pick(m: MachineData): number {
    const st = this.st(m);
    const n = this.fruitYield(m);
    if (!n) {
      this.sim.bus.emit('action.failed', { reason: this.pickProblem(m)! });
      return 0;
    }
    const inv = this.sim.inventory;
    const item = this.fruitOf(m);
    inv.addToStore(item, inv.add(item, n));
    this.write(m, { ...st, ready: 0, growing: 0, overgrownCrop: false });
    this.sim.bus.emit('farm.harvested', { machineId: m.id, item, n });
    this.changed(m);
    return n;
  }

  prune(m: MachineData): number {
    const st = this.st(m);
    if (!this.overgrown(m)) {
      this.sim.bus.emit('action.failed', { reason: 'It doesn’t need pruning yet' });
      return 0;
    }
    const inv = this.sim.inventory;
    inv.addToStore('timber', inv.add('timber', ORCHARD.timber));
    this.write(m, { ...st, sincePrune: 0 });
    this.sim.bus.emit('farm.harvested', { machineId: m.id, item: 'timber', n: ORCHARD.timber });
    this.changed(m);
    return ORCHARD.timber;
  }

  /**
   * #785: a tree grows for `grownDays`, and its fruit ripens over `fruitDays` from planting and again from each
   * picking (sim time, so it carries on across a save and load exactly where it was). Ripe fruit waits on the tree.
   * The look changes in steps (`fruitStep`), and each step tells the renderer.
   */
  private tickOrchard(m: MachineData, days: number) {
    const st = { ...this.st(m) };
    const was = { look: this.fruitLook(m), over: this.overgrown(m) };
    st.age = (st.age ?? 0) + days;
    st.sincePrune = (st.sincePrune ?? 0) + days;
    if ((st.ready ?? 0) < 1 && !this.seasonRule().ripens) st.growing = 0; // out of season: unripe fruit drops, nothing sets
    else if ((st.ready ?? 0) < 1) {
      st.growing = (st.growing ?? 0) + days * machineStrengthAt('orchard', m.x, m.z); // E23.8.1: fertile soil
      if (st.growing >= ORCHARD.fruitDays) {
        st.ready = 1;
        st.growing = 0;
        st.crops = (st.crops ?? 0) + 1;
        st.overgrownCrop = (st.sincePrune ?? 0) >= ORCHARD.pruneDays;
      }
    }
    this.write(m, st);
    if (was.look !== this.fruitLook(m) || was.over !== this.overgrown(m)) this.changed(m);
  }

  /**
   * How far the fruit on the tree shows, in its look's steps (0, 1/12 … 1; see ORCHARD.looks), or undefined while the
   * tree is still growing up (no flowers or fruit yet). What the renderer draws, and what the words describe.
   */
  fruitShown(m: MachineData): number | undefined {
    if (this.fruitReady(m)) return 1;
    if (this.treeGrowth(m) < 1) return undefined;
    const rule = this.seasonRule();
    if (!rule.ripens) return rule.blossom ? ORCHARD.seasonBloom : 0; // spring's flowers, or winter's bare branches
    return fruitStep(this.ripeness(m), ORCHARD.looks) / ORCHARD.looks;
  }

  /** The tree's look: how far its fruit has come, in steps (a dozen changes a day), or '-' while it grows up. */
  fruitLook(m: MachineData): string {
    return `${this.fruitShown(m) ?? '-'}|${this.seasonRule().blossom ? 1 : 0}`;
  }

  // ───────────── E23.5.4.4 mushroom logs and worm bins ─────────────

  /** A log grows only shaded (something tall beside it). */
  logShaded(m: MachineData): boolean {
    for (const t of this.tilesNear(m, 1)) {
      if (t.x === m.x && t.z === m.z) continue;
      const occ = this.sim.occupant(t);
      if (t.blocked || (occ && occ.id !== m.id && occ.type !== 'planter') || (t.ground === 'restored' && t.bloom >= 3)) return true;
    }
    return false;
  }

  /** Is the log growing right now (fed, shaded, and night or fog)? */
  logGrowing(m: MachineData): boolean {
    const st = this.st(m);
    // E23.8.1: under shelter (Glasshouse Gardens) it is always dim and damp enough
    const sheltered = machineStrengthAt('mushroomLog', m.x, m.z) > 1;
    return (st.flushes ?? 0) > 0 && (st.ready ?? 0) < 1 && this.logShaded(m) && (sheltered || this.isNight() || this.foggy());
  }

  /** Feeds a spent log compost (it then gives `flushes` crops). */
  inoculate(m: MachineData): boolean {
    const st = this.st(m);
    if ((st.flushes ?? 0) > 0) return false;
    if (!this.sim.inventory.pay({ compost: MUSHROOM_LOG.compost })) {
      this.sim.bus.emit('action.failed', { reason: 'Needs Compost' });
      return false;
    }
    this.write(m, { ...st, flushes: MUSHROOM_LOG.flushes, growing: 0 });
    this.changed(m);
    return true;
  }

  pickMushrooms(m: MachineData): number {
    const st = this.st(m);
    if ((st.ready ?? 0) < 1) return 0;
    const inv = this.sim.inventory;
    inv.addToStore('food', inv.add('food', MUSHROOM_LOG.food));
    this.write(m, { ...st, ready: 0 });
    this.sim.bus.emit('farm.harvested', { machineId: m.id, item: 'food', n: MUSHROOM_LOG.food });
    this.changed(m);
    return MUSHROOM_LOG.food;
  }

  private tickLog(m: MachineData, days: number) {
    if (!this.logGrowing(m)) return;
    const st = { ...this.st(m) };
    st.growing = (st.growing ?? 0) + days;
    if (st.growing >= MUSHROOM_LOG.flushDays) {
      st.growing = 0;
      st.ready = 1;
      st.flushes = (st.flushes ?? 1) - 1;
      this.write(m, st);
      this.changed(m);
      return;
    }
    this.write(m, st);
  }

  /** Feeds a worm bin scraps (food first, else biomass). Returns true when fed. */
  feedWorms(m: MachineData): boolean {
    const st = this.st(m);
    if ((st.fed ?? 0) + WORM_BIN.feedDays > WORM_BIN.maxDays + 1e-9) {
      this.sim.bus.emit('action.failed', { reason: 'The worms are full' });
      return false;
    }
    const inv = this.sim.inventory;
    // scraps: Food, then fruit (#785, the most plentiful kind), then Greens
    const fruit = [...FRUIT_IDS].sort((a, b) => inv.count(b) - inv.count(a))[0];
    const item = inv.count('food') >= WORM_BIN.feedCost ? 'food' : inv.count(fruit) >= WORM_BIN.feedCost ? fruit : 'biomass';
    if (!inv.pay({ [item]: WORM_BIN.feedCost })) {
      this.sim.bus.emit('action.failed', { reason: 'Needs Food or Greens' });
      return false;
    }
    this.write(m, { ...st, fed: (st.fed ?? 0) + WORM_BIN.feedDays });
    this.changed(m);
    return true;
  }

  /** CompostSystem reads this: fed worm bins next to a compost bin make it work twice as fast. */
  compostSpeed(bin: MachineData): number {
    return this.machinesNear(bin, WORM_BIN.reach, (o) => o.type === 'wormBin' && (this.st(o).fed ?? 0) > 0).length ? WORM_BIN.speed : 1;
  }

  private tickWorms(m: MachineData, days: number) {
    const st = this.st(m);
    if (!st.fed) return;
    const left = Math.max(0, st.fed - days);
    this.write(m, { ...st, fed: left });
    if (left <= 0) this.changed(m);
  }

  // ───────────── E23.5.4.5 wildlife homes ─────────────

  /** Is one kind of habitat present around a home? */
  habitat(m: MachineData, h: Habitat): boolean {
    const tiles = this.tilesNear(m, HOME.reach);
    switch (h) {
      case 'trees':
        return tiles.some((t) => t.ground === 'restored' && t.bloom >= 3) || this.machinesNear(m, HOME.reach, (o) => o.type === 'orchard' || o.type === 'motherTree').length > 0;
      case 'shrubs':
        return tiles.filter((t) => t.ground === 'restored' && t.bloom >= 3).length >= HOME.plants;
      case 'flowers':
        return this.flowersNear(m, HOME.reach) >= HOME.plants;
      case 'water':
        // fresh water only: a canal or a restored pond (never a dead silted bed, the sea or the surf), or a fish pond
        return tiles.some((t) => this.sim.water.isFresh(t)) || this.machinesNear(m, HOME.reach, (o) => o.type === 'fishPond').length > 0;
      case 'night':
        return this.isNight();
      case 'quiet':
        return !this.machinesNear(m, 1, (o) => !isExtra(o.type) && o.type !== 'planter' && o.type !== 'compostBin').length;
    }
  }

  /** What a home still lacks (empty: its habitat is right). */
  missing(m: MachineData): Habitat[] {
    if (!isHome(m.type)) return [];
    return HOMES[m.type].needs.filter((h) => !this.habitat(m, h));
  }

  /** Has the home's creature moved in? */
  occupied(m: MachineData): boolean {
    return !!this.st(m).settled;
  }

  /** Bats are home all day but out flying at night; the rest are about whenever they live there. */
  creatureOut(m: MachineData): boolean {
    if (!this.occupied(m)) return false;
    return m.type === 'batBox' ? this.isNight() : true;
  }

  private tickHome(m: MachineData, days: number) {
    const st = { ...this.st(m) };
    const right = this.missing(m).length === 0;
    if (right && !st.settled) {
      st.waiting = (st.waiting ?? 0) + days;
      if (st.waiting >= HOME.settleDays) {
        st.settled = true;
        st.waiting = 0;
        this.write(m, st);
        this.sim.bus.emit('wildlife.moved', { machineId: m.id, creature: HOMES[m.type as HomeKind].creature, in: true });
        this.changed(m);
        return;
      }
    } else if (!right && st.settled) {
      // the habitat went wrong: the creature leaves gently, and comes back once it is right again
      st.settled = false;
      st.waiting = 0;
      this.write(m, st);
      this.sim.bus.emit('wildlife.moved', { machineId: m.id, creature: HOMES[m.type as HomeKind].creature, in: false });
      this.changed(m);
      return;
    } else if (!right) st.waiting = 0;
    this.write(m, st);
  }

  // ───────────── E23.5.4.6 Keeper gardens ─────────────

  /** The woken Keeper whose garden this planter is (a planter within reach of it), if any. */
  gardenOf(planter: MachineData): string | undefined {
    if (planter.type !== 'planter' || planter.roofId !== GROUND) return undefined;
    const sv = this.sim.state.salvage;
    if (!sv) return undefined;
    let best: { id: string; d: number } | undefined;
    for (const id of Object.keys(GARDEN_REQUESTS)) {
      const k = keeperById(id);
      const st = sv.keepers[id];
      if (!k || !st || st.step === 'asleep') continue;
      const d = Math.max(Math.abs(k.x - planter.x), Math.abs(k.z - planter.z));
      if (d <= KEEPER_GARDEN.reach && (!best || d < best.d)) best = { id, d };
    }
    return best?.id;
  }

  /** The garden request a Keeper has open now (undefined: all done). */
  request(keeperId: string): GardenRequest | undefined {
    const done = this.sim.state.salvage?.gardens?.[keeperId] ?? 0;
    return GARDEN_REQUESTS[keeperId]?.[done];
  }

  /** Harvesting a planter that is a Keeper's garden, with the crop it asked for, fulfils the request. */
  private onHarvest(machineId: string, crop: CropId) {
    const m = this.sim.machine(machineId);
    if (!m) return;
    const keeper = this.gardenOf(m);
    const req = keeper ? this.request(keeper) : undefined;
    if (!keeper || !req || req.crop !== crop) return;
    const sv = this.sim.state.salvage!;
    (sv.gardens ??= {})[keeper] = (sv.gardens[keeper] ?? 0) + 1;
    const given = this.give(req);
    this.sim.keepers.tend(keeper); // E23.9.2: a grown garden warms the Keeper's friendship
    this.sim.bus.emit('garden.fulfilled', { keeperId: keeper, crop, reward: given });
  }

  /** Hands over a request's reward. Returns what was really given (the Keeper names it). */
  private give(req: GardenRequest): GardenReward {
    const r = req.reward;
    const sv = this.sim.state.salvage!;
    if (r.kind === 'seeds') {
      // always real seeds: the crop if it's new, else the next crop not yet known, else a handful of plain Seeds
      const crop = !this.sim.farm.knows(r.crop) ? r.crop : CROP_IDS.find((c) => !this.sim.farm.knows(c));
      if (crop) {
        (sv.crops ??= []).push(crop);
        return { kind: 'seeds', crop };
      }
      const inv = this.sim.inventory;
      inv.addToStore('seeds', inv.add('seeds', KEEPER_GARDEN.plainSeeds));
      return { kind: 'items', item: 'seeds', n: KEEPER_GARDEN.plainSeeds };
    }
    if (r.kind === 'recipe') {
      if (!(sv.recipes ??= []).includes(r.machine)) sv.recipes.push(r.machine);
      return r;
    }
    if (r.kind === 'decor') {
      // E23.6.1: a decoration is bloombot's once made (then free to place): a Keeper's gift counts as made
      if (this.sim.crafting.decor(r.id)) {
        if (!this.sim.crafting.decorMade(r.id)) sv.decorMade = [...(sv.decorMade ?? []), r.id].sort();
      } else {
        const cozy = (this.sim.state.cozy ??= {} as NonNullable<typeof this.sim.state.cozy>);
        if (!(cozy.decorUnlocked ??= []).includes(r.id)) cozy.decorUnlocked.push(r.id);
      }
    }
    return r;
  }

  /** A recipe a Keeper's garden hands over (BuildSystem keeps these machines locked until then). */
  hasRecipe(machine: string): boolean {
    return !!this.sim.state.salvage?.recipes?.includes(machine);
  }

  // ───────────── diversity ─────────────

  /**
   * E23.5.4: what the farm adds to an area's diversity: each kind of tended thing counts once, each kind of creature
   * living in its homes more. E23.2.4.1 (area diversity, e23-bloombot) adds this to its score; the city-wide
   * biodiversity (Ecosystem) counts it too.
   */
  diversityIn(areaId?: string): number {
    const kinds = new Set<string>();
    const creatures = new Set<string>();
    for (const type of EXTRA_TYPES)
      for (const m of this.sim.machinesOfType(type)) {
        if (areaId !== undefined && this.sim.areas?.areaOf(m) !== areaId) continue;
        if (isHome(type)) {
          if (this.occupied(m)) creatures.add(HOMES[type].creature);
          continue;
        }
        if (type === 'beehive' && !this.hiveSettled(m)) continue;
        kinds.add(type);
      }
    // E23.5.4.6: each Keeper's garden in the area (a planter tended for a woken Keeper) counts too
    const gardens = new Set<string>();
    for (const p of this.sim.machinesOfType('planter')) {
      if (areaId !== undefined && this.sim.areas?.areaOf(p) !== areaId) continue;
      const k = this.gardenOf(p);
      if (k) gardens.add(k);
    }
    return kinds.size * DIVERSITY.perKind + creatures.size * DIVERSITY.perCreature + gardens.size * DIVERSITY.perGarden;
  }

  // ───────────── per step ─────────────

  tick(dt: number) {
    if (!this.on) return;
    const days = dt / DAY_SECONDS;
    for (const m of this.sim.machinesOfType('beehive')) this.tickHive(m, days);
    for (const m of this.sim.machinesOfType('orchard')) this.tickOrchard(m, days);
    for (const m of this.sim.machinesOfType('mushroomLog')) this.tickLog(m, days);
    for (const m of this.sim.machinesOfType('wormBin')) this.tickWorms(m, days);
    for (const kind of Object.keys(HOMES) as HomeKind[]) for (const m of this.sim.machinesOfType(kind)) this.tickHome(m, days);
    this.tickPonds(days);
  }

  /** Honey fills while the bees are settled; a full hive waits. */
  private tickHive(m: MachineData, days: number) {
    if (!this.hiveSettled(m)) return;
    const st = { ...this.st(m) };
    if ((st.ready ?? 0) >= BEEHIVE.honeyCapacity) return;
    st.growing = (st.growing ?? 0) + days * machineStrengthAt('beehive', m.x, m.z); // E23.8.1: fertile soil
    if (st.growing >= BEEHIVE.honeyDays) {
      st.growing -= BEEHIVE.honeyDays;
      st.ready = (st.ready ?? 0) + 1;
      this.write(m, st);
      this.changed(m);
      return;
    }
    this.write(m, st);
  }

  /** Takes the honey into the backpack (a strong snack: its own item, more charge than food). */
  takeHoney(m: MachineData): number {
    const st = this.st(m);
    const n = Math.floor(st.ready ?? 0);
    if (n <= 0) return 0;
    const inv = this.sim.inventory;
    inv.addToStore('honey', inv.add('honey', n));
    this.write(m, { ...st, ready: 0 });
    this.sim.bus.emit('farm.harvested', { machineId: m.id, item: 'honey', n });
    this.changed(m);
    return n;
  }

  /** Ponds drink from the network to stay filled (fractions carried over, not saved). */
  private pondThirst = new Map<string, number>();
  private tickPonds(days: number) {
    for (const m of this.sim.machinesOfType('fishPond')) {
      const t = this.sim.grid.get(m.roofId, m.x, m.z);
      if (!t) continue;
      const want = (this.pondThirst.get(m.id) ?? 0) + FISH_POND.waterPerDay * days;
      const whole = Math.floor(want);
      // from the water nearby, else through the pipe beside it (drawNear falls back to E23.4.2's pipes)
      if (whole > 0) this.sim.water.drawNear(t, whole);
      this.pondThirst.set(m.id, want - whole);
    }
  }

  /** The crop a planter is growing, for panels (its CropDef). */
  cropOf(m: MachineData) {
    const c = this.sim.farm.bed(m).crop as CropId | undefined;
    return c ? CROPS[c] : undefined;
  }
}

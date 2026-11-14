import { PARK } from '../core/Areas';
import { GROUND } from '../core/GameState';
import { distToFootprint } from '../core/Grid';
import type { BuildableType, TileData } from '../core/types';
import { MACHINES } from '../data/machines';
import { formatCost } from '../core/Economy';
import { TUNING } from '../data/tuning';
import { AREA_TYPES } from '../data/city';
import type { Sim } from './Sim';

/** What the suggestion's button does. */
export type SuggestionAction =
  | { kind: 'wake'; machineId: string }
  | { kind: 'district'; districtId: string }
  | { kind: 'focus'; x: number; z: number; /** a raised layer (a city rooftop); the ground when absent */ layer?: string }
  | { kind: 'upgrades' }
  | { kind: 'harvest' }
  | { kind: 'build'; type: BuildableType; x: number; z: number }
  | { kind: 'wait'; seconds: number };

export interface Suggestion {
  /** One line: what to do next and why. */
  text: string;
  /** Button label. */
  label: string;
  action: SuggestionAction;
}

export interface Frontier {
  areaId: string;
  name: string;
  /** blocks (chunks) from the park */
  distance: number;
  share: number;
}

/**
 * The objective panel's advisor for the endless city: the nearest frontier and one achievable next step,
 * in every game state (headless, so tests can check it never comes up empty).
 */
export class Advisor {
  constructor(private sim: Sim) {}

  /** The open (revealed, not cleared) area closest to the park. */
  nearestFrontier(): Frontier | undefined {
    const s = this.sim;
    const open = s.areas.revealed().filter((id) => id !== PARK && s.areas.fog(id) !== 'cleared');
    if (!open.length) return undefined;
    const id = open.sort((a, b) => s.areas.info(a).distance - s.areas.info(b).distance || (a < b ? -1 : 1))[0];
    const a = s.areas.info(id);
    return { areaId: id, name: AREA_TYPES[a.type].name, distance: a.distance, share: s.areas.share(id) };
  }

  /** A tile at the fog edge of the goal area that a pulse can restore right now (affordable), if any. */
  private edgeTile(goal: string | undefined): TileData | undefined {
    const s = this.sim;
    if (!goal) return undefined;
    let best: TileData | undefined;
    for (const t of s.areas.entryTiles(goal)) {
      if (!s.restoration.checkPulse(t).ok) continue;
      best = t;
      break;
    }
    return best;
  }

  suggest(): Suggestion {
    const s = this.sim;
    const city = s.grid.isPlayable(GROUND);
    // 1. A landmark that can be woken.
    if (city) {
      if (!s.state.progression.coreActivated && s.progression.coreReady() && !s.econ.shortfall(TUNING.core.cost)) {
        const lm = s.areas.landmark(PARK);
        if (lm) return { text: 'The fountain is ready. Wake it to roll back the fog.', label: '✨ Wake the fountain', action: { kind: 'wake', machineId: lm.id } };
      }
      // Phase 4 E01: ready but short (drones keep spending): say what it's waiting for instead of something else.
      if (!s.state.progression.coreActivated && s.progression.coreReady() && s.econ.shortfall(TUNING.core.cost)) {
        return { text: `The fountain is ready. It needs ${formatCost(TUNING.core.cost)} to wake: let your stores fill up.`, label: '⛲ Filling up…', action: { kind: 'wait', seconds: 5 } };
      }
      for (const id of s.areas.revealed()) {
        if (id === PARK || s.areas.fog(id) === 'cleared' || !s.areas.ready(id)) continue;
        const lm = s.areas.landmark(id);
        const a = s.areas.info(id);
        if (lm) return { text: `The ${a.landmarkName} is ready to wake.`, label: `✨ Wake the ${a.landmarkName}`, action: { kind: 'wake', machineId: lm.id } };
      }
      // 1b. A district bloom waiting to be set off (free: a reward and lusher ground).
      const d = s.districts.ready()[0];
      if (d) return { text: `${s.districts.title(d)} has ${s.districts.awakeGroup(d)} neighbouring landmarks awake: its district bloom is ready.`, label: '🌸 Set off the district bloom', action: { kind: 'district', districtId: d } };
    }
    // 2. An upgrade you can buy now.
    const up = s.upgrades.all().find((d) => s.upgrades.status(d).ok);
    if (up) return { text: `${up.icon} ${up.name} is affordable: ${up.describe(s.upgrades.level(up.id) + 1)}.`, label: '⬆️ Upgrades', action: { kind: 'upgrades' } };
    // 3. Before the fountain: a machine it still needs, if one can be built now.
    const build = city && !s.state.progression.coreActivated ? this.neededBuild() : undefined;
    if (build) return build;
    // 3b. The goal's landmark wants its specialty action (City 09.1): the next step towards it, if one is possible now.
    const specGoal = city && s.state.progression.coreActivated ? s.areas.nextGoal() : undefined;
    const spec = specGoal ? this.specialtyStep(specGoal) : undefined;
    // Saving up only once the restore share is met (until then, restoring is progress too).
    if (spec && (spec.action.kind !== 'wait' || s.areas.counts(specGoal!).restored >= s.areas.need(specGoal!))) return spec;
    // 3c. Before the fountain, once enough tiles are restored: grow green tiles to full bloom (Phase 4 E05).
    if (city && !s.state.progression.coreActivated) {
      const g = TUNING.park;
      const restored = s.progression.restoredCount('home');
      if (restored >= g.restoredTiles && s.progression.fullBloomCount('home') < g.fullBloomTiles) {
        const t = s.areas
          .tiles(PARK)
          .filter((x) => x.ground === 'restored' && !x.occupantId && x.bloom < TUNING.restore.fullBloom && s.restoration.checkPulse(x).ok)
          .sort((a, b) => b.bloom - a.bloom || a.z - b.z || a.x - b.x)[0];
        if (t) return { text: 'The fountain wants full-bloom gardens: tap green tiles to grow them.', label: '🌸 Show me where', action: { kind: 'focus', x: t.x, z: t.z } };
      }
    }
    // 4. Push the fog back: an affordable tile at the edge of the current goal (or anywhere in the park).
    const goal = city && s.state.progression.coreActivated ? s.areas.nextGoal() : undefined;
    const edge = this.edgeTile(goal) ?? (city ? this.parkTile() : undefined);
    if (edge) {
      const where = goal && s.areas.areaOf(edge) === goal ? `the ${AREA_TYPES[s.areas.info(goal).type].name.toLowerCase()}'s fog edge` : 'the park';
      return { text: `Restore tiles at ${where}: each one pushes the fog back.`, label: '🌱 Show me where', action: { kind: 'focus', x: edge.x, z: edge.z } };
    }
    // 5. Short of energy: Harvest Sunlight is always there (on a cooldown).
    const cd = Math.max(0, s.state.harvestReadyAt - s.time);
    if (cd <= 0) return { text: 'Low on energy? Harvest a burst of sunlight.', label: '🌞 Harvest sunlight', action: { kind: 'harvest' } };
    // 6. Nothing to do this instant: solar and the rain barrel always refill, and so does the harvest.
    const secs = Math.ceil(cd);
    return { text: `Solar panels are recharging. Sunlight can be harvested again in ${secs} s.`, label: `🌞 Harvest in ${secs} s`, action: { kind: 'wait', seconds: secs } };
  }

  /**
   * City 09.1: one achievable step towards an area's specialty action (a build or a pulse), or undefined when
   * nothing can be done towards it right now (waiting for a basin or a meter, short of resources, still in fog).
   */
  specialtyStep(id: string): Suggestion | undefined {
    const s = this.sim;
    if (id === PARK || s.areas.fog(id) === 'cleared' || s.milestones.met(id)) return undefined;
    const sp = s.milestones.specialty(id);
    const a = s.areas.info(id);
    const tiles = s.areas.tiles(id);
    const max = TUNING.restore.maxBloom;
    const why = `The ${a.landmarkName} also wants: ${sp.label.replace(/ \(.*\)$/, '')}.`;
    const ok = (t: TileData) => s.restoration.checkPulse(t).ok;
    const growable = (t: TileData) => t.ground === 'restored' && !t.occupantId && t.bloom < max;
    const focus = (t: TileData | undefined, what: string): Suggestion | undefined =>
      t ? { text: `${why} ${what}`, label: '🌱 Show me where', action: t.roofId === GROUND ? { kind: 'focus', x: t.x, z: t.z } : { kind: 'focus', x: t.x, z: t.z, layer: t.roofId } } : undefined;
    const build = (type: BuildableType, cands: TileData[], what: string): Suggestion | undefined => {
      const def = MACHINES[type];
      const cost = s.build.cost(type);
      const spot = cands.find((c) => s.build.check(type, GROUND, c.x, c.z).spotOk);
      if (!spot) return undefined;
      // A spot is ready but the purchase isn't: save up (resources always refill), unless storage can't hold it.
      if (s.econ.shortfall(cost)) {
        // Phase 4 E01: more than storage can hold → say so and point at the Seed Vault, if it can still grow.
        if ((['energy', 'water', 'biomass'] as const).some((k) => (cost[k] ?? 0) > s.state.caps[k])) return this.storageStep(def.name);
        return { text: `${why} Save up for a ${def.name} (${formatCost(cost)}).`, label: `${def.icon} Saving up…`, action: { kind: 'wait', seconds: 5 } };
      }
      return { text: `${why} ${what}`, label: `${def.icon} Build a ${def.name}`, action: { kind: 'build', type, x: spot.x, z: spot.z } };
    };
    // Room to bloom beside a spot: tiles next to it that can still be restored or grown (machines need it to fire).
    const room = (t: { x: number; z: number }) => s.grid.tilesNear({ roofId: GROUND, x: t.x, z: t.z, size: 1 }, 1).filter((n) => s.restoration.isEligible(n) || growable(n)).length;
    const roomy = (cands: TileData[]) => cands.filter((t) => room(t) >= 2).sort((x, y) => room(y) - room(x) || x.z - y.z || x.x - y.x);
    const mine = (type: BuildableType) => s.state.machines.filter((m) => m.type === type && s.areas.areaOf(m) === id);
    const beside = (m: { x: number; z: number; size: number }, r = 1) => s.grid.tilesNear({ roofId: GROUND, x: m.x, z: m.z, size: m.size }, r);
    switch (sp.kind) {
      case 'fullBloom':
        return focus(tiles.filter((t) => growable(t) && t.bloom < TUNING.restore.fullBloom && ok(t)).sort((x, y) => y.bloom - x.bloom)[0], 'Pulse a green tile to grow it.');
      case 'roofBloom': {
        const roof = s.clusters.roof(id);
        if (!roof) return undefined;
        if (!s.grid.isPlayable(roof.id)) {
          // Reach it with a Bloom Relay on the street (within range of the roof).
          if (!s.build.isUnlocked('relay')) return build('droneHub', tiles, 'Relays need a Drone Hub first.');
          const spots = s.clusters.relaySpots(id);
          const b = build('relay', spots, 'A Bloom Relay here reaches the rooftop.');
          if (b) return b;
          // No ground in reach is ready to build on yet: restore a spot first.
          return focus(spots.find((t) => t.ground !== 'restored' && !t.occupantId && ok(t)), 'Restore a spot within reach of the rooftop for a Bloom Relay.');
        }
        const roofTiles = s.grid.tilesOf(roof.id);
        return focus(roofTiles.find((t) => t.ground !== 'restored' && ok(t)), 'Restore the rooftop.');
      }
      case 'canopy': {
        const lm = s.areas.landmark(id);
        if (!lm) return undefined;
        const near = beside(lm, TUNING.neighbourhood.canopy.chargeRadius);
        return focus(near.find((t) => t.ground !== 'restored' && ok(t)) ?? near.find((t) => growable(t) && ok(t)), 'Bloom tiles around the Elder Tree to charge it.');
      }
      case 'solarBoost': {
        const panel = mine('solar')[0];
        if (!panel || room(panel) === 0) return build('solar', roomy(tiles), 'Build a Solar Panel beside ground that can still bloom.');
        return focus(beside(panel).find((t) => (s.restoration.isEligible(t) || growable(t)) && ok(t)), 'Bloom a tile right next to the Solar Panel.');
      }
      case 'chain': {
        const gardens = mine('pollinator');
        if (gardens.filter((g) => room(g) > 0).length < 2) return build('pollinator', roomy(tiles), 'Pollinator Gardens with room around them set each other off.');
        for (const g of gardens) {
          const t = beside(g).find((n) => (s.restoration.isEligible(n) || growable(n)) && ok(n));
          if (t) return focus(t, 'Pulse beside a Pollinator Garden to start a big chain.');
        }
        return undefined;
      }
      case 'corridor': {
        // Two street gardens within corridor range of each other.
        const paved = (t: TileData) => t.feature === 'road' || t.feature === 'paving';
        const gardens = mine('pollinator').filter((m) => s.chains.isCorridor(m));
        const R = s.upgrades.corridorRange;
        const gap = 1;
        const md = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.abs(p.x - q.x) + Math.abs(p.z - q.z);
        const pairs = gardens.filter((g) => gardens.some((o) => o !== g && md(g, o) >= gap && md(g, o) <= R));
        if (!pairs.some((g) => room(g) > 0)) {
          // A (new) garden with room around it, within range of another street garden if there is one.
          const g0 = gardens[0];
          return build('pollinator', roomy(tiles.filter((t) => paved(t) && (!g0 || (md(t, g0) >= 2 && md(t, g0) <= R)))), 'Two gardens on the paving form a green corridor: put this one where the ground can still bloom.');
        }
        for (const g of pairs) {
          const t = beside(g).find((n) => (s.restoration.isEligible(n) || growable(n)) && ok(n));
          if (t) return focus(t, 'Pulse beside a street garden: the chain runs along the corridor.');
        }
        return undefined;
      }
      case 'overflow': {
        const R = TUNING.neighbourhood.reservoir.condenserRange;
        const garden = mine('reservoirGarden')[0];
        if (!garden) return build('reservoirGarden', tiles.filter((t) => beside({ ...t, size: 1 }, R).some((c) => !c.blocked && !c.occupantId && s.areas.areaOf(c) === id)), 'A Reservoir Garden overflows when its basin fills.');
        const conds = s.state.machines.filter((m) => m.type === 'condenser' && distToFootprint(m.x, m.z, garden.x, garden.z, garden.size) <= R);
        if (!conds.length) return build('condenser', beside(garden, R), 'A Water Condenser within 2 tiles fills its basin.');
        return undefined;
      }
      case 'canalFlow': {
        const plan = s.milestones.canalPlan(id);
        if (!plan) return undefined;
        const path = plan.path.map(([x, z]) => s.grid.get(GROUND, x, z)!);
        const dirty = path.find((t) => t.ground !== 'restored' && t.ground !== 'growing');
        if (dirty) return focus(path.find((t) => t.ground !== 'restored' && ok(t)), 'Restore the canal water so it can flow.');
        for (const [type, [x, z]] of [['reservoirGarden', plan.garden], ['condenser', plan.condenser]] as [BuildableType, [number, number]][]) {
          const t = s.grid.get(GROUND, x, z)!;
          if (s.occupant(t)?.type === type) continue;
          if (t.occupantId) return undefined; // something else stands there: the player can still do it by hand
          if (t.ground === 'polluted') return focus(ok(t) ? t : undefined, `Clear the bank for a ${MACHINES[type].name}.`);
          return build(type, [t], type === 'reservoirGarden' ? 'A garden on one bank…' : '…and a condenser further along sends it water down the canal.');
        }
        return undefined;
      }
    }
  }

  /** A purchase is bigger than storage: the Seed Vault's next tier, if there is one (Phase 4 E01). */
  storageStep(what: string): Suggestion | undefined {
    const vault = this.sim.upgrades.all().find((u) => u.id === 'seedVault');
    if (!vault || this.sim.upgrades.level(vault.id) >= vault.maxLevel) return undefined;
    return { text: `A ${what} needs more storage than you have. Upgrade the Seed Vault to hold more.`, label: '🏺 Upgrades', action: { kind: 'upgrades' } };
  }

  /** The first machine the fountain still needs that is affordable, at a valid spot nearest the fountain. */
  private neededBuild(): Suggestion | undefined {
    const s = this.sim;
    const order: BuildableType[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'motherTree'];
    const [fx, fz] = s.areas.info(PARK).landmark;
    const tiles = s.areas.tiles(PARK).sort((a, b) => Math.abs(a.x - fx) + Math.abs(a.z - fz) - (Math.abs(b.x - fx) + Math.abs(b.z - fz)) || a.z - b.z || a.x - b.x);
    const rates = s.production.rates();
    for (const type of order) {
      if (s.state.machines.some((m) => m.type === type && !m.starter)) continue;
      const cost = s.build.cost(type);
      if (s.econ.shortfall(cost)) {
        // Phase 4: short only of things that refill on their own (and fit in storage): save up instead of
        // tapping it all away. Otherwise keep restoring (biomass only comes from restored tiles).
        const short = (['energy', 'water', 'biomass'] as const).filter((k) => (cost[k] ?? 0) > s.econ.get(k));
        if (s.build.isUnlocked(type) && short.every((k) => rates[k] > 0 && (cost[k] ?? 0) <= s.econ.cap(k))) {
          const def = MACHINES[type];
          return { text: `The fountain needs a ${def.name}: let your stores fill up (${formatCost(cost)}).`, label: `${def.icon} Saving up…`, action: { kind: 'wait', seconds: 5 } };
        }
        continue;
      }
      for (const t of tiles) {
        if (!s.build.check(type, GROUND, t.x, t.z).ok) continue;
        const def = MACHINES[type];
        return { text: `The fountain needs a ${def.name}, and you can afford one.`, label: `${def.icon} Build a ${def.name}`, action: { kind: 'build', type, x: t.x, z: t.z } };
      }
    }
    return undefined;
  }

  /** Before the fountain: an affordable dead tile in the park, nearest the fountain. */
  private parkTile(): TileData | undefined {
    const s = this.sim;
    if (s.state.progression.coreActivated) return undefined;
    const [fx, fz] = s.areas.info(PARK).landmark;
    let best: TileData | undefined;
    let bd = Infinity;
    for (const t of s.areas.tiles(PARK)) {
      const d = Math.abs(t.x - fx) + Math.abs(t.z - fz);
      if (d >= bd || !s.restoration.checkPulse(t).ok) continue;
      best = t;
      bd = d;
    }
    return best;
  }
}

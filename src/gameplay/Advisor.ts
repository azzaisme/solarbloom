import { PARK } from '../core/Areas';
import type { MachineData, MaterialId, TileData } from '../core/types';
import { PARK_SET, REGIONS, gateText, type PileDef } from '../data/oldcity';
import { allPiles } from '../core/OldCityLayout';
import { MATERIALS } from '../data/salvage';
import { AREA_TYPES } from '../data/city';
import { machineName } from '../data/machines';
import { GROUND } from '../core/GameState';
import type { Sim } from './Sim';
import { Walker } from './Walker';

/** "Scrap", "Scrap and Seeds", "Scrap, Copper and Seeds" */
const listNames = (ms: MaterialId[]) => {
  const n = ms.map((m) => MATERIALS[m].name);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : (n[0] ?? '');
};

/** What the suggestion's button does. */
export type SuggestionAction =
  | { kind: 'wake'; machineId: string }
  | { kind: 'focus'; x: number; z: number; /** a raised layer (a city rooftop); the ground when absent */ layer?: string }
  | { kind: 'wait'; seconds: number };

/**
 * #605 / #609 (E24): what a suggestion points at, so the card, the gold arrow, the beam and the minimap can all name
 * it ("the fountain", "Tally", "the way into Mast Row"). See ui/GoalSpot.ts.
 */
export type GoalKind = 'rest' | 'pile' | 'park' | 'fountain' | 'gate' | 'keeper' | 'landmark' | 'machine' | 'spot';
export interface Place {
  kind: GoalKind;
  /** short, for a label or a screen reader: "the fountain", "a Scrap pile", "Tally" */
  name: string;
}

/** Which part of the loop a hint is about (E23.1.5: every hint belongs to one). */
export type HintTopic = 'charge' | 'grid' | 'water' | 'farm' | 'keeper' | 'restore';

export interface Suggestion {
  /** One line: what to do next and why. */
  text: string;
  /** Button label. */
  label: string;
  action: SuggestionAction;
  topic: HintTopic;
  /** what the action points at (a focus or a wake) */
  place?: Place;
}

export interface Frontier {
  areaId: string;
  name: string;
  /** blocks (chunks) from the park */
  distance: number;
  share: number;
}

/**
 * The handles other E23 sub-epics add to Sim (E23.2 charge, E23.3 power, E23.4 water). Read structurally and
 * optionally, so the advisor runs before they land and picks each one up once it does.
 */
interface LoopHandles {
  /** E23.2.1 (ChargeSystem): `low` is true below CHARGE.lowShare; `share` is 0 (empty) … 1 (full). */
  charge?: { readonly low: boolean; readonly share?: number };
  /** E23.3.1: is this machine getting power right now? */
  power?: { isPowered(m: MachineData): boolean };
  /** E23.4.1: is this area short of water (its land fading)? */
  water?: { isLow(areaId: string): boolean };
}

/** Machines that rest bloombot (E23.2.3 / E23.3.3): the charge hint points at the nearest. */
const RESTING = new Set<string>(['charger', 'bench']);
/** Farm machines (E23.5) whose neighbours the farm hint looks at. */
const FARM = new Set<string>(['planter', 'compostBin', 'bioDigester']);

/**
 * E23.1.5: the advisor. One achievable next step, always about the new loop: bloombot's charge, the grid, water,
 * the farm, and the next Keeper (or restoring towards it). Nothing is ever bought or saved up for. Headless, so
 * tests can check it never comes up empty and every hint names its part of the loop.
 */
export class Advisor {
  constructor(private sim: Sim) {}

  private get loop(): LoopHandles {
    return this.sim as unknown as LoopHandles;
  }

  /** The open (revealed, not cleared) area closest to the park. */
  nearestFrontier(): Frontier | undefined {
    const s = this.sim;
    const open = s.areas.revealed().filter((id) => id !== PARK && s.areas.fog(id) !== 'cleared');
    if (!open.length) return undefined;
    const id = open.sort((a, b) => s.areas.info(a).distance - s.areas.info(b).distance || (a < b ? -1 : 1))[0];
    const a = s.areas.info(id);
    return { areaId: id, name: AREA_TYPES[a.type].name, distance: a.distance, share: s.areas.share(id) };
  }

  suggest(): Suggestion {
    return this.chargeStep() ?? this.wakeStep() ?? this.gridStep() ?? this.waterStep() ?? this.farmStep() ?? this.keeperStep() ?? this.restoreStep() ?? this.explore();
  }

  /**
   * E23.2: low on charge → the nearest place to rest: a powered charger or bench, or home (standing still by the
   * fountain or the house always charges). #613: the line names the place, and Show me where leads there.
   */
  chargeStep(): Suggestion | undefined {
    if (!this.loop.charge?.low) return undefined;
    const rest = this.restSpot();
    const text = rest.machine ? `Bloombot is running low. Rest at ${rest.name} to charge up.` : `Bloombot is running low. Stand still by ${rest.name} for a while to charge up.`;
    return { topic: 'charge', text, label: '⚡ Show me where', action: { kind: 'focus', x: rest.x, z: rest.z }, place: { kind: 'rest', name: rest.name } };
  }

  /**
   * #613: the resting place nearest bloombot: a powered charger or bench, else home. Home is the fountain or the
   * house (Charge.atHome): the spot named is a cell just in front of it, inside its resting reach.
   */
  restSpot(): { x: number; z: number; name: string; machine: boolean } {
    const s = this.sim;
    const [fx, fz] = s.areas.info(PARK).landmark;
    const bx = s.bot?.x ?? s.state.bot?.x ?? fx;
    const bz = s.bot?.z ?? s.state.bot?.z ?? fz;
    const dist = (x: number, z: number) => Math.hypot(x + 0.5 - bx, z + 0.5 - bz);
    const f = s.state.machines.find((m) => m.type === 'core' && s.areas.areaOf(m) === PARK);
    const shed = PARK_SET.shed;
    // a cell bloombot can stand on beside it (benches and props crowd the fountain), nearest bloombot
    const walker = new Walker(s);
    const beside = (x0: number, z0: number, size: number) => {
      let best: { x: number; z: number } | undefined;
      for (let r = 1; r <= 2 && !best; r++)
        for (let z = z0 - r; z < z0 + size + r; z++)
          for (let x = x0 - r; x < x0 + size + r; x++) {
            if (x >= x0 && x < x0 + size && z >= z0 && z < z0 + size) continue;
            if (!walker.walkable(GROUND, x, z)) continue;
            if (!best || dist(x, z) < dist(best.x, best.z)) best = { x, z };
          }
      return best ?? { x: x0, z: z0 + size };
    };
    const homes = [
      { ...beside(f?.x ?? fx, f?.z ?? fz, f?.size ?? 2), name: 'the fountain', machine: false },
      { ...beside(shed.x, shed.z, shed.size), name: 'the house', machine: false },
    ];
    const pads = s.state.machines
      .filter((m) => RESTING.has(m.type) && this.powered(m) && m.roofId === GROUND)
      .map((m) => ({ x: m.x, z: m.z, name: `the ${machineName(m).toLowerCase()}`, machine: true }));
    return [...pads, ...homes].reduce((a, b) => (dist(b.x, b.z) < dist(a.x, a.z) ? b : a));
  }

  /** A region's landmark ready to wake. */
  wakeStep(): Suggestion | undefined {
    const s = this.sim;
    for (const id of s.areas.revealed()) {
      if (id === PARK || s.areas.fog(id) === 'cleared' || !s.areas.ready(id)) continue;
      const lm = s.areas.landmark(id);
      const name = s.areas.info(id).landmarkName;
      if (lm) return { topic: 'keeper', text: `The ${name} is ready to wake.`, label: `✨ Wake the ${name}`, action: { kind: 'wake', machineId: lm.id }, place: { kind: 'landmark', name: `the ${name}` } };
    }
    return undefined;
  }

  /** E23.3: a machine that has gone dark (off the grid, or the grid is short). */
  gridStep(): Suggestion | undefined {
    const p = this.loop.power;
    if (!p) return undefined;
    const dark = this.nearest(this.sim.state.machines.filter((m) => !m.starter && m.type !== 'core' && !p.isPowered(m)));
    if (!dark) return undefined;
    return { topic: 'grid', text: 'A machine has gone dark. Run a power pole to it, or add a panel or a turbine.', label: '⚡ Show me where', action: { kind: 'focus', x: dark.x, z: dark.z }, place: { kind: 'machine', name: `the ${machineName(dark).toLowerCase()}` } };
  }

  /** E23.4: an open area whose water is low (its land fading). */
  waterStep(): Suggestion | undefined {
    const w = this.loop.water;
    if (!w) return undefined;
    const s = this.sim;
    const id = s.areas.revealed().find((a) => !s.areas.sealed(a) && w.isLow(a));
    if (!id) return undefined;
    const [x, z] = s.areas.info(id).landmark;
    return { topic: 'water', text: 'The land is fading here. Bring water: a pump, a pipe or a reservoir.', label: '💧 Show me where', action: { kind: 'focus', x, z }, place: { kind: 'spot', name: `the ${AREA_TYPES[s.areas.info(id).type].name.toLowerCase()}` } };
  }

  /** E23.5: a farm machine with dead ground beside it. */
  farmStep(): Suggestion | undefined {
    const s = this.sim;
    for (const m of s.state.machines) {
      if (!FARM.has(m.type)) continue;
      const t = s.grid.tilesNear(m, 1).find((n) => n.ground !== 'restored' && s.restoration.checkPulse(n).ok);
      if (t) return { topic: 'farm', text: 'Your farm wants living ground around it. Pulse the soil beside it.', label: '🌱 Show me where', action: { kind: 'focus', x: t.x, z: t.z }, place: { kind: 'spot', name: 'the ground by your farm' } };
    }
    return undefined;
  }

  /**
   * The next Keeper: the pinned request; else a shut region bloombot can open now; else the fountain's next tier
   * (which gives the abilities gates need); else the nearest shut region and what it still waits for.
   */
  keeperStep(): Suggestion | undefined {
    const s = this.sim;
    const pinned = s.keepers.pinned();
    if (pinned) {
      const k = s.keepers.def(pinned.id);
      return { topic: 'keeper', text: pinned.text, label: `🤖 Find ${k.name}`, action: { kind: 'focus', x: k.x, z: k.z }, place: { kind: 'keeper', name: k.name } };
    }
    const shut = REGIONS.filter((q) => q.gate.opensRegion !== false && !s.gates.isOpen(q.gate.id));
    const gate = (r: (typeof REGIONS)[number], text: string): Suggestion => {
      const [x, z] = r.gate.cells[0];
      return { topic: 'keeper', text, label: '🤖 Show me the way', action: { kind: 'focus', x, z }, place: { kind: 'gate', name: `the way into ${r.name}` } };
    };
    const open = shut.find((q) => !s.gates.problem(q.gate));
    if (open) return gate(open, `A Keeper sleeps in ${open.name}. The way in is clear: open it.`);
    const f = this.fountainStep();
    if (f) return f;
    if (shut[0]) return gate(shut[0], `A Keeper sleeps in ${shut[0].name}. ${gateText(shut[0].gate)}`);
    return undefined;
  }

  /**
   * The fountain's next tier, one step at a time: bring what bloombot carries for it; else salvage the nearest pile
   * of what it still wants; else what its own condition asks (park ground to restore; landmarks wake through the
   * Keepers above). Its tiers give the abilities the gates need.
   */
  fountainStep(): Suggestion | undefined {
    const s = this.sim;
    const t = s.fountain.next();
    if (!t) return undefined;
    const [fx, fz] = s.areas.info(PARK).landmark;
    const wanted = (Object.keys(t.delivery) as string[]).filter((k) => k !== 'biomass' && s.fountain.remaining(k as MaterialId) > 0) as MaterialId[];
    const carried = wanted.filter((m) => s.inventory.available(m) > 0);
    // carrying enough of something (or as much as the piles in reach give): take it to the fountain
    const missing = wanted.filter((m) => s.inventory.available(m) < s.fountain.remaining(m));
    const enough = wanted.some((m) => s.inventory.available(m) >= s.fountain.remaining(m));
    const pile = this.nearestPile(missing);
    const take = (): Suggestion => ({ topic: 'keeper', text: `Take the ${listNames(carried)} to the fountain.`, label: '⛲ Show me', action: { kind: 'focus', x: fx, z: fz }, place: { kind: 'fountain', name: 'the fountain' } });
    if (carried.length && (enough || !pile)) return take();
    if (pile) return { topic: 'keeper', text: `Salvage piles to find ${MATERIALS[pile.material].name}. Show me where leads to one.`, label: `${MATERIALS[pile.material].icon} Show me where`, action: { kind: 'focus', x: pile.x, z: pile.z }, place: { kind: 'pile', name: `a ${MATERIALS[pile.material].name} pile` } };
    // #609: what it still wants lies only past a way bloombot can open now: open it
    if (missing.length && !pile) {
      const r = REGIONS.find((q) => {
        if (s.gates.isOpen(q.gate.id) || s.gates.problem(q.gate)) return false;
        const area = s.areas.areaOf({ roofId: GROUND, x: q.patch.x, z: q.patch.z });
        return allPiles().some((p) => missing.includes(p.material) && s.salvage.left(p.id) > 0 && s.areas.areaOf({ roofId: GROUND, x: p.x, z: p.z }) === area);
      });
      if (r) {
        const [x, z] = r.gate.cells[0];
        const what = missing.map((m) => MATERIALS[m].name).join(' and ');
        return { topic: 'keeper', text: `The way into ${r.name} is clear. Open it to find more ${what}.`, label: '🤖 Show me the way', action: { kind: 'focus', x, z }, place: { kind: 'gate', name: `the way into ${r.name}` } };
      }
    }
    if (carried.length) return take();
    const c = s.fountain.condition(t);
    if (!c.done && t.needs.parkTiles !== undefined) {
      const tile = this.parkTile();
      if (tile) return { topic: 'restore', text: `The fountain wants the park alive around it: restore it (${Math.min(c.have, c.need)} of ${c.need}).`, label: '🌱 Show me where', action: { kind: 'focus', x: tile.x, z: tile.z }, place: { kind: 'park', name: 'the park' } };
    }
    return undefined;
  }

  /** The nearest pile with something left of one of these materials that bloombot can salvage now. */
  nearestPile(materials: MaterialId[]): PileDef | undefined {
    if (!materials.length) return undefined;
    const s = this.sim;
    const [fx, fz] = s.areas.info(PARK).landmark;
    const bx = s.bot?.x ?? s.state.bot?.x ?? fx;
    const bz = s.bot?.z ?? s.state.bot?.z ?? fz;
    let best: PileDef | undefined;
    let bd = Infinity;
    for (const p of allPiles()) {
      if (!materials.includes(p.material) || s.salvage.left(p.id) <= 0 || s.salvage.problem(p.id)) continue;
      const d = Math.abs(p.x - bx) + Math.abs(p.z - bz);
      if (d < bd) [best, bd] = [p, d];
    }
    return best;
  }

  /** Restoring towards the current goal: a tile at its edge, or in the park. */
  restoreStep(): Suggestion | undefined {
    const s = this.sim;
    const goal = s.state.progression.coreActivated ? s.areas.nextGoal() : undefined;
    const edge = (goal ? s.areas.entryTiles(goal).find((t) => s.restoration.checkPulse(t).ok) : undefined) ?? this.parkTile();
    if (!edge) return undefined;
    const where = goal && s.areas.areaOf(edge) === goal ? `the ${AREA_TYPES[s.areas.info(goal).type].name.toLowerCase()}` : 'the park';
    return { topic: 'restore', text: `Restore ${where}: each tile pushes the fog back.`, label: '🌱 Show me where', action: { kind: 'focus', x: edge.x, z: edge.z }, place: { kind: where === 'the park' ? 'park' : 'spot', name: where } };
  }

  private explore(): Suggestion {
    return { topic: 'restore', text: 'Explore, salvage and restore: the island is yours to bring back.', label: '🌿 Explore', action: { kind: 'wait', seconds: 5 } };
  }

  private powered(m: MachineData): boolean {
    return this.loop.power?.isPowered(m) ?? true;
  }

  /** The machine nearest bloombot (or the park's fountain, with no bot). */
  private nearest(list: MachineData[]): MachineData | undefined {
    const s = this.sim;
    const [fx, fz] = s.areas.info(PARK).landmark;
    const bx = s.state.bot?.x ?? fx;
    const bz = s.state.bot?.z ?? fz;
    let best: MachineData | undefined;
    let bd = Infinity;
    for (const m of list) {
      const d = Math.abs(m.x - bx) + Math.abs(m.z - bz);
      if (d < bd) [best, bd] = [m, d];
    }
    return best;
  }

  /** Before the fountain: a dead tile in the park that a pulse can restore, nearest the fountain. */
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

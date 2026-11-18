import { PARK } from '../core/Areas';
import type { MachineData, TileData } from '../core/types';
import { REGIONS } from '../data/oldcity';
import { TUNING } from '../data/tuning';
import { AREA_TYPES } from '../data/city';
import type { Sim } from './Sim';

/** What the suggestion's button does. */
export type SuggestionAction =
  | { kind: 'wake'; machineId: string }
  | { kind: 'focus'; x: number; z: number; /** a raised layer (a city rooftop); the ground when absent */ layer?: string }
  | { kind: 'wait'; seconds: number };

/** Which part of the loop a hint is about (E23.1.5: every hint belongs to one). */
export type HintTopic = 'charge' | 'grid' | 'water' | 'farm' | 'keeper' | 'restore';

export interface Suggestion {
  /** One line: what to do next and why. */
  text: string;
  /** Button label. */
  label: string;
  action: SuggestionAction;
  topic: HintTopic;
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
  /** E23.2.1: bloombot's charge, 0 (empty) … 1 (full). */
  charge?: { fraction(): number };
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

  /** E23.2: low on charge → the nearest powered place to rest, else eat something from the backpack. */
  chargeStep(): Suggestion | undefined {
    const c = this.loop.charge?.fraction();
    if (c === undefined || c > TUNING.advisor.lowCharge) return undefined;
    const rest = this.nearest(this.sim.state.machines.filter((m) => RESTING.has(m.type) && this.powered(m)));
    if (rest) return { topic: 'charge', text: 'Bloombot is running low. Rest a while to charge up.', label: '⚡ Show me where', action: { kind: 'focus', x: rest.x, z: rest.z } };
    return { topic: 'charge', text: 'Bloombot is running low. Eat something from the backpack, or walk home to rest.', label: '⚡ Charge up', action: { kind: 'wait', seconds: 5 } };
  }

  /** A region's landmark ready to wake. */
  wakeStep(): Suggestion | undefined {
    const s = this.sim;
    for (const id of s.areas.revealed()) {
      if (id === PARK || s.areas.fog(id) === 'cleared' || !s.areas.ready(id)) continue;
      const lm = s.areas.landmark(id);
      const name = s.areas.info(id).landmarkName;
      if (lm) return { topic: 'keeper', text: `The ${name} is ready to wake.`, label: `✨ Wake the ${name}`, action: { kind: 'wake', machineId: lm.id } };
    }
    return undefined;
  }

  /** E23.3: a machine that has gone dark (off the grid, or the grid is short). */
  gridStep(): Suggestion | undefined {
    const p = this.loop.power;
    if (!p) return undefined;
    const dark = this.nearest(this.sim.state.machines.filter((m) => !m.starter && m.type !== 'core' && !p.isPowered(m)));
    if (!dark) return undefined;
    return { topic: 'grid', text: 'A machine has gone dark. Run a power pole to it, or add a panel or a turbine.', label: '⚡ Show me where', action: { kind: 'focus', x: dark.x, z: dark.z } };
  }

  /** E23.4: an open area whose water is low (its land fading). */
  waterStep(): Suggestion | undefined {
    const w = this.loop.water;
    if (!w) return undefined;
    const s = this.sim;
    const id = s.areas.revealed().find((a) => !s.areas.sealed(a) && w.isLow(a));
    if (!id) return undefined;
    const [x, z] = s.areas.info(id).landmark;
    return { topic: 'water', text: 'The land is fading here. Bring water: a pump, a pipe or a reservoir.', label: '💧 Show me where', action: { kind: 'focus', x, z } };
  }

  /** E23.5: a farm machine with dead ground beside it. */
  farmStep(): Suggestion | undefined {
    const s = this.sim;
    for (const m of s.state.machines) {
      if (!FARM.has(m.type)) continue;
      const t = s.grid.tilesNear(m, 1).find((n) => n.ground !== 'restored' && s.restoration.checkPulse(n).ok);
      if (t) return { topic: 'farm', text: 'Your farm wants living ground around it. Pulse the soil beside it.', label: '🌱 Show me where', action: { kind: 'focus', x: t.x, z: t.z } };
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
      return { topic: 'keeper', text: pinned.text, label: `🤖 Find ${k.name}`, action: { kind: 'focus', x: k.x, z: k.z } };
    }
    const shut = REGIONS.filter((q) => q.gate.opensRegion !== false && !s.gates.isOpen(q.gate.id));
    const gate = (r: (typeof REGIONS)[number], text: string): Suggestion => {
      const [x, z] = r.gate.cells[0];
      return { topic: 'keeper', text, label: '🤖 Show me the way', action: { kind: 'focus', x, z } };
    };
    const open = shut.find((q) => !s.gates.problem(q.gate));
    if (open) return gate(open, `A Keeper sleeps in ${open.name}. The way in is clear: open it.`);
    const t = s.fountain.next();
    if (t) {
      const [x, z] = s.areas.info(PARK).landmark;
      return { topic: 'keeper', text: `The fountain is waiting for ${t.name}. It helps bloombot reach the Keepers.`, label: '⛲ Show me', action: { kind: 'focus', x, z } };
    }
    if (shut[0]) return gate(shut[0], `A Keeper sleeps in ${shut[0].name}. ${shut[0].gate.blocked}`);
    return undefined;
  }

  /** Restoring towards the current goal: a tile at its edge, or in the park. */
  restoreStep(): Suggestion | undefined {
    const s = this.sim;
    const goal = s.state.progression.coreActivated ? s.areas.nextGoal() : undefined;
    const edge = (goal ? s.areas.entryTiles(goal).find((t) => s.restoration.checkPulse(t).ok) : undefined) ?? this.parkTile();
    if (!edge) return undefined;
    const where = goal && s.areas.areaOf(edge) === goal ? `the ${AREA_TYPES[s.areas.info(goal).type].name.toLowerCase()}` : 'the park';
    return { topic: 'restore', text: `Restore ${where}: each tile pushes the fog back.`, label: '🌱 Show me where', action: { kind: 'focus', x: edge.x, z: edge.z } };
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

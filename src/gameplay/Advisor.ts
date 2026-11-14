import { PARK } from '../core/Areas';
import { GROUND } from '../core/GameState';
import type { BuildableType, TileData } from '../core/types';
import { MACHINES } from '../data/machines';
import { TUNING } from '../data/tuning';
import { AREA_TYPES } from '../data/city';
import type { Sim } from './Sim';

/** What the suggestion's button does. */
export type SuggestionAction =
  | { kind: 'wake'; machineId: string }
  | { kind: 'focus'; x: number; z: number }
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
      for (const id of s.areas.revealed()) {
        if (id === PARK || s.areas.fog(id) === 'cleared' || !s.areas.ready(id)) continue;
        const lm = s.areas.landmark(id);
        const a = s.areas.info(id);
        if (lm) return { text: `The ${a.landmarkName} is ready to wake.`, label: `✨ Wake the ${a.landmarkName}`, action: { kind: 'wake', machineId: lm.id } };
      }
    }
    // 2. An upgrade you can buy now.
    const up = s.upgrades.all().find((d) => s.upgrades.status(d).ok);
    if (up) return { text: `${up.icon} ${up.name} is affordable: ${up.describe(s.upgrades.level(up.id) + 1)}.`, label: '⬆️ Upgrades', action: { kind: 'upgrades' } };
    // 3. Before the fountain: a machine it still needs, if one can be built now.
    const build = city && !s.state.progression.coreActivated ? this.neededBuild() : undefined;
    if (build) return build;
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

  /** The first machine the fountain still needs that is affordable, at a valid spot nearest the fountain. */
  private neededBuild(): Suggestion | undefined {
    const s = this.sim;
    const order: BuildableType[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'motherTree'];
    const [fx, fz] = s.areas.info(PARK).landmark;
    const tiles = s.areas.tiles(PARK).sort((a, b) => Math.abs(a.x - fx) + Math.abs(a.z - fz) - (Math.abs(b.x - fx) + Math.abs(b.z - fz)) || a.z - b.z || a.x - b.x);
    for (const type of order) {
      if (s.state.machines.some((m) => m.type === type && !m.starter)) continue;
      if (s.econ.shortfall(s.build.cost(type))) continue;
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

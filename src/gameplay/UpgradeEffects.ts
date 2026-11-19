import { GROUND } from '../core/GameState';
import { PARK } from '../core/Areas';
import type { MachineData } from '../core/types';
import type { Sim } from './Sim';
import { LANDING } from '../data/oldcity';

export interface Spot {
  roofId: string;
  x: number;
  z: number;
}

const at = (m: MachineData): Spot => ({ roofId: m.roofId, x: m.x + m.size / 2, z: m.z + m.size / 2 });

/**
 * Where an upgrade's effect shows in the world: the machines, landmarks or fog it changes. The renderer
 * sparkles these on purchase, so every upgrade has a visible moment (headless, so tests check every upgrade
 * has one).
 */
export function upgradeHighlights(sim: Sim, id: string): Spot[] {
  const s = sim;
  const of = (...types: MachineData['type'][]) => s.state.machines.filter((m) => types.includes(m.type)).map(at);
  const landmarks = (cleared: boolean) =>
    s.areas
      .revealed()
      .filter((a) => (s.areas.fog(a) === 'cleared') === cleared && (cleared || a !== PARK))
      .map((a) => s.areas.landmark(a))
      .filter((m): m is MachineData => !!m)
      .map(at);
  switch (id) {
    case 'broadPulse':
    case 'overcharge': {
      // The pulse itself: the next region's open ground, or the park's (E23.1.1: with every open region awake and
      // the rest behind gates there may be no goal), else the woken landmarks
      const goal = (s.state.progression.coreActivated ? s.areas.nextGoal() : undefined) ?? PARK;
      const open = s.areas.entryTiles(goal).slice(0, 6).map((t) => ({ roofId: GROUND, x: t.x + 0.5, z: t.z + 0.5 }));
      return open.length ? open : landmarks(true).slice(0, 6);
    }
    case 'solarArray':
      return of('solar');
    case 'chainHops':
      return of('pollinator').length ? of('pollinator') : of('solar');
    case 'droneSpeed':
    case 'droneRadius':
    case 'chainIntel':
    case 'secondDrone':
    case 'droneSweep':
    case 'droneMesh':
    case 'droneDispatch':
      return of('droneHub');
    case 'pollinatorReach':
    case 'corridorReach':
      return of('pollinator');
    case 'relayLens':
      return of('relay');
    case 'cultSpeed':
    case 'cultWidth':
    case 'cultSeed':
    case 'cultRoute':
    case 'cultSecond':
      return of('cultivator');
    case 'waterBloom':
      return of('condenser');
    case 'treeResonance':
      return of('motherTree');
    case 'relay2':
      return of('core').filter((m) => m.roofId !== GROUND);
    case 'fogLantern': {
      // the landmarks still to wake: open regions first, then those behind their gates (E23.1.1)
      const behind = s.areas
        .sealedAreas()
        .map((a) => s.areas.landmark(a))
        .filter((m): m is MachineData => !!m)
        .map(at);
      return [...landmarks(false), ...behind].slice(0, 8);
    }
    case 'hover': {
      // bloombot's own ability: it shows on bloombot (where it stands, else the Landing)
      const b = s.bot ?? { roofId: GROUND, x: LANDING.spawn[0], z: LANDING.spawn[1] };
      return [{ roofId: b.roofId, x: b.x, z: b.z }];
    }
    default:
      return [];
  }
}

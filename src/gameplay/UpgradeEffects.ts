import { GROUND } from '../core/GameState';
import { PARK } from '../core/Areas';
import type { MachineData } from '../core/types';
import type { Sim } from './Sim';

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
    case 'efficientPulse':
    case 'broadPulse':
    case 'overcharge': {
      // The pulse itself: the fog edge (city) or the home's open ground.
      const goal = s.state.progression.coreActivated ? s.areas.nextGoal() : PARK;
      return goal ? s.areas.entryTiles(goal).slice(0, 6).map((t) => ({ roofId: GROUND, x: t.x + 0.5, z: t.z + 0.5 })) : [];
    }
    case 'solarArray':
      return of('solar');
    case 'richSoil':
    case 'seedVault':
      return of('core').slice(0, 1).concat(landmarks(true)).slice(0, 8);
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
    case 'waterBloom':
      return of('condenser');
    case 'treeResonance':
      return of('motherTree');
    case 'relay2':
      return of('core').filter((m) => m.roofId !== GROUND);
    case 'fogLantern':
      return landmarks(false);
    case 'landmarkLights':
      return landmarks(true);
    default:
      return [];
  }
}

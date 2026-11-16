import type { DroneRole } from '../core/types';

/**
 * E18 (#199): the drone roles a Drone Hub can be refitted for (docs/DRONE_ROLES_EPIC.md, 2.1–2.2). Static text
 * only; unlocks, prices and behaviour live in `DroneRoleSystem` and `TUNING.drone.roles`. Icons are Look 5.2's
 * painted role icons (`ROLE_ICONS` in src/ui/Icons.ts), keyed by role id.
 */
export interface DroneRoleDef {
  id: DroneRole;
  name: string;
  /** one line: what its drones do */
  job: string;
  /** what its drones never do (makes the choice a real one) */
  never?: string;
  /** shown while the role is locked */
  lockedReason?: string;
  /** does the role earn while the player is away (2.7)? */
  offline: boolean;
  /** P1 roles (Spark, Harvester) */
  later?: boolean;
}

export const DRONE_ROLES: DroneRoleDef[] = [
  { id: 'restorer', name: 'Restorer', job: 'Restores nearby tiles, then nurtures green ones', offline: true },
  {
    id: 'gardener',
    name: 'Gardener',
    job: 'Waters restored tiles so they and two neighbours grow a stage',
    never: 'Never restores new tiles',
    lockedReason: 'Build a Drone Hub and a Water Condenser, and grow 10 tiles to full bloom',
    offline: true,
  },
  {
    id: 'scout',
    name: 'Scout',
    job: 'Restores tiles at the fog’s edge, from farther away',
    never: 'Never nurtures',
    lockedReason: 'Reveal a city area beyond the park',
    offline: true,
  },
  {
    id: 'courier',
    name: 'Courier',
    job: 'Takes charge to Mother Trees, solar panels, relays and condensers',
    never: 'Never touches tiles',
    lockedReason: 'Plant a Mother Tree or build a Bloom Relay',
    offline: false,
  },
  {
    id: 'spark',
    name: 'Spark',
    job: 'Starts a small Bloom Chain in a ready garden cluster',
    never: 'Never restores or nurtures',
    lockedReason: 'Build 3 Pollinator Gardens',
    offline: false,
    later: true,
  },
  {
    id: 'harvester',
    name: 'Harvester',
    job: 'Turns income lost to full stores into biomass',
    never: 'Never touches tiles or machines',
    lockedReason: 'Lose a minute of income to full stores',
    offline: false,
    later: true,
  },
];

export const DRONE_ROLE_BY_ID = Object.fromEntries(DRONE_ROLES.map((r) => [r.id, r])) as Record<DroneRole, DroneRoleDef>;

export const isDroneRole = (v: unknown): v is DroneRole => typeof v === 'string' && Object.prototype.hasOwnProperty.call(DRONE_ROLE_BY_ID, v);

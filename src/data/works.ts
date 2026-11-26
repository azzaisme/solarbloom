// #787 (point 4): building is needed in most regions. Each gated region has one "works" piece beside its landmark
// (a dark machine, a dry channel or seized machinery), and its landmark can't wake until the works run. They need
// what only building gives: power, water or drones. All data, no rules (gameplay/RegionWorks); the amounts live in
// data/tuning (TUNING.works). The park and Elder Grove stay ungated, so the start stays gentle.
//
// Unlock order (proved by tests/region-works.test.ts): the Solar Panel is known from the start; the fountain's first
// step brings the Water Condenser; Mast Row's Keeper the Power pole, Saltwind's the Wind turbine, Cistern's the Pump
// and Pipe; the fountain's second step the Drone Hub. A pipe gate draws on a pond that is live before its own landmark
// wakes (never a spring-fed one: data/water springsNeedLandmark). Each gate needs only what its region's place in that order has.

import type { DroneRole } from '../core/types';
import type { RegionId } from './oldcity';

export type WorksKind = 'power' | 'water' | 'drones';

/** How the piece is drawn (rendering/ChunkRenderer `works`), dark and then running. */
export type WorksLook = 'junction' | 'fountain' | 'winch' | 'valve' | 'clockwork' | 'feed' | 'channel' | 'motor' | 'liftgear';

/**
 * What makes the works run:
 * - `power`: grid power reaching the piece (it joins power lines like a machine: a panel touching it, or a pole near
 *   it) and enough of it at once (TUNING.works.power[region], in the grid's watts);
 * - `condenser`: a built Water Condenser nearby (TUNING.works.condenserReach);
 * - `pipe`: a pipe carrying water right beside it (TUNING.works.pipeReach);
 * - `drones`: a Drone Hub whose drones can reach it, with power to fly, and (`job`) that job.
 */
export type WorksNeed = { power: true } | { condenser: true } | { pipe: true } | { drones: true; job?: DroneRole };

export interface WorksDef {
  region: RegionId;
  kind: WorksKind;
  look: WorksLook;
  /** the piece's cell (a blocked set piece; built machines go round it) */
  x: number;
  z: number;
  need: WorksNeed;
  /** what it is, as the player sees it, for prompts ("the junction box") */
  name: string;
  /** what is wrong with it, seen: one sentence */
  dark: string;
  /** what to build, and where: one or two sentences (keys as {placeholders}) */
  how: string;
  /** a short goal for the objective card and the guide line */
  goal: string;
  /** once running: what the player sees now (the prompt, and the toast's first line) */
  running: string;
  /** the toast's second line: what this means for the region */
  then: string;
  /** what the region's progress bar says it still needs, and once done */
  needs: string;
  done: string;
}

export const WORKS: WorksDef[] = [
  {
    region: 'mastRow',
    kind: 'power',
    look: 'junction',
    x: 14,
    z: -24,
    need: { power: true },
    name: 'the junction box',
    dark: "The Signal Mast's junction box is dark.",
    how: 'Build a Solar Panel right beside it. Its sunshine will wake the box.',
    goal: 'Build a Solar Panel beside the dark junction box',
    running: 'The junction box hums, and its lamp glows.',
    then: 'The Signal Mast has power. Now it can wake.',
    needs: 'Needs power',
    done: 'Powered',
  },
  {
    region: 'oldMarket',
    kind: 'water',
    look: 'fountain',
    x: 25,
    z: 14,
    need: { condenser: true },
    name: 'the drinking fountain',
    dark: "The market's drinking fountain is bone dry.",
    how: 'Build a Water Condenser nearby. It pulls water out of the air.',
    goal: 'Build a Water Condenser by the dry drinking fountain',
    running: 'Water bubbles up in the drinking fountain.',
    then: 'The Market Hall has water. Now it can wake.',
    needs: 'Needs water',
    done: 'Water running',
  },
  {
    region: 'saltwind',
    kind: 'power',
    look: 'winch',
    x: -10,
    z: 39,
    need: { power: true },
    name: "the lock's winch",
    dark: "The Sea Lock's winch is too heavy to turn.",
    how: 'One Solar Panel is not enough. Build two side by side, touching the winch, or a Wind turbine beside it.',
    goal: "Power the Sea Lock's winch with two Solar Panels or a Wind turbine",
    running: 'The winch turns with a clank, and its lamp glows.',
    then: 'The Sea Lock has power. Now it can wake.',
    needs: 'Needs power',
    done: 'Powered',
  },
  {
    // not a pipe: the Cistern's own water (Sluice's pond, the basin) stays dry until the Old Cistern wakes
    // (data/water springsNeedLandmark), so its gate is the springs' dead pump, which wants power
    region: 'cistern',
    kind: 'power',
    look: 'valve',
    x: 55,
    z: 45,
    need: { power: true },
    name: 'the spring pump',
    dark: "The old cistern's spring valves are stuck shut, and their pump is dead.",
    how: 'Wake the pump with power: two or three Solar Panels side by side, touching it, or a Wind turbine beside it.',
    goal: 'Power the dead pump by the old cistern',
    running: 'The pump coughs into life, and the valves creak open.',
    then: 'The springs are ready. Now the Old Cistern can wake.',
    needs: 'Needs power',
    done: 'Powered',
  },
  {
    region: 'clockPlaza',
    kind: 'drones',
    look: 'clockwork',
    x: 60,
    z: 5,
    need: { drones: true },
    name: 'the seized clockwork',
    dark: "The Clock Tower's clockwork is seized with rust.",
    how: 'Build a Drone Hub nearby, with a Solar Panel beside it so its drones can fly. They will work the gears loose.',
    goal: 'Build a Drone Hub by the seized clockwork',
    running: 'The drones free the gears, and the clockwork ticks.',
    then: 'The Clock Tower can turn again. Now it can wake.',
    needs: 'Needs drones',
    done: 'Ticking',
  },
  {
    region: 'terraces',
    kind: 'power',
    look: 'feed',
    x: 2,
    z: -54,
    need: { power: true },
    name: "the core's power feed",
    dark: "The Rooftop Core's power feed is cold.",
    how: 'It needs a lot of power: about four Solar Panels. Join them to it with Power poles, or put Wind turbines up here, where it is windy.',
    goal: "Power the Rooftop Core's feed with four Solar Panels or Wind turbines",
    running: 'The power feed warms up and glows.',
    then: 'The Rooftop Core has power. Now it can wake.',
    needs: 'Needs lots of power',
    done: 'Powered',
  },
  {
    region: 'glasshouse',
    kind: 'water',
    look: 'channel',
    x: -45,
    z: -8,
    need: { pipe: true },
    name: 'the watering channel',
    dark: "The greenhouse's watering channel is dry and cracked.",
    how: "Lay Pipe to it from a Pump on the bank of Fern's pond, with a Solar Panel beside the Pump. A Reservoir full of water works too.",
    goal: 'Pipe water to the dry watering channel',
    running: 'Water runs along the watering channel.',
    then: 'The Great Greenhouse has water. Now it can wake.',
    needs: 'Needs water',
    done: 'Water running',
  },
  {
    region: 'observatory',
    kind: 'power',
    look: 'motor',
    x: 56,
    z: -66,
    need: { power: true },
    name: "the dome's motor",
    dark: "The observatory dome's motor won't turn.",
    how: 'It needs the most power of all: about six Solar Panels, joined to it with Power poles. Wind turbines on the hill help, and a Battery keeps it going after dark.',
    goal: "Power the dome's motor with six Solar Panels' worth",
    running: 'The dome motor whirrs, and its lamp glows.',
    then: 'The Sky Observatory has power. Now it can wake.',
    needs: 'Needs the most power',
    done: 'Powered',
  },
  {
    region: 'spireHeights',
    kind: 'drones',
    look: 'liftgear',
    x: -45,
    z: -66,
    need: { drones: true, job: 'gardener' },
    name: "the lift's winding gear",
    dark: "The lift's winding gear is caked in old dust.",
    how: 'Build a Drone Hub nearby and give its drones the Gardener job. Their water will wash the gear free. Water near the Drone Hub keeps them going.',
    goal: 'Send Gardener drones to the dusty winding gear',
    running: 'The Gardeners wash the gear clean, and it turns.',
    then: 'The lifts can run again. Now the Solar Spire can wake.',
    needs: 'Needs Gardener drones',
    done: 'Turning',
  },
];

export function worksOf(region: string): WorksDef | undefined {
  return WORKS.find((w) => w.region === region);
}

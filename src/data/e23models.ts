/**
 * E23.10.2 (#406): every model and clip E23 (#354) needs, as data. `docs/art/e23-models.md` explains each one;
 * `tests/e23-models.test.ts` checks reuse sources exist, the batch totals, and that each new file is within its
 * budget once it lands in `assets/raw/models/final/`.
 */

/** How an object gets its art. */
export type Route = 'text' | 'image' | 'reuse' | 'procedural';
/** The child issue it belongs to. */
export type ModelGroup = 'power' | 'water' | 'farm' | 'crafting' | 'companions';
/** The Meshy batch it is generated in (by milestone). Reused and procedural objects have none. */
export type Batch = 'A' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6';

export interface E23Model {
  name: string;
  group: ModelGroup;
  route: Route;
  /** LOD0 triangle budget (new models only). */
  tris?: number;
  /** The existing model it reuses (route 'reuse'). */
  from?: string;
  batch?: Batch;
  what: string;
}

/** Credits per route (Meshy prices as of 2026-10-12; see docs/art/old-city-models.md). */
export const ROUTE_CREDITS = { text: 15, image: 18, clip: 3 } as const;

export const E23_MODELS: E23Model[] = [
  // Power (#464)
  { name: 'charger', group: 'power', route: 'image', tris: 3000, batch: 'A', what: 'Charger: bloombot meditates on it' },
  { name: 'battery', group: 'power', route: 'text', tris: 2000, batch: 'B1', what: 'Battery (big battery is 1.6× with a second cell bank)' },
  { name: 'wind-turbine', group: 'power', route: 'image', tris: 4000, batch: 'B1', what: 'Wind turbine (turbine fields are several)' },
  { name: 'large-solar-array', group: 'power', route: 'text', tris: 3000, batch: 'B1', what: 'Gantry for the large solar array; its four panels are the procedural solar panel' },
  { name: 'power-pole', group: 'power', route: 'reuse', from: 'bloom-relay', what: 'Power pole (relays become poles)' },
  { name: 'lamp', group: 'power', route: 'reuse', from: 'lamp-post', what: 'Night lighting: lamp post' },
  { name: 'lantern-light', group: 'power', route: 'reuse', from: 'lantern', what: 'Night lighting: lantern' },
  // Water (#465)
  { name: 'pump', group: 'water', route: 'text', tris: 2000, batch: 'B1', what: 'Pump' },
  { name: 'pipe-joint', group: 'water', route: 'reuse', from: 'copper-pipe', what: 'Pipe joints and valves; straight, corner, tee, cross and end runs are procedural tubes' },
  { name: 'reservoir', group: 'water', route: 'reuse', from: 'reservoir-basin', what: 'Reservoir (large reservoir at 1.6×)' },
  { name: 'desalination-plant', group: 'water', route: 'image', tris: 5000, batch: 'B1', what: 'Desalination plant' },
  { name: 'sprinkler', group: 'water', route: 'text', tris: 600, batch: 'B1', what: 'Sprinkler' },
  { name: 'feed-tank', group: 'water', route: 'text', tris: 1500, batch: 'B1', what: 'Feed tank' },
  // Farm (#466)
  { name: 'planter-box', group: 'farm', route: 'reuse', from: 'planter-bed', what: 'Planter box; Keeper gardens, butterfly gardens and roof gardens too' },
  { name: 'flooded-bed', group: 'farm', route: 'reuse', from: 'planter-trough', what: 'Flooded bed for rice' },
  { name: 'compost-bin', group: 'farm', route: 'text', tris: 1500, batch: 'A', what: 'Compost bin' },
  { name: 'bio-digester', group: 'farm', route: 'image', tris: 4000, batch: 'B2', what: 'Bio Digester' },
  { name: 'beehive', group: 'farm', route: 'text', tris: 1500, batch: 'B2', what: 'Beehive' },
  { name: 'fish-pond', group: 'farm', route: 'procedural', what: 'Fish pond: stone rim and water follow its outline' },
  { name: 'mushroom-log', group: 'farm', route: 'text', tris: 1000, batch: 'B2', what: 'Mushroom log' },
  { name: 'worm-bin', group: 'farm', route: 'reuse', from: 'crate', what: 'Worm bin with a procedural soil top' },
  { name: 'bird-box', group: 'farm', route: 'text', tris: 800, batch: 'B2', what: 'Wildlife home: bird box' },
  { name: 'bat-box', group: 'farm', route: 'text', tris: 800, batch: 'B2', what: 'Wildlife home: bat box' },
  { name: 'hedgehog-house', group: 'farm', route: 'text', tris: 1000, batch: 'B2', what: 'Wildlife home: hedgehog house' },
  { name: 'greenhouse', group: 'farm', route: 'image', tris: 5000, batch: 'B2', what: 'Greenhouse (Glasshouse Gardens)' },
  { name: 'watering-can', group: 'farm', route: 'text', tris: 500, batch: 'A', what: 'Watering can' },
  { name: 'orchard-tree', group: 'farm', route: 'procedural', what: 'Orchard trees (TreeGen, procedural fruit)' },
  { name: 'trellis', group: 'farm', route: 'procedural', what: 'Bean trellis lattice' },
  // Crops by stage (#466): one shared seedling, then each crop's plant; its fruit or flower heads are separate parts,
  // left off (and the plant scaled down) for the growing stage and shown at ripe. Wilting is a shader droop.
  { name: 'crop-seedling', group: 'farm', route: 'text', tris: 300, batch: 'B6', what: 'Every crop’s first stage' },
  ...['radish', 'lettuce', 'potato', 'beans', 'tomato', 'sweetcorn', 'pumpkin', 'sunflower', 'watercress', 'rice', 'lavender', 'mint', 'moonflower', 'flowers', 'sea-kale'].map(
    (c): E23Model => ({ name: `crop-${c}`, group: 'farm', route: 'text', tris: 1200, batch: 'B6', what: `${c}: growing and ripe stages` }),
  ),
  // Crafting and automation (#467)
  { name: 'crafting-table', group: 'crafting', route: 'reuse', from: 'workbench', what: 'Crafting table in the house' },
  { name: 'chest', group: 'crafting', route: 'reuse', from: 'storage-chest', what: 'Storage chest' },
  { name: 'small-chest', group: 'crafting', route: 'reuse', from: 'crate', what: 'Small chest (courier and mulcher drop-offs)' },
  { name: 'research-station', group: 'crafting', route: 'image', tris: 4000, batch: 'B3', what: 'Research station' },
  { name: 'assembler', group: 'crafting', route: 'image', tris: 5000, batch: 'B3', what: 'Assembler' },
  { name: 'mulcher', group: 'crafting', route: 'text', tris: 2000, batch: 'B3', what: 'Mulcher' },
  { name: 'hopper-composter', group: 'crafting', route: 'text', tris: 1500, batch: 'B3', what: 'Hopper composter' },
  { name: 'auto-feeder', group: 'crafting', route: 'text', tris: 800, batch: 'B3', what: 'Auto-feeder' },
  { name: 'seed-drill', group: 'crafting', route: 'text', tris: 1500, batch: 'B3', what: 'Seed drill' },
  { name: 'forecast-board', group: 'crafting', route: 'text', tris: 1000, batch: 'B3', what: 'Forecast board at the house' },
  { name: 'bench', group: 'crafting', route: 'reuse', from: 'bench', what: 'Bench to sit on' },
  { name: 'bed', group: 'crafting', route: 'reuse', from: 'bed', what: 'Sleeping in the house' },
  // Companions and visitors (#468): rigged in Blender, clips idle, follow, sit, climb
  ...(
    [
      ['fox', 3000], ['hedgehog', 2000], ['squirrel', 2000], ['otter', 3000], ['owl', 2500], ['magpie', 2000], ['frog', 1000], ['bumblebee', 800],
      ['songbird', 1500], ['koi', 1000], ['heron', 3000], ['badger', 3000], ['kingfisher', 1200],
    ] as const
  ).map(([n, tris]): E23Model => ({ name: `animal-${n}`, group: 'companions', route: 'image', tris, batch: 'B4', what: `${n}, rigged with idle, follow, sit and climb` })),
];

/** Animation clips from `meshy_animate` (3 credits each), by batch. Hand-keyed Blender clips cost nothing. */
export const E23_CLIPS: { name: string; batch: Batch; count: number; what: string }[] = [
  { name: 'bloombot', batch: 'A', count: 5, what: 'meditate, sit-down, sit, stand-up, doze' },
  { name: 'keepers', batch: 'B5', count: 20, what: 'each of 10 Keepers: sit-down and sit' },
];

/**
 * Bloombot's E23 clips in `assets/raw/bloombot/bloombot.glb` (blender-pass.py, from bloombot-e23-clips.glb), for
 * E23.2.3: `meditate` sits cross-legged on the ground (at a charger); `sit-down`, `sit`, `stand-up` and `doze` are a
 * chair sit with the feet on the ground and the hips `seatHips` metres up. On a bench whose seat is higher, lift
 * bloombot by (seat height − seatHips) so it sits on the seat with its short legs dangling.
 */
export const BLOOMBOT_CLIPS = {
  meditate: 'meditate',
  sitDown: 'sit-down',
  sit: 'sit',
  standUp: 'stand-up',
  doze: 'doze',
  /** hip height above the feet in `sit`, metres (from the pass's log) */
  seatHips: 0.203,
} as const;

/** Credits for one batch. */
export function batchCredits(b: Batch): number {
  const models = E23_MODELS.filter((m) => m.batch === b).reduce((s, m) => s + (m.route === 'image' ? ROUTE_CREDITS.image : m.route === 'text' ? ROUTE_CREDITS.text : 0), 0);
  return models + E23_CLIPS.filter((c) => c.batch === b).reduce((s, c) => s + c.count * ROUTE_CREDITS.clip, 0);
}

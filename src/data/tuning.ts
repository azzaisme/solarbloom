import { gameMinutes } from './time';
// Every balance knob lives here. Prototype numbers: tune by playing.

export const TUNING = {
  simStep: 0.1, // seconds per deterministic simulation tick
  maxFrameDt: 0.25, // clamp for large frame gaps (tab switch, hitch): the rest becomes catch-up
  /** City 06.5: simulation work per frame is capped; time lost to a hitch or a hidden tab is caught up over a few frames. */
  catchUp: { frameBudgetMs: 8, maxSeconds: 600, toastFrom: 20 },

  start: {
    resources: { energy: 20, water: 12, biomass: 0 },
    caps: { energy: 60, water: 40, biomass: 100 },
  },

  /**
   * Phase 4 E01.3: storage tiers, one per Seed Vault level (tier 0 is the starting store). Cleared city areas
   * still multiply these (see city.storagePerArea). Every purchase the fountain requires fits in tier 0.
   */
  storageTiers: {
    energy: [60, 150, 400, 1000, 2500],
    water: [40, 100, 250, 600, 1500],
    biomass: [100, 250, 600, 1500, 4000],
  },

  // Energy / water income that always exists, so the player can never softlock.
  starterSolarRate: 1, // energy/sec from the pre-placed (damaged) panel
  solarRate: 1.2, // energy/sec from each panel the player builds
  rainBarrelRate: 0.15, // water/sec trickle from the rain barrel
  /** burstSeconds: Phase 5 E12 Harvest Burst: seconds of steady biomass income per level, paid on each Harvest. */
  harvest: { energy: 8, cooldown: 12, burstSeconds: 4 },

  /**
   * Phase 4 E04.2: pulse reach tiers (Pulse Reach levels 0–4). Euclidean radius on the integer grid, so the
   * footprints are 1, 9, 25, 69 and 161 tiles on open ground (clipped to eligible tiles). An Overcharged pulse
   * reaches one tier further (at least Bloom).
   */
  pulseTiers: [
    { name: 'Seed', radius: 0 },
    { name: 'Sprout', radius: 1.5 },
    { name: 'Bloom', radius: 2.9 },
    { name: 'Grove', radius: 4.5 },
    { name: 'Radiant', radius: 7.1 },
  ],

  /**
   * Phase 4 E04.3: rewarded milestones for restored park tiles (unique tiles, not bloom stages), paid once each.
   * The fountain still needs 130; these fill the gap on the way there.
   */
  parkMilestones: [
    { at: 5, reward: { biomass: 10 } },
    { at: 10, reward: { biomass: 15, water: 10 } },
    { at: 20, reward: { biomass: 25, energy: 20 } },
    { at: 35, reward: { biomass: 40, water: 15 } },
    { at: 50, reward: { biomass: 60, energy: 30 } },
    { at: 75, reward: { biomass: 80, water: 25 } },
    { at: 100, reward: { biomass: 100, energy: 40 } },
    { at: 130, reward: { biomass: 120, energy: 40 } },
  ] as { at: number; reward: Partial<Record<'energy' | 'water' | 'biomass', number>> }[],

  pulse: {
    polluted: { energy: 6, water: 1 },
    prepared: { energy: 3, water: 1 },
    /** E23.7.1: in game time (0.4 game minutes = 0.8 s of play), like every timer */
    growSeconds: gameMinutes(0.4),
  },

  restore: {
    instantBiomass: 1.5,
    biomassPerSec: 0.04, // per restored tile (bloom level 1)
    // Phase 4 E05: production weight per stage (0 barren, 1 restored, 2 blooming, 3 thriving, 4 radiant)
    bloomRateMult: [0, 1, 2, 4, 8],
    nurture: [
      { energy: 0, water: 0 },
      { energy: 0, water: 0 },
      { energy: 8, water: 2 }, // → level 2
      { energy: 12, water: 3 }, // → level 3
      { energy: 18, water: 5 }, // → level 4 (Radiant, Phase 4 E05)
    ],
    nurtureBiomass: 1,
    /** Phase 4 E05: the last stage (Radiant). */
    maxBloom: 4,
    /** "Full bloom" (Thriving): what the fountain and area goals count. Radiant counts too. */
    fullBloom: 3,
    seep: 25, // pollution removed from orthogonal neighbours when a tile restores
    pollutionMin: 55,
    pollutionMax: 100,
  },

  /** Bloom Chain engine (Round 2): a deterministic, capped event queue. */
  chain: {
    stepDelay: 0.15, // seconds between waves, so chains are readable
    maxEvents: 100, // processed events per chain before the rest fast-forwards
    maxEventsCity: 1500, // in the endless city chains can sweep many areas (room for a ×500 combo)
    fastForwardAfterCity: 20, // …and travel for longer before the rest resolves at once
    corridorRange: 6, // Pollinator Gardens on streets/paths pass a chain to another within this many tiles
    maxDepth: 40,
    fastForwardAfter: 6, // seconds; long chains resolve the remainder instantly
    perEffectBiomass: 0.5, // modest bonus for each unique triggered effect
    // Highest milestone reached applies (not stacked): % bonus on everything the chain earned.
    milestones: [
      { effects: 5, pct: 0.1 },
      { effects: 10, pct: 0.25 },
      { effects: 20, pct: 0.5 },
    ],
  },

  /** Solar Panel synergy: a bloom right next to it → one burst per panel per chain. */
  solarBloomBoost: { mult: 2, seconds: 5, burstEnergy: 3 },

  /** Water Condenser ("Rain Collector"): fills a charge meter, then waters dry soil beside it. */
  condenser: { radius: 1, chargePerSec: 1, threshold: 6, targets: 2, maxExtraTargets: 2 }, // Phase 5: Water Bloom's extra waterings stop at +2 (automation chains stay below taps)

  /** Pollinator Garden: a newly restored neighbour triggers a bonus restore/grow nearby. */
  pollinator: { reach: 1, biomassMult: 1.5, triggersPerChain: 4 },
  /**
   * Phase 5 E13: merging. Three edge-connected tier-1 machines → one tier 2. Output index 1 → 5 (3 → 5 overall;
   * the pacing pass raised it from the spec's suggested 4, whose first merge felt modest), and the merge frees two
   * footprints. The first merge of each type is free; later ones cost `feeSeconds` of
   * steady biomass income (at least `minFee`).
   */
  merge: {
    count: 3,
    feeSeconds: 20,
    minFee: 20,
    solarMult: 5,
    waterMult: 5,
    condenserExtraTargets: 2,
    gardenBiomassMult: 2.25, // pacing pass: was 2
    gardenReachBonus: 1,
    fleetDroneMult: 3,
    fleetDroneCap: 12,
    fleetRadiusBonus: 2,
  },
  /**
   * Phase 5 E14: superstructures (tier 3). Output index 22 (three tier 2s = 15; pacing pass: was 18 against 12). Built in three paid stages
   * (foundation on placement, assembly, activation), priced from steady biomass income when the core is placed
   * and locked then. Abilities charge from restorations in reach (the Megahub from its own drones' jobs), are
   * fired by hand or automatically after the first use, and each release gives back less charge than it uses.
   */
  super: {
    outputMult: 22,
    /** Pacing pass: n built superstructures multiply all biomass by 1 + biomassBonus × n^biomassExponent. */
    biomassBonus: 1,
    biomassExponent: 0.5,
    /** Pacing pass: share of the Megaflower's / Nexus's flow charge that still counts while its store is full (E14: 0). */
    fullFlowShare: 0.5,
    /** Pacing pass: with nothing in reach to grow, a Nexus / Tree of Life release pays this many seconds of steady biomass income. */
    bountySeconds: 12,
    stageSeconds: [60, 180, 360], // pacing pass: was 30 / 90 / 180 (the bot that plans its merges built one by minute 14)
    stageMin: [300, 600, 900],
    stageEnergyShare: [0, 0.4, 0.4],
    stageWaterShare: [0, 0, 0.3], // pacing pass: was 0.4 (seed 21 waited 8 minutes for water)
    /** `flowSeconds`: also fills in this long from its own production while that is banked (not lost to a full store). */
    megaflower: { mult: 3, seconds: 15, charge: 25, reach: 4, flowSeconds: 90 },
    nexus: { tiles: 24, charge: 30, reach: 4, waveRadius: 8, flowSeconds: 90 },
    treeOfLife: { tiles: 12, charge: 30, store: 3, reach: 4, gardenMult: 3, gardenReachBonus: 2, flowSeconds: 120 },
    megahub: { drones: 6, seconds: 30, sweep: 3, charge: 20, radiusBonus: 4 },
  },

  /**
   * Phase 5 E16: living ecosystem. Biodiversity is a derived score (never stored or spent): points per restored
   * tile by stage (index 1 Restored … 4 Radiant), per tree species and ground kind in bloom, per landmark woken,
   * per superstructure and per fauna kind. Fauna arrive once, when their condition first holds; they are
   * cosmetic and pay nothing. Caps are per graphics quality tier (the tier selector belongs to the lighting epic;
   * until then "Fewer particles" means low); all are playtest hypotheses.
   */
  ecosystem: {
    recountSeconds: 1,
    pendingChunksPerRecount: 2,
    score: { stage: [0, 0.1, 0.3, 0.6, 1], species: 12, feature: 6, landmark: 25, superstructure: 60, fauna: 15 },
    ranks: [[0, 'Barren'], [20, 'Sprouting'], [150, 'Lively'], [600, 'Flourishing'], [2000, 'Teeming'], [6000, 'Abundant'], [15000, 'Paradise']] as [number, string][],
    fauna: {
      butterflies: { bloomingTiles: 10 },
      birds: { thrivingTreeTiles: 20 },
      /** the park fountain flowing counts as a restored pond; otherwise this many restored water tiles */
      koi: { waterTiles: 4, fountain: true },
      robots: { landmarks: 2 }, // E23.1.2: was one superstructure; now two landmarks woken
    },
    /** most actors of each kind at once, per quality tier */
    caps: {
      high: { butterflies: 10, groundBirds: 4, koi: 8, robots: 4, cats: 6, fireflies: 24, mistMoths: 14, rabbits: 5, pigeons: 8, ducks: 6, frogs: 5, squirrels: 5 },
      medium: { butterflies: 8, groundBirds: 3, koi: 6, robots: 3, cats: 4, fireflies: 16, mistMoths: 10, rabbits: 3, pigeons: 5, ducks: 4, frogs: 3, squirrels: 3 },
      low: { butterflies: 5, groundBirds: 2, koi: 4, robots: 2, cats: 3, fireflies: 10, mistMoths: 6, rabbits: 2, pigeons: 3, ducks: 2, frogs: 2, squirrels: 2 },
    } as Record<'low' | 'medium' | 'high', Record<'butterflies' | 'groundBirds' | 'koi' | 'robots' | 'cats' | 'fireflies' | 'mistMoths' | 'rabbits' | 'pigeons' | 'ducks' | 'frogs' | 'squirrels', number>>,
    /** sleeping cats: this share of finished machines (seeded by machine id) on restored ground has one */
    cats: { share: 0.3 },
    /**
     * E19.3.1 (#257): who moves into a cleared area, by area type (cosmetic only; never a resource). One animal per
     * `every` matching tiles in view, nearest the view first, up to the tier cap of its species.
     */
    locals: {
      park: ['rabbits'],
      street: ['pigeons'],
      plaza: ['pigeons'],
      canal: ['ducks'],
      market: ['pigeons'],
      reservoir: ['frogs', 'ducks'],
      rooftops: ['pigeons'],
      grove: ['squirrels', 'rabbits'],
    } as Record<string, ('rabbits' | 'pigeons' | 'ducks' | 'frogs' | 'squirrels')[]>,
    localsEvery: 6,
  },

  /** Mother Tree: charges from restorations nearby; at full charge releases an area Bloom Pulse. */
  motherTree: { radius: 2, threshold: 12 },

  drone: {
    hubRadius: 6, // Phase 4 E01: was 3; a lone hub ran out of work within a minute (see docs/PHASE_4_AUDIT.md)
    cycleSeconds: 4,
    flySpeed: 3, // tiles/sec
    workSeconds: 0.5,
    retrySeconds: 1,
    /** City: hubs this close (footprint to footprint) link into one network; drones work its whole reach. */
    networkRange: 12,
    /** City: preference for restoring at the fog's edge (score bonus, in tiles²). */
    frontierBonus: 12,
    /**
     * #287 (helpers work around bloombot): a job within `nearBotRadius` tiles of bloombot scores up to
     * `nearBotBonus` better (squared-tile units, fading with distance), so drones help where the player is.
     */
    nearBotBonus: 60,
    nearBotRadius: 9,
    focusMult: 6, // "Focus the frontier": the fog edge counts this many times more
    bloomBonus: 60, // "Keep this area blooming": its green tiles beat restoring up to ~8 tiles further away
    /**
     * Phase 4 E01: the old drone that lives by the park's old solar lamp from the very start. Slow, short-ranged
     * and free (sun-powered): it restores and nurtures nearby tiles on its own, but tapping always outpaces it.
     * Upgrades don't affect it.
     */
    /**
     * Phase 4 E01: drones never spend a store below this share of its cap, so the player's own taps always have
     * something left (without it, drones drained city water and slowed the scripted player by a third). After a
     * big purchase drones wait for the stores to refill past it.
     */
    reserve: 0.25,
    // E23.7.1: helper timers in game time (3.5 game minutes = 7 s of play; 0.4 = 0.8 s)
    old: { enabled: true, radius: 6, cycleSeconds: gameMinutes(3.5), flySpeed: 1.5, workSeconds: gameMinutes(0.4) },
    /**
     * E18: drone roles. Every number is a starting guess from the design (the E18 epic, section 4), to tune
     * against the bots in docs/E18_AUDIT.md.
     */
    roles: {
      /** One-time refit per hub. The biomass part grows ×refitGrowth for each other hub already refitted to it. */
      refit: {
        gardener: { biomass: 60, water: 20 },
        scout: { biomass: 60, energy: 30 },
        courier: { biomass: 80, energy: 15, water: 15 },
        spark: { biomass: 120, energy: 30 },
        harvester: { biomass: 50, energy: 35, water: 20 },
      } as Record<string, { biomass: number; energy?: number; water?: number }>,
      refitGrowth: 1.5,
      /** Grows the target plus this many orthogonal neighbours (+1 per Drone Sweep level), paying the target's nurture water only. */
      gardener: { neighbours: 2, unlockFullBloom: 10 },
      /** Reach is the hub's radius + (reach − 1) × the base radius; flies `speed`× as fast; +1 ⚡ per `tilesPerEnergy` tiles past the base radius. */
      scout: { reach: 1.5, speed: 1.5, tilesPerEnergy: 4 },
      /** Deliveries, each machine at most once per `everySeconds`; priced in what the machine runs on. */
      courier: {
        everySeconds: 8,
        cost: { motherTree: { water: 4 }, condenser: { energy: 4 }, reservoirGarden: { energy: 4 }, solar: { water: 3 }, relay: { energy: 6 } } as Record<string, { energy?: number; water?: number }>,
        treeCharge: 2,
        storeCharge: 1, // condenser or Reservoir Garden
        relayCut: 0.25, // of a link's remaining recharge
      },
      /** One chain per hub per `everySeconds`, from a garden with `cluster`+ other gardens in chain reach. */
      spark: { everySeconds: 30, energy: 10, unlockGardens: 3, cluster: 2 },
      /**
       * Turns income lost to full stores into biomass: each drone collects up to `perDronePerSec` lost ⚡/💧 a
       * second, keeps `keep` of it as its running cost and pays out the rest as biomass, `rate` 🌿 per unit.
       */
      harvester: { unlockLostSeconds: 60, perDronePerSec: 2, keep: 0.7, rate: 1 },
    },
  },

  /** Phase 5 E12: long-tail upgrade strength (see UpgradeSystem.soilMult). */
  upgradeCurve: { soilStep: 1.2 },

  machineCostGrowth: 1.5, // each extra copy of a machine costs this much more
  /** Phase 5 E12: a machine's energy or water price never passes this share of that store (drones keep 25%). */
  machineCostMaxShare: 0.6,
  /** Phase 5 E12: a machine's energy/water price grows for this many copies, then only its biomass price does. */
  machineCappedGrowthCopies: 9,

  cat: {
    firstMinTime: 180, // Phase 4 E08.1: first cat at about minute 3–4 (was 4–6), once the player knows the grid
    firstMinRestored: 10,
    firstForceTime: 240,
    laterMin: 180, // Phase 4 E08.1: later cats every 3–5 minutes of active play (was 4–8)
    laterMax: 300,
    hiddenBonusCapSec: 180, // reward grows a little with hidden time, up to this
    hiddenBonusMax: 0.5,
    harvestSecondsMin: 30, // Phase 4 E08.4: Lucky Harvest: 30–60 s of sustained biomass production (no temporary boosts)
    harvestSecondsMax: 60,
    harvestMin: 15,
    frenzySeconds: 45,
    frenzyMult: 3,
    megaBloomTiles: 8,
    dronePartySeconds: 45,
    weights: { luckyHarvest: 40, solarFrenzy: 25, megaBloom: 20, droneParty: 12, jackpot: 3, goldenRelay: 14, catsGarden: 14, fogWhisker: 18 },
    fogWhiskerTiles: 10, // Fog Whisker: tiles of the next fogged area restored from its edge, capped
    goldenRelayExtra: 1, // Golden Relay: extra remote blooms on the next crossing
    goldenCorridorTiles: 5, // Golden Relay in the city: extra blooms on the next green corridor hop…
    goldenCorridorMax: 12, // …+1 per 10 cleared areas, up to this
    /** E20.1 (#284): the cat hides: never in view, never this close to bloombot (tiles)… */
    minFromBot: 6,
    /** …and preferably within a short walk of it (tiles), so finding it is a stroll, not a trek. */
    preferWithin: 40,
    /** On screen but further than this from bloombot (tiles) counts as out of sight: small, hazy, behind things. */
    inViewTiles: 12,
    catsGardenTiles: 6, // Cat's Garden: tiles restored (and decorated) on a random unlocked roof
    /**
     * Phase 5 E15: rarer cats (rolled when one appears, 80 / 18 / 2). `mult` scales the reward (harvest seconds,
     * buff and party time, Mega Bloom size); a Rainbow Cat also gives two different rewards. The first cat is
     * always a standard one with a Lucky Harvest (onboarding).
     */
    variants: {
      standard: { weight: 80, mult: 1 },
      golden: { weight: 18, mult: 2 },
      rainbow: { weight: 2, mult: 3 },
    },
    /** Phase 5 E15: hard caps, whatever the variant and hidden-time bonus. */
    maxRewardMult: 4.5,
    surgeMaxSeconds: 180, // Solar Surge never stacks past this many seconds left
    partyMaxSeconds: 135,
    megaBloomMax: 30,
    /** Phase 5 E15: after this long hiding (sim seconds), a cat leaves faint paw prints (HUD 🐾 chip, inspect). */
    hintAfter: 90,
  },

  core: {
    restoredTiles: 42,
    fullBloomTiles: 24,
    // Phase 4: biomass only (was 60 ⚡ / 170 🌿). Taps and drones always find something to spend energy on
    // (nurturing up to Radiant), so an energy price could never fill; biomass is never spent automatically.
    cost: { biomass: 100 } as { energy?: number; biomass: number },
    resonanceBiomassMult: 1.25,
    sequenceSeconds: 7,
  },

  /**
   * Phase 5 E12: smaller payoffs on the way to each city area's landmark: at these shares of the tiles it
   * needs, a reward of this many seconds of steady biomass income (no temporary boosts), at least `min`, plus a
   * little energy and water. Paid once each, in order.
   */
  areaSteps: { at: [0.25, 0.5, 0.75], incomeSeconds: [10, 15, 20], min: 20, energy: 20, water: 10 },

  /** Phase 5 E12: after any upgrade purchase, the advisor points at progress for this long before upgrades again. */
  advisor: { upgradeHintCooldown: 15, savingFreshSeconds: 10, roleHintSeconds: 30 },

  autosaveSeconds: 10,

  /** The starting park's Core (the fountain): replaces TUNING.core when the game starts in the city. */
  /** Mega Pulse: manual taps charge it; the next tap after it is full releases a city-scale chain. */
  mega: {
    charge: 40,
    baseTiles: 40,
    tilesPerArea: 3, // per cleared area…
    maxTiles: 300, // …up to this
    bigChain: 20, // chains this big count as "big" in the stats (who starts them)
  },

  park: {
    restoredTiles: 130,
    fullBloomTiles: 52,
  },

  /** City scale: areas under the fog. */
  city: {
    /** share of an area's restorable tiles to restore before its landmark can be woken */
    clearShare: 0.6,
    /** …but never more than this many tiles (× the area's distance difficulty), so big areas stay a session's goal */
    clearCap: 160,
    /**
     * Region unlocks (owner, 18 Nov 2026): a newly revealed area stays sealed in thick fog until bought. The price
     * is set when the area appears: `biomass` × `growth`^n (n = areas already unlocked), but at least
     * `incomeSeconds` of sustained biomass income, so it stays a real choice as the economy grows; and `energy` ×
     * `energyGrowth`^n, never more than `capShare` of the energy cap (always affordable by waiting).
     */
    unlock: { enabled: true, biomass: 1000, growth: 1.6, incomeSeconds: 120, energy: 60, energyGrowth: 1.25, capShare: 0.6 },
    /** fog density at 0% restored and just before clearing (it thins linearly in between) */
    fogFull: 1,
    fogThin: 0.25,
    /** Each cleared area (beyond the park) adds this share of the starting storage, with diminishing returns. */
    storagePerArea: 0.35,
    storageExponent: 0.85,
    /** Each cleared area waives one copy's worth of the ×machineCostGrowth for every machine type. */
    permitsPerArea: 1,
    /**
     * Permanent bonus per cleared area, by type (per second). Soft-scaled: n areas of a type give
     * base × n^bonusExponent, so numbers stay readable after hundreds of areas.
     */
    bonusExponent: 0.75,
    bonuses: {
      park: { biomass: 0.3 },
      street: { energy: 0.25 },
      plaza: { energy: 0.35 },
      canal: { water: 0.35 },
      market: { biomass: 0.25, energy: 0.1 },
      reservoir: { water: 0.5 },
      grove: { biomass: 0.4 },
      rooftops: { energy: 0.3, biomass: 0.15 },
    } as Record<string, Partial<Record<'energy' | 'water' | 'biomass', number>>>,
  },

  /**
   * City 09.1: each area's landmark also asks for one specialty action for its type. Sizes grow with distance
   * from the park (base + perChunk × distance, capped at max); `share` caps a size by the area's own restorable
   * tiles, so building can never put it out of reach.
   */
  milestones: {
    park: { kind: 'fullBloom', base: 4, perChunk: 0.5, max: 16, share: 0.08 },
    street: { kind: 'corridor', base: 1, perChunk: 0.1, max: 3 },
    plaza: { kind: 'solarBoost', base: 2, perChunk: 0.2, max: 6 },
    canal: { kind: 'canalFlow', base: 1, perChunk: 0.05, max: 2 },
    market: { kind: 'chain', base: 6, perChunk: 0.5, max: 20, share: 0.12 },
    reservoir: { kind: 'overflow', base: 1, perChunk: 0.05, max: 2 },
    grove: { kind: 'canopy', base: 1, perChunk: 0, max: 1 },
    rooftops: { kind: 'roofBloom', base: 10, perChunk: 0.5, max: 24, share: 0.5 },
  } as Record<string, { kind: 'fullBloom' | 'corridor' | 'solarBoost' | 'canalFlow' | 'chain' | 'overflow' | 'canopy' | 'roofBloom'; base: number; perChunk: number; max: number; share?: number }>,

  /** City 10.7: district-wide blooms (a district is one CITY_GEN.districtChunks square of chunks). */
  district: {
    minAwake: 4, // neighbouring awake landmarks (one connected group) needed in the district
    seconds: 8, // presentation length (skippable)
    reward: { energy: 150, water: 100, biomass: 300 },
    rewardGrowth: 0.25, // each earlier district bloom adds this share to the next reward
  },

  /** City 10.4: buildable Bloom Relays (any two within range link; range is measured in world space). */
  relay: {
    range: 16, // tiles between relays (+rangePerLevel per Relay Lens level)
    rangePerLevel: 6,
    zoneRadius: 1, // a bloom this close to a relay sends its pulses
    cooldown: 6, // seconds before a link carries another pulse
    targets: 2, // blooms around the far relay per crossing (+1 per Relay Lens level)
    remoteRadius: 3,
    travelPerTile: 0.03, // seconds of travel per tile of distance (presentation and chain timing)
  },

  /** Reservoir Gardens, the Elder Tree's Canopy Burst and Overcharge (first built for the rooftops, used by the city). */
  neighbourhood: {
    /** Reservoir Overflow: condensers in range fill a Reservoir Garden; when full it spills. */
    reservoir: {
      condenserRange: 2, // condenser footprint → garden footprint (Manhattan)
      fillPerCharge: 1, // garden fill per completed condenser charge
      threshold: 3,
      targets: 3, // dry tiles irrigated per Overflow
      radius: 2,
      lushSeconds: 25, // newly irrigated plants grow extra biomass for a while
      lushMult: 2,
    },
    /** Canopy: the Elder Tree charges from blooms around it and releases a Canopy Burst. */
    canopy: {
      chargeRadius: 3,
      threshold: 12,
      burstRadius: 2,
      burstRadiusAwake: 3,
      gardenBonusTargets: 2, // each Pollinator Garden inside the burst adds this many extra blooms beyond it
    },
    /** Manual pulse right next to a machine boosts its next trigger. */
    overchargeSeconds: 12,
  },

  /**
   * Look 6 (#169, spike #170, docs/design/cultivation.md): every tile state change plays out as a process. The sim
   * keeps its own timings (visual catch-up); these are the visual durations in sim seconds. Hypotheses, picked by
   * hand and checked with the pacing bots (not people).
   */
  transitions: {
    /** concrete softening: one `restore.seep` step eases in from the restored neighbour's side */
    soften: 3,
    /** concrete → moss creep */
    moss: 6,
    /** moss/concrete → growing → restored, by who restored it (the sim still restores at its own moment) */
    restore: { pulse: 12, broad: 10, auto: 8, fast: 5 },
    /** stages of the restore sequence, as shares of its duration: [start, end] */
    restoreStages: { fracture: [0, 0.08], heave: [0.08, 0.34], crumble: [0.34, 0.52], sprout: [0.46, 0.7], knit: [0.7, 1] },
    /** bloom grow-in, by the level reached (index 2..4); automatic nurtures play at `autoMult` */
    bloom: [0, 0, 3, 4, 5],
    autoMult: 0.6,
    /** lush: soak from the water side, and dry back over the last seconds before `lushUntil` */
    lushSoak: 2.5,
    lushDry: 10,
    /** an obstacle cleared by the entry fix crumbles and greens over */
    unblock: 2,
    /** visual duration multiplier per ground feature */
    feature: { lawn: 1, paving: 0.8, road: 1, water: 1.2, clay: 0.9, litter: 1, obstacle: 1, building: 1 } as Record<string, number>,
    /** mass changes roll out as a wave: delay per tile of distance from the origin, capped */
    wave: { perTile: 0.05, max: 3 },
    /** area clear: props wake in a wave from the landmark; fog rolls back across the area */
    areaWave: { perTile: 0.04, max: 3, prop: 1.5, fog: 3 },
    /** a tap on a tile mid-transition knocks it along (visual transitions: share of the whole) */
    knock: { visual: 0.15, bloom: 0.25 },
  },

  /**
   * Look 6.8 (#177): the Cultivator, a solar tiller. The one transition that takes gameplay time: it pushes dead
   * tiles through softening → moss → growing → restored on its own, for energy instead of pulse costs.
   */
  cultivator: {
    radius: 5,
    routeRadius: 9, // with Fog Seeker
    driveSpeed: 0.8, // tiles/s
    softenRate: 20, // pollution/s
    growSeconds: gameMinutes(1.5), // E23.7.1: 1.5 game minutes = 3 s of play
    energyPerSec: 0.5, // drawn while working; parks below drone.reserve of the energy store
    speedPerLevel: 0.4, // Tiller Speed: +40 % work and drive speed per level
    /** a tap on a tile it's working: share of the current phase, at most `max` per phase, `gap` s apart */
    knock: { share: 0.15, max: 3, gap: 0.4 },
    seedBloom: 2, // Seed Mix: restored tiles start at this bloom
  },
} as const;

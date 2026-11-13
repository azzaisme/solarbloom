// Every balance knob lives here. Prototype numbers: tune by playing.

export const TUNING = {
  simStep: 0.1, // seconds per deterministic simulation tick
  maxFrameDt: 0.25, // clamp for large frame gaps (tab switch, hitch)

  start: {
    resources: { energy: 20, water: 12, biomass: 0 },
    caps: { energy: 60, water: 40, biomass: 100 },
  },

  // Energy / water income that always exists, so the player can never softlock.
  starterSolarRate: 1, // energy/sec from the pre-placed (damaged) panel
  solarRate: 1.2, // energy/sec from each panel the player builds
  rainBarrelRate: 0.15, // water/sec trickle from the rain barrel
  harvest: { energy: 8, cooldown: 12 },

  pulse: {
    polluted: { energy: 6, water: 1 },
    prepared: { energy: 3, water: 1 },
    growSeconds: 0.8,
  },

  restore: {
    instantBiomass: 1.5,
    biomassPerSec: 0.04, // per restored tile (bloom level 1)
    bloomRateMult: [0, 1, 2, 3], // biomass multiplier per bloom level
    nurture: [
      { energy: 0, water: 0 },
      { energy: 0, water: 0 },
      { energy: 8, water: 2 }, // → level 2
      { energy: 12, water: 3 }, // → level 3
    ],
    nurtureBiomass: 1,
    maxBloom: 3,
    seep: 25, // pollution removed from orthogonal neighbours when a tile restores
    pollutionMin: 55,
    pollutionMax: 100,
  },

  /** Bloom Chain engine (Round 2): a deterministic, capped event queue. */
  chain: {
    stepDelay: 0.15, // seconds between waves, so chains are readable
    maxEvents: 100, // processed events per chain before the rest fast-forwards
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
  condenser: { radius: 1, chargePerSec: 1, threshold: 6, targets: 2 },

  /** Pollinator Garden: a newly restored neighbour triggers a bonus restore/grow nearby. */
  pollinator: { reach: 1, biomassMult: 1.5, triggersPerChain: 4 },

  /** Mother Tree: charges from restorations nearby; at full charge releases an area Bloom Pulse. */
  motherTree: { radius: 2, threshold: 12 },

  drone: {
    hubRadius: 3,
    cycleSeconds: 4,
    flySpeed: 3, // tiles/sec
    workSeconds: 0.5,
    retrySeconds: 1,
  },

  machineCostGrowth: 1.5, // each extra copy of a machine costs this much more

  cat: {
    firstMinTime: 240, // first cat: 4–6 minutes of active play, once the player knows the grid
    firstMinRestored: 10,
    firstForceTime: 360,
    laterMin: 240, // later cats: every 4–8 minutes of active play
    laterMax: 480,
    hiddenBonusCapSec: 180, // reward grows a little with hidden time, up to this
    hiddenBonusMax: 0.5,
    harvestSecondsMin: 60, // Lucky Harvest: 60–120 s of current biomass production
    harvestSecondsMax: 120,
    harvestMin: 15,
    frenzySeconds: 45,
    frenzyMult: 3,
    megaBloomTiles: 8,
    dronePartySeconds: 45,
    stashMax: 2, // a missed cat saves up to this many extra rewards instead of blocking new ones
    weights: { luckyHarvest: 40, solarFrenzy: 25, megaBloom: 20, droneParty: 12, jackpot: 3, goldenRelay: 14, catsGarden: 14 },
    goldenRelayExtra: 1, // Golden Relay: extra remote blooms on the next crossing
    preferVisible: 0.75, // chance a cat hides somewhere already on screen (when there is such a spot)
    catsGardenTiles: 6, // Cat's Garden: tiles restored (and decorated) on a random unlocked roof
  },

  core: {
    restoredTiles: 42,
    fullBloomTiles: 24,
    cost: { energy: 60, biomass: 170 },
    resonanceBiomassMult: 1.25,
    sequenceSeconds: 7,
  },

  autosaveSeconds: 10,

  /** Phase 3: the connected neighbourhood. Everything here is a starting point for playtesting. */
  neighbourhood: {
    /** Each unlocked extra rooftop raises every storage cap by this share of the starting cap. */
    roofCapBonus: 0.5,
    relay: {
      zoneRadius: 1, // Manhattan distance from the relay's edge tile that charges it
      cooldown: 8, // seconds between cross-roof pulses on one link
      cooldownRelay2: 6,
      targets: 1, // remote blooms per crossing (Relay I)
      targetsRelay2: 2,
      remoteRadius: 4, // remote blooms land within this distance of the arriving relay
      travelSeconds: 0.9, // pulse travel time across a bridge (also the chain step delay)
    },
    /** Reservoir Overflow: condensers in range fill a Reservoir Garden; when full it spills. */
    reservoir: {
      condenserRange: 2, // condenser footprint → garden footprint (Manhattan)
      fillPerCharge: 1, // garden fill per completed condenser charge
      threshold: 3,
      targets: 3, // dry tiles irrigated per Overflow
      radius: 2,
      lushSeconds: 25, // newly irrigated plants grow extra biomass for a while
      lushMult: 2,
      cisternWater: 1, // water/s from the Old Cistern once awake
    },
    /** Canopy: the Elder Tree charges from blooms around it and releases a Canopy Burst. */
    canopy: {
      chargeRadius: 3,
      threshold: 12,
      burstRadius: 2,
      burstRadiusAwake: 3,
      gardenBonusTargets: 2, // each Pollinator Garden inside the burst adds this many extra blooms beyond it
    },
    cores: {
      r2: { restoredTiles: 28, overflows: 1, cost: { water: 50, biomass: 140 } },
      r3: { restoredTiles: 36, bursts: 2, cost: { energy: 90, biomass: 220 } },
    },
    /** Manual pulse right next to a machine boosts its next trigger. */
    overchargeSeconds: 12,
    bloom: {
      seconds: 10, // presentation length (skippable)
      capBonus: 0.5, // permanent storage boost
      reward: { energy: 200, water: 120, biomass: 400 },
      biomassMult: 1.15, // neighbourhood-wide resonance afterwards
    },
  },
} as const;

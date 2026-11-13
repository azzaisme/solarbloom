// Every balance knob lives here. Prototype numbers: tune by playing.

export const TUNING = {
  simStep: 0.1, // seconds per deterministic simulation tick
  maxFrameDt: 0.25, // clamp for large frame gaps (tab switch, hitch)

  start: {
    resources: { energy: 20, water: 12, biomass: 0 },
    caps: { energy: 60, water: 40, biomass: 40 },
  },

  // Energy / water income that always exists, so the player can never softlock.
  starterSolarRate: 2, // energy/sec from the pre-placed panel
  rainBarrelRate: 0.15, // water/sec trickle from the rain barrel
  harvest: { energy: 8, cooldown: 8 },

  pulse: {
    polluted: { energy: 4, water: 1 },
    prepared: { energy: 2, water: 1 },
    growSeconds: 0.8,
  },

  restore: {
    instantBiomass: 2,
    biomassPerSec: 0.1, // per restored tile
    seep: 35, // pollution removed from orthogonal neighbours when a tile restores
    pollutionMin: 55,
    pollutionMax: 100,
  },

  chain: {
    stepDelay: 0.15,
    maxEvents: 32,
    maxDuration: 3,
    spreadPerStep: 2,
    milestones: [
      { combo: 3, biomass: 3 },
      { combo: 5, biomass: 5 },
      { combo: 10, biomass: 12 },
      { combo: 20, biomass: 20 },
    ],
  },

  solarBloomBoost: { mult: 2, seconds: 5 },

  condenser: { irrigateEvery: 5, irrigateWater: 2, radius: 1 },

  pollinator: { reach: 2, biomassMult: 2 },

  drone: {
    hubRadius: 3,
    cycleSeconds: 4,
    flySpeed: 3, // tiles/sec
    workSeconds: 0.5,
    retrySeconds: 1,
  },

  machineCostGrowth: 1.35, // each extra copy of a machine costs this much more

  cat: {
    firstMinTime: 180, // seconds of play
    firstMinRestored: 10,
    firstForceTime: 300,
    laterMin: 180,
    laterMax: 420,
    hiddenBonusCapSec: 180, // reward grows with hidden time up to this
    hiddenBonusMax: 0.5,
    harvestSeconds: 60,
    harvestMin: 15,
    frenzySeconds: 30,
    frenzyMult: 3,
    megaBloomTiles: 8,
    dronePartySeconds: 20,
  },

  core: {
    restoredTiles: 40,
    cost: { energy: 30, biomass: 30 },
    resonanceBiomassMult: 1.25,
    sequenceSeconds: 7,
  },

  autosaveSeconds: 10,
} as const;

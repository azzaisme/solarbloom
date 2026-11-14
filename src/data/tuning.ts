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
  harvest: { energy: 8, cooldown: 12 },

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
  condenser: { radius: 1, chargePerSec: 1, threshold: 6, targets: 2 },

  /** Pollinator Garden: a newly restored neighbour triggers a bonus restore/grow nearby. */
  pollinator: { reach: 1, biomassMult: 1.5, triggersPerChain: 4 },

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
    old: { enabled: true, radius: 6, cycleSeconds: 7, flySpeed: 1.5, workSeconds: 0.8 },
  },

  machineCostGrowth: 1.5, // each extra copy of a machine costs this much more

  cat: {
    firstMinTime: 180, // Phase 4 E08.1: first cat at about minute 3–4 (was 4–6), once the player knows the grid
    firstMinRestored: 10,
    firstForceTime: 240,
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
    weights: { luckyHarvest: 40, solarFrenzy: 25, megaBloom: 20, droneParty: 12, jackpot: 3, goldenRelay: 14, catsGarden: 14, fogWhisker: 18 },
    fogWhiskerTiles: 10, // Fog Whisker: tiles of the next fogged area restored from its edge, capped
    goldenRelayExtra: 1, // Golden Relay: extra remote blooms on the next crossing
    goldenCorridorTiles: 5, // Golden Relay in the city: extra blooms on the next green corridor hop…
    goldenCorridorMax: 12, // …+1 per 10 cleared areas, up to this
    preferVisible: 0.75, // chance a cat hides somewhere already on screen (when there is such a spot)
    catsGardenTiles: 6, // Cat's Garden: tiles restored (and decorated) on a random unlocked roof
  },

  core: {
    restoredTiles: 42,
    fullBloomTiles: 24,
    cost: { energy: 40, biomass: 100 }, // Phase 4 E01.1: fits the starting store with room to spare, since drones keep spending energy (was 60 ⚡ / 170 🌿)
    resonanceBiomassMult: 1.25,
    sequenceSeconds: 7,
  },

  autosaveSeconds: 10,

  /**
   * Phase 4 E01: progress while the game is closed (or a tab hidden for longer than catchUp.maxSeconds).
   * Only steady production and drone work, at a reduced rate, for a bounded time. Landmarks, cats, Frenzy,
   * chains, milestones and other one-time rewards never happen while away. Nothing is lost by staying away longer.
   */
  offline: {
    minSeconds: 60, // shorter absences earn nothing extra
    maxSeconds: 4 * 3600,
    rate: 0.5, // share of the sustained rate (no temporary boosts)
    maxDroneJobs: 300, // drone jobs credited per absence, across all drones
  },

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
} as const;

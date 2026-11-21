// E24 (#609): marking the way to the current goal, on the minimap and in the world. Starting values for tuning.

export const WAYMARK = {
  /** how often (s) the goal's place is looked up again (it asks the advisor, which scans tiles) */
  every: 0.5,
  /** the in-world light fades out once bloombot is this close (cells), and the map's pin sits under the chevron */
  near: 2.5,
  /** the map's pin keeps this far (CSS px) inside the disc's edge when the goal is off the map */
  rimInset: 13,
  /** and this much further in straight north or south, clear of the N badge and the clock on the rim */
  rimBadges: 10,
  /** the light in the world: a soft shaft of sunlight standing on the spot, with a glowing ring and drifting motes */
  beam: {
    /** height of the shaft (world units) */
    height: 7,
    /** its half width at the foot and at the top */
    footWidth: 0.55,
    topWidth: 0.85,
    /** the glowing ring on the ground: its radius */
    ring: 0.62,
    /** how bright it glows (kept under 2: the bloom pass multiplies glows of 1 and more) */
    glow: 1.5,
    /** a touch brighter at night, when it has to find its way through the dark */
    nightGlow: 1.8,
    /** its breathing: seconds per breath, and how far the brightness dips */
    breath: 3.2,
    breathDepth: 0.22,
    /** how long it takes to fade in or out (s) */
    fade: 0.6,
    /** motes drifting up the shaft: how many, and how long each takes to rise (s) */
    motes: 7,
    moteRise: 4.5,
  },
  /** #632: Show me where draws a trail of soft glowing dots on the ground, along a walkable way to the goal */
  trail: {
    /** the route counts as there once it reaches a cell this close to the goal (cells): the goal itself may be solid */
    reach: 2,
    /** a wide solid goal (a hall) counts as reached from its nearest open cell, looked for this far out (cells) */
    beside: 6,
    /** the route search gives up after looking at this many cells (then the trail goes as close as it got) */
    budget: 40000,
    /** gap between dots along the way (cells) */
    spacing: 0.55,
    /** a dot's bright core, the soft dark rim round it that makes it stand out on pale sand and paving by day, and
     * where that rim fades out (radius, cells). At night the rim fades away and the core's glow does the work. */
    dot: 0.21,
    rim: 0.32,
    halo: 0.46,
    /** dots further off grow, so the low camera still sees them: from this far (world units), by this much per unit,
     * up to this many times their size */
    nearDistance: 5,
    growth: 0.09,
    farScale: 2.6,
    /** how dark the rim is (0 black … 1 the trail's own colour) and how solid by day */
    rimShade: 0.08,
    rimAlpha: 0.9,
    /** how far above the ground the dots lie (world units) */
    lift: 0.05,
    /** how fast the trail runs out from bloombot (cells per second); a long way never takes longer than `drawMax` (s) */
    draw: 22,
    drawMax: 1.3,
    /** how long it stays (s), long enough to walk a good way of it, then how long it takes to fade (s) */
    life: 40,
    fade: 1.4,
    /** dots bloombot has walked past fade over this many cells */
    behind: 1.2,
    /** a gentle glow that runs along the trail towards the goal: speed (cells per second), length (cells), lift */
    run: 7,
    runLength: 3,
    runLift: 0.45,
    /** how bright (kept under 2: the bloom pass multiplies glows of 1 and more), and at night */
    glow: 1.9,
    nightGlow: 1.7,
    /** never more dots than this (a very long way keeps its first stretch, where bloombot is headed now) */
    max: 420,
  },
};

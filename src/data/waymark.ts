// E24 (#609): marking the way to the current goal, on the minimap and in the world. Starting values for tuning.

export const WAYMARK = {
  /** how often (s) the goal's place is looked up again (it asks the advisor, which scans tiles) */
  every: 0.5,
  /** the map's pin sits under the chevron once bloombot is this close (cells) */
  near: 2.5,
  /** the map's pin keeps this far (CSS px) inside the disc's edge when the goal is off the map */
  rimInset: 13,
  /** and this much further in straight north or south, clear of the N badge and the clock on the rim */
  rimBadges: 10,
  /** the light in the world: a tall mint shaft of light standing on the spot (a bright white core in a soft glow), a
   * gold ribbon winding up it from the emblem at its foot, and glowing leaves drifting up through it */
  beam: {
    /** height of the shaft (world units): tall enough to stand over the trees and the skyline from across the park */
    height: 26,
    /** the soft outer glow's half width at the foot and at the top */
    footWidth: 0.85,
    topWidth: 1.5,
    /** the bright core's half width at the foot and at the top */
    coreFoot: 0.13,
    coreTop: 0.24,
    /** the glowing ring on the ground: its radius */
    ring: 0.75,
    /** how bright it glows by day and at night (the bloom pass multiplies glows of 1 and more) */
    glow: 1.6,
    nightGlow: 1.9,
    /** its breathing: seconds per breath, and how far the brightness dips */
    breath: 3.2,
    breathDepth: 0.22,
    /** how long it takes to fade in or out (s) */
    fade: 0.6,
    /** the shaft fades out as bloombot walks in: whole from `far` cells, gone by `close` (the emblem stays) */
    far: 6,
    close: 3,
    /** the gold ribbon: turns, from the emblem up to this height, its width and how fast it turns (degrees/s) */
    ribbonTurns: 2.5,
    ribbonTop: 6.5,
    ribbonWidth: 0.09,
    ribbonSpin: 40,
    /** leaves drifting up the shaft: how many, how long each takes to rise (s) and how high they go */
    leaves: 9,
    leafRise: 5,
    leafTop: 9,
  },
  /** the emblem, the Solarbloom lotus: what the goal is for. Raised at the beam's foot from afar, sitting on the spot
   * once bloombot is there (sizes are its height to the centre petal's tip, near enough; world units) */
  emblem: {
    size: 0.6,
    /** where its base stands from afar, and once it has settled on the spot */
    lift: 0.12,
    sealLift: 0.03,
    sealSize: 0.8,
    /** its petals open from this share (a bud) as it fades in */
    closed: 0.35,
    /** how solid its painted gold body is by day, and at night (where the lotus is all light) */
    backing: 1,
    nightBacking: 0.25,
    /** how brightly the lotus glows by day, as a share of the night's (over its gold body, so it reads gold) */
    dayLight: 0.12,
  },
  /** the Bloom Pulse when the goal is done, then the soft glow it leaves behind */
  pulse: {
    /** counted done when the goal moves on while bloombot is this close (cells; a machine's middle can be 2 or 3 in) */
    reach: 4.5,
    /** the emblem draws in for `gather` s, then lets go */
    gather: 0.35,
    /** how far the petals snap open, and how long it takes them to settle back (s) */
    pop: 1.4,
    settle: 0.9,
    /** how bright it flashes, then glows softly afterwards */
    flash: 3.2,
    soft: 0.9,
    /** the ring of light racing out across the ground: how far (world units) and how fast (s) */
    wave: 5.5,
    waveTime: 1.0,
    /** how hard the grass and flowers lean as the ring passes */
    sway: 1,
    /** the soft glow stays this long (s), then sinks away over `fadeOut` s */
    linger: 30,
    fadeOut: 2,
    /** the next goal's beam waits this long after the pulse starts (s), so the two never compete */
    wait: 1.6,
  },
  /** #632: Show me where draws a trail of warm gold leaves on the ground, along a walkable way to the goal */
  trail: {
    /** the route counts as there once it reaches a cell this close to the goal (cells): the goal itself may be solid */
    reach: 2,
    /** a wide solid goal (a hall) counts as reached from its nearest open cell, looked for this far out (cells) */
    beside: 6,
    /** the route search gives up after looking at this many cells (then the trail goes as close as it got) */
    budget: 40000,
    /** gap between leaves along the way (cells) */
    spacing: 0.72,
    /** a leaf's bright core, the soft dark rim round it that makes it stand out on pale sand and paving by day, and
     * where that rim fades out (radius, cells). At night the rim fades away and the core's glow does the work. */
    dot: 0.19,
    rim: 0.245,
    halo: 0.30,
    /** leaves further off grow, so the low camera still sees them: from this far (world units), by this much per unit,
     * up to this many times their size */
    nearDistance: 5,
    growth: 0.09,
    farScale: 1.85,
    /** how dark the rim is (0 black … 1 the trail's own colour) and how solid by day */
    rimShade: 0.08,
    rimAlpha: 0.9,
    /** how far above the ground the leaves lie (world units) */
    lift: 0.05,
    /** how fast the trail runs out from bloombot (cells per second); a long way never takes longer than `drawMax` (s) */
    draw: 22,
    drawMax: 1.3,
    /** how long it stays (s), long enough to walk a good way of it, then how long it takes to fade (s) */
    life: 40,
    fade: 1.4,
    /** leaves bloombot has walked past fade over this many cells */
    behind: 1.2,
    /** a gentle glow that runs along the trail towards the goal: speed (cells per second), length (cells), lift */
    runLength: 3,
    runLift: 0.45,
    /** how bright (kept under 2: the bloom pass multiplies glows of 1 and more), and at night */
    glow: 1.9,
    nightGlow: 1.7,
    /** never more leaves than this (a very long way keeps its first stretch, where bloombot is headed now) */
    max: 420,
  },
};

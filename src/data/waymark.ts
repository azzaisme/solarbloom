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
};

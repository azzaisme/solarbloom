/**
 * #689 (E27.5): at the Great Bloom a flock flies in from both sides of the screen and makes a heart in the sky.
 * Times are seconds; sizes are shares of the screen (the heart is laid out on screen, so it reads from any angle).
 */
export const BIRD_HEART = {
  /** birds in the heart (even: one half from each side): enough for a solid outline; three small shared meshes each */
  birds: 36,
  /** after the bloom fires: its rings and fanfare go first, then the flock comes in */
  delay: 1.2,
  /** birds set off over this long, so they stream in rather than arrive in a line */
  stagger: 0.9,
  /** one bird's flight from the edge of the screen to its place in the heart */
  flyIn: 3.2,
  /** the heart holds this long: every bird stays in its place, bobbing gently and flapping slowly */
  hold: 3.2,
  /** the bob in place while it holds: how far (a share of the heart's height) and how often (a second) */
  bob: { size: 0.01, hz: 0.8 },
  /** breaking away: each bird sweeps out and up off screen over this long */
  breakAway: 2.4,
  /** reduced motion: no flight across the screen; the birds fade (grow) into place, hold gently and fade out */
  calm: { fadeIn: 0.6, hold: 2.4, fadeOut: 0.6 },
  /** wing beats a second: flying in and breaking away, then gliding in the heart */
  flap: { fly: 2.1, glide: 0.9 },
  /** the most a bird banks into a turn (degrees) */
  bank: 42,
  /**
   * where the heart sits: a third of the screen wide (at most this share of its height tall), centred, as high as it
   * goes clear of the HUD cards, the bloom message, the prompt and Bloombot (`gap` pixels clear); only if it must does
   * it move aside (up to `aside` of the screen's width: on the Deck at UI 150% the objective card is half the screen)
   * and then shrink
   */
  box: { width: 0.34, maxHeight: 0.56, top: 0.04, lowest: 0.8, gap: 14, aside: 0.22 },
  /** each bird's wingspan, as a share of the space between neighbours in the heart */
  span: 0.95,
  /** how strongly the gulls glow their own colour, so they stay pale against any sky */
  glow: 0.55,
  /** how far in front of the camera the flock flies (world units): past bloombot, short of most of the city */
  depth: 9,
} as const;

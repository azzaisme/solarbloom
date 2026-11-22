/**
 * #689 (E27.5): at the Great Bloom a flock flies in from both sides of the screen and makes a heart in the sky.
 * Times are seconds; sizes are shares of the screen (the heart is laid out on screen, so it reads from any angle).
 */
export const BIRD_HEART = {
  /** birds in the heart (even: one half from each side); each is three small meshes, so 26 is light on the Deck */
  birds: 26,
  /** after the bloom fires: its rings and fanfare go first, then the flock comes in */
  delay: 1.2,
  /** birds set off over this long, so they stream in rather than arrive in a line */
  stagger: 0.9,
  /** one bird's flight from the edge of the screen to its place in the heart */
  flyIn: 3.2,
  /** the heart holds this long, its birds gliding slowly round the outline */
  hold: 3.2,
  /** how far round the outline the birds glide while it holds (a share of the way round) */
  drift: 0.08,
  /** breaking away: each bird sweeps out and up off screen over this long */
  breakAway: 2.4,
  /** reduced motion: no flight across the screen; the birds fade (grow) into place, hold gently and fade out */
  calm: { fadeIn: 0.6, hold: 2.4, fadeOut: 0.6 },
  /** wing beats a second: flying in and breaking away, then gliding in the heart */
  flap: { fly: 2.1, glide: 0.9 },
  /** the most a bird banks into a turn (degrees) */
  bank: 42,
  /** where the heart sits: the top band of the screen, between the HUD cards (shares of the screen's height) */
  box: { top: 0.06, maxHeight: 0.3, maxWidth: 0.3, gap: 16 },
  /** each bird's wingspan, as a share of the space between neighbours in the heart */
  span: 0.95,
  /** how far in front of the camera the flock flies (world units): past bloombot, short of most of the city */
  depth: 9,
} as const;

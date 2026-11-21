import { defineConfig } from 'vitest/config';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * `npm test` runs this quick set: the smoke test (does the game work end to end?) plus the fast unit
 * files, in seconds. `npm run test:full` (`vitest run --mode full`) runs every test file, including the
 * long simulations (pacing bots, economy curves, soaks across areas), which take minutes.
 * A new test file joins the full suite automatically; add it here too if it is fast and core.
 */
const QUICK = [
  'smoke', 'advisor', 'grid', 'world', 'economy', 'placement', 'save-storage', 'save-v4', 'area-switches',
  'area-panel', 'upgrades-city', 'feedback-phase4', 'playtest-metrics',
  'relay-city', 'no-growing-prices', 'look', 'wall-edges', 'palette-lint', 'icons', 'hud-contrast', 'look3-budget', 'roads', 'drone-roles',
  'bloombot-walk', 'bindings', 'padFocus', 'deck', 'framing', 'interact', 'pause', 'bloombot-words', 'glow-setting', 'glyphs', 'rebind', 'save-slots', 'backpack', 'charge', 'pulse-load', 'rest', 'wildlife', 'seatbox', 'e23-models', 'farmland-art', 'keeper-seat', 'model-wait', 'visitor-models', 'visitor-sit-shape', 'bloombot-settle',
  // E21: the Old City
  'oldcity-data', 'oldcity-inventory', 'oldcity-salvage', 'oldcity-recipes', 'oldcity-map', 'oldcity-height', 'oldcity-island', 'oldcity-gates', 'oldcity-fountain', 'oldcity-panel', 'oldcity-models', 'oldcity-keepers', 'oldcity-bloombot-first',
  // E23: a living world
  'crafting', 'research', 'drone-fuel', 'automation',
  // E23.7: time, weather and salvage
  'clock', 'timers', 'photo-scene', 'weather',
  // E23.3: the power grid
  'power-grid', 'power-helpers', 'power-lights', 'moonlit-night',
  // E23.8: regions and the mainland
  'region-strengths', 'region-unlocks-e23',
  // E23.8.3: the mainland
  'mainland', 'island-release', 'mainland-steel',
  // E23.9: the story
  'journal', 'keepers-friends', 'keepers-arcs', 'keepers-tally', 'keepers-crops',
  // E23.4: the water network
  'water-levels', 'shoreline', 'fullscreen', 'water-fade', 'water-pipes', 'water-desal', 'water-overlay', 'water-reflect', 'water-night', 'pipe-visuals', 'pipe-visuals-west',
  // E23.5: the farm
  'farm-items', 'farm-planters', 'farm-compost', 'farm-extras',
  // E23.12: the Lucky Cat's rewards in the new loop (E23.1.4's one-meter check is tests/e2e/hud-one-meter.e2e.mjs)
  'lucky-cat-rewards', 'cat-decor', 'cat-secrecy', 'picker-internals', 'cat-sight-cpu', 'cat-sight-schedule',
  // E23.10: the proof
  'e23-gentle-failure', 'jetty-ropes',
  // E23 polish (#596): shaders warm behind the loading screen
  'shader-warmup',
  // E24: a clear path (the goal card, the guide's lines, the goal spot)
  'clear-path', 'goal-reachable', 'bloombot-levels', 'bloombot-page', 'park-growth', 'knacks', 'bloombot-new-upgrades', 'bloombot-parts', 'move-levels',
  'first-time-text',
  // the load wheel takes the arrow keys and the d-pad (the Deck)
  'load-wheel-arrows',
  // E24 (#609): the way marked on the map and in the world
  'waymark',
  // #632: Show me where's trail along a walkable way
  'trail',
  // #628: Bloombot acts out each Interact verb
  'bot-acts', 'bot-turn',
  // #631: Bloombot's colour is green
  'bot-green',
  // #635: the skyline fades into fog and stays behind the world
  'fog-skyline',
  // #662: toasts that come together each get read; nothing lands under a Keeper's bubble
  'toast-queue',
].map((name) => `tests/${name}.test.ts`);

export default defineConfig(({ mode }) => ({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  // Benchmarks (tests/perf/*.perf.ts) run separately with `npm run test:perf`.
  // The soak (tests/soak/*.soak.ts) runs with `npm run test:soak`.
  test: {
    include: env.SOAK ? ['tests/soak/**/*.soak.ts'] : env.PERF ? ['tests/perf/**/*.perf.ts'] : mode === 'full' ? ['tests/**/*.test.ts'] : QUICK,
    environment: 'node',
    // Look 5: tests read styles.css as text (tokens, contrast, no emoji); Vitest stubs CSS to '' otherwise.
    css: { include: [/styles\.css/] },
  },
}));

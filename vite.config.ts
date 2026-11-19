import { defineConfig } from 'vitest/config';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * `npm test` runs this quick set: the smoke test (does the game work end to end?) plus the fast unit
 * files, in seconds. `npm run test:full` (`vitest run --mode full`) runs every test file, including the
 * long simulations (pacing bots, economy curves, soaks across areas), which take minutes.
 * A new test file joins the full suite automatically; add it here too if it is fast and core.
 */
const QUICK = [
  'smoke', 'advisor', 'grid', 'big', 'world', 'economy', 'placement', 'save-storage', 'save-v4', 'area-switches',
  'area-panel', 'upgrades-city', 'feedback-phase4', 'playtest-metrics', 'canal-network', 'district-bloom',
  'rooftop-clusters', 'relay-city', 'no-growing-prices', 'look', 'palette-lint', 'icons', 'hud-contrast', 'look3-budget', 'roads', 'drone-roles',
  'bloombot-walk', 'bindings', 'deck', 'framing', 'interact', 'pause', 'bloombot-words', 'glyphs', 'rebind', 'save-slots', 'backpack', 'charge',
  // E21: the Old City
  'oldcity-data', 'oldcity-inventory', 'oldcity-salvage', 'oldcity-recipes', 'oldcity-map', 'oldcity-height', 'oldcity-island', 'oldcity-gates', 'oldcity-fountain', 'oldcity-models', 'oldcity-keepers', 'oldcity-bloombot-first',
  // E23.7: time, weather and salvage
  'clock', 'timers', 'photo-scene', 'weather',
  // E23.3: the power grid
  'power-grid', 'power-helpers', 'power-lights',
  // E23.8: regions and the mainland
  'region-strengths', 'region-unlocks-e23',
  // E23.8.3: the mainland
  'mainland',
  // E23.9: the story
  'journal',
  // E23.5: the farm
  'farm-items',
  // E23.10: the proof
  'e23-gentle-failure',
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

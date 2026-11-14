import { defineConfig } from 'vitest/config';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  // Benchmarks (tests/perf/*.perf.ts) run separately with `npm run test:perf`.
  // The soak (tests/soak/*.soak.ts) runs with `npm run test:soak`.
  test: { include: env.SOAK ? ['tests/soak/**/*.soak.ts'] : env.PERF ? ['tests/perf/**/*.perf.ts'] : ['tests/**/*.test.ts'], environment: 'node' },
});

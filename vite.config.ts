import { defineConfig } from 'vitest/config';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  // Benchmarks (tests/perf/*.perf.ts) run separately with `npm run test:perf`.
  test: { include: env.PERF ? ['tests/perf/**/*.perf.ts'] : ['tests/**/*.test.ts'], environment: 'node' },
});

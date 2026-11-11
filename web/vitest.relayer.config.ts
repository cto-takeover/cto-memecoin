import { defineConfig } from 'vitest/config';

// Layer 3 (spec 4): the relayer against a sandbox-deployed demo coin.
export default defineConfig({
  test: {
    include: ['test/relayer/**/*.test.ts'],
    globalSetup: ['test/relayer/sandbox-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

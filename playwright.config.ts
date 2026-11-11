// Spec 4, layer 6. `npm run test:e2e` runs against the deployed app and
// demo-cto.testnet (E2E_BASE_URL); `npm run test:e2e:local` starts a local
// sandbox + dev server first (e2e/local.mjs). Serial: the tests share one seat.
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) throw new Error('Set E2E_BASE_URL to the deployed app (or run npm run test:e2e:local).');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  outputDir: 'e2e/results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
  },
});

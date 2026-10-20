import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './pwa-e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  use: { serviceWorkers: 'allow', trace: 'retain-on-failure' },
  outputDir: './test-results/pwa-browser',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
})

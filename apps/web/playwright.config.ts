import { defineConfig, devices } from '@playwright/test'

/**
 * Lite E2E suite: happy paths across the app, slightly deeper coverage for the
 * core groups/expenses/balances flows.
 *
 * The API server is NOT managed here. Base E2E on plain-port http origins in
 * every environment — never on the portless https://*.spliit.localhost origins:
 * Chromium cannot trust the portless CA, portless assigns dynamic ports, and CI
 * has no portless proxy at all.
 *
 * Local recipe (DB must be up, e.g. via `bun dev:up`): bun --filter @spliit/api
 * start:e2e bun --filter @spliit/web test:e2e The start:e2e profile serves the
 * API on :3101 with the e2e origin allowed through CORS and better-auth trusted
 * origins. Override via E2E_API_URL / E2E_WEB_PORT when needed; a custom
 * E2E_WEB_PORT also needs a matching WEB_ORIGINS on the API side
 * (WEB_ORIGINS=http://localhost:<port> bun --filter @spliit/api start:e2e).
 * `global-setup.ts` fails fast with this recipe when the API is unreachable or
 * the origin is not allowed.
 */
const webPort = Number(process.env.E2E_WEB_PORT ?? 5173)

export const E2E_BASE_URL =
  process.env.E2E_BASE_URL ?? `http://localhost:${webPort}`
export const E2E_API_URL = process.env.E2E_API_URL ?? 'http://localhost:3101'

export default defineConfig({
  testDir: './e2e',

  // Auth-once setup first: a single anonymous guest state reused by every
  // journey spec (the API caps anonymous creation at 10/hour/IP).
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: './e2e/global-setup.ts',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Local dev servers (vite on-demand transform + a single API/MailDev) stall
  // when several browsers hammer them at once: parallel runs showed rotating
  // 5s-expect flakes and 2x wall time. Two workers keeps every test at a few
  // seconds each; CI keeps 50% with retries as backstop.
  workers: process.env.CI ? '50%' : 2,

  reporter: process.env.CI ? [['list'], ['github']] : [['list']],

  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: E2E_BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },

  // Ephemeral per-run failure evidence (screenshots, videos, traces,
  // error-context.md). Gitignored; consumed from CI artifacts, not the repo.
  outputDir: './test-results',

  webServer: {
    command: process.env.CI
      ? `bun run build && bunx vite preview --port ${webPort} --strictPort`
      : `bunx vite --port ${webPort} --strictPort`,
    url: E2E_BASE_URL,
    // Never reuse a running dev server: a stale bundle may be baked with a
    // different VITE_API_URL, failing every test behind the API-unreachable
    // UI. A port collision errors loudly instead (stop dev or set
    // E2E_WEB_PORT).
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_URL: E2E_API_URL,
    },
  },
})

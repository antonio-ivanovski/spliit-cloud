import type { FullConfig } from '@playwright/test'

import { E2E_API_URL, E2E_BASE_URL } from '../playwright.config'

const PROBE_TIMEOUT_MS = 10_000

/**
 * Fail-fast preflight: every e2e test signs up through the UI, so an
 * unreachable API (or an API whose CORS/trusted origins reject the e2e origin)
 * fails all tests with confusing action timeouts. Catch both cases here with
 * the fix attached.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  let health: Response
  try {
    health = await fetch(`${E2E_API_URL}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch {
    throw new Error(
      `[e2e] API not reachable at ${E2E_API_URL}. Start it first with ` +
        `bun --filter @spliit/api start:e2e (DB must be up), ` +
        `or point E2E_API_URL at the running API. ` +
        `Do not use the portless https://api.spliit.localhost origin, ` +
        `see playwright.config.ts.`,
    )
  }

  // Any HTTP response (even 503/500) proves reachability; the suite's own
  // assertions own behavior beyond that. What must hold is CORS: probe with
  // the e2e origin and require it to be reflected back.
  const probe = await fetch(`${E2E_API_URL}/health`, {
    headers: { Origin: E2E_BASE_URL },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  const allowed = probe.headers.get('access-control-allow-origin')
  if (allowed !== E2E_BASE_URL) {
    throw new Error(
      `[e2e] API at ${E2E_API_URL} does not allow origin ${E2E_BASE_URL} ` +
        `(Access-Control-Allow-Origin: ${allowed ?? 'missing'}, ` +
        `/health status: ${health.status}). The start:e2e profile allows ` +
        `this origin — restart the API with ` +
        `bun --filter @spliit/api start:e2e.`,
    )
  }
}

import { Context, Effect } from 'effect'

import { getApiBaseUrl } from '@/lib/api-url'
import {
  buildHealthUrl,
  HEALTH_TIMEOUT_MS,
  isJsonContentType,
  isValidHealthPayload,
  PROBE_BACKOFF_MS,
  type TransportState,
} from '@/lib/offline/connectivity'

import type { FetchTransport, FetchTransportError } from './platform'

export type ProbeOutcome =
  | { readonly outcome: 'reachable' }
  | { readonly outcome: 'unreachable' }
  | { readonly outcome: 'server-failure'; readonly status: number }
  | { readonly outcome: 'portal' }

export interface HealthProbe {
  /**
   * One liveness probe: GET health/liveness, no-store, 5s bound, JSON shape
   * validation. Maps every expected failure to a ProbeOutcome; caller
   * interruption (abort) propagates as interruption, never as an outcome.
   */
  readonly probeOnce: (options?: {
    readonly signal?: AbortSignal
  }) => Effect.Effect<ProbeOutcome>
}

export const HealthProbe = Context.Service<HealthProbe>('HealthProbe')

export interface HealthProbeDeps {
  readonly transport: FetchTransport
  readonly getBaseUrl?: () => string
  readonly timeoutMs?: number
}

/**
 * Recovery delay for probe attempt N (0-based): 5/15/30/60s with positive
 * jitter up to 20 percent. Pure: deterministic given the random draw.
 */
export function nextProbeDelayMs(attempt: number, random01: number): number {
  const fallback = PROBE_BACKOFF_MS[PROBE_BACKOFF_MS.length - 1] ?? 60_000
  const base =
    PROBE_BACKOFF_MS[
      Math.min(Math.max(attempt, 0), PROBE_BACKOFF_MS.length - 1)
    ] ?? fallback
  const jitter = Math.min(Math.max(random01, 0), 1) * 0.2 * base
  return base + jitter
}

/** Validate a fetched liveness response to a final outcome. */
export function toProbeOutcomeForResponse(args: {
  readonly status: number
  readonly contentType: string | null
  readonly payload: unknown
}): ProbeOutcome {
  if (args.status >= 500 && args.status <= 599) {
    return { outcome: 'server-failure', status: args.status }
  }
  // 429 proves the server is reachable; deferral is the sync
  // scheduler's job (Task 5), not the probe's.
  if (args.status === 429) return { outcome: 'reachable' }
  if (!isJsonContentType(args.contentType)) return { outcome: 'portal' }
  if (!isValidHealthPayload(args.payload)) return { outcome: 'portal' }
  return { outcome: 'reachable' }
}

/** TransportState projection of a probe outcome (connectivity.ts parity). */
export function transportForOutcome(outcome: ProbeOutcome): TransportState {
  return outcome.outcome === 'unreachable' ? 'unreachable' : 'reachable'
}

export function makeHealthProbe(deps: HealthProbeDeps): HealthProbe {
  const getBaseUrl = deps.getBaseUrl ?? getApiBaseUrl
  const timeoutMs = deps.timeoutMs ?? HEALTH_TIMEOUT_MS

  const probeOnce: HealthProbe['probeOnce'] = (options) =>
    Effect.gen(function* () {
      const url = buildHealthUrl(getBaseUrl())
      const fetched = yield* deps.transport
        .request(
          url,
          { cache: 'no-store' },
          { timeoutMs, signal: options?.signal },
        )
        .pipe(
          Effect.match({
            onFailure: (error: FetchTransportError) => ({
              ok: false as const,
              error,
            }),
            onSuccess: (response: Response) => ({
              ok: true as const,
              response,
            }),
          }),
        )
      if (!fetched.ok) {
        switch (fetched.error._tag) {
          case 'NetworkError':
          case 'TimeoutError':
            return { outcome: 'unreachable' } as const
          case 'HttpError':
            return {
              outcome: 'server-failure',
              status: fetched.error.status,
            } as const
          case 'RateLimitError':
            return { outcome: 'reachable' } as const
        }
      }
      const response = fetched.response
      const status = response.status
      if (status >= 500 && status <= 599) {
        return { outcome: 'server-failure', status } as ProbeOutcome
      }
      const contentType = response.headers.get('content-type')
      const payload = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (error: unknown) => error,
      }).pipe(
        Effect.match({
          onFailure: () => undefined as unknown,
          onSuccess: (value: unknown) => value,
        }),
      )
      return toProbeOutcomeForResponse({ status, contentType, payload })
    })

  return { probeOnce }
}

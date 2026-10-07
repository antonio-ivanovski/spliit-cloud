import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { NetworkError } from './errors'
import {
  makeHealthProbe,
  nextProbeDelayMs,
  toProbeOutcomeForResponse,
  transportForOutcome,
  type ProbeOutcome,
} from './health'
import type { FetchTransport } from './platform'

// Authoring gate (test-audit): this file owns the probe-outcome contract —
// one liveness probe maps every transport result to the same outcome the
// legacy store produced (portal rejection, 5xx vs offline split, 429 as
// reachable). Regression: HTML-portal accepted as reachable would clear
// outage UI behind a captive portal; 429 treated as unreachable would show
// offline during rate limiting. Pure-policy cases plus one Effect composition
// case through a stubbed production FetchTransport shape.

function stubTransport(request: FetchTransport['request']): FetchTransport {
  return { request }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('probe response validation', () => {
  it('accepts a valid liveness payload', () => {
    expect(
      toProbeOutcomeForResponse({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        payload: { status: 'ok' },
      }),
    ).toEqual({ outcome: 'reachable' })
  })

  it('rejects portals and invalid payloads', () => {
    const portal: ProbeOutcome = { outcome: 'portal' }
    expect(
      toProbeOutcomeForResponse({
        status: 200,
        contentType: 'text/html',
        payload: '<html></html>',
      }),
    ).toEqual(portal)
    expect(
      toProbeOutcomeForResponse({
        status: 200,
        contentType: 'application/json',
        payload: { status: 'degraded' },
      }),
    ).toEqual(portal)
    expect(
      toProbeOutcomeForResponse({
        status: 200,
        contentType: null,
        payload: null,
      }),
    ).toEqual(portal)
  })

  it('keeps server answers distinct from offline', () => {
    expect(
      toProbeOutcomeForResponse({
        status: 503,
        contentType: 'application/json',
        payload: { status: 'ok' },
      }),
    ).toEqual({ outcome: 'server-failure', status: 503 })
    expect(
      toProbeOutcomeForResponse({
        status: 429,
        contentType: 'application/json',
        payload: { status: 'ok' },
      }),
    ).toEqual({ outcome: 'reachable' })
    expect(transportForOutcome({ outcome: 'unreachable' })).toBe('unreachable')
    expect(transportForOutcome({ outcome: 'reachable' })).toBe('reachable')
    expect(transportForOutcome({ outcome: 'portal' })).toBe('reachable')
  })
})

describe('probe backoff delays', () => {
  it('steps 5/15/30/60s with positive jitter up to 20 percent', () => {
    expect(nextProbeDelayMs(0, 0)).toBe(5000)
    expect(nextProbeDelayMs(0, 1)).toBe(6000)
    expect(nextProbeDelayMs(1, 0)).toBe(15000)
    expect(nextProbeDelayMs(1, 1)).toBe(18000)
    expect(nextProbeDelayMs(2, 0)).toBe(30000)
    expect(nextProbeDelayMs(3, 0)).toBe(60000)
    expect(nextProbeDelayMs(99, 1)).toBe(72000)
    expect(nextProbeDelayMs(-5, 0)).toBe(5000)
  })
})

describe('probeOnce composition', () => {
  it('maps transport results to outcomes through the Effect chain', async () => {
    const reachable = makeHealthProbe({
      transport: stubTransport(() =>
        Effect.succeed(jsonResponse({ status: 'ok' })),
      ),
      getBaseUrl: () => 'https://api.example',
    })
    expect(await Effect.runPromise(reachable.probeOnce())).toEqual({
      outcome: 'reachable',
    })

    const failing = makeHealthProbe({
      transport: stubTransport(() =>
        Effect.fail(new NetworkError({ reason: 'fetch-failed' })),
      ),
      getBaseUrl: () => 'https://api.example',
    })
    expect(await Effect.runPromise(failing.probeOnce())).toEqual({
      outcome: 'unreachable',
    })

    const portal = makeHealthProbe({
      transport: stubTransport(() =>
        Effect.succeed(
          new Response('<html>captive</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
        ),
      ),
      getBaseUrl: () => 'https://api.example',
    })
    expect(await Effect.runPromise(portal.probeOnce())).toEqual({
      outcome: 'portal',
    })
  })
})

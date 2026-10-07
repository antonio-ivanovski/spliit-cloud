import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  applyVerdictToScope,
  makeSessionService,
  probeResultToVerdict,
  type SessionProbeResult,
  type SessionScope,
} from './session'

// Authoring gate (test-audit): this file owns the session-verify verdict
// contract — successful null revokes, every failure shape preserves the
// offline identity. Regression: a failed/timeout check revoking identity
// would sign users out on a network blip. No existing test covers the Effect
// verify composition, and the boundary seam is the production
// SessionServiceDeps injection (the sanctioned Layer substitution point).

const ACCOUNT = { id: 'account-1' }

function serviceWith(
  fetchSession: (signal: AbortSignal) => Promise<SessionProbeResult>,
  timeoutMs = 1000,
) {
  return makeSessionService({ fetchSession, timeoutMs })
}

const SCOPE: SessionScope = {
  namespace: 'namespace-1',
  generation: 3,
  accountId: ACCOUNT.id,
  status: 'active',
}

describe('session verify verdicts', () => {
  it('verifies a present session with its account', async () => {
    const service = serviceWith(async () => ({ account: ACCOUNT }))
    const result = await Effect.runPromise(service.verify())
    expect(result).toEqual({ verdict: 'verified', account: ACCOUNT })
  })

  it('revokes identity on a successful null session', async () => {
    const service = serviceWith(async () => ({ account: null }))
    const result = await Effect.runPromise(service.verify())
    expect(result).toEqual({ verdict: 'signed-out', account: null })
  })

  it('preserves identity on network failure', async () => {
    const service = serviceWith(async () => {
      throw new TypeError('Failed to fetch')
    })
    const result = await Effect.runPromise(service.verify())
    expect(result.verdict).toBe('preserved-unavailable')
    expect(result.account).toBeNull()
  })

  it('preserves identity on non-network SDK failures and explicit failure results', async () => {
    const failing = serviceWith(async () => {
      throw new Error('sdk exploded')
    })
    expect((await Effect.runPromise(failing.verify())).verdict).toBe(
      'preserved-unavailable',
    )

    const flagged = serviceWith(async () => ({
      failed: true as const,
      network: true,
    }))
    expect((await Effect.runPromise(flagged.verify())).verdict).toBe(
      'preserved-unavailable',
    )
  })

  it('preserves identity when verification times out', async () => {
    const service = serviceWith(
      () => new Promise<SessionProbeResult>(() => {}),
      15,
    )
    const result = await Effect.runPromise(service.verify())
    expect(result.verdict).toBe('preserved-unavailable')
  })

  it('treats a caller abort as interruption, never a verdict', async () => {
    const service = serviceWith(() => new Promise<SessionProbeResult>(() => {}))
    const exit = await Effect.runPromiseExit(
      service.verify({ signal: AbortSignal.abort() }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true)
    }
  })
})

describe('verdict scope transitions', () => {
  it('keeps the scope on verified and preserved verdicts', () => {
    expect(probeResultToVerdict({ account: ACCOUNT })).toEqual({
      verdict: 'verified',
      account: ACCOUNT,
    })
    expect(applyVerdictToScope(SCOPE, 'verified', ACCOUNT)).toBe(SCOPE)
    expect(applyVerdictToScope(SCOPE, 'preserved-unavailable', null)).toBe(
      SCOPE,
    )
  })

  it('revokes the scope immutably on signed-out', () => {
    const next = applyVerdictToScope(SCOPE, 'signed-out', null)
    expect(next).toEqual({ ...SCOPE, status: 'revoked' })
    expect(SCOPE.status).toBe('active')
    expect(applyVerdictToScope(null, 'signed-out', null)).toBeNull()
  })
})

import { Context, Effect } from 'effect'

import { isNetworkError } from '@/lib/network-error'
import { SESSION_VERIFY_TIMEOUT_MS } from '@/lib/offline/lifecycle'

import { SessionRejectedError } from './errors'

/**
 * Session orchestration primitive (Task 1 foundation; provider wiring is Task
 * 2, transport/auth integration is Task 3).
 *
 * VerifySession wraps one injected SDK boundary (fetchSession) and composes it
 * into a SessionVerdict Effect: a successful null revokes the read identity,
 * while failed / timed-out / 5xx checks preserve the offline identity. The
 * boundary normalizes unknown SDK failures exactly once; upper layers match the
 * verdict and never re-inspect the raw failure.
 */

export type SessionProbeAccount = {
  readonly id: string
}

export type SessionProbeResult =
  | { readonly account: SessionProbeAccount | null; readonly status?: number }
  | {
      readonly failed: true
      readonly network: boolean
      readonly status?: number
    }

export type SessionVerdict = 'verified' | 'signed-out' | 'preserved-unavailable'

export type SessionVerification = {
  readonly verdict: SessionVerdict
  readonly account: SessionProbeAccount | null
}

export type SessionScope = {
  readonly namespace: string
  readonly generation: number
  readonly accountId: string
  readonly status: 'active' | 'revoked'
}

export interface SessionService {
  /**
   * Verify the current session. Never fails with a typed error: every expected
   * failure maps to preserved-unavailable. Interruption propagates.
   */
  readonly verify: (options?: {
    readonly signal?: AbortSignal
  }) => Effect.Effect<SessionVerification>
  /** Pure scope transition for a verdict (ownership moves to Task 2). */
  readonly transition: (
    scope: SessionScope | null,
    verdict: SessionVerdict,
    account: SessionProbeAccount | null,
  ) => SessionScope | null
}

export const SessionService = Context.Service<SessionService>('SessionService')

export interface SessionServiceDeps {
  /**
   * Third-party SDK boundary (better-auth getSession in Task 3). Exactly-once
   * normalization happens here: network failure and 5xx are flagged, every
   * other failure shape is a generic failure that preserves identity.
   */
  readonly fetchSession: (signal: AbortSignal) => Promise<SessionProbeResult>
  readonly timeoutMs?: number
}

export function probeResultToVerdict(result: SessionProbeResult): {
  verdict: SessionVerdict
  account: SessionProbeAccount | null
} {
  if ('failed' in result)
    return { verdict: 'preserved-unavailable', account: null }
  if (result.account === null) return { verdict: 'signed-out', account: null }
  return { verdict: 'verified', account: result.account }
}

export function applyVerdictToScope(
  scope: SessionScope | null,
  verdict: SessionVerdict,
  // New-account scope activation (namespace/generation binding) is Task 2;
  // verified preserves the existing scope until the supervisor owns it.
  _account: SessionProbeAccount | null,
): SessionScope | null {
  switch (verdict) {
    case 'verified':
      return scope
    case 'signed-out':
      return scope === null ? null : { ...scope, status: 'revoked' }
    case 'preserved-unavailable':
      return scope
  }
}

export function sessionRejectedFromStatus(
  status: number | undefined,
): SessionRejectedError | null {
  if (status === 401 || status === 403) {
    return new SessionRejectedError({ status })
  }
  return null
}

export function makeSessionService(deps: SessionServiceDeps): SessionService {
  const timeoutMs = deps.timeoutMs ?? SESSION_VERIFY_TIMEOUT_MS

  const verify: SessionService['verify'] = (options) => {
    const externalSignal = options?.signal
    if (externalSignal?.aborted) return Effect.interrupt
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    externalSignal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = Effect.sync(() => {
      externalSignal?.removeEventListener('abort', onAbort)
    })
    const inner = Effect.gen(function* () {
      const probed: SessionProbeResult = yield* Effect.tryPromise({
        try: () => deps.fetchSession(controller.signal),
        catch: (error: unknown) => error,
      }).pipe(
        Effect.match({
          onFailure: (error: unknown): SessionProbeResult => ({
            failed: true as const,
            network: isNetworkError(error),
          }),
          onSuccess: (result: SessionProbeResult): SessionProbeResult => result,
        }),
        Effect.timeoutOption(timeoutMs),
        Effect.map((option) =>
          option._tag === 'Some'
            ? option.value
            : ({ failed: true as const, network: false } as SessionProbeResult),
        ),
      )
      const { verdict, account } = probeResultToVerdict(probed)
      return { verdict, account } as SessionVerification
    })
    return Effect.ensuring(inner, cleanup)
  }

  return { verify, transition: applyVerdictToScope }
}

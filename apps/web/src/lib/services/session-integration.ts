import { Layer } from 'effect'

import { getApiBaseUrl } from '@/lib/api-url'
import { authClient, type AuthAccount } from '@/lib/auth'
import { clearLastAccount, readLastAccount } from '@/lib/last-account'
import { isNetworkError } from '@/lib/network-error'
import { buildNamespace } from '@/lib/offline/contract'
import {
  hasRevokedMarker,
  newEventUuid,
  writeRevokedMarkerSync,
} from '@/lib/offline/lifecycle'
import { SESSION_VERIFY_TIMEOUT_MS } from '@/lib/offline/lifecycle'

import {
  makeSessionService,
  SessionService,
  type SessionProbeAccount,
  type SessionProbeResult,
} from './session'

/**
 * Network/session SDK boundary (Task 3).
 *
 * The single better-auth wiring point: getSession responses become
 * SessionProbeResults with exactly-once normalization (network vs status vs
 * abort), consumed by SessionService.verify (8s bound). Verification and
 * liveness probes bypass the mutation admission guard by construction — this
 * module never imports it.
 *
 * Last-account restore/revocation preserves the lifecycle contract: restore
 * only from matching metadata with no revocation marker; a successful null
 * revokes; failed/timeout/5xx checks preserve the offline identity (see
 * session.ts verdicts). The revocation marker write stays synchronous before
 * async cleanup; an unwritable marker reports false so callers keep the
 * generation fenced instead of treating it as cleared.
 */

export type BetterAuthSessionData = {
  user?: unknown
} | null

export type BetterAuthSessionError = {
  status?: unknown
  statusCode?: unknown
  data?: { httpStatus?: unknown }
} | null

export type GetSessionFn = (args: {
  query: { disableCookieCache: boolean }
  fetchOptions: { signal: AbortSignal }
}) => Promise<{ data: unknown; error: unknown }>

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as {
    status?: unknown
    statusCode?: unknown
    data?: { httpStatus?: unknown; code?: unknown }
  }
  const candidates = [record.status, record.statusCode, record.data?.httpStatus]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
      return candidate
    }
  }
  return undefined
}

/**
 * Map one getSession callback result to a probe result. Successful null revokes
 * the read identity; thrown/failed checks preserve it. Caller aborts are not
 * normalized here — the service propagates them as interruption.
 */
export function toSessionProbeResult(
  data: BetterAuthSessionData,
  error: unknown,
): SessionProbeResult {
  if (data?.user && typeof data.user === 'object') {
    return { account: data.user as SessionProbeAccount }
  }
  if (data === null && (error === null || error === undefined)) {
    return { account: null }
  }
  if (error !== null && error !== undefined) {
    return {
      failed: true as const,
      network: isNetworkError(error),
      status: extractStatus(error),
    }
  }
  return { failed: true as const, network: false }
}

/**
 * Production SDK boundary for SessionService: credentialed, uncached getSession
 * with the caller's signal. Late outcomes after abort reject with AbortError so
 * the service (and supervisor fencing) never treats them as verdicts.
 */
export function makeBetterAuthFetchSession(
  getSession: GetSessionFn = (args) =>
    authClient.getSession(args) as Promise<{
      data: unknown
      error: unknown
    }>,
): (signal: AbortSignal) => Promise<SessionProbeResult> {
  return async (signal) => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const result = await getSession({
        query: { disableCookieCache: true },
        fetchOptions: { signal },
      })
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      return toSessionProbeResult(
        result.data as BetterAuthSessionData,
        result.error as unknown,
      )
    } catch (error) {
      if (signal.aborted) throw error
      if (error && typeof error === 'object' && 'failed' in error) {
        return error as SessionProbeResult
      }
      return toSessionProbeResult(null, error)
    }
  }
}

export function makeSessionServiceLive(deps?: {
  readonly fetchSession?: (signal: AbortSignal) => Promise<SessionProbeResult>
  readonly timeoutMs?: number
}): Layer.Layer<SessionService> {
  return Layer.succeed(
    SessionService,
    makeSessionService({
      fetchSession: deps?.fetchSession ?? makeBetterAuthFetchSession(),
      timeoutMs: deps?.timeoutMs ?? SESSION_VERIFY_TIMEOUT_MS,
    }),
  )
}

export const SessionServiceLive = makeSessionServiceLive()

export interface RestorableIdentity {
  readonly account: AuthAccount
  readonly namespace: string
}

/**
 * Restore the cached offline identity only when its namespace carries no
 * revocation marker. Never scans other namespaces to choose an identity.
 */
export function readRestorableAccount(): RestorableIdentity | null {
  let cached: AuthAccount | null = null
  try {
    cached = readLastAccount()
  } catch {
    return null
  }
  if (!cached) return null
  let namespace: string
  try {
    namespace = buildNamespace(getApiBaseUrl(), cached.id)
  } catch {
    return null
  }
  try {
    if (hasRevokedMarker(namespace)) return null
  } catch {
    return null
  }
  return { account: cached, namespace }
}

/**
 * Synchronously fence a namespace and drop the cached identity. Returns false
 * when the marker could not be written — callers must keep the generation
 * fenced and surface the failure, never treat it as cleared.
 */
export function revokeIdentitySync(
  namespace: string,
  storage?: Storage | null,
): boolean {
  let marked = false
  try {
    marked = writeRevokedMarkerSync(namespace, newEventUuid(), storage)
  } catch {
    marked = false
  }
  try {
    clearLastAccount()
  } catch {
    // Marker + generation fencing remain authoritative.
  }
  return marked
}

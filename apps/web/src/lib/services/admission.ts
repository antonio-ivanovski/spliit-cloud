import { Effect } from 'effect'

import {
  OfflineWriteError,
  type WriteGuardTransport,
} from '@/lib/offline/write-guard'

/**
 * Mutation admission (Task 3): the single known-offline policy owner.
 *
 * Known-offline mutations reject BEFORE optimism, navigation, form reset, or
 * analytics — the write-guard MutationCache.onMutate and tRPC link keep their
 * positions and delegate their policy check here, so there is one owner and no
 * doubled guard. Probes and session verification bypass by construction (they
 * never consult this module).
 *
 * Unknown transport fails open: normal online startup mutations are never
 * blocked before the first probe. There is no automatic retry, replay, or
 * restoration of remote mutations — a rejected mutation stays rejected and
 * surfaces the single reconnect explanation.
 */

export type AdmissionVerdict = 'admitted' | 'blocked-offline'

export interface AdmissionInput {
  readonly transport: WriteGuardTransport
  readonly navigatorOnline: boolean
}

/**
 * Known-offline: explicit unreachable OR the browser reporting offline. Parity
 * with the legacy write-guard rule; this function is now its owner.
 */
export function checkAdmission(input: AdmissionInput): AdmissionVerdict {
  if (input.transport === 'unreachable') return 'blocked-offline'
  if (input.navigatorOnline === false) return 'blocked-offline'
  return 'admitted'
}

/** Effect form: fail with the existing OfflineWriteError when blocked. */
export function admitMutationEffect(
  input: AdmissionInput,
): Effect.Effect<void, OfflineWriteError> {
  return checkAdmission(input) === 'admitted'
    ? Effect.void
    : Effect.fail(new OfflineWriteError())
}

export const IDEMPOTENCY_HEADER = 'x-request-id'

function randomRequestId(): string {
  try {
    const generator = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
    if (generator) return generator()
  } catch {
    // Fall through to the Math.random fallback.
  }
  return (
    'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  )
}

/**
 * Stable request ID for one logical idempotent create: reuse the caller ID
 * across retries of the same operation; generate once when absent. The server
 * dedupes on this header, so a retried create keeps its identity instead of
 * double-posting.
 */
export function ensureRequestId(input: {
  readonly requestId?: string
  readonly newId?: () => string
}): string {
  if (input.requestId) return input.requestId
  try {
    return input.newId?.() ?? randomRequestId()
  } catch {
    return randomRequestId()
  }
}

/** Attach the stable ID unless the caller already set one. */
export function withIdempotencyHeader(
  init: RequestInit | undefined,
  requestId: string,
): RequestInit {
  const headers = new Headers(init?.headers)
  if (!headers.has(IDEMPOTENCY_HEADER))
    headers.set(IDEMPOTENCY_HEADER, requestId)
  return { ...init, headers }
}

export type MutationOutcome = 'committed' | 'blocked-offline' | 'ambiguous'

/**
 * Classify a mutation attempt explicitly. Ambiguous (sent, response never read
 * — timeout after send, unreadable body) means the server may or may not have
 * applied it: surface unknown, never auto-retry. Admitted-but-never sent never
 * reached the server, so it stays blocked, not ambiguous.
 */
export function classifyMutationOutcome(args: {
  readonly admitted: boolean
  readonly sent: boolean
  readonly responseReadable: boolean
}): MutationOutcome {
  if (!args.admitted) return 'blocked-offline'
  if (args.sent && args.responseReadable) return 'committed'
  if (args.sent) return 'ambiguous'
  return 'blocked-offline'
}

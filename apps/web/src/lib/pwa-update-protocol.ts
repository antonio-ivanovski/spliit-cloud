/**
 * Versioned coordination protocol for PWA update activation.
 *
 * A waiting worker activates only after every remaining window client confirms
 * it is safe (prepare round), re-confirms immediately before activation
 * (confirm round), and the client set is unchanged (re-enumeration). One
 * attempt at a time per worker; every message carries the protocol version and
 * the attempt ID so stale or legacy messages can never authorize an unrelated
 * worker.
 *
 * This module is worker-safe: types, constants, and pure validation only (no
 * DOM access at import time). It is shared by the page manager and `sw.ts`.
 */

export const PWA_UPDATE_PROTOCOL_VERSION = 1

/** Timeout per worker response round (prepare / confirm). */
export const PWA_UPDATE_ROUND_TIMEOUT_MS = 2000

/** Client-side budget for a full coordinated attempt (both rounds + margin). */
export const PWA_UPDATE_REQUEST_TIMEOUT_MS = 8000

/** How long a recorded final confirmation authorizes its reload. */
export const PWA_UPDATE_AUTH_EXPIRY_MS = 30_000

/** Page → waiting worker: run one coordinated activation attempt. */
export const REQUEST_COORDINATED_ACTIVATION = 'REQUEST_COORDINATED_ACTIVATION'

/** Waiting worker → page: final attempt outcome (replies on the request port). */
export const COORDINATION_RESULT = 'COORDINATION_RESULT'

/** Waiting worker → every window client: report safety for this attempt. */
export const COORDINATION_PREPARE = 'COORDINATION_PREPARE'

/** Page → waiting worker: prepare-round safety report. */
export const COORDINATION_PREPARE_RESPONSE = 'COORDINATION_PREPARE_RESPONSE'

/** Waiting worker → prepared clients: recheck and record reload authorization. */
export const COORDINATION_CONFIRM = 'COORDINATION_CONFIRM'

/** Page → waiting worker: confirm-round verdict. */
export const COORDINATION_CONFIRM_RESPONSE = 'COORDINATION_CONFIRM_RESPONSE'

/** Waiting worker → contacted clients: the attempt aborted, drop authorization. */
export const COORDINATION_ABORTED = 'COORDINATION_ABORTED'

export type CoordinationResultReason =
  | 'peer-blocked'
  | 'peer-missing'
  | 'new-client'
  | 'requester-gone'
  | 'busy'
  | 'activation-failed'

export type CoordinationResult =
  | { activated: true }
  | {
      activated: false
      reason: CoordinationResultReason
      clientCount: number
    }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asAttemptId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Validates an inbound waiting-worker → page protocol message header. */
export function asProtocolMessage(
  data: unknown,
): { type: string; attemptId: string } | null {
  if (!isRecord(data)) return null
  if (data.protocol !== PWA_UPDATE_PROTOCOL_VERSION) return null
  if (typeof data.type !== 'string') return null
  const attemptId = asAttemptId(data.attemptId)
  if (!attemptId) return null
  return { type: data.type, attemptId }
}

/** Validates an inbound COORDINATION_RESULT on the request port. */
export function asCoordinationResult(data: unknown): CoordinationResult | null {
  if (!isRecord(data)) return null
  if (
    data.type !== COORDINATION_RESULT ||
    data.protocol !== PWA_UPDATE_PROTOCOL_VERSION
  )
    return null
  if (data.activated === true) return { activated: true }
  if (data.activated !== false) return null
  const reason = data.reason
  if (
    reason !== 'peer-blocked' &&
    reason !== 'peer-missing' &&
    reason !== 'new-client' &&
    reason !== 'requester-gone' &&
    reason !== 'busy' &&
    reason !== 'activation-failed'
  )
    return null
  const clientCount = data.clientCount
  if (
    typeof clientCount !== 'number' ||
    !Number.isSafeInteger(clientCount) ||
    clientCount < 0
  )
    return null
  return { activated: false, reason, clientCount }
}

/** Validates an inbound round response (prepare / confirm) worker-side. */
export function asRoundResponse(
  data: unknown,
  attemptId: string,
  validStatuses: readonly string[],
): string | null {
  if (!isRecord(data)) return null
  if (data.protocol !== PWA_UPDATE_PROTOCOL_VERSION) return null
  if (data.attemptId !== attemptId) return null
  if (typeof data.status !== 'string') return null
  if (!validStatuses.includes(data.status)) return null
  return data.status
}

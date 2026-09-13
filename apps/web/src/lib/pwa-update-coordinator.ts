/**
 * Waiting-worker side of the coordinated activation protocol.
 *
 * `runCoordinatedActivation` runs one attempt: enumerate window clients,
 * prepare round (every client reports clean), confirm round (every client
 * rechecks and records its own reload authorization), re-enumeration (abort on
 * new arrivals, drop closed clients), then `skipWaiting()`. Any
 * missing/incompatible/unready response aborts — clean is never inferred from
 * silence. Aborts broadcast `COORDINATION_ABORTED` to every contacted client so
 * any recorded authorizations are dropped.
 *
 * Transport is deliberately port-less worker → client (plain `postMessage`
 * broadcasts): clients answer by posting directly to the sending worker, so no
 * `Client.postMessage` transfer support is required. Only the initial page →
 * worker request carries a transfer port (the long-supported pattern for the
 * FINAL verdict).
 *
 * Worker-safe (no DOM). The single-attempt lock lives here as module state
 * because a worker is a singleton; `sw.ts` owns the message wiring.
 */

import {
  COORDINATION_ABORTED,
  COORDINATION_CONFIRM,
  COORDINATION_PREPARE,
  PWA_UPDATE_PROTOCOL_VERSION,
  PWA_UPDATE_ROUND_TIMEOUT_MS,
  asRoundResponse,
  type CoordinationResult,
  type CoordinationResultReason,
} from './pwa-update-protocol'

export type CoordinatorClient = {
  id: string
  postMessage: (message: unknown) => void
}

export type CoordinatorInboundEvent = {
  sourceId?: string
  data: unknown
}

export type CoordinatorHooks = {
  matchAllWindows: () => Promise<CoordinatorClient[]>
  skipWaiting: () => Promise<unknown>
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  subscribeMessages: (
    handler: (event: CoordinatorInboundEvent) => void,
  ) => () => void
}

let activeAttemptId: string | null = null

/** Single-attempt lock. Returns false when another attempt is in flight. */
export function coordinatorBeginAttempt(attemptId: string): boolean {
  if (activeAttemptId !== null) return false
  activeAttemptId = attemptId
  return true
}

export function coordinatorEndAttempt(attemptId: string): void {
  if (activeAttemptId === attemptId) activeAttemptId = null
}

/** Test-only reset for the module-level attempt lock. */
export function resetCoordinatorForTests(): void {
  activeAttemptId = null
}

/**
 * Broadcasts a round message and collects one verdict per client. Each round
 * owns its inbox and subscription: only reports for this attempt land in it,
 * and the latest report per client supersedes older ones. Resolves with the
 * inbox when every client answered or the round times out; anything unparsable
 * counts as missing at evaluation time.
 */
async function collectRound(
  hooks: CoordinatorHooks,
  clients: CoordinatorClient[],
  message: Record<string, unknown>,
  attemptId: string,
  timeoutMs: number,
): Promise<Map<string, unknown>> {
  const inbox = new Map<string, unknown>()
  const finished = new Set<string>()
  clients.forEach((client) => {
    try {
      client.postMessage(message)
    } catch {
      // The client is gone; treat it as missing without waiting it out.
      finished.add(client.id)
    }
  })
  let timer: unknown
  let finish!: () => void
  const unsubscribe = hooks.subscribeMessages((event) => {
    if (typeof event.sourceId !== 'string') return
    const data = event.data
    if (
      typeof data !== 'object' ||
      data === null ||
      (data as Record<string, unknown>).protocol !==
        PWA_UPDATE_PROTOCOL_VERSION ||
      (data as Record<string, unknown>).attemptId !== attemptId
    )
      return
    inbox.set(event.sourceId, data)
    finished.add(event.sourceId)
    if (clients.every((client) => finished.has(client.id))) finish()
  })
  await new Promise<void>((resolve) => {
    finish = () => {
      hooks.clearTimeout(timer)
      resolve()
    }
    timer = hooks.setTimeout(finish, timeoutMs)
    if (clients.every((client) => finished.has(client.id))) finish()
  })
  unsubscribe()
  return inbox
}

function broadcastAborted(
  clients: CoordinatorClient[],
  attemptId: string,
): void {
  const message = {
    type: COORDINATION_ABORTED,
    protocol: PWA_UPDATE_PROTOCOL_VERSION,
    attemptId,
  }
  clients.forEach((client) => {
    try {
      client.postMessage(message)
    } catch {
      // The client is gone; nothing to clear.
    }
  })
}

export async function runCoordinatedActivation(
  hooks: CoordinatorHooks,
  options: {
    attemptId: string
    workerToken: string
    requesterId?: string
    timeoutMs?: number
  },
): Promise<CoordinationResult> {
  const { attemptId, workerToken } = options
  const timeoutMs = options.timeoutMs ?? PWA_UPDATE_ROUND_TIMEOUT_MS
  const abort = (
    contactedClients: CoordinatorClient[],
    reason: CoordinationResultReason,
    clientCount: number,
  ): CoordinationResult => {
    broadcastAborted(contactedClients, attemptId)
    return { activated: false, reason, clientCount }
  }

  let clients: CoordinatorClient[]
  try {
    clients = await hooks.matchAllWindows()
  } catch {
    // Preparation failure aborts quietly: no watchdog, no activation.
    return { activated: false, reason: 'activation-failed', clientCount: 0 }
  }
  if (
    options.requesterId &&
    !clients.some((client) => client.id === options.requesterId)
  ) {
    return {
      activated: false,
      reason: 'requester-gone',
      clientCount: clients.length,
    }
  }
  if (clients.length === 0) {
    // Nobody left to protect: activate directly.
    try {
      await hooks.skipWaiting()
    } catch {
      return { activated: false, reason: 'activation-failed', clientCount: 0 }
    }
    return { activated: true }
  }

  // Prepare round: every client must report clean. Anything else — a dirty
  // or unready report, a timeout, garbage, or a legacy client that never
  // answers — aborts the attempt.
  const prepareInbox = await collectRound(
    hooks,
    clients,
    {
      type: COORDINATION_PREPARE,
      protocol: PWA_UPDATE_PROTOCOL_VERSION,
      attemptId,
      workerToken,
    },
    attemptId,
    timeoutMs,
  )
  const prepareStatus = (client: CoordinatorClient) =>
    asRoundResponse(prepareInbox.get(client.id), attemptId, [
      'clean',
      'blocked',
      'not-ready',
    ])
  const prepareMissing = clients.filter(
    (client) => prepareStatus(client) == null,
  )
  const prepareUnclean = clients.filter((client) => {
    const status = prepareStatus(client)
    return status !== null && status !== 'clean'
  })
  if (prepareMissing.length > 0 || prepareUnclean.length > 0) {
    return abort(
      clients,
      prepareMissing.length > 0 ? 'peer-missing' : 'peer-blocked',
      clients.length,
    )
  }

  // Confirm round: every prepared client rechecks live and records its own
  // worker/attempt-specific reload authorization before acknowledging.
  const confirmInbox = await collectRound(
    hooks,
    clients,
    {
      type: COORDINATION_CONFIRM,
      protocol: PWA_UPDATE_PROTOCOL_VERSION,
      attemptId,
      workerToken,
    },
    attemptId,
    timeoutMs,
  )
  const confirmStatus = (client: CoordinatorClient) =>
    asRoundResponse(confirmInbox.get(client.id), attemptId, [
      'confirmed',
      'rejected',
    ])
  const confirmedClients = clients.filter(
    (client) => confirmStatus(client) === 'confirmed',
  )
  const confirmMissing = clients.filter(
    (client) => confirmStatus(client) == null,
  )
  if (confirmedClients.length !== clients.length) {
    return abort(
      clients,
      confirmMissing.length > 0 ? 'peer-missing' : 'peer-blocked',
      clients.length,
    )
  }

  // Re-enumerate before activating: a newly arrived client aborts the
  // attempt for a fresh check, while closed clients drop out.
  let current: CoordinatorClient[]
  try {
    current = await hooks.matchAllWindows()
  } catch {
    return abort(clients, 'activation-failed', clients.length)
  }
  const preparedIds = new Set(clients.map((client) => client.id))
  if (current.some((client) => !preparedIds.has(client.id))) {
    return abort(clients, 'new-client', current.length)
  }
  if (
    options.requesterId &&
    !current.some((client) => client.id === options.requesterId)
  ) {
    return abort(clients, 'requester-gone', current.length)
  }
  const confirmedIds = new Set(confirmedClients.map((client) => client.id))
  const remaining = current.filter(
    (client) => preparedIds.has(client.id) && confirmedIds.has(client.id),
  )
  if (remaining.length !== current.length) {
    // Defensive: every remaining client confirmed above, so any gap means
    // the set changed under us — abort rather than activate underneath it.
    return abort(clients, 'peer-blocked', current.length)
  }

  try {
    await hooks.skipWaiting()
  } catch {
    return abort(clients, 'activation-failed', current.length)
  }
  return { activated: true }
}

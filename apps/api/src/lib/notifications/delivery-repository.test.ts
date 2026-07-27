import { NotificationDeliveryStatus } from '@spliit/domain/notification-delivery'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/mocks'
import { prismaMock } from '../../test/state'
import {
  claimDelivery,
  markPermanentFailure,
  markRetryExhausted,
  markSent,
  markTransientFailure,
  normalizeProviderError,
  type ProviderErrorMetadata,
} from './delivery-repository'

const LEASE_DURATION_MS = 30_000

function makeRow(
  overrides: Partial<{
    id: string
    status: string
    snapshotVersion: number
    attemptCount: number
    leaseToken: string | null
    leaseJobId: string | null
    leaseExpiresAt: Date | null
  }> = {},
) {
  return {
    id: 'delivery-1',
    eventKey: 'evt-1',
    activityId: 'act-1',
    recipientAccountId: 'acct-1',
    category: 'EXPENSE_CREATED',
    channel: 'EMAIL',
    targetKey: 'account:acct-1',
    pushSubscriptionId: null,
    status: NotificationDeliveryStatus.PENDING,
    snapshotVersion: 1,
    snapshot: { kind: 'expense' },
    attemptCount: 0,
    lastAttemptAt: null,
    leaseToken: null,
    leaseJobId: null,
    leaseExpiresAt: null,
    lastErrorKind: null,
    lastErrorCode: null,
    lastProviderStatus: null,
    lastErrorMessage: null,
    lastErrorAt: null,
    sentAt: null,
    terminalAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

const TRANSIENT_ERROR: ProviderErrorMetadata = {
  kind: 'TRANSIENT',
  code: 'ETIMEDOUT',
  providerStatus: 503,
  message: 'upstream timeout',
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('claimDelivery', () => {
  it('acquires the lease when a pending row matches', async () => {
    const row = makeRow()
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.notificationDelivery.findUnique.mockResolvedValue(row as never)

    const result = await claimDelivery(
      prismaMock as never,
      'delivery-1',
      'job-1',
      LEASE_DURATION_MS,
    )

    expect(result.outcome).toBe('acquired')
    if (result.outcome !== 'acquired') return
    expect(result.delivery.id).toBe('delivery-1')
    expect(result.leaseToken).toMatch(/^[0-9a-f-]{36}$/i)
    expect(prismaMock.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'delivery-1',
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: NotificationDeliveryStatus.PENDING,
            }),
            expect.objectContaining({
              status: NotificationDeliveryStatus.PROCESSING,
              leaseExpiresAt: expect.objectContaining({ lt: expect.any(Date) }),
            }),
          ]),
        }),
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.PROCESSING,
          leaseJobId: 'job-1',
          attemptCount: { increment: 1 },
        }),
      }),
    )
  })

  it('returns active_lease when a second claim arrives before the first lease expires', async () => {
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.notificationDelivery.findUnique.mockResolvedValue(
      makeRow({
        status: NotificationDeliveryStatus.PROCESSING,
        leaseToken: 'token-active',
        leaseJobId: 'job-1',
        leaseExpiresAt: new Date(Date.now() + 60_000),
        attemptCount: 1,
      }) as never,
    )

    const result = await claimDelivery(
      prismaMock as never,
      'delivery-1',
      'job-2',
      LEASE_DURATION_MS,
    )

    expect(result).toEqual({
      outcome: 'active_lease',
      leaseExpiresAt: expect.any(Date),
    })
  })

  it('returns terminal when claiming a SENT row', async () => {
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.notificationDelivery.findUnique.mockResolvedValue(
      makeRow({
        status: NotificationDeliveryStatus.SENT,
        sentAt: new Date(),
        terminalAt: new Date(),
      }) as never,
    )

    const result = await claimDelivery(
      prismaMock as never,
      'delivery-1',
      'job-1',
      LEASE_DURATION_MS,
    )

    expect(result).toEqual({
      outcome: 'terminal',
      status: NotificationDeliveryStatus.SENT,
    })
  })

  it('returns terminal for PERMANENT_FAILURE rows', async () => {
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.notificationDelivery.findUnique.mockResolvedValue(
      makeRow({
        status: NotificationDeliveryStatus.PERMANENT_FAILURE,
        terminalAt: new Date(),
      }) as never,
    )

    const result = await claimDelivery(
      prismaMock as never,
      'delivery-1',
      'job-1',
      LEASE_DURATION_MS,
    )

    expect(result).toEqual({
      outcome: 'terminal',
      status: NotificationDeliveryStatus.PERMANENT_FAILURE,
    })
  })

  it('returns missing when the delivery row does not exist', async () => {
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.notificationDelivery.findUnique.mockResolvedValue(null as never)

    const result = await claimDelivery(
      prismaMock as never,
      'missing',
      'job-1',
      LEASE_DURATION_MS,
    )

    expect(result).toEqual({ outcome: 'missing' })
  })

  it('acquires a row regardless of snapshot version (version validation is in the handler)', async () => {
    const row = makeRow({ snapshotVersion: 99 })
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.notificationDelivery.findUnique.mockResolvedValue(row as never)

    const result = await claimDelivery(
      prismaMock as never,
      'delivery-1',
      'job-1',
      LEASE_DURATION_MS,
    )

    expect(result.outcome).toBe('acquired')
    if (result.outcome === 'acquired') {
      expect(result.delivery.snapshotVersion).toBe(99)
    }
  })

  it('recovers an expired lease with a fresh token', async () => {
    const row = makeRow({
      status: NotificationDeliveryStatus.PROCESSING,
      leaseToken: 'old-token',
      leaseJobId: 'job-old',
      leaseExpiresAt: new Date(Date.now() - 1_000),
      attemptCount: 2,
    })
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.notificationDelivery.findUnique.mockResolvedValue(row as never)

    const result = await claimDelivery(
      prismaMock as never,
      'delivery-1',
      'job-new',
      LEASE_DURATION_MS,
    )

    expect(result.outcome).toBe('acquired')
    if (result.outcome !== 'acquired') return
    expect(result.leaseToken).not.toBe('old-token')
    expect(prismaMock.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.PROCESSING,
          leaseToken: result.leaseToken,
          leaseJobId: 'job-new',
        }),
      }),
    )
  })

  it('issues a fresh lease token on every successful claim even with the same jobId', async () => {
    const row = makeRow()
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.notificationDelivery.findUnique.mockResolvedValue(row as never)

    const first = await claimDelivery(
      prismaMock as never,
      'delivery-1',
      'job-1',
      LEASE_DURATION_MS,
    )
    prismaMock.notificationDelivery.updateMany.mockClear()
    prismaMock.notificationDelivery.findUnique.mockClear()
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.notificationDelivery.findUnique.mockResolvedValue(row as never)

    const second = await claimDelivery(
      prismaMock as never,
      'delivery-1',
      'job-1',
      LEASE_DURATION_MS,
    )

    if (first.outcome !== 'acquired' || second.outcome !== 'acquired') {
      throw new Error('expected both claims to be acquired')
    }
    expect(first.leaseToken).not.toBe(second.leaseToken)
  })
})

describe('lease-token guarded transitions', () => {
  it('markSent returns true and clears the lease for the current owner', async () => {
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 1,
    } as never)

    const result = await markSent(
      prismaMock as never,
      'delivery-1',
      'token-current',
    )

    expect(result).toBe(true)
    expect(prismaMock.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1', leaseToken: 'token-current' },
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.SENT,
          leaseToken: null,
          leaseJobId: null,
          leaseExpiresAt: null,
          lastErrorKind: null,
          lastErrorCode: null,
          lastProviderStatus: null,
          lastErrorMessage: null,
          lastErrorAt: null,
        }),
      }),
    )
  })

  it('markSent returns false when a stale lease token is presented', async () => {
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 0,
    } as never)

    const result = await markSent(
      prismaMock as never,
      'delivery-1',
      'token-stale',
    )

    expect(result).toBe(false)
    expect(prismaMock.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1', leaseToken: 'token-stale' },
      }),
    )
  })

  it('markTransientFailure clears the lease and returns to PENDING', async () => {
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 1,
    } as never)

    const result = await markTransientFailure(
      prismaMock as never,
      'delivery-1',
      'token-current',
      TRANSIENT_ERROR,
    )

    expect(result).toBe(true)
    expect(prismaMock.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1', leaseToken: 'token-current' },
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.PENDING,
          leaseToken: null,
          leaseJobId: null,
          leaseExpiresAt: null,
          lastErrorKind: TRANSIENT_ERROR.kind,
          lastErrorCode: TRANSIENT_ERROR.code,
          lastProviderStatus: TRANSIENT_ERROR.providerStatus,
          lastErrorMessage: TRANSIENT_ERROR.message,
        }),
      }),
    )
  })

  it('markTransientFailure returns false for a stale token', async () => {
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 0,
    } as never)

    const result = await markTransientFailure(
      prismaMock as never,
      'delivery-1',
      'token-stale',
      TRANSIENT_ERROR,
    )

    expect(result).toBe(false)
  })

  it('markPermanentFailure transitions to PERMANENT_FAILURE with terminal timestamp', async () => {
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 1,
    } as never)

    const result = await markPermanentFailure(
      prismaMock as never,
      'delivery-1',
      'token-current',
      TRANSIENT_ERROR,
    )

    expect(result).toBe(true)
    expect(prismaMock.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1', leaseToken: 'token-current' },
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.PERMANENT_FAILURE,
          terminalAt: expect.any(Date),
          leaseToken: null,
          lastErrorKind: TRANSIENT_ERROR.kind,
        }),
      }),
    )
  })

  it('markRetryExhausted transitions to RETRY_EXHAUSTED with terminal timestamp', async () => {
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({
      count: 1,
    } as never)

    const result = await markRetryExhausted(
      prismaMock as never,
      'delivery-1',
      'token-current',
      TRANSIENT_ERROR,
    )

    expect(result).toBe(true)
    expect(prismaMock.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1', leaseToken: 'token-current' },
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.RETRY_EXHAUSTED,
          terminalAt: expect.any(Date),
          leaseToken: null,
          lastErrorKind: TRANSIENT_ERROR.kind,
        }),
      }),
    )
  })
})

describe('normalizeProviderError', () => {
  it('extracts kind, code, status, and message from a structured error', () => {
    const result = normalizeProviderError(
      { code: 'ETIMEDOUT', message: 'socket hang up' },
      'transient',
      504,
    )
    expect(result).toEqual({
      kind: 'TRANSIENT',
      code: 'ETIMEDOUT',
      providerStatus: 504,
      message: 'socket hang up',
    })
  })

  it('defaults to UNKNOWN code and Unknown message for null errors', () => {
    const result = normalizeProviderError(null, 'permanent')
    expect(result.kind).toBe('PERMANENT')
    expect(result.code).toBe('UNKNOWN')
    expect(result.message).toBe('Unknown provider error')
  })

  it('truncates oversized code and message strings', () => {
    const result = normalizeProviderError(
      {
        code: 'x'.repeat(200),
        message: 'y'.repeat(800),
      },
      'transient',
    )
    expect(result.code.length).toBe(100)
    expect(result.message.length).toBe(500)
  })

  it('serializes unknown error objects safely', () => {
    const result = normalizeProviderError({ foo: 'bar', baz: 1 }, 'transient')
    expect(result.code).toBe('UNKNOWN')
    expect(result.message).toContain('"foo":"bar"')
    expect(result.message).toContain('"baz":1')
  })

  it('respects a recognized kind on the error object', () => {
    const result = normalizeProviderError(
      { kind: 'TARGET_GONE', code: 'gone', message: 'sub removed' },
      'transient',
    )
    expect(result.kind).toBe('TARGET_GONE')
  })

  it('ignores unknown kind values and uses the provided classification', () => {
    const result = normalizeProviderError(
      { kind: 'NOT_REAL', code: 'x', message: 'm' },
      'transient',
    )
    expect(result.kind).toBe('TRANSIENT')
  })

  it('handles an Error instance', () => {
    const result = normalizeProviderError(new Error('boom'), 'permanent')
    expect(result.message).toBe('boom')
    expect(result.kind).toBe('PERMANENT')
  })

  it('strips newlines and tabs from messages to keep log lines single-line', () => {
    const result = normalizeProviderError(
      { message: 'line1\nline2\twith\ttabs' },
      'transient',
    )
    expect(result.message).toBe('line1 line2 with tabs')
  })

  it('coerces non-string code values to strings', () => {
    const result = normalizeProviderError(
      { code: 42, message: 'ok' },
      'transient',
    )
    expect(result.code).toBe('42')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { markBossRunning, type SpliitBoss } from '@spliit/jobs'

import { createAdminFetch, createDisabledHealthFetch } from './admin'

const hoisted = vi.hoisted(() => ({
  deliveryCount: vi.fn(),
  queryRawUnsafe: vi.fn(),
}))

vi.mock('@spliit/db', () => ({
  prisma: {
    notificationDelivery: {
      count: hoisted.deliveryCount,
    },
    $queryRawUnsafe: hoisted.queryRawUnsafe,
  },
}))

function createBossMock(installed = true) {
  return {
    isInstalled: vi.fn().mockResolvedValue(installed),
    on: vi.fn(),
  } as unknown as SpliitBoss
}

function mockTransportStats(
  overrides: {
    oldestRunnableMs?: number | null
    overdue?: number
    futureBackoff?: number
    transportJobs?: number
    missingTransport?: number
  } = {},
) {
  const {
    oldestRunnableMs = null,
    overdue = 0,
    futureBackoff = 0,
    transportJobs = 0,
    missingTransport = 0,
  } = overrides
  hoisted.queryRawUnsafe
    .mockResolvedValueOnce([
      {
        oldest_runnable_ms: oldestRunnableMs,
        overdue: BigInt(overdue),
        future_backoff: BigInt(futureBackoff),
        transport_jobs: BigInt(transportJobs),
      },
    ])
    .mockResolvedValueOnce([{ missing: BigInt(missingTransport) }])
}

beforeEach(() => {
  hoisted.deliveryCount.mockReset()
  hoisted.deliveryCount.mockResolvedValue(0)
  hoisted.queryRawUnsafe.mockReset()
  mockTransportStats()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('worker health endpoints', () => {
  it('keeps a disabled worker healthy without pg-boss', async () => {
    const response = await createDisabledHealthFetch(
      new Request('http://worker/health/readiness'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'healthy',
      jobs: 'disabled',
    })
  })

  it('reports liveness without querying pg-boss', async () => {
    const boss = createBossMock()
    const response = await createAdminFetch(boss)(
      new Request('http://worker/health/liveness'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'healthy' })
    expect(boss.isInstalled).not.toHaveBeenCalled()
  })

  it('reports readiness with transport and lease health', async () => {
    const boss = createBossMock(true)
    markBossRunning(boss)
    const response = await createAdminFetch(boss)(
      new Request('http://worker/health/readiness'),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      status: 'healthy',
      boss: 'running',
      delivery: {
        healthy: true,
        pending: 0,
        processing: 0,
        activeLeases: 0,
        expiredLeases: 0,
        permanentFailure: 0,
        retryExhausted: 0,
        sent: 0,
        transport: {
          oldestRunnableMs: null,
          overdue: 0,
          futureBackoff: 0,
          missingTransport: 0,
        },
      },
    })
    expect(boss.isInstalled).toHaveBeenCalledOnce()
  })

  it('returns 503 when pg-boss is not ready', async () => {
    const boss = createBossMock(false)
    markBossRunning(boss)
    const response = await createAdminFetch(boss)(
      new Request('http://worker/health/readiness'),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      status: 'unhealthy',
      boss: 'running',
    })
  })

  it('returns 503 when runnable lag exceeds threshold', async () => {
    const boss = createBossMock(true)
    markBossRunning(boss)
    hoisted.queryRawUnsafe.mockReset()
    mockTransportStats({
      oldestRunnableMs: 600_000,
      overdue: 5,
      transportJobs: 5,
    })

    const response = await createAdminFetch(boss)(
      new Request('http://worker/health/readiness'),
    )

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.delivery.healthy).toBe(false)
    expect(body.delivery.transport.oldestRunnableMs).toBe(600_000)
  })

  it('returns 503 when missing transport exceeds threshold', async () => {
    const boss = createBossMock(true)
    markBossRunning(boss)
    hoisted.queryRawUnsafe.mockReset()
    hoisted.deliveryCount
      .mockResolvedValueOnce(15) // pending
      .mockResolvedValueOnce(5) // processing
      .mockResolvedValueOnce(0) // permanent
      .mockResolvedValueOnce(0) // exhausted
      .mockResolvedValueOnce(0) // sent
      .mockResolvedValueOnce(3) // activeLeases
      .mockResolvedValueOnce(2) // expiredLeases
    mockTransportStats({ transportJobs: 5, missingTransport: 15 })

    const response = await createAdminFetch(boss)(
      new Request('http://worker/health/readiness'),
    )

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.delivery.healthy).toBe(false)
    expect(body.delivery.transport.missingTransport).toBe(15)
  })

  it('does not expose job inspection routes', async () => {
    const response = await createAdminFetch(createBossMock())(
      new Request('http://worker/dashboard'),
    )

    expect(response.status).toBe(404)
  })
})

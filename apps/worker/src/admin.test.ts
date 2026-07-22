import { markBossRunning, type SpliitBoss } from '@spliit/jobs'
import { describe, expect, it, vi } from 'vitest'
import { createAdminFetch, createDisabledHealthFetch } from './admin'

function createBossMock(installed = true) {
  return {
    isInstalled: vi.fn().mockResolvedValue(installed),
    on: vi.fn(),
  } as unknown as SpliitBoss
}

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

  it('reports readiness based on pg-boss installation state', async () => {
    const boss = createBossMock(true)
    markBossRunning(boss)
    const response = await createAdminFetch(boss)(
      new Request('http://worker/health/readiness'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'healthy',
      boss: 'running',
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

  it('does not expose job inspection routes', async () => {
    const response = await createAdminFetch(createBossMock())(
      new Request('http://worker/dashboard'),
    )

    expect(response.status).toBe(404)
  })
})

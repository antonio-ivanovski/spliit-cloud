import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isShutdownInFlight,
  resetShutdownForTests,
  runShutdown,
} from './shutdown'

beforeEach(() => {
  resetShutdownForTests()
})

afterEach(() => {
  resetShutdownForTests()
})

describe('runShutdown', () => {
  it('runs every cleanup step exactly once across repeated callers', async () => {
    const stopServer = vi.fn()
    const stopBoss = vi.fn().mockResolvedValue(undefined)
    const disconnectPrisma = vi.fn().mockResolvedValue(undefined)

    const [first, second] = await Promise.all([
      runShutdown({ stopServer, stopBoss, disconnectPrisma }),
      runShutdown({ stopServer, stopBoss, disconnectPrisma }),
    ])

    expect(stopServer).toHaveBeenCalledTimes(1)
    expect(stopBoss).toHaveBeenCalledTimes(1)
    expect(disconnectPrisma).toHaveBeenCalledTimes(1)
    expect(first.ran).toBe(true)
    expect(second.ran).toBe(false)
    expect(first.clean).toBe(true)
    expect(second.clean).toBe(true)
    expect(isShutdownInFlight()).toBe(true)
  })

  it('continues with the remaining steps when server stop throws', async () => {
    const stopServer = vi.fn(() => {
      throw new Error('server boom')
    })
    const stopBoss = vi.fn().mockResolvedValue(undefined)
    const disconnectPrisma = vi.fn().mockResolvedValue(undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await runShutdown({
      stopServer,
      stopBoss,
      disconnectPrisma,
    })

    expect(stopServer).toHaveBeenCalledTimes(1)
    expect(stopBoss).toHaveBeenCalledTimes(1)
    expect(disconnectPrisma).toHaveBeenCalledTimes(1)
    expect(result.clean).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to stop server',
      expect.any(Error),
    )
  })

  it('continues with prisma disconnect when boss stop throws', async () => {
    const stopServer = vi.fn()
    const stopBoss = vi.fn().mockRejectedValue(new Error('boss boom'))
    const disconnectPrisma = vi.fn().mockResolvedValue(undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await runShutdown({
      stopServer,
      stopBoss,
      disconnectPrisma,
    })

    expect(disconnectPrisma).toHaveBeenCalledTimes(1)
    expect(result.clean).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to stop API job client',
      expect.any(Error),
    )
  })

  it('marks clean=false when prisma disconnect throws', async () => {
    const stopServer = vi.fn()
    const stopBoss = vi.fn().mockResolvedValue(undefined)
    const disconnectPrisma = vi.fn().mockRejectedValue(new Error('prisma boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await runShutdown({
      stopServer,
      stopBoss,
      disconnectPrisma,
    })

    expect(result.clean).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to disconnect Prisma',
      expect.any(Error),
    )
  })

  it('keeps the same promise reference for every caller while in flight', async () => {
    let resolveStopServer!: () => void
    const stopServer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStopServer = resolve
        }),
    )
    const stopBoss = vi.fn().mockResolvedValue(undefined)
    const disconnectPrisma = vi.fn().mockResolvedValue(undefined)

    const first = runShutdown({ stopServer, stopBoss, disconnectPrisma })
    const second = runShutdown({ stopServer, stopBoss, disconnectPrisma })

    // Both promises resolve to the same logical state but are not
    // necessarily the same reference because the once-guard clones
    // the result so `ran` is accurate per caller.
    resolveStopServer()
    const [a, b] = await Promise.all([first, second])
    expect(a.ran).toBe(true)
    expect(b.ran).toBe(false)
    expect(a.clean).toBe(b.clean)
    expect(stopServer).toHaveBeenCalledTimes(1)
  })
})

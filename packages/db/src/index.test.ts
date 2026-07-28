import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Module-level recording state so the top-level vi.mock factories
// can expose call history without circular import gymnastics.
const poolCalls: Array<Record<string, unknown>> = []
const poolInstances: Array<{
  on: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}> = []
const adapterCalls: Array<{ pool: unknown; options: Record<string, unknown> }> =
  []
const prismaCalls: Array<Record<string, unknown>> = []

vi.mock('pg', () => {
  return {
    Pool: class {
      on = vi.fn()
      end = vi.fn().mockResolvedValue(undefined)
      totalCount = 0
      idleCount = 0
      waitingCount = 0
      constructor(options?: Record<string, unknown>) {
        poolCalls.push(options ?? {})
        poolInstances.push(this)
      }
    },
  }
})

vi.mock('@prisma/adapter-pg', () => {
  return {
    PrismaPg: class {
      adapter = true as const
      pool: unknown
      constructor(pool: unknown, options: Record<string, unknown>) {
        this.pool = pool
        adapterCalls.push({ pool, options: options ?? {} })
      }
    },
  }
})

vi.mock('./generated/prisma/client/client', () => {
  return {
    PrismaClient: class {
      $transaction = vi.fn()
      $disconnect: ReturnType<typeof vi.fn>
      constructor(options: Record<string, unknown>) {
        prismaCalls.push(options ?? {})
        const adapter = options?.adapter as
          | { pool?: { end: () => Promise<void> } }
          | undefined
        this.$disconnect = vi.fn().mockImplementation(async () => {
          await adapter?.pool?.end()
        })
      }
    },
  }
})

beforeEach(() => {
  poolCalls.length = 0
  poolInstances.length = 0
  adapterCalls.length = 0
  prismaCalls.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.DATABASE_URL
  delete process.env.DATABASE_POOL_SIZE
  delete process.env.DATABASE_POOL_ACQUIRE_TIMEOUT_MS
  delete process.env.DATABASE_TRANSACTION_MAX_WAIT_MS
  delete process.env.DATABASE_TRANSACTION_TIMEOUT_MS
  delete process.env.DATABASE_APPLICATION_NAME
})

describe('parsePositiveInt', () => {
  it('returns the fallback when the value is undefined or empty', async () => {
    const { parsePositiveInt } = await import('./index')
    expect(parsePositiveInt('FOO', undefined, 9)).toBe(9)
    expect(parsePositiveInt('FOO', '', 9)).toBe(9)
  })

  it('parses valid positive integers', async () => {
    const { parsePositiveInt } = await import('./index')
    expect(parsePositiveInt('FOO', '12', 9)).toBe(12)
    expect(parsePositiveInt('FOO', '1', 9)).toBe(1)
  })

  it('rejects zero, negatives, floats, and non-numeric values', async () => {
    const { parsePositiveInt } = await import('./index')
    expect(() => parsePositiveInt('FOO', '0', 9)).toThrow(/positive integer/)
    expect(() => parsePositiveInt('FOO', '-1', 9)).toThrow(/positive integer/)
    expect(() => parsePositiveInt('FOO', '1.5', 9)).toThrow(/positive integer/)
    expect(() => parsePositiveInt('FOO', 'abc', 9)).toThrow(/positive integer/)
    expect(() => parsePositiveInt('FOO', 'NaN', 9)).toThrow(/positive integer/)
  })
})

describe('createDatabaseRuntime — pg.Pool configuration', () => {
  it('forwards every pg.Pool option derived from the documented env vars', async () => {
    const { createDatabaseRuntime } = await import('./index')
    createDatabaseRuntime({
      DATABASE_URL: 'postgresql://example.test/db',
      DATABASE_POOL_SIZE: '25',
      DATABASE_POOL_ACQUIRE_TIMEOUT_MS: '1234',
      DATABASE_APPLICATION_NAME: 'spliit-api',
    })

    expect(poolCalls).toHaveLength(1)
    expect(poolCalls[0]).toEqual({
      connectionString: 'postgresql://example.test/db',
      max: 25,
      connectionTimeoutMillis: 1234,
      application_name: 'spliit-api',
    })
  })

  it('uses the shared defaults when no env overrides are set', async () => {
    const { createDatabaseRuntime } = await import('./index')
    createDatabaseRuntime({})
    expect(poolCalls).toHaveLength(1)
    expect(poolCalls[0]).toEqual({
      connectionString: expect.stringContaining('postgres'),
      max: 10,
      connectionTimeoutMillis: 5000,
      application_name: 'spliit',
    })
  })

  it('rejects invalid DATABASE_POOL_SIZE values before calling the pool factory', async () => {
    const { createDatabaseRuntime } = await import('./index')
    expect(() => createDatabaseRuntime({ DATABASE_POOL_SIZE: '0' })).toThrow(
      /DATABASE_POOL_SIZE/,
    )
    expect(() => createDatabaseRuntime({ DATABASE_POOL_SIZE: '-5' })).toThrow(
      /DATABASE_POOL_SIZE/,
    )
    expect(poolCalls).toHaveLength(0)
  })

  it('rejects invalid DATABASE_POOL_ACQUIRE_TIMEOUT_MS values', async () => {
    const { createDatabaseRuntime } = await import('./index')
    expect(() =>
      createDatabaseRuntime({ DATABASE_POOL_ACQUIRE_TIMEOUT_MS: '-1' }),
    ).toThrow(/DATABASE_POOL_ACQUIRE_TIMEOUT_MS/)
    expect(poolCalls).toHaveLength(0)
  })
})

describe('createDatabaseRuntime — adapter & Prisma client wiring', () => {
  it('forwards disposeExternalPool into the PrismaPg adapter', async () => {
    const { createDatabaseRuntime } = await import('./index')
    createDatabaseRuntime({})

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]?.options).toEqual({ disposeExternalPool: true })
    expect(adapterCalls[0]?.pool).toBe(poolInstances[0])
  })

  it('forwards parsed transactionOptions into the Prisma client constructor', async () => {
    const { createDatabaseRuntime } = await import('./index')
    createDatabaseRuntime({
      DATABASE_TRANSACTION_MAX_WAIT_MS: '750',
      DATABASE_TRANSACTION_TIMEOUT_MS: '9000',
    })

    expect(prismaCalls).toHaveLength(1)
    expect(prismaCalls[0]).toMatchObject({
      transactionOptions: { maxWait: 750, timeout: 9000 },
    })
  })
})

describe('createDatabaseRuntime — error-handler registration', () => {
  it('registers an idle-error handler tagged with the application name', async () => {
    const { createDatabaseRuntime } = await import('./index')
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    createDatabaseRuntime({ DATABASE_APPLICATION_NAME: 'spliit-test' })

    const instance = poolInstances[0]
    expect(instance).toBeDefined()
    const errorCall = instance!.on.mock.calls.find(
      (args: unknown[]) => args[0] === 'error',
    )
    expect(errorCall).toBeDefined()
    const handler = errorCall?.[1] as (err: Error) => void
    handler(new Error('idle boom'))
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('app=spliit-test'),
    )
  })

  it('falls back to the spliit application name when none is supplied', async () => {
    const { createDatabaseRuntime } = await import('./index')
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    createDatabaseRuntime({})

    const instance = poolInstances[0]
    const errorCall = instance!.on.mock.calls.find(
      (args: unknown[]) => args[0] === 'error',
    )
    const handler = errorCall?.[1] as (err: Error) => void
    handler(new Error('boom'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('app=spliit'))
  })
})

describe('createDatabaseRuntime — singleton and disposal', () => {
  it('disposes the external pool when basePrisma.$disconnect runs', async () => {
    const { createDatabaseRuntime } = await import('./index')
    const runtime = createDatabaseRuntime({})
    expect(poolInstances).toHaveLength(1)
    await runtime.basePrisma.$disconnect()
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1)
  })

  it('reuses the global cache slot in development mode across module reloads', async () => {
    const cache = globalThis as unknown as {
      __spliitDbRuntime?: { pool: { on: unknown } }
    }
    cache.__spliitDbRuntime = undefined
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    try {
      vi.resetModules()
      await import('./index')
      expect(cache.__spliitDbRuntime).toBeDefined()
      const cached = cache.__spliitDbRuntime

      const poolsAfterFirst = poolCalls.length
      const adaptersAfterFirst = adapterCalls.length
      const prismaAfterFirst = prismaCalls.length

      vi.resetModules()
      await import('./index')
      expect(cache.__spliitDbRuntime).toBe(cached)
      expect(poolCalls.length).toBe(poolsAfterFirst)
      expect(adapterCalls.length).toBe(adaptersAfterFirst)
      expect(prismaCalls.length).toBe(prismaAfterFirst)
    } finally {
      cache.__spliitDbRuntime = undefined
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('does not cache the singleton in production', async () => {
    const cache = globalThis as unknown as {
      __spliitDbRuntime?: unknown
    }
    cache.__spliitDbRuntime = undefined
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      vi.resetModules()
      const first = await import('./index')
      expect(cache.__spliitDbRuntime).toBeUndefined()
      expect(poolCalls.length).toBe(1)
      expect(adapterCalls.length).toBe(1)
      expect(prismaCalls.length).toBe(1)

      vi.resetModules()
      const second = await import('./index')
      expect(cache.__spliitDbRuntime).toBeUndefined()
      expect(poolCalls.length).toBe(2)
      expect(adapterCalls.length).toBe(2)
      expect(prismaCalls.length).toBe(2)
      expect(second.prisma).not.toBe(first.prisma)
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })
})

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { PrismaClient } from './generated/prisma/client/client'
// Pull in prisma-json.d.ts global declarations so consumers see the
// PrismaJson namespace and bare ActivityType aliases.
import './prisma-json'

export * from './generated/prisma/client/client'

export type DatabasePoolStats = {
  total: number
  idle: number
  waiting: number
}

export type DatabaseRuntime = {
  basePrisma: PrismaClient
  pool: Pool
}

export type DatabaseRuntimeOptions = {
  connectionString?: string
  poolSize?: number
  acquireTimeoutMs?: number
  transactionMaxWaitMs?: number
  transactionTimeoutMs?: number
  applicationName?: string
  logQueries?: boolean
}

const DEFAULT_POOL_SIZE = 10
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5000
const DEFAULT_TRANSACTION_MAX_WAIT_MS = 2000
const DEFAULT_TRANSACTION_TIMEOUT_MS = 5000

export function parsePositiveInt(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[db] ${name} must be a positive integer, got "${raw}"`)
  }
  return parsed
}

export function createDatabaseRuntime(
  env: NodeJS.ProcessEnv = process.env,
  poolFactory: typeof Pool = Pool,
  adapterFactory: typeof PrismaPg = PrismaPg,
): DatabaseRuntime {
  const connectionString =
    env.DATABASE_URL ?? 'postgresql://postgres:1234@localhost'

  const max = parsePositiveInt(
    'DATABASE_POOL_SIZE',
    env.DATABASE_POOL_SIZE,
    DEFAULT_POOL_SIZE,
  )
  const connectionTimeoutMillis = parsePositiveInt(
    'DATABASE_POOL_ACQUIRE_TIMEOUT_MS',
    env.DATABASE_POOL_ACQUIRE_TIMEOUT_MS,
    DEFAULT_ACQUIRE_TIMEOUT_MS,
  )
  const maxWait = parsePositiveInt(
    'DATABASE_TRANSACTION_MAX_WAIT_MS',
    env.DATABASE_TRANSACTION_MAX_WAIT_MS,
    DEFAULT_TRANSACTION_MAX_WAIT_MS,
  )
  const timeout = parsePositiveInt(
    'DATABASE_TRANSACTION_TIMEOUT_MS',
    env.DATABASE_TRANSACTION_TIMEOUT_MS,
    DEFAULT_TRANSACTION_TIMEOUT_MS,
  )
  const applicationName = env.DATABASE_APPLICATION_NAME || 'spliit'

  const pool = new poolFactory({
    connectionString,
    max,
    connectionTimeoutMillis,
    application_name: applicationName,
  })

  pool.on('error', (err: Error) => {
    console.error(
      `[db] idle client error (app=${applicationName}): ${err.message}`,
    )
  })

  const adapter = new adapterFactory(pool, {
    disposeExternalPool: true,
  })

  const basePrisma = new PrismaClient({
    adapter,
    log: env.PRISMA_QUERY_LOG === 'true' ? ['query'] : [],
    transactionOptions: {
      maxWait,
      timeout,
    },
  })

  return { basePrisma, pool }
}

const globalForDb = globalThis as unknown as {
  __spliitDbRuntime?: DatabaseRuntime
}

const runtime: DatabaseRuntime =
  process.env.NODE_ENV !== 'production'
    ? (globalForDb.__spliitDbRuntime ??= createDatabaseRuntime())
    : createDatabaseRuntime()

const { basePrisma, pool: dbPool } = runtime

export function getDatabasePoolStats(): DatabasePoolStats {
  return {
    total: dbPool.totalCount,
    idle: dbPool.idleCount,
    waiting: dbPool.waitingCount,
  }
}

/**
 * Wraps `prisma.$transaction` so that any transaction-level failure is
 * logged once at the database boundary, with the kind of transaction as
 * context. This catches failures that bubble up out of the transaction
 * callback (e.g. a thrown precondition that aborted the rollback, or a
 * connection error during commit). Per-query failures inside the callback
 * still surface through the regular tRPC/Hono error handlers.
 *
 * We avoid `client.$extends({ query: { $allModels: { $allOperations } } })`
 * because Prisma 7 narrows the model method signatures on the extended
 * client in a way that is incompatible with the `TransactionClient` type
 * expected by `$transaction` callbacks — see the typecheck errors that
 * prompted this workaround.
 */
function logDbError(context: string, err: unknown) {
  const name = err instanceof Error ? err.name : 'Error'
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[db] ${context} ${name}: ${message}`)
}

type TransactionArg = unknown

const transaction = basePrisma.$transaction.bind(basePrisma) as unknown as (
  arg: TransactionArg,
  options?: { maxWait?: number; timeout?: number },
) => Promise<unknown>

function loggedTransaction(
  arg: TransactionArg,
  options?: { maxWait?: number; timeout?: number },
) {
  return transaction(arg, options).catch((err) => {
    logDbError('transaction', err)
    throw err
  })
}

// We re-export the base client under the same `prisma` name, but with
// `$transaction` overridden so DB-level transaction failures land in the
// log. Everything else (model methods, raw queries, ...) is the untouched
// base client — its public type is preserved so all existing call sites
// and the `prismaMock` test setup keep working.
export const prisma = new Proxy(basePrisma, {
  get(target, prop, receiver) {
    if (prop === '$transaction') return loggedTransaction
    return Reflect.get(target, prop, receiver)
  },
}) as PrismaClient

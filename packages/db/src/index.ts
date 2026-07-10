import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client/client'
// Pull in prisma-json.d.ts global declarations so consumers see the
// PrismaJson namespace and bare ActivityType aliases.
import './prisma-json'

export * from './generated/prisma/client/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:1234@localhost'

const adapter = new PrismaPg({
  connectionString: databaseUrl,
})

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.PRISMA_QUERY_LOG === 'true' ? ['query'] : [],
  })

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

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = basePrisma
}

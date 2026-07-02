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

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.PRISMA_QUERY_LOG === 'true' ? ['query'] : [],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

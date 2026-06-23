import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client/client'

export * from './generated/prisma/client/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required')
}

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

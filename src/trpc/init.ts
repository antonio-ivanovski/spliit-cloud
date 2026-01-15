import { Prisma } from '@prisma/client'
import { initTRPC } from '@trpc/server'
import { cache } from 'react'
import superjson from 'superjson'
import { auth } from '@/lib/auth'

superjson.registerCustom<Prisma.Decimal, string>(
  {
    isApplicable: (v): v is Prisma.Decimal => Prisma.Decimal.isDecimal(v),
    serialize: (v) => v.toJSON(),
    deserialize: (v) => new Prisma.Decimal(v),
  },
  'decimal.js',
)

export const createTRPCContext = cache(async () => {
  /**
   * @see: https://trpc.io/docs/server/context
   */
  const session = await auth()
  return {
    userId: session?.user?.id,
    userEmail: session?.user?.email,
  }
})

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>

// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.context<TRPCContext>().create({
  /**
   * @see https://trpc.io/docs/server/data-transformers
   */
  transformer: superjson,
})

// Base router and procedure helpers
export const createTRPCRouter = t.router
export const baseProcedure = t.procedure

// Authenticated procedure that requires a user session
export const authedProcedure = baseProcedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new Error('UNAUTHORIZED')
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId, // Now TypeScript knows userId is non-null
    },
  })
})

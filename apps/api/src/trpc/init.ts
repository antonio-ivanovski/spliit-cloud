import { Prisma, prisma } from '@spliit/db'
import { initTRPC, TRPCError } from '@trpc/server'
import superjson from 'superjson'
import type { ResolvedAuth } from '../lib/auth/session'
import { getAuthFromRequest } from '../lib/auth/session'

superjson.registerCustom<Prisma.Decimal, string>(
  {
    isApplicable: (v): v is Prisma.Decimal => Prisma.Decimal.isDecimal(v),
    serialize: (v) => v.toJSON(),
    deserialize: (v) => new Prisma.Decimal(v),
  },
  'decimal.js',
)

export type AuthContext = {
  /** Authenticated account + better-auth session, or null. */
  auth: ResolvedAuth | null
  /** Outgoing fetch Request, when available (tRPC context only sees headers). */
  req?: Request
}

export async function createTRPCContext(opts: {
  req?: Request
  resHeaders?: Headers
}): Promise<AuthContext> {
  const request =
    opts.req ?? new Request('http://localhost', { headers: new Headers() })
  const auth = await getAuthFromRequest(request).catch(() => null)
  return { auth, req: opts.req }
}

// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.context<AuthContext>().create({
  /**
   * @see https://trpc.io/docs/server/data-transformers
   */
  transformer: superjson,
})

// Base router and procedure helpers
export const createTRPCRouter = t.router
export const baseProcedure = t.procedure

/**
 * Public procedure: anyone can call this. `ctx.auth` may still be non-null
 * if the caller is signed in (e.g. a "current user" hint), but the
 * procedure must not rely on it.
 */
export const publicProcedure = baseProcedure

/**
 * Procedure that requires an authenticated account. The account is exposed
 * to the procedure via `ctx.auth.user`.
 */
export const protectedProcedure = baseProcedure.use(async ({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    })
  }
  return next({
    ctx: {
      ...ctx,
      // Narrow the type so procedures can rely on a non-null auth.
      auth: ctx.auth,
    },
  })
})

/**
 * Procedure that requires an active group membership for the given groupId.
 * Resolves the group, the group member row, and the ledger, and exposes them
 * on `ctx` for downstream resolvers. Optional minimum role can be passed.
 */
export function groupProcedure(opts: {
  /** Minimum group role required to call this procedure. */
  minRole?: 'MEMBER' | 'ADMIN' | 'OWNER'
}) {
  const rolesRank: Record<'OWNER' | 'ADMIN' | 'MEMBER', number> = {
    OWNER: 3,
    ADMIN: 2,
    MEMBER: 1,
  }
  const minRole = opts.minRole ?? 'MEMBER'

  return protectedProcedure.use(async ({ ctx, next, path }) => {
    // We expect groupId to be present in the procedure input. Resolvers
    // expose it via ctx.group after this middleware runs.
    return next({
      ctx: {
        ...ctx,
        // Surface the role helper so resolvers can authorise further.
        requireGroupRole(role: 'MEMBER' | 'ADMIN' | 'OWNER') {
          if (rolesRank[role] < rolesRank[minRole]) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: `Requires role ${role}`,
            })
          }
        },
        // Will be filled in by the per-procedure input middleware if needed.
        // Procedures using `groupProcedure` should additionally call
        // `loadGroupContext` to populate `group`, `member`, and `ledger`.
        __groupMiddlewareTag: path,
      },
    })
  })
}

/**
 * Resolve the current account's membership, role, status, and the group +
 * ledger records for a given groupId. Throws when the account is not an
 * active member. Designed to be called from within a `groupProcedure` (or
 * `protectedProcedure`) resolver.
 */
export async function loadGroupContext({
  groupId,
  accountId,
}: {
  groupId: string
  accountId: string
}) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { ledger: true },
  })
  if (!group) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
  }

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId } },
    include: { ledgerParticipant: true },
  })
  if (!member || member.status !== 'ACTIVE') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not an active member of this group',
    })
  }

  return { group, member, ledger: group.ledger }
}

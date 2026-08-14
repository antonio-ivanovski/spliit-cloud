import { initTRPC, TRPCError } from '@trpc/server'
import superjson from 'superjson'

import {
  GroupInvitationStatus,
  GroupInvitationType,
  type GroupRole,
  prisma,
} from '@spliit/db'

import type { OAuthResolvedAuth, ResolvedAuth } from '../lib/auth/session'
import {
  getAuthFromRequest,
  getOAuthAuthFromRequest,
} from '../lib/auth/session'
import { env } from '../lib/env'
import {
  isPendingUsableRouteInvitation,
  resolveGroupRouteId,
  type GroupRouteSource,
} from '../lib/group-route'
import { FixedWindowLimiter, logRateLimitExceeded } from '../lib/rate-limit'

export type AuthContext = {
  /** Authenticated account + better-auth session, or null. */
  auth: ResolvedAuth | OAuthResolvedAuth | null
  /** Outgoing fetch Request, when available (tRPC context only sees headers). */
  req?: Request
  /** Mutable response headers supplied by the fetch adapter. */
  resHeaders?: Headers
}

export async function createTRPCContext(opts: {
  req?: Request
  resHeaders?: Headers
}): Promise<AuthContext> {
  const request =
    opts.req ?? new Request('http://localhost', { headers: new Headers() })
  const auth =
    (await getAuthFromRequest(request).catch(() => null)) ??
    (await getOAuthAuthFromRequest(request).catch(() => null))
  return {
    auth,
    req: opts.req,
    resHeaders: opts.resHeaders,
  }
}

// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.context<AuthContext>().create({
  /** @see https://trpc.io/docs/server/data-transformers */
  transformer: superjson,
})

// Base router and procedure helpers
export const createTRPCRouter = t.router
export const baseProcedure = t.procedure

/**
 * Public procedure: anyone can call this. `ctx.auth` may still be non-null if
 * the caller is signed in (e.g. a "current user" hint), but the procedure must
 * not rely on it.
 */
export const publicProcedure = baseProcedure

/**
 * Read procedure that permits sessions and opaque group route ids. Individual
 * resolvers still call `loadGroupViewer`, which validates the route id.
 */
export const groupReadProcedure = baseProcedure.use(async ({ ctx, next }) => {
  if (
    ctx.auth &&
    'credentialKind' in ctx.auth &&
    ctx.auth.credentialKind === 'oauth'
  ) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Session required' })
  }
  if (ctx.auth?.user.isAnonymous) {
    const recovery = await prisma.anonymousRecoveryCredential.findUnique({
      where: { accountId: ctx.auth.user.id },
      select: { acknowledgedAt: true, onboardingCompletedAt: true },
    })
    if (!recovery?.acknowledgedAt || !recovery.onboardingCompletedAt) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'ANONYMOUS_SETUP_REQUIRED',
      })
    }
  }
  return next()
})

const assistantRequestLimiter = new FixedWindowLimiter({
  limit: 120,
  windowMs: 60_000,
})
const authenticatedMutationLimiter = new FixedWindowLimiter({
  limit: 120,
  windowMs: 60_000,
})

/**
 * Procedure that requires an authenticated account. The account is exposed to
 * the procedure via `ctx.auth.user`.
 */
export const protectedProcedure = baseProcedure.use(
  async ({ ctx, next, path, type }) => {
    if (
      !ctx.auth ||
      ('credentialKind' in ctx.auth && ctx.auth.credentialKind === 'oauth')
    ) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      })
    }
    if (ctx.auth.user.isAnonymous) {
      const recovery = await prisma.anonymousRecoveryCredential.findUnique({
        where: { accountId: ctx.auth.user.id },
        select: { acknowledgedAt: true, onboardingCompletedAt: true },
      })
      if (!recovery?.acknowledgedAt || !recovery.onboardingCompletedAt) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ANONYMOUS_SETUP_REQUIRED',
        })
      }
    }
    if (type === 'mutation') {
      const decision = authenticatedMutationLimiter.hit(ctx.auth.user.id)
      if (!decision.allowed) {
        logRateLimitExceeded({
          policy: 'authenticated-mutation',
          identity: ctx.auth.user.id,
          retryAfterSeconds: decision.retryAfterSeconds,
          path,
        })
        ctx.resHeaders?.set('Retry-After', String(decision.retryAfterSeconds))
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Request limit exceeded; try again shortly',
        })
      }
    }

    return next({
      ctx: {
        ...ctx,
        // Narrow the type so procedures can rely on a non-null auth.
        auth: ctx.auth,
      },
    })
  },
)

function accountRateLimitedProcedure(options: {
  policy: string
  limit: number
  windowMs: number
}) {
  const limiter = new FixedWindowLimiter({
    limit: options.limit,
    windowMs: options.windowMs,
  })

  const enforce = (accountId: string, path?: string, resHeaders?: Headers) => {
    const decision = limiter.hit(accountId)
    if (decision.allowed) return
    logRateLimitExceeded({
      policy: options.policy,
      identity: accountId,
      retryAfterSeconds: decision.retryAfterSeconds,
      path,
    })
    resHeaders?.set('Retry-After', String(decision.retryAfterSeconds))
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Request limit exceeded; try again later',
    })
  }

  return {
    procedure: protectedProcedure.use(({ ctx, next, path }) => {
      enforce(ctx.auth.user.id, path, ctx.resHeaders)
      return next()
    }),
    enforce,
  }
}

const aiRequests = accountRateLimitedProcedure({
  policy: 'ai',
  limit: 60,
  windowMs: 60 * 60 * 1000,
})
const categoryAiRequests = accountRateLimitedProcedure({
  policy: 'ai-category',
  limit: 120,
  windowMs: 60 * 60 * 1000,
})
const bulkAiRequests = accountRateLimitedProcedure({
  policy: 'ai-bulk',
  limit: 20,
  windowMs: 60 * 60 * 1000,
})
const uploadPresignRequests = accountRateLimitedProcedure({
  policy: 'upload-presign',
  limit: 120,
  windowMs: 60 * 60 * 1000,
})
const importRequests = accountRateLimitedProcedure({
  policy: 'group-import',
  limit: 20,
  windowMs: 60 * 60 * 1000,
})

export const uploadPresignProcedure = uploadPresignRequests.procedure
export const importProcedure = importRequests.procedure

/** Charge AI quotas only immediately before provider work. */
export const enforceAiRequestLimit = aiRequests.enforce
export const enforceCategoryAiRequestLimit = categoryAiRequests.enforce
export const enforceBulkAiRequestLimit = bulkAiRequests.enforce

export function assistantProcedure(requiredScope: string) {
  return baseProcedure.use(async ({ ctx, next }) => {
    if (!env.ENABLE_MCP) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Assistant API is disabled',
      })
    }
    if (
      !ctx.auth ||
      !('credentialKind' in ctx.auth) ||
      ctx.auth.credentialKind !== 'oauth'
    ) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'OAuth bearer authentication required',
      })
    }
    if (!ctx.auth.scopes.includes(requiredScope)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Missing required scope: ${requiredScope}`,
      })
    }
    const decision = assistantRequestLimiter.hit(ctx.auth.user.id)
    if (!decision.allowed) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Assistant request limit exceeded; try again shortly',
      })
    }
    return next({ ctx: { ...ctx, auth: ctx.auth } })
  })
}

/**
 * Procedure that requires an active group membership for the given groupId.
 * Resolves the group, the group member row, and the ledger, and exposes them on
 * `ctx` for downstream resolvers. Optional minimum role can be passed.
 */
export function groupProcedure(opts: {
  /** Minimum group role required to call this procedure. */
  minRole?: 'MEMBER' | 'ADMIN'
}) {
  const rolesRank: Record<'ADMIN' | 'MEMBER', number> = {
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
        requireGroupRole(role: 'MEMBER' | 'ADMIN') {
          if (rolesRank[role] < rolesRank[minRole]) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: `Requires role ${role}`,
            })
          }
        },
        // Will be filled in by the per-procedure input middleware if needed.
        // Procedures using `groupProcedure` should additionally call
        // `loadGroupMutationContext` to populate `group`, `member`, and `ledger`.
        __groupMiddlewareTag: path,
      },
    })
  })
}

/**
 * Resolve the current account's membership, role, status, and the group +
 * ledger records for a given groupId. Throws when the account is not an active
 * member. Designed to be called from within a `groupProcedure` (or
 * `protectedProcedure`) resolver.
 */
export async function loadGroupMutationContext({
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

/**
 * Read-only group viewer: ACTIVE member, or PENDING email invitee (the
 * account's email matches a PENDING EMAIL GroupInvitation). Mutations must
 * still use `loadGroupMutationContext` to enforce write eligibility. Keeping
 * this boundary separate lets a future active view-only member reuse the read
 * path without accidentally inheriting mutation access.
 */
export type GroupViewer =
  | { kind: 'ACTIVE'; access: 'READ_WRITE' }
  | { kind: 'PUBLIC_VIEW'; access: 'READ_ONLY' }
  | {
      kind: 'PENDING_INVITEE'
      access: 'READ_ONLY'
      invitation: {
        id: string
        role: GroupRole
        type: GroupInvitationType
      }
    }

export type GroupViewerContext = {
  group: NonNullable<Awaited<ReturnType<typeof prisma.group.findUnique>>> & {
    ledger: NonNullable<Awaited<ReturnType<typeof prisma.ledger.findUnique>>>
  }
  member:
    | (NonNullable<
        Awaited<ReturnType<typeof prisma.groupMember.findUnique>>
      > & {
        ledgerParticipant: Awaited<
          ReturnType<typeof prisma.ledgerParticipant.findUnique>
        >
      })
    | null
  ledger: NonNullable<Awaited<ReturnType<typeof prisma.ledger.findUnique>>>
  viewer: GroupViewer
  routeSource: GroupRouteSource
  canonicalGroupId: string
}

export async function loadGroupViewer({
  groupId,
  accountId,
  accountEmail,
}: {
  /** Canonical group id or opaque public/invitation route id. */
  groupId: string
  accountId?: string | null
  accountEmail?: string | null
}): Promise<GroupViewerContext> {
  const route = await resolveGroupRouteId(groupId)
  if (!route) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Group access denied',
    })
  }
  const { group } = route
  const resolved = {
    group,
    ledger: group.ledger,
    routeSource: route.source,
    canonicalGroupId: group.id,
  }

  const member = accountId
    ? await prisma.groupMember.findUnique({
        where: { groupId_accountId: { groupId: group.id, accountId } },
        include: { ledgerParticipant: true },
      })
    : null

  if (member && member.status === 'ACTIVE') {
    return {
      ...resolved,
      member,
      viewer: { kind: 'ACTIVE', access: 'READ_WRITE' },
    }
  }

  // Fall back to a PENDING email invitation matching the account
  // email. Skipped when the account has no email (forward-compat with
  // email-less accounts); those callers fall through to a LINK token
  // check, then to FORBIDDEN.
  if (accountEmail) {
    const invitation = await prisma.groupInvitation.findFirst({
      where: {
        groupId: group.id,
        type: GroupInvitationType.EMAIL,
        status: GroupInvitationStatus.PENDING,
        email: { equals: accountEmail, mode: 'insensitive' },
      },
      select: { id: true, role: true, type: true },
    })

    if (invitation) {
      return {
        ...resolved,
        member: null,
        viewer: {
          kind: 'PENDING_INVITEE',
          access: 'READ_ONLY',
          invitation: {
            id: invitation.id,
            role: invitation.role,
            type: invitation.type,
          },
        },
      }
    }
  }

  if (route.source === 'PUBLIC_LINK' && group.groupType === 'GROUP') {
    return {
      ...resolved,
      member: null,
      viewer: { kind: 'PUBLIC_VIEW', access: 'READ_ONLY' },
    }
  }

  if (
    route.source === 'INVITATION' &&
    route.invitation &&
    isPendingUsableRouteInvitation(route.invitation)
  ) {
    return {
      ...resolved,
      member: null,
      viewer: {
        kind: 'PENDING_INVITEE',
        access: 'READ_ONLY',
        invitation: {
          id: route.invitation.id,
          role: route.invitation.role,
          type: route.invitation.type,
        },
      },
    }
  }

  if (!accountId && route.source === 'CANONICAL') {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    })
  }

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'You are not an active member of this group',
  })
}

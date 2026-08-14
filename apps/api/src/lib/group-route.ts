import { TRPCError } from '@trpc/server'

import {
  GroupInvitationStatus,
  GroupInvitationType,
  prisma,
  type Prisma as PrismaTypes,
} from '@spliit/db'

import { generateGroupRouteId } from './group-view'
import { hashLinkToken } from './invitations'

export type GroupRouteSource = 'CANONICAL' | 'PUBLIC_LINK' | 'INVITATION'

export async function resolveGroupRouteId(routeId: string) {
  const canonicalGroup = await prisma.group.findUnique({
    where: { id: routeId },
    include: { ledger: true },
  })
  if (canonicalGroup) {
    return {
      group: canonicalGroup,
      source: 'CANONICAL' as const,
      invitation: null,
    }
  }

  const publicGroup = await prisma.group.findUnique({
    where: { publicViewId: routeId },
    include: { ledger: true },
  })
  if (publicGroup) {
    return {
      group: publicGroup,
      source: 'PUBLIC_LINK' as const,
      invitation: null,
    }
  }

  const invitation = await prisma.groupInvitation.findUnique({
    where: { tokenHash: await hashLinkToken(routeId) },
    include: { group: { include: { ledger: true } } },
  })
  if (!invitation || invitation.type !== GroupInvitationType.LINK) return null

  return {
    group: invitation.group,
    source: 'INVITATION' as const,
    invitation,
  }
}

export function isPendingUsableRouteInvitation(invitation: {
  status: GroupInvitationStatus
  expiresAt: Date | null
}) {
  return (
    invitation.status === GroupInvitationStatus.PENDING &&
    (!invitation.expiresAt || invitation.expiresAt.getTime() > Date.now())
  )
}

type RouteLookupClient = typeof prisma | PrismaTypes.TransactionClient

async function routeIdExists(
  routeId: string,
  client: RouteLookupClient = prisma,
) {
  const [group, invitation] = await Promise.all([
    client.group.findFirst({
      where: { OR: [{ id: routeId }, { publicViewId: routeId }] },
      select: { id: true },
    }),
    client.groupInvitation.findFirst({
      where: { tokenHash: await hashLinkToken(routeId) },
      select: { id: true },
    }),
  ])
  return !!group || !!invitation
}

export async function generateUniqueGroupRouteId(
  client: RouteLookupClient = prisma,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const routeId = generateGroupRouteId()
    if (!(await routeIdExists(routeId, client))) return routeId
  }
  throw new TRPCError({
    code: 'CONFLICT',
    message: 'Could not allocate a unique group link',
  })
}

export async function assertGroupRouteIdAvailable(
  routeId: string,
  client: RouteLookupClient = prisma,
) {
  if (await routeIdExists(routeId, client)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Could not allocate a unique group link',
    })
  }
}

/**
 * Invitation hashes have their own unique index; only cross-table collisions
 * remain.
 */
export async function assertInvitationRouteIdDoesNotMatchGroup(
  routeId: string,
  client: RouteLookupClient = prisma,
) {
  const group = await client.group.findFirst({
    where: { OR: [{ id: routeId }, { publicViewId: routeId }] },
    select: { id: true },
  })
  if (group) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Could not allocate a unique group link',
    })
  }
}

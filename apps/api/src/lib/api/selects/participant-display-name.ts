import type { Prisma } from '@spliit/db'

/**
 * Projection for a ledger participant together with the fields needed to
 * resolve its human-readable display name (account name, invitation
 * temporary name, or raw display name).
 *
 * Default: latest invitation of any status (`createdAt desc`, `take: 1`) —
 * activity feeds and exports still resolve labels for revoked/accepted invites.
 * Pass `pendingInvitationsOnly: true` for update-expense validation so only
 * PENDING invitations count toward active participants.
 */
export function participantDisplayNameSelect(options?: {
  pendingInvitationsOnly?: boolean
}) {
  return {
    id: true,
    displayName: true,
    removedAt: true,
    groupMember: {
      select: {
        account: { select: { id: true, name: true, image: true } },
      },
    },
    invitations: {
      ...(options?.pendingInvitationsOnly
        ? { where: { status: 'PENDING' as const } }
        : {}),
      select: { email: true, temporaryName: true },
      take: 1,
      orderBy: { createdAt: 'desc' as const },
    },
  } satisfies Prisma.LedgerParticipantSelect
}

export type ParticipantDisplayName = Prisma.LedgerParticipantGetPayload<{
  select: ReturnType<typeof participantDisplayNameSelect>
}>

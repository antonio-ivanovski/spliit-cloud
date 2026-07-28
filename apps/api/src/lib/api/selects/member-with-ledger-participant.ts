import type { Prisma } from '@spliit/db'

/**
 * Build a GroupMember select that always pulls the membership's
 * `ledgerParticipant.id` (needed for participant-scoped lookups) and optionally
 * pulls the linked `account.name` (needed for permission and notification flows
 * that display the actor's name).
 *
 * Use `includeAccount: true` for member-detail queries (update, remove, leave
 * preview) and `includeAccount: false` for lightweight status checks (revoke,
 * decline).
 */
export function memberWithLedgerParticipantSelect(options: {
  includeAccount?: boolean
}) {
  return {
    id: true,
    groupId: true,
    role: true,
    status: true,
    accountId: true,
    ledgerParticipant: { select: { id: true } },
    ...(options.includeAccount ? { account: { select: { name: true } } } : {}),
  } satisfies Prisma.GroupMemberSelect
}

export type MemberWithLedgerParticipant = Prisma.GroupMemberGetPayload<{
  select: ReturnType<typeof memberWithLedgerParticipantSelect>
}>

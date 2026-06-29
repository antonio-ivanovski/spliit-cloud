import { prisma, type Prisma } from '@spliit/db'

export function randomId(size?: number) {
  const id = crypto.randomUUID().replaceAll('-', '')
  return size ? id.slice(0, size) : id
}

export type GroupWithLedger = Awaited<ReturnType<typeof loadGroupWithLedger>>

export async function loadGroupWithLedger(groupId: string) {
  return prisma.group.findUnique({
    where: { id: groupId },
    include: { ledger: true },
  })
}

/**
 * Resolve the ledger participant id backing a given account's membership
 * in a group. Returns `null` when the account is not an active member or
 * has no ledger participant materialized yet.
 *
 * Accepts an optional Prisma client (transactional or top-level) so the
 * lookup can reuse the same client as the surrounding write — important
 * for the leave/remove/archive flows that log activity from inside a
 * transaction.
 */
export async function getMemberLedgerParticipantId(
  groupId: string,
  accountId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  const member = await client.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId } },
    include: { ledgerParticipant: { select: { id: true } } },
  })
  return member?.ledgerParticipant?.id ?? null
}

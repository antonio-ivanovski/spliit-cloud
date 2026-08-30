import { type Prisma } from '@spliit/db'

import { mergeLedgerParticipantReferences } from '../api/ledger-participants'
import { randomId } from '../api/shared'

export async function materializePendingInvitationParticipant(
  tx: Prisma.TransactionClient,
  args: {
    groupId: string
    suppliedParticipantId?: string | null
    displayName?: string | null
  },
): Promise<string> {
  const { groupId, suppliedParticipantId, displayName } = args

  const group = await tx.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) {
    throw new Error('Cannot materialize participant: group has no ledger')
  }

  if (suppliedParticipantId) {
    const participant = await tx.ledgerParticipant.findUnique({
      where: { id: suppliedParticipantId },
      select: { ledgerId: true },
    })
    if (!participant) {
      throw new Error('Supplied participant does not exist')
    }
    if (participant.ledgerId !== group.ledgerId) {
      throw new Error('Supplied participant belongs to a different ledger')
    }
    return suppliedParticipantId
  }

  const participantId = randomId()
  await tx.ledgerParticipant.create({
    data: {
      id: participantId,
      ledgerId: group.ledgerId,
      displayName: displayName ?? null,
    },
  })
  return participantId
}

/**
 * After flipping the invitation to ACCEPTED and upserting the GroupMember, the
 * new member needs a `LedgerParticipant` linked through `groupMemberId`.
 */
export async function reconcileMemberLedgerParticipant(
  tx: Prisma.TransactionClient,
  args: {
    memberId: string
    ledgerId: string
    pendingParticipantId: string | null
  },
): Promise<void> {
  const { memberId, ledgerId, pendingParticipantId } = args

  const existingParticipant = await tx.ledgerParticipant.findUnique({
    where: { groupMemberId: memberId },
  })

  if (pendingParticipantId) {
    if (
      existingParticipant &&
      existingParticipant.id !== pendingParticipantId
    ) {
      await mergeLedgerParticipantReferences(tx, {
        sourceId: pendingParticipantId,
        targetId: existingParticipant.id,
      })
      await tx.ledgerParticipant.delete({ where: { id: pendingParticipantId } })
      return
    }
    if (!existingParticipant) {
      await tx.ledgerParticipant.update({
        where: { id: pendingParticipantId },
        data: {
          groupMemberId: memberId,
          kind: 'ACCOUNT_MEMBER',
          displayName: null,
        },
      })
      return
    }
    return
  }

  if (!existingParticipant) {
    await tx.ledgerParticipant.upsert({
      where: { groupMemberId: memberId },
      create: {
        id: randomId(),
        ledgerId,
        groupMemberId: memberId,
      },
      update: {},
    })
  }
}

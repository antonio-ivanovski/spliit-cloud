import { type Prisma } from '@spliit/db'
import { randomId } from '../api/shared'

/**
 * After flipping the invitation to ACCEPTED and upserting the GroupMember,
 * the new member needs a `LedgerParticipant` linked through `groupMemberId`.
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
      await tx.expensePaidBy.updateMany({
        where: { ledgerParticipantId: pendingParticipantId },
        data: { ledgerParticipantId: existingParticipant.id },
      })
      await tx.expensePaidFor.updateMany({
        where: { ledgerParticipantId: pendingParticipantId },
        data: { ledgerParticipantId: existingParticipant.id },
      })
      await tx.ledgerParticipant
        .delete({ where: { id: pendingParticipantId } })
        .catch(() => undefined)
      return
    }
    if (!existingParticipant) {
      await tx.ledgerParticipant.update({
        where: { id: pendingParticipantId },
        data: { groupMemberId: memberId },
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

import {
  GroupInvitationStatus,
  GroupMemberStatus,
  GroupRole,
  LedgerParticipantKind,
  prisma,
} from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { randomId } from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'

/**
 * Compute the list of destination `LedgerParticipant` ids that an
 * admin can pick from when linking an unlinked `LedgerParticipant`
 * to an account. Candidates are existing account-backed participants
 * in the same group, minus the unlinked LP itself and minus the LPs
 * that appear on the OTHER side of any expense leg involving the
 * unlinked LP (a participant that is both payer and payee of the
 * same expense would be a self-deal).
 *
 * Pending EMAIL and LINK-type invitations are also candidates: the
 * link flow can migrate the unlinked LP's references onto the
 * invitee's materialized `LedgerParticipant` and drop the unlinked
 * row. LINK-type invitations carry a synthetic `*.placeholder.local`
 * email by design, but matching is by `invitationId`, not by email,
 * so the synthetic address is irrelevant to the link mutation — the
 * dialog passes `pendingInvitationId` alongside (or instead of) an
 * email.
 */
export const candidatesProcedure = protectedProcedure
  .input(z.object({ unlinkedParticipantId: z.string().min(1) }))
  .query(async ({ input: { unlinkedParticipantId }, ctx }) => {
    const participant = await prisma.ledgerParticipant.findUnique({
      where: { id: unlinkedParticipantId },
      include: {
        ledger: {
          select: { id: true, group: { select: { id: true } } },
        },
      },
    })
    if (!participant) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Ledger participant not found',
      })
    }

    const groupId = participant.ledger.group?.id
    if (!groupId) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Group not found for this ledger participant',
      })
    }
    const ledgerId = participant.ledger.id

    const { group, member } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== GroupRole.ADMIN) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can link unlinked participants',
      })
    }

    // `getGroup` materializes a `LedgerParticipant` for each PENDING
    // invitation the first time it runs, but the candidates modal is
    // often opened before the group has been viewed in the current
    // session. Without this pass, the `ledgerParticipantId: { not: null }`
    // filter below would silently drop freshly-created EMAIL and
    // LINK-type invitations, hiding them from the picker. Failures
    // here are non-fatal — the candidates response still resolves.
    if (group.ledgerId) {
      try {
        await prisma.$transaction(async (tx) => {
          const unMaterialized = await tx.groupInvitation.findMany({
            where: {
              groupId,
              status: GroupInvitationStatus.PENDING,
              ledgerParticipantId: null,
            },
            select: { id: true },
          })
          for (const inv of unMaterialized) {
            const lpId = randomId()
            await tx.ledgerParticipant.create({
              data: {
                id: lpId,
                ledgerId: group.ledgerId!,
                kind: LedgerParticipantKind.UNLINKED_PARTICIPANT,
              },
            })
            await tx.groupInvitation.update({
              where: { id: inv.id },
              data: { ledgerParticipantId: lpId },
            })
          }
        })
      } catch (err) {
        console.warn(
          '[importLinks.candidates] failed to materialize pending invitation LPs',
          err,
        )
      }
    }

    // LPs on the other side of an expense leg involving the unlinked LP.
    // Loading paidByList and paidFor in a single OR query keeps the round trip
    // count down — both shapes use the same `paidFor` projection so the
    // blocked-set computation can iterate uniformly.
    const legs = await prisma.expense.findMany({
      where: {
        ledgerId,
        OR: [
          {
            paidByList: {
              some: { ledgerParticipantId: unlinkedParticipantId },
            },
          },
          { paidFor: { some: { ledgerParticipantId: unlinkedParticipantId } } },
        ],
      },
      select: {
        paidByList: {
          where: { ledgerParticipantId: unlinkedParticipantId },
          select: { ledgerParticipantId: true },
        },
        paidFor: { select: { ledgerParticipantId: true } },
      },
    })
    const blocked = new Set<string>()
    for (const expense of legs) {
      if (expense.paidByList.length > 0) {
        // The unlinked LP is on the paidByList side of this expense,
        // so every paidFor participant is on the opposite side.
        for (const pf of expense.paidFor) blocked.add(pf.ledgerParticipantId)
      } else {
        // The unlinked LP is on the paidFor side of this expense. The
        // join's existence confirms at least one expense references
        // them, but we already track the unlinked LP id at the call
        // site — no additional participants need blocking here.
        blocked.add(unlinkedParticipantId)
      }
    }

    const memberCandidates = await prisma.ledgerParticipant.findMany({
      where: {
        ledgerId,
        kind: LedgerParticipantKind.ACCOUNT_MEMBER,
        groupMember: {
          is: { groupId, status: GroupMemberStatus.ACTIVE },
        },
      },
      select: {
        id: true,
        groupMember: {
          select: {
            account: { select: { name: true, email: true } },
          },
        },
      },
    })

    // Pending EMAIL and LINK-type invitations with a materialized LP
    // in this ledger. Invitations whose LP landed in a different
    // ledger (shouldn't happen in practice — `getGroup` materializes
    // into the group's ledger — but a stale row is cheap to filter
    // here) are skipped.
    const pendingInvitations = await prisma.groupInvitation.findMany({
      where: {
        groupId,
        status: GroupInvitationStatus.PENDING,
        ledgerParticipantId: { not: null },
      },
      select: {
        id: true,
        email: true,
        temporaryName: true,
        ledgerParticipant: {
          select: { id: true, ledgerId: true },
        },
      },
    })

    type Candidate = {
      id: string
      name: string
      kind: 'MEMBER' | 'PENDING'
      email: string
      invitationId: string | null
    }

    const candidates: Candidate[] = []

    for (const m of memberCandidates) {
      if (m.id === unlinkedParticipantId) continue
      if (blocked.has(m.id)) continue
      const email = m.groupMember?.account?.email ?? null
      if (!email) continue
      candidates.push({
        id: m.id,
        name: m.groupMember?.account?.name ?? email,
        kind: 'MEMBER',
        email,
        invitationId: null,
      })
    }

    for (const inv of pendingInvitations) {
      const lp = inv.ledgerParticipant
      if (!lp) continue
      if (lp.ledgerId !== ledgerId) continue
      if (lp.id === unlinkedParticipantId) continue
      if (blocked.has(lp.id)) continue
      candidates.push({
        id: lp.id,
        name: inv.temporaryName || inv.email,
        kind: 'PENDING',
        email: inv.email,
        invitationId: inv.id,
      })
    }

    candidates.sort((a, b) => a.name.localeCompare(b.name))

    return { candidates }
  })

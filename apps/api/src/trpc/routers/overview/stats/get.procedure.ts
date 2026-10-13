import { TRPCError } from '@trpc/server'

import { GroupMemberStatus, prisma } from '@spliit/db'

import { balanceExpenseSelect } from '../../../../lib/api/selects/balance-expense'
import { protectedProcedure } from '../../../init'
import {
  overviewStatsInputSchema,
  overviewStatsOutputSchema,
} from '../../../outputs/overview-stats'
import {
  aggregateOverviewStats,
  overviewStatsDateBounds,
  resolveOverviewStatsRange,
  type StatsLedger,
} from './aggregate'

export const getOverviewStatsProcedure = protectedProcedure
  .input(overviewStatsInputSchema)
  .output(overviewStatsOutputSchema)
  .query(async ({ input, ctx }) => {
    const accountId = ctx.auth.user.id
    const now = new Date()
    const memberships = await prisma.groupMember.findMany({
      where: { accountId, status: GroupMemberStatus.ACTIVE },
      select: {
        ledgerParticipant: { select: { id: true } },
        group: {
          select: {
            id: true,
            name: true,
            groupType: true,
            archived: true,
            ledger: {
              select: { id: true, currency: true, currencyCode: true },
            },
          },
        },
      },
    })
    const authorizedIds = new Set(memberships.map(({ group }) => group.id))
    if (input.groupIds?.some((id) => !authorizedIds.has(id))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Statistics require active membership in every selected group',
      })
    }
    const preferences = input.includeHidden
      ? []
      : await prisma.accountGroupPreference.findMany({
          where: { accountId, hidden: true },
          select: { groupId: true },
        })
    const hidden = new Set(preferences.map((preference) => preference.groupId))
    const eligible = memberships.filter(
      ({ group }) =>
        (input.includeArchived || !group.archived) &&
        !hidden.has(group.id) &&
        (!input.groupIds || input.groupIds.includes(group.id)) &&
        (input.scope === 'ALL' ||
          group.groupType === (input.scope === 'GROUPS' ? 'GROUP' : 'FRIEND')),
    )
    const ledgerIds = [...new Set(eligible.map(({ group }) => group.ledger.id))]
    // Resolve identities only inside the viewer's eligible ledgers. Historical
    // account-backed participants remain attributable even after leaving.
    const participants =
      ledgerIds.length === 0
        ? []
        : await prisma.ledgerParticipant.findMany({
            where: {
              ledgerId: { in: ledgerIds },
              groupMember: { isNot: null },
            },
            select: {
              id: true,
              ledgerId: true,
              groupMember: {
                select: { account: { select: { id: true, name: true } } },
              },
            },
          })
    const people = new Map<string, { accountId: string; name: string }>()
    for (const participant of participants) {
      const account = participant.groupMember?.account
      if (account)
        people.set(account.id, { accountId: account.id, name: account.name })
    }
    if (
      input.person.kind === 'ACCOUNT' &&
      !people.has(input.person.accountId)
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Person is not in your selected shared ledgers',
      })
    }
    const selectedAccountId =
      input.person.kind === 'ACCOUNT' ? input.person.accountId : accountId
    const participantByLedger = new Map(
      participants
        .filter(
          (participant) =>
            participant.groupMember?.account.id === selectedAccountId,
        )
        .map((participant) => [participant.ledgerId, participant.id]),
    )
    const ledgers: StatsLedger[] = eligible.map((membership) => {
      const { group } = membership
      const friend =
        group.groupType === 'FRIEND'
          ? participants.find(
              (participant) =>
                participant.ledgerId === group.ledger.id &&
                participant.groupMember?.account.id !== accountId,
            )
          : null
      return {
        id: group.ledger.id,
        groupId: group.id,
        name: friend?.groupMember?.account.name ?? group.name,
        currency: group.ledger.currency,
        currencyCode: group.ledger.currencyCode,
        participantId:
          input.person.kind === 'ME'
            ? (membership.ledgerParticipant?.id ?? null)
            : (participantByLedger.get(group.ledger.id) ?? null),
      }
    })
    const range = resolveOverviewStatsRange(input, now)
    const expenseDate = overviewStatsDateBounds(range)
    const rows =
      ledgerIds.length === 0
        ? []
        : await prisma.expense.findMany({
            where: {
              ledgerId: { in: ledgerIds },
              expenseDate,
              ledger: {
                group: {
                  members: {
                    some: { accountId, status: GroupMemberStatus.ACTIVE },
                  },
                },
              },
            },
            select: balanceExpenseSelect,
          })
    return {
      ...aggregateOverviewStats(ledgers, rows, input, now),
      people: [...people.values()].sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          a.accountId.localeCompare(b.accountId),
      ),
      groups: ledgers.map((ledger) => ({
        groupId: ledger.groupId,
        name: ledger.name,
        groupType: eligible.find(({ group }) => group.id === ledger.groupId)!
          .group.groupType,
      })),
    }
  })

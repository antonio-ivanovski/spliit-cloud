import {
  GroupInvitationStatus,
  GroupMemberStatus,
  GroupType,
  prisma,
  type Prisma,
} from '@spliit/db'
import { getBalances, type BalanceExpense } from '@spliit/domain'

import { accountSummarySelect } from '../../../lib/api/selects/account-summary'
import { isPlaceholderEmail } from '../../../lib/invitations'
import { createTRPCRouter, protectedProcedure } from '../../init'
import type { OverviewFinancialState } from '../../outputs/overview'
import { overviewOutputSchema } from '../../outputs/overview'

const overviewExpenseSelect = {
  ledgerId: true,
  amount: true,
  createdAt: true,
  splitMode: true,
  paidBySplitMode: true,
  originalAmount: true,
  originalCurrency: true,
  conversionRate: true,
  conversionSource: true,
  paidByList: {
    select: { ledgerParticipantId: true, shares: true },
  },
  paidFor: {
    select: { ledgerParticipantId: true, shares: true },
  },
  items: {
    select: {
      amount: true,
      splitMode: true,
      paidFor: {
        select: { ledgerParticipantId: true, shares: true },
      },
    },
  },
  itemizedRemainder: {
    select: {
      splitMode: true,
      paidFor: {
        select: { ledgerParticipantId: true, shares: true },
      },
    },
  },
} satisfies Prisma.ExpenseSelect

type OverviewExpense = Prisma.ExpenseGetPayload<{
  select: typeof overviewExpenseSelect
}>

type FinancialState = OverviewFinancialState

function toBalanceExpense(row: OverviewExpense): BalanceExpense {
  return {
    amount: row.amount,
    splitMode: row.splitMode,
    paidBySplitMode: row.paidBySplitMode,
    originalAmount: row.originalAmount,
    originalCurrency: row.originalCurrency,
    conversionRate: row.conversionRate,
    conversionSource: row.conversionSource,
    paidByList: row.paidByList.map((share) => ({
      shares: share.shares,
      participant: { id: share.ledgerParticipantId },
    })),
    paidFor: row.paidFor.map((share) => ({
      shares: share.shares,
      participant: { id: share.ledgerParticipantId },
    })),
    items: row.items.map((item) => ({
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((share) => ({
        participant: share.ledgerParticipantId,
        shares: share.shares,
      })),
    })),
    itemizedRemainder: row.itemizedRemainder
      ? {
          splitMode: row.itemizedRemainder.splitMode,
          paidFor: row.itemizedRemainder.paidFor.map((share) => ({
            participant: share.ledgerParticipantId,
            shares: share.shares,
          })),
        }
      : null,
  }
}

export function getFinancialSummary(
  rows: OverviewExpense[],
  participantId: string | null,
) {
  const latestExpenseCreatedAt = rows.reduce<Date | null>(
    (latest, row) =>
      latest === null || row.createdAt > latest ? row.createdAt : latest,
    null,
  )

  if (participantId === null) {
    return {
      expenseCount: rows.length,
      netBalance: null,
      state: 'UNAVAILABLE' as FinancialState,
      latestExpenseCreatedAt: latestExpenseCreatedAt?.toISOString() ?? null,
    }
  }

  if (rows.length === 0) {
    return {
      expenseCount: 0,
      netBalance: 0,
      state: 'NO_EXPENSES' as FinancialState,
      latestExpenseCreatedAt: null,
    }
  }

  const balance = getBalances(rows.map(toBalanceExpense))[participantId]
  const netBalance = balance?.total ?? 0
  return {
    expenseCount: rows.length,
    netBalance,
    state:
      netBalance < 0
        ? ('YOU_OWE' as FinancialState)
        : netBalance > 0
          ? ('OWED_TO_YOU' as FinancialState)
          : ('SETTLED' as FinancialState),
    latestExpenseCreatedAt: latestExpenseCreatedAt?.toISOString() ?? null,
  }
}

export type OverviewBalanceGroup = {
  ledger: { currency: string; currencyCode: string | null }
  financialSummary: { netBalance: number | null }
}

export function summarizeBalances(groups: OverviewBalanceGroup[]) {
  const summaries = new Map<
    string,
    {
      currency: string
      currencyCode: string | null
      owedToYou: number
      owedToYouGroupCount: number
      youOwe: number
      youOweGroupCount: number
    }
  >()

  for (const group of groups) {
    const netBalance = group.financialSummary.netBalance
    if (netBalance === null || netBalance === 0) continue

    const { currency, currencyCode } = group.ledger
    const key = `${currencyCode ?? ''}:${currency}`
    const summary = summaries.get(key) ?? {
      currency,
      currencyCode,
      owedToYou: 0,
      owedToYouGroupCount: 0,
      youOwe: 0,
      youOweGroupCount: 0,
    }
    if (netBalance > 0) {
      summary.owedToYou += netBalance
      summary.owedToYouGroupCount += 1
    } else {
      summary.youOwe += Math.abs(netBalance)
      summary.youOweGroupCount += 1
    }
    summaries.set(key, summary)
  }

  return [...summaries.values()]
}

export const overviewRouter = createTRPCRouter({
  get: protectedProcedure
    .output(overviewOutputSchema)
    .query(async ({ ctx }) => {
      const accountId = ctx.auth.user.id
      const memberships = await prisma.groupMember.findMany({
        where: {
          accountId,
          status: GroupMemberStatus.ACTIVE,
        },
        select: {
          groupId: true,
          role: true,
          ledgerParticipant: { select: { id: true } },
          group: {
            select: {
              id: true,
              name: true,
              information: true,
              archived: true,
              createdAt: true,
              groupType: true,
              friendPairKey: true,
              ledger: {
                select: { id: true, currency: true, currencyCode: true },
              },
              _count: {
                select: {
                  members: { where: { status: GroupMemberStatus.ACTIVE } },
                },
              },
              members: {
                where: { status: GroupMemberStatus.ACTIVE },
                orderBy: { joinedAt: 'asc' },
                take: 4,
                select: { account: { select: accountSummarySelect } },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
      })

      const groupIds = memberships.map((membership) => membership.groupId)
      const preferenceRows = await prisma.accountGroupPreference.findMany({
        where: { accountId, groupId: { in: groupIds } },
        select: { groupId: true, starred: true, hidden: true },
      })
      const preferences = new Map(
        preferenceRows.map((preference) => [preference.groupId, preference]),
      )

      const friendGroupIds = memberships
        .filter(({ group }) => group.groupType === GroupType.FRIEND)
        .map(({ groupId }) => groupId)
      const pendingInvitations =
        friendGroupIds.length === 0
          ? []
          : await prisma.groupInvitation.findMany({
              where: {
                groupId: { in: friendGroupIds },
                status: GroupInvitationStatus.PENDING,
              },
              orderBy: { createdAt: 'desc' },
              select: { groupId: true, temporaryName: true, email: true },
            })
      const pendingByGroupId = new Map<
        string,
        { name: string | null; email: string }
      >()
      for (const invitation of pendingInvitations) {
        if (!pendingByGroupId.has(invitation.groupId)) {
          pendingByGroupId.set(invitation.groupId, {
            name: invitation.temporaryName,
            email: invitation.email,
          })
        }
      }

      const ledgerIds = memberships.map(({ group }) => group.ledger.id)
      const expenses =
        ledgerIds.length === 0
          ? []
          : await prisma.expense.findMany({
              where: {
                ledgerId: { in: ledgerIds },
                ledger: {
                  group: {
                    members: {
                      some: { accountId, status: GroupMemberStatus.ACTIVE },
                    },
                  },
                },
              },
              select: overviewExpenseSelect,
            })
      const expensesByLedgerId = new Map<string, OverviewExpense[]>()
      for (const expense of expenses) {
        const rows = expensesByLedgerId.get(expense.ledgerId) ?? []
        rows.push(expense)
        expensesByLedgerId.set(expense.ledgerId, rows)
      }

      const groups = memberships.map((membership) => {
        const { group } = membership
        const isFriend = group.groupType === GroupType.FRIEND
        const allMemberAccounts = group.members.map((member) => member.account)
        const friendAccount = isFriend
          ? (allMemberAccounts.find((account) => account.id !== accountId) ??
            null)
          : null
        // Keep the full member avatar stack for regular groups. Friend cards
        // only show the other participant, matching the previous dashboard.
        const memberAccounts = isFriend
          ? allMemberAccounts.filter((account) => account.id !== accountId)
          : allMemberAccounts
        const pendingInvitation = pendingByGroupId.get(group.id)
        const displayName = isFriend
          ? friendAccount?.name ||
            pendingInvitation?.name ||
            (pendingInvitation?.email &&
            !isPlaceholderEmail(pendingInvitation.email)
              ? pendingInvitation.email
              : undefined) ||
            ''
          : group.name
        const preference = preferences.get(group.id) ?? {
          starred: false,
          hidden: false,
        }
        const financialSummary = getFinancialSummary(
          expensesByLedgerId.get(group.ledger.id) ?? [],
          membership.ledgerParticipant?.id ?? null,
        )

        return {
          id: group.id,
          name: group.name,
          information: group.information,
          archived: group.archived,
          createdAt: group.createdAt.toISOString(),
          groupType: group.groupType,
          ledger: {
            currency: group.ledger.currency,
            currencyCode: group.ledger.currencyCode,
          },
          memberCount: group._count.members,
          currentMemberRole: membership.role,
          preference,
          displayName,
          friendAccount,
          memberAccounts,
          financialSummary,
        }
      })

      const visibleForCounts = groups.filter(({ archived }) => !archived)
      const friendCount = visibleForCounts.filter(
        ({ groupType, memberCount }) =>
          groupType === GroupType.FRIEND && memberCount > 1,
      ).length

      return {
        stats: {
          balanceSummaries: summarizeBalances(groups),
          friendCount,
        },
        groups: groups.sort((a, b) => {
          const aTime = a.financialSummary.latestExpenseCreatedAt ?? a.createdAt
          const bTime = b.financialSummary.latestExpenseCreatedAt ?? b.createdAt
          return bTime.localeCompare(aTime) || a.id.localeCompare(b.id)
        }),
      }
    }),
})

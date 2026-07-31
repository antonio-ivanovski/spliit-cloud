import {
  GroupInvitationStatus,
  GroupMemberStatus,
  GroupType,
  prisma,
  type Prisma,
} from '@spliit/db'
import {
  getBalances,
  getSuggestedReimbursements,
  type BalanceExpense,
  type Balances,
} from '@spliit/domain'

import { accountSummarySelect } from '../../../lib/api/selects/account-summary'
import { participantDisplayNameSelect } from '../../../lib/api/selects/participant-display-name'
import {
  getInvitationDisplayName,
  resolveParticipantDisplayName,
} from '../../../lib/invitations'
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
  precomputedBalance?: Balances,
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

  const balance = (precomputedBalance ??
    getBalances(rows.map(toBalanceExpense)))[participantId]
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

type OverviewPeopleGroup = {
  id: string
  displayName: string
  currency: { currency: string; currencyCode: string | null }
  currentParticipantId: string | null
  balances: Balances
}

type OverviewPeopleParticipant = {
  id: string
  name: string
  account: { id: string; name: string; image: string | null } | null
}

type PeopleBalanceGroup = {
  groupId: string
  groupName: string
  amount: number
}

type PeopleBalanceCurrency = {
  currency: string
  currencyCode: string | null
  netAmount: number
  groups: PeopleBalanceGroup[]
}

export type OverviewPeopleBalance = {
  key: string
  name: string
  account: OverviewPeopleParticipant['account']
  currencies: PeopleBalanceCurrency[]
}

/**
 * Aggregate the current user's suggested settlement legs by counterparty.
 * Account-backed participants are merged across ledgers; name-only participants
 * remain scoped to their ledger participant id.
 */
export function summarizePeopleBalances(
  groups: OverviewPeopleGroup[],
  participants: OverviewPeopleParticipant[],
): OverviewPeopleBalance[] {
  const participantsById = new Map(
    participants.map((participant) => [participant.id, participant]),
  )
  const people = new Map<
    string,
    OverviewPeopleBalance & {
      currenciesByKey: Map<string, PeopleBalanceCurrency>
    }
  >()

  for (const group of groups) {
    const currentParticipantId = group.currentParticipantId
    if (currentParticipantId === null) continue

    for (const leg of getSuggestedReimbursements(group.balances)) {
      if (leg.amount <= 0) continue
      const counterpartyId =
        leg.from === currentParticipantId
          ? leg.to
          : leg.to === currentParticipantId
            ? leg.from
            : null
      if (counterpartyId === null) continue

      const participant = participantsById.get(counterpartyId)
      if (!participant) continue
      const personKey = participant.account
        ? `account:${participant.account.id}`
        : `participant:${participant.id}`
      const currencyKey = `${group.currency.currencyCode ?? ''}:${group.currency.currency}`
      const signedAmount =
        leg.to === currentParticipantId ? leg.amount : -leg.amount
      let person = people.get(personKey)
      if (!person) {
        person = {
          key: personKey,
          name: participant.name,
          account: participant.account,
          currencies: [],
          currenciesByKey: new Map(),
        }
        people.set(personKey, person)
      }

      let currency = person.currenciesByKey.get(currencyKey)
      if (!currency) {
        currency = {
          currency: group.currency.currency,
          currencyCode: group.currency.currencyCode,
          netAmount: 0,
          groups: [],
        }
        person.currenciesByKey.set(currencyKey, currency)
        person.currencies.push(currency)
      }
      currency.netAmount += signedAmount
      const existingGroup = currency.groups.find(
        (entry) => entry.groupId === group.id,
      )
      if (existingGroup) {
        existingGroup.amount += signedAmount
      } else {
        currency.groups.push({
          groupId: group.id,
          groupName: group.displayName,
          amount: signedAmount,
        })
      }
    }
  }

  return [...people.values()]
    .map(({ currenciesByKey: _currenciesByKey, ...person }) => ({
      ...person,
      currencies: person.currencies
        .filter((currency) => currency.netAmount !== 0)
        .map((currency) => ({
          ...currency,
          groups: currency.groups.filter((group) => group.amount !== 0),
        }))
        .filter((currency) => currency.groups.length > 0)
        .sort(
          (a, b) =>
            (a.currencyCode ?? a.currency).localeCompare(
              b.currencyCode ?? b.currency,
            ) || a.currency.localeCompare(b.currency),
        ),
    }))
    .filter((person) => person.currencies.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
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

      const balancesByLedgerId = new Map<string, Balances>()
      for (const ledgerId of ledgerIds) {
        balancesByLedgerId.set(
          ledgerId,
          getBalances(
            (expensesByLedgerId.get(ledgerId) ?? []).map(toBalanceExpense),
          ),
        )
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
            (pendingInvitation?.email
              ? getInvitationDisplayName({
                  email: pendingInvitation.email,
                  temporaryName: pendingInvitation.name,
                })
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
          balancesByLedgerId.get(group.ledger.id),
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

      const participantIds = Array.from(
        new Set(
          expenses.flatMap((expense) => [
            ...expense.paidByList.map((share) => share.ledgerParticipantId),
            ...expense.paidFor.map((share) => share.ledgerParticipantId),
            ...expense.items.flatMap((item) =>
              item.paidFor.map((share) => share.ledgerParticipantId),
            ),
            ...(expense.itemizedRemainder?.paidFor.map(
              (share) => share.ledgerParticipantId,
            ) ?? []),
          ]),
        ),
      )
      const participantRows =
        participantIds.length === 0
          ? []
          : await prisma.ledgerParticipant.findMany({
              where: { id: { in: participantIds } },
              select: participantDisplayNameSelect(),
            })
      const peopleParticipants = participantRows.map((participant) => ({
        id: participant.id,
        name: resolveParticipantDisplayName(participant),
        account: participant.groupMember?.account ?? null,
      }))
      const peopleBalances = summarizePeopleBalances(
        memberships.map((membership) => ({
          id: membership.group.id,
          displayName:
            groups.find((group) => group.id === membership.group.id)
              ?.displayName ?? membership.group.name,
          currency: {
            currency: membership.group.ledger.currency,
            currencyCode: membership.group.ledger.currencyCode,
          },
          currentParticipantId: membership.ledgerParticipant?.id ?? null,
          balances: balancesByLedgerId.get(membership.group.ledger.id) ?? {},
        })),
        peopleParticipants,
      )

      const visibleForCounts = groups.filter(({ archived }) => !archived)
      const friendCount = visibleForCounts.filter(
        ({ groupType, memberCount }) =>
          groupType === GroupType.FRIEND && memberCount > 1,
      ).length

      return {
        stats: {
          balanceSummaries: summarizeBalances(groups),
          peopleBalances,
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

import { TRPCError } from '@trpc/server'

import { GroupMemberStatus, GroupType, type Prisma } from '@spliit/db'
import {
  getBalances,
  getCurrencyBalanceSummaries,
  getPublicBalances,
  getSuggestedSettlements,
  type Balances,
} from '@spliit/domain'
import {
  getIndividualSettlementPlan,
  getSubgroupSettlementPlan,
} from '@spliit/domain/subgroup-settlements'

import { OFFLINE_MAX_EXPENSES } from '../../trpc/outputs/offline'
import { getInvitationDisplayName } from '../invitations/display'
import { resolveParticipantDisplayName } from '../invitations/display'
import { narrowCategoryId, resolveCategory } from './expenses/helpers'
import { getGroup } from './groups'
import { toRecurrenceConfig } from './recurrence-series'
import { expensePermissions } from './resource-permissions'
import { accountSummarySelect } from './selects/account-summary'
import {
  balanceExpenseSelect,
  toBalanceExpense,
} from './selects/balance-expense'
import { participantDisplayNameSelect } from './selects/participant-display-name'
import { mapSubgroup, subgroupWithMembersSelect } from './subgroups'

type TxClient = Prisma.TransactionClient

const OFFLINE_TX_TIMEOUT_MS = 30_000

export const offlineTxOptions = {
  isolationLevel: 'RepeatableRead' as const,
  timeout: OFFLINE_TX_TIMEOUT_MS,
}

/**
 * Bulk expense projection for offline snapshots. Covers both the list card
 * (display names, document counts) and the detail view (shares, items,
 * documents metadata, series) so one query per group suffices. Document URLs
 * are never selected: the offline contract carries metadata only.
 */
export const offlineExpenseBulkSelect = {
  id: true,
  ledgerId: true,
  createdByAccountId: true,
  title: true,
  amount: true,
  createdAt: true,
  expenseDate: true,
  expenseTimeZone: true,
  categoryId: true,
  splitMode: true,
  paidBySplitMode: true,
  originalAmount: true,
  originalCurrency: true,
  conversionRate: true,
  conversionSource: true,
  version: true,
  notes: true,
  recurrenceSequence: true,
  recurringSeriesId: true,
  fileImportSource: { select: { provider: true } },
  paidByList: {
    select: {
      ledgerParticipantId: true,
      shares: true,
      ledgerParticipant: { select: participantDisplayNameSelect() },
    },
  },
  paidFor: {
    select: {
      ledgerParticipantId: true,
      shares: true,
      ledgerParticipant: { select: participantDisplayNameSelect() },
    },
  },
  items: {
    select: {
      id: true,
      title: true,
      unitPrice: true,
      quantity: true,
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
      allocationMode: true,
      paidFor: {
        select: { ledgerParticipantId: true, shares: true },
      },
    },
  },
  documents: {
    select: {
      id: true,
      fileName: true,
      contentType: true,
      width: true,
      height: true,
    },
  },
  recurringSeries: {
    select: {
      id: true,
      frequency: true,
      interval: true,
      endType: true,
      occurrenceLimit: true,
      endDate: true,
      status: true,
      anchorDate: true,
      nextOccurrenceDate: true,
      creatorAccountId: true,
    },
  },
  _count: { select: { documents: true } },
} satisfies Prisma.ExpenseSelect

export type OfflineExpenseBulkRow = Prisma.ExpenseGetPayload<{
  select: typeof offlineExpenseBulkSelect
}>

const catalogFinancialExpenseSelect = {
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
      allocationMode: true,
      paidFor: {
        select: { ledgerParticipantId: true, shares: true },
      },
    },
  },
} satisfies Prisma.ExpenseSelect

type CatalogFinancialRow = Prisma.ExpenseGetPayload<{
  select: typeof catalogFinancialExpenseSelect
}>

type FinancialSummary = {
  expenseCount: number
  netBalance: number | null
  state: 'NO_EXPENSES' | 'YOU_OWE' | 'OWED_TO_YOU' | 'SETTLED' | 'UNAVAILABLE'
  latestExpenseCreatedAt: string | null
}

/**
 * Mirrors `overviewRouter` `getFinancialSummary` (live-computed). Kept local to
 * avoid a lib->trpc layering inversion; the math reuses the same domain
 * `getBalances` pipeline so catalog parity holds.
 */
function getOfflineFinancialSummary(
  rows: CatalogFinancialRow[],
  participantId: string | null,
  precomputedBalance?: Balances,
): FinancialSummary {
  const latestExpenseCreatedAt = rows.reduce<Date | null>(
    (latest, row) =>
      latest === null || row.createdAt > latest ? row.createdAt : latest,
    null,
  )

  if (participantId === null) {
    return {
      expenseCount: rows.length,
      netBalance: null,
      state: 'UNAVAILABLE',
      latestExpenseCreatedAt: latestExpenseCreatedAt?.toISOString() ?? null,
    }
  }

  if (rows.length === 0) {
    return {
      expenseCount: 0,
      netBalance: 0,
      state: 'NO_EXPENSES',
      latestExpenseCreatedAt: null,
    }
  }

  const toBalanceExpenseRow = (row: CatalogFinancialRow) => ({
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
          allocationMode: row.itemizedRemainder.allocationMode,
          paidFor: row.itemizedRemainder.paidFor.map((share) => ({
            participant: share.ledgerParticipantId,
            shares: share.shares,
          })),
        }
      : null,
  })

  const balance = (precomputedBalance ??
    getBalances(rows.map(toBalanceExpenseRow)))[participantId]
  const netBalance = balance?.total ?? 0
  return {
    expenseCount: rows.length,
    netBalance,
    state:
      netBalance < 0 ? 'YOU_OWE' : netBalance > 0 ? 'OWED_TO_YOU' : 'SETTLED',
    latestExpenseCreatedAt: latestExpenseCreatedAt?.toISOString() ?? null,
  }
}

type MembershipWithGroup = {
  groupId: string
  role: 'ADMIN' | 'MEMBER'
  ledgerParticipant: { id: string } | null
  group: {
    id: string
    name: string
    information: string | null
    archived: boolean
    createdAt: Date
    groupType: GroupType
    friendPairKey: string | null
    ledger: {
      id: string
      currency: string
      currencyCode: string | null
      _count: { participants: number }
    }
    _count: { members: number }
    members: Array<{
      account: { id: string; name: string; image: string | null }
    }>
  }
}

function resolveOfflineDisplayName(args: {
  groupType: GroupType
  groupName: string
  memberAccounts: Array<{ id: string; name: string }>
  viewerAccountId: string
  pendingInvitation?: { name: string | null; email: string } | undefined
}): string {
  if (args.groupType !== GroupType.FRIEND) return args.groupName
  const peer = args.memberAccounts.find(
    (account) => account.id !== args.viewerAccountId,
  )
  if (peer?.name) return peer.name
  if (args.pendingInvitation?.name) return args.pendingInvitation.name
  if (args.pendingInvitation?.email) {
    return getInvitationDisplayName({
      email: args.pendingInvitation.email,
      temporaryName: args.pendingInvitation.name,
    })
  }
  return ''
}

function buildOfflineCatalogEntries(args: {
  memberships: MembershipWithGroup[]
  preferences: Map<string, { starred: boolean; hidden: boolean }>
  pendingByGroupId: Map<string, { name: string | null; email: string }>
  financialByLedgerId: Map<string, { summary: FinancialSummary }>
  accountId: string
}) {
  const entries = args.memberships.map((membership) => {
    const { group } = membership
    const isFriend = group.groupType === GroupType.FRIEND
    const allMemberAccounts = group.members.map((member) => member.account)
    const friendAccount = isFriend
      ? (allMemberAccounts.find((account) => account.id !== args.accountId) ??
        null)
      : null
    const memberAccounts = isFriend
      ? allMemberAccounts.filter((account) => account.id !== args.accountId)
      : allMemberAccounts
    const pendingInvitation = args.pendingByGroupId.get(group.id)
    const displayName = resolveOfflineDisplayName({
      groupType: group.groupType,
      groupName: group.name,
      memberAccounts: allMemberAccounts,
      viewerAccountId: args.accountId,
      pendingInvitation,
    })
    const preference = args.preferences.get(group.id) ?? {
      starred: false,
      hidden: false,
    }
    const financialSummary =
      args.financialByLedgerId.get(group.ledger.id)?.summary ??
      ({
        expenseCount: 0,
        netBalance: 0,
        state: 'NO_EXPENSES',
        latestExpenseCreatedAt: null,
      } satisfies FinancialSummary)

    const overview = {
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
      access: 'MEMBER' as const,
      viewKey: null,
      lastOpenedAt: null,
    }
    const global = {
      id: group.id,
      name: group.name,
      archived: group.archived,
      hidden: preference.hidden,
      groupType: group.groupType,
      displayName,
      currency: group.ledger.currency,
      currencyCode: group.ledger.currencyCode,
      participantCount: group.ledger._count.participants,
    }
    return { overview, global, groupId: group.id }
  })

  entries.sort((a, b) => a.groupId.localeCompare(b.groupId))
  return entries.map(({ overview, global }) => ({ overview, global }))
}

const catalogMembershipSelect = {
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
        select: {
          id: true,
          currency: true,
          currencyCode: true,
          _count: { select: { participants: true } },
        },
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
} satisfies Prisma.GroupMemberSelect

async function loadCatalogBase(
  tx: TxClient,
  accountId: string,
): Promise<{
  memberships: MembershipWithGroup[]
  preferences: Map<string, { starred: boolean; hidden: boolean }>
  pendingByGroupId: Map<string, { name: string | null; email: string }>
  financialByLedgerId: Map<string, { summary: FinancialSummary }>
}> {
  const memberships = (await tx.groupMember.findMany({
    where: { accountId, status: GroupMemberStatus.ACTIVE },
    select: catalogMembershipSelect,
    orderBy: [{ createdAt: 'desc' }],
  })) as unknown as MembershipWithGroup[]

  const preferenceRows = await tx.accountGroupPreference.findMany({
    where: { accountId },
    select: { groupId: true, starred: true, hidden: true },
  })
  const preferences = new Map(
    preferenceRows.map((preference) => [
      preference.groupId,
      { starred: preference.starred, hidden: preference.hidden },
    ]),
  )

  const friendGroupIds = memberships
    .filter(({ group }) => group.groupType === GroupType.FRIEND)
    .map(({ groupId }) => groupId)
  const pendingInvitations =
    friendGroupIds.length === 0
      ? []
      : await tx.groupInvitation.findMany({
          where: {
            groupId: { in: friendGroupIds },
            status: 'PENDING',
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
  const expenseRows =
    ledgerIds.length === 0
      ? []
      : await tx.expense.findMany({
          where: { ledgerId: { in: ledgerIds } },
          select: catalogFinancialExpenseSelect,
        })
  const rowsByLedgerId = new Map<string, CatalogFinancialRow[]>()
  for (const row of expenseRows as CatalogFinancialRow[]) {
    const rows =
      rowsByLedgerId.get((row as { ledgerId: string }).ledgerId) ?? []
    rows.push(row)
    rowsByLedgerId.set((row as { ledgerId: string }).ledgerId, rows)
  }

  const balancesByLedgerId = new Map<string, Balances>()
  for (const ledgerId of ledgerIds) {
    const rows = rowsByLedgerId.get(ledgerId) ?? []
    balancesByLedgerId.set(
      ledgerId,
      getBalances(
        rows.map((row) => ({
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
                allocationMode: row.itemizedRemainder.allocationMode,
                paidFor: row.itemizedRemainder.paidFor.map((share) => ({
                  participant: share.ledgerParticipantId,
                  shares: share.shares,
                })),
              }
            : null,
        })),
      ),
    )
  }

  const membershipByLedgerId = new Map(
    memberships.map((membership) => [membership.group.ledger.id, membership]),
  )
  const financialByLedgerId = new Map<string, { summary: FinancialSummary }>()
  for (const ledgerId of ledgerIds) {
    const membership = membershipByLedgerId.get(ledgerId)
    const rows = rowsByLedgerId.get(ledgerId) ?? []
    financialByLedgerId.set(ledgerId, {
      summary: getOfflineFinancialSummary(
        rows,
        membership?.ledgerParticipant?.id ?? null,
        balancesByLedgerId.get(ledgerId),
      ),
    })
  }

  return { memberships, preferences, pendingByGroupId, financialByLedgerId }
}

/**
 * Single-group catalog base for offline snapshots. Scoped to the requested
 * group only: one ACTIVE membership row, one account preference row, pending
 * invitations for that group when FRIEND, and financials for its single ledger.
 * Reuses `catalogMembershipSelect`, `getOfflineFinancialSummary`, and
 * `buildOfflineCatalogEntries` so overview/global parity with the full catalog
 * holds without loading every membership and ledger.
 */
async function loadSingleGroupBase(
  tx: TxClient,
  accountId: string,
  groupId: string,
): Promise<{
  memberships: MembershipWithGroup[]
  preferences: Map<string, { starred: boolean; hidden: boolean }>
  pendingByGroupId: Map<string, { name: string | null; email: string }>
  financialByLedgerId: Map<string, { summary: FinancialSummary }>
}> {
  const memberships = (await tx.groupMember.findMany({
    where: { accountId, groupId, status: GroupMemberStatus.ACTIVE },
    select: catalogMembershipSelect,
    orderBy: [{ createdAt: 'desc' }],
  })) as unknown as MembershipWithGroup[]

  const preferenceRows = await tx.accountGroupPreference.findMany({
    where: { accountId, groupId },
    select: { groupId: true, starred: true, hidden: true },
  })
  const preferences = new Map(
    preferenceRows.map((preference) => [
      preference.groupId,
      { starred: preference.starred, hidden: preference.hidden },
    ]),
  )

  const membership = memberships[0]
  const pendingByGroupId = new Map<
    string,
    { name: string | null; email: string }
  >()
  if (membership && membership.group.groupType === GroupType.FRIEND) {
    const pendingInvitations = await tx.groupInvitation.findMany({
      where: { groupId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { groupId: true, temporaryName: true, email: true },
    })
    for (const invitation of pendingInvitations) {
      if (!pendingByGroupId.has(invitation.groupId)) {
        pendingByGroupId.set(invitation.groupId, {
          name: invitation.temporaryName,
          email: invitation.email,
        })
      }
    }
  }

  const financialByLedgerId = new Map<string, { summary: FinancialSummary }>()
  const ledgerId = membership?.group.ledger.id
  if (membership && ledgerId) {
    const expenseRows = (await tx.expense.findMany({
      where: { ledgerId },
      select: catalogFinancialExpenseSelect,
    })) as unknown as CatalogFinancialRow[]
    financialByLedgerId.set(ledgerId, {
      summary: getOfflineFinancialSummary(
        expenseRows,
        membership.ledgerParticipant?.id ?? null,
      ),
    })
  }

  return { memberships, preferences, pendingByGroupId, financialByLedgerId }
}

export async function loadOfflineCatalog(
  tx: TxClient,
  accountId: string,
): Promise<ReturnType<typeof buildOfflineCatalogEntries>> {
  const base = await loadCatalogBase(tx, accountId)
  return buildOfflineCatalogEntries({
    memberships: base.memberships,
    preferences: base.preferences,
    pendingByGroupId: base.pendingByGroupId,
    financialByLedgerId: base.financialByLedgerId,
    accountId,
  })
}

/**
 * Build recurrence neighbor IDs from each series ordered by
 * `recurrenceSequence` ascending. Expenses with a null sequence are excluded
 * from the neighbor chain: their previous/next are null and they never link
 * neighbors. This keeps the chain total-ordered without inventing an order for
 * unordered rows, and matches the live `getExpense` semantics where a null
 * sequence yields null neighbors.
 */
export function buildRecurrenceNeighborMap(
  seriesExpenses: Array<{
    id: string
    recurrenceSequence: number | null
  }>,
): Map<
  string,
  { previousExpenseId: string | null; nextExpenseId: string | null }
> {
  const ordered = seriesExpenses
    .filter(
      (expense): expense is { id: string; recurrenceSequence: number } =>
        expense.recurrenceSequence !== null,
    )
    .sort((a, b) => a.recurrenceSequence - b.recurrenceSequence)
  const map = new Map<
    string,
    { previousExpenseId: string | null; nextExpenseId: string | null }
  >()
  for (const expense of seriesExpenses) {
    map.set(expense.id, { previousExpenseId: null, nextExpenseId: null })
  }
  for (let index = 0; index < ordered.length; index++) {
    const current = ordered[index]!
    map.set(current.id, {
      previousExpenseId: ordered[index - 1]?.id ?? null,
      nextExpenseId: ordered[index + 1]?.id ?? null,
    })
  }
  return map
}

function toOfflineListItem(
  row: OfflineExpenseBulkRow,
  member: { role: 'ADMIN' | 'MEMBER' },
  accountId: string,
  archived: boolean,
) {
  const paidByList = row.paidByList.map((entry) => ({
    ledgerParticipant: {
      id: entry.ledgerParticipant.id,
      name: resolveParticipantDisplayName(entry.ledgerParticipant),
      account: entry.ledgerParticipant.groupMember?.account ?? null,
      removed: entry.ledgerParticipant.removedAt != null,
    },
    shares: entry.shares,
  }))
  const paidFor = row.paidFor.map((entry) => ({
    ledgerParticipant: {
      id: entry.ledgerParticipant.id,
      name: resolveParticipantDisplayName(entry.ledgerParticipant),
      account: entry.ledgerParticipant.groupMember?.account ?? null,
      removed: entry.ledgerParticipant.removedAt != null,
    },
    shares: entry.shares,
  }))
  return {
    id: row.id,
    title: row.title,
    amount: row.amount,
    expenseDate: row.expenseDate,
    expenseTimeZone: row.expenseTimeZone,
    categoryId: narrowCategoryId(row.categoryId),
    category: resolveCategory(row.categoryId),
    splitMode: row.splitMode,
    paidBySplitMode: row.paidBySplitMode,
    originalAmount: row.originalAmount,
    originalCurrency: row.originalCurrency,
    conversionRate: row.conversionRate ?? null,
    conversionSource: row.conversionSource,
    originType: row.fileImportSource?.provider ?? null,
    recurrenceSequence: row.recurrenceSequence,
    items: row.items.map((item) => ({
      id: item.id,
      title: item.title,
      amount: item.amount,
    })),
    createdAt: row.createdAt,
    paidByList,
    paidFor,
    recurringSeriesId: row.recurringSeries?.id ?? null,
    recurringSeriesStatus: row.recurringSeries?.status ?? null,
    documentCount: row._count.documents,
    permissions: expensePermissions({
      role: member.role,
      accountId,
      createdByAccountId:
        row.recurringSeries?.creatorAccountId ?? row.createdByAccountId,
      recurringSeries: row.recurringSeriesId
        ? { creatorAccountId: row.recurringSeries?.creatorAccountId ?? null }
        : null,
      archived,
    }),
  }
}

function toOfflineDetail(
  row: OfflineExpenseBulkRow,
  member: { role: 'ADMIN' | 'MEMBER' },
  accountId: string,
  archived: boolean,
  neighbors: { previousExpenseId: string | null; nextExpenseId: string | null },
) {
  return {
    id: row.id,
    title: row.title,
    amount: row.amount,
    expenseDate: row.expenseDate,
    expenseTimeZone: row.expenseTimeZone,
    categoryId: narrowCategoryId(row.categoryId),
    category: resolveCategory(row.categoryId),
    splitMode: row.splitMode,
    paidBySplitMode: row.paidBySplitMode,
    originalAmount: row.originalAmount,
    originalCurrency: row.originalCurrency,
    conversionRate: row.conversionRate ?? null,
    conversionSource: row.conversionSource,
    originType: row.fileImportSource?.provider ?? null,
    recurrenceSequence: row.recurrenceSequence,
    items: row.items.map((item) => ({
      id: item.id,
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((share) => ({
        ledgerParticipantId: share.ledgerParticipantId,
        shares: share.shares,
      })),
    })),
    permissions: expensePermissions({
      role: member.role,
      accountId,
      createdByAccountId:
        row.recurringSeries?.creatorAccountId ?? row.createdByAccountId,
      recurringSeries: row.recurringSeriesId
        ? { creatorAccountId: row.recurringSeries?.creatorAccountId ?? null }
        : null,
      archived,
    }),
    version: row.version,
    createdAt: row.createdAt,
    notes: row.notes,
    documents: row.documents.map((document) => ({
      id: document.id,
      fileName: document.fileName,
      contentType: document.contentType,
      width: document.width,
      height: document.height,
    })),
    paidByList: row.paidByList.map((entry) => ({
      ledgerParticipantId: entry.ledgerParticipantId,
      shares: entry.shares,
    })),
    paidFor: row.paidFor.map((entry) => ({
      ledgerParticipantId: entry.ledgerParticipantId,
      shares: entry.shares,
    })),
    itemizedRemainder: row.itemizedRemainder
      ? {
          splitMode: row.itemizedRemainder.splitMode,
          allocationMode: row.itemizedRemainder.allocationMode,
          paidFor: row.itemizedRemainder.paidFor.map((share) => ({
            ledgerParticipantId: share.ledgerParticipantId,
            shares: share.shares,
          })),
        }
      : null,
    recurringSeriesId: row.recurringSeries?.id ?? null,
    recurringSeries: row.recurringSeries
      ? {
          id: row.recurringSeries.id,
          frequency: row.recurringSeries.frequency,
          interval: row.recurringSeries.interval,
          endType: row.recurringSeries.endType,
          occurrenceLimit: row.recurringSeries.occurrenceLimit,
          endDate: row.recurringSeries.endDate,
          status: row.recurringSeries.status,
          anchorDate: row.recurringSeries.anchorDate,
          nextOccurrenceDate: row.recurringSeries.nextOccurrenceDate,
        }
      : null,
    recurrence: row.recurringSeries
      ? toRecurrenceConfig(row.recurringSeries)
      : null,
    previousExpenseId: neighbors.previousExpenseId,
    nextExpenseId: neighbors.nextExpenseId,
  }
}

async function loadOfflineBalances(
  tx: TxClient,
  group: { id: string; subgroupsEnabled: boolean },
  ledger: { id: string; currencyCode: string | null },
) {
  const rows = await tx.expense.findMany({
    where: { ledgerId: ledger.id },
    select: balanceExpenseSelect,
  })
  const expenses = rows.map(toBalanceExpense)
  const participantIds = Array.from(
    new Set(
      expenses.flatMap((expense) =>
        [...expense.paidByList, ...expense.paidFor].map(
          (share) => share.participant.id,
        ),
      ),
    ),
  )
  const participants =
    participantIds.length === 0
      ? []
      : await tx.ledgerParticipant.findMany({
          where: { id: { in: participantIds } },
          select: participantDisplayNameSelect({
            pendingInvitationsOnly: true,
          }),
        })
  const balances = getBalances(expenses)
  const globalSuggestedSettlements = getSuggestedSettlements(balances)
  const publicBalances = getPublicBalances(globalSuggestedSettlements)
  const subgroupRows = group.subgroupsEnabled
    ? ((await tx.subgroup.findMany({
        where: { groupId: group.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: subgroupWithMembersSelect,
      })) ?? [])
    : []
  const subgroupDefinitions = subgroupRows.map(mapSubgroup)
  const settlementParticipantIds = [
    ...new Set([
      ...participantIds,
      ...subgroupDefinitions.flatMap((subgroup) => subgroup.participantIds),
    ]),
  ]
  const subgroupSettlement = getSubgroupSettlementPlan(
    balances,
    settlementParticipantIds,
    subgroupDefinitions.map((subgroup) => ({
      id: subgroup.id,
      name: subgroup.name,
      memberIds: subgroup.participantIds,
    })),
  )
  const individualSettlement = getIndividualSettlementPlan(
    balances,
    subgroupDefinitions.map((subgroup) => ({
      id: subgroup.id,
      name: subgroup.name,
      memberIds: subgroup.participantIds,
    })),
    settlementParticipantIds,
  )
  const currencyBalances = getCurrencyBalanceSummaries(
    expenses,
    ledger.currencyCode,
  )
  const publicParticipants = participants.map((participant) => ({
    id: participant.id,
    name: resolveParticipantDisplayName(participant),
    removed: participant.removedAt != null,
  }))

  return {
    balances: publicBalances,
    suggestedSettlements: individualSettlement.suggestedSettlements,
    currencyBalances,
    participants: publicParticipants,
    settlement: {
      subgroup: subgroupSettlement,
      individual: individualSettlement,
    },
  }
}

function resolveSnapshotDisplayName(
  group: NonNullable<Awaited<ReturnType<typeof getGroup>>>,
  viewerAccountId: string,
): string {
  if (group.groupType !== GroupType.FRIEND) return group.name
  const peerMember = group.members.find(
    (member) => member.accountId !== viewerAccountId,
  )
  if (peerMember?.account.name) return peerMember.account.name
  const pendingInv = group.invitations[0]
  if (pendingInv?.temporaryName) return pendingInv.temporaryName
  if (pendingInv?.email) return getInvitationDisplayName(pendingInv as never)
  return ''
}

export async function loadOfflineSnapshot(
  tx: TxClient,
  accountId: string,
  groupId: string,
) {
  const member = await tx.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId } },
    include: { ledgerParticipant: true },
  })
  if (!member || member.status !== GroupMemberStatus.ACTIVE) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not an active member of this group',
    })
  }

  const groupRow = await tx.group.findUnique({
    where: { id: groupId },
    include: { ledger: true },
  })
  if (!groupRow) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
  }
  if (member.groupId !== groupRow.id) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Group membership mismatch',
    })
  }

  const fullGroup = await getGroup(groupId, tx)
  if (!fullGroup) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
  }

  const displayName = resolveSnapshotDisplayName(fullGroup, accountId)

  const groupOutput = {
    group: fullGroup,
    displayName,
    currentLedgerParticipantId: member.ledgerParticipant?.id ?? null,
    currentMember: {
      id: member.id,
      role: member.role,
      status: member.status,
    },
    currentInvitation: null,
    linkInviteState: null,
    viewer: {
      source: 'MEMBER' as const,
      access: 'READ_WRITE' as const,
      canMutate: true,
      canAcceptInvitation: false,
    },
    hasSavedView: false,
  }

  const base = await loadSingleGroupBase(tx, accountId, groupId)
  if (base.memberships.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not an active member of this group',
    })
  }
  const catalogEntries = buildOfflineCatalogEntries({
    memberships: base.memberships,
    preferences: base.preferences,
    pendingByGroupId: base.pendingByGroupId,
    financialByLedgerId: base.financialByLedgerId,
    accountId,
  })
  const catalogEntry = catalogEntries.find(
    (entry) => entry.overview.id === groupId,
  )
  if (!catalogEntry) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not an active member of this group',
    })
  }

  const balances = await loadOfflineBalances(
    tx,
    {
      id: groupRow.id,
      subgroupsEnabled:
        (groupRow as { subgroupsEnabled?: boolean }).subgroupsEnabled ?? false,
    },
    { id: groupRow.ledger.id, currencyCode: groupRow.ledger.currencyCode },
  )

  const ledgerId = groupRow.ledger.id
  const totalCount = await tx.expense.count({ where: { ledgerId } })
  const downloadedRows = (await tx.expense.findMany({
    where: { ledgerId },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: OFFLINE_MAX_EXPENSES,
    select: offlineExpenseBulkSelect,
  })) as unknown as OfflineExpenseBulkRow[]

  const seriesIds = Array.from(
    new Set(
      downloadedRows
        .map((row) => row.recurringSeriesId)
        .filter((id): id is string => id !== null),
    ),
  )
  const neighborMap = new Map<
    string,
    { previousExpenseId: string | null; nextExpenseId: string | null }
  >()
  for (const row of downloadedRows) {
    neighborMap.set(row.id, {
      previousExpenseId: null,
      nextExpenseId: null,
    })
  }
  if (seriesIds.length > 0) {
    const allSeriesRows = (await tx.expense.findMany({
      where: { recurringSeriesId: { in: seriesIds } },
      select: { id: true, recurrenceSequence: true, recurringSeriesId: true },
    })) as unknown as Array<{
      id: string
      recurrenceSequence: number | null
      recurringSeriesId: string | null
    }>
    const rowsBySeriesId = new Map<
      string,
      Array<{ id: string; recurrenceSequence: number | null }>
    >()
    for (const seriesRow of allSeriesRows) {
      if (seriesRow.recurringSeriesId === null) continue
      const rows = rowsBySeriesId.get(seriesRow.recurringSeriesId) ?? []
      rows.push({
        id: seriesRow.id,
        recurrenceSequence: seriesRow.recurrenceSequence,
      })
      rowsBySeriesId.set(seriesRow.recurringSeriesId, rows)
    }
    for (const seriesId of seriesIds) {
      const seriesRows = rowsBySeriesId.get(seriesId) ?? []
      const seriesMap = buildRecurrenceNeighborMap(seriesRows)
      for (const row of downloadedRows) {
        if (row.recurringSeriesId !== seriesId) continue
        const neighbors = seriesMap.get(row.id)
        if (neighbors) neighborMap.set(row.id, neighbors)
      }
    }
  }

  const expenses = downloadedRows.map((row) => {
    if (row.ledgerId !== ledgerId) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Expense group relation mismatch',
      })
    }
    const neighbors = neighborMap.get(row.id) ?? {
      previousExpenseId: null,
      nextExpenseId: null,
    }
    return {
      list: toOfflineListItem(
        row,
        { role: member.role },
        accountId,
        groupRow.archived,
      ),
      detail: toOfflineDetail(
        row,
        { role: member.role },
        accountId,
        groupRow.archived,
        neighbors,
      ),
    }
  })

  const ids = expenses.map((entry) => entry.list.id)
  if (new Set(ids).size !== ids.length) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Duplicate expense ids in snapshot',
    })
  }
  for (const entry of expenses) {
    if (entry.list.id !== entry.detail.id) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'List/detail id mismatch',
      })
    }
    if (entry.detail.version <= 0) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Invalid expense version',
      })
    }
    if (entry.list.documentCount !== entry.detail.documents.length) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Document count mismatch',
      })
    }
  }

  return {
    group: groupOutput,
    overview: catalogEntry.overview,
    global: catalogEntry.global,
    balances,
    expenses,
    totalCount,
    downloadedCount: downloadedRows.length,
  }
}

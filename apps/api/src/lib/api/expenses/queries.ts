import type { Prisma } from '@spliit/db'
import { prisma } from '@spliit/db'
import {
  COMMON_CURRENCY_LIMIT,
  SETTLEMENT_CATEGORY_ID,
  expandCategorySelection,
  commonCurrencyLookbackDate,
  isSupportedCurrencyCode,
  loadLocaleDictionary,
  rankCommonCurrencies,
} from '@spliit/domain'

import { resolveParticipantDisplayName } from '../../invitations/display'
import { toRecurrenceConfig } from '../recurrence-series'
import { balanceExpenseSelect } from '../selects/balance-expense'
import { groupExpenseListCardSelect } from '../selects/expense-list'
import { narrowCategoryId, resolveCategory } from './helpers'
import {
  expenseTextSearchOr,
  findSimilarExpenseTitleIds,
  mergeWhereAnd,
} from './title-search'

/** Prisma row shape fed into `mapExpenseListRow`. */
export type ExpenseListDbRow = Prisma.ExpenseGetPayload<{
  select: typeof groupExpenseListCardSelect
}>

/**
 * Map a Prisma row selected with `groupExpenseListCardSelect` into the public
 * expense-list-item shape. Shared by `getGroupExpenses` and external callers
 * (e.g. the budgets router) that need the same wire shape.
 */
export function mapExpenseListRow(row: ExpenseListDbRow) {
  const {
    _count,
    recurringSeries,
    paidByList: _paidByList,
    paidFor: _paidFor,
    items: _items,
    fileImportSource,
    ...rest
  } = row
  void _paidByList
  void _paidFor
  void _items
  return {
    ...rest,
    // Import provenance lives in the side table; the list wire shape keeps
    // the legacy `originType` field populated from the import provider.
    originType: fileImportSource?.provider ?? null,
    permissions: {
      canEdit: false,
      canDelete: false,
      canManageRecurrence: false,
    },
    documentCount: _count.documents,
    paidByList: row.paidByList.map((pb) => ({
      ledgerParticipant: {
        id: pb.ledgerParticipant.id,
        name: resolveParticipantDisplayName(pb.ledgerParticipant),
        account: pb.ledgerParticipant.groupMember?.account ?? null,
        removed: pb.ledgerParticipant.removedAt != null,
      },
      shares: pb.shares,
    })),
    paidFor: row.paidFor.map((pf) => ({
      ledgerParticipant: {
        id: pf.ledgerParticipant.id,
        name: resolveParticipantDisplayName(pf.ledgerParticipant),
        account: pf.ledgerParticipant.groupMember?.account ?? null,
        removed: pf.ledgerParticipant.removedAt != null,
      },
      shares: pf.shares,
    })),
    items: row.items.map((item) => ({
      id: item.id,
      title: item.title,
      amount: item.amount,
    })),
    categoryId: narrowCategoryId(row.categoryId),
    category: resolveCategory(row.categoryId),
    conversionRate: row.conversionRate ?? null,
    conversionSource: row.conversionSource,
    recurringSeriesId: recurringSeries?.id ?? null,
    recurringSeriesCreatorAccountId: recurringSeries?.creatorAccountId ?? null,
    recurrenceSequence: row.recurrenceSequence,
    recurringSeriesStatus: recurringSeries?.status ?? null,
  }
}

export async function getGroupExpensesParticipants(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return []

  const [paidBy, paidFor] = await Promise.all([
    prisma.expensePaidBy.findMany({
      where: { expense: { ledgerId: group.ledgerId } },
      select: { ledgerParticipantId: true },
      distinct: ['ledgerParticipantId'],
    }),
    prisma.expensePaidFor.findMany({
      where: { expense: { ledgerId: group.ledgerId } },
      select: { ledgerParticipantId: true },
      distinct: ['ledgerParticipantId'],
    }),
  ])

  return Array.from(
    new Set([
      ...paidBy.map((row) => row.ledgerParticipantId),
      ...paidFor.map((row) => row.ledgerParticipantId),
    ]),
  )
}

export async function getGroupBalanceExpenses(
  groupId: string,
  ledgerId?: string,
) {
  const resolvedLedgerId =
    ledgerId ??
    (
      await prisma.group.findUnique({
        where: { id: groupId },
        select: { ledgerId: true },
      })
    )?.ledgerId
  if (!resolvedLedgerId) return []

  return prisma.expense.findMany({
    where: { ledgerId: resolvedLedgerId },
    select: balanceExpenseSelect,
  })
}

type GetGroupExpensesSortBy = 'expenseDate' | 'createdAt' | 'amount'
type GetGroupExpensesSortDir = 'asc' | 'desc'
type GetGroupExpensesMatch = 'any' | 'all' | 'exact'
type GetGroupExpensesOptions = {
  ledgerId?: string
  offset?: number
  length?: number
  filter?: string
  locale?: string
  hideSettlements?: boolean
  categories?: string[]
  paidBy?: string[]
  paidByMatch?: GetGroupExpensesMatch
  paidFor?: string[]
  paidForMatch?: GetGroupExpensesMatch
  dateFrom?: Date
  dateTo?: Date
  minAmount?: number
  maxAmount?: number
  currencies?: string[]
  sortBy?: GetGroupExpensesSortBy
  sortDir?: GetGroupExpensesSortDir
}

function buildParticipantMatch(
  selected: string[] | undefined,
  match: GetGroupExpensesMatch | undefined,
  relation: 'paidByList' | 'paidFor',
): Prisma.ExpenseWhereInput | undefined {
  if (!selected || selected.length === 0) return undefined
  const relationFilter = {
    [relation]: {
      some: { ledgerParticipantId: { in: selected } },
    },
  } as const
  if ((match ?? 'any') === 'any') return relationFilter
  if (match === 'exact') {
    return {
      AND: selected.map((id) => ({
        [relation]: { some: { ledgerParticipantId: id } },
      })),
      NOT: {
        [relation]: { some: { ledgerParticipantId: { notIn: selected } } },
      },
    } as Prisma.ExpenseWhereInput
  }
  return {
    AND: selected.map((id) => ({
      [relation]: { some: { ledgerParticipantId: id } },
    })),
  } as Prisma.ExpenseWhereInput
}

export async function getGroupExpenses(
  groupId: string,
  options?: GetGroupExpensesOptions,
) {
  const ledgerId =
    options?.ledgerId ??
    (
      await prisma.group.findUnique({
        where: { id: groupId },
        select: { ledgerId: true },
      })
    )?.ledgerId
  if (!ledgerId) return []

  const where = await buildExpenseListWhere(ledgerId, options)
  const orderBy = buildExpenseListOrderBy(options?.sortBy, options?.sortDir)

  const rows = await prisma.expense.findMany({
    select: groupExpenseListCardSelect,
    where,
    orderBy,
    skip: options && options.offset,
    take: options && options.length,
  })

  return rows.map(mapExpenseListRow)
}

/**
 * Shared `where` builder for the expense list: base filters (category,
 * currency, date/amount ranges, participant matches) plus the optional text
 * search. Extracted so the involvement-aware pager reuses the exact same
 * filtering as the plain list.
 */
async function buildExpenseListWhere(
  ledgerId: string,
  options?: GetGroupExpensesOptions,
): Promise<Prisma.ExpenseWhereInput> {
  const expenseDateRange: Prisma.DateTimeFilter | undefined =
    options?.dateFrom || options?.dateTo
      ? {
          ...(options.dateFrom ? { gte: options.dateFrom } : {}),
          ...(options.dateTo ? { lte: options.dateTo } : {}),
        }
      : undefined

  const amountRange: Prisma.IntFilter | undefined =
    options?.minAmount !== undefined || options?.maxAmount !== undefined
      ? {
          ...(options.minAmount !== undefined
            ? { gte: options.minAmount }
            : {}),
          ...(options.maxAmount !== undefined
            ? { lte: options.maxAmount }
            : {}),
        }
      : undefined

  let where: Prisma.ExpenseWhereInput = {
    ledgerId,
    categoryId: (() => {
      if (options?.categories && options.categories.length > 0) {
        const expanded = expandCategorySelection(options.categories)
        return {
          in: expanded.length > 0 ? expanded : options.categories,
        }
      }
      if (options?.hideSettlements) {
        return { not: SETTLEMENT_CATEGORY_ID }
      }
      return undefined
    })(),
    originalCurrency:
      options?.currencies && options.currencies.length > 0
        ? { in: options.currencies }
        : undefined,
    expenseDate: expenseDateRange,
    amount: amountRange,
    ...buildParticipantMatch(
      options?.paidBy,
      options?.paidByMatch,
      'paidByList',
    ),
    ...buildParticipantMatch(
      options?.paidFor,
      options?.paidForMatch,
      'paidFor',
    ),
  }

  const filter = options?.filter?.trim()
  if (filter) {
    await loadLocaleDictionary(options?.locale)
    const similarTitleIds = await findSimilarExpenseTitleIds({
      ledgerIds: [ledgerId],
      query: filter,
    })
    where = mergeWhereAnd(
      where,
      expenseTextSearchOr({
        query: filter,
        locale: options?.locale,
        similarTitleIds,
      }),
    )
  }

  return where
}

function buildExpenseListOrderBy(
  sortBy?: GetGroupExpensesSortBy,
  sortDir?: GetGroupExpensesSortDir,
): Prisma.ExpenseOrderByWithRelationInput[] {
  const effectiveField = sortBy ?? 'expenseDate'
  const dir = sortDir ?? 'desc'
  const primaryOrder: Prisma.ExpenseOrderByWithRelationInput = {
    [effectiveField]: dir,
  }
  return effectiveField === 'expenseDate'
    ? [primaryOrder, { createdAt: 'desc' }, { id: 'desc' }]
    : [primaryOrder, { id: 'desc' }]
}
/**
 * Hidden (non-involving) rows delivered per involving page before the server
 * issues a continuation token. Keeps a single response bounded while the
 * carry-over keeps long hidden gaps gap-free across requests.
 */
export const INVOLVING_PAGE_HIDDEN_CHUNK = 100

/**
 * Parse the expense-list cursor. Plain numbers are involving offsets (legacy
 * behavior); `"offset+skipped"` strings continue a truncated hidden gap at the
 * same involving offset with `skipped` hidden rows already delivered.
 */
export function parseExpenseListCursor(cursor?: number | string | null): {
  involvingOffset: number
  hiddenSkipped: number
} {
  if (typeof cursor === 'string') {
    const [offset, skipped] = cursor.split('+')
    return {
      involvingOffset: Number(offset),
      hiddenSkipped: Number(skipped),
    }
  }
  return { involvingOffset: cursor ?? 0, hiddenSkipped: 0 }
}

export type InvolvingPageSortBy = 'expenseDate' | 'createdAt'

export type InvolvingPageOptions = GetGroupExpensesOptions & {
  sortBy: InvolvingPageSortBy
  sortDir?: GetGroupExpensesSortDir
  involvingParticipantId?: string | null
  involvingAccountId?: string | null
  /** Offset into the involving-only sequence (never counts hidden rows). */
  involvingOffset?: number
  /** Involving expenses guaranteed per page; hidden context rides along. */
  involvingLength?: number
  /** Already-delivered hidden rows within the current gap (continuation). */
  hiddenSkipped?: number
  hiddenChunk?: number
}

export type InvolvingPageResult = {
  rows: ReturnType<typeof mapExpenseListRow>[]
  involvingReturned: number
  hasMoreInvolving: boolean
  hiddenPending: boolean
}

type ExpenseSortKey = {
  id: string
  expenseDate: Date
  createdAt: Date
}

type SortLevel = {
  field: 'expenseDate' | 'createdAt' | 'id'
  dir: 'asc' | 'desc'
}

function involvingSortLevels(
  sortBy: InvolvingPageSortBy,
  sortDir: GetGroupExpensesSortDir,
): SortLevel[] {
  return sortBy === 'expenseDate'
    ? [
        { field: 'expenseDate', dir: sortDir },
        { field: 'createdAt', dir: 'desc' },
        { field: 'id', dir: 'desc' },
      ]
    : [
        { field: 'createdAt', dir: sortDir },
        { field: 'id', dir: 'desc' },
      ]
}

/**
 * Mirrors the client's `isExpenseInvolvingUser`: payer-or-beneficiary at the
 * list level, by ledger participant id with the backing account id fallback.
 * Callers guarantee at least one identity is known.
 */
function involvementClause(
  participantId: string | null | undefined,
  accountId: string | null | undefined,
): Prisma.ExpenseWhereInput {
  const clauses: Prisma.ExpenseWhereInput[] = []
  if (participantId) {
    clauses.push(
      { paidByList: { some: { ledgerParticipantId: participantId } } },
      { paidFor: { some: { ledgerParticipantId: participantId } } },
    )
  }
  if (accountId) {
    clauses.push(
      {
        paidByList: {
          some: { ledgerParticipant: { groupMember: { accountId } } },
        },
      },
      {
        paidFor: {
          some: { ledgerParticipant: { groupMember: { accountId } } },
        },
      },
    )
  }
  return { OR: clauses }
}

function flipDir(dir: 'asc' | 'desc'): 'asc' | 'desc' {
  return dir === 'desc' ? 'asc' : 'desc'
}

/**
 * Keyset bound: rows strictly after (or before) an anchor row in the page's
 * exact sort order, including the fixed `desc` tiebreaks. Expresses "the hidden
 * gap between two involving expenses" without position offsets.
 */
function anchorBoundFilter(
  anchor: ExpenseSortKey,
  levels: SortLevel[],
  side: 'after' | 'before',
): Prisma.ExpenseWhereInput {
  const ors = levels.map((level, index) => {
    const priorEquals = levels.slice(0, index).map(
      (prev) =>
        ({
          [prev.field]: { equals: anchor[prev.field] },
        }) as Prisma.ExpenseWhereInput,
    )
    const dir = side === 'after' ? level.dir : flipDir(level.dir)
    const test = {
      [level.field]:
        dir === 'desc'
          ? { lt: anchor[level.field] }
          : { gt: anchor[level.field] },
    } as Prisma.ExpenseWhereInput
    return priorEquals.length > 0
      ? ({ AND: [...priorEquals, test] } as Prisma.ExpenseWhereInput)
      : test
  })
  return { OR: ors }
}

function compareSortKeys(
  a: ExpenseSortKey,
  b: ExpenseSortKey,
  levels: SortLevel[],
): number {
  for (const { field, dir } of levels) {
    const av = a[field]
    const bv = b[field]
    if (av < bv) return dir === 'desc' ? 1 : -1
    if (av > bv) return dir === 'desc' ? -1 : 1
  }
  return 0
}

function sortKeyOf(row: ExpenseListDbRow): ExpenseSortKey {
  return { id: row.id, expenseDate: row.expenseDate, createdAt: row.createdAt }
}

/**
 * Involvement-aware page for the collapsed timeline: up to `involvingLength`
 * involving expenses in sort order, plus the hidden expenses positioned between
 * the page's first involving expense and the next page's first involving
 * expense (peeked via `+1`), so the client renders inline hidden runs with no
 * gaps across page boundaries.
 *
 * Large hidden gaps are delivered in `hiddenChunk` slices: when a gap
 * overflows, the response carries the involving page plus the first slice and
 * reports `hiddenPending`, and the caller re-requests the same involving offset
 * with `hiddenSkipped` advanced (carry-over). Continuation responses contain
 * only the next hidden slice.
 */
export async function getGroupExpensesInvolvingPage(
  groupId: string,
  options: InvolvingPageOptions,
): Promise<InvolvingPageResult> {
  const empty: InvolvingPageResult = {
    rows: [],
    involvingReturned: 0,
    hasMoreInvolving: false,
    hiddenPending: false,
  }
  const ledgerId =
    options.ledgerId ??
    (
      await prisma.group.findUnique({
        where: { id: groupId },
        select: { ledgerId: true },
      })
    )?.ledgerId
  if (!ledgerId) return empty

  const length = options.involvingLength ?? 20
  const offset = options.involvingOffset ?? 0
  const chunk = options.hiddenChunk ?? INVOLVING_PAGE_HIDDEN_CHUNK
  const skipped = options.hiddenSkipped ?? 0
  const sortDir = options.sortDir ?? 'desc'
  const levels = involvingSortLevels(options.sortBy, sortDir)
  const orderBy = buildExpenseListOrderBy(options.sortBy, sortDir)

  const baseWhere = await buildExpenseListWhere(ledgerId, options)
  const involvement = involvementClause(
    options.involvingParticipantId,
    options.involvingAccountId,
  )

  const involvingRows = await prisma.expense.findMany({
    select: groupExpenseListCardSelect,
    where: mergeWhereAnd(baseWhere, involvement),
    orderBy,
    skip: offset,
    take: length + 1,
  })
  const pageInvolving = involvingRows.slice(0, length)
  const peek = involvingRows[length] ?? null
  if (pageInvolving.length === 0) return empty
  const first = pageInvolving[0]
  if (!first) return empty

  let hiddenWhere = mergeWhereAnd(
    mergeWhereAnd(baseWhere, { NOT: involvement }),
    anchorBoundFilter(sortKeyOf(first), levels, 'after'),
  )
  if (peek) {
    hiddenWhere = mergeWhereAnd(
      hiddenWhere,
      anchorBoundFilter(sortKeyOf(peek), levels, 'before'),
    )
  }
  const hiddenRows = await prisma.expense.findMany({
    select: groupExpenseListCardSelect,
    where: hiddenWhere,
    orderBy,
    skip: skipped,
    take: chunk + 1,
  })
  const hiddenPage = hiddenRows.slice(0, chunk)
  const hiddenPending = hiddenRows.length > chunk

  // Continuation responses carry only the next hidden slice — the involving
  // page was already delivered with the first slice.
  const fresh = skipped === 0
  const merged = fresh
    ? [...pageInvolving, ...hiddenPage].sort((a, b) =>
        compareSortKeys(sortKeyOf(a), sortKeyOf(b), levels),
      )
    : hiddenPage

  return {
    rows: merged.map(mapExpenseListRow),
    involvingReturned: fresh ? pageInvolving.length : 0,
    hasMoreInvolving: peek != null,
    hiddenPending,
  }
}

export async function getGroupExpenseCount(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return 0
  return prisma.expense.count({ where: { ledgerId: group.ledgerId } })
}

/**
 * Rank currencies previously used in the group (excluding the pinned group
 * ledger currency). Loads only `originalCurrency` + `expenseDate` within a
 * recency lookback so large ledgers stay cheap; scoring uses a 90-day half-life
 * (see `@spliit/domain` `rankCommonCurrencies`).
 */
export function mergeCurrencyRecommendations(
  groupCurrency: string | null | undefined,
  learnedCurrencyCodes: ReadonlyArray<string>,
): string[] {
  const recommendations: string[] = []
  const seen = new Set<string>()

  for (const code of learnedCurrencyCodes) {
    if (code === groupCurrency || seen.has(code)) continue
    if (!isSupportedCurrencyCode(code)) continue
    seen.add(code)
    recommendations.push(code)
    if (recommendations.length === COMMON_CURRENCY_LIMIT) break
  }

  return recommendations
}

export async function getGroupCommonCurrencies(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      ledgerId: true,
      ledger: { select: { currencyCode: true } },
    },
  })
  if (!group?.ledgerId) return [] as string[]

  const since = commonCurrencyLookbackDate()
  const rows = await prisma.expense.findMany({
    where: {
      ledgerId: group.ledgerId,
      expenseDate: { gte: since },
    },
    select: {
      originalCurrency: true,
      expenseDate: true,
    },
  })

  const learnedCurrencyCodes = rankCommonCurrencies(rows, {
    groupCurrency: group.ledger.currencyCode,
  })
  return mergeCurrencyRecommendations(
    group.ledger.currencyCode,
    learnedCurrencyCodes,
  )
}

export async function getExpense(groupId: string, expenseId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return null
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, ledgerId: group.ledgerId },
    include: {
      paidByList: { include: { ledgerParticipant: true } },
      paidFor: true,
      documents: true,
      recurringSeries: true,
      fileImportSource: { select: { provider: true } },
      items: {
        include: { paidFor: true },
      },
      itemizedRemainder: {
        include: { paidFor: true },
      },
    },
  })
  if (!expense) return null
  const previousExpense =
    expense.recurringSeries && expense.recurrenceSequence
      ? await prisma.expense.findFirst({
          where: {
            recurringSeriesId: expense.recurringSeriesId,
            recurrenceSequence: { lt: expense.recurrenceSequence },
          },
          orderBy: { recurrenceSequence: 'desc' },
          select: { id: true },
        })
      : null
  const nextExpense =
    expense.recurringSeries && expense.recurrenceSequence
      ? await prisma.expense.findFirst({
          where: {
            recurringSeriesId: expense.recurringSeriesId,
            recurrenceSequence: { gt: expense.recurrenceSequence },
          },
          orderBy: { recurrenceSequence: 'asc' },
          select: { id: true },
        })
      : null
  const { fileImportSource, ...expenseRest } = expense
  return {
    ...expenseRest,
    originType: fileImportSource?.provider ?? null,
    categoryId: narrowCategoryId(expense.categoryId),
    category: resolveCategory(expense.categoryId),
    recurrence: expense.recurringSeries
      ? toRecurrenceConfig(expense.recurringSeries)
      : null,
    previousExpenseId: previousExpense?.id ?? null,
    nextExpenseId: nextExpense?.id ?? null,
  }
}

export async function getRecurringExpenseSeries(
  groupId: string,
  options?: {
    cursor?: string
    limit?: number
    seriesId?: string
    occurrenceCursor?: number
    occurrenceLimit?: number
  },
) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return { series: [], nextCursor: null }
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100)
  const rows = await prisma.recurringExpenseSeries.findMany({
    where: {
      ledgerId: group.ledgerId,
      ...(options?.seriesId ? { id: options.seriesId } : {}),
    },
    orderBy: [{ anchorDate: 'desc' }, { id: 'desc' }],
    ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    take: limit + 1,
    include: {
      expenses: options?.seriesId
        ? {
            where: options.occurrenceCursor
              ? { recurrenceSequence: { gt: options.occurrenceCursor } }
              : undefined,
            orderBy: { recurrenceSequence: 'asc' },
            take: Math.min(Math.max(options.occurrenceLimit ?? 50, 1), 100) + 1,
            select: {
              id: true,
              expenseDate: true,
              expenseTimeZone: true,
              recurrenceSequence: true,
              title: true,
              amount: true,
            },
          }
        : false,
    },
  })
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  return {
    series: page.map((series) => {
      const expenses = Array.isArray(series.expenses) ? series.expenses : []
      const occurrenceLimit = options?.occurrenceLimit ?? 50
      return {
        id: series.id,
        timeZone: series.timeZone,
        frequency: series.frequency,
        interval: series.interval,
        anchorDate: series.anchorDate,
        nextOccurrenceDate: series.nextOccurrenceDate,
        endType: series.endType,
        occurrenceLimit: series.occurrenceLimit,
        endDate: series.endDate,
        occurrencesCreated: series.occurrencesCreated,
        status: series.status,
        recurrence: toRecurrenceConfig(series),
        expenses: expenses.slice(0, occurrenceLimit),
        hasMoreOccurrences: expenses.length > occurrenceLimit,
        nextOccurrenceCursor:
          expenses.length > occurrenceLimit
            ? (expenses[occurrenceLimit - 1]?.recurrenceSequence ?? null)
            : null,
      }
    }),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  }
}

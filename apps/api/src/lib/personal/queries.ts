import { Parser } from '@json2csv/plainjs'

import {
  prisma,
  type PersonalAttachment,
  type PersonalBudget,
  type PersonalProfile,
  type PersonalTransaction,
  type Prisma,
} from '@spliit/db'
import { formatAmountAsDecimal } from '@spliit/domain'
import {
  decodePersonalEntryCursor,
  encodePersonalEntryCursor,
  expandCategorySelection,
  getPersonalBudgetStatus,
  getPersonalMonthBounds,
  getPreviousPersonalMonthBounds,
  pickOverallPersonalBudget,
  sumPersonalBudgetAmounts,
  type PersonalEntryFilter,
  type PersonalTransactionKind,
} from '@spliit/domain'
import { getCurrency } from '@spliit/domain/currency'

import { ensurePersonalProfile, toIsoDate } from './profile'

export type PersonalEntryDto = {
  id: string
  kind: PersonalTransactionKind
  amount: number
  currencyCode: string
  originalAmount: number | null
  originalCurrency: string | null
  date: string
  categoryId: string
  title: string | null
  note: string | null
  version: number
  source: 'PERSONAL' | 'GROUP'
  group: { id: string; name: string } | null
  canEdit: boolean
  attachments: PersonalAttachmentDto[]
  recurring: { seriesId: string; sequence: number } | null
}

export type PersonalAttachmentDto = {
  id: string
  url: string
  fileName: string | null
  contentType: string | null
  width: number | null
  height: number | null
  createdAt: string
}

export type PersonalBudgetDto = {
  id: string
  name: string
  amount: number
  currencyCode: string
  period: 'MONTHLY'
  categoryScope: 'ALL' | 'SELECTED'
  categoryIds: string[]
  startDay: number
  archived: boolean
  spent: number
  remaining: number
  ratio: number
  projected: number
  state: 'OK' | 'TRENDING' | 'OVER'
}

export function toPersonalAttachment(
  row: PersonalAttachment,
): PersonalAttachmentDto {
  return {
    id: row.id,
    url: row.url,
    fileName: row.fileName,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
  }
}

type PersonalEntryRow = PersonalTransaction & {
  attachments?: PersonalAttachment[]
}

export function toPersonalEntry(row: PersonalEntryRow): PersonalEntryDto {
  return {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    currencyCode: row.currencyCode,
    originalAmount: row.originalAmount,
    originalCurrency: row.originalCurrency,
    date: toIsoDate(row.date),
    categoryId: row.categoryId,
    title: row.title,
    note: row.note,
    version: row.version,
    source: row.source,
    group:
      row.sourceGroupId && row.source === 'GROUP'
        ? {
            id: row.sourceGroupId,
            name: row.sourceGroupName ?? 'Group',
          }
        : null,
    canEdit: row.source === 'PERSONAL',
    attachments: (row.attachments ?? []).map(toPersonalAttachment),
    recurring:
      row.personalRecurringSeriesId && row.recurrenceSequence !== null
        ? {
            seriesId: row.personalRecurringSeriesId,
            sequence: row.recurrenceSequence!,
          }
        : null,
  }
}

function sharedGate(
  profile: PersonalProfile,
): Prisma.PersonalTransactionWhereInput {
  return profile.sharedEnabled ? {} : { source: 'PERSONAL' }
}

function entryWhere(
  accountId: string,
  filter: PersonalEntryFilter,
  profile: PersonalProfile,
): Prisma.PersonalTransactionWhereInput {
  const bounds =
    filter.from && filter.to
      ? {
          start: new Date(`${filter.from}T00:00:00.000Z`),
          end: new Date(`${filter.to}T00:00:00.000Z`),
        }
      : getPersonalMonthBounds(filter.month, profile.timeZone)

  const where: Prisma.PersonalTransactionWhereInput = {
    accountId,
    date: { gte: bounds.start, lte: bounds.end },
  }

  // The master gate is authoritative. Apply it after the caller's source
  // filter so `source: 'GROUP'` can never surface hidden linked rows.
  if (!profile.sharedEnabled) {
    where.source = 'PERSONAL'
  } else if (filter.source !== 'ALL') {
    where.source = filter.source
  }
  if (filter.kinds?.length) {
    where.kind = { in: filter.kinds }
  }
  if (filter.categoryIds?.length) {
    where.categoryId = {
      in: expandCategorySelection(filter.categoryIds),
    }
  }
  if (filter.q) {
    where.OR = [
      { title: { contains: filter.q, mode: 'insensitive' } },
      { note: { contains: filter.q, mode: 'insensitive' } },
    ]
  }
  if (filter.minAmount !== undefined || filter.maxAmount !== undefined) {
    where.amount = {
      ...(filter.minAmount !== undefined ? { gte: filter.minAmount } : {}),
      ...(filter.maxAmount !== undefined ? { lte: filter.maxAmount } : {}),
    }
  }

  const cursor = decodePersonalEntryCursor(filter.cursor)
  if (cursor && filter.sort === 'date') {
    const cursorDate = new Date(`${cursor.date}T00:00:00.000Z`)
    const cursorCondition: Prisma.PersonalTransactionWhereInput =
      filter.direction === 'desc'
        ? {
            OR: [
              { date: { lt: cursorDate } },
              { date: cursorDate, id: { lt: cursor.id } },
            ],
          }
        : {
            OR: [
              { date: { gt: cursorDate } },
              { date: cursorDate, id: { gt: cursor.id } },
            ],
          }
    where.AND = [cursorCondition]
  } else if (
    cursor &&
    filter.sort === 'amount' &&
    cursor.amount !== undefined
  ) {
    const cursorDate = new Date(`${cursor.date}T00:00:00.000Z`)
    const cursorCondition: Prisma.PersonalTransactionWhereInput =
      filter.direction === 'desc'
        ? {
            OR: [
              { amount: { lt: cursor.amount } },
              { amount: cursor.amount, date: { lt: cursorDate } },
              {
                amount: cursor.amount,
                date: cursorDate,
                id: { lt: cursor.id },
              },
            ],
          }
        : {
            OR: [
              { amount: { gt: cursor.amount } },
              { amount: cursor.amount, date: { lt: cursorDate } },
              {
                amount: cursor.amount,
                date: cursorDate,
                id: { lt: cursor.id },
              },
            ],
          }
    where.AND = [cursorCondition]
  }

  return where
}

export async function listPersonalEntries(
  accountId: string,
  filter: PersonalEntryFilter,
): Promise<{
  entries: PersonalEntryDto[]
  nextCursor: string | null
  totals: { spent: number; income: number; count: number }
}> {
  const profile = await ensurePersonalProfile(accountId)
  const where = entryWhere(accountId, filter, profile)
  const direction = filter.direction
  const orderBy: Prisma.PersonalTransactionOrderByWithRelationInput[] =
    filter.sort === 'amount'
      ? [{ amount: direction }, { date: 'desc' }, { id: 'desc' }]
      : [{ date: direction }, { id: direction }]

  const [rows, grouped] = await Promise.all([
    prisma.personalTransaction.findMany({
      where,
      orderBy,
      take: filter.limit + 1,
      include: { attachments: { orderBy: { createdAt: 'asc' } } },
    }),
    prisma.personalTransaction.groupBy({
      by: ['kind'],
      where: { ...where, AND: undefined },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ])

  const hasMore = rows.length > filter.limit
  const page = hasMore ? rows.slice(0, filter.limit) : rows
  const last = page.at(-1)
  const nextCursor =
    hasMore && last
      ? encodePersonalEntryCursor({
          date: toIsoDate(last.date),
          id: last.id,
          ...(filter.sort === 'amount' ? { amount: last.amount } : {}),
        })
      : null

  const totals = { spent: 0, income: 0, count: 0 }
  for (const row of grouped) {
    if (row.kind === 'EXPENSE') {
      totals.spent = row._sum.amount ?? 0
      totals.count += row._count._all
    }
    if (row.kind === 'INCOME') {
      totals.income = row._sum.amount ?? 0
      totals.count += row._count._all
    }
  }

  return {
    entries: page.map(toPersonalEntry),
    nextCursor,
    totals,
  }
}

export async function exportPersonalEntries(
  accountId: string,
  filter: PersonalEntryFilter,
): Promise<{ filename: string; csv: string; truncated: boolean }> {
  const profile = await ensurePersonalProfile(accountId)
  const where = entryWhere(accountId, filter, profile)
  // Cursors are a list concern; exports cover the whole filtered range.
  delete where.AND
  const maxRows = 10_000
  const fetched = await prisma.personalTransaction.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: maxRows + 1,
  })
  const truncated = fetched.length > maxRows
  const rows = truncated ? fetched.slice(0, maxRows) : fetched
  const fields = [
    'date',
    'kind',
    'amount',
    'currency',
    'categoryId',
    'title',
    'note',
    'source',
    'group',
    'originalAmount',
    'originalCurrency',
  ]
  // Prefix spreadsheet formula leads so a crafted title/note cannot execute
  // when the export is opened in Excel/Sheets.
  const safe = (value: string) =>
    /^[=+\-@\t\r]/.test(value.trimStart()) ? `'${value}` : value
  const records = rows.map((row) => {
    const currency = getCurrency(row.currencyCode)
    return {
      date: toIsoDate(row.date),
      kind: row.kind,
      amount: currency
        ? formatAmountAsDecimal(row.amount, currency)
        : String(row.amount),
      currency: row.currencyCode,
      categoryId: row.categoryId,
      title: safe(row.title ?? ''),
      note: safe(row.note ?? ''),
      source: row.source,
      group: safe(row.sourceGroupName ?? ''),
      originalAmount:
        row.originalAmount !== null && row.originalCurrency
          ? (() => {
              const original = getCurrency(row.originalCurrency!)
              return original
                ? formatAmountAsDecimal(row.originalAmount!, original)
                : String(row.originalAmount)
            })()
          : '',
      originalCurrency: row.originalCurrency ?? '',
    }
  })
  return {
    filename: `spliit-personal-${toIsoDate(new Date())}.csv`,
    csv: new Parser({ fields }).parse(records),
    truncated,
  }
}

function summarizeBudget(
  budget: PersonalBudget,
  entries: PersonalTransaction[],
  bounds: ReturnType<typeof getPersonalMonthBounds>,
): PersonalBudgetDto {
  const status = getPersonalBudgetStatus(
    {
      amount: budget.amount,
      categoryScope: budget.categoryScope,
      categoryIds: budget.categoryIds,
    },
    entries.map((entry) => ({
      kind: entry.kind,
      categoryId: entry.categoryId,
      amount: entry.amount,
      date: entry.date,
    })),
    bounds,
  )
  return {
    id: budget.id,
    name: budget.name,
    amount: budget.amount,
    currencyCode: budget.currencyCode,
    period: 'MONTHLY',
    categoryScope: budget.categoryScope,
    categoryIds: budget.categoryIds,
    startDay: budget.startDay,
    archived: budget.archived,
    spent: status.spent,
    remaining: status.remaining,
    ratio: status.ratio,
    projected: status.projected,
    state: status.state,
  }
}

export async function listPersonalBudgets(
  accountId: string,
  month?: string,
): Promise<{
  budgets: PersonalBudgetDto[]
  overallBudget: PersonalBudgetDto | null
}> {
  const profile = await ensurePersonalProfile(accountId)
  const bounds = getPersonalMonthBounds(month, profile.timeZone)
  const [budgets, entries] = await Promise.all([
    prisma.personalBudget.findMany({
      where: { accountId, archived: false },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.personalTransaction.findMany({
      where: {
        accountId,
        date: { gte: bounds.start, lte: bounds.end },
        ...sharedGate(profile),
      },
    }),
  ])

  const summaries = budgets.map((budget) =>
    summarizeBudget(budget, entries, bounds),
  )
  return {
    budgets: summaries,
    overallBudget: combineBudgetSummaries(summaries),
  }
}

/**
 * Hero budget: the explicit ALL budget when present, otherwise the sum of the
 * non-overlapping category budgets. A synthetic summary keeps the overview and
 * budget page consistent without inventing a persisted row.
 */
function combineBudgetSummaries(
  summaries: readonly PersonalBudgetDto[],
): PersonalBudgetDto | null {
  const overall = pickOverallPersonalBudget(summaries)
  if (overall) return overall
  if (summaries.length === 0) return null
  const amount = sumPersonalBudgetAmounts(summaries)
  const spent = summaries.reduce((total, budget) => total + budget.spent, 0)
  const projected = summaries.reduce(
    (total, budget) => total + budget.projected,
    0,
  )
  const remaining = amount - spent
  return {
    id: 'combined',
    name: 'Overall',
    amount,
    currencyCode: summaries[0]!.currencyCode,
    period: 'MONTHLY',
    categoryScope: 'ALL',
    categoryIds: [],
    startDay: 1,
    archived: false,
    spent,
    remaining,
    ratio: amount > 0 ? spent / amount : 0,
    projected,
    state: spent > amount ? 'OVER' : projected > amount ? 'TRENDING' : 'OK',
  }
}

export type PersonalOverviewDto = {
  month: string
  currencyCode: string
  spent: number
  income: number
  net: number
  previousSpent: number
  delta: number
  categories: Array<{
    categoryId: string
    amount: number
    percentage: number
  }>
  recent: PersonalEntryDto[]
  budgets: PersonalBudgetDto[]
  overallBudget: PersonalBudgetDto | null
  shared: {
    enabled: boolean
    count: number
    amount: number
    groups: Array<{
      groupId: string
      name: string
      count: number
      amount: number
    }>
  }
}

export async function getPersonalOverview(
  accountId: string,
  month?: string,
): Promise<PersonalOverviewDto> {
  const profile = await ensurePersonalProfile(accountId)
  const bounds = getPersonalMonthBounds(month, profile.timeZone)
  const previousBounds = getPreviousPersonalMonthBounds(bounds)

  const [entries, previous, budgets] = await Promise.all([
    prisma.personalTransaction.findMany({
      where: {
        accountId,
        date: { gte: bounds.start, lte: bounds.end },
        ...sharedGate(profile),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: { attachments: { orderBy: { createdAt: 'asc' } } },
    }),
    prisma.personalTransaction.aggregate({
      where: {
        accountId,
        kind: 'EXPENSE',
        date: { gte: previousBounds.start, lte: previousBounds.end },
        ...sharedGate(profile),
      },
      _sum: { amount: true },
    }),
    prisma.personalBudget.findMany({
      where: { accountId, archived: false },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  let spent = 0
  let income = 0
  const categories = new Map<string, number>()
  const groups = new Map<
    string,
    { name: string; count: number; amount: number }
  >()
  let sharedCount = 0
  let sharedAmount = 0

  for (const entry of entries) {
    if (entry.kind === 'INCOME') {
      income += entry.amount
      continue
    }
    spent += entry.amount
    categories.set(
      entry.categoryId,
      (categories.get(entry.categoryId) ?? 0) + entry.amount,
    )
    if (entry.source === 'GROUP') {
      sharedCount += 1
      sharedAmount += entry.amount
      if (entry.sourceGroupId) {
        const current = groups.get(entry.sourceGroupId) ?? {
          name: entry.sourceGroupName ?? 'Group',
          count: 0,
          amount: 0,
        }
        current.count += 1
        current.amount += entry.amount
        groups.set(entry.sourceGroupId, current)
      }
    }
  }

  const previousSpent = previous._sum.amount ?? 0
  const summaries = budgets.map((budget) =>
    summarizeBudget(budget, entries, bounds),
  )

  return {
    month: toIsoDate(bounds.start).slice(0, 7),
    currencyCode: profile.currencyCode,
    spent,
    income,
    net: income - spent,
    previousSpent,
    // Signed minor units: positive means more spent than the previous month.
    delta: spent - previousSpent,
    categories: Array.from(categories.entries())
      .map(([categoryId, amount]) => ({
        categoryId,
        amount,
        percentage: spent > 0 ? amount / spent : 0,
      }))
      .sort((a, b) => b.amount - a.amount),
    recent: entries.slice(0, 6).map(toPersonalEntry),
    budgets: summaries,
    overallBudget: combineBudgetSummaries(summaries),
    shared: {
      enabled: profile.sharedEnabled,
      count: sharedCount,
      amount: sharedAmount,
      groups: Array.from(groups.entries()).map(([groupId, value]) => ({
        groupId,
        ...value,
      })),
    },
  }
}

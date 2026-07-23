import type { Prisma } from '@spliit/db'
import { prisma } from '@spliit/db'
import {
  commonCurrencyLookbackDate,
  rankCommonCurrencies,
} from '@spliit/domain'
import { resolveParticipantDisplayName } from '../../invitations'
import { toRecurrenceConfig } from '../recurrence-series'
import { narrowCategoryId, resolveCategory } from './helpers'

export async function getGroupExpensesParticipants(groupId: string) {
  const expenses = await getGroupExpenses(groupId)
  return Array.from(
    new Set(
      expenses.flatMap((e) => [
        ...e.paidByList.map((pb) => pb.ledgerParticipant.id),
        ...e.paidFor.map((pf) => pf.ledgerParticipant.id),
      ]),
    ),
  )
}

type GetGroupExpensesSortBy = 'expenseDate' | 'createdAt' | 'amount'
type GetGroupExpensesSortDir = 'asc' | 'desc'
type GetGroupExpensesMatch = 'any' | 'all' | 'exact'

type GetGroupExpensesOptions = {
  offset?: number
  length?: number
  filter?: string
  hideReimbursements?: boolean
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
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return []

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

  const where: Prisma.ExpenseWhereInput = {
    ledgerId: group.ledgerId,
    title: options?.filter
      ? { contains: options.filter, mode: 'insensitive' }
      : undefined,
    isReimbursement: options?.hideReimbursements ? false : undefined,
    categoryId:
      options?.categories && options.categories.length > 0
        ? { in: options.categories }
        : undefined,
    originalCurrency:
      options?.currencies && options.currencies.length > 0
        ? { in: options.currencies }
        : undefined,
    expenseDate: expenseDateRange,
    amount: amountRange,
    ...(buildParticipantMatch(
      options?.paidBy,
      options?.paidByMatch,
      'paidByList',
    ) ?? {}),
    ...(buildParticipantMatch(
      options?.paidFor,
      options?.paidForMatch,
      'paidFor',
    ) ?? {}),
  }

  const sortField = options?.sortBy ?? 'expenseDate'
  const sortDir = options?.sortDir ?? 'desc'
  const primaryOrder: Prisma.ExpenseOrderByWithRelationInput = {
    [sortField]: sortDir,
  }
  const orderBy: Prisma.ExpenseOrderByWithRelationInput[] =
    sortField === 'expenseDate'
      ? [primaryOrder, { createdAt: 'desc' }]
      : [primaryOrder, { id: 'desc' }]

  const rows = await prisma.expense.findMany({
    select: {
      amount: true,
      conversionRate: true,
      conversionSource: true,
      categoryId: true,
      createdAt: true,
      expenseDate: true,
      id: true,
      recurrenceSequence: true,
      isReimbursement: true,
      originalAmount: true,
      originalCurrency: true,
      paidBySplitMode: true,
      paidByList: {
        select: {
          ledgerParticipant: {
            select: {
              id: true,
              groupMember: {
                select: {
                  account: { select: { id: true, name: true, image: true } },
                },
              },
              invitations: {
                select: { email: true, temporaryName: true },
                take: 1,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          shares: true,
        },
      },
      paidFor: {
        select: {
          ledgerParticipant: {
            select: {
              id: true,
              groupMember: {
                select: {
                  account: { select: { id: true, name: true, image: true } },
                },
              },
              invitations: {
                select: { email: true, temporaryName: true },
                take: 1,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          shares: true,
        },
      },
      splitMode: true,
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
        },
      },
      title: true,
      _count: { select: { documents: true } },
      items: {
        select: {
          id: true,
          title: true,
          unitPrice: true,
          quantity: true,
          amount: true,
          splitMode: true,
          paidFor: {
            select: {
              ledgerParticipantId: true,
              shares: true,
            },
          },
        },
      },
      itemizedRemainder: {
        select: {
          splitMode: true,
          paidFor: {
            select: {
              ledgerParticipantId: true,
              shares: true,
            },
          },
        },
      },
    },
    where,
    orderBy,
    skip: options && options.offset,
    take: options && options.length,
  })

  return rows.map((row) => ({
    ...row,
    paidByList: row.paidByList.map((pb) => ({
      ledgerParticipant: {
        id: pb.ledgerParticipant.id,
        name: resolveParticipantDisplayName(pb.ledgerParticipant),
        account: pb.ledgerParticipant.groupMember?.account ?? null,
      },
      shares: pb.shares,
    })),
    paidFor: row.paidFor.map((pf) => ({
      ledgerParticipant: {
        id: pf.ledgerParticipant.id,
        name: resolveParticipantDisplayName(pf.ledgerParticipant),
        account: pf.ledgerParticipant.groupMember?.account ?? null,
      },
      shares: pf.shares,
    })),
    items: (row.items ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((pf) => ({
        participant: pf.ledgerParticipantId,
        shares: pf.shares,
      })),
    })),
    itemizedRemainder: row.itemizedRemainder
      ? {
          splitMode: row.itemizedRemainder.splitMode,
          paidFor: row.itemizedRemainder.paidFor.map((pf) => ({
            participant: pf.ledgerParticipantId,
            shares: pf.shares,
          })),
        }
      : undefined,
    categoryId: narrowCategoryId(row.categoryId),
    category: resolveCategory(row.categoryId),
    conversionRate: row.conversionRate ?? null,
    conversionSource: row.conversionSource,
    recurringSeriesId: row.recurringSeries?.id ?? null,
    recurrenceSequence: row.recurrenceSequence,
    recurrence: row.recurringSeries
      ? toRecurrenceConfig(row.recurringSeries)
      : null,
    recurringSeriesStatus: row.recurringSeries?.status ?? null,
  }))
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
 * recency lookback so large ledgers stay cheap; scoring uses a 90-day
 * half-life (see `@spliit/domain` `rankCommonCurrencies`).
 */
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

  return rankCommonCurrencies(rows, {
    groupCurrency: group.ledger.currencyCode,
  })
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
  return {
    ...expense,
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

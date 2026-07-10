import {
  getBalances,
  type BalanceExpense,
  type CategoryId,
} from '@spliit/domain'

export const statsPeriods = [
  'LATEST_ACTIVITY',
  'WEEK',
  'MONTH',
  'QUARTER',
  'YEAR',
  'CUSTOM',
] as const

export type StatsPeriod = (typeof statsPeriods)[number]

export type StatsExpense = BalanceExpense & {
  expenseDate: Date
  categoryId: CategoryId
  isReimbursement: boolean
}

type Granularity = 'DAY' | 'WEEK' | 'MONTH'

export type StatsCustomRange = {
  from: Date
  to: Date
}

type Bucket = {
  type: 'bucket'
  start: Date
  categories: Array<{ categoryId: CategoryId; amount: number }>
  total: number
}

type Gap = {
  type: 'gap'
  start: Date
  end: Date
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
}

function addDays(date: Date, days: number): Date {
  const next = startOfDay(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + months
  const day = Math.min(
    date.getUTCDate(),
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
  )
  return new Date(Date.UTC(year, month, day))
}

function dayDistance(from: Date, to: Date): number {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000,
  )
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date)
  const weekDay = start.getUTCDay() || 7
  return addDays(start, 1 - weekDay)
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function bucketStart(date: Date, granularity: Granularity): Date {
  switch (granularity) {
    case 'DAY':
      return startOfDay(date)
    case 'WEEK':
      return startOfWeek(date)
    case 'MONTH':
      return startOfMonth(date)
  }
}

function nextBucket(date: Date, granularity: Granularity): Date {
  switch (granularity) {
    case 'DAY':
      return addDays(date, 1)
    case 'WEEK':
      return addDays(date, 7)
    case 'MONTH':
      return addMonths(date, 1)
  }
}

function getLatestActivityStart(expenses: StatsExpense[]): Date {
  const dates = expenses
    .map((expense) => startOfDay(expense.expenseDate))
    .sort((a, b) => b.getTime() - a.getTime())
  let start = dates[0]

  for (let index = 1; index < dates.length; index += 1) {
    if (dayDistance(dates[index], dates[index - 1]) > 60) break
    start = dates[index]
  }

  return start
}

function granularityForSpan(from: Date, to: Date): Granularity {
  const span = dayDistance(from, to)
  return span <= 14 ? 'DAY' : span <= 90 ? 'WEEK' : 'MONTH'
}

function rangeFor(
  expenses: StatsExpense[],
  period: StatsPeriod,
  customRange?: StatsCustomRange,
): { from: Date; to: Date; granularity: Granularity } {
  const latest = expenses.reduce(
    (max, expense) =>
      expense.expenseDate.getTime() > max.getTime() ? expense.expenseDate : max,
    expenses[0].expenseDate,
  )
  const to = startOfDay(latest)

  if (period === 'LATEST_ACTIVITY') {
    const from = getLatestActivityStart(expenses)
    return {
      from,
      to,
      granularity: granularityForSpan(from, to),
    }
  }

  if (period === 'CUSTOM' && customRange) {
    const from = startOfDay(customRange.from)
    const customTo = startOfDay(customRange.to)
    return {
      from,
      to: customTo,
      granularity: granularityForSpan(from, customTo),
    }
  }

  if (period === 'CUSTOM') {
    return { from: to, to, granularity: 'DAY' }
  }

  switch (period) {
    case 'WEEK':
      return { from: addDays(to, -6), to, granularity: 'DAY' }
    case 'MONTH':
      return { from: addDays(to, -29), to, granularity: 'WEEK' }
    case 'QUARTER':
      return { from: addMonths(to, -3), to, granularity: 'WEEK' }
    case 'YEAR':
      return { from: addMonths(to, -11), to, granularity: 'MONTH' }
  }
}

function collapseInactiveBuckets(buckets: Bucket[]): Array<Bucket | Gap> {
  const timeline: Array<Bucket | Gap> = []

  for (let index = 0; index < buckets.length;) {
    const bucket = buckets[index]
    if (bucket.total !== 0) {
      timeline.push(bucket)
      index += 1
      continue
    }

    const emptyStart = index
    while (index < buckets.length && buckets[index].total === 0) index += 1
    const emptyCount = index - emptyStart
    if (emptyCount === 1) {
      timeline.push(bucket)
      continue
    }

    timeline.push({
      type: 'gap',
      start: buckets[emptyStart].start,
      end: buckets[index - 1].start,
    })
  }

  return timeline
}

export function buildGroupStatsDashboard(
  rows: StatsExpense[],
  period: StatsPeriod,
  customRange?: StatsCustomRange,
) {
  const expenses = rows.filter(
    (expense) => !expense.isReimbursement && expense.amount > 0,
  )
  const lifetimeTotal = expenses.reduce(
    (total, expense) => total + expense.amount,
    0,
  )

  if (expenses.length === 0) {
    return {
      lifetimeTotal,
      period: null,
      timeline: [],
      categories: [],
      participants: [],
    }
  }

  const range = rangeFor(expenses, period, customRange)
  const selectedExpenses = expenses.filter((expense) => {
    const date = startOfDay(expense.expenseDate)
    return date >= range.from && date <= range.to
  })
  const categoryTotals = new Map<CategoryId, number>()
  const participantNames = new Map<string, string>()

  for (const expense of selectedExpenses) {
    categoryTotals.set(
      expense.categoryId,
      (categoryTotals.get(expense.categoryId) ?? 0) + expense.amount,
    )
    for (const participant of [...expense.paidFor, ...expense.paidByList]) {
      participantNames.set(
        participant.participant.id,
        participant.participant.name ?? '',
      )
    }
  }

  const buckets = new Map<string, Bucket>()
  for (
    let date = bucketStart(range.from, range.granularity);
    date <= range.to;
    date = nextBucket(date, range.granularity)
  ) {
    buckets.set(date.toISOString(), {
      type: 'bucket',
      start: date,
      categories: [],
      total: 0,
    })
  }

  for (const expense of selectedExpenses) {
    const start = bucketStart(expense.expenseDate, range.granularity)
    const bucket = buckets.get(start.toISOString())
    if (!bucket) continue
    bucket.total += expense.amount
    const category = bucket.categories.find(
      (item) => item.categoryId === expense.categoryId,
    )
    if (category) category.amount += expense.amount
    else
      bucket.categories.push({
        categoryId: expense.categoryId,
        amount: expense.amount,
      })
  }

  const nonEmptyBuckets = Array.from(buckets.values()).filter(
    (bucket) => bucket.total > 0,
  )
  const firstBucket = nonEmptyBuckets[0]?.start
  const lastBucket = nonEmptyBuckets.at(-1)?.start
  const visibleBuckets = Array.from(buckets.values()).filter((bucket) =>
    firstBucket != null && lastBucket != null
      ? bucket.start >= firstBucket && bucket.start <= lastBucket
      : false,
  )
  const selectedTotal = selectedExpenses.reduce(
    (total, expense) => total + expense.amount,
    0,
  )
  const balances = getBalances(selectedExpenses)

  return {
    lifetimeTotal,
    period: {
      from: range.from,
      to: range.to,
      granularity: range.granularity,
      total: selectedTotal,
      expenseCount: selectedExpenses.length,
    },
    timeline: collapseInactiveBuckets(visibleBuckets),
    categories: Array.from(categoryTotals, ([categoryId, amount]) => ({
      categoryId,
      amount,
      percentage: selectedTotal === 0 ? 0 : amount / selectedTotal,
    })).sort((a, b) => b.amount - a.amount),
    participants: Object.entries(balances)
      .map(([participantId, balance]) => ({
        participantId,
        name: participantNames.get(participantId) ?? '',
        amount: balance.paidFor,
        percentage: selectedTotal === 0 ? 0 : balance.paidFor / selectedTotal,
      }))
      .filter((participant) => participant.amount > 0)
      .sort((a, b) => b.amount - a.amount),
  }
}

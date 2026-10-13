import {
  dateOnlyInTimeZone,
  distributeRemainder,
  exactZero,
  getBalances,
  getExactBalances,
  INCOME_CATEGORY_ID,
  isSettlementCategory,
  truncExactAmount,
  type ExactAmount,
} from '@spliit/domain'

import {
  toBalanceExpense,
  type BalanceExpenseRow,
} from '../../../../lib/api/selects/balance-expense'
import type {
  OverviewStatsInput,
  OverviewStatsOutput,
} from '../../../outputs/overview-stats'

export type StatsLedger = {
  id: string
  groupId: string
  name: string
  currency: string
  currencyCode: string | null
  participantId: string | null
}

export function resolveOverviewStatsRange(
  input: OverviewStatsInput,
  now = new Date(),
) {
  if (input.period === 'ALL_TIME') return { from: null, to: null }
  if (input.period === 'CUSTOM') return input.customRange!
  const today = dateOnlyInTimeZone(now, input.timeZone)
  const start = new Date(today)
  if (input.period === 'LAST_MONTH') {
    start.setUTCDate(1)
    const end = new Date(start)
    end.setUTCDate(0)
    start.setUTCMonth(start.getUTCMonth() - 1)
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    }
  }
  switch (input.period) {
    case 'WEEK':
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
      break
    case 'MONTH':
      start.setUTCDate(1)
      break
    case 'QUARTER':
      start.setUTCDate(1)
      start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3)
      break
    case 'YEAR':
      start.setUTCMonth(0, 1)
      break
  }
  return {
    from: start.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  }
}

/** Conservative UTC bounds for filtering stored expense-local dates. */
export function overviewStatsDateBounds(range: {
  from: string | null
  to: string | null
}) {
  if (!range.from || !range.to) return undefined
  // Padding covers all supported IANA offsets, including DST.
  return {
    gte: new Date(Date.parse(`${range.from}T00:00:00Z`) - 2 * 86_400_000),
    lt: new Date(Date.parse(`${range.to}T00:00:00Z`) + 3 * 86_400_000),
  }
}

const emptyAmounts = () => ({ expenses: 0, income: 0, netSpending: 0 })
type Amounts = ReturnType<typeof emptyAmounts>
function addContribution(target: Amounts, amount: number, income: boolean) {
  if (income) target.income -= amount
  else target.expenses += amount
  target.netSpending = target.expenses - target.income
}

/**
 * Round once per ledger and reporting partition, as ledger totals do. Allocate
 * that participant's residual cents across transactions before constructing
 * breakdowns, so every breakdown reconciles with its summary.
 */
function allocatedContributions(
  rows: BalanceExpenseRow[],
  ledger: StatsLedger,
  shared: boolean,
) {
  if (shared) return new Map(rows.map((row) => [row.id, row.amount]))
  const participantId = ledger.participantId
  if (!participantId) return new Map<string, number>()
  const expenses = rows.map(toBalanceExpense)
  const amount = getBalances(expenses)[participantId]?.paidFor ?? 0
  const exact: Record<string, ExactAmount> = {}
  for (const expense of expenses) {
    const share =
      getExactBalances([expense]).paidFor[participantId] ?? exactZero()
    // Do not assign residual cents to transactions with no allocated share.
    if (share.numerator !== 0n) exact[expense.id!] = share
  }
  const contributions = Object.fromEntries(
    Object.entries(exact).map(([id, share]) => [id, truncExactAmount(share)]),
  )
  const truncatedTotal = Object.values(contributions).reduce(
    (sum, contribution) => sum + contribution,
    0,
  )
  const residual = amount - truncatedTotal
  if (residual === 0) return new Map(Object.entries(contributions))
  // Largest absolute fractions can belong to a refund when adding a cent,
  // or to a purchase when subtracting one. Only round shares away from zero
  // in the residual's direction; retain the other transactions' truncations.
  const candidates = Object.fromEntries(
    Object.entries(exact).filter(([, share]) =>
      residual > 0 ? share.numerator > 0n : share.numerator < 0n,
    ),
  )
  const candidateTotal = Object.keys(candidates).reduce(
    (sum, id) => sum + contributions[id],
    0,
  )
  return new Map(
    Object.entries({
      ...contributions,
      ...distributeRemainder(candidates, candidateTotal + residual),
    }),
  )
}

export function aggregateOverviewStats(
  ledgers: StatsLedger[],
  rows: BalanceExpenseRow[],
  input: OverviewStatsInput,
  now = new Date(),
): Pick<
  OverviewStatsOutput,
  'filters' | 'range' | 'granularity' | 'coverage' | 'currencies'
> {
  const range = resolveOverviewStatsRange(input, now)
  const bounds = overviewStatsDateBounds(range)
  const ledgerIds = new Set(ledgers.map((ledger) => ledger.id))
  const dates = new Map<string, string>()
  const selected = rows.filter((row) => {
    if (!ledgerIds.has(row.ledgerId) || isSettlementCategory(row.categoryId))
      return false
    if (
      bounds &&
      (row.expenseDate < bounds.gte || row.expenseDate >= bounds.lt)
    )
      return false
    const date = dateOnlyInTimeZone(row.expenseDate, row.expenseTimeZone)
      .toISOString()
      .slice(0, 10)
    dates.set(row.id, date)
    return (
      (!range.from || date >= range.from) && (!range.to || date <= range.to)
    )
  })
  if (input.period === 'ALL_TIME' && selected.length > 0) {
    const selectedDates = selected.map((row) => dates.get(row.id)!).sort()
    range.from = selectedDates[0]
    range.to = selectedDates.at(-1)!
  }
  const span =
    range.from && range.to
      ? (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000
      : 0
  const granularity = span > 90 ? 'MONTH' : span > 14 ? 'WEEK' : 'DAY'
  const rowsByLedger = new Map<string, BalanceExpenseRow[]>()
  for (const row of selected) {
    const list = rowsByLedger.get(row.ledgerId) ?? []
    list.push(row)
    rowsByLedger.set(row.ledgerId, list)
  }
  const currencies = new Map<
    string,
    OverviewStatsOutput['currencies'][number]
  >()
  const timelineByCurrency = new Map<
    string,
    Map<string, OverviewStatsOutput['currencies'][number]['timeline'][number]>
  >()
  const categoriesByCurrency = new Map<
    string,
    Map<string, OverviewStatsOutput['currencies'][number]['categories'][number]>
  >()
  const shared = input.person.kind === 'SHARED'
  for (const ledger of ledgers) {
    const key = ledger.currencyCode
      ? `code:${ledger.currencyCode}`
      : `custom:${ledger.currency}`
    let currency = currencies.get(key)
    if (!currency) {
      currency = {
        key,
        currency: ledger.currency,
        currencyCode: ledger.currencyCode,
        ...emptyAmounts(),
        transactionCount: 0,
        ledgerCount: 0,
        timeline: [],
        categories: [],
        ledgers: [],
      }
      currencies.set(key, currency)
      timelineByCurrency.set(key, new Map())
      categoriesByCurrency.set(key, new Map())
    }
    if (!shared && !ledger.participantId) continue
    const ledgerRows = rowsByLedger.get(ledger.id) ?? []
    const detail = {
      groupId: ledger.groupId,
      name: ledger.name,
      ...emptyAmounts(),
    }
    let contributes = false
    // Income and spending/refunds have independent reporting totals.
    for (const income of [false, true]) {
      const partition = ledgerRows.filter(
        (row) => (row.categoryId === INCOME_CATEGORY_ID) === income,
      )
      const amounts = allocatedContributions(partition, ledger, shared)
      for (const row of partition) {
        if (shared ? row.amount === 0 : !amounts.has(row.id)) continue
        const amount = amounts.get(row.id) ?? 0
        contributes = true
        currency.transactionCount += 1
        addContribution(currency, amount, income)
        addContribution(detail, amount, income)
        const date = dates.get(row.id)!
        const bucketStart = new Date(`${date}T00:00:00Z`)
        if (granularity === 'WEEK') {
          bucketStart.setUTCDate(
            bucketStart.getUTCDate() - ((bucketStart.getUTCDay() + 6) % 7),
          )
        }
        const bucketDate =
          granularity === 'MONTH'
            ? `${date.slice(0, 7)}-01`
            : bucketStart.toISOString().slice(0, 10)
        let bucket = timelineByCurrency.get(key)!.get(bucketDate)
        if (!bucket) {
          bucket = { date: bucketDate, ...emptyAmounts() }
          timelineByCurrency.get(key)!.set(bucketDate, bucket)
          currency.timeline.push(bucket)
        }
        addContribution(bucket, amount, income)
        if (!income) {
          let category = categoriesByCurrency.get(key)!.get(row.categoryId)
          if (!category) {
            category = { categoryId: row.categoryId, amount: 0 }
            categoriesByCurrency.get(key)!.set(row.categoryId, category)
            currency.categories.push(category)
          }
          category.amount += amount
        }
      }
    }
    if (contributes) {
      currency.ledgerCount += 1
      currency.ledgers.push(detail)
    }
  }
  for (const currency of currencies.values()) {
    currency.timeline.sort((a, b) => a.date.localeCompare(b.date))
    currency.categories.sort(
      (a, b) => b.amount - a.amount || a.categoryId.localeCompare(b.categoryId),
    )
    currency.ledgers.sort((a, b) => a.groupId.localeCompare(b.groupId))
  }
  return {
    filters: input,
    range,
    granularity,
    coverage: {
      eligibleLedgerCount: ledgers.length,
      unavailableLedgerCount:
        input.person.kind === 'ME'
          ? ledgers.filter((ledger) => !ledger.participantId).length
          : 0,
    },
    currencies: [...currencies.values()].sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
  }
}

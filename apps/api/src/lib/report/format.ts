import {
  formatCurrency,
  getCurrency,
  isRtlLocale,
  resolveFormattingLocale,
  type Locale,
} from '@spliit/domain'

import type { ReportLabels } from './labels'
import type { ExpenseReportModel } from './model'

export { isRtlLocale } from '@spliit/domain'

export type ReportDirection = 'ltr' | 'rtl'
export type ReportPageSize = 'A4' | 'LETTER'

/**
 * Territories that standardize on LETTER (inch) rather than A4. ISO 216
 * A-series is the default everywhere else. `en-*` alone is not a proxy — e.g.
 * `en-GB` is A4 — so we check the region tag explicitly.
 */
const LETTER_REGIONS = new Set([
  'US',
  'CA',
  'MX',
  'CL',
  'CO',
  'VE',
  'PA',
  'PH',
  'GT',
  'CR',
  'DO',
  'PR',
  'NI',
  'SV',
  'HN',
])

export function pageSizeFor(locale: Locale): ReportPageSize {
  let region: string | undefined
  try {
    region = new Intl.Locale(resolveFormattingLocale(locale)).region
  } catch {
    region = undefined
  }
  if (region && LETTER_REGIONS.has(region.toUpperCase())) return 'LETTER'
  return 'A4'
}

export type ExpenseReportViewModel = {
  direction: ReportDirection
  pageSize: ReportPageSize
  title: string
  groupName: string
  generatedOn: string
  periodRange: string
  asOfDate: string
  metrics: {
    total: string
    expenseCount: string
    participantCount: string
  }
  participants: Array<{
    id: string
    name: string
    paid: string
    share: string
    balance: string
  }>
  suggestedSettlements: Array<{ from: string; to: string; amount: string }>
  recordedSettlements: Array<{
    date: string
    from: string
    to: string
    amount: string
  }>
  expenses: Array<{
    id: string
    date: string
    title: string
    category: string
    amount: string
    payers: Array<{ id: string; name: string; amount: string }>
    shares: Array<{ id: string; name: string; amount: string }>
    conversionNote: string | null
  }>
}

const participantNames = new WeakMap<ExpenseReportModel, Map<string, string>>()

function participantName(
  model: ExpenseReportModel,
  participantId: string,
): string {
  let map = participantNames.get(model)
  if (!map) {
    map = new Map(
      model.participants.map((participant) => [
        participant.id,
        participant.name,
      ]),
    )
    participantNames.set(model, map)
  }
  return map.get(participantId) ?? '—'
}

function joinNames(names: string[]): string {
  const nonEmpty = names.filter(Boolean)
  if (nonEmpty.length === 0) return '—'
  return nonEmpty.join(' + ')
}

export function formatExpenseReport(
  model: ExpenseReportModel,
  locale: Locale,
  labels: ReportLabels,
  options?: { timeZone?: string; generatedOn?: Date },
): ExpenseReportViewModel {
  const direction = isRtlLocale(locale) ? 'rtl' : 'ltr'
  const formattingLocale = resolveFormattingLocale(locale)
  const ledgerCurrency =
    getCurrency(model.currencyCode) ??
    ({
      code: model.currencyCode,
      symbol: model.currencySymbol,
      rounding: 0,
      decimal_digits: model.currencyDecimalDigits,
    } as const)
  const formatAmount = (amount: number) =>
    formatCurrency(ledgerCurrency, amount, formattingLocale)
  // Validate viewer time zone once; fall back to UTC for stale/invalid values
  // rather than crashing the report request.
  let reportTimeZone = 'UTC'
  if (options?.timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: options.timeZone }).format()
      reportTimeZone = options.timeZone
    } catch {
      reportTimeZone = 'UTC'
    }
  }
  // Date-only report bounds are UTC midnights; render calendar days in the
  // *viewer's* wall time so Jun 30 22:00-04:00 EDT does not display as Jul 1.
  // `generatedOn` also uses viewer wall time per Q3.
  const dateOnlyFormat = new Intl.DateTimeFormat(formattingLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: reportTimeZone,
  })
  const formatDate = (isoDate: string) => {
    const [year, month, day] = isoDate.split('-').map(Number)
    return dateOnlyFormat.format(new Date(Date.UTC(year, month - 1, day)))
  }

  const categoryNames = (categoryId: string) =>
    labels.categoryNames[categoryId] ?? categoryId

  const generatedOn = dateOnlyFormat.format(options?.generatedOn ?? new Date())

  return {
    direction,
    pageSize: pageSizeFor(locale),
    title: labels.title,
    groupName: model.groupName,
    generatedOn,
    periodRange: `${formatDate(model.from)} – ${formatDate(model.to)}`,
    asOfDate: formatDate(model.to),
    metrics: {
      total: formatAmount(model.period.total),
      expenseCount: new Intl.NumberFormat(formattingLocale).format(
        model.period.expenseCount,
      ),
      participantCount: new Intl.NumberFormat(formattingLocale).format(
        model.participants.length,
      ),
    },
    participants: model.participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      paid: formatAmount(participant.periodPaid),
      share: formatAmount(participant.periodShare),
      balance: formatAmount(participant.balanceAsOf),
    })),
    suggestedSettlements: model.suggestedSettlements.map((settlement) => ({
      from: participantName(model, settlement.from),
      to: participantName(model, settlement.to),
      amount: formatAmount(settlement.amount),
    })),
    recordedSettlements: model.recordedSettlements.map((settlement) => ({
      date: formatDate(settlement.date),
      from: joinNames(
        settlement.fromIds.map((id) => participantName(model, id)),
      ),
      to: joinNames(settlement.toIds.map((id) => participantName(model, id))),
      amount: formatAmount(settlement.amount),
    })),
    expenses: model.expenses.map((expense) => {
      const payers = expense.payers.map((payer) => ({
        id: payer.participantId,
        name: participantName(model, payer.participantId),
        amount: formatAmount(payer.amount),
      }))
      const shares = expense.shares.map((share) => ({
        id: share.participantId,
        name: participantName(model, share.participantId),
        amount: formatAmount(share.amount),
      }))
      let conversionNote: string | null = null
      if (expense.originalAmount != null && expense.originalCurrency) {
        const originalCurrency =
          getCurrency(expense.originalCurrency) ??
          ({
            code: expense.originalCurrency,
            symbol: expense.originalCurrency,
            rounding: 0,
            decimal_digits: 2,
          } as const)
        const rate =
          expense.conversionRate == null
            ? null
            : `1 ${expense.originalCurrency} = ${formatCurrency(ledgerCurrency, Number(expense.conversionRate), formattingLocale, true)}`
        const originalText = formatCurrency(
          originalCurrency,
          expense.originalAmount,
          formattingLocale,
        )
        conversionNote =
          rate == null
            ? `${labels.originalAmountLabel} ${originalText}`
            : `${labels.originalAmountLabel} ${originalText} (${rate})`
      }
      return {
        id: expense.id,
        date: formatDate(expense.date),
        title: expense.title,
        category: categoryNames(expense.categoryId),
        amount: formatAmount(expense.amount),
        payers,
        shares,
        conversionNote,
      }
    }),
  }
}

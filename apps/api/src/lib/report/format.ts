import {
  isRtlLocale,
  resolveFormattingLocale,
  type Locale,
} from '@spliit/domain'

import type { ReportLabels } from './labels'
import type { ExpenseReportModel } from './model'

export { isRtlLocale } from '@spliit/domain'

export type ReportDirection = 'ltr' | 'rtl'
export type ReportPageSize = 'A4' | 'LETTER'

/** LETTER for en-US, A4 for every other supported locale. */
export function pageSizeFor(locale: Locale): ReportPageSize {
  return locale === 'en-US' ? 'LETTER' : 'A4'
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
): ExpenseReportViewModel {
  const direction = isRtlLocale(locale) ? 'rtl' : 'ltr'
  const formattingLocale = resolveFormattingLocale(locale)
  const currencyCode = model.currencyCode
  const currencyFormat = new Intl.NumberFormat(formattingLocale, {
    style: 'currency',
    currency: currencyCode,
  })
  const formatAmount = (amount: number) => currencyFormat.format(amount / 100)
  // Date-only report bounds are UTC midnights; force UTC so a non-UTC API
  // host does not shift `2026-07-01` to the previous local calendar day.
  const dateOnlyFormat = new Intl.DateTimeFormat(formattingLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const formatDate = (isoDate: string) => {
    const [year, month, day] = isoDate.split('-').map(Number)
    return dateOnlyFormat.format(new Date(Date.UTC(year, month - 1, day)))
  }

  const categoryNames = (categoryId: string) =>
    labels.categoryNames[categoryId] ?? categoryId

  const generatedOn = dateOnlyFormat.format(new Date())

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
        const originalFormat = new Intl.NumberFormat(formattingLocale, {
          style: 'currency',
          currency: expense.originalCurrency,
        })
        const rate =
          expense.conversionRate != null
            ? `1 ${expense.originalCurrency} = ${formatAmount(
                Math.round(Number(expense.conversionRate) * 100),
              )}`
            : null
        conversionNote =
          rate != null
            ? `${labels.originalAmountLabel} ${originalFormat.format(expense.originalAmount / 100)} (${rate})`
            : `${labels.originalAmountLabel} ${originalFormat.format(expense.originalAmount / 100)}`
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

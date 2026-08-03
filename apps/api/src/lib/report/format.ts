import type { Locale } from '@spliit/domain'

import type { ReportLabels } from './labels'
import type { ExpenseReportModel } from './model'

export type ReportDirection = 'ltr' | 'rtl'
export type ReportPageSize = 'A4' | 'LETTER'

const RTL_LOCALES: ReadonlySet<string> = new Set(['he', 'ar-SA', 'ur-PK'])

export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.has(locale)
}

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
    name: string
    paid: string
    share: string
    balance: string
  }>
  settlements: Array<{ from: string; to: string; amount: string }>
  reimbursements: Array<{
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
    payers: Array<{ name: string; amount: string }>
    shares: Array<{ name: string; amount: string }>
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
  const currencyCode = model.currencyCode
  const currencyFormat = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
  })
  const formatAmount = (amount: number) => currencyFormat.format(amount / 100)
  const dateFormat = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  const formatDate = (isoDate: string) => {
    const [year, month, day] = isoDate.split('-').map(Number)
    return dateFormat.format(new Date(Date.UTC(year, month - 1, day)))
  }

  const categoryNames = (categoryId: string) =>
    labels.categoryNames[categoryId] ?? categoryId

  const generatedOn = dateFormat.format(new Date())

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
      expenseCount: new Intl.NumberFormat(locale).format(
        model.period.expenseCount,
      ),
      participantCount: new Intl.NumberFormat(locale).format(
        model.participants.length,
      ),
    },
    participants: model.participants.map((participant) => ({
      name: participant.name,
      paid: formatAmount(participant.periodPaid),
      share: formatAmount(participant.periodShare),
      balance: formatAmount(participant.balanceAsOf),
    })),
    settlements: model.settlements.map((settlement) => ({
      from: participantName(model, settlement.from),
      to: participantName(model, settlement.to),
      amount: formatAmount(settlement.amount),
    })),
    reimbursements: model.reimbursements.map((reimbursement) => ({
      date: formatDate(reimbursement.date),
      from: joinNames(
        reimbursement.fromIds.map((id) => participantName(model, id)),
      ),
      to: joinNames(
        reimbursement.toIds.map((id) => participantName(model, id)),
      ),
      amount: formatAmount(reimbursement.amount),
    })),
    expenses: model.expenses.map((expense) => {
      const payers = expense.payers.map((payer) => ({
        name: participantName(model, payer.participantId),
        amount: formatAmount(payer.amount),
      }))
      const shares = expense.shares.map((share) => ({
        name: participantName(model, share.participantId),
        amount: formatAmount(share.amount),
      }))
      let conversionNote: string | null = null
      if (expense.originalAmount != null && expense.originalCurrency) {
        const originalFormat = new Intl.NumberFormat(locale, {
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

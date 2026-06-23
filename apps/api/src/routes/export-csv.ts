import { Parser } from '@json2csv/plainjs'
import { prisma } from '@spliit/db'
import {
  formatAmountAsDecimal,
  getCurrency,
  getCurrencyFromGroup,
} from '@spliit/domain'
import contentDisposition from 'content-disposition'

const splitModeLabel = {
  EVENLY: 'Evenly',
  BY_SHARES: 'Unevenly - By shares',
  BY_PERCENTAGE: 'Unevenly - By percentage',
  BY_AMOUNT: 'Unevenly - By amount',
} as const

function formatDate(dateValue: Date): string {
  const date = new Date(dateValue)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function exportGroupCsv(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      currency: true,
      currencyCode: true,
      expenses: {
        select: {
          expenseDate: true,
          title: true,
          category: { select: { name: true } },
          amount: true,
          originalAmount: true,
          originalCurrency: true,
          conversionRate: true,
          paidById: true,
          paidFor: { select: { participantId: true, shares: true } },
          isReimbursement: true,
          splitMode: true,
        },
      },
      participants: { select: { id: true, name: true } },
    },
  })

  if (!group) {
    return Response.json({ error: 'Invalid group ID' }, { status: 404 })
  }

  const fields = [
    { label: 'Date', value: 'date' },
    { label: 'Description', value: 'title' },
    { label: 'Category', value: 'categoryName' },
    { label: 'Currency', value: 'currency' },
    { label: 'Cost', value: 'amount' },
    { label: 'Original cost', value: 'originalAmount' },
    { label: 'Original currency', value: 'originalCurrency' },
    { label: 'Conversion rate', value: 'conversionRate' },
    { label: 'Is Reimbursement', value: 'isReimbursement' },
    { label: 'Split mode', value: 'splitMode' },
    ...group.participants.map((participant) => ({
      label: participant.name,
      value: participant.name,
    })),
  ]

  const currency = getCurrencyFromGroup(group)
  const expenses = group.expenses.map((expense) => ({
    date: formatDate(expense.expenseDate),
    title: expense.title,
    categoryName: expense.category?.name || '',
    currency: group.currencyCode ?? group.currency,
    amount: formatAmountAsDecimal(expense.amount, currency),
    originalAmount: expense.originalAmount
      ? formatAmountAsDecimal(
          expense.originalAmount,
          getCurrency(expense.originalCurrency),
        )
      : null,
    originalCurrency: expense.originalCurrency,
    conversionRate: expense.conversionRate
      ? expense.conversionRate.toString()
      : null,
    isReimbursement: expense.isReimbursement ? 'Yes' : 'No',
    splitMode: splitModeLabel[expense.splitMode],
    ...Object.fromEntries(
      group.participants.map((participant) => {
        const { totalShares, participantShare } = expense.paidFor.reduce(
          (acc, { participantId, shares }) => {
            acc.totalShares += shares
            if (participantId === participant.id) {
              acc.participantShare = shares
            }
            return acc
          },
          { totalShares: 0, participantShare: 0 },
        )

        const isPaidByParticipant = expense.paidById === participant.id
        const participantAmountShare = +formatAmountAsDecimal(
          (expense.amount / totalShares) * participantShare,
          currency,
        )

        return [
          participant.name,
          participantAmountShare * (isPaidByParticipant ? 1 : -1),
        ]
      }),
    ),
  }))

  const csv = new Parser({ fields }).parse(expenses)
  const date = new Date().toISOString().split('T')[0]
  const filename = `Spliit Cloud Export - ${group.name} - ${date}.csv`

  return new Response(`\uFEFF${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(filename),
    },
  })
}

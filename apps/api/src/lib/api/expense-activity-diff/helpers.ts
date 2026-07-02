import type { Expense, ExpenseApiItem } from '@spliit/domain'
import type { ChangeContext, DifferenceableExpense } from './types'

// ---------------------------------------------------------------------------
// Shared helpers used by multiple differs
// ---------------------------------------------------------------------------

export function sameDate(a: unknown, b: unknown): boolean {
  const aDate = a instanceof Date ? a : new Date(a as string)
  const bDate = b instanceof Date ? b : new Date(b as string)
  if (Number.isNaN(aDate.getTime()) || Number.isNaN(bDate.getTime())) {
    return a === b
  }
  return aDate.getTime() === bDate.getTime()
}

export function formatDate(d: unknown): string {
  const date = d instanceof Date ? d : new Date(d as string)
  if (Number.isNaN(date.getTime())) return String(d)
  return date.toISOString().slice(0, 10)
}

export function formatDisplayAmount(
  expense: DifferenceableExpense,
  ctx: ChangeContext,
): string {
  return ctx.formatCurrencyCents(
    expense.originalAmount ?? expense.amount,
    expense.originalCurrency ?? null,
  )
}

export function itemsKey(
  items: ReadonlyArray<ExpenseApiItem> | undefined,
): string {
  const list = (items ?? []).slice()
  list.sort((a, b) => {
    if (a.id && b.id) return a.id.localeCompare(b.id)
    if (a.id) return -1
    if (b.id) return 1
    return a.title.localeCompare(b.title)
  })
  return list
    .map((item) =>
      JSON.stringify({
        id: item.id ?? null,
        title: item.title,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        amount: item.amount,
        splitMode: item.splitMode,
        paidFor: item.paidFor
          .slice()
          .sort((a, b) => a.participant.localeCompare(b.participant))
          .map((p) => `${p.participant}:${p.shares}`),
      }),
    )
    .join('||')
}

export function documentsKey(
  documents: ReadonlyArray<Expense['documents'][number]>,
): string {
  return [...documents]
    .sort((a, b) => {
      const aKey = a.id || a.url
      const bKey = b.id || b.url
      return aKey.localeCompare(bKey)
    })
    .map((d) => `${d.id || d.url}|${d.url}|${d.width}x${d.height}`)
    .join('|')
}

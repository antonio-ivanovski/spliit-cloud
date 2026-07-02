import type { Expense, ExpenseApiItem } from '@spliit/domain'
import type { ExpenseChangedField } from '@spliit/domain/activities'

type DifferenceableExpense = Expense

type ShareRow = { participant: string; shares: number }

type ItemizedRemainderLike = NonNullable<Expense['itemizedRemainder']>

function paidForKey(rows: ReadonlyArray<ShareRow>): string {
  return [...rows]
    .sort((a, b) => a.participant.localeCompare(b.participant))
    .map((r) => `${r.participant}:${r.shares}`)
    .join('|')
}

function itemsKey(items: ReadonlyArray<ExpenseApiItem> | undefined): string {
  const list = (items ?? []).slice()
  // Stable ordering: by id when present, otherwise by title, so two
  // semantically-equal sets compare equal regardless of insertion order.
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

function remainderKey(r: ItemizedRemainderLike | undefined): string {
  if (!r) return ''
  return `${r.splitMode}|${paidForKey(r.paidFor)}`
}

function documentsKey(documents: ReadonlyArray<Expense['documents'][number]>): string {
  // Document ids are stable per expense; fall back to URL when an id is
  // missing so legacy single-payer records compare correctly.
  return [...documents]
    .sort((a, b) => {
      const aKey = a.id || a.url
      const bKey = b.id || b.url
      return aKey.localeCompare(bKey)
    })
    .map((d) => `${d.id || d.url}|${d.url}|${d.width}x${d.height}`)
    .join('|')
}

/**
 * Compare two dates tolerant to the API/form boundary (the form uses
 * ISO-ish strings, the API uses `Date`). Returns true when the two
 * values refer to the same instant.
 */
function sameDate(a: unknown, b: unknown): boolean {
  const aDate = a instanceof Date ? a : new Date(a as string)
  const bDate = b instanceof Date ? b : new Date(b as string)
  if (Number.isNaN(aDate.getTime()) || Number.isNaN(bDate.getTime())) {
    return a === b
  }
  return aDate.getTime() === bDate.getTime()
}

/**
 * Union of every `ledgerParticipantId` referenced by old and new expense
 * payer / split / item / remainder data. Used to determine who must be
 * notified of an update: anyone whose presence in the expense changed,
 * including someone who used to be referenced but no longer is, as long
 * as they are still an active group member.
 *
 * Tolerates undefined for both sides so the helper supports create (old
 * undefined) and delete (new undefined) without explicit branching.
 */
export function getAffectedParticipantIds({
  oldExpense,
  newExpense,
}: {
  oldExpense?: DifferenceableExpense
  newExpense?: DifferenceableExpense
}): Set<string> {
  const ids = new Set<string>()
  const collect = (e: DifferenceableExpense | undefined) => {
    if (!e) return
    for (const row of e.paidByList) ids.add(row.participant)
    for (const row of e.paidFor) ids.add(row.participant)
    for (const item of e.items ?? []) {
      for (const row of item.paidFor) ids.add(row.participant)
    }
    if (e.itemizedRemainder) {
      for (const row of e.itemizedRemainder.paidFor) ids.add(row.participant)
    }
  }
  collect(oldExpense)
  collect(newExpense)
  return ids
}

/**
 * Lightweight, field-grouped diff between two expense versions. Returns
 * the list of field groups whose value differs under the normalization
 * described in the design doc, or `null` when nothing meaningful
 * changed.
 *
 * The resulting array is suitable to drop directly into the
 * `ExpenseActivityData.changedFields` field.
 */
export function getExpenseChangedFields(
  oldExpense: DifferenceableExpense,
  newExpense: DifferenceableExpense,
): ExpenseChangedField[] | null {
  const changed: ExpenseChangedField[] = []

  if (oldExpense.title !== newExpense.title) changed.push('title')
  if (oldExpense.amount !== newExpense.amount) changed.push('amount')
  if (!sameDate(oldExpense.expenseDate, newExpense.expenseDate)) {
    changed.push('date')
  }
  if (oldExpense.category !== newExpense.category) changed.push('category')
  if ((oldExpense.notes ?? null) !== (newExpense.notes ?? null)) {
    changed.push('notes')
  }
  if (oldExpense.recurrenceRule !== newExpense.recurrenceRule) {
    changed.push('recurrence')
  }
  if (paidForKey(oldExpense.paidByList) !== paidForKey(newExpense.paidByList)) {
    changed.push('payers')
  }
  if (
    paidForKey(oldExpense.paidFor) !== paidForKey(newExpense.paidFor) ||
    oldExpense.splitMode !== newExpense.splitMode ||
    remainderKey(oldExpense.itemizedRemainder) !==
      remainderKey(newExpense.itemizedRemainder)
  ) {
    // `split` covers the non-itemized structural change: split mode,
    // paid-for roster, and itemized remainder shares.
    changed.push('split')
  }
  if (itemsKey(oldExpense.items) !== itemsKey(newExpense.items)) {
    changed.push('items')
  }
  if (documentsKey(oldExpense.documents) !== documentsKey(newExpense.documents)) {
    changed.push('documents')
  }

  if (changed.length === 0) return null
  return Array.from(new Set(changed))
}

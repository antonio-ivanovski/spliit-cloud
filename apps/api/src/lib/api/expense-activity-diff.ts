import type { Expense, ExpenseApiItem } from '@spliit/domain'
import type {
  ExpenseActivityChange,
  ExpenseChangedField,
} from '@spliit/domain/activities'

type DifferenceableExpense = Expense

type ShareRow = { participant: string; shares: number }

type ItemizedRemainderLike = NonNullable<Expense['itemizedRemainder']>

/** Context for formatting human-readable before/after strings. */
export type ChangeContext = {
  getParticipantName: (id: string) => string
  getCategoryName: (id: string) => string
  /** Format an integer minor-unit amount with its currency code. */
  formatCurrencyCents: (cents: number, currency: string | null) => string
}

// ---------------------------------------------------------------------------
// Diff helpers for payer/split semantic comparison (no amount-derived noise)
// ---------------------------------------------------------------------------

/**
 * Stable comparison key for payer rows. When `paidBySplitMode` is
 * `BY_AMOUNT`, shares are derived from the total amount and should not
 * flag a payer change on amount-only edits.
 */
function payerSemanticKey(rows: ReadonlyArray<ShareRow>, mode: string): string {
  const sorted = [...rows].sort((a, b) =>
    a.participant.localeCompare(b.participant),
  )
  if (mode === 'BY_AMOUNT') {
    return sorted.map((r) => r.participant).join('|')
  }
  return sorted.map((r) => `${r.participant}:${r.shares}`).join('|')
}

function paidForKey(rows: ReadonlyArray<ShareRow>): string {
  return [...rows]
    .sort((a, b) => a.participant.localeCompare(b.participant))
    .map((r) => `${r.participant}:${r.shares}`)
    .join('|')
}

function itemsKey(items: ReadonlyArray<ExpenseApiItem> | undefined): string {
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

function remainderKey(r: ItemizedRemainderLike | undefined): string {
  if (!r) return ''
  return `${r.splitMode}|${paidForKey(r.paidFor)}`
}

function documentsKey(
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

function sameDate(a: unknown, b: unknown): boolean {
  const aDate = a instanceof Date ? a : new Date(a as string)
  const bDate = b instanceof Date ? b : new Date(b as string)
  if (Number.isNaN(aDate.getTime()) || Number.isNaN(bDate.getTime())) {
    return a === b
  }
  return aDate.getTime() === bDate.getTime()
}

// ---------------------------------------------------------------------------
// Formatting helpers for human-readable change rows
// ---------------------------------------------------------------------------

function formatPayers(
  rows: ReadonlyArray<ShareRow>,
  ctx: ChangeContext,
): string {
  return rows.map((r) => ctx.getParticipantName(r.participant)).join(', ')
}

function formatSplit(
  mode: string,
  rows: ReadonlyArray<ShareRow>,
  ctx: ChangeContext,
): string {
  const names = rows
    .map((r) => {
      const name = ctx.getParticipantName(r.participant)
      if (mode === 'BY_PERCENTAGE') {
        return `${name} ${r.shares / 100}%`
      }
      if (mode === 'BY_SHARES') {
        return `${name} ${r.shares}`
      }
      return name
    })
    .join(', ')
  const modeLabel = mode === 'EVENLY' ? 'Equal split' : `Custom split`
  return `${modeLabel}: ${names}`
}

function formatDate(d: unknown): string {
  const date = d instanceof Date ? d : new Date(d as string)
  if (Number.isNaN(date.getTime())) return String(d)
  return date.toISOString().slice(0, 10)
}

function formatExpenseDisplayAmount(
  expense: DifferenceableExpense,
  ctx: ChangeContext,
): string {
  return ctx.formatCurrencyCents(
    expense.originalAmount ?? expense.amount,
    expense.originalCurrency ?? null,
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
 * the list of field groups whose value differs, or `null` when nothing
 * meaningful changed.
 *
 * Payer comparison compares only participant IDs when `paidBySplitMode`
 * is `BY_AMOUNT` (shares are derived from total and should not flag a
 * payer change on amount-only edits).
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
  // Semantic payer comparison: ignore derived shares for BY_AMOUNT.
  if (
    payerSemanticKey(oldExpense.paidByList, oldExpense.paidBySplitMode) !==
    payerSemanticKey(newExpense.paidByList, newExpense.paidBySplitMode)
  ) {
    changed.push('payers')
  }
  if (
    paidForKey(oldExpense.paidFor) !== paidForKey(newExpense.paidFor) ||
    oldExpense.splitMode !== newExpense.splitMode ||
    remainderKey(oldExpense.itemizedRemainder) !==
      remainderKey(newExpense.itemizedRemainder)
  ) {
    changed.push('split')
  }
  if (itemsKey(oldExpense.items) !== itemsKey(newExpense.items)) {
    changed.push('items')
  }
  if (
    documentsKey(oldExpense.documents) !== documentsKey(newExpense.documents)
  ) {
    changed.push('documents')
  }

  if (changed.length === 0) return null
  return Array.from(new Set(changed))
}

/**
 * Full change summary for the activity feed. Returns both a
 * backward-compatible `changedFields` list and per-field before/after
 * strings suitable for compact rendering in the activity feed.
 *
 * Uses the provided {@link ChangeContext} to resolve participant names
 * and format currency values at mutation time (snapshot auditing).
 */
export function getExpenseChangeSummary(
  oldExpense: DifferenceableExpense,
  newExpense: DifferenceableExpense,
  ctx: ChangeContext,
): {
  changedFields: ExpenseChangedField[]
  changes: ExpenseActivityChange[]
} | null {
  const changedFields = getExpenseChangedFields(oldExpense, newExpense)
  if (!changedFields || changedFields.length === 0) return null

  const changes: ExpenseActivityChange[] = []

  for (const field of changedFields) {
    switch (field) {
      case 'amount': {
        changes.push({
          field: 'amount',
          before: formatExpenseDisplayAmount(oldExpense, ctx),
          after: formatExpenseDisplayAmount(newExpense, ctx),
        })
        break
      }
      case 'title':
        changes.push({
          field: 'title',
          before: oldExpense.title,
          after: newExpense.title,
        })
        break
      case 'date':
        changes.push({
          field: 'date',
          before: formatDate(oldExpense.expenseDate),
          after: formatDate(newExpense.expenseDate),
        })
        break
      case 'category':
        changes.push({
          field: 'category',
          before: ctx.getCategoryName(oldExpense.category),
          after: ctx.getCategoryName(newExpense.category),
        })
        break
      case 'notes': {
        const oldNotes = oldExpense.notes ? '…' : null
        const newNotes = newExpense.notes ? '…' : null
        changes.push({ field: 'notes', before: oldNotes, after: newNotes })
        break
      }
      case 'recurrence':
        changes.push({
          field: 'recurrence',
          before: oldExpense.recurrenceRule,
          after: newExpense.recurrenceRule,
        })
        break
      case 'payers':
        changes.push({
          field: 'payers',
          before: formatPayers(oldExpense.paidByList, ctx),
          after: formatPayers(newExpense.paidByList, ctx),
        })
        break
      case 'split':
        changes.push({
          field: 'split',
          before: formatSplit(oldExpense.splitMode, oldExpense.paidFor, ctx),
          after: formatSplit(newExpense.splitMode, newExpense.paidFor, ctx),
        })
        break
      case 'documents': {
        const oldCount = oldExpense.documents.length
        const newCount = newExpense.documents.length
        changes.push({
          field: 'documents',
          before: oldCount > 0 ? `${oldCount}` : null,
          after: newCount > 0 ? `${newCount}` : null,
        })
        break
      }
      case 'items':
        // Items are complex; keep a simple signal.
        changes.push({ field: 'items', before: undefined, after: 'Changed' })
        break
    }
  }

  return { changedFields, changes }
}

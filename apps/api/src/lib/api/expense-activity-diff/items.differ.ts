import type { ExpenseApiItem } from '@spliit/domain'

import { itemsKey } from './helpers'
import type { ChangeContext, ExpenseDiffer } from './types'

type ItemChange =
  | {
      kind: 'modified'
      before: ExpenseApiItem
      after: ExpenseApiItem
      splitOnly: boolean
    }
  | { kind: 'added'; item: ExpenseApiItem }
  | { kind: 'removed'; item: ExpenseApiItem }

function effectiveCurrency(
  expense: { originalCurrency?: string | null },
  ctx: ChangeContext,
): string | null {
  return expense.originalCurrency ?? ctx.ledgerCurrencyCode
}

function itemSignature(item: ExpenseApiItem): string {
  // Order-independent signature for splitMode + paidFor so reorder doesn't count.
  const paidFor = [...item.paidFor]
    .sort((a, b) => a.participant.localeCompare(b.participant))
    .map((p) => `${p.participant}:${p.shares}`)
    .join(',')
  return `${item.splitMode}|${paidFor}`
}

function itemContentSignature(item: ExpenseApiItem): string {
  return JSON.stringify([
    item.title,
    item.unitPrice,
    item.quantity,
    item.amount,
    itemSignature(item),
  ])
}

function formatItemLine(
  item: ExpenseApiItem,
  currency: string | null,
  ctx: ChangeContext,
): string {
  const unit = ctx.formatCurrencyCents(item.unitPrice, currency)
  const total = ctx.formatCurrencyCents(item.amount, currency)
  return `${item.title} ${item.quantity} × ${unit} = ${total}`
}

/**
 * Detects and formats changes to expense items (line items).
 *
 * Emits a multi-line summary grouped by: - modified items: "before → after" -
 * added items: prefixed with "+ " - removed items: prefixed with "- "
 *
 * The UI strips the prefix and styles each line independently (added gets
 * emphasis, removed gets muted + strikethrough). For items where only the split
 * (paidFor / splitMode) changed, a compact "name (split updated)" marker is
 * emitted instead of duplicating the unchanged price line.
 */
export const itemsDiffer: ExpenseDiffer = {
  field: 'items',

  check(oldExpense, newExpense) {
    return itemsKey(oldExpense.items) !== itemsKey(newExpense.items)
  },

  diff(oldExpense, newExpense, ctx) {
    if (!this.check(oldExpense, newExpense)) return null

    const oldItems = oldExpense.items ?? []
    const newItems = newExpense.items ?? []

    const oldById = new Map<string, ExpenseApiItem>()
    for (const item of oldItems) {
      if (item.id) oldById.set(item.id, item)
    }
    const newById = new Map<string, ExpenseApiItem>()
    for (const item of newItems) {
      if (item.id) newById.set(item.id, item)
    }

    const changes: ItemChange[] = []
    const unmatchedOldIdlessCounts = new Map<string, number>()
    for (const item of oldItems) {
      if (!item.id) {
        const signature = itemContentSignature(item)
        unmatchedOldIdlessCounts.set(
          signature,
          (unmatchedOldIdlessCounts.get(signature) ?? 0) + 1,
        )
      }
    }

    for (const newItem of newItems) {
      if (newItem.id && oldById.has(newItem.id)) {
        const oldItem = oldById.get(newItem.id)!
        const mainEqual =
          oldItem.title === newItem.title &&
          oldItem.quantity === newItem.quantity &&
          oldItem.unitPrice === newItem.unitPrice &&
          oldItem.amount === newItem.amount
        const splitEqual = itemSignature(oldItem) === itemSignature(newItem)
        changes.push({
          kind: 'modified',
          before: oldItem,
          after: newItem,
          splitOnly: mainEqual && !splitEqual,
        })
      } else if (!newItem.id) {
        const signature = itemContentSignature(newItem)
        const oldCount = unmatchedOldIdlessCounts.get(signature) ?? 0
        if (oldCount > 0) {
          unmatchedOldIdlessCounts.set(signature, oldCount - 1)
        } else {
          changes.push({ kind: 'added', item: newItem })
        }
      } else {
        changes.push({ kind: 'added', item: newItem })
      }
    }

    for (const oldItem of oldItems) {
      if (oldItem.id) {
        if (!newById.has(oldItem.id)) {
          changes.push({ kind: 'removed', item: oldItem })
        }
      } else {
        const signature = itemContentSignature(oldItem)
        const remainingCount = unmatchedOldIdlessCounts.get(signature) ?? 0
        if (remainingCount > 0) {
          changes.push({ kind: 'removed', item: oldItem })
          unmatchedOldIdlessCounts.set(signature, remainingCount - 1)
        }
      }
    }

    if (changes.length === 0) return null

    const oldCurrency = effectiveCurrency(oldExpense, ctx)
    const newCurrency = effectiveCurrency(newExpense, ctx)

    const lines = changes.map((change) => {
      if (change.kind === 'modified') {
        if (change.splitOnly) {
          return `${change.after.title} (split updated)`
        }
        const before = formatItemLine(change.before, oldCurrency, ctx)
        const after = formatItemLine(change.after, newCurrency, ctx)
        return `${before} → ${after}`
      }
      if (change.kind === 'added') {
        return `+ ${formatItemLine(change.item, newCurrency, ctx)}`
      }
      return `- ${formatItemLine(change.item, oldCurrency, ctx)}`
    })

    return {
      field: 'items',
      before: lines.join('\n'),
      after: null,
    }
  },
}

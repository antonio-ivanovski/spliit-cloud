import { createFormattedValueDiffer } from '../activity-diff/factories'
import type { GroupDiffer } from './types'

function formatEntryCurrency(
  entry: string | null,
  settlementCode: string | null,
  settlementSymbol: string,
): string {
  // Null entry means "same as settlement" — resolve for display so
  // before/after reads like a currency change (e.g. EUR → GBP).
  return entry ?? settlementCode ?? settlementSymbol
}

export const entryCurrencyDiffer: GroupDiffer = createFormattedValueDiffer({
  field: 'defaultEntryCurrencyCode',
  equals: (oldGroup, newGroup) =>
    (oldGroup.defaultEntryCurrencyCode ?? null) ===
    (newGroup.defaultEntryCurrencyCode ?? null),
  format: (group) =>
    formatEntryCurrency(
      group.defaultEntryCurrencyCode,
      group.currencyCode,
      group.currency,
    ),
})

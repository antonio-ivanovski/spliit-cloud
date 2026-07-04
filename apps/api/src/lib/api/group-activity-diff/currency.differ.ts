import { createFormattedValueDiffer } from '../activity-diff/factories'
import type { GroupDiffer } from './types'

function formatCurrency(currency: string, code: string | null): string {
  return code ? `${code} (${currency})` : currency
}

export const currencyDiffer: GroupDiffer = createFormattedValueDiffer({
  field: 'currency',
  equals: (oldGroup, newGroup) =>
    oldGroup.currency === newGroup.currency &&
    (oldGroup.currencyCode ?? null) === (newGroup.currencyCode ?? null),
  format: (group) => formatCurrency(group.currency, group.currencyCode),
})

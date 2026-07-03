import type { GroupDiffer } from './types'

function formatCurrency(currency: string, code: string | null): string {
  return code ? `${code} (${currency})` : currency
}

export const currencyDiffer: GroupDiffer = {
  field: 'currency',
  check(oldGroup, newGroup) {
    return (
      oldGroup.currency !== newGroup.currency ||
      (oldGroup.currencyCode ?? null) !== (newGroup.currencyCode ?? null)
    )
  },
  diff(oldGroup, newGroup) {
    if (!this.check(oldGroup, newGroup)) return null
    return {
      field: 'currency',
      before: formatCurrency(oldGroup.currency, oldGroup.currencyCode),
      after: formatCurrency(newGroup.currency, newGroup.currencyCode),
    }
  },
}

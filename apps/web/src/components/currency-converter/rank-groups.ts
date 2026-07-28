import type { AccountGroup } from '@/app/groups/group-buckets'

export function rankGroupsForConverter(
  groups: AccountGroup[],
  sourceCurrencyCode: string,
): AccountGroup[] {
  const eligible = groups.filter(
    (g) => !g.preference.hidden && !g.archived && !!g.ledger.currencyCode,
  )

  const tier = (g: AccountGroup): number => {
    if (g.preference.starred) return 0
    if (g.groupType === 'GROUP') return 1
    return 2
  }

  const sortByRecentExpense = (a: AccountGroup, b: AccountGroup) => {
    const aTime = a.financialSummary?.latestExpenseCreatedAt ?? a.createdAt
    const bTime = b.financialSummary?.latestExpenseCreatedAt ?? b.createdAt
    return bTime.localeCompare(aTime) || a.id.localeCompare(b.id)
  }

  return eligible.sort((a, b) => {
    const tierDiff = tier(a) - tier(b)
    if (tierDiff !== 0) return tierDiff

    const aMatches = a.ledger.currencyCode === sourceCurrencyCode ? 0 : 1
    const bMatches = b.ledger.currencyCode === sourceCurrencyCode ? 0 : 1
    if (aMatches !== bMatches) return aMatches - bMatches

    return sortByRecentExpense(a, b)
  })
}

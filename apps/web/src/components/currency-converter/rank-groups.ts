import type { AppRouterOutput } from '@spliit/api/router'

export type ConverterGroup =
  AppRouterOutput['account']['groups']['groups'][number]

export function rankGroupsForConverter(
  groups: ConverterGroup[],
  sourceCurrencyCode: string,
): ConverterGroup[] {
  const eligible = groups.filter(
    (g) => !g.preference.hidden && !g.archived && !!g.ledger.currencyCode,
  )

  const tier = (g: ConverterGroup): number => {
    if (g.preference.starred) return 0
    if (g.groupType === 'GROUP') return 1
    return 2
  }

  const sortByRecentExpense = (a: ConverterGroup, b: ConverterGroup) => {
    const aTime = a.latestExpenseCreatedAt ?? a.createdAt
    const bTime = b.latestExpenseCreatedAt ?? b.createdAt
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

import type { AppRouterOutput } from '@spliit/api/router'

export type AccountGroup = AppRouterOutput['overview']['get']['groups'][number]

export type GroupType = AccountGroup['groupType']

export type GroupBucket =
  | 'starred'
  | 'groups'
  | 'friends'
  | 'archived'
  | 'hidden'

/**
 * Decide which visual bucket a group belongs to on the homepage. The
 * `partitionGroups` helper applies this function imperatively, but exposing it
 * lets consumers (tests, future filtering) reason about bucketing in
 * isolation.
 *
 * Buckets are mutually exclusive in priority order: - hidden (per-account
 * preference, beats everything else) - archived (group-level flag, GROUP-only —
 * FRIEND ledgers are server-rejected from archiving so they never land here) -
 * starred (mixed; appears regardless of groupType) - groups (non-starred GROUP)
 * - friends (non-starred FRIEND)
 *
 * FRIEND groups skip the `archived` bucket as a defense-in-depth — the server
 * prevents archive for FRIEND, but if a stale row ever slipped through we'd
 * rather hide it from the archived section.
 */
export function bucketFor(group: AccountGroup): GroupBucket {
  if (group.preference.hidden) return 'hidden'
  if (group.groupType === 'FRIEND') {
    return group.preference.starred ? 'starred' : 'friends'
  }
  if (group.archived) return 'archived'
  return group.preference.starred ? 'starred' : 'groups'
}

export function partitionGroups(groups: AccountGroup[]) {
  const grouped: AccountGroup[] = []
  const friends: AccountGroup[] = []
  const starred: AccountGroup[] = []
  const archived: AccountGroup[] = []
  const hidden: AccountGroup[] = []
  for (const group of groups) {
    if (group.preference.hidden) {
      hidden.push(group)
      continue
    }
    if (group.groupType === 'FRIEND') {
      // FRIEND ledgers are never archived (server-rejected). Starred
      // friends show under the shared starred section; the rest under
      // the Friends section.
      if (group.preference.starred) starred.push(group)
      else friends.push(group)
      continue
    }
    if (group.archived) {
      archived.push(group)
      continue
    }
    if (group.preference.starred) starred.push(group)
    else grouped.push(group)
  }
  const sortByRecentExpense = (a: AccountGroup, b: AccountGroup) => {
    const aTime = a.financialSummary?.latestExpenseCreatedAt ?? a.createdAt
    const bTime = b.financialSummary?.latestExpenseCreatedAt ?? b.createdAt
    return bTime.localeCompare(aTime) || a.id.localeCompare(b.id)
  }

  grouped.sort(sortByRecentExpense)
  friends.sort(sortByRecentExpense)
  starred.sort(sortByRecentExpense)
  archived.sort(sortByRecentExpense)
  hidden.sort(sortByRecentExpense)

  return { groups: grouped, friends, starred, archived, hidden }
}

const dateFormatCache = new Map<string, Intl.DateTimeFormat>()

function getDateFormat(locale: string) {
  let fmt = dateFormatCache.get(locale)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    dateFormatCache.set(locale, fmt)
  }
  return fmt
}

export function formatDate(value: string | Date, locale: string) {
  const date = typeof value === 'string' ? new Date(value) : value
  return getDateFormat(locale).format(date)
}

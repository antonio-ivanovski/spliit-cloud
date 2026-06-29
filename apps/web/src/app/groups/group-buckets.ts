import type { AppRouterOutput } from '@spliit/api/router'

export type AccountGroup =
  AppRouterOutput['account']['groups']['groups'][number]

export type GroupBucket = 'active' | 'archived' | 'hidden'

export function bucketFor(group: AccountGroup): GroupBucket {
  if (group.preference.hidden) return 'hidden'
  if (group.archived) return 'archived'
  return 'active'
}

export function partitionGroups(groups: AccountGroup[]) {
  const active: AccountGroup[] = []
  const starred: AccountGroup[] = []
  const archived: AccountGroup[] = []
  const hidden: AccountGroup[] = []
  for (const group of groups) {
    const bucket = bucketFor(group)
    if (bucket === 'archived') archived.push(group)
    else if (bucket === 'hidden') hidden.push(group)
    else if (group.preference.starred) starred.push(group)
    else active.push(group)
  }
  return { active, starred, archived, hidden }
}

export function formatDate(value: string | Date, locale: string) {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

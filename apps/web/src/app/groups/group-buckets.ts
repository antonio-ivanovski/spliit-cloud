import type { DeviceSavedView } from '@/lib/saved-view-groups'
import type { AppRouterOutput } from '@spliit/api/router'
import {
  accountExportGroupSectionFor,
  resolveFormattingLocale,
  type AccountExportGroupSection,
} from '@spliit/domain'

export type AccountGroup = AppRouterOutput['overview']['get']['groups'][number]

export function isViewOnlyGroup(group: AccountGroup) {
  return group.access === 'VIEW_ONLY'
}

function recencyTimestamp(group: AccountGroup) {
  if (isViewOnlyGroup(group)) {
    return group.lastOpenedAt ?? group.createdAt
  }
  return group.financialSummary?.latestExpenseCreatedAt ?? group.createdAt
}

export function savedViewToAccountGroup(view: DeviceSavedView): AccountGroup {
  return {
    id: view.groupId,
    name: view.name,
    information: null,
    archived: false,
    createdAt: view.lastOpenedAt,
    groupType: 'GROUP',
    ledger: { currency: '', currencyCode: null },
    memberCount: view.memberCount,
    currentMemberRole: 'MEMBER',
    preference: { starred: false, hidden: false },
    displayName: view.name,
    friendAccount: null,
    memberAccounts: [],
    financialSummary: {
      expenseCount: 0,
      netBalance: null,
      state: 'UNAVAILABLE',
      latestExpenseCreatedAt: null,
    },
    access: 'VIEW_ONLY',
    viewKey: view.viewKey,
    lastOpenedAt: view.lastOpenedAt,
  }
}

export type GroupType = AccountGroup['groupType']

export type GroupBucket =
  | 'starred'
  | 'groups'
  | 'friends'
  | 'archived'
  | 'hidden'

const bucketBySection = {
  GROUPS: 'groups',
  FRIENDS: 'friends',
  STARRED: 'starred',
  ARCHIVED: 'archived',
  HIDDEN: 'hidden',
} as const satisfies Record<AccountExportGroupSection, GroupBucket>

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
  if (group.access === 'VIEW_ONLY') {
    if (group.preference.hidden) return 'hidden'
    if (group.preference.starred) return 'starred'
    return 'groups'
  }
  return bucketBySection[
    accountExportGroupSectionFor({
      groupType: group.groupType,
      archived: group.archived,
      starred: group.preference.starred,
      hidden: group.preference.hidden,
    })
  ]
}

export function partitionGroups(groups: AccountGroup[]) {
  const grouped: Record<GroupBucket, AccountGroup[]> = {
    groups: [],
    friends: [],
    starred: [],
    archived: [],
    hidden: [],
  }
  for (const group of groups) {
    grouped[bucketFor(group)].push(group)
  }
  const sortByRecentExpense = (a: AccountGroup, b: AccountGroup) => {
    const aTime = recencyTimestamp(a)
    const bTime = recencyTimestamp(b)
    return bTime.localeCompare(aTime) || a.id.localeCompare(b.id)
  }

  for (const bucket of Object.values(grouped)) bucket.sort(sortByRecentExpense)

  return grouped
}

const dateFormatCache = new Map<string, Intl.DateTimeFormat>()

function getDateFormat(locale: string, timeZone: string) {
  const key = `${locale}:${timeZone}`
  let fmt = dateFormatCache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(resolveFormattingLocale(locale), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone,
    })
    dateFormatCache.set(key, fmt)
  }
  return fmt
}

export function formatDate(
  value: string | Date,
  locale: string,
  timeZone = 'UTC',
) {
  const date = typeof value === 'string' ? new Date(value) : value
  return getDateFormat(locale, timeZone).format(date)
}

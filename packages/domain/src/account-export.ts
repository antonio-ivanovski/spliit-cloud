import type {
  AccountExportGroupSection,
  AccountExportSelection,
} from './export-manifest'

export type AccountExportGroupLike = {
  id: string
  groupType: 'GROUP' | 'FRIEND'
  archived: boolean
  starred: boolean
  hidden: boolean
}

/**
 * Resolve the same mutually-exclusive buckets used by the groups homepage.
 * Keeping this rule in the domain package prevents an export selector and the
 * account UI from disagreeing about where a group belongs.
 */
export function accountExportGroupSectionFor(
  group: Omit<AccountExportGroupLike, 'id'>,
): AccountExportGroupSection {
  if (group.hidden) return 'HIDDEN'
  if (group.groupType === 'FRIEND') {
    return group.starred ? 'STARRED' : 'FRIENDS'
  }
  if (group.archived) return 'ARCHIVED'
  return group.starred ? 'STARRED' : 'GROUPS'
}

export function accountExportSelectionIncludesGroup(
  group: AccountExportGroupLike,
  selection: AccountExportSelection,
): boolean {
  const override = selection.groupOverrides.find(
    (candidate) => candidate.groupSourceId === group.id,
  )
  if (override) return override.included
  return selection.sections[accountExportGroupSectionFor(group)]
}

export function resolveAccountExportGroupIds(
  groups: ReadonlyArray<AccountExportGroupLike>,
  selection: AccountExportSelection,
): string[] {
  return groups
    .filter((group) => accountExportSelectionIncludesGroup(group, selection))
    .map((group) => group.id)
    .sort((left, right) => left.localeCompare(right))
}

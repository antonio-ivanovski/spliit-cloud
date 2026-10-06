import {
  hideableGroupTabIdValues,
  resolveGroupTabOrder,
  type GroupTabId,
} from '@spliit/domain/account-preferences'

export type { GroupTabId }

export type GroupTabVisibility = {
  /** Friend ledgers have exactly two people, so the Members tab is hidden. */
  isFriendLedger: boolean
  /** The Settings tab is only shown when the viewer may see it. */
  canViewSettings: boolean
}

const hideableGroupTabIds = new Set<string>(hideableGroupTabIdValues)

/**
 * Resolve the account's group tab order into the visible tab ids for a group.
 * Unknown ids are dropped, duplicates collapse, tabs missing from the stored
 * order append in default order, conditionally hidden tabs (Members on friend
 * ledgers, Settings without a viewer) are filtered out, and account-hidden tabs
 * are removed last. Expenses and Settings can never be hidden: entries for them
 * in the hidden list are ignored defensively.
 */
export function getVisibleGroupTabs(
  storedOrder: readonly string[] | null | undefined,
  visibility: GroupTabVisibility,
  hiddenTabs?: readonly string[] | null,
): GroupTabId[] {
  const hidden = new Set(
    (hiddenTabs ?? []).filter((id) => hideableGroupTabIds.has(id)),
  )
  return resolveGroupTabOrder(storedOrder)
    .filter((id) => !hidden.has(id))
    .filter((id) => {
      if (id === 'members' && visibility.isFriendLedger) return false
      if (id === 'edit' && !visibility.canViewSettings) return false
      return true
    })
}

import { useEffect } from 'react'

import {
  isActivityReturnTo,
  isGlobalExpensesReturnTo,
} from './expense-navigation'

type ScrollSnapshot = {
  key: string
  scrollY: number
  allowedPaths: Set<string>
}

let pendingSnapshot: ScrollSnapshot | null = null

function normalizedPath(pathname: string) {
  return pathname.replace(/\/+$/, '') || '/'
}

function listKey(url: URL, groupId?: string) {
  const pathname = normalizedPath(url.pathname)
  if (groupId && pathname === `/groups/${groupId}/activity`) {
    return `/groups/${groupId}/activity`
  }
  const params = new URLSearchParams(url.search)
  if (groupId) {
    params.delete('returnTo')
    params.delete('scope')
    params.delete('expenseId')
  } else {
    params.delete('expenseId')
    params.delete('expenseGroupId')
  }
  params.sort()
  const query = params.toString()
  const listPathname = groupId ? `/groups/${groupId}/expenses` : '/expenses'
  return query ? `${listPathname}?${query}` : listPathname
}

function activityKey(groupId: string) {
  return `/groups/${groupId}/activity`
}

/** Capture only when a preview actually came from a mounted expense list. */
export function captureExpenseEditScroll(
  groupId: string,
  expenseId: string,
  returnTo?: string,
) {
  const current = new URL(window.location.href)
  const editPath = `/groups/${groupId}/expenses/${expenseId}/edit`

  if (isGlobalExpensesReturnTo(returnTo) && returnTo) {
    if (normalizedPath(current.pathname) !== '/expenses') return
    pendingSnapshot = {
      key: listKey(new URL(returnTo, current.origin)),
      scrollY: window.scrollY,
      allowedPaths: new Set(['/expenses', editPath]),
    }
    return
  }

  if (isActivityReturnTo(returnTo)) {
    if (normalizedPath(current.pathname) !== `/groups/${groupId}/activity`)
      return
    pendingSnapshot = {
      key: activityKey(groupId),
      scrollY: window.scrollY,
      allowedPaths: new Set([`/groups/${groupId}/activity`, editPath]),
    }
    return
  }

  const previewPath = `/groups/${groupId}/expenses/${expenseId}`
  if (normalizedPath(current.pathname) !== previewPath) return
  pendingSnapshot = {
    key: listKey(current, groupId),
    scrollY: window.scrollY,
    allowedPaths: new Set([
      `/groups/${groupId}/expenses`,
      previewPath,
      editPath,
    ]),
  }
}

/** Do not apply a prior edit's position after leaving its navigation flow. */
export function discardExpenseEditScrollOutside(pathname: string) {
  if (
    pendingSnapshot &&
    !pendingSnapshot.allowedPaths.has(normalizedPath(pathname))
  ) {
    pendingSnapshot = null
  }
}

function restoreExpenseEditScroll(groupId?: string) {
  if (!pendingSnapshot) return
  const key = listKey(new URL(window.location.href), groupId)
  if (pendingSnapshot.key !== key) return

  const maxScroll = Math.max(
    0,
    document.documentElement.scrollHeight - window.innerHeight,
  )
  window.scrollTo({
    top: Math.max(0, Math.min(pendingSnapshot.scrollY, maxScroll)),
    behavior: 'auto',
  })
  pendingSnapshot = null
}

/** Restore after the cached or freshly fetched list has rendered. */
export function useRestoreExpenseEditScroll(ready: boolean, groupId?: string) {
  useEffect(() => {
    if (!ready || !pendingSnapshot) return
    const frame = requestAnimationFrame(() => restoreExpenseEditScroll(groupId))
    return () => cancelAnimationFrame(frame)
  }, [groupId, ready])
}

type FocusedRouteMeta = {
  title: string
  backHref: string
}

const groupIdFromPath = (pathname: string) =>
  pathname.match(/^\/groups\/bulk-categorize\/([^/]+)/)?.[1] ??
  pathname.match(/^\/groups\/([^/]+)/)?.[1]

export function isFocusedMobilePath(pathname: string) {
  return (
    pathname === '/groups/create' ||
    pathname === '/groups/import' ||
    pathname === '/friends/create' ||
    pathname === '/account/settings' ||
    pathname.startsWith('/groups/bulk-categorize/') ||
    /^\/groups\/[^/]+\/edit$/.test(pathname) ||
    /^\/groups\/[^/]+\/expenses\/create$/.test(pathname) ||
    /^\/groups\/[^/]+\/expenses\/[^/]+\/edit$/.test(pathname)
  )
}

export function isMobileGroupNavPath(pathname: string) {
  return /^\/groups\/[^/]+\/(expenses|balances|activity|stats|information|members|edit)\/?$/.test(
    pathname,
  )
}

export function shouldHideMobileGroupTabs(pathname: string) {
  return (
    isMobileGroupNavPath(pathname) ||
    isFocusedMobilePath(pathname) ||
    /^\/groups\/[^/]+\/expenses\/[^/]+\/?$/.test(pathname)
  )
}

export function getFocusedRouteMeta(
  pathname: string,
  t: (key: string) => string,
): FocusedRouteMeta | null {
  const groupId = groupIdFromPath(pathname)
  if (pathname === '/groups/create') {
    return { title: t('Groups.createGroupCard.title'), backHref: '/' }
  }
  if (pathname === '/groups/import') {
    return { title: t('Groups.Import.StepHeader.title'), backHref: '/' }
  }
  if (pathname === '/friends/create') {
    return { title: t('Groups.createFriendLedgerCard.title'), backHref: '/' }
  }
  if (pathname === '/account/settings') {
    return { title: t('AccountSettings.title'), backHref: '/' }
  }
  if (pathname.startsWith('/groups/bulk-categorize/') && groupId) {
    return {
      title: t('BulkCategorize.title'),
      backHref: `/groups/${groupId}/expenses`,
    }
  }
  if (groupId && /^\/groups\/[^/]+\/edit$/.test(pathname)) {
    return {
      title: t('Settings.title'),
      backHref: `/groups/${groupId}/expenses`,
    }
  }
  if (groupId && /^\/groups\/[^/]+\/expenses\/create$/.test(pathname)) {
    return {
      title: t('Expenses.create'),
      backHref: `/groups/${groupId}/expenses`,
    }
  }
  if (groupId && /^\/groups\/[^/]+\/expenses\/[^/]+\/edit$/.test(pathname)) {
    return {
      title: t('ExpensePreview.edit'),
      backHref: `/groups/${groupId}/expenses`,
    }
  }
  return null
}

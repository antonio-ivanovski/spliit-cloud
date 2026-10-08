import { Link, useLocation } from '@tanstack/react-router'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  MoreHorizontal,
  MessageSquareText,
  ReceiptText,
  Scale,
  Settings2,
  Users,
  WalletCards,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import { useGroupAccessSearch } from '@/app/groups/[groupId]/use-group-access-search'
import { ViewOnlyBadge } from '@/app/groups/view-only-badge'
import { AccountMenu } from '@/components/account-menu'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { CurrencyConverterButton } from '@/components/currency-converter/currency-converter'
import { useDocumentTitle } from '@/components/document-title'
import { GroupEmojiBadge } from '@/components/group-emoji-badge'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { getVisibleGroupTabs, type GroupTabId } from '@/lib/group-tabs'
import { getFocusedRouteMeta, isMobileGroupTabPath } from '@/lib/mobile-nav'

/**
 * The compact mobile utility row is shared by normal, focused, and
 * group-context headers. Keeping it in one place prevents a route-specific
 * header from silently losing account, locale, or theme access.
 */
export function MobileAppHeaderActions() {
  return (
    <div
      data-mobile-header-actions
      className="flex shrink-0 items-center gap-0.5"
    >
      <CurrencyConverterButton />
      <LocaleSwitcher />
      <ThemeToggle />
      <AccountMenu />
    </div>
  )
}

export function MobileAppBar() {
  const location = useLocation()
  const pathname = location.pathname
  const { t } = useTranslation()
  const returnTo = (location.search as Record<string, unknown> | undefined)
    ?.returnTo
  const meta = useMemo(
    () =>
      getFocusedRouteMeta(
        pathname,
        t,
        typeof returnTo === 'string' ? returnTo : undefined,
      ),
    [pathname, returnTo, t],
  )
  useDocumentTitle(meta ? `Spliit · ${meta.title}` : null)

  if (!meta) return null

  return (
    <header
      data-app-header
      className="fixed inset-x-0 top-0 z-50 flex h-(--app-header-height) items-center gap-2 border-b bg-background/95 px-2 app-header-inset backdrop-blur supports-backdrop-filter:bg-background/80 sm:hidden"
    >
      <Link
        to={meta.to}
        params={meta.params}
        search={meta.search}
        resetScroll={meta.resetScroll}
        replace={meta.replace}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        aria-label={t('Header.back')}
      >
        <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden="true" />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
        {meta.title}
      </h1>
      <MobileAppHeaderActions />
    </header>
  )
}

/**
 * Group tabs use their own context header so the group name is not repeated in
 * a second heading row beneath the global app bar. Access credentials are
 * explicitly forwarded to the first tab link because view-only links are
 * URL-borne and must survive every group navigation.
 */
export function GroupMobileAppBar() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const { t } = useTranslation()
  const { group, displayName, groupId, viewer } = useCurrentGroup()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()

  if (!isMobileGroupTabPath(pathname)) return null

  const title = displayName || group?.name || 'Spliit'
  const isPublicView = viewer?.source === 'PUBLIC_LINK'

  return (
    <header
      data-app-header
      data-group-mobile-app-bar
      className="fixed inset-x-0 top-0 z-50 flex h-(--app-header-height) items-center gap-1.5 border-b bg-background/95 px-2 app-header-inset backdrop-blur supports-backdrop-filter:bg-background/80 sm:hidden"
    >
      <Link
        to="/"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        aria-label={t('Groups.backToHome')}
      >
        <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden="true" />
      </Link>
      <h1 className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-base font-semibold">
        <GroupEmojiBadge emoji={group?.emoji} color={group?.color} size="sm" />
        <Link
          to="/groups/$groupId/expenses"
          params={{ groupId }}
          search={{ invite: linkInviteToken, viewKey }}
          className="min-w-0 flex-1 truncate focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          {title}
        </Link>
      </h1>
      {isPublicView ? <ViewOnlyBadge compactOnMobile /> : null}
      <MobileAppHeaderActions />
    </header>
  )
}

type GroupNavProps = { groupId: string }

const GROUP_NAV_TO = {
  expenses: '/groups/$groupId/expenses',
  balances: '/groups/$groupId/balances',
  stats: '/groups/$groupId/stats',
  budgets: '/groups/$groupId/budgets',
  activity: '/groups/$groupId/activity',
  members: '/groups/$groupId/members',
  tools: '/groups/$groupId/tools',
  edit: '/groups/$groupId/edit',
} as const

export function MobileGroupNav({ groupId }: GroupNavProps) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const { t } = useTranslation()
  const { group, viewer } = useCurrentGroup()
  const syncedPreferences = useSyncedAccountPreferences()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()
  const [moreOpen, setMoreOpen] = useState(false)
  const tabMeta: Record<GroupTabId, { label: string; icon: LucideIcon }> = {
    expenses: { label: t('Expenses.title'), icon: ReceiptText },
    balances: { label: t('Balances.title'), icon: Scale },
    activity: { label: t('Activity.title'), icon: Activity },
    members: { label: t('Members.title'), icon: Users },
    stats: { label: t('Stats.title'), icon: BarChart3 },
    budgets: { label: t('Budgets.title'), icon: WalletCards },
    tools: { label: t('Tools.title'), icon: Wrench },
    edit: { label: t('Settings.title'), icon: Settings2 },
  }
  const orderedTabs = getVisibleGroupTabs(
    syncedPreferences?.groupTabOrder,
    {
      isFriendLedger: group?.groupType === 'FRIEND',
      canViewSettings: !!viewer,
    },
    syncedPreferences?.hiddenGroupTabs,
  ).map((id) => ({ id, to: GROUP_NAV_TO[id], ...tabMeta[id] }))
  // The bottom bar fits four tabs plus the overflow sheet trigger; the first
  // four visible tabs in the account's order take those slots.
  const tabs = orderedTabs.slice(0, 4)
  const moreTabs = orderedTabs.slice(4)
  const activeMore =
    moreTabs.some((tab) => pathname === tab.to.replace('$groupId', groupId)) ||
    pathname === '/feedback'

  return (
    <>
      {createPortal(
        <nav
          aria-label={t('Groups.groupActions')}
          className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 mobile-bottom-inset shadow-[0_-4px_20px_rgb(0_0_0/0.06)] backdrop-blur supports-backdrop-filter:bg-background/80 sm:hidden"
        >
          <div className="mx-auto grid h-(--mobile-nav-bar-height) max-w-lg grid-cols-5 items-stretch px-1">
            {tabs.map(({ to, label, icon: Icon }) => {
              const active = pathname === to.replace('$groupId', groupId)
              return (
                <Link
                  key={to}
                  to={to}
                  params={{ groupId }}
                  search={{ invite: linkInviteToken, viewKey }}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-center text-xs leading-tight font-medium transition-colors ${active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Icon
                    className="motion-nav-icon size-5"
                    strokeWidth={active ? 2.5 : 2}
                    aria-hidden="true"
                  />
                  <span className="line-clamp-2 max-w-full">{label}</span>
                </Link>
              )
            })}
            <button
              type="button"
              aria-label={t('Groups.groupActions')}
              aria-current={activeMore ? 'page' : undefined}
              onClick={() => setMoreOpen(true)}
              className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-center text-xs leading-tight font-medium transition-colors ${activeMore ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <MoreHorizontal
                className="motion-nav-icon size-5"
                aria-hidden="true"
              />
              <span className="line-clamp-2 max-w-full">
                {t('Groups.groupActions')}
              </span>
            </button>
          </div>
        </nav>,
        document.body,
      )}

      <ResponsiveDialog open={moreOpen} onOpenChange={setMoreOpen}>
        <ResponsiveDialogContent className="sm:max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('Groups.groupActions')}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="flex flex-col gap-2 pb-[env(safe-area-inset-bottom)]">
            {moreTabs.map(({ to, label, icon: Icon }) => (
              <ResponsiveDialogClose
                key={to}
                render={
                  <Link
                    to={to}
                    params={{ groupId }}
                    search={{ invite: linkInviteToken, viewKey }}
                    className="flex min-h-12 items-center gap-3 rounded-lg border px-3 text-sm font-medium hover:bg-muted"
                  >
                    <Icon
                      className="size-5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {label}
                  </Link>
                }
              />
            ))}
            <ResponsiveDialogClose
              render={
                <Link
                  to="/feedback"
                  className="flex min-h-12 items-center gap-3 rounded-lg border px-3 text-sm font-medium hover:bg-muted"
                >
                  <MessageSquareText
                    className="size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  {t('Feedback.navigationLabel')}
                </Link>
              }
            />
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

import { useLocation } from '@tanstack/react-router'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Info,
  MoreHorizontal,
  MessageSquareText,
  ReceiptText,
  Scale,
  Settings2,
  Users,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import Link from '@/components/link'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { getFocusedRouteMeta } from '@/lib/mobile-nav'

export function MobileAppBar() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const { t } = useTranslation()
  const meta = useMemo(() => getFocusedRouteMeta(pathname, t), [pathname, t])

  useEffect(() => {
    if (meta) {
      document.title = `Spliit · ${meta.title}`
    } else if (!pathname.startsWith('/groups/')) {
      document.title = 'Spliit Cloud'
    }
  }, [meta, pathname])

  if (!meta) return null

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-(--app-header-height) items-center gap-2 border-b bg-background/95 px-2 backdrop-blur supports-backdrop-filter:bg-background/80 sm:hidden">
      <Link
        href={meta.backHref}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        aria-label={t('Header.back')}
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
      </Link>
      <h1 className="min-w-0 truncate text-base font-semibold">{meta.title}</h1>
    </header>
  )
}

type GroupNavProps = { groupId: string }

export function MobileGroupNav({ groupId }: GroupNavProps) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const { t } = useTranslation()
  const { group } = useCurrentGroup()
  const [moreOpen, setMoreOpen] = useState(false)
  const tabs = [
    {
      href: `/groups/${groupId}/expenses`,
      label: t('Expenses.title'),
      icon: ReceiptText,
    },
    {
      href: `/groups/${groupId}/balances`,
      label: t('Balances.title'),
      icon: Scale,
    },
    {
      href: `/groups/${groupId}/stats`,
      label: t('Stats.title'),
      icon: BarChart3,
    },
    {
      href: `/groups/${groupId}/budgets`,
      label: t('Budgets.title'),
      icon: WalletCards,
    },
  ] as const
  const moreTabs = [
    {
      href: `/groups/${groupId}/activity`,
      label: t('Activity.title'),
      icon: Activity,
    },
    {
      href: `/groups/${groupId}/information`,
      label: t('Information.title'),
      icon: Info,
    },
    ...(group?.groupType === 'FRIEND'
      ? []
      : [
          {
            href: `/groups/${groupId}/members`,
            label: t('Members.title'),
            icon: Users,
          },
        ]),
    {
      href: `/groups/${groupId}/edit`,
      label: t('Settings.title'),
      icon: Settings2,
    },
    {
      href: '/feedback',
      label: t('Feedback.navigationLabel'),
      icon: MessageSquareText,
    },
  ] as const
  const activeMore = moreTabs.some((tab) => pathname === tab.href)

  return (
    <>
      <nav
        aria-label={t('Groups.groupActions')}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgb(0_0_0/0.06)] backdrop-blur supports-backdrop-filter:bg-background/80 sm:hidden"
      >
        <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-stretch px-1">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-medium transition-colors ${active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Icon
                  className="motion-nav-icon size-5"
                  strokeWidth={active ? 2.5 : 2}
                  aria-hidden="true"
                />
                <span className="max-w-full truncate">{label}</span>
              </Link>
            )
          })}
          <button
            type="button"
            aria-label={t('Groups.groupActions')}
            aria-current={activeMore ? 'page' : undefined}
            onClick={() => setMoreOpen(true)}
            className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-medium transition-colors ${activeMore ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <MoreHorizontal
              className="motion-nav-icon size-5"
              aria-hidden="true"
            />
            <span>{t('Groups.groupActions')}</span>
          </button>
        </div>
      </nav>

      <ResponsiveDialog open={moreOpen} onOpenChange={setMoreOpen}>
        <ResponsiveDialogContent className="sm:max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('Groups.groupActions')}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="flex flex-col gap-2 pb-[env(safe-area-inset-bottom)]">
            {moreTabs.map(({ href, label, icon: Icon }) => (
              <ResponsiveDialogClose
                key={href}
                render={
                  <Link
                    href={href}
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
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

import { Link, useLocation } from '@tanstack/react-router'
import {
  ArrowLeftRight,
  CalendarClock,
  LayoutDashboard,
  PiggyBank,
  Settings2,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

import { usePersonalTranslation } from './personal-i18n'

type PersonalTab = {
  id: string
  labelKey:
    | 'nav.overview'
    | 'nav.transactions'
    | 'nav.recurring'
    | 'nav.budgets'
    | 'nav.settings'
  to:
    | '/personal'
    | '/personal/transactions'
    | '/personal/recurring'
    | '/personal/budgets'
    | '/personal/settings'
  icon: LucideIcon
}

const TABS: PersonalTab[] = [
  {
    id: 'overview',
    labelKey: 'nav.overview',
    to: '/personal',
    icon: LayoutDashboard,
  },
  {
    id: 'transactions',
    labelKey: 'nav.transactions',
    to: '/personal/transactions',
    icon: ArrowLeftRight,
  },
  {
    id: 'recurring',
    labelKey: 'nav.recurring',
    to: '/personal/recurring',
    icon: CalendarClock,
  },
  {
    id: 'budgets',
    labelKey: 'nav.budgets',
    to: '/personal/budgets',
    icon: PiggyBank,
  },
  {
    id: 'settings',
    labelKey: 'nav.settings',
    to: '/personal/settings',
    icon: Settings2,
  },
]

function isTabActive(pathname: string, to: PersonalTab['to']): boolean {
  if (to === '/personal')
    return pathname === '/personal' || pathname === '/personal/'
  return pathname === to || pathname.startsWith(`${to}/`)
}

/**
 * Personal section navigation: a desktop left rail and a mobile bottom tab bar
 * (Overview, Transactions, Budgets, Settings). Rendered by the personal layout;
 * the mobile bar portals to `document.body` like `MobileGroupNav`.
 */
export function PersonalNav() {
  const { t } = usePersonalTranslation()
  const pathname = useLocation({ select: (location) => location.pathname })

  return (
    <>
      <nav
        aria-label={t('nav.label')}
        className="sticky top-24 hidden w-56 shrink-0 self-start md:block"
      >
        <ul className="flex flex-col gap-1 rounded-xl border bg-card p-2 shadow-xs">
          {TABS.map(({ id, labelKey, to, icon: Icon }) => {
            const active = isTabActive(pathname, to)
            return (
              <li key={id}>
                <Link
                  to={to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon
                    className="size-4.5 shrink-0"
                    strokeWidth={active ? 2.5 : 2}
                    aria-hidden="true"
                  />
                  {t(labelKey)}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <nav
        aria-label={t('nav.label')}
        className="fixed inset-x-0 fixed-bottom-inset z-40 border-t bg-background/95 mobile-bottom-inset shadow-[0_-4px_20px_rgb(0_0_0/0.06)] backdrop-blur supports-backdrop-filter:bg-background/80 md:hidden"
      >
        <div className="mx-auto grid h-(--mobile-nav-bar-height) max-w-lg grid-cols-5 items-stretch px-1">
          {TABS.map(({ id, labelKey, to, icon: Icon }) => {
            const active = isTabActive(pathname, to)
            return (
              <Link
                key={id}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-center text-xs leading-tight font-medium transition-colors',
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon
                  className="motion-nav-icon size-5"
                  strokeWidth={active ? 2.5 : 2}
                  aria-hidden="true"
                />
                <span className="line-clamp-2 max-w-full">{t(labelKey)}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}

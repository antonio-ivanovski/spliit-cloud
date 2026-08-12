import { useLocation, useNavigate } from '@tanstack/react-router'
import { Cloud, Plus, Users } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import {
  SpeedDial,
  SpeedDialAction,
  SpeedDialContent,
  SpeedDialItem,
  SpeedDialLabel,
  SpeedDialTrigger,
} from '@/components/ui/speed-dial'
import { isFocusedMobilePath, isMobileGroupNavPath } from '@/lib/mobile-nav'
import { useCurrentAccount } from '@/lib/use-current-account'
import { cn } from '@/lib/utils'

import { BillCharacter } from './bill-character'
import { useMascotState, type MascotAction } from './mascot-context'

function subscribeToDialogs(callback: () => void) {
  if (
    typeof document === 'undefined' ||
    typeof MutationObserver === 'undefined'
  )
    return () => undefined
  const observer = new MutationObserver(callback)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}

function hasOpenDialog() {
  if (typeof document === 'undefined') return false
  return Boolean(
    document.querySelector('[role="dialog"], [role="alertdialog"]'),
  )
}

export function MascotHost() {
  const preferences = useSyncedAccountPreferences()
  const mascot = useMascotState()
  const { data: account, isPending } = useCurrentAccount()
  const pathname = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [openScope, setOpenScope] = useState<string | null>(null)
  const dialogOpen = useSyncExternalStore(
    subscribeToDialogs,
    hasOpenDialog,
    () => false,
  )

  const homeActions = useMemo<MascotAction[]>(
    () =>
      pathname === '/'
        ? [
            {
              id: 'create-friend-ledger',
              label: t('Groups.createFriendLedgerCard.title'),
              icon: Users,
              onSelect: () => void navigate({ to: '/friends/create' }),
            },
            {
              id: 'import-group',
              label: t('Groups.importGroup'),
              icon: Cloud,
              onSelect: () => void navigate({ to: '/groups/import' }),
            },
            {
              id: 'create-group',
              label: t('Groups.createGroupCard.title'),
              icon: Plus,
              primary: true,
              onSelect: () => void navigate({ to: '/groups/create' }),
            },
          ]
        : [],
    [navigate, pathname, t],
  )

  const actions = mascot?.actions.length ? mascot.actions : homeActions
  const focusedRoute = isFocusedMobilePath(pathname)
  const docked = Boolean(mascot?.busy || focusedRoute || dialogOpen)
  const aboveMobileNav = isMobileGroupNavPath(pathname)
  const hiddenSurface = pathname.endsWith('/expenses/print')
  const interactionScope = `${pathname}:${docked ? 'docked' : 'active'}`
  const open = openScope === interactionScope

  if (
    isPending ||
    !account ||
    preferences?.mascot !== 'bill' ||
    !mascot ||
    hiddenSurface
  ) {
    return null
  }

  const positionClassName = cn(
    'fixed end-3 z-60 sm:end-5',
    aboveMobileNav
      ? 'bottom-[calc(4.65rem+env(safe-area-inset-bottom))] sm:bottom-5'
      : 'bottom-[calc(0.65rem+env(safe-area-inset-bottom))] sm:bottom-5',
  )

  if (docked) {
    return (
      <div
        data-testid="bill-mascot-docked"
        data-reaction={mascot.reaction}
        className={cn(
          positionClassName,
          'pointer-events-none h-16 w-16 opacity-85',
        )}
        aria-hidden="true"
      >
        <BillCharacter
          className="h-full w-full drop-shadow-[0_10px_12px_hsl(var(--foreground)/0.16)]"
          docked
          reaction={mascot.reaction}
          reactionKey={mascot.reactionKey}
        />
      </div>
    )
  }

  if (actions.length === 0) {
    return (
      <button
        type="button"
        data-testid="bill-mascot-trigger"
        data-reaction={mascot.reaction}
        aria-label={t('Mascot.greetBill')}
        className={cn(
          positionClassName,
          'group h-[92px] w-[82px] rounded-[2rem] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
        onClick={() => mascot.react('success', 1_250)}
      >
        <span className="absolute inset-x-2 bottom-1 h-10 rounded-full bg-primary/10 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100" />
        <BillCharacter
          className="relative h-full w-full drop-shadow-[0_12px_13px_hsl(var(--foreground)/0.2)] transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:scale-[1.04] group-active:translate-y-0 group-active:scale-95"
          reaction={mascot.reaction}
          reactionKey={mascot.reactionKey}
        />
      </button>
    )
  }

  return (
    <SpeedDial
      open={open}
      onOpenChange={(nextOpen) =>
        setOpenScope(nextOpen ? interactionScope : null)
      }
      className={positionClassName}
      data-testid="bill-mascot"
      data-reaction={mascot.reaction}
    >
      <SpeedDialContent className="gap-2 pe-1 pb-1.5">
        {actions.map(({ id, label, icon: Icon, onSelect, primary }) => (
          <SpeedDialItem key={id} className="gap-2.5">
            <SpeedDialLabel className="border-border/70 bg-background/92 px-3 py-2 text-sm shadow-lg backdrop-blur-md">
              {label}
            </SpeedDialLabel>
            <SpeedDialAction
              aria-label={label}
              onClick={onSelect}
              className={cn(
                'flex size-12 items-center justify-center rounded-2xl border shadow-xl transition-[transform,background-color] duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring',
                primary
                  ? 'border-primary/70 bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'border-border/70 bg-background/95 text-foreground backdrop-blur-md hover:bg-accent',
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
            </SpeedDialAction>
          </SpeedDialItem>
        ))}
      </SpeedDialContent>
      <SpeedDialTrigger
        aria-label={open ? t('Mascot.closeActions') : t('Mascot.openActions')}
        data-testid="bill-mascot-trigger"
        className="group relative h-[100px] w-[92px] rounded-[2rem] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span
          className={cn(
            'absolute inset-x-1 bottom-0 h-12 rounded-full bg-primary/12 blur-xl transition-opacity duration-300',
            open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        />
        <BillCharacter
          className="relative h-full w-full drop-shadow-[0_14px_14px_hsl(var(--foreground)/0.22)] transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:scale-[1.035] group-active:translate-y-0 group-active:scale-95"
          open={open}
          reaction={mascot.reaction}
          reactionKey={mascot.reactionKey}
        />
      </SpeedDialTrigger>
    </SpeedDial>
  )
}

import { useLocation, useNavigate } from '@tanstack/react-router'
import { Cloud, Plus, Settings, Users } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
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
import {
  hasDiscoveredMascotSettings,
  markMascotSettingsDiscovered,
  subscribeMascotSettingsDiscovered,
} from './mascot-settings-discovery'

const PERSONALITY_TAP_WINDOW_MS = 4_000
const SPEECH_DISMISS_MS = 3_000

function subscribeToBodyMutations(callback: () => void) {
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

function hasFixedActionBar() {
  if (typeof document === 'undefined') return false
  return Boolean(document.querySelector('[data-fixed-action-bar]'))
}

export function MascotHost() {
  const preferences = useSyncedAccountPreferences()
  const mascot = useMascotState()
  const { data: account, isPending } = useCurrentAccount()
  const pathname = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const [openScope, setOpenScope] = useState<string | null>(null)
  const [speechOpen, setSpeechOpen] = useState(false)
  const [speechSuppressed, setSpeechSuppressed] = useState(false)
  const lastPersonalityTap = useRef(0)
  const dialogOpen = useSyncExternalStore(
    subscribeToBodyMutations,
    hasOpenDialog,
    () => false,
  )
  const actionBarOpen = useSyncExternalStore(
    subscribeToBodyMutations,
    hasFixedActionBar,
    () => false,
  )
  const settingsDiscovered = useSyncExternalStore(
    subscribeMascotSettingsDiscovered,
    () => hasDiscoveredMascotSettings(account?.id),
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
  const celebrating =
    mascot?.reaction === 'success' || mascot?.reaction === 'failure'
  const docked = Boolean((mascot?.busy || focusedRoute) && !celebrating)
  const blockedByOverlay = dialogOpen && !celebrating
  const aboveMobileNav = isMobileGroupNavPath(pathname)
  const hiddenSurface = pathname.endsWith('/expenses/print')
  const interactionScope = `${pathname}:${blockedByOverlay ? 'blocked' : 'active'}`
  const hasActions = actions.length > 0
  const interactive = hasActions && !blockedByOverlay
  const open = interactive && openScope === interactionScope
  const showSettings = interactive && !settingsDiscovered

  const openMascotSettings = useCallback(() => {
    markMascotSettingsDiscovered(account?.id)
    setSpeechOpen(false)
    setSpeechSuppressed(true)
    setOpenScope(null)
    void navigate({
      to: '/account/settings',
      hash: 'account-preference-mascot',
    })
  }, [account?.id, navigate])

  const handlePersonalityTap = useCallback(() => {
    if (speechSuppressed) {
      mascot?.react('success', 900)
      return
    }
    const now = Date.now()
    if (now - lastPersonalityTap.current < PERSONALITY_TAP_WINDOW_MS) {
      lastPersonalityTap.current = 0
      setSpeechOpen(true)
      return
    }
    lastPersonalityTap.current = now
    mascot?.react('success', 900)
  }, [mascot, speechSuppressed])

  useEffect(() => {
    if (!speechOpen) return
    const timer = window.setTimeout(() => {
      setSpeechOpen(false)
      setSpeechSuppressed(true)
    }, SPEECH_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [speechOpen])

  if (
    hiddenSurface ||
    preferences?.mascot !== 'bill' ||
    !mascot ||
    (!isPending && !account)
  ) {
    return null
  }

  const positionClassName = cn(
    'fixed end-3 sm:end-5',
    blockedByOverlay ? 'z-40' : celebrating ? 'z-70' : 'z-60',
    actionBarOpen
      ? 'bottom-[calc(4.65rem+env(safe-area-inset-bottom))]'
      : aboveMobileNav
        ? 'bottom-[calc(4.65rem+env(safe-area-inset-bottom))] sm:bottom-5'
        : 'bottom-[calc(0.65rem+env(safe-area-inset-bottom))] sm:bottom-5',
  )

  return (
    <SpeedDial
      open={open}
      onOpenChange={(nextOpen) => {
        if (!interactive) return
        setOpenScope(nextOpen ? interactionScope : null)
      }}
      className={positionClassName}
      data-testid={docked ? 'bill-mascot-docked' : 'bill-mascot'}
      data-reaction={mascot.reaction}
      data-mascot-docked={docked ? 'true' : 'false'}
      data-mascot-blocked={blockedByOverlay ? 'true' : 'false'}
    >
      {speechOpen && !blockedByOverlay && !hasActions && (
        <div
          data-testid="bill-mascot-speech"
          className={cn(
            'pointer-events-auto mb-2 max-w-[13.5rem] rounded-2xl border border-border/70 bg-background/95 px-3 py-2 text-start text-xs leading-snug text-foreground shadow-lg backdrop-blur-md',
            !reducedMotion && 'animate-in fade-in-0 zoom-in-95',
          )}
        >
          <output className="block">{t('Mascot.noActionMessage')}</output>
          <button
            type="button"
            className="mt-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
            onClick={openMascotSettings}
          >
            {t('Mascot.noActionSettings')}
          </button>
        </div>
      )}
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
        {showSettings && (
          <SpeedDialItem className="gap-2.5">
            <SpeedDialLabel className="border-border/60 bg-background/80 px-2.5 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur-md">
              {t('Mascot.settingsAction')}
            </SpeedDialLabel>
            <SpeedDialAction
              aria-label={t('Mascot.settingsAction')}
              data-testid="bill-mascot-settings"
              onClick={openMascotSettings}
              className="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-background/80 text-muted-foreground shadow-md backdrop-blur-md hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Settings className="size-4" aria-hidden="true" />
            </SpeedDialAction>
          </SpeedDialItem>
        )}
      </SpeedDialContent>
      <SpeedDialTrigger
        aria-label={
          hasActions
            ? open
              ? t('Mascot.closeActions')
              : t('Mascot.openActions')
            : t('Mascot.greetBill')
        }
        aria-hidden={blockedByOverlay ? true : undefined}
        data-testid="bill-mascot-trigger"
        data-reaction={mascot.reaction}
        className={cn(
          'group relative rounded-[2rem] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          docked ? 'h-16 w-16 opacity-85' : 'h-[118px] w-[108px]',
          blockedByOverlay && 'pointer-events-none',
        )}
        onClick={(event) => {
          if (blockedByOverlay) {
            event.preventDefault()
            return
          }
          if (hasActions) return
          event.preventDefault()
          handlePersonalityTap()
        }}
      >
        <span
          className={cn(
            'absolute inset-x-1 bottom-0 h-12 rounded-full bg-primary/12 blur-xl transition-opacity duration-300',
            open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            docked && 'opacity-0',
          )}
        />
        <BillCharacter
          className={cn(
            'relative h-full w-full drop-shadow-[0_14px_14px_hsl(var(--foreground)/0.22)]',
            !docked &&
              'transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:scale-[1.035] group-active:translate-y-0 group-active:scale-95',
          )}
          docked={docked}
          open={open}
          reaction={mascot.reaction}
          reactionKey={mascot.reactionKey}
        />
      </SpeedDialTrigger>
    </SpeedDial>
  )
}

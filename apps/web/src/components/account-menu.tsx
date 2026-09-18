import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  LogOut,
  MessageSquareText,
  Settings as SettingsIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { clearPushOnboardingCompletion } from '@/components/push-notification-onboarding'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { isPlaceholderEmail } from '@/lib/account'
import { authClient } from '@/lib/auth'
import { replaceBrowserLocation } from '@/lib/browser-navigation'
import { useMediaQuery } from '@/lib/hooks'
import { clearLastAccount } from '@/lib/last-account'
import {
  useOfflineSession,
  useOptionalOfflineLifecycle,
} from '@/lib/offline/provider'
import { disconnectPushSubscription } from '@/lib/push-notifications'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'

export function AccountMenu() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Header' })
  const { t: tOffline } = useTranslation()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: account, isPending } = useCurrentAccount()
  const isOnline = useOnlineStatus()
  const lifecycle = useOptionalOfflineLifecycle()
  const { cleanupError } = useOfflineSession()
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const [menuOpen, setMenuOpen] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState(false)
  const [retryingCleanup, setRetryingCleanup] = useState(false)

  if (isPending) {
    return (
      <div className="size-11 animate-pulse rounded-full bg-muted sm:size-8" />
    )
  }

  // Unauthenticated: render nothing. The homepage provides the sign-in CTA,
  // and protected routes redirect to `/` via `RequireAuth`.
  if (!account) {
    return null
  }
  const currentAccount = account
  const accountId = account.id

  const accountTrigger = (
    <button
      type="button"
      className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden"
      aria-label={t('account')}
    >
      <AccountAvatar account={account} size="lg" />
    </button>
  )

  async function signOut() {
    if (signingOut) return
    // Offline sign-out is not introduced: server-confirmed sign-out only.
    // Clearing downloads (settings) stays available offline and never revokes
    // the server session. Offline uses a distinct "Connect to sign out" hint,
    // never the generic failure copy.
    if (!isOnline) {
      toast({ description: t('signOutOffline'), variant: 'destructive' })
      return
    }
    setSigningOut(true)
    setSignOutError(false)
    try {
      const disconnected = await disconnectPushSubscription()
      if (disconnected) clearPushOnboardingCompletion(accountId)
      const result = await authClient.signOut()
      if (result?.error) throw new Error(result.error.message)
      // Local revocation runs even if durable cleanup fails; the lifecycle
      // fences the namespace via marker + generation and surfaces a cleanup
      // failure instead of claiming silent disk success.
      if (lifecycle) {
        await lifecycle.signOut({ navigateTo: '' })
        // Lifecycle owns last-account + query fencing; navigate out without
        // relying on SPA caches.
        clearLastAccount()
        queryClient.clear()
        replaceBrowserLocation('/')
      } else {
        clearLastAccount()
        queryClient.clear()
        replaceBrowserLocation('/')
      }
    } catch {
      setSignOutError(true)
      toast({ description: t('signOutError'), variant: 'destructive' })
    } finally {
      setSigningOut(false)
    }
  }

  function requestSignOut() {
    setMenuOpen(false)
    if (currentAccount.isAnonymous) {
      setSignOutError(false)
      setSignOutOpen(true)
      return
    }
    void signOut()
  }

  async function handleRetryCleanup() {
    if (retryingCleanup || !lifecycle?.retryCleanup) return
    setRetryingCleanup(true)
    try {
      const ok = await lifecycle.retryCleanup()
      if (!ok) {
        toast({
          description: tOffline('OfflineDownloads.cleanupFailed'),
          variant: 'destructive',
        })
      }
    } finally {
      setRetryingCleanup(false)
    }
  }

  return (
    <>
      {cleanupError ? (
        <div
          className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive"
          role="alert"
          data-testid="offline-cleanup-error"
        >
          <span>{tOffline('OfflineDownloads.cleanupFailed')}</span>
          <button
            type="button"
            data-testid="cleanup-retry"
            disabled={retryingCleanup}
            onClick={() => void handleRetryCleanup()}
            className="font-medium underline underline-offset-4 hover:no-underline disabled:opacity-50"
          >
            {tOffline('OfflineEmptyState.retry')}
          </button>
        </div>
      ) : null}
      {isDesktop ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={accountTrigger} />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="font-medium">{account.name}</span>
                {!isPlaceholderEmail(account.email) && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {account.email}
                  </span>
                )}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/account/settings" />}>
              <SettingsIcon className="me-2 h-4 w-4" />
              {t('accountSettings')}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link to="/feedback" />}>
              <MessageSquareText className="me-2 h-4 w-4" />
              {t('feedback')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={requestSignOut}
            >
              <LogOut className="me-2 h-4 w-4" />
              {t('signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <ResponsiveDialog open={menuOpen} onOpenChange={setMenuOpen}>
          <ResponsiveDialogTrigger render={accountTrigger} />
          <ResponsiveDialogContent className="sm:max-w-sm">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{account.name}</ResponsiveDialogTitle>
              {!isPlaceholderEmail(account.email) && (
                <ResponsiveDialogDescription>
                  {account.email}
                </ResponsiveDialogDescription>
              )}
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody className="flex flex-col gap-1 pb-[var(--safe-area-bottom)]">
              <ResponsiveDialogClose
                render={
                  <Link
                    to="/account/settings"
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                  >
                    <SettingsIcon
                      className="size-5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {t('accountSettings')}
                  </Link>
                }
              />
              <ResponsiveDialogClose
                render={
                  <Link
                    to="/feedback"
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                  >
                    <MessageSquareText
                      className="size-5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {t('feedback')}
                  </Link>
                }
              />
              <button
                type="button"
                className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-start text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                onClick={requestSignOut}
              >
                <LogOut className="size-5" aria-hidden="true" />
                {t('signOut')}
              </button>
            </ResponsiveDialogBody>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}
      <ResponsiveDialog
        open={signOutOpen}
        onOpenChange={(open) => {
          if (!open && signingOut) return
          setSignOutOpen(open)
          if (!open) setSignOutError(false)
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('signOutTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('anonymousSignOutWarning')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {signOutError ? (
            <p className="text-sm text-destructive" role="alert">
              {t('signOutError')}
            </p>
          ) : null}
          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSignOutOpen(false)}
              disabled={signingOut}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void signOut()}
              disabled={signingOut}
            >
              {signingOut ? (
                <span className="me-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
              ) : null}
              {t('signOut')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

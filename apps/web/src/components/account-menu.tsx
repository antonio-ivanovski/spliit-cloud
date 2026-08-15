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
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { isPlaceholderEmail } from '@/lib/account'
import { authClient } from '@/lib/auth'
import { replaceBrowserLocation } from '@/lib/browser-navigation'
import { clearLastAccount } from '@/lib/last-account'
import { disconnectPushSubscription } from '@/lib/push-notifications'
import { useCurrentAccount } from '@/lib/use-current-account'

export function AccountMenu() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Header' })
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: account, isPending } = useCurrentAccount()
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState(false)

  if (isPending) {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
  }

  // Unauthenticated: render nothing. The homepage provides the sign-in CTA,
  // and protected routes redirect to `/` via `RequireAuth`.
  if (!account) {
    return null
  }
  const accountId = account.id

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    setSignOutError(false)
    try {
      const disconnected = await disconnectPushSubscription()
      if (disconnected) clearPushOnboardingCompletion(accountId)
      const result = await authClient.signOut()
      if (result?.error) throw new Error(result.error.message)
      clearLastAccount()
      queryClient.clear()
      replaceBrowserLocation('/')
    } catch {
      setSignOutError(true)
      toast({ description: t('signOutError'), variant: 'destructive' })
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden"
              aria-label={t('account')}
            />
          }
        >
          <AccountAvatar account={account} size="lg" />
        </DropdownMenuTrigger>
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
            onClick={() => {
              if (account.isAnonymous) {
                setSignOutError(false)
                setSignOutOpen(true)
                return
              }
              void signOut()
            }}
          >
            <LogOut className="me-2 h-4 w-4" />
            {t('signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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

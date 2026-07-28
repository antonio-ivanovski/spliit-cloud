import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { LogOut, Settings as SettingsIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { clearPushOnboardingCompletion } from '@/components/push-notification-onboarding'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isPlaceholderEmail } from '@/lib/account'
import { authClient } from '@/lib/auth'
import { disconnectPushSubscription } from '@/lib/push-notifications'
import { useCurrentAccount } from '@/lib/use-current-account'

export function AccountMenu() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Header' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: account, isPending } = useCurrentAccount()

  if (isPending) {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
  }

  // Unauthenticated: render nothing. The homepage provides the sign-in CTA,
  // and protected routes redirect to `/` via `RequireAuth`.
  if (!account) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden"
          aria-label={t('account')}
        >
          <AccountAvatar account={account} size="lg" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium">{account.name}</span>
          {!isPlaceholderEmail(account.email) && (
            <span className="text-xs font-normal text-muted-foreground">
              {account.email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account/settings">
            <SettingsIcon className="mr-2 h-4 w-4" />
            {t('accountSettings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={async (event) => {
            event.preventDefault()
            const disconnected = await disconnectPushSubscription()
            if (disconnected) clearPushOnboardingCompletion(account.id)
            await authClient.signOut()
            queryClient.clear()
            await navigate({ to: '/', replace: true })
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

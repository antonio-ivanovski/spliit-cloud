import { AccountAvatar } from '@/components/account-avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { authClient } from '@/lib/auth'
import { disconnectPushSubscription } from '@/lib/push-notifications'
import { useCurrentAccount } from '@/lib/use-current-account'
import { Link, useNavigate } from '@tanstack/react-router'
import { LogOut, Settings as SettingsIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function AccountMenu() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Header' })
  const navigate = useNavigate()
  const { data: account, isPending } = useCurrentAccount()

  if (isPending) {
    return <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
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
          className="rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={t('account')}
        >
          <AccountAvatar account={account} size="lg" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium">{account.name}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {account.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account/settings">
            <SettingsIcon className="w-4 h-4 mr-2" />
            {t('accountSettings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={async (event) => {
            event.preventDefault()
            await disconnectPushSubscription()
            await authClient.signOut()
            navigate({ to: '/', replace: true })
          }}
        >
          <LogOut className="w-4 h-4 mr-2" />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

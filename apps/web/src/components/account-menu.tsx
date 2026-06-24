'use client'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslations } from '@/i18n/react'
import { authClient } from '@/lib/auth'
import { useRouter } from '@/lib/navigation'
import { useCurrentAccount } from '@/lib/use-current-account'
import { LogOut, User as UserIcon } from 'lucide-react'

export function AccountMenu() {
  const t = useTranslations('Header')
  const router = useRouter()
  const { data: account, isPending } = useCurrentAccount()

  if (isPending) {
    return <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
  }

  // Unauthenticated: render nothing. The homepage provides the sign-in CTA,
  // and protected routes redirect to `/auth/sign-in` via `RequireAuth`.
  if (!account) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={t('account')}
        >
          <Avatar className="h-8 w-8 bg-primary/10">
            <AvatarFallback className="bg-transparent p-0">
              <UserIcon className="w-4 h-4 text-primary" />
            </AvatarFallback>
          </Avatar>
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
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={async (event) => {
            event.preventDefault()
            await authClient.signOut()
            router.replace('/')
          }}
        >
          <LogOut className="w-4 h-4 mr-2" />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

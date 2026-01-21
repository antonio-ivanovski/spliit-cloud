'use client'

import { SyncDashboard } from '@/components/sync/sync-dashboard'
import { SyncLoginForm } from '@/components/sync/sync-login-form'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useSyncAuth } from '@/lib/auth/use-sync-auth'
import { Bell, Cloud } from 'lucide-react'
import { useTranslations } from 'next-intl'

type OAuthProviders = {
  google: boolean
  github: boolean
}

type SettingsClientProps = {
  oauthProviders: OAuthProviders
  enableGroupSync: boolean
  enableNotifications: boolean
}

export function SettingsClient({
  oauthProviders,
  enableGroupSync,
  enableNotifications,
}: SettingsClientProps) {
  const t = useTranslations('Settings')
  const { isAuthenticated, user, isLoading, logout, logoutAll, deleteAccount } =
    useSyncAuth()

  if (!enableGroupSync && !enableNotifications) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('empty.title')}</CardTitle>
          <CardDescription>{t('empty.description')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {enableGroupSync ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cloud className="h-4 w-4 text-emerald-500" />
              {t('groupSync.title')}
            </CardTitle>
            <CardDescription>{t('groupSync.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">
                {t('groupSync.loading')}
              </p>
            ) : !isAuthenticated || !user ? (
              <SyncLoginForm oauthProviders={oauthProviders} />
            ) : (
              <SyncDashboard
                user={user}
                onLogout={logout}
                onLogoutAll={logoutAll}
                onDeleteAccount={deleteAccount}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {enableNotifications ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4 text-emerald-500" />
              {t('notifications.title')}
            </CardTitle>
            <CardDescription>{t('notifications.description')}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t('comingSoon')}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

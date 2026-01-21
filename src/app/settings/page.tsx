import { SettingsClient } from '@/app/settings/settings-client'
import { env } from '@/lib/env'
import { getRuntimeFeatureFlags } from '@/lib/featureFlags'
import { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export const metadata: Metadata = {
  title: 'Settings',
}

export default async function SettingsPage() {
  const t = await getTranslations('Settings')
  const flags = await getRuntimeFeatureFlags()
  const oauthProviders = {
    google: !!env.GOOGLE_OAUTH_CLIENT_ID && !!env.GOOGLE_OAUTH_CLIENT_SECRET,
    github: !!env.GITHUB_OAUTH_CLIENT_ID && !!env.GITHUB_OAUTH_CLIENT_SECRET,
  }

  return (
    <main className="flex-1 max-w-screen-md w-full mx-auto px-4 py-6 flex flex-col gap-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      <SettingsClient
        oauthProviders={oauthProviders}
        enableGroupSync={flags.enableGroupSync}
        enableNotifications={flags.enableNotifications}
        enableWebhooks={flags.enableWebhooks}
      />
    </main>
  )
}

import { getRouteApi } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthPanel } from '@/components/auth/auth-panel'
import { authClient } from '@/lib/auth'

import { resolveOAuthQuery, resumeOAuthAuthorization } from './oauth-api'
import { OAuthShell } from './oauth-shell'

const route = getRouteApi('/oauth/login')

export function OAuthLoginPage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'OAuth.login' })
  const { oauth_query: explicitOAuthQuery } = route.useSearch()
  const oauthQuery = resolveOAuthQuery(explicitOAuthQuery)
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const attemptedQuery = useRef<string | null>(null)

  const resumePath = useMemo(() => {
    return oauthQuery ? `/oauth/login?${oauthQuery}` : '/oauth/login'
  }, [oauthQuery])

  useEffect(() => {
    if (!session || !oauthQuery || attemptedQuery.current === oauthQuery) return
    attemptedQuery.current = oauthQuery
    resumeOAuthAuthorization(oauthQuery)
  }, [oauthQuery, session])

  if (!oauthQuery) {
    return (
      <OAuthShell
        title={t('missingTitle')}
        description={t('missingDescription')}
      >
        <p className="text-sm text-destructive" role="alert">
          {t('missingError')}
        </p>
      </OAuthShell>
    )
  }

  if (sessionPending || session) {
    return (
      <OAuthShell
        title={t('connectingTitle')}
        description={t('connectingDescription')}
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <Loader2
            className="h-7 w-7 animate-spin text-primary"
            aria-hidden="true"
          />
          <output className="text-sm text-muted-foreground">
            {sessionPending ? t('checkingSession') : t('continuing')}
          </output>
        </div>
      </OAuthShell>
    )
  }

  return (
    <OAuthShell title={t('signInTitle')} description={t('signInDescription')}>
      <AuthPanel embedded redirectTo={resumePath} />
    </OAuthShell>
  )
}

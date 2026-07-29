import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  ArrowRight,
  Bot,
  Database,
  Eye,
  Loader2,
  LockKeyhole,
  PlusCircle,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth'

import {
  getOAuthPublicClient,
  resolveOAuthQuery,
  submitConsent,
} from './oauth-api'
import { OAuthShell } from './oauth-shell'

const route = getRouteApi('/oauth/consent')

export function OAuthConsentPage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'OAuth.consent' })
  const {
    oauth_query: explicitOAuthQuery,
    client_id: clientId,
    scope,
  } = route.useSearch()
  const oauthQuery = resolveOAuthQuery(explicitOAuthQuery)
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const client = useQuery({
    queryKey: ['oauth-public-client', clientId],
    queryFn: () => getOAuthPublicClient(clientId ?? ''),
    enabled: Boolean(clientId),
    retry: false,
  })
  const [pending, setPending] = useState<'accept' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestedScopes = new Set(scope?.split(' ') ?? [])
  const clientName = client.data?.client_name ?? t('defaultClient')
  const account = session?.user

  async function decide(accept: boolean) {
    if (!oauthQuery) {
      setError(t('missingRequest'))
      return
    }
    setPending(accept ? 'accept' : 'deny')
    setError(null)
    await submitConsent({ accept, oauthQuery, scope }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPending(null)
    })
  }

  return (
    <OAuthShell
      title={t('title', { client: clientName })}
      description={t('description')}
    >
      <div className="grid gap-3">
        <section
          className="relative min-w-0 overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.045] px-3 py-2.5 sm:px-3.5"
          aria-label={t('connectionDetails')}
          data-testid="oauth-connection-panel"
        >
          <div className="absolute -top-12 -right-12 size-24 rounded-full bg-primary/10 blur-2xl" />
          <div className="relative grid min-w-0 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
            <IdentitySummary label={t('spliitAccount')}>
              {sessionPending ? (
                <Loader2 className="size-5 animate-spin text-primary" />
              ) : account ? (
                <>
                  <AccountAvatar account={account} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {account.name || t('defaultUser')}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {account.email}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-destructive">
                  {t('sessionUnavailable')}
                </p>
              )}
            </IdentitySummary>

            <div className="flex items-center justify-center text-primary sm:px-1">
              <ArrowRight
                className="size-4 rotate-90 sm:rotate-0"
                aria-hidden="true"
              />
            </div>

            <IdentitySummary label={t('connectingTo')}>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/20">
                <Bot className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p
                  className="truncate text-sm font-semibold"
                  title={clientName}
                >
                  {clientName}
                </p>
                <p className="text-xs break-words text-muted-foreground">
                  {t('assistantVia')}
                </p>
              </div>
            </IdentitySummary>
          </div>
        </section>

        <section className="grid gap-2" aria-labelledby="shared-data-title">
          <div className="flex items-center gap-2 md:col-span-2">
            <Database className="size-4 text-primary" aria-hidden="true" />
            <h2 id="shared-data-title" className="text-sm font-semibold">
              {t('sharedData')}
            </h2>
          </div>
          <div className="grid gap-2 md:col-span-2 md:grid-cols-3">
            <Permission
              icon={<Eye className="size-4" />}
              title={t('identityTitle')}
              description={t('identityDescription')}
            />
            {requestedScopes.has('spliit:groups:read') && (
              <Permission
                icon={<Database className="size-4" />}
                title={t('groupsTitle')}
                description={t('groupsDescription')}
              />
            )}
            {requestedScopes.has('spliit:expenses:write') && (
              <Permission
                icon={<PlusCircle className="size-4" />}
                title={t('expensesTitle')}
                description={t('expensesDescription')}
              />
            )}
          </div>
        </section>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <section
            className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-2.5"
            aria-labelledby="risk-title"
          >
            <div className="flex gap-2">
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
                aria-hidden="true"
              />
              <div>
                <h2 id="risk-title" className="text-sm font-semibold">
                  {t('privacyTitle')}
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t('privacyDescription', { client: clientName })}
                </p>
              </div>
            </div>
          </section>

          <div className="flex items-start gap-2 rounded-xl bg-muted/35 px-2.5 py-2">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              {t('authorityNote')}
            </p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row-reverse">
          <Button
            className="sm:min-w-48"
            disabled={pending !== null || !account}
            onClick={() => void decide(true)}
          >
            {pending === 'accept' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LockKeyhole className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {t('allow')}
          </Button>
          <Button
            variant="outline"
            className="sm:min-w-28"
            disabled={pending !== null}
            onClick={() => void decide(false)}
          >
            {pending === 'deny' && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t('cancel')}
          </Button>
        </div>
      </div>
    </OAuthShell>
  )
}

function Permission({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex min-w-0 gap-2.5 rounded-lg border bg-background/70 p-2.5">
      <div className="mt-0.5 text-primary" aria-hidden="true">
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}

function IdentitySummary({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0 overflow-hidden">
      <p className="mb-1.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </p>
      <div className="flex min-h-8 min-w-0 items-center gap-2.5">
        {children}
      </div>
    </div>
  )
}

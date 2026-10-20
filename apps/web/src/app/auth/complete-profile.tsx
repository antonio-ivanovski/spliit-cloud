import { getRouteApi, Navigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnonymousRecoveryOnboarding } from '@/components/auth/anonymous-recovery-onboarding'
import { AnonymousSafeguardChoice } from '@/components/auth/anonymous-safeguard-choice'
import { PageInset, PageShell } from '@/components/layout/page-shell'
import { OfflineEmptyState } from '@/components/offline-empty-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isPlaceholderEmail } from '@/lib/account'
import { useDeploymentConfig } from '@/lib/deployment-config'
import { markInstallEligible } from '@/lib/install-eligibility'
import { isPasskeySupported } from '@/lib/passkey'
import {
  buildAuthBounceSearch,
  resolveAuthReturnContext,
  splitAuthDestination,
} from '@/lib/signup-invite'
import { useOnboardingStatus } from '@/lib/use-onboarding-status'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

const completeProfileRouteApi = getRouteApi('/auth/complete-profile')

/**
 * First-run account setup. The display name comes first on purpose: the
 * safeguard step passes it as the WebAuthn ceremony identity (`user.name`) when
 * registering a passkey, so the authenticator entry carries the real name
 * instead of the `guest-…@anonymous.placeholder.local` placeholder (baked at
 * creation and unfixable afterwards). Anonymous users then save their recovery
 * link (or register that passkey); magic-link sign-ups only ever see the name
 * step.
 *
 * If neither step is needed, the route redirects to the original `redirect`
 * target (defaulting to `/`). Signed-out visitors are sent to `/` with a
 * redirect back here.
 */
export function CompleteProfilePage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'CompleteProfile' })
  const { t: tSignup } = useTranslation(undefined, {
    keyPrefix: 'AnonymousAccount.signup',
  })
  const { redirect, invite, viewKey, invitation, invitationAction } =
    completeProfileRouteApi.useSearch()
  // Structured return: the bearer context arrives as first-class params, so
  // no nested-bounce chain can drop the credentials on the way out.
  const returnContext = resolveAuthReturnContext({
    redirect,
    invite,
    viewKey,
    invitation,
    invitationAction,
  })
  const redirectTo = returnContext.redirectTo
  // Any bounce param on this route must survive the settle wait: the
  // `!account` bounce below re-emits them. The loader above only waits when
  // bounce params are present — the plain name form still renders immediately.
  const bounceSearchPresent = Boolean(
    redirect || invite || viewKey || invitation,
  )
  const {
    account,
    isPending,
    refetch,
    needsProfile,
    needsSafeguard,
    needsOnboarding,
    statusPending,
    authReturnSettled,
    refetchStatus,
  } = useOnboardingStatus()
  const deployment = useDeploymentConfig()
  const isOnline = useOnlineStatus()
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false)

  // Fresh-account landing (sign-up verification, OAuth/magic-link first
  // login, anonymous upgrade): needing setup here counts as the successful
  // account creation that arms install promotion. Accounts with nothing to
  // do redirect out below without marking, so restored sessions stay out.
  const onboardingActive = !isPending && !!account && needsOnboarding
  useEffect(() => {
    if (onboardingActive) markInstallEligible()
  }, [onboardingActive])
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateProfile = trpc.account.updateProfile.useMutation()

  const needsRecovery = needsSafeguard && !recoveryAcknowledged
  const signedInLabel = account
    ? !isPlaceholderEmail(account.email)
      ? account.email
      : account.name && account.name !== account.email
        ? account.name
        : null
    : null

  const handleRecoveryComplete = useCallback(async () => {
    setRecoveryAcknowledged(true)
    await refetch({ query: { disableCookieCache: true } })
    // The safeguard flips the server flag: refresh the authoritative status
    // so the redirect-out decision below sees it even if the session read
    // above is still stale.
    await refetchStatus()
  }, [refetch, refetchStatus])

  // The name form renders immediately, but every Navigate below must wait
  // for the authoritative safeguard flag: a named session alone cannot tell
  // a finished account from one still awaiting its safeguard. While a fresh
  // anonymous session settles, interim verdicts flap between renders —
  // navigating on them ping-pongs `/` against `/auth/complete-profile` on
  // every session emission (the "slowing down Firefox" race). With bounce
  // params present, hold the loader until the verdict is stable instead; the
  // URL escrows the token, so holding sheds nothing. Without bounce params
  // the form still renders immediately as before.
  if (
    isPending ||
    (statusPending && !!account && !needsProfile) ||
    (!authReturnSettled && bounceSearchPresent)
  ) {
    return (
      <PageShell width="full" className="items-center justify-center py-10">
        <PageInset>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </PageInset>
      </PageShell>
    )
  }

  if (!account) {
    // Bounce back here after sign-in through `/`, keeping the bearer context
    // structured — never nested inside another `redirect=`.
    const backSearch = new URLSearchParams()
    if (redirect) backSearch.set('redirect', redirect)
    if (invite) backSearch.set('invite', invite)
    if (viewKey) backSearch.set('viewKey', viewKey)
    if (invitation) backSearch.set('invitation', invitation)
    if (invitationAction) backSearch.set('invitationAction', invitationAction)
    const backQuery = backSearch.toString()
    return (
      <Navigate
        to="/"
        search={buildAuthBounceSearch({
          writer: 'complete-profile',
          from: `/auth/complete-profile${backQuery ? `?${backQuery}` : ''}`,
        })}
        replace
      />
    )
  }

  if (!needsOnboarding) {
    // Split the destination: `redirectTo` embeds its query
    // (`/groups/X?invite=T`) and query-in-`to` serializes verbatim — each
    // lap would append another `?invite=T` to the value (the mangled-URL
    // bug). `search` as an object encodes exactly once.
    const destination = splitAuthDestination(redirectTo)
    return (
      <Navigate
        to={destination.to}
        search={destination.search}
        hash={destination.hash}
        replace
      />
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('errors.nameRequired'))
      return
    }
    if (trimmed.length < 2) {
      setError(t('errors.nameTooShort'))
      return
    }
    setSubmitting(true)
    try {
      await updateProfile.mutateAsync({ name: trimmed })
      // Bust better-auth's cookie-cached session so `useCurrentAccount`
      // returns the updated name on the next read. No navigation here: the
      // re-rendered account routes itself — the safeguard step while
      // anonymous onboarding is still pending, otherwise the redirect below.
      // Rendering the safeguard only after this refetch is also what
      // guarantees the safeguard step can pass the fresh name as the passkey
      // ceremony identity.
      await refetch({ query: { disableCookieCache: true } })
    } catch {
      setError(t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  if (needsProfile) {
    // Saving the name is a network mutation: stay on an offline state
    // instead of a form whose submit cannot succeed.
    if (!isOnline) {
      return (
        <PageShell width="full" className="items-center justify-center py-10">
          <Card className="w-full max-w-sm">
            <CardContent spacing="standalone">
              <OfflineEmptyState variant="plain" />
            </CardContent>
          </Card>
        </PageShell>
      )
    }
    return (
      <PageShell width="full" className="items-center justify-center py-10">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl">{t('title')}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {signedInLabel ? (
              <p className="mb-4 text-center text-xs text-muted-foreground">
                {t('signedInAs', { email: signedInLabel })}
              </p>
            ) : null}
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="grid gap-1.5">
                <Label htmlFor="profile-name">{t('nameLabel')}</Label>
                <Input
                  id="profile-name"
                  type="text"
                  autoComplete="name"
                  placeholder={t('namePlaceholder')}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (error) setError(null)
                  }}
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !name.trim()}
              >
                {submitting && (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                )}
                {submitting ? t('saving') : t('submit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </PageShell>
    )
  }

  if (needsRecovery) {
    // Same safeguard choice as the signup dialog: closing the dialog (or a
    // passkey-less creation path) must not silently drop the passkey
    // alternative. The Card owns the heading here, so the embedded
    // onboarding hides its own title (see AnonymousSafeguardChoice).
    const passkeyAvailable =
      deployment.enablePasskeyAuth && isPasskeySupported()
    return (
      <PageShell width="full" className="items-center justify-center py-10">
        <Card className="w-full max-w-xl">
          {passkeyAvailable ? (
            <>
              <CardHeader className="space-y-2 text-center">
                <CardTitle className="text-2xl">
                  {tSignup('choiceTitle')}
                </CardTitle>
                <CardDescription>
                  {tSignup('choiceDescription')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AnonymousSafeguardChoice
                  displayName={account.name ?? ''}
                  onComplete={handleRecoveryComplete}
                />
              </CardContent>
            </>
          ) : (
            <CardContent spacing="standalone">
              <AnonymousRecoveryOnboarding
                onComplete={handleRecoveryComplete}
              />
            </CardContent>
          )}
        </Card>
      </PageShell>
    )
  }

  // Unreachable: the early redirect above covers `!needsProfile &&
  // !needsRecovery`, and every other state returns its step. Kept as a
  // redirect (not a form) so a future predicate change fails closed to the
  // redirect target instead of stranding the account.
  const fallback = splitAuthDestination(redirectTo)
  return (
    <Navigate
      to={fallback.to}
      search={fallback.search}
      hash={fallback.hash}
      replace
    />
  )
}

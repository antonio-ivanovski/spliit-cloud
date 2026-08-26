import { getRouteApi, Navigate, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnonymousRecoveryOnboarding } from '@/components/auth/anonymous-recovery-onboarding'
import { PageInset, PageShell } from '@/components/layout/page-shell'
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
import {
  isPlaceholderEmail,
  needsAnonymousOnboarding,
  needsDisplayName,
} from '@/lib/account'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'

const completeProfileRouteApi = getRouteApi('/auth/complete-profile')

/**
 * First-run account setup. Anonymous users save their recovery link here, then
 * (like magic-link sign-up) choose a display name.
 *
 * If neither step is needed, the route redirects to the original `redirect`
 * target (defaulting to `/`). Signed-out visitors are sent to `/` with a
 * redirect back here.
 */
export function CompleteProfilePage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'CompleteProfile' })
  const navigate = useNavigate()
  const { redirect } = completeProfileRouteApi.useSearch()
  const redirectTo = redirect ?? '/'
  const { data: account, isPending, refetch } = useCurrentAccount()
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false)

  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateProfile = trpc.account.updateProfile.useMutation()

  const needsProfile = !!account && needsDisplayName(account)
  const needsRecovery =
    !!account && needsAnonymousOnboarding(account) && !recoveryAcknowledged
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
  }, [refetch])

  if (isPending) {
    return (
      <PageShell width="full" className="items-center justify-center py-10">
        <PageInset>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </PageInset>
      </PageShell>
    )
  }

  if (!account) {
    const back = `/auth/complete-profile?redirect=${encodeURIComponent(redirectTo)}`
    return <Navigate to="/" search={{ redirect: back }} replace />
  }

  if (!needsProfile && !needsRecovery) {
    return <Navigate to={redirectTo} replace />
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
      // returns the updated name on the next read.
      await refetch({ query: { disableCookieCache: true } })
      await navigate({ href: redirectTo, replace: true })
    } catch {
      setError(t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  if (needsRecovery) {
    return (
      <PageShell width="full" className="items-center justify-center py-10">
        <Card className="w-full max-w-xl">
          <CardContent className="pt-6">
            <AnonymousRecoveryOnboarding onComplete={handleRecoveryComplete} />
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
                onChange={(e) => setName(e.target.value)}
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
              {submitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {submitting ? t('saving') : t('submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  )
}

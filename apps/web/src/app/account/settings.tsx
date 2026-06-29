import { RequireAuth } from '@/components/require-auth'
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
import { useToast } from '@/components/ui/use-toast'
import { useRouter } from '@/lib/navigation'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Account settings page. Allows a signed-in user to update their display
 * name and view (read-only) the email tied to their account. Reuses the
 * same `account.updateProfile` mutation as the magic-link
 * `complete-profile` flow, with matching validation (trimmed name,
 * 2-50 characters).
 */
export function AccountSettingsPage() {
  return (
    <RequireAuth>
      <AccountSettingsContent />
    </RequireAuth>
  )
}

function AccountSettingsContent() {
  const { t } = useTranslation(undefined, { keyPrefix: 'AccountSettings' })
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: 'Header' })
  const { data: account, isPending, refetch } = useCurrentAccount()
  const router = useRouter()
  const utils = trpc.useUtils()
  const { toast } = useToast()

  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateProfile = trpc.account.updateProfile.useMutation({
    onSuccess: async () => {
      // Bust better-auth's cookie-cached session so the account menu
      // (and anywhere else reading the session) updates immediately.
      await refetch({ query: { disableCookieCache: true } })
      // Invalidate every cached tRPC response that resolves the
      // account's display name through `Account.name` — the previous
      // snapshot is now stale. This covers the account menu, group
      // lists, group detail (participants), members, expenses, balances,
      // activity feed, invitations, and stats.
      await Promise.all([
        utils.account.invalidate(),
        utils.groups.invalidate(),
        utils.invitations.invalidate(),
      ])
      toast({ description: t('success') })
    },
  })

  // Seed the name input from the current account the first time the
  // session resolves. The `name === ''` guard avoids overwriting the
  // user's in-progress edits if `account` re-fetches (e.g. after the
  // profile is updated).
  useEffect(() => {
    if (account?.name && name === '') {
      setName(account.name)
    }
  }, [account?.name, name])

  if (isPending || !account) {
    return (
      <main className="flex-1 max-w-screen-md w-full mx-auto px-4 py-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  function handleBack() {
    // Prefer browser history when available (e.g. arriving from the
    // account menu); fall back to the home page when the user landed
    // here directly (deep link, new tab, ...).
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.replace({ href: '/' })
    }
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
    if (trimmed.length > 50) {
      setError(t('errors.nameTooLong'))
      return
    }
    setSubmitting(true)
    try {
      await updateProfile.mutateAsync({ name: trimmed })
    } catch {
      setError(t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  const isDirty = name.trim() !== (account.name ?? '')

  return (
    <main className="flex-1 max-w-screen-md w-full mx-auto px-4 py-6 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2"
          onClick={handleBack}
          title={tCommon('back')}
          aria-label={tCommon('back')}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        {t('title')}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('profile.title')}</CardTitle>
          <CardDescription>{t('profile.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="account-settings-name">{t('nameLabel')}</Label>
              <Input
                id="account-settings-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={50}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-settings-email">{t('emailLabel')}</Label>
              <Input
                id="account-settings-email"
                type="email"
                value={account.email ?? ''}
                readOnly
                disabled
              />
              <p className="text-xs text-muted-foreground">{t('emailHelp')}</p>
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={submitting || updateProfile.isPending || !isDirty}
              >
                {(submitting || updateProfile.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {submitting || updateProfile.isPending
                  ? t('saving')
                  : t('submit')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

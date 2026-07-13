import { AccountAvatar } from '@/components/account-avatar'
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
import { prepareProfileImage } from '@/lib/upload'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
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
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const { toast } = useToast()

  const [dirtyName, setDirtyName] = useState<string | null>(null)
  const name = dirtyName ?? account?.name ?? ''
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  async function refreshAccount() {
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
  }

  const updateProfile = trpc.account.updateProfile.useMutation({
    onSuccess: async () => {
      await refreshAccount()
      toast({ description: t('success') })
    },
  })
  const removeProfileImage = trpc.account.removeProfileImage.useMutation({
    onSuccess: refreshAccount,
  })
  const setProfileImage = trpc.account.setProfileImage.useMutation()
  const presignProfileImage = trpc.uploads.profileImagePresign.useMutation()

  // `name` is derived from `dirtyName ?? account?.name` so the input
  // automatically reflects the server-side value when the account loads
  // and keeps local edits intact once the user starts typing.

  if (isPending || !account) {
    return (
      <main className="flex-1 max-w-(--breakpoint-md) w-full mx-auto px-3 py-4 sm:px-4 sm:py-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  function handleBack() {
    // Prefer browser history when available (e.g. arriving from the
    // account menu); fall back to the home page when the user landed
    // here directly (deep link, new tab, ...).
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      navigate({ to: '/', replace: true })
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

  async function handleImageChange(file: File) {
    setError(null)
    setIsUploadingImage(true)
    try {
      const prepared = await prepareProfileImage(file)
      const { uploadUrl, fileUrl } = await presignProfileImage.mutateAsync({
        fileSize: prepared.size,
      })
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: prepared,
      })
      if (!uploadResponse.ok) throw new Error('Upload failed')
      await setProfileImage.mutateAsync({ fileUrl })
      await refreshAccount()
      toast({ description: t('image.updated') })
    } catch {
      setError(t('errors.imageUpload'))
    } finally {
      setIsUploadingImage(false)
    }
  }

  async function handleRemoveImage() {
    setError(null)
    try {
      await removeProfileImage.mutateAsync()
      toast({ description: t('image.removed') })
    } catch {
      setError(t('errors.imageUpload'))
    }
  }

  const isDirty = name.trim() !== (account.name ?? '')

  return (
    <main className="flex-1 max-w-(--breakpoint-md) w-full mx-auto px-3 py-4 sm:px-4 sm:py-6 flex flex-col gap-6">
      <h1 className="hidden text-2xl font-semibold items-center gap-2 sm:flex">
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
      <Card className="mobile-surface">
        <CardHeader>
          <CardTitle className="text-lg">{t('profile.title')}</CardTitle>
          <CardDescription>{t('profile.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex items-center gap-4 rounded-lg border border-dashed border-primary/20 bg-primary/3 p-3">
              <AccountAvatar account={account} size="xl" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">{t('image.label')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('image.help')}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*,.heic,.heif"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void handleImageChange(file)
                      event.target.value = ''
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isUploadingImage || removeProfileImage.isPending}
                  >
                    {isUploadingImage
                      ? t('image.uploading')
                      : t('image.choose')}
                  </Button>
                  {account.image && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRemoveImage()}
                      disabled={
                        isUploadingImage || removeProfileImage.isPending
                      }
                    >
                      {t('image.remove')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-settings-name">{t('nameLabel')}</Label>
              <Input
                id="account-settings-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setDirtyName(e.target.value)}
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

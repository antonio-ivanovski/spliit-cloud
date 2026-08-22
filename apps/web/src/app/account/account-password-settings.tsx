import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PasswordChecklist } from '@/components/auth/password-checklist'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { hasRealEmail } from '@/lib/account'
import {
  changePassword as apiChangePassword,
  getPasswordStatus,
  PasswordError,
  removePassword,
  setPassword,
} from '@/lib/password'
import { isStrongPassword } from '@spliit/domain/password'

import { SettingsRow } from './settings-ui'

type Mode = 'set' | 'change'

const ERROR_MESSAGE_KEYS = {
  ANONYMOUS_REQUIRES_EMAIL: 'anonymousRequiresEmail',
  PLACEHOLDER_EMAIL: 'placeholderEmail',
  EMAIL_NOT_VERIFIED: 'emailNotVerified',
  ALREADY_HAS_PASSWORD: 'alreadyHasPassword',
  PASSWORD_POLICY_NOT_MET: 'passwordPolicy',
  PASSWORD_ALREADY_SET: 'alreadyHasPassword',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'credentialNotFound',
  INVALID_PASSWORD: 'invalidCurrentPassword',
  PASSWORD_TOO_SHORT: 'passwordPolicy',
  PASSWORD_TOO_LONG: 'passwordPolicy',
  PASSWORD_RATE_LIMITED: 'rateLimited',
  NO_ALTERNATIVE_SIGN_IN: 'noAlternativeSignIn',
  NOT_FOUND: 'notFound',
} as const

export function AccountPasswordSettings({
  email,
  emailVerified,
  isAnonymous,
  onUpdated,
}: {
  email?: string | null
  emailVerified?: boolean | null
  isAnonymous?: boolean | null
  onUpdated: () => Promise<void>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'AccountSettings' })
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const realEmail = hasRealEmail(email)
  const verifiedEmail = Boolean(emailVerified) && realEmail
  const isAnon = isAnonymous === true

  const passwordStatusQuery = useQuery({
    queryKey: ['auth', 'password', 'status'],
    queryFn: getPasswordStatus,
  })

  const hasPassword = passwordStatusQuery.data?.hasPassword ?? null
  const statusError = passwordStatusQuery.error
    ? passwordStatusQuery.error instanceof PasswordError
      ? passwordStatusQuery.error.code
      : 'PASSWORD_STATUS_FAILED'
    : null

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('set')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)

  const [removeOpen, setRemoveOpen] = useState(false)
  const [removeCurrentPassword, setRemoveCurrentPassword] = useState('')
  const [removeErrorCode, setRemoveErrorCode] = useState<string | null>(null)
  const [removeClientError, setRemoveClientError] = useState<string | null>(
    null,
  )

  const canSet = !isAnon && verifiedEmail
  const actionDisabledReason = (() => {
    if (isAnon) return t('password.anonymousRequiresEmailHelp')
    if (!realEmail) return t('password.addEmailFirst')
    if (!emailVerified) return t('password.verifyEmailFirst')
    return null
  })()

  function openDialog(nextMode: Mode) {
    setMode(nextMode)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setErrorCode(null)
    setClientError(null)
    setOpen(true)
  }

  function openRemoveDialog() {
    setRemoveCurrentPassword('')
    setRemoveErrorCode(null)
    setRemoveClientError(null)
    setRemoveOpen(true)
  }

  function errorMessage(code: string) {
    const key =
      ERROR_MESSAGE_KEYS[code as keyof typeof ERROR_MESSAGE_KEYS] ?? 'generic'
    return t(`password.errors.${key}`)
  }

  async function afterPasswordUpdate() {
    await queryClient.invalidateQueries({
      queryKey: ['auth', 'password', 'status'],
    })
    await onUpdated()
  }

  const setMutation = useMutation({
    mutationFn: (vars: { newPassword: string }) =>
      setPassword(vars.newPassword),
    onSuccess: async () => {
      await afterPasswordUpdate()
      toast({ description: t('password.setSuccess') })
      setOpen(false)
    },
    onError: (err: unknown) => {
      const code =
        err instanceof PasswordError ? err.code : 'PASSWORD_SET_FAILED'
      setErrorCode(code)
    },
  })

  const changeMutation = useMutation({
    mutationFn: (vars: { currentPassword: string; newPassword: string }) =>
      apiChangePassword({
        currentPassword: vars.currentPassword,
        newPassword: vars.newPassword,
        revokeOtherSessions: true,
      }),
    onSuccess: async () => {
      await afterPasswordUpdate()
      toast({ description: t('password.changeSuccess') })
      setOpen(false)
    },
    onError: (err: unknown) => {
      const code =
        err instanceof PasswordError ? err.code : 'PASSWORD_CHANGE_FAILED'
      setErrorCode(code)
    },
  })

  const removeMutation = useMutation({
    mutationFn: (vars: { currentPassword: string }) =>
      removePassword({ currentPassword: vars.currentPassword }),
    onSuccess: async () => {
      await afterPasswordUpdate()
      toast({ description: t('password.removeSuccess') })
      setRemoveOpen(false)
      setOpen(false)
    },
    onError: (err: unknown) => {
      const code =
        err instanceof PasswordError ? err.code : 'PASSWORD_REMOVE_FAILED'
      setRemoveErrorCode(code)
    },
  })

  const pending = setMutation.isPending || changeMutation.isPending

  function handleSetSubmit(event: React.FormEvent) {
    event.preventDefault()
    setClientError(null)
    setErrorCode(null)
    if (!isStrongPassword(newPassword)) {
      setClientError(t('password.errors.passwordPolicy'))
      return
    }
    if (newPassword !== confirmPassword) {
      setClientError(t('password.mismatch'))
      return
    }
    setMutation.mutate({ newPassword })
  }

  function handleChangeSubmit(event: React.FormEvent) {
    event.preventDefault()
    setClientError(null)
    setErrorCode(null)
    if (!currentPassword) {
      setClientError(t('password.errors.currentRequired'))
      return
    }
    if (!isStrongPassword(newPassword)) {
      setClientError(t('password.errors.passwordPolicy'))
      return
    }
    if (newPassword !== confirmPassword) {
      setClientError(t('password.mismatch'))
      return
    }
    changeMutation.mutate({ currentPassword, newPassword })
  }

  function handleRemoveSubmit(event: React.FormEvent) {
    event.preventDefault()
    setRemoveClientError(null)
    setRemoveErrorCode(null)
    if (!removeCurrentPassword) {
      setRemoveClientError(t('password.errors.currentRequired'))
      return
    }
    removeMutation.mutate({ currentPassword: removeCurrentPassword })
  }

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword

  const errorText = clientError ?? (errorCode ? errorMessage(errorCode) : null)
  const removeErrorText =
    removeClientError ??
    (removeErrorCode ? errorMessage(removeErrorCode) : null)

  const description = (() => {
    if (hasPassword === null && statusError) return t('password.loadError')
    if (isAnon) return t('password.anonymousHelp')
    if (!realEmail) return t('password.addEmailHelp')
    if (!emailVerified) return t('password.verifyEmailHelp')
    if (hasPassword) return t('password.hasPasswordHelp')
    return t('password.noPasswordHelp')
  })()

  const setDisabled = passwordStatusQuery.isPending || !canSet

  return (
    <>
      <SettingsRow
        id="account-settings-password"
        label={t('password.label')}
        description={description}
        control={
          <div className="flex shrink-0 items-center gap-1">
            {hasPassword === true ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  disabled={passwordStatusQuery.isPending}
                  onClick={() => openDialog('change')}
                >
                  <Pencil className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('password.change')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={passwordStatusQuery.isPending}
                  onClick={openRemoveDialog}
                >
                  <Trash2 className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('password.remove')}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={setDisabled}
                title={actionDisabledReason ?? undefined}
                onClick={() => openDialog('set')}
              >
                <Pencil className="me-2 h-4 w-4" aria-hidden="true" />
                {t('password.set')}
              </Button>
            )}
          </div>
        }
      />

      <ResponsiveDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !pending && !removeMutation.isPending) setOpen(false)
        }}
      >
        <ResponsiveDialogContent className="max-w-lg">
          {mode === 'set' ? (
            <form className="contents" onSubmit={handleSetSubmit}>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>
                  {t('password.setTitle')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {t('password.setDescription')}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody className="flex flex-col gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="account-password-new">
                    {t('password.newLabel')}
                  </Label>
                  <Input
                    id="account-password-new"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value)
                      if (clientError) setClientError(null)
                      if (errorCode) setErrorCode(null)
                    }}
                    required
                    disabled={pending}
                  />
                </div>
                <PasswordChecklist password={newPassword} />
                <div className="grid gap-1.5">
                  <Label htmlFor="account-password-confirm">
                    {t('password.confirmLabel')}
                  </Label>
                  <Input
                    id="account-password-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value)
                      if (clientError) setClientError(null)
                      if (errorCode) setErrorCode(null)
                    }}
                    required
                    disabled={pending}
                    aria-invalid={mismatch}
                  />
                  {mismatch ? (
                    <p className="text-sm text-destructive" role="alert">
                      {t('password.mismatch')}
                    </p>
                  ) : null}
                </div>
                {errorText ? (
                  <p className="text-sm text-destructive" role="alert">
                    {errorText}
                  </p>
                ) : null}
                {canSet ? null : (
                  <p className="text-sm text-muted-foreground">
                    {actionDisabledReason}
                  </p>
                )}
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  {t('password.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    pending ||
                    !canSet ||
                    !newPassword ||
                    !confirmPassword ||
                    mismatch
                  }
                >
                  {pending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {pending ? t('password.setting') : t('password.setSubmit')}
                </Button>
              </ResponsiveDialogFooter>
            </form>
          ) : (
            <form className="contents" onSubmit={handleChangeSubmit}>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>
                  {t('password.changeTitle')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {t('password.changeDescription')}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody className="flex flex-col gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="account-password-current">
                    {t('password.currentLabel')}
                  </Label>
                  <Input
                    id="account-password-current"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value)
                      if (clientError) setClientError(null)
                      if (errorCode) setErrorCode(null)
                    }}
                    required
                    disabled={pending}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="account-password-new-change">
                    {t('password.newLabel')}
                  </Label>
                  <Input
                    id="account-password-new-change"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value)
                      if (clientError) setClientError(null)
                      if (errorCode) setErrorCode(null)
                    }}
                    required
                    disabled={pending}
                  />
                </div>
                <PasswordChecklist password={newPassword} />
                <div className="grid gap-1.5">
                  <Label htmlFor="account-password-confirm-change">
                    {t('password.confirmLabel')}
                  </Label>
                  <Input
                    id="account-password-confirm-change"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value)
                      if (clientError) setClientError(null)
                      if (errorCode) setErrorCode(null)
                    }}
                    required
                    disabled={pending}
                    aria-invalid={mismatch}
                  />
                  {mismatch ? (
                    <p className="text-sm text-destructive" role="alert">
                      {t('password.mismatch')}
                    </p>
                  ) : null}
                </div>
                {errorText ? (
                  <p className="text-sm text-destructive" role="alert">
                    {errorText}
                  </p>
                ) : null}
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  {t('password.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    pending ||
                    !currentPassword ||
                    !newPassword ||
                    !confirmPassword ||
                    mismatch
                  }
                >
                  {pending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {pending
                    ? t('password.changing')
                    : t('password.changeSubmit')}
                </Button>
              </ResponsiveDialogFooter>
            </form>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={removeOpen}
        onOpenChange={(next) => {
          if (!next && !removeMutation.isPending) setRemoveOpen(false)
        }}
      >
        <ResponsiveDialogContent className="max-w-lg">
          <form className="contents" onSubmit={handleRemoveSubmit}>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                {t('password.removeTitle')}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {t(
                  verifiedEmail
                    ? 'password.removeDescription'
                    : 'password.removeDescriptionNoAlternative',
                )}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="account-password-remove-current">
                  {t('password.currentLabel')}
                </Label>
                <Input
                  id="account-password-remove-current"
                  type="password"
                  autoComplete="current-password"
                  value={removeCurrentPassword}
                  onChange={(e) => {
                    setRemoveCurrentPassword(e.target.value)
                    if (removeClientError) setRemoveClientError(null)
                    if (removeErrorCode) setRemoveErrorCode(null)
                  }}
                  required
                  disabled={removeMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  {t('password.removeForgotHint')}{' '}
                  <Link
                    to="/auth/forgot-password"
                    className="font-medium underline underline-offset-4 hover:text-foreground"
                    onClick={() => setRemoveOpen(false)}
                  >
                    {t('password.removeForgotLink')}
                  </Link>
                </p>
              </div>
              {removeErrorText ? (
                <p className="text-sm text-destructive" role="alert">
                  {removeErrorText}
                </p>
              ) : null}
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRemoveOpen(false)}
                disabled={removeMutation.isPending}
              >
                {t('password.cancel')}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={removeMutation.isPending || !removeCurrentPassword}
              >
                {removeMutation.isPending ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : null}
                {removeMutation.isPending
                  ? t('password.removing')
                  : t('password.removeConfirm')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

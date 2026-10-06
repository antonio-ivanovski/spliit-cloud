import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fingerprint, Loader2, Plus, Trash, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { getAnonymousRecoveryStatus } from '@/lib/anonymous-recovery'
import { useDeploymentConfig } from '@/lib/deployment-config'
import {
  addPasskey,
  getPasskeySessionFreshness,
  isPasskeySupported,
  listPasskeys,
  notifyPasskeyChanged,
  PasskeyError,
  removePasskey,
  renamePasskey,
  signOutAndReturnToSignIn,
  type PasskeyInfo,
} from '@/lib/passkey'

import { SettingsBadge, SettingsRow } from './settings-ui'

const ERROR_MESSAGE_KEYS = {
  PASSKEY_LIST_FAILED: 'loadFailed',
  PASSKEY_ADD_FAILED: 'addFailed',
  PASSKEY_REMOVE_FAILED: 'removeFailed',
  PASSKEY_LAST_METHOD: 'lastMethod',
} as const

export function AccountPasskeySettings({
  displayName,
  isAnonymous,
  onUpdated,
}: {
  // The account display name: always the ceremony identity for a new
  // passkey, so the authenticator entry shows it. The dialog field only
  // renames the Spliit-side nickname afterwards.
  displayName: string
  isAnonymous?: boolean | null
  onUpdated: () => Promise<void>
}) {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings',
  })
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const deploymentConfig = useDeploymentConfig()

  const supported = isPasskeySupported()
  const passkeysQuery = useQuery({
    queryKey: ['auth', 'passkey', 'list'],
    queryFn: listPasskeys,
    enabled: supported,
  })
  // Same status query as the sign in link row below (shared cache): the
  // backup guidance differs when no link exists. Anonymous-only — the
  // endpoint rejects signed-in non-anonymous accounts.
  const recoveryStatusQuery = useQuery({
    queryKey: ['auth', 'anonymous-recovery', 'status'],
    queryFn: getAnonymousRecoveryStatus,
    enabled: supported && isAnonymous === true,
  })

  const passkeys = passkeysQuery.data ?? []
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<PasskeyInfo | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [checkingFreshness, setCheckingFreshness] = useState(false)
  const [reauthOpen, setReauthOpen] = useState(false)
  const [reauthPending, setReauthPending] = useState(false)

  function errorMessage(code: string) {
    const key =
      ERROR_MESSAGE_KEYS[code as keyof typeof ERROR_MESSAGE_KEYS] ?? 'generic'
    return t(`passkey.errors.${key}`)
  }

  function formatCreatedAt(createdAt: string | Date) {
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
    }).format(new Date(createdAt))
  }

  function openAddDialog() {
    setName('')
    setDialogError(null)
    setAddOpen(true)
  }

  /**
   * Proactive freshness gate: sessions older than the server's freshness window
   * fail passkey enrollment with SESSION_NOT_FRESH, so offer the re-auth
   * roundtrip before the WebAuthn ceremony instead of failing it midway. The
   * probe never throws — on any failure the attempt proceeds and the server
   * verdict (mapped in `saveMutation`) decides.
   */
  async function handleAddClick() {
    if (checkingFreshness) return
    setCheckingFreshness(true)
    try {
      const fresh = await getPasskeySessionFreshness(
        deploymentConfig.passkeyFreshAgeSeconds,
      )
      if (fresh) {
        openAddDialog()
      } else {
        setReauthOpen(true)
      }
    } finally {
      setCheckingFreshness(false)
    }
  }

  async function handleReauthConfirm() {
    if (reauthPending) return
    setReauthPending(true)
    try {
      await signOutAndReturnToSignIn()
    } catch (err) {
      setReauthPending(false)
      if (
        err instanceof PasskeyError &&
        err.code === 'PASSKEY_REAUTH_NAVIGATE_FAILED'
      ) {
        // The session is already dead at this point: retrying sign-out is
        // meaningless, so close and let the next account refetch bounce
        // through RequireAuth to sign-in.
        setReauthOpen(false)
      }
      toast({
        description: t('passkey.errors.generic'),
        variant: 'destructive',
      })
    }
  }

  // Signing out an anonymous account with no other way back in (no sign-in
  // link, no passkey yet) would lock it out for good — those guests must
  // save a sign-in link first instead of re-authenticating. Unknown recovery
  // status fails safe toward the warning.
  const reauthUnsafe =
    isAnonymous === true &&
    passkeys.length === 0 &&
    recoveryStatusQuery.data?.hasRecoveryKey !== true

  async function afterChange() {
    await queryClient.invalidateQueries({
      queryKey: ['auth', 'passkey', 'list'],
    })
    // Best-effort server ping so the anonymous onboarding gate flips
    // immediately (the plugin writes bypass database hooks). Never throws.
    await notifyPasskeyChanged()
    await onUpdated()
  }

  const saveMutation = useMutation({
    mutationFn: async (vars: { name: string }) => {
      // Ceremony identity is always the display name; the typed label only
      // renames our own row afterwards — best-effort, and skipped when it
      // matches the ceremony name (no-op write). A failed rename still
      // resolves: the credential is registered with the display-name
      // nickname, which is a sensible fallback.
      const created = await addPasskey(displayName)
      const nickname = vars.name
      if (nickname && nickname !== displayName.trim()) {
        await renamePasskey(created.id, nickname).catch(() => {})
      }
      return created
    },
    onSuccess: async () => {
      await afterChange()
      toast({ description: t('passkey.added') })
      setAddOpen(false)
    },
    onError: (err: unknown) => {
      const code = err instanceof PasskeyError ? err.code : 'PASSKEY_ADD_FAILED'
      // Backstop for the proactive check (clock skew, or the session aging
      // past the window mid-ceremony): route to the same re-auth modal.
      if (code === 'PASSKEY_SESSION_STALE') {
        setAddOpen(false)
        setReauthOpen(true)
        return
      }
      setDialogError(code)
    },
  })

  const removeMutation = useMutation({
    mutationFn: (vars: { id: string }) => removePasskey(vars.id),
    onSuccess: async () => {
      await afterChange()
      toast({ description: t('passkey.removed') })
      setRemoveTarget(null)
    },
    onError: (err: unknown) => {
      const code =
        err instanceof PasskeyError ? err.code : 'PASSKEY_REMOVE_FAILED'
      setRemoveError(code)
    },
  })

  function handleSave(event: React.FormEvent) {
    event.preventDefault()
    if (!addOpen || saveMutation.isPending) return
    setDialogError(null)
    saveMutation.mutate({ name: name.trim() })
  }

  const description = (() => {
    if (!supported) return t('passkey.unsupported')
    if (passkeysQuery.isError) return t('passkey.errors.loadFailed')
    if (isAnonymous === true) {
      if (recoveryStatusQuery.data && !recoveryStatusQuery.data.hasRecoveryKey)
        return t('passkey.anonymousHelpNoLink')
      return t('passkey.anonymousHelp')
    }
    return t('passkey.help')
  })()

  const dialogPending = saveMutation.isPending
  const removingLast = passkeys.length <= 1

  return (
    <>
      {/* Single divide-y child: no separator between the header row and the
          item rows below it. Outer separators to neighboring rows stay. */}
      <div>
        <SettingsRow
          id="account-settings-passkey"
          label={t('passkey.label')}
          description={description}
          control={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={
                !supported || passkeysQuery.isPending || checkingFreshness
              }
              onClick={() => void handleAddClick()}
            >
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              {t('passkey.add')}
            </Button>
          }
        />
        {supported && passkeys.length > 0 ? (
          <div className="px-4 pt-0 pb-3 sm:px-6">
            <ul className="flex flex-col gap-2" aria-label={t('passkey.label')}>
              {passkeys.map((passkey) => (
                <li
                  key={passkey.id}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5"
                >
                  <Fingerprint
                    className="h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {passkey.name?.trim() || t('passkey.unnamed')}
                    </p>
                    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="shrink-0 tabular-nums">
                        {formatCreatedAt(passkey.createdAt)}
                      </span>
                      <SettingsBadge>
                        {passkey.deviceType === 'multiDevice'
                          ? t('passkey.synced')
                          : t('passkey.deviceBound')}
                      </SettingsBadge>
                      {passkey.backedUp ? (
                        <SettingsBadge>{t('passkey.backedUp')}</SettingsBadge>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setRemoveTarget(passkey)
                      setRemoveError(null)
                    }}
                    aria-label={t('passkey.remove')}
                  >
                    <Trash className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {supported && passkeys.length === 0 && !passkeysQuery.isPending ? (
          <div className="px-4 pt-0 pb-3 sm:px-6">
            <p className="text-sm text-muted-foreground">
              {t('passkey.empty')}
            </p>
          </div>
        ) : null}
      </div>

      <ResponsiveDialog
        open={addOpen}
        onOpenChange={(next) => {
          if (!next && !dialogPending) setAddOpen(false)
        }}
      >
        <ResponsiveDialogContent className="max-w-lg">
          <form className="contents" onSubmit={handleSave}>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                {t('passkey.addTitle')}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {t('passkey.addDescription')}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="account-passkey-name">
                  {t('passkey.nameLabel')}
                </Label>
                <Input
                  id="account-passkey-name"
                  type="text"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (dialogError) setDialogError(null)
                  }}
                  placeholder={t('passkey.namePlaceholder')}
                  disabled={dialogPending}
                  maxLength={100}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {t('passkey.waitHint')}
              </p>
              {dialogError ? (
                <p className="text-sm text-destructive" role="alert">
                  {errorMessage(dialogError)}
                </p>
              ) : null}
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
                disabled={dialogPending}
              >
                {t('passkey.cancel')}
              </Button>
              <Button type="submit" disabled={dialogPending}>
                {dialogPending ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : null}
                {dialogPending ? t('passkey.saving') : t('passkey.addSubmit')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={reauthOpen}
        onOpenChange={(next) => {
          if (!next && !reauthPending) setReauthOpen(false)
        }}
      >
        <ResponsiveDialogContent className="max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {reauthUnsafe
                ? t('passkey.reauthAnonymousTitle')
                : t('passkey.reauthTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {reauthUnsafe
                ? t('passkey.reauthAnonymousDescription')
                : t('passkey.reauthDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReauthOpen(false)}
              disabled={reauthPending}
            >
              {t('passkey.cancel')}
            </Button>
            {reauthUnsafe ? null : (
              <Button
                type="button"
                disabled={reauthPending}
                onClick={() => void handleReauthConfirm()}
              >
                {reauthPending ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : null}
                {t('passkey.reauthConfirm')}
              </Button>
            )}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next && !removeMutation.isPending) setRemoveTarget(null)
        }}
      >
        <ResponsiveDialogContent className="max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('passkey.removeTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('passkey.removeDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="flex flex-col gap-3">
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{t('passkey.removeWarning')}</AlertDescription>
            </Alert>
            {removingLast ? (
              <p className="text-sm text-muted-foreground">
                {t('passkey.removeLastWarning')}
              </p>
            ) : null}
            {removeError ? (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage(removeError)}
              </p>
            ) : null}
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemoveTarget(null)}
              disabled={removeMutation.isPending}
            >
              {t('passkey.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={removeMutation.isPending || !removeTarget}
              onClick={() => {
                if (removeTarget) {
                  setRemoveError(null)
                  removeMutation.mutate({ id: removeTarget.id })
                }
              }}
            >
              {removeMutation.isPending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : null}
              {removeMutation.isPending
                ? t('passkey.removing')
                : t('passkey.removeConfirm')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

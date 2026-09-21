import {
  Fingerprint,
  HatGlasses,
  KeyRound,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnonymousSafeguardChoice } from '@/components/auth/anonymous-safeguard-choice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogBody as DialogBody,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from '@/components/ui/responsive-dialog'
import { needsDisplayName } from '@/lib/account'
import {
  parseAnonymousRecoveryLink,
  recoverAnonymousAccount,
} from '@/lib/anonymous-recovery'
import { authClient } from '@/lib/auth'
import { replaceBrowserLocation } from '@/lib/browser-navigation'
import { isPasskeySupported } from '@/lib/passkey'
import { signupInviteFetchOptions } from '@/lib/signup-invite'
import { useOnlineStatus } from '@/lib/use-online-status'

export function AnonymousSignupDialog({
  open,
  onOpenChange,
  creationEnabled,
  passkeyEnabled,
  linkInviteToken,
  redirectTo,
  completeProfilePath,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  creationEnabled: boolean
  passkeyEnabled: boolean
  linkInviteToken?: string
  redirectTo: string
  completeProfilePath: string
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AnonymousAccount.signup',
  })
  const isOnline = useOnlineStatus()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<'create' | 'recover' | null>(null)
  const [recoveryLink, setRecoveryLink] = useState('')
  const [passkeySignInPending, setPasskeySignInPending] = useState(false)
  const [passkeySignInError, setPasskeySignInError] = useState(false)
  // Fresh anonymous session established: offer an explicit choice between
  // the recovery link (primary) and a passkey (secondary) before leaving
  // the dialog. The choice UI lives in AnonymousSafeguardChoice so the
  // complete-profile gate offers the same options. Afterwards both
  // credentials coexist and are managed in Account settings, and neither
  // one ever removes the other implicitly.
  const [created, setCreated] = useState(false)

  const showChoice = created && passkeyEnabled && isPasskeySupported()

  function setOpen(nextOpen: boolean) {
    if (!nextOpen && (pending || passkeySignInPending)) return
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setRecoveryLink('')
      setError(null)
      setCreated(false)
      setPasskeySignInError(false)
    }
  }

  async function createAccount() {
    if (!isOnline) return
    setPending(true)
    setError(null)
    try {
      const result = await authClient.signIn.anonymous({
        fetchOptions: signupInviteFetchOptions(linkInviteToken),
      })
      if (result.error) throw new Error(result.error.message)
      if (passkeyEnabled && isPasskeySupported()) {
        setCreated(true)
        setPending(false)
        return
      }
      replaceBrowserLocation(completeProfilePath)
    } catch {
      setError('create')
      // react-doctor-disable-next-line react-doctor/no-unowned-async-error-clear -- Pending disables every dialog action, so a newer request cannot exist.
      setPending(false)
    }
  }

  async function recoverAccount() {
    if (!isOnline) return
    const code = parseAnonymousRecoveryLink(recoveryLink)
    if (!code) {
      setError('recover')
      return
    }
    setPending(true)
    setError(null)
    try {
      await recoverAnonymousAccount({ code })
      replaceBrowserLocation(redirectTo)
    } catch {
      setError('recover')
      // react-doctor-disable-next-line react-doctor/no-unowned-async-error-clear -- Pending disables every dialog action, so a newer request cannot exist.
      setPending(false)
    }
  }

  async function signInWithPasskey() {
    if (!isOnline) return
    setPasskeySignInPending(true)
    setPasskeySignInError(false)
    try {
      const result = await authClient.signIn.passkey()
      if (result.error) {
        // Closing the browser prompt surfaces as an error too; stay silent
        // instead of alarming, like the main passkey sign-in button.
        const code: unknown =
          result.error != null && typeof result.error === 'object'
            ? (result.error as { code?: unknown }).code
            : undefined
        if (typeof code === 'string' && /cancel/i.test(code)) {
          setPasskeySignInPending(false)
          return
        }
        throw new Error('passkey sign-in failed')
      }
      const session = await authClient.getSession({
        query: { disableCookieCache: true },
      })
      const account = session.data?.user
      replaceBrowserLocation(
        account && needsDisplayName(account) ? completeProfilePath : redirectTo,
      )
    } catch {
      setPasskeySignInError(true)
      setPasskeySignInPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {showChoice ? (
              <ShieldCheck className="h-5 w-5 text-primary" />
            ) : (
              <HatGlasses className="h-5 w-5 text-primary" />
            )}
            {showChoice ? t('choiceTitle') : t('title')}
          </DialogTitle>
          <DialogDescription>
            {showChoice
              ? t('choiceDescription')
              : creationEnabled
                ? t('description')
                : t('recoverDescription')}
          </DialogDescription>
        </DialogHeader>
        {showChoice ? (
          <>
            <DialogBody className="grid gap-3 py-2">
              <AnonymousSafeguardChoice
                onComplete={() => replaceBrowserLocation(completeProfilePath)}
              />
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {t('cancel')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody className="grid gap-5 py-2">
              {creationEnabled ? (
                <div className="grid gap-3 rounded-xl border bg-muted/20 p-4">
                  <div className="grid gap-1">
                    <p className="font-medium">{t('createTitle')}</p>
                    <p className="text-sm leading-5 text-muted-foreground">
                      {t('warning')}
                    </p>
                    {passkeyEnabled && isPasskeySupported() ? (
                      <p className="text-sm leading-5 text-muted-foreground">
                        {t('passkeyHint')}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void createAccount()}
                    disabled={pending || !isOnline}
                  >
                    {pending ? (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {t('create')}
                  </Button>
                  {error === 'create' ? (
                    <p className="text-sm text-destructive" role="alert">
                      {t('createError')}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-3">
                <p className="text-sm font-medium">{t('recoverTitle')}</p>
                <div className="grid gap-3 rounded-xl border bg-muted/20 p-4">
                  <p className="text-sm leading-5 text-muted-foreground">
                    {creationEnabled
                      ? t('recoverDescription')
                      : t('recoveryOnlyHelp')}
                  </p>
                  <div className="grid gap-2">
                    <Label
                      htmlFor="anonymous-access-recovery-link"
                      className="flex items-center gap-2"
                    >
                      <KeyRound className="h-4 w-4 text-muted-foreground" />
                      {t('recoveryLinkRequiredLabel')}
                    </Label>
                    <Input
                      id="anonymous-access-recovery-link"
                      value={recoveryLink}
                      onChange={(event) => {
                        setRecoveryLink(event.target.value)
                        setError(null)
                      }}
                      className="font-mono text-xs"
                      autoComplete="off"
                      autoCapitalize="none"
                      inputMode="url"
                      spellCheck={false}
                      placeholder="https://…/auth/recover#code=…"
                      disabled={pending || !isOnline}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => void recoverAccount()}
                    disabled={pending || !isOnline || !recoveryLink.trim()}
                  >
                    {pending ? (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {t('recover')}
                  </Button>
                  {error === 'recover' ? (
                    <p className="text-sm text-destructive" role="alert">
                      {t('recoverError')}
                    </p>
                  ) : null}
                </div>
                {passkeyEnabled && isPasskeySupported() ? (
                  <div className="grid gap-3 rounded-xl border bg-muted/20 p-4">
                    <div className="grid gap-1">
                      <p className="font-medium">{t('existingPasskeyTitle')}</p>
                      <p className="text-sm leading-5 text-muted-foreground">
                        {t('existingPasskeyDescription')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => void signInWithPasskey()}
                      disabled={pending || passkeySignInPending || !isOnline}
                    >
                      {passkeySignInPending ? (
                        <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Fingerprint
                          className="me-2 h-4 w-4"
                          aria-hidden="true"
                        />
                      )}
                      {t('passkeySignIn')}
                    </Button>
                    {passkeySignInError ? (
                      <p className="text-sm text-destructive" role="alert">
                        {t('passkeySignInError')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {t('cancel')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

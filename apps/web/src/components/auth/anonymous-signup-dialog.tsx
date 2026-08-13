import { HatGlasses, KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import {
  parseAnonymousRecoveryLink,
  recoverAnonymousAccount,
} from '@/lib/anonymous-recovery'
import { authClient } from '@/lib/auth'
import { replaceBrowserLocation } from '@/lib/browser-navigation'

import { ANONYMOUS_REDIRECT_STORAGE_KEY } from './anonymous-onboarding-gate'

export function AnonymousSignupDialog({
  open,
  onOpenChange,
  redirectTo,
  creationEnabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  redirectTo: string
  creationEnabled: boolean
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AnonymousAccount.signup',
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<'create' | 'recover' | null>(null)
  const [recoveryLink, setRecoveryLink] = useState('')

  function setOpen(nextOpen: boolean) {
    if (!nextOpen && pending) return
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setRecoveryLink('')
      setError(null)
    }
  }

  async function createAccount() {
    setPending(true)
    setError(null)
    try {
      sessionStorage.setItem(ANONYMOUS_REDIRECT_STORAGE_KEY, redirectTo)
      const result = await authClient.signIn.anonymous()
      if (result.error) throw new Error(result.error.message)
      onOpenChange(false)
      setRecoveryLink('')
    } catch {
      sessionStorage.removeItem(ANONYMOUS_REDIRECT_STORAGE_KEY)
      setError('create')
    } finally {
      setPending(false)
    }
  }

  async function recoverAccount() {
    const code = parseAnonymousRecoveryLink(recoveryLink)
    if (!code) {
      setError('recover')
      return
    }
    setPending(true)
    setError(null)
    try {
      await recoverAnonymousAccount({ code })
      replaceBrowserLocation('/')
    } catch {
      setError('recover')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HatGlasses className="h-5 w-5 text-primary" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>
            {creationEnabled ? t('description') : t('recoverDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-5 py-2">
          {creationEnabled ? (
            <div className="grid gap-3 rounded-xl border bg-muted/20 p-4">
              <div className="grid gap-1">
                <p className="font-medium">{t('createTitle')}</p>
                <p className="text-sm leading-5 text-muted-foreground">
                  {t('warning')}
                </p>
              </div>
              <Button
                type="button"
                className="w-full"
                onClick={() => void createAccount()}
                disabled={pending}
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
          {creationEnabled ? (
            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                {t('or')}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}
          <div className="grid gap-3 rounded-xl border bg-muted/20 p-4">
            <div className="grid gap-1">
              <p className="font-medium">{t('recoverTitle')}</p>
              <p className="text-sm leading-5 text-muted-foreground">
                {creationEnabled
                  ? t('recoverDescription')
                  : t('recoveryOnlyHelp')}
              </p>
            </div>
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
                disabled={pending}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void recoverAccount()}
              disabled={pending || !recoveryLink.trim()}
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
      </DialogContent>
    </Dialog>
  )
}

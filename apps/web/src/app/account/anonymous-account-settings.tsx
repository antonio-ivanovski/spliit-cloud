import { Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnonymousRecoveryKeyPanel } from '@/components/auth/anonymous-recovery-key-panel'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogBody as DialogBody,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import {
  activateAnonymousRecoveryRotation,
  startAnonymousRecoveryRotation,
  type AnonymousRecoveryRotation,
} from '@/lib/anonymous-recovery'

import { SettingsRow } from './settings-ui'

export function AnonymousAccountSettings() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AnonymousAccount.settings',
  })
  const { toast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rotation, setRotation] = useState<AnonymousRecoveryRotation | null>(
    null,
  )
  const [confirmedCopied, setConfirmedCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  function setOpen(open: boolean) {
    if (!open && pending) return
    setConfirmOpen(open)
    if (!open) {
      setRotation(null)
      setConfirmedCopied(false)
      setError(false)
    }
  }

  async function beginRotation() {
    setPending(true)
    setError(false)
    try {
      setRotation(await startAnonymousRecoveryRotation())
      setConfirmedCopied(false)
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

  async function activateRotation() {
    if (!rotation || !confirmedCopied) return
    setPending(true)
    setError(false)
    try {
      await activateAnonymousRecoveryRotation({
        activationTicket: rotation.activationTicket,
        confirmedCopied: true,
      })
      toast({ description: t('replacementActivated') })
      setConfirmOpen(false)
      setRotation(null)
      setConfirmedCopied(false)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <SettingsRow
        id="anonymous-recovery-link"
        label={t('recoveryTitle')}
        description={t('recoveryDescription')}
        control={
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <RefreshCw className="me-2 h-4 w-4" />
            {t('replace')}
          </Button>
        }
      />

      <Dialog open={confirmOpen} onOpenChange={setOpen}>
        <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('replaceTitle')}</DialogTitle>
            <DialogDescription>
              {rotation ? t('activateDescription') : t('replaceDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {rotation ? (
              <div className="grid gap-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground">
                  {t('stagedDescription')}
                </div>
                <AnonymousRecoveryKeyPanel
                  recovery={rotation}
                  confirmed={confirmedCopied}
                  onConfirmedChange={setConfirmedCopied}
                />
              </div>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {t('error')}
              </p>
            ) : null}
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
            <Button
              type="button"
              variant={rotation ? 'default' : 'destructive'}
              onClick={() =>
                void (rotation ? activateRotation() : beginRotation())
              }
              disabled={pending || (rotation !== null && !confirmedCopied)}
            >
              {pending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : null}
              {rotation ? t('activateConfirm') : t('replaceConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

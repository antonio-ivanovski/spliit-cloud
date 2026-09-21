import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, RefreshCw, Trash, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnonymousRecoveryKeyPanel } from '@/components/auth/anonymous-recovery-key-panel'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  acknowledgeAnonymousRecovery,
  activateAnonymousRecoveryRotation,
  AnonymousRecoveryError,
  getAnonymousRecoveryStatus,
  revokeAnonymousRecovery,
  setupAnonymousRecovery,
  startAnonymousRecoveryRotation,
  type AnonymousRecoveryKey,
  type AnonymousRecoveryRotation,
} from '@/lib/anonymous-recovery'

import { SettingsRow } from './settings-ui'

const RECOVERY_STATUS_QUERY_KEY = ['auth', 'anonymous-recovery', 'status']

export function AnonymousAccountSettings() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AnonymousAccount.settings',
  })
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: RECOVERY_STATUS_QUERY_KEY,
    queryFn: getAnonymousRecoveryStatus,
  })
  const status = statusQuery.data
  // Optimistic while loading: this row historically always managed a link.
  const hasLink = status ? status.hasRecoveryKey : true
  // Disabled with reason (never hidden): without a passkey the link is the
  // only way back in. The server re-checks this race-side.
  const removeDisabled = !status?.hasPasskey

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rotation, setRotation] = useState<AnonymousRecoveryRotation | null>(
    null,
  )
  const [confirmedCopied, setConfirmedCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState<AnonymousRecoveryKey | null>(null)
  const [createConfirmed, setCreateConfirmed] = useState(false)
  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState(false)

  const [removeOpen, setRemoveOpen] = useState(false)
  const [removePending, setRemovePending] = useState(false)
  const [removeLastMethod, setRemoveLastMethod] = useState(false)
  const [removeError, setRemoveError] = useState(false)

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

  function setCreate(open: boolean) {
    if (!open && createPending) return
    setCreateOpen(open)
    if (!open) {
      setCreated(null)
      setCreateConfirmed(false)
      setCreateError(false)
    }
  }

  async function beginCreate() {
    setCreatePending(true)
    setCreateError(false)
    try {
      setCreated(await setupAnonymousRecovery())
      setCreateConfirmed(false)
    } catch {
      setCreateError(true)
    } finally {
      setCreatePending(false)
    }
  }

  async function confirmCreate() {
    if (!created || !createConfirmed) return
    setCreatePending(true)
    setCreateError(false)
    try {
      await acknowledgeAnonymousRecovery({
        confirmedCopied: true,
        code: created.code,
      })
      await queryClient.invalidateQueries({
        queryKey: RECOVERY_STATUS_QUERY_KEY,
      })
      toast({ description: t('created') })
      setCreateOpen(false)
      setCreated(null)
      setCreateConfirmed(false)
    } catch {
      setCreateError(true)
    } finally {
      setCreatePending(false)
    }
  }

  function setRemove(open: boolean) {
    if (!open && removePending) return
    setRemoveOpen(open)
    if (!open) {
      setRemoveLastMethod(false)
      setRemoveError(false)
    }
  }

  async function confirmRemove() {
    setRemovePending(true)
    setRemoveLastMethod(false)
    setRemoveError(false)
    try {
      await revokeAnonymousRecovery()
      await queryClient.invalidateQueries({
        queryKey: RECOVERY_STATUS_QUERY_KEY,
      })
      toast({ description: t('removed') })
      setRemoveOpen(false)
    } catch (cause) {
      // Backstop for the disabled-with-reason guard above: the passkey
      // could have been removed in another tab after this page loaded.
      if (
        cause instanceof AnonymousRecoveryError &&
        cause.code === 'RECOVERY_KEY_REQUIRED'
      ) {
        setRemoveLastMethod(true)
      } else {
        setRemoveError(true)
      }
    } finally {
      setRemovePending(false)
    }
  }

  return (
    <>
      <SettingsRow
        id="anonymous-recovery-link"
        label={t('recoveryTitle')}
        description={t('recoveryDescription')}
        control={
          hasLink ? (
            <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
              {/* Two-up on mobile so Remove/Replace share one row instead of
              stacking; long locale labels wrap inside their half. Desktop
              keeps natural-width buttons. */}
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  className="min-w-0 whitespace-normal"
                  onClick={() => setRemove(true)}
                  disabled={removeDisabled || statusQuery.isPending}
                >
                  <Trash className="me-2 h-4 w-4 shrink-0" />
                  {t('remove')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-w-0 whitespace-normal"
                  onClick={() => setOpen(true)}
                  disabled={statusQuery.isPending}
                >
                  <RefreshCw className="me-2 h-4 w-4 shrink-0" />
                  {t('replace')}
                </Button>
              </div>
              {status && !status.hasPasskey ? (
                <p className="text-xs text-muted-foreground">
                  {t('removeRequiresPasskey')}
                </p>
              ) : null}
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreate(true)}
              disabled={statusQuery.isPending}
            >
              <Plus className="me-2 h-4 w-4" />
              {t('create')}
            </Button>
          )
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

      <Dialog open={createOpen} onOpenChange={setCreate}>
        <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription>{t('createDescription')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {created ? (
              <AnonymousRecoveryKeyPanel
                recovery={created}
                confirmed={createConfirmed}
                onConfirmedChange={setCreateConfirmed}
              />
            ) : null}
            {createError ? (
              <p className="text-sm text-destructive" role="alert">
                {t('error')}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreate(false)}
              disabled={createPending}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void (created ? confirmCreate() : beginCreate())}
              disabled={createPending || (created !== null && !createConfirmed)}
            >
              {createPending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : null}
              {created ? t('createConfirm') : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={setRemove}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('removeTitle')}</DialogTitle>
            <DialogDescription>{t('removeDescription')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{t('removeWarning')}</AlertDescription>
            </Alert>
            {removeLastMethod ? (
              <p className="text-sm text-muted-foreground">
                {t('removeRequiresPasskey')}
              </p>
            ) : null}
            {removeError ? (
              <p className="text-sm text-destructive" role="alert">
                {t('error')}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemove(false)}
              disabled={removePending}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmRemove()}
              disabled={removePending}
            >
              {removePending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('removeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

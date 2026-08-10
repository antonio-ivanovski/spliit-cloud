import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'

import { GeneratedInviteLinkPanel } from './generated-invite-link-panel'
import type { PendingInvitation } from './members-hooks'

type RegenerateState = {
  mutateAsync: (input: { invitationId: string }) => Promise<{
    invitation: PendingInvitation
    inviteUrl: string
  }>
  isPending: boolean
}

type RegenerateView = 'confirm' | 'generating' | 'linkReady'

export function RegenerateLinkDialog({
  invitation,
  groupName,
  regenerateLink,
  finalFocusRef,
  onOpenChange,
}: {
  invitation: PendingInvitation | null
  groupName: string
  regenerateLink: RegenerateState
  finalFocusRef?: React.RefObject<HTMLButtonElement | null>
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const open = invitation !== null

  const [view, setView] = useState<RegenerateView>('confirm')
  const [generated, setGenerated] = useState<{
    url: string
    expiresAt: Date | string | null
  } | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const lastInvitationIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open || !invitation) {
      lastInvitationIdRef.current = null
      return
    }
    if (lastInvitationIdRef.current === invitation.id) return
    lastInvitationIdRef.current = invitation.id
    setView('confirm')
    setGenerated(null)
    setApiError(null)
  }, [open, invitation])

  function handleClose() {
    onOpenChange(false)
  }

  function handleConfirm() {
    if (!invitation) return
    setApiError(null)
    setView('generating')
    regenerateLink
      .mutateAsync({ invitationId: invitation.id })
      .then((result) => {
        setGenerated({
          url: result.inviteUrl,
          expiresAt: result.invitation.expiresAt,
        })
        setView('linkReady')
      })
      .catch((err) => {
        setView('confirm')
        setApiError(err instanceof Error ? err.message : String(err))
      })
  }

  const canShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function handleShare() {
    if (!generated || !canShare) return
    try {
      await navigator.share({
        title: t('invite.link.shareTitle', { groupName }),
        text: t('invite.link.shareText', {
          groupName,
          inviteUrl: generated.url,
        }),
      })
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.warn('[regenerate-invitation] share failed:', err)
      }
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      {open && invitation && (
        <ResponsiveDialogContent
          className="max-w-lg"
          finalFocus={finalFocusRef}
        >
          {view === 'linkReady' && generated ? (
            <>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>
                  {t('manage.linkReadyTitle')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {t('manage.linkReadyDescription')}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody className="flex flex-col gap-3">
                <GeneratedInviteLinkPanel
                  inviteUrl={generated.url}
                  expiresAt={generated.expiresAt ?? new Date()}
                  onShare={handleShare}
                  canShare={canShare}
                />
                <p className="border-s-2 border-amber-500/50 ps-3 text-sm text-amber-900 dark:text-amber-200">
                  {t('manage.linkReadyWarning')}
                </p>
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter>
                <Button onClick={handleClose}>{t('manage.done')}</Button>
              </ResponsiveDialogFooter>
            </>
          ) : (
            <>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>
                  {t('regenerate.title')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {t('manage.regenerateDescription')}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody className="flex flex-col gap-3">
                <p
                  className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  role="alert"
                >
                  {t('manage.regenerateWarning')}
                </p>
                {apiError && (
                  <p className="text-sm text-destructive" role="alert">
                    {apiError}
                  </p>
                )}
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter>
                <Button
                  variant="ghost"
                  onClick={handleClose}
                  disabled={regenerateLink.isPending}
                >
                  {t('manage.cancel')}
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={regenerateLink.isPending}
                >
                  {regenerateLink.isPending && (
                    <Loader2
                      className="me-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {t('invite.link.generateNew')}
                </Button>
              </ResponsiveDialogFooter>
            </>
          )}
        </ResponsiveDialogContent>
      )}
    </ResponsiveDialog>
  )
}

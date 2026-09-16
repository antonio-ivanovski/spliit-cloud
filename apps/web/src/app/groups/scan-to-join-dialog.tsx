import { useNavigate } from '@tanstack/react-router'
import { CameraOff, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { parseScannedInviteLink } from '@/lib/parse-invite-link'

type ScanStatus = 'starting' | 'scanning' | 'denied' | 'no-camera'

/**
 * Scan-to-join dialog: live camera QR scan. The scanner library is lazily
 * imported so only this dialog pays for it. Scanned text is only ever navigated
 * to when it parses as a Spliit group invite (same-app path with `?invite=`).
 */
export function ScanToJoinDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Homepage' })
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent aria-label={t('scanDialog.title')}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('scanDialog.title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('scanDialog.description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {open && <ScanContent onDone={() => onOpenChange(false)} />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

/**
 * Mounted only while the dialog is open, so state initializers replace
 * effect-time resets and unmount tears down the camera deterministically.
 */
function ScanContent({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Homepage' })
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const doneRef = useRef(false)
  // While the foreign-origin interstitial is open the decoder keeps firing
  // every frame: pause handling so dismissing it does not instantly reopen
  // it, and no same-origin navigation slips through underneath.
  const pausedRef = useRef(false)
  const [status, setStatus] = useState<ScanStatus>('starting')
  const [notice, setNotice] = useState<string | null>(null)
  // A code pointing at another Spliit instance never navigates blindly: the
  // guest confirms the foreign origin first (QR phishing protection).
  const [foreignInvite, setForeignInvite] = useState<{
    url: string
  } | null>(null)

  const openInvite = useCallback(
    (inviteUrl: string, groupId: string, token: string) => {
      if (doneRef.current || pausedRef.current) return
      if (new URL(inviteUrl).origin === window.location.origin) {
        doneRef.current = true
        onDone()
        void navigate({
          to: '/groups/$groupId',
          params: { groupId },
          search: { invite: token },
        })
      } else {
        pausedRef.current = true
        setForeignInvite({ url: inviteUrl })
      }
    },
    [navigate, onDone],
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    let controls: { stop: () => void } | null = null

    async function start() {
      try {
        const { BrowserQRCodeReader, BrowserCodeReader } =
          await import('@zxing/browser')
        if (cancelled) return
        // Prefer the rear camera on phones; fall back to the default.
        let deviceId: string | undefined
        try {
          const devices = await BrowserCodeReader.listVideoInputDevices()
          deviceId =
            devices.find((device) =>
              /back|rear|environment/i.test(device.label),
            )?.deviceId ?? devices[0]?.deviceId
        } catch {
          deviceId = undefined
        }
        if (cancelled) return
        const reader = new BrowserQRCodeReader()
        const preview = videoRef.current
        if (cancelled || !preview) return
        controls = await reader.decodeFromVideoDevice(
          deviceId,
          preview,
          (result, error) => {
            if (doneRef.current || pausedRef.current) return
            if (result) {
              const parsed = parseScannedInviteLink(result.getText())
              if (parsed) {
                openInvite(parsed.url, parsed.groupId, parsed.token)
              } else {
                setNotice(t('scanDialog.invalidCode'))
              }
              return
            }
            if (error && !(error instanceof Error)) return
            // No QR in frame is the steady state — stay silent.
          },
        )
        if (cancelled) {
          // Unmounted while starting: tear down immediately instead of
          // leaking the camera (cleanup ran while controls was still null).
          controls.stop()
          const stale = videoRef.current?.srcObject
          if (stale instanceof MediaStream) {
            for (const track of stale.getTracks()) track.stop()
          }
          return
        }
        setStatus('scanning')
      } catch (error) {
        if (cancelled) return
        const name = error instanceof Error ? error.name : ''
        if (
          name === 'NotFoundError' ||
          name === 'OverconstrainedError' ||
          name === 'NotReadableError'
        ) {
          setStatus('no-camera')
        } else {
          setStatus('denied')
        }
      }
    }

    void start()
    return () => {
      cancelled = true
      controls?.stop()
      // `stop()` ends the decode loop; also release the hardware tracks.
      const active = video.srcObject
      if (active instanceof MediaStream) {
        for (const track of active.getTracks()) track.stop()
      }
    }
  }, [openInvite, t])

  return (
    <ResponsiveDialogBody className="flex flex-col gap-3">
      {status === 'starting' || status === 'scanning' ? (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="aspect-square w-full object-cover"
          />
          {status === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-sm text-white">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('scanDialog.scanning')}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted/40 px-4 py-6 text-center">
          <CameraOff className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {status === 'no-camera'
              ? t('scanDialog.noCamera')
              : t('scanDialog.permissionDenied')}
          </p>
        </div>
      )}

      {notice && (
        <p role="alert" className="text-sm text-destructive">
          {notice}
        </p>
      )}

      {foreignInvite && (
        <div
          role="alertdialog"
          aria-label={t('scanDialog.foreignTitle')}
          className="flex flex-col gap-3 rounded-lg border border-amber-500/50 px-4 py-4"
        >
          <p className="text-sm font-medium">{t('scanDialog.foreignTitle')}</p>
          <p className="text-sm text-muted-foreground">
            {t('scanDialog.foreignDescription', {
              origin: new URL(foreignInvite.url).origin,
            })}
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                pausedRef.current = false
                setForeignInvite(null)
              }}
            >
              {t('scanDialog.foreignCancel')}
            </Button>
            <Button
              type="button"
              onClick={() => window.location.assign(foreignInvite.url)}
            >
              {t('scanDialog.foreignConfirm')}
            </Button>
          </div>
        </div>
      )}
    </ResponsiveDialogBody>
  )
}

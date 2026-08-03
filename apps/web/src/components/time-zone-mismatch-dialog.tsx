import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import {
  clearKeptTimeZoneMismatch,
  detectDeviceTimeZone,
  hasKeptTimeZoneMismatch,
  keepTimeZoneMismatch,
  timeZoneMismatchDecisionKey,
  timeZonesMatch,
  type AccountPreferences,
} from '@/lib/account-preferences'

type CheckState = { checked: boolean; promptActive: boolean }

export function TimeZoneMismatchDialog({
  accountId,
  accountTimeZone,
  enabled,
  patchPreferences,
  onStatusChange,
}: {
  accountId: string
  accountTimeZone: string | null
  enabled: boolean
  patchPreferences: (
    patch: Partial<AccountPreferences>,
    options?: { optimistic?: boolean },
  ) => Promise<boolean>
  onStatusChange: (state: CheckState) => void
}) {
  const { t } = useTranslation()
  const [browserTimeZone] = useState(detectDeviceTimeZone)
  const [resolvedMismatch, setResolvedMismatch] = useState<string | null>(null)
  const [storageRevision, setStorageRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  const zonesMatch = accountTimeZone
    ? timeZonesMatch(accountTimeZone, browserTimeZone)
    : false
  const mismatchKey = accountTimeZone
    ? `${accountId}:${accountTimeZone}:${browserTimeZone}`
    : null
  void storageRevision
  const suppressed =
    accountTimeZone !== null &&
    hasKeptTimeZoneMismatch(accountId, accountTimeZone, browserTimeZone)
  const open =
    enabled &&
    accountTimeZone !== null &&
    !zonesMatch &&
    !suppressed &&
    resolvedMismatch !== mismatchKey

  useEffect(() => {
    if (enabled && accountTimeZone && zonesMatch) {
      clearKeptTimeZoneMismatch(accountId)
    }
    onStatusChange({
      checked: Boolean(enabled && accountTimeZone),
      promptActive: open,
    })
  }, [accountId, accountTimeZone, enabled, onStatusChange, open, zonesMatch])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === timeZoneMismatchDecisionKey(accountId)) {
        setStorageRevision((revision) => revision + 1)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [accountId])

  const keepCurrent = () => {
    if (!accountTimeZone) return
    keepTimeZoneMismatch(accountId, accountTimeZone, browserTimeZone)
    setResolvedMismatch(mismatchKey)
    onStatusChange({ checked: true, promptActive: false })
  }

  const updateTimeZone = async () => {
    setSaving(true)
    setSaveFailed(false)
    const saved = await patchPreferences(
      { timeZone: browserTimeZone },
      { optimistic: false },
    )
    setSaving(false)
    if (!saved) {
      setSaveFailed(true)
      return
    }
    clearKeptTimeZoneMismatch(accountId)
    setResolvedMismatch(mismatchKey)
    onStatusChange({ checked: true, promptActive: false })
  }

  return (
    <ResponsiveDialog
      open={open}
      disablePointerDismissal
      onOpenChange={(_open, details) => {
        // A timezone choice is required; Esc/backdrop cannot dismiss it.
        details.cancel()
      }}
    >
      <ResponsiveDialogContent
        className="max-w-md"
        showCloseButton={false}
        data-testid="time-zone-mismatch-dialog"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t('TimeZoneMismatch.title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('TimeZoneMismatch.description', {
              accountTimeZone,
              browserTimeZone,
            })}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <p className="text-sm text-muted-foreground">
            {t('TimeZoneMismatch.impact')}
          </p>
          {saveFailed && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {t('TimeZoneMismatch.saveError')}
            </p>
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={keepCurrent}
          >
            {t('TimeZoneMismatch.keep', { timeZone: accountTimeZone })}
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => void updateTimeZone()}
          >
            {saving && <LoaderCircle className="me-2 size-4 animate-spin" />}
            {t('TimeZoneMismatch.update', { timeZone: browserTimeZone })}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

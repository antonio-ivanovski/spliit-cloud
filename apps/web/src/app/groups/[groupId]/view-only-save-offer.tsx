import { Eye, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function ViewOnlyBanner({
  isPublicLink,
  isSaved,
  persistToAccount,
  pending,
  onSave,
}: {
  isPublicLink: boolean
  isSaved: boolean
  persistToAccount: boolean
  pending: boolean
  onSave: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: 'Common' })
  const [dismissed, setDismissed] = useState(false)

  if (!isPublicLink || dismissed || isSaved) return null

  return (
    <Alert className="border-sky-500/30 bg-sky-500/5">
      <Eye className="size-4 text-sky-600" aria-hidden="true" />
      <AlertTitle className="flex items-start justify-between gap-2">
        <span>{t('viewOnlyBannerTitle')}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="z-10 size-7 shrink-0 ps-0 text-sky-800 dark:text-sky-200"
          aria-label={tCommon('close')}
          onClick={() => setDismissed(true)}
        >
          <X className="size-4" />
        </Button>
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{t('viewOnlyBannerDescription')}</span>
        <ViewOnlySaveOffer
          persistToAccount={persistToAccount}
          pending={pending}
          onSave={onSave}
        />
      </AlertDescription>
    </Alert>
  )
}

export function ViewOnlySaveOffer({
  persistToAccount,
  pending,
  onSave,
}: {
  persistToAccount: boolean
  pending: boolean
  onSave: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })

  return (
    <p className="pt-1 text-muted-foreground">
      {persistToAccount
        ? t('viewOnlyBannerSaveNoteAccount')
        : t('viewOnlyBannerSaveNoteDevice')}{' '}
      <Button
        type="button"
        variant="link"
        disabled={pending}
        className="h-auto px-0 text-sm font-medium text-sky-800 dark:text-sky-200"
        onClick={onSave}
      >
        {t('viewOnlyBannerSave')}
      </Button>
    </p>
  )
}

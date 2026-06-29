import { DeletePopup } from '@/components/delete-popup'
import Link from '@/components/link'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function FormActions(props: {
  isCreate: boolean
  readOnly: boolean
  onDelete?: () => Promise<void>
  cancelHref: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  if (!props.readOnly) {
    return (
      <div className="flex mt-4 gap-2">
        <SubmitButton
          loadingContent={t(props.isCreate ? 'creating' : 'saving')}
        >
          <Save className="w-4 h-4 mr-2" />
          {t(props.isCreate ? 'create' : 'save')}
        </SubmitButton>
        {!props.isCreate && props.onDelete && (
          <DeletePopup onDelete={() => props.onDelete!()} />
        )}
        <Button variant="ghost" asChild>
          <Link href={props.cancelHref}>{t('cancel')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex mt-4 gap-2">
      <Button variant="ghost" asChild>
        <Link href={props.cancelHref}>{t('cancel')}</Link>
      </Button>
    </div>
  )
}

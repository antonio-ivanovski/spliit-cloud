import { Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DeletePopup } from '@/components/delete-popup'
import { FixedActionBar } from '@/components/fixed-action-bar'
import Link from '@/components/link'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'

export function FormActions(props: {
  isCreate: boolean
  readOnly: boolean
  onDelete?: () => Promise<void>
  cancelHref: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  if (props.readOnly) {
    return (
      <FixedActionBar>
        <Button variant="ghost" render={<Link href={props.cancelHref} />}>
          {t('cancel')}
        </Button>
      </FixedActionBar>
    )
  }

  return (
    <FixedActionBar>
      {!props.isCreate && props.onDelete && (
        <DeletePopup onDelete={() => props.onDelete!()} className="mr-auto" />
      )}
      <Button variant="ghost" render={<Link href={props.cancelHref} />}>
        {t('cancel')}
      </Button>
      <SubmitButton loadingContent={t(props.isCreate ? 'creating' : 'saving')}>
        <Save className="mr-2 h-4 w-4" />
        {t(props.isCreate ? 'create' : 'save')}
      </SubmitButton>
    </FixedActionBar>
  )
}

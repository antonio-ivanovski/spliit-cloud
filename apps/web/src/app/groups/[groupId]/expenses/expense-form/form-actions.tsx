import { Save } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DeletePopup } from '@/components/delete-popup'
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
      <FixedBar>
        <Button variant="ghost" asChild>
          <Link href={props.cancelHref}>{t('cancel')}</Link>
        </Button>
      </FixedBar>
    )
  }

  return (
    <FixedBar>
      {!props.isCreate && props.onDelete && (
        <DeletePopup onDelete={() => props.onDelete!()} className="mr-auto" />
      )}
      <Button variant="ghost" asChild>
        <Link href={props.cancelHref}>{t('cancel')}</Link>
      </Button>
      <SubmitButton loadingContent={t(props.isCreate ? 'creating' : 'saving')}>
        <Save className="mr-2 h-4 w-4" />
        {t(props.isCreate ? 'create' : 'save')}
      </SubmitButton>
    </FixedBar>
  )
}

// Fixed to the viewport so actions stay visible without scrolling.
// Still inside the form so Enter-to-submit and validation work.
function FixedBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-(--breakpoint-md) flex-row items-center justify-end gap-2 px-4">
        {children}
      </div>
    </div>
  )
}

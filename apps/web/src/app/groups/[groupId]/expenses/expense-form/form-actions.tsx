import { DeletePopup } from '@/components/delete-popup'
import Link from '@/components/link'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Save } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function FormActions(props: {
  isCreate: boolean
  readOnly: boolean
  onDelete?: () => Promise<void>
  cancelHref: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  if (props.readOnly) {
    return (
      <StickyBar>
        <Button variant="ghost" asChild>
          <Link href={props.cancelHref}>{t('cancel')}</Link>
        </Button>
      </StickyBar>
    )
  }

  return (
    <StickyBar>
      {!props.isCreate && props.onDelete && (
        <DeletePopup onDelete={() => props.onDelete!()} className="mr-auto" />
      )}
      <Button variant="ghost" asChild>
        <Link href={props.cancelHref}>{t('cancel')}</Link>
      </Button>
      <SubmitButton loadingContent={t(props.isCreate ? 'creating' : 'saving')}>
        <Save className="w-4 h-4 mr-2" />
        {t(props.isCreate ? 'create' : 'save')}
      </SubmitButton>
    </StickyBar>
  )
}

// Lives inside the form so Enter-to-submit and validation still work;
// `-mx-4` bleeds past the route's px-4 to reach viewport edges on mobile.
function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t bg-background/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-b-md">
      <div className="flex flex-row items-center justify-end gap-2">
        {children}
      </div>
    </div>
  )
}

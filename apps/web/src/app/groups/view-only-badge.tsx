import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export function ViewOnlyBadge({
  compactOnMobile = false,
}: {
  compactOnMobile?: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const label = t('viewOnlyBadge')

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-800 dark:text-sky-200">
      <Eye className="size-3.5" aria-hidden="true" />
      <span className={cn(compactOnMobile && 'hidden sm:inline')}>{label}</span>
      {compactOnMobile ? (
        <span className="sr-only sm:hidden">{label}</span>
      ) : null}
    </span>
  )
}

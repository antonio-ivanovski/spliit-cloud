import { Badge } from '@/components/ui/badge'
import { useTranslation } from 'react-i18next'

/** Subtle status chip for soft-removed participants still shown on balances. */
export function RemovedParticipantBadge({ className }: { className?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  return (
    <Badge
      variant="outline"
      className={`shrink-0 border-amber-500/35 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300 ${className ?? ''}`}
    >
      {t('removedBadge')}
    </Badge>
  )
}

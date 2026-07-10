import { Badge } from '@/components/ui/badge'
import { useTranslation } from 'react-i18next'

export function ConfidenceBadge(props: {
  confidence: 'high' | 'medium' | 'low'
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  return (
    <Badge
      variant="outline"
      className={
        props.confidence === 'high'
          ? 'w-full justify-center gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
          : props.confidence === 'medium'
            ? 'w-full justify-center gap-1.5 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
            : 'w-full justify-center gap-1.5 border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
      }
    >
      <span
        className={
          props.confidence === 'high'
            ? 'size-1.5 rounded-full bg-emerald-500'
            : props.confidence === 'medium'
              ? 'size-1.5 rounded-full bg-amber-500'
              : 'size-1.5 rounded-full bg-rose-500'
        }
      />
      {t(`confidence.${props.confidence}`)}
    </Badge>
  )
}

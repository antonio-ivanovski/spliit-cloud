import { cn } from '@/lib/utils'
import { EyeOff, PackageOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  /** No items at all — shows a "get started" message with optional action */
  variant: 'empty' | 'filtered'
  /** The type of item (e.g., "group", "friend ledger") */
  itemLabel: string
  /** Plural item label for messages */
  itemLabelPlural: string
  /** Action button (e.g., Link to create page) */
  action?: ReactNode
  className?: string
}

export function EmptyState({
  variant,
  itemLabel,
  itemLabelPlural,
  action,
  className,
}: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'EmptyState' })
  const Icon = variant === 'empty' ? PackageOpen : EyeOff
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-10 text-center text-card-foreground shadow-xs',
        className,
      )}
    >
      <div className="rounded-full bg-muted p-3">
        <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-medium">
          {variant === 'empty'
            ? t('title.empty', { itemLabelPlural })
            : t('title.filtered', { itemLabelPlural })}
        </h3>
        {variant === 'empty' && (
          <p className="text-sm text-muted-foreground">
            {t('description.empty', { itemLabel })}
          </p>
        )}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

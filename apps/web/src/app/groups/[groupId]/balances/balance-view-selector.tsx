import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { BarChart3, ListChecks } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type BalanceView = 'simple' | 'visual'

export function BalanceViewSelector({
  value,
  onChange,
  className,
}: {
  value: BalanceView
  onChange: (value: BalanceView) => void
  className?: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })

  return (
    <section
      className={cn('w-full min-w-0', className)}
      aria-label={t('view.label')}
    >
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('view.label')}
      </span>
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          if (next === 'simple' || next === 'visual') onChange(next)
        }}
        aria-label={t('view.title')}
        className="inline-flex w-full min-w-0 gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 sm:gap-0 sm:p-1"
      >
        <ViewOption
          value="simple"
          selected={value === 'simple'}
          icon={ListChecks}
          title={t('view.simple')}
          description={t('view.simpleDescription')}
        />
        <ViewOption
          value="visual"
          selected={value === 'visual'}
          icon={BarChart3}
          title={t('view.visual')}
          description={t('view.visualDescription')}
        />
      </RadioGroup>
    </section>
  )
}

function ViewOption({
  value,
  selected,
  icon: Icon,
  title,
  description,
}: {
  value: BalanceView
  selected: boolean
  icon: typeof ListChecks
  title: string
  description: string
}) {
  return (
    <label
      className={cn(
        'group flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors sm:gap-2 sm:px-3 sm:py-2',
        selected
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-md sm:size-7',
          selected
            ? 'bg-primary/10 text-primary'
            : 'bg-transparent text-muted-foreground group-hover:text-foreground',
        )}
      >
        <Icon size={14} strokeWidth={2} className="sm:size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium leading-tight sm:text-sm">
          {title}
        </span>
        <span className="sr-only">{description}</span>
      </span>
      <RadioGroupItem
        value={value}
        className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4"
      />
    </label>
  )
}

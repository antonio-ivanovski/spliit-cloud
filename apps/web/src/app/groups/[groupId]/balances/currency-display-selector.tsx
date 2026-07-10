import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { ArrowLeftRight, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type CurrencyDisplay = 'group' | 'original'

export function CurrencyDisplaySelector({
  value,
  groupCurrency,
  onChange,
}: {
  value: CurrencyDisplay
  groupCurrency: string | undefined
  onChange: (value: CurrencyDisplay) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })

  return (
    <section className="mb-4 w-full">
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          if (next === 'group' || next === 'original') onChange(next)
        }}
        aria-label={t('currencyDisplay.title')}
        className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <DisplayCurrencyOption
          value="group"
          selected={value === 'group'}
          icon={WalletCards}
          title={t('currencyDisplay.group', { currency: groupCurrency })}
          description={t('currencyDisplay.groupDescription', {
            currency: groupCurrency,
          })}
        />
        <DisplayCurrencyOption
          value="original"
          selected={value === 'original'}
          icon={ArrowLeftRight}
          title={t('currencyDisplay.original')}
          description={t('currencyDisplay.originalDescription')}
        />
      </RadioGroup>
    </section>
  )
}

function DisplayCurrencyOption({
  value,
  selected,
  icon: Icon,
  title,
  description,
}: {
  value: CurrencyDisplay
  selected: boolean
  icon: typeof WalletCards
  title: string
  description: string
}) {
  return (
    <label
      className={cn(
        'group flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 transition-colors',
        selected
          ? 'border-primary bg-primary/4 shadow-[inset_0_0_0_1px_var(--color-primary)]'
          : 'border-border hover:border-foreground/25 hover:bg-muted/40',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md',
          selected
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground group-hover:text-foreground',
        )}
      >
        <Icon size={16} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-tight">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
      <RadioGroupItem value={value} className="mt-0.5 shrink-0" />
    </label>
  )
}

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { Currency } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { ArrowLeftRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type CurrencyDisplay = 'group' | 'original'

export function CurrencyDisplaySelector({
  value,
  groupCurrency,
  onChange,
  className,
}: {
  value: CurrencyDisplay
  groupCurrency: Currency | undefined
  onChange: (value: CurrencyDisplay) => void
  className?: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const groupCurrencyText = groupCurrency
    ? groupCurrency.code || groupCurrency.symbol
    : ''

  return (
    <section
      className={cn('w-full min-w-0', className)}
      aria-label={t('currencyDisplay.label')}
    >
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('currencyDisplay.label')}
      </span>
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          if (next === 'group' || next === 'original') onChange(next)
        }}
        aria-label={t('currencyDisplay.title')}
        className="inline-flex w-full min-w-0 gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 sm:gap-0 sm:p-1"
      >
        <DisplayCurrencyOption
          value="group"
          selected={value === 'group'}
          title={
            <CurrencyOptionLabel
              currency={groupCurrency}
              fallback={
                groupCurrency
                  ? t('currencyDisplay.group', { currency: '' })
                  : '—'
              }
            />
          }
          description={t('currencyDisplay.groupDescription', {
            currency: groupCurrencyText,
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
  icon?: typeof ArrowLeftRight
  title: ReactNode
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
      {Icon && (
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
      )}
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

function CurrencyOptionLabel({
  currency,
  fallback,
}: {
  currency: Currency | undefined
  fallback: string
}) {
  if (!currency) return fallback

  const flagUrl = currency.code
    ? `https://flagcdn.com/h24/${currency.code.slice(0, 2).toLowerCase()}.png`
    : undefined

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {flagUrl ? (
        <img
          src={flagUrl}
          alt=""
          aria-hidden="true"
          className="h-3.5 w-5 shrink-0 rounded-sm object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex h-3.5 w-5 shrink-0 items-center justify-center rounded-sm bg-muted text-[9px] font-medium"
        >
          {currency.symbol || '?'}
        </span>
      )}
      <span className="truncate">{currency.code || currency.symbol}</span>
      {currency.code && currency.symbol && (
        <span className="shrink-0 font-normal text-muted-foreground/70">
          {currency.symbol}
        </span>
      )}
    </span>
  )
}

import { cn } from '@/lib/utils'
import type { SplitMode } from '@spliit/domain'
import { Coins, Hash, Percent, User, Users } from 'lucide-react'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import { useTranslation } from 'react-i18next'

type IconType = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number | string }
>

const PAID_BY_OPTIONS = [
  {
    id: 'single',
    isMultiPayer: false,
    splitMode: 'BY_AMOUNT' as const,
    labelKey: 'paidByOptionSinglePayer',
    helperKey: 'paidByOptionSinglePayerHelper',
    icon: User,
  },
  {
    id: 'multi-evenly',
    isMultiPayer: true,
    splitMode: 'EVENLY' as const,
    labelKey: 'paidByOptionEvenly',
    helperKey: 'paidByOptionEvenlyHelper',
    icon: Users,
  },
  {
    id: 'multi-shares',
    isMultiPayer: true,
    splitMode: 'BY_SHARES' as const,
    labelKey: 'paidByOptionByShares',
    helperKey: 'paidByOptionBySharesHelper',
    icon: Hash,
  },
  {
    id: 'multi-percentage',
    isMultiPayer: true,
    splitMode: 'BY_PERCENTAGE' as const,
    labelKey: 'paidByOptionByPercentage',
    helperKey: 'paidByOptionByPercentageHelper',
    icon: Percent,
  },
  {
    id: 'multi-amount',
    isMultiPayer: true,
    splitMode: 'BY_AMOUNT' as const,
    labelKey: 'paidByOptionByAmount',
    helperKey: 'paidByOptionByAmountHelper',
    icon: Coins,
  },
] as const

const PAID_FOR_OPTIONS = [
  {
    id: 'EVENLY' as const,
    labelKey: 'paidForOptionEvenly',
    helperKey: 'paidForOptionEvenlyHelper',
    icon: Users,
  },
  {
    id: 'BY_SHARES' as const,
    labelKey: 'paidForOptionByShares',
    helperKey: 'paidForOptionBySharesHelper',
    icon: Hash,
  },
  {
    id: 'BY_PERCENTAGE' as const,
    labelKey: 'paidForOptionByPercentage',
    helperKey: 'paidForOptionByPercentageHelper',
    icon: Percent,
  },
  {
    id: 'BY_AMOUNT' as const,
    labelKey: 'paidForOptionByAmount',
    helperKey: 'paidForOptionByAmountHelper',
    icon: Coins,
  },
] as const

function SelectionDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-state={selected ? 'checked' : 'unchecked'}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
        selected
          ? 'border-primary bg-primary'
          : 'border-border bg-background group-hover:border-foreground/30',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-background transition-opacity',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  )
}

function OptionCard({
  icon: Icon,
  title,
  helper,
  selected,
  onClick,
  disabled,
  ariaLabel,
}: {
  icon: IconType
  title: string
  helper: string
  selected: boolean
  onClick: () => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      data-state={selected ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group relative flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        selected
          ? 'border-primary bg-primary/4 shadow-[inset_0_0_0_1px_var(--color-primary)]'
          : 'border-border hover:border-foreground/25 hover:bg-muted/40',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
          selected
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground group-hover:text-foreground',
        )}
      >
        <Icon size={16} strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{title}</p>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
          {helper}
        </p>
      </div>
      <SelectionDot selected={selected} />
    </button>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </p>
  )
}

export function PaidBySplitOptionCards(props: {
  value: { isMultiPayer: boolean; splitMode: SplitMode }
  onChange: (next: { isMultiPayer: boolean; splitMode: SplitMode }) => void
  readOnly?: boolean
}) {
  const { value, onChange, readOnly } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  const isSelected = (opt: (typeof PAID_BY_OPTIONS)[number]) => {
    if (opt.id === 'single') return !value.isMultiPayer
    return value.isMultiPayer && value.splitMode === opt.splitMode
  }

  const single = PAID_BY_OPTIONS.filter((o) => o.id === 'single')
  const multi = PAID_BY_OPTIONS.filter((o) => o.id !== 'single')
  const multiSectionLabel = t('paidBySectionMultiple')

  return (
    <div role="radiogroup" aria-label={multiSectionLabel} className="space-y-3">
      <div className="space-y-1.5">
        <SectionLabel>{t('paidBySectionSingle')}</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {single.map((opt) => {
            const selected = isSelected(opt)
            return (
              <OptionCard
                key={opt.id}
                icon={opt.icon}
                title={t(opt.labelKey)}
                helper={t(opt.helperKey)}
                selected={selected}
                disabled={readOnly}
                onClick={() =>
                  onChange({
                    isMultiPayer: opt.isMultiPayer,
                    splitMode: opt.splitMode,
                  })
                }
              />
            )
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <SectionLabel>{multiSectionLabel}</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {multi.map((opt) => {
            const selected = isSelected(opt)
            const title = t(opt.labelKey)
            return (
              <OptionCard
                key={opt.id}
                icon={opt.icon}
                title={title}
                helper={t(opt.helperKey)}
                selected={selected}
                disabled={readOnly}
                ariaLabel={`${multiSectionLabel} \u2014 ${title}`}
                onClick={() =>
                  onChange({
                    isMultiPayer: opt.isMultiPayer,
                    splitMode: opt.splitMode,
                  })
                }
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function PaidForSplitOptionCards(props: {
  value: SplitMode
  onChange: (next: SplitMode) => void
  readOnly?: boolean
}) {
  const { value, onChange, readOnly } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  return (
    <div
      role="radiogroup"
      aria-label={t('paidForSection')}
      className="space-y-1.5"
    >
      <SectionLabel>{t('paidForSection')}</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PAID_FOR_OPTIONS.map((opt) => {
          const selected = value === opt.id
          const title = t(opt.labelKey)
          const disabled = readOnly
          return (
            <OptionCard
              key={opt.id}
              icon={opt.icon}
              title={title}
              helper={t(opt.helperKey)}
              selected={selected}
              disabled={disabled}
              ariaLabel={`Split ${title}`}
              onClick={() => {
                if (disabled) return
                onChange(opt.id)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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

export type PaidBySplitOption = (typeof PAID_BY_OPTIONS)[number]

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

function OptionHeader({
  icon: Icon,
  title,
  helper,
  selected,
}: {
  icon: IconType
  title: string
  helper: string
  selected: boolean
}) {
  return (
    <>
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
    </>
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
  renderContent?: (option: PaidBySplitOption) => ReactNode
}) {
  const { value, onChange, readOnly, renderContent } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  const isSelected = (opt: (typeof PAID_BY_OPTIONS)[number]) => {
    if (opt.id === 'single') return !value.isMultiPayer
    return value.isMultiPayer && value.splitMode === opt.splitMode
  }

  const single = PAID_BY_OPTIONS.filter((o) => o.id === 'single')
  const multi = PAID_BY_OPTIONS.filter((o) => o.id !== 'single')
  const multiSectionLabel = t('paidBySectionMultiple')

  const selectedOption = PAID_BY_OPTIONS.find(isSelected)

  return (
    <RadioGroup
      value={selectedOption?.id}
      onValueChange={(nextId) => {
        const opt = PAID_BY_OPTIONS.find((candidate) => candidate.id === nextId)
        if (!opt) return
        onChange({
          isMultiPayer: opt.isMultiPayer,
          splitMode: opt.splitMode,
        })
      }}
      aria-label={multiSectionLabel}
      className="!flex flex-col gap-3"
    >
      <div className="space-y-1.5">
        <SectionLabel>{t('paidBySectionSingle')}</SectionLabel>
        <div className="grid w-full min-w-0 grid-cols-1 gap-2">
          {single.map((opt) => {
            const selected = isSelected(opt)
            return (
              <RadioGroupItem
                key={opt.id}
                value={opt.id}
                card
                disabled={readOnly}
                content={selected ? renderContent?.(opt) : undefined}
              >
                <OptionHeader
                  icon={opt.icon}
                  title={t(opt.labelKey)}
                  helper={t(opt.helperKey)}
                  selected={selected}
                />
              </RadioGroupItem>
            )
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <SectionLabel>{multiSectionLabel}</SectionLabel>
        <div className="grid w-full min-w-0 grid-cols-1 gap-2">
          {multi.map((opt) => {
            const selected = isSelected(opt)
            const title = t(opt.labelKey)
            return (
              <RadioGroupItem
                key={opt.id}
                value={opt.id}
                card
                disabled={readOnly}
                content={selected ? renderContent?.(opt) : undefined}
                aria-label={`${multiSectionLabel} \u2014 ${title}`}
              >
                <OptionHeader
                  icon={opt.icon}
                  title={title}
                  helper={t(opt.helperKey)}
                  selected={selected}
                />
              </RadioGroupItem>
            )
          })}
        </div>
      </div>
    </RadioGroup>
  )
}

export function PaidForSplitOptionCards(props: {
  value: SplitMode
  onChange: (next: SplitMode) => void
  readOnly?: boolean
  renderContent?: (mode: Exclude<SplitMode, 'ITEMIZED'>) => ReactNode
  /** Modes to omit from the rendered radio group. The selected mode is
   *  NOT auto-snapped — callers must ensure `value` is not in the
   *  hidden list, or no card will appear as selected. */
  hiddenModes?: Exclude<SplitMode, 'ITEMIZED'>[]
}) {
  const { value, onChange, readOnly, renderContent, hiddenModes } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  const hidden = new Set(hiddenModes ?? [])
  const visibleOptions = PAID_FOR_OPTIONS.filter((opt) => !hidden.has(opt.id))

  return (
    <RadioGroup
      value={
        value === 'ITEMIZED' ||
        hidden.has(value as Exclude<SplitMode, 'ITEMIZED'>)
          ? undefined
          : value
      }
      onValueChange={(next) => onChange(next as SplitMode)}
      aria-label={t('paidForSection')}
      className="!flex flex-col gap-1.5"
    >
      <SectionLabel>{t('paidForSection')}</SectionLabel>
      <div className="grid w-full min-w-0 grid-cols-1 gap-2">
        {visibleOptions.map((opt) => {
          const selected = value === opt.id
          const title = t(opt.labelKey)
          const disabled = readOnly
          return (
            <RadioGroupItem
              key={opt.id}
              value={opt.id}
              card
              disabled={disabled}
              content={selected ? renderContent?.(opt.id) : undefined}
              aria-label={t('splitOptionAria', { title })}
            >
              <OptionHeader
                icon={opt.icon}
                title={title}
                helper={t(opt.helperKey)}
                selected={selected}
              />
            </RadioGroupItem>
          )
        })}
      </div>
    </RadioGroup>
  )
}

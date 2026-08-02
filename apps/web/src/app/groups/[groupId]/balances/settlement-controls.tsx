import { Layers3, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export type SettlementMode = 'individual' | 'subgroups'

export function SettlementModePicker({
  value,
  onChange,
}: {
  value: SettlementMode
  onChange: (mode: SettlementMode) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })

  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        if (next === 'individual' || next === 'subgroups') onChange(next)
      }}
      aria-label={t('settlementMode.label')}
      className="inline-flex w-full min-w-0 gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 sm:w-auto sm:shrink-0"
    >
      <SettlementModeOption
        value="individual"
        selected={value === 'individual'}
        icon={UserRound}
        title={t('settlementMode.individual')}
      />
      <SettlementModeOption
        value="subgroups"
        selected={value === 'subgroups'}
        icon={Layers3}
        title={t('settlementMode.subgroups')}
      />
    </RadioGroup>
  )
}

function SettlementModeOption({
  value,
  selected,
  icon: Icon,
  title,
}: {
  value: SettlementMode
  selected: boolean
  icon: typeof UserRound
  title: string
}) {
  return (
    <label
      className={`group flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors sm:flex-none ${selected ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate font-medium">{title}</span>
      <RadioGroupItem value={value} className="sr-only" />
    </label>
  )
}

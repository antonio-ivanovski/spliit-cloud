import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import {
  SettlementModePicker,
  type SettlementMode,
} from './settlement-controls'

export function SettlementCardHeader({
  title,
  description,
  settlementMode,
  onSettlementModeChange,
}: {
  title: ReactNode
  description: ReactNode
  settlementMode?: SettlementMode
  onSettlementModeChange?: (mode: SettlementMode) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })

  return (
    <CardHeader className="grid items-start gap-4 px-0 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6 sm:py-6">
      <div className="min-w-0 sm:pt-0.5">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
      {settlementMode && onSettlementModeChange ? (
        <div className="w-full min-w-0 space-y-1 sm:w-auto sm:min-w-52 sm:justify-self-end">
          <span className="block text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:text-right">
            {t('settlementMode.label')}
          </span>
          <SettlementModePicker
            value={settlementMode}
            onChange={onSettlementModeChange}
          />
        </div>
      ) : null}
    </CardHeader>
  )
}

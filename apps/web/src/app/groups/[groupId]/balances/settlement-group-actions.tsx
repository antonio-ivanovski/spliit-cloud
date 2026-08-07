import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'

import { CreateReimbursementModal } from './create-reimbursement-modal'
import {
  settlementLegKey,
  sumSettlementLegs,
  type SettlementGroup,
} from './settlement-groups'

export function SettlementGroupActions({
  group,
  currency,
  originalCurrencyCode,
  groupId,
  participants,
  children,
}: {
  group: SettlementGroup
  currency: Currency
  originalCurrencyCode?: string
  groupId: string
  participants?: Array<{
    id: string
    name: string
    account?: { id: string; name?: string | null; image?: string | null } | null
  }>
  children: (openFor: (legKeys?: string[]) => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [initialSelectedKeys, setInitialSelectedKeys] = useState<string[]>([])

  const openFor = (legKeys = group.legs.map(settlementLegKey)) => {
    setInitialSelectedKeys(legKeys)
    setOpen(true)
  }

  return (
    <>
      {children(openFor)}
      <CreateReimbursementModal
        groupId={groupId}
        settlementGroup={group}
        initialSelectedKeys={initialSelectedKeys}
        currency={currency}
        originalCurrencyCode={originalCurrencyCode}
        participants={participants}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

export function SettlementGroupButton({
  group,
  currency,
  participantName,
  onClick,
}: {
  group: SettlementGroup
  currency: Currency
  participantName: string
  onClick: () => void
}) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const total = sumSettlementLegs(group.legs)
  return (
    <Button
      type="button"
      variant="link"
      className="-me-2 min-h-11 shrink-0 px-2 text-xs"
      onClick={onClick}
      aria-label={t(
        group.direction === 'pay'
          ? 'direction.settlePaymentsBy'
          : 'direction.settlePaymentsTo',
        {
          name: participantName,
          amount: formatCurrency(currency, total, locale),
          count: group.legs.length,
        },
      )}
      data-testid={`settle-group-${group.direction}-${group.participantId}`}
    >
      {t('direction.settle')}
    </Button>
  )
}

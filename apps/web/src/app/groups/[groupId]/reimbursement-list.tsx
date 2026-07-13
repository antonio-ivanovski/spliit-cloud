import { ParticipantAvatar } from '@/components/participant-avatar'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import type { AccountIdentity } from '@/lib/account'
import type { Reimbursement } from '@/lib/balances'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { CreateReimbursementModal } from './balances/create-reimbursement-modal'

type Participant = {
  id: string
  name: string
  account?: AccountIdentity | null
}

type Props = {
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  reimbursementCurrencyCode?: string
  groupId: string
}

export function ReimbursementList({
  reimbursements,
  participants,
  currency,
  reimbursementCurrencyCode,
  groupId,
}: Props) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, {
    keyPrefix: 'Balances.Reimbursements',
  })
  const [selectedReimbursement, setSelectedReimbursement] =
    useState<Reimbursement | null>(null)

  if (reimbursements.length === 0) {
    return (
      <p className="text-sm pb-6" data-testid="no-reimbursements">
        {t('noImbursements')}
      </p>
    )
  }

  const getParticipant = (id: string) => participants.find((p) => p.id === id)
  return (
    <div className="text-sm" data-testid="reimbursements-list">
      {reimbursements.map((reimbursement) => {
        const from = getParticipant(reimbursement.from)
        const to = getParticipant(reimbursement.to)
        const fromName = from?.name ?? ''
        const toName = to?.name ?? ''
        return (
          <div
            className="py-4 flex min-w-0 justify-between gap-2"
            key={`${reimbursement.from}-${reimbursement.to}`}
            data-testid={`reimbursement-row-${fromName}-${toName}`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1 items-start sm:flex-row sm:items-center sm:gap-4">
              <div className="flex items-center gap-2 min-w-0">
                {from && (
                  <ParticipantAvatar
                    participant={from}
                    size="sm"
                    className="shrink-0"
                  />
                )}
                <span className="min-w-0">
                  <Trans
                    i18nKey="Balances.Reimbursements.owes"
                    values={{ from: fromName, to: toName }}
                    components={{
                      strong: <strong className="break-all" />,
                    }}
                  />
                </span>
                {to && (
                  <ParticipantAvatar
                    participant={to}
                    size="sm"
                    className="shrink-0"
                  />
                )}
              </div>
              <Button
                type="button"
                variant="link"
                className="-mx-4 -my-3 min-h-11 shrink-0"
                onClick={() => setSelectedReimbursement(reimbursement)}
                aria-label={t('markAsPaidAria', {
                  amount: formatCurrency(
                    currency,
                    reimbursement.amount,
                    locale,
                  ),
                  from: fromName,
                  to: toName,
                })}
                data-testid={`reimbursement-mark-as-paid-${fromName}-${toName}`}
              >
                {t('markAsPaid')}
              </Button>
            </div>
            <div className="shrink-0">
              {formatCurrency(currency, reimbursement.amount, locale)}
            </div>
          </div>
        )
      })}
      <CreateReimbursementModal
        groupId={groupId}
        reimbursement={selectedReimbursement}
        currency={currency}
        originalCurrencyCode={reimbursementCurrencyCode}
        open={selectedReimbursement !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedReimbursement(null)
        }}
      />
    </div>
  )
}

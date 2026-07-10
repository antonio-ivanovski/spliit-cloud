import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import type { Reimbursement } from '@/lib/balances'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'
import { Trans, useTranslation } from 'react-i18next'

type Participant = { id: string; name: string }

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
        const fromName = getParticipant(reimbursement.from)?.name ?? ''
        const toName = getParticipant(reimbursement.to)?.name ?? ''
        return (
          <div
            className="py-4 flex min-w-0 justify-between gap-2"
            key={`${reimbursement.from}-${reimbursement.to}`}
            data-testid={`reimbursement-row-${fromName}-${toName}`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1 items-start sm:flex-row sm:items-baseline sm:gap-4">
              <div className="min-w-0 break-words">
                <Trans
                  i18nKey="Balances.Reimbursements.owes"
                  values={{ from: fromName, to: toName }}
                  components={{
                    strong: <strong className="break-all" />,
                  }}
                />
              </div>
              <Button variant="link" asChild className="-mx-4 -my-3 shrink-0">
                <Link
                  href="/groups/$groupId/expenses/create"
                  params={{ groupId }}
                  search={{
                    reimbursement: 'yes',
                    from: reimbursement.from,
                    to: reimbursement.to,
                    amount: reimbursement.amount.toString(),
                    ...(reimbursementCurrencyCode
                      ? { originalCurrency: reimbursementCurrencyCode }
                      : {}),
                  }}
                >
                  {t('markAsPaid')}
                </Link>
              </Button>
            </div>
            <div className="shrink-0">
              {formatCurrency(currency, reimbursement.amount, locale)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

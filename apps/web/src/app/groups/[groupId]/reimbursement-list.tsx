import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import { Reimbursement } from '@/lib/balances'
import { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'
import { Trans, useTranslation } from 'react-i18next'

type Participant = { id: string; name: string }

type Props = {
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  groupId: string
}

export function ReimbursementList({
  reimbursements,
  participants,
  currency,
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
            className="py-4 flex justify-between"
            key={`${reimbursement.from}-${reimbursement.to}`}
            data-testid={`reimbursement-row-${fromName}-${toName}`}
          >
            <div className="flex flex-col gap-1 items-start sm:flex-row sm:items-baseline sm:gap-4">
              <div>
                <Trans
                  i18nKey="Balances.Reimbursements.owes"
                  values={{ from: fromName, to: toName }}
                  components={{ strong: <strong /> }}
                />
              </div>
              <Button variant="link" asChild className="-mx-4 -my-3">
                <Link
                  href="/groups/$groupId/expenses/create"
                  params={{ groupId }}
                  search={{
                    reimbursement: 'yes',
                    from: reimbursement.from,
                    to: reimbursement.to,
                    amount: reimbursement.amount.toString(),
                  }}
                >
                  {t('markAsPaid')}
                </Link>
              </Button>
            </div>
            <div>{formatCurrency(currency, reimbursement.amount, locale)}</div>
          </div>
        )
      })}
    </div>
  )
}

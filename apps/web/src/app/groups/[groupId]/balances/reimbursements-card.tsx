import { ReimbursementList } from '@/app/groups/[groupId]/reimbursement-list'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { Reimbursement } from '@/lib/balances'
import type { Currency } from '@/lib/currency'
import { useTranslation } from 'react-i18next'
import { ReimbursementsLoading } from './balances-loading'
import type { CurrencyBalance } from './currency-balances'
import { CurrencySection } from './currency-section'

export function ReimbursementsCard({
  isLoading,
  participantCount,
  currencyDisplay,
  reimbursements,
  currencyBalances,
  participants,
  groupCurrency,
  groupId,
}: {
  isLoading: boolean
  participantCount?: number
  currencyDisplay: 'group' | 'original'
  reimbursements: Reimbursement[] | undefined
  currencyBalances: CurrencyBalance[]
  participants: { id: string; name: string }[]
  groupCurrency: Currency | undefined
  groupId: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const reimbursementCurrencies = currencyBalances.filter(
    (summary) => summary.reimbursements.length > 0,
  )

  return (
    <Card className="mobile-surface mb-4">
      <CardHeader>
        <CardTitle>{t('Reimbursements.title')}</CardTitle>
        <CardDescription>{t('Reimbursements.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ReimbursementsLoading participantCount={participantCount} />
        ) : currencyDisplay === 'original' ? (
          reimbursementCurrencies.length === 0 ? (
            <ReimbursementList
              reimbursements={[]}
              participants={participants}
              currency={groupCurrency!}
              groupId={groupId}
            />
          ) : (
            <div className="divide-y divide-border">
              {reimbursementCurrencies.map((summary) => (
                <CurrencySection
                  key={summary.currencyCode}
                  currency={summary.currency}
                >
                  <ReimbursementList
                    reimbursements={summary.reimbursements}
                    participants={participants}
                    currency={summary.currency}
                    reimbursementCurrencyCode={summary.currencyCode}
                    groupId={groupId}
                  />
                </CurrencySection>
              ))}
            </div>
          )
        ) : (
          <ReimbursementList
            reimbursements={reimbursements ?? []}
            participants={participants}
            currency={groupCurrency!}
            groupId={groupId}
          />
        )}
      </CardContent>
    </Card>
  )
}

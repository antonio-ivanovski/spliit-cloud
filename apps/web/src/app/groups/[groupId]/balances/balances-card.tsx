import { BalancesList } from '@/app/groups/[groupId]/balances-list'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { Balances } from '@/lib/balances'
import type { Currency } from '@/lib/currency'
import { useTranslation } from 'react-i18next'
import { BalancesLoading } from './balances-loading'
import type { CurrencyBalance } from './currency-balances'
import { CurrencySection } from './currency-section'

export function BalancesCard({
  isLoading,
  participantCount,
  currencyDisplay,
  balances,
  currencyBalances,
  participants,
  groupCurrency,
}: {
  isLoading: boolean
  participantCount?: number
  currencyDisplay: 'group' | 'original'
  balances: Balances | undefined
  currencyBalances: CurrencyBalance[]
  participants: {
    id: string
    name: string
    account?: { id: string; name?: string | null; image?: string | null } | null
  }[]
  groupCurrency: Currency | undefined
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })

  return (
    <Card className="mobile-surface mb-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <BalancesLoading participantCount={participantCount} />
        ) : currencyDisplay === 'original' ? (
          <div className="divide-y divide-border">
            {currencyBalances.map((summary) => (
              <CurrencySection
                key={summary.currencyCode}
                currency={summary.currency}
              >
                <BalancesList
                  balances={summary.balances}
                  participants={participants}
                  currency={summary.currency}
                />
              </CurrencySection>
            ))}
          </div>
        ) : (
          <BalancesList
            balances={balances ?? {}}
            participants={participants}
            currency={groupCurrency!}
          />
        )}
      </CardContent>
    </Card>
  )
}

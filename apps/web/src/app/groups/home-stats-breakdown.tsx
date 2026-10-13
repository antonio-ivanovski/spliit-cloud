import { Link } from '@tanstack/react-router'
import { UserRound, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Money } from '@/components/money'
import { Card, CardContent } from '@/components/ui/card'
import type { Currency } from '@/lib/currency'
import type { CategoryId } from '@spliit/domain'

import { CategoryBreakdown } from './[groupId]/stats/category-breakdown'
import type { HomeStatsData } from './home-stats'

export function HomeStatsBreakdown({
  selected,
  groups,
  currency,
}: {
  selected: HomeStatsData['currencies'][number]
  groups: HomeStatsData['groups']
  currency: Currency
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Homepage.Activity' })
  const magnitude = selected.categories.reduce(
    (sum, category) => sum + Math.abs(category.amount),
    0,
  )
  const ledgerMagnitude = selected.ledgers.reduce(
    (sum, ledger) => sum + Math.abs(ledger.netSpending),
    0,
  )
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label={t('breakdown')}>
      <Card className="overflow-hidden shadow-none">
        <CardContent spacing="standalone">
          <CategoryBreakdown
            currency={currency}
            limit={Infinity}
            data={{
              categories: selected.categories.map((category) => ({
                ...category,
                categoryId: category.categoryId as CategoryId,
                percentage: magnitude ? category.amount / magnitude : 0,
              })),
            }}
          />
        </CardContent>
      </Card>
      <Card className="overflow-hidden shadow-none">
        <CardContent spacing="standalone">
          <h3 className="font-semibold tracking-tight">{t('byLedger')}</h3>
          <div className="mt-5 space-y-4">
            {selected.ledgers.map((ledger) => {
              const Icon =
                groups.find((group) => group.groupId === ledger.groupId)
                  ?.groupType === 'FRIEND'
                  ? UserRound
                  : UsersRound
              return (
                <div key={ledger.groupId}>
                  <div className="mb-1.5 flex items-center gap-2 text-sm">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <Link
                      to="/groups/$groupId/stats"
                      params={{ groupId: ledger.groupId }}
                      className="min-w-0 flex-1 truncate underline-offset-4 hover:underline focus-visible:underline"
                    >
                      {ledger.name}
                    </Link>
                    <span className="shrink-0 font-medium tabular-nums">
                      <Money currency={currency} amount={ledger.netSpending} />
                    </span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${ledgerMagnitude ? (Math.abs(ledger.netSpending) / ledgerMagnitude) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

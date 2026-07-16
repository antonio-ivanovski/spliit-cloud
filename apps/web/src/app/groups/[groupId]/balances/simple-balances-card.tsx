import { ParticipantAvatar } from '@/components/participant-avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useLocale } from '@/i18n/react'
import type { Balances, Reimbursement } from '@/lib/balances'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'
import { Trans, useTranslation } from 'react-i18next'
import { BalancesLoading, ReimbursementsLoading } from './balances-loading'
import type { CurrencyBalance } from './currency-balances'
import { CurrencySection } from './currency-section'
import {
  SettlementGroupActions,
  SettlementGroupButton,
} from './settlement-group-actions'
import {
  buildSettlementGroups,
  settlementLegKey,
  sumSettlementLegs,
  type SettlementDirection,
} from './settlement-groups'

type Participant = {
  id: string
  name: string
  account?: { id: string; name?: string | null; image?: string | null } | null
}

export function SimpleBalancesCard({
  isLoading,
  participantCount,
  currencyDisplay,
  balances,
  reimbursements,
  currencyBalances,
  participants,
  groupCurrency,
  groupId,
}: {
  isLoading: boolean
  participantCount?: number
  currencyDisplay: 'group' | 'original'
  balances: Balances | undefined
  reimbursements: Reimbursement[] | undefined
  currencyBalances: CurrencyBalance[]
  participants: Participant[]
  groupCurrency: Currency | undefined
  groupId: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })

  return (
    <Card className="mobile-surface mb-4">
      <CardHeader>
        <CardTitle>{t('simple.title')}</CardTitle>
        <CardDescription>{t('simple.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-6">
            <BalancesLoading participantCount={participantCount} />
            <ReimbursementsLoading participantCount={participantCount} />
          </div>
        ) : currencyDisplay === 'original' ? (
          <div className="divide-y-2 divide-border/80">
            {currencyBalances.filter(hasActivity).length === 0 ? (
              <SimpleEmptyState />
            ) : (
              currencyBalances.flatMap((summary) =>
                hasActivity(summary)
                  ? [
                      <CurrencySection
                        key={summary.currencyCode}
                        currency={summary.currency}
                      >
                        <SimpleCurrencyContent
                          balances={summary.balances}
                          reimbursements={summary.reimbursements}
                          participants={participants}
                          currency={summary.currency}
                          currencyCode={summary.currencyCode}
                          groupId={groupId}
                        />
                      </CurrencySection>,
                    ]
                  : [],
              )
            )}
          </div>
        ) : (
          <SimpleCurrencyContent
            balances={balances ?? {}}
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

function hasActivity(summary: CurrencyBalance) {
  return (
    summary.reimbursements.length > 0 ||
    Object.values(summary.balances).some((balance) => balance.total !== 0)
  )
}

function SimpleCurrencyContent({
  balances,
  reimbursements,
  participants,
  currency,
  currencyCode,
  groupId,
}: {
  balances: Balances
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  currencyCode?: string
  groupId: string
}) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const activeParticipants = participants.filter(
    (participant) => (balances[participant.id]?.total ?? 0) !== 0,
  )

  if (activeParticipants.length === 0 && reimbursements.length === 0) {
    return <SimpleEmptyState />
  }

  return (
    <div className="space-y-7">
      {activeParticipants.length > 0 && (
        <section aria-label={t('simple.netBalances')} className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('simple.netBalances')}
          </h3>
          <div className="divide-y divide-border/60 rounded-lg border border-border/70">
            {activeParticipants.map((participant) => {
              const total = balances[participant.id]?.total ?? 0
              const amount = formatCurrency(currency, Math.abs(total), locale)
              return (
                <div
                  key={participant.id}
                  className="flex min-h-12 items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ParticipantAvatar participant={participant} size="sm" />
                    <span className="min-w-0 truncate text-sm font-medium">
                      {participant.name}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 text-sm tabular-nums ${total > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}
                  >
                    {total > 0
                      ? t('simple.isOwed', { amount })
                      : t('simple.owes', { amount })}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}
      <section aria-label={t('simple.suggestedPayments')} className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('simple.suggestedPayments')}
        </h3>
        <SimpleSettlementDirections
          balances={balances}
          reimbursements={reimbursements}
          participants={participants}
          currency={currency}
          reimbursementCurrencyCode={currencyCode}
          groupId={groupId}
        />
      </section>
    </div>
  )
}

function SimpleSettlementDirections({
  balances,
  reimbursements,
  participants,
  currency,
  reimbursementCurrencyCode,
  groupId,
}: {
  balances: Balances
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  reimbursementCurrencyCode?: string
  groupId: string
}) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const participantIdsWithBalance = (predicate: (total: number) => boolean) =>
    participants.reduce<string[]>((ids, participant) => {
      if (predicate(balances[participant.id]?.total ?? 0)) {
        ids.push(participant.id)
      }
      return ids
    }, [])
  const directions: Array<{
    direction: SettlementDirection
    title: string
    participantIds: string[]
  }> = [
    {
      direction: 'pay',
      title: t('direction.toPay'),
      participantIds: participantIdsWithBalance((total) => total < 0),
    },
    {
      direction: 'receive',
      title: t('direction.toReceive'),
      participantIds: participantIdsWithBalance((total) => total > 0),
    },
  ]

  return (
    <div className="space-y-6">
      {directions.map(({ direction, title, participantIds }) => {
        const groups = buildSettlementGroups(
          reimbursements,
          participantIds,
          direction,
        )
        if (groups.length === 0) return null
        return (
          <section key={direction} aria-label={title} className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {title}
            </h4>
            <div className="space-y-3">
              {groups.map((group) => {
                const participant = participants.find(
                  (item) => item.id === group.participantId,
                )
                if (!participant) return null
                const total = sumSettlementLegs(group.legs)
                return (
                  <SettlementGroupActions
                    key={`${direction}-${group.participantId}`}
                    group={group}
                    currency={currency}
                    originalCurrencyCode={reimbursementCurrencyCode}
                    groupId={groupId}
                  >
                    {(openFor) => (
                      <div className="rounded-lg border border-border/70">
                        <div className="flex min-h-12 items-center justify-between gap-2 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <ParticipantAvatar
                              participant={participant}
                              size="sm"
                            />
                            <span className="min-w-0 truncate text-sm font-normal text-muted-foreground">
                              <Trans
                                i18nKey={`Balances.direction.${direction === 'receive' ? 'participantReceives' : 'participantPays'}`}
                                components={{
                                  strong: (
                                    <strong className="font-semibold text-foreground" />
                                  ),
                                }}
                                values={{ name: participant.name }}
                              />
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="shrink-0 tabular-nums text-sm font-medium">
                              {formatCurrency(currency, total, locale)}
                            </span>
                            <SettlementGroupButton
                              group={group}
                              currency={currency}
                              participantName={participant.name}
                              onClick={() => openFor()}
                            />
                          </div>
                        </div>
                        <div className="divide-y divide-border/60 border-t border-border/60">
                          {group.legs.map((leg) => {
                            const counterparty = participants.find(
                              (item) =>
                                item.id ===
                                (direction === 'pay' ? leg.to : leg.from),
                            )
                            const counterpartyName = counterparty?.name ?? ''
                            return (
                              <div
                                key={settlementLegKey(leg)}
                                className="flex min-h-11 items-center gap-2 px-3 py-2 text-xs"
                              >
                                {counterparty && (
                                  <ParticipantAvatar
                                    participant={counterparty}
                                    size="xs"
                                  />
                                )}
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                  <Trans
                                    i18nKey={`Balances.direction.${direction === 'receive' ? 'fromParticipant' : 'toParticipant'}`}
                                    components={{
                                      strong: (
                                        <strong className="font-semibold text-foreground" />
                                      ),
                                    }}
                                    values={{ name: counterpartyName }}
                                  />
                                </span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {formatCurrency(currency, leg.amount, locale)}
                                </span>
                                {direction === 'pay' && (
                                  <Button
                                    type="button"
                                    variant="link"
                                    className="h-auto shrink-0 p-0 text-xs"
                                    onClick={() =>
                                      openFor([settlementLegKey(leg)])
                                    }
                                    aria-label={t(
                                      'Reimbursements.markAsPaidAria',
                                      {
                                        amount: formatCurrency(
                                          currency,
                                          leg.amount,
                                          locale,
                                        ),
                                        from: participant.name,
                                        to: counterpartyName,
                                      },
                                    )}
                                    data-testid={`reimbursement-mark-as-paid-${leg.from}-${leg.to}`}
                                  >
                                    {t('Reimbursements.markAsPaid')}
                                  </Button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </SettlementGroupActions>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function SimpleEmptyState() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  return (
    <p
      className="py-2 text-sm text-muted-foreground"
      data-testid="simple-empty-state"
    >
      {t('simple.empty')}
    </p>
  )
}

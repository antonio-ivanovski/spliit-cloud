import { ParticipantAvatar } from '@/components/participant-avatar'
import { ParticipantSegmentBar } from '@/components/participant-segment-bar'
import { participantSegmentColor } from '@/components/participant-segment-utils'
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
import { BalancesLoading } from './balances-loading'
import type { CurrencyBalance } from './currency-balances'
import { CurrencySection } from './currency-section'
import {
  SettlementGroupActions,
  SettlementGroupButton,
} from './settlement-group-actions'
import { settlementLegKey, type SettlementGroup } from './settlement-groups'

type Participant = {
  id: string
  name: string
  account?: { id: string; name?: string | null; image?: string | null } | null
}

export function BalancesCard({
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
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <BalancesLoading participantCount={participantCount} />
        ) : currencyDisplay === 'original' ? (
          <div className="divide-y-2 divide-border/80">
            {currencyBalances.length === 0 ? (
              <SettlementSection
                balances={{}}
                reimbursements={[]}
                participants={participants}
                currency={groupCurrency!}
                groupId={groupId}
              />
            ) : (
              currencyBalances.map((summary) => (
                <CurrencySection
                  key={summary.currencyCode}
                  currency={summary.currency}
                >
                  <SettlementSection
                    balances={summary.balances}
                    reimbursements={summary.reimbursements}
                    participants={participants}
                    currency={summary.currency}
                    groupId={groupId}
                    includeOriginalCurrency
                  />
                </CurrencySection>
              ))
            )}
          </div>
        ) : (
          <SettlementSection
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

function SettlementSection({
  balances,
  reimbursements,
  participants,
  currency,
  groupId,
  includeOriginalCurrency,
}: {
  balances: Balances
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  groupId: string
  includeOriginalCurrency?: boolean
}) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const participantById = new Map(participants.map((p) => [p.id, p]))
  const participantIndex = new Map(participants.map((p, i) => [p.id, i]))

  const getParticipant = (id: string): Participant =>
    participantById.get(id) ?? { id, name: id }

  const receiving = participants.filter(
    (participant) => (balances[participant.id]?.total ?? 0) > 0,
  )
  const paying = participants.filter(
    (participant) => (balances[participant.id]?.total ?? 0) < 0,
  )
  const settled = participants.filter(
    (participant) => (balances[participant.id]?.total ?? 0) === 0,
  )

  return (
    <div className="space-y-8" data-testid="settlement-balances">
      {receiving.length > 0 && (
        <SettlementDirection
          title={t('direction.toReceive')}
          participants={receiving}
          reimbursements={reimbursements}
          direction="receive"
          currency={currency}
          locale={locale}
          participantIndex={participantIndex}
          getParticipant={getParticipant}
          groupId={groupId}
          includeOriginalCurrency={includeOriginalCurrency}
        />
      )}
      {paying.length > 0 && (
        <SettlementDirection
          title={t('direction.toPay')}
          participants={paying}
          reimbursements={reimbursements}
          direction="pay"
          currency={currency}
          locale={locale}
          participantIndex={participantIndex}
          getParticipant={getParticipant}
          groupId={groupId}
          includeOriginalCurrency={includeOriginalCurrency}
        />
      )}
      {settled.length > 0 && (
        <section aria-label={t('direction.settledUp')} className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('direction.settledUp')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {settled.map((participant) => (
              <div
                key={participant.id}
                className="flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 py-1 pl-1 pr-3 text-xs text-muted-foreground"
              >
                <ParticipantAvatar participant={participant} size="xs" />
                <span className="max-w-32 truncate">{participant.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {receiving.length === 0 &&
        paying.length === 0 &&
        settled.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('Reimbursements.noImbursements')}
          </p>
        )}
    </div>
  )
}

function SettlementDirection({
  title,
  participants,
  reimbursements,
  direction,
  currency,
  locale,
  participantIndex,
  getParticipant,
  groupId,
  includeOriginalCurrency = false,
}: {
  title: string
  participants: Participant[]
  reimbursements: Reimbursement[]
  direction: 'receive' | 'pay'
  currency: Currency
  locale: string
  participantIndex: Map<string, number>
  getParticipant: (id: string) => Participant
  groupId: string
  includeOriginalCurrency?: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  return (
    <>
      <section aria-label={title} className="space-y-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <p className="-mt-2 text-xs leading-snug text-muted-foreground/70">
          {t(
            direction === 'receive'
              ? 'direction.toReceiveDescription'
              : 'direction.toPayDescription',
          )}
        </p>
        <div className="space-y-5">
          {participants.map((participant) => {
            const legs = reimbursements.filter((reimbursement) =>
              direction === 'receive'
                ? reimbursement.to === participant.id
                : reimbursement.from === participant.id,
            )
            const rows = legs.map((leg) => {
              const counterparty = getParticipant(
                direction === 'receive' ? leg.from : leg.to,
              )
              return {
                id: `${leg.from}-${leg.to}`,
                name: counterparty.name,
                amount: leg.amount,
                participant: counterparty,
                colorIndex: participantIndex.get(counterparty.id) ?? 0,
              }
            })
            const total = rows.reduce((sum, row) => sum + row.amount, 0)

            const group: SettlementGroup = {
              direction,
              participantId: participant.id,
              legs,
            }
            return (
              <SettlementGroupActions
                key={participant.id}
                group={group}
                currency={currency}
                groupId={groupId}
                originalCurrencyCode={
                  includeOriginalCurrency ? currency.code : undefined
                }
              >
                {(openFor) => (
                  <article className="space-y-5 border-b border-border/60 pb-5 last:border-b-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
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
                    <ParticipantSegmentBar
                      rows={rows}
                      currency={currency}
                      locale={locale}
                      showSingleParticipantBar
                    >
                      <div className="grid grid-cols-1 gap-y-1">
                        {legs.map((leg, index) => {
                          const to = getParticipant(leg.to)
                          const counterparty = getParticipant(
                            direction === 'receive' ? leg.from : leg.to,
                          )
                          const color = participantSegmentColor(
                            rows[index],
                            index,
                          )
                          return (
                            <div
                              key={`${leg.from}-${leg.to}`}
                              className="flex min-w-0 items-center gap-2 text-xs"
                            >
                              <span
                                aria-hidden="true"
                                className={`h-2 w-2 shrink-0 rounded-full ${color}`}
                              />
                              <span
                                className="min-w-0 flex-1 truncate font-normal text-muted-foreground"
                                title={counterparty.name}
                              >
                                <Trans
                                  i18nKey={`Balances.direction.${direction === 'receive' ? 'fromParticipant' : 'toParticipant'}`}
                                  components={{
                                    strong: (
                                      <strong className="font-semibold text-foreground" />
                                    ),
                                  }}
                                  values={{ name: counterparty.name }}
                                />
                              </span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {formatCurrency(currency, leg.amount, locale)}
                              </span>
                              {direction === 'pay' && (
                                <Button
                                  type="button"
                                  variant="link"
                                  onClick={() =>
                                    openFor([settlementLegKey(leg)])
                                  }
                                  className="h-auto shrink-0 p-0 text-xs"
                                  aria-label={t(
                                    'Reimbursements.markAsPaidAria',
                                    {
                                      amount: formatCurrency(
                                        currency,
                                        leg.amount,
                                        locale,
                                      ),
                                      from: getParticipant(leg.from).name,
                                      to: to.name,
                                    },
                                  )}
                                  data-testid={`reimbursement-mark-as-paid-${leg.from}-${leg.to}`}
                                >
                                  <span className="sr-only sm:not-sr-only">
                                    {t('Reimbursements.markAsPaid')}
                                  </span>
                                  <span className="sm:hidden">
                                    {t('Reimbursements.markAsPaid')}
                                  </span>
                                </Button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </ParticipantSegmentBar>
                  </article>
                )}
              </SettlementGroupActions>
            )
          })}
        </div>
      </section>
    </>
  )
}

import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useLocale } from '@/i18n/react'
import type { Balances, Reimbursement } from '@/lib/balances'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'
import type {
  IndividualSettlementPolicy,
  SubgroupDefinition,
  SubgroupSettlementPlan,
} from '@spliit/domain/subgroup-settlements'

import { BalancesLoading, ReimbursementsLoading } from './balances-loading'
import type { CurrencyBalance } from './currency-balances'
import { CurrencySection } from './currency-section'
import { SettlementCardHeader } from './settlement-card-header'
import type { SettlementMode } from './settlement-controls'
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
import {
  SettlementBalanceList,
  SettlementGroupCard,
  SettlementLegRow,
  type SettlementIdentity,
} from './settlement-ui'
import { SubgroupSettlementCard } from './subgroup-settlement-card'

type Participant = {
  id: string
  name: string
  account?: { id: string; name?: string | null; image?: string | null } | null
  removed?: boolean
}

const EMPTY_SUBGROUPS: SubgroupDefinition[] = []

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
  settlementMode = 'individual',
  onSettlementModeChange,
  subgroups = EMPTY_SUBGROUPS,
  subgroupSettlementPlan,
  individualSettlementPolicy,
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
  individualSettlementPolicy?: IndividualSettlementPolicy
  settlementMode?: SettlementMode
  onSettlementModeChange?: (mode: SettlementMode) => void
  subgroups?: SubgroupDefinition[]
  subgroupSettlementPlan?: SubgroupSettlementPlan
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })

  return (
    <Card className="mobile-surface mb-4">
      <SettlementCardHeader
        title={t('simple.title')}
        description={t('simple.description')}
        settlementMode={
          currencyDisplay === 'group' && onSettlementModeChange
            ? settlementMode
            : undefined
        }
        onSettlementModeChange={onSettlementModeChange}
      />
      <CardContent className="px-0 pb-5 sm:px-6 sm:pb-6">
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
        ) : settlementMode === 'subgroups' &&
          groupCurrency &&
          subgroups.length > 0 ? (
          <SubgroupSettlementCard
            groupId={groupId}
            currency={groupCurrency}
            participants={participants}
            settlementPlan={subgroupSettlementPlan}
            onSwitchToIndividual={() => onSettlementModeChange?.('individual')}
          />
        ) : (
          <SimpleCurrencyContent
            balances={balances ?? {}}
            reimbursements={reimbursements ?? []}
            participants={participants}
            currency={groupCurrency!}
            groupId={groupId}
            individualSettlementPolicy={
              settlementMode === 'individual'
                ? individualSettlementPolicy
                : undefined
            }
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
  individualSettlementPolicy,
}: {
  balances: Balances
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  currencyCode?: string
  groupId: string
  individualSettlementPolicy?: IndividualSettlementPolicy
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
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('simple.netBalances')}
          </h3>
          <SettlementBalanceList
            identities={activeParticipants.map(
              (participant): SettlementIdentity => ({
                id: participant.id,
                name: participant.name,
                members: [participant],
                total: balances[participant.id]?.total ?? 0,
                removed: participant.removed,
              }),
            )}
            currency={currency}
            locale={locale}
            amountLabel={({ amount, isReceiving }) =>
              isReceiving
                ? t('simple.isOwed', { amount })
                : t('simple.owes', { amount })
            }
          />
        </section>
      )}
      <section aria-label={t('simple.suggestedPayments')} className="space-y-3">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('simple.suggestedPayments')}
        </h3>
        {individualSettlementPolicy === 'all-individual' ? (
          <SettlementPolicyNote>
            {t('subgroups.individualAllHint')}
          </SettlementPolicyNote>
        ) : individualSettlementPolicy === 'within-subgroups' ? (
          <SettlementPolicyNote>
            {t('subgroups.individualWithinHint')}
          </SettlementPolicyNote>
        ) : null}
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

function SettlementPolicyNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <Info
        className="mt-0.5 size-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <p>{children}</p>
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
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
                    participants={participants}
                  >
                    {(openFor) => (
                      <SettlementGroupCard
                        identity={{
                          id: participant.id,
                          name: participant.name,
                          members: [participant],
                          total,
                          removed: participant.removed,
                        }}
                        title={
                          <Trans
                            i18nKey={`Balances.direction.${direction === 'receive' ? 'participantReceives' : 'participantPays'}`}
                            components={{
                              strong: (
                                <strong className="font-semibold text-foreground" />
                              ),
                            }}
                            values={{ name: participant.name }}
                          />
                        }
                        amount={total}
                        currency={currency}
                        locale={locale}
                        action={
                          <SettlementGroupButton
                            group={group}
                            currency={currency}
                            participantName={participant.name}
                            onClick={() => openFor()}
                          />
                        }
                      >
                        {group.legs.map((leg) => {
                          const counterparty = participants.find(
                            (item) =>
                              item.id ===
                              (direction === 'pay' ? leg.to : leg.from),
                          )
                          if (!counterparty) return null
                          const counterpartyName = counterparty.name
                          return (
                            <SettlementLegRow
                              key={settlementLegKey(leg)}
                              counterparty={{
                                id: counterparty.id,
                                name: counterparty.name,
                                members: [counterparty],
                                total: 0,
                                removed: counterparty.removed,
                              }}
                              description={
                                <Trans
                                  i18nKey={`Balances.direction.${direction === 'receive' ? 'fromParticipant' : 'toParticipant'}`}
                                  components={{
                                    strong: (
                                      <strong className="font-semibold text-foreground" />
                                    ),
                                  }}
                                  values={{ name: counterpartyName }}
                                />
                              }
                              amount={leg.amount}
                              currency={currency}
                              locale={locale}
                              action={
                                direction === 'pay' ? (
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
                                ) : null
                              }
                            />
                          )
                        })}
                      </SettlementGroupCard>
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

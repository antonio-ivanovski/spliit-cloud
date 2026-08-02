import { Info } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

import { ParticipantSegmentBar } from '@/components/participant-segment-bar'
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

import { BalancesLoading } from './balances-loading'
import type { CurrencyBalance } from './currency-balances'
import { CurrencySection } from './currency-section'
import { RemovedParticipantBadge } from './removed-participant-badge'
import { SettlementCardHeader } from './settlement-card-header'
import type { SettlementMode } from './settlement-controls'
import {
  SettlementGroupActions,
  SettlementGroupButton,
} from './settlement-group-actions'
import { settlementLegKey, type SettlementGroup } from './settlement-groups'
import {
  SettlementAvatar,
  SettlementGroupCard,
  SettlementLegList,
  SettlementLegRow,
  type SettlementIdentity,
} from './settlement-ui'
import { VisualSubgroupSettlement } from './visual-subgroup-settlement'

type Participant = {
  id: string
  name: string
  account?: { id: string; name?: string | null; image?: string | null } | null
  removed?: boolean
}

const EMPTY_SUBGROUPS: SubgroupDefinition[] = []

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
  settlementMode?: SettlementMode
  onSettlementModeChange?: (mode: SettlementMode) => void
  subgroups?: SubgroupDefinition[]
  subgroupSettlementPlan?: SubgroupSettlementPlan
  individualSettlementPolicy?: IndividualSettlementPolicy
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })

  return (
    <Card className="mobile-surface mb-4">
      <SettlementCardHeader
        title={t('title')}
        description={t('description')}
        settlementMode={
          currencyDisplay === 'group' && onSettlementModeChange
            ? settlementMode
            : undefined
        }
        onSettlementModeChange={onSettlementModeChange}
      />
      <CardContent className="px-0 pb-5 sm:px-6 sm:pb-6">
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
        ) : settlementMode === 'subgroups' &&
          groupCurrency &&
          subgroups.length > 0 ? (
          <VisualSubgroupSettlement
            groupId={groupId}
            currency={groupCurrency}
            participants={participants}
            settlementPlan={subgroupSettlementPlan}
            onSwitchToIndividual={() => onSettlementModeChange?.('individual')}
          />
        ) : (
          <SettlementSection
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

export function SettlementSection({
  balances,
  reimbursements,
  participants,
  currency,
  groupId,
  includeOriginalCurrency,
  individualSettlementPolicy,
}: {
  balances: Balances
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  groupId: string
  includeOriginalCurrency?: boolean
  individualSettlementPolicy?: IndividualSettlementPolicy
}) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const participantById = new Map(participants.map((p) => [p.id, p]))
  const participantIndex = new Map(participants.map((p, i) => [p.id, i]))

  const getParticipant = (id: string): Participant =>
    participantById.get(id) ?? {
      id,
      name: t('subgroups.unknownParticipant'),
      removed: false,
    }

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
      <SettlementPolicyNote policy={individualSettlementPolicy} />
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
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('direction.settledUp')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {settled.map((participant) => (
              <div
                key={participant.id}
                className="flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 py-1 pr-3 pl-1 text-xs text-muted-foreground"
              >
                <SettlementAvatar
                  members={[participant]}
                  label={participant.name}
                  size="xs"
                />
                <span className="max-w-32 truncate">{participant.name}</span>
                {participant.removed ? <RemovedParticipantBadge /> : null}
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

function SettlementPolicyNote({
  policy,
}: {
  policy?: IndividualSettlementPolicy
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const message =
    policy === 'all-individual'
      ? t('subgroups.individualAllHint')
      : policy === 'within-subgroups'
        ? t('subgroups.individualWithinHint')
        : null
  if (!message) return null

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <Info
        className="mt-0.5 size-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <p>{message}</p>
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
    <section aria-label={title} className="space-y-4">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
          const identity: SettlementIdentity = {
            id: participant.id,
            name: participant.name,
            members: [participant],
            total: direction === 'receive' ? total : -total,
            removed: participant.removed,
          }

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
              participants={participants}
              originalCurrencyCode={
                includeOriginalCurrency ? currency.code : undefined
              }
            >
              {(openFor) => (
                <SettlementGroupCard
                  identity={identity}
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
                  <div className="space-y-3 p-3">
                    <ParticipantSegmentBar
                      rows={rows}
                      currency={currency}
                      locale={locale}
                      showSingleParticipantBar
                    />
                    <SettlementLegList>
                      {legs.map((leg) => {
                        const counterparty = getParticipant(
                          direction === 'receive' ? leg.from : leg.to,
                        )
                        const legAmount = formatCurrency(
                          currency,
                          leg.amount,
                          locale,
                        )
                        return (
                          <SettlementLegRow
                            key={`${leg.from}-${leg.to}`}
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
                                values={{ name: counterparty.name }}
                              />
                            }
                            amount={leg.amount}
                            currency={currency}
                            locale={locale}
                            showRail={false}
                            action={
                              <Button
                                type="button"
                                variant="link"
                                onClick={() => openFor([settlementLegKey(leg)])}
                                className="h-auto shrink-0 p-0 text-xs"
                                aria-label={t(
                                  direction === 'pay'
                                    ? 'direction.settlePaymentsBy'
                                    : 'direction.settlePaymentsTo',
                                  {
                                    count: 1,
                                    name: participant.name,
                                    amount: legAmount,
                                  },
                                )}
                                data-testid={`reimbursement-settle-${direction}-${leg.from}-${leg.to}`}
                              >
                                {t('direction.settle')}
                              </Button>
                            }
                          />
                        )
                      })}
                    </SettlementLegList>
                  </div>
                </SettlementGroupCard>
              )}
            </SettlementGroupActions>
          )
        })}
      </div>
    </section>
  )
}

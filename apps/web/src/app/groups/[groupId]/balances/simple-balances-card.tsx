import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useLocale } from '@/i18n/react'
import type { Balances, Reimbursement } from '@/lib/balances'
import type { Currency } from '@/lib/currency'
import { cn, formatCurrency } from '@/lib/utils'
import type {
  IndividualSettlementPolicy,
  SubgroupDefinition,
  SubgroupSettlementPlan,
} from '@spliit/domain/subgroup-settlements'

import type { BalanceView } from './balance-view-selector'
import { SettlementSection } from './balances-card'
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
  SettlementAvatar,
  type SettlementIdentity,
} from './settlement-ui'
import { SubgroupSettlementCard } from './subgroup-settlement-card'
import { VisualSubgroupSettlement } from './visual-subgroup-settlement'

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
  view = 'simple',
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
  view?: BalanceView
}) {
  const hasDisplayedActivity = isLoading
    ? true
    : currencyDisplay === 'original'
      ? currencyBalances.some(hasActivity)
      : hasActivity({
          balances: balances ?? {},
          reimbursements: reimbursements ?? [],
        }) || Boolean(subgroupSettlementPlan?.hasInternalBalances)

  return (
    <div className="space-y-4">
      <SuggestedPaymentsCard
        isLoading={isLoading}
        participantCount={participantCount}
        currencyDisplay={currencyDisplay}
        balances={balances}
        reimbursements={reimbursements}
        currencyBalances={currencyBalances}
        participants={participants}
        groupCurrency={groupCurrency}
        groupId={groupId}
        settlementMode={settlementMode}
        subgroups={subgroups}
        subgroupSettlementPlan={subgroupSettlementPlan}
        individualSettlementPolicy={individualSettlementPolicy}
        onSwitchToIndividual={() => onSettlementModeChange?.('individual')}
        onSettlementModeChange={onSettlementModeChange}
        view={view}
      />
      {hasDisplayedActivity ? (
        <BalanceOverviewCard
          isLoading={isLoading}
          participantCount={participantCount}
          currencyDisplay={currencyDisplay}
          balances={balances}
          reimbursements={reimbursements}
          currencyBalances={currencyBalances}
          participants={participants}
          groupCurrency={groupCurrency}
          groupId={groupId}
          settlementMode={settlementMode}
          subgroups={subgroups}
          subgroupSettlementPlan={subgroupSettlementPlan}
          onSwitchToIndividual={() => onSettlementModeChange?.('individual')}
        />
      ) : null}
    </div>
  )
}

type BalanceCardProps = {
  isLoading: boolean
  participantCount?: number
  currencyDisplay: 'group' | 'original'
  balances: Balances | undefined
  reimbursements: Reimbursement[] | undefined
  currencyBalances: CurrencyBalance[]
  participants: Participant[]
  groupCurrency: Currency | undefined
  groupId: string
  settlementMode: SettlementMode
  subgroups: SubgroupDefinition[]
  subgroupSettlementPlan?: SubgroupSettlementPlan
  individualSettlementPolicy?: IndividualSettlementPolicy
  onSwitchToIndividual?: () => void
  onSettlementModeChange?: (mode: SettlementMode) => void
}

function SuggestedPaymentsCard({
  isLoading,
  participantCount,
  currencyDisplay,
  balances,
  reimbursements,
  currencyBalances,
  participants,
  groupCurrency,
  groupId,
  settlementMode,
  subgroups,
  subgroupSettlementPlan,
  individualSettlementPolicy,
  onSwitchToIndividual,
  onSettlementModeChange,
  view,
}: BalanceCardProps & {
  view: BalanceView
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const [groupBy, setGroupBy] = useState<SettlementDirection>('pay')

  return (
    <Card className="mobile-surface">
      <SettlementCardHeader
        title={t('simple.suggestedPayments')}
        description={t('Reimbursements.description')}
        settlementMode={
          currencyDisplay === 'group' && onSettlementModeChange
            ? settlementMode
            : undefined
        }
        onSettlementModeChange={onSettlementModeChange}
      />
      <CardContent className="px-0 pb-5 sm:px-6 sm:pb-6">
        {isLoading ? (
          <ReimbursementsLoading participantCount={participantCount} />
        ) : currencyDisplay === 'original' ? (
          <OriginalCurrencyPayments
            view={view}
            currencyBalances={currencyBalances}
            participants={participants}
            groupId={groupId}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
          />
        ) : hasActivity({
            balances: balances ?? {},
            reimbursements: reimbursements ?? [],
          }) || subgroupSettlementPlan?.hasInternalBalances ? (
          <GroupCurrencyPayments
            view={view}
            balances={balances ?? {}}
            reimbursements={reimbursements ?? []}
            participants={participants}
            currency={groupCurrency}
            groupId={groupId}
            settlementMode={settlementMode}
            subgroups={subgroups}
            subgroupSettlementPlan={subgroupSettlementPlan}
            individualSettlementPolicy={individualSettlementPolicy}
            onSwitchToIndividual={onSwitchToIndividual}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
          />
        ) : (
          <SimpleEmptyState />
        )}
      </CardContent>
    </Card>
  )
}

function BalanceOverviewCard({
  isLoading,
  participantCount,
  currencyDisplay,
  balances,
  currencyBalances,
  participants,
  groupCurrency,
  groupId,
  settlementMode,
  subgroups,
  subgroupSettlementPlan,
  onSwitchToIndividual,
}: BalanceCardProps) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const isSubgroupOverview =
    currencyDisplay === 'group' &&
    settlementMode === 'subgroups' &&
    subgroups.length > 0

  return (
    <Card className="mobile-surface">
      <SettlementCardHeader
        title={isSubgroupOverview ? t('subgroups.balanceTitle') : t('title')}
        description={
          isSubgroupOverview
            ? t('subgroups.balanceDescription')
            : t('description')
        }
      />
      <CardContent className="px-0 pb-5 sm:px-6 sm:pb-6">
        {isLoading ? (
          <BalancesLoading participantCount={participantCount} />
        ) : currencyDisplay === 'original' ? (
          <OriginalCurrencyOverview
            currencyBalances={currencyBalances}
            participants={participants}
          />
        ) : settlementMode === 'subgroups' &&
          groupCurrency &&
          subgroups.length > 0 ? (
          <SubgroupSettlementCard
            groupId={groupId}
            currency={groupCurrency}
            participants={participants}
            settlementPlan={subgroupSettlementPlan}
            onSwitchToIndividual={onSwitchToIndividual}
            showPayments={false}
          />
        ) : groupCurrency ? (
          <SimpleBalanceOverviewContent
            balances={balances ?? {}}
            participants={participants}
            currency={groupCurrency}
          />
        ) : (
          <SimpleEmptyState />
        )}
      </CardContent>
    </Card>
  )
}

function SettlementDirectionPicker({
  value,
  onChange,
  className,
}: {
  value: SettlementDirection
  onChange: (value: SettlementDirection) => void
  className?: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })

  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        if (next === 'pay' || next === 'receive') onChange(next)
      }}
      aria-label={t('simple.suggestedPayments')}
      className={cn(
        'inline-flex w-full min-w-0 gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 sm:w-auto sm:min-w-44',
        className,
      )}
    >
      <SettlementDirectionOption
        value="pay"
        selected={value === 'pay'}
        title={t('direction.toPay')}
      />
      <SettlementDirectionOption
        value="receive"
        selected={value === 'receive'}
        title={t('direction.toReceive')}
      />
    </RadioGroup>
  )
}

function SettlementDirectionOption({
  value,
  selected,
  title,
}: {
  value: SettlementDirection
  selected: boolean
  title: string
}) {
  return (
    <label
      className={`group flex min-h-9 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md px-2 py-1 text-xs transition-colors ${selected ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
    >
      <span className="truncate font-medium">{title}</span>
      <RadioGroupItem value={value} className="sr-only" />
    </label>
  )
}

function GroupCurrencyPayments({
  view,
  balances,
  reimbursements,
  participants,
  currency,
  groupId,
  settlementMode,
  subgroups,
  subgroupSettlementPlan,
  individualSettlementPolicy,
  onSwitchToIndividual,
  groupBy,
  onGroupByChange,
}: {
  view: BalanceView
  balances: Balances
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency | undefined
  groupId: string
  settlementMode: SettlementMode
  subgroups: SubgroupDefinition[]
  subgroupSettlementPlan?: SubgroupSettlementPlan
  individualSettlementPolicy?: IndividualSettlementPolicy
  onSwitchToIndividual?: () => void
  groupBy: SettlementDirection
  onGroupByChange: (value: SettlementDirection) => void
}) {
  if (!currency) return <SimpleEmptyState />

  if (settlementMode === 'subgroups' && subgroups.length > 0) {
    return view === 'visual' ? (
      <VisualSubgroupSettlement
        groupId={groupId}
        currency={currency}
        participants={participants}
        settlementPlan={subgroupSettlementPlan}
        onSwitchToIndividual={onSwitchToIndividual}
      />
    ) : (
      <SubgroupSettlementCard
        groupId={groupId}
        currency={currency}
        participants={participants}
        settlementPlan={subgroupSettlementPlan}
        onSwitchToIndividual={onSwitchToIndividual}
        showBalances={false}
      />
    )
  }

  return view === 'visual' ? (
    <SettlementSection
      balances={balances}
      reimbursements={reimbursements}
      participants={participants}
      currency={currency}
      groupId={groupId}
      individualSettlementPolicy={individualSettlementPolicy}
    />
  ) : (
    <SimpleSuggestedPaymentsContent
      balances={balances}
      reimbursements={reimbursements}
      participants={participants}
      currency={currency}
      groupId={groupId}
      individualSettlementPolicy={individualSettlementPolicy}
      groupBy={groupBy}
      onGroupByChange={onGroupByChange}
    />
  )
}

function OriginalCurrencyPayments({
  view,
  currencyBalances,
  participants,
  groupId,
  groupBy,
  onGroupByChange,
}: {
  view: BalanceView
  currencyBalances: CurrencyBalance[]
  participants: Participant[]
  groupId: string
  groupBy: SettlementDirection
  onGroupByChange: (value: SettlementDirection) => void
}) {
  const activeCurrencies = currencyBalances.filter(hasActivity)
  if (activeCurrencies.length === 0) return <SimpleEmptyState />

  return (
    <div className="divide-y-2 divide-border/80">
      {activeCurrencies.map((summary) => (
        <CurrencySection key={summary.currencyCode} currency={summary.currency}>
          {view === 'visual' ? (
            <SettlementSection
              balances={summary.balances}
              reimbursements={summary.reimbursements}
              participants={participants}
              currency={summary.currency}
              groupId={groupId}
              includeOriginalCurrency
            />
          ) : (
            <SimpleSuggestedPaymentsContent
              balances={summary.balances}
              reimbursements={summary.reimbursements}
              participants={participants}
              currency={summary.currency}
              currencyCode={summary.currencyCode}
              groupId={groupId}
              groupBy={groupBy}
              onGroupByChange={onGroupByChange}
            />
          )}
        </CurrencySection>
      ))}
    </div>
  )
}

function OriginalCurrencyOverview({
  currencyBalances,
  participants,
}: {
  currencyBalances: CurrencyBalance[]
  participants: Participant[]
}) {
  const activeCurrencies = currencyBalances.filter(hasActivity)
  if (activeCurrencies.length === 0) return <SimpleEmptyState />

  return (
    <div className="divide-y-2 divide-border/80">
      {activeCurrencies.map((summary) => (
        <CurrencySection key={summary.currencyCode} currency={summary.currency}>
          <SimpleBalanceOverviewContent
            balances={summary.balances}
            participants={participants}
            currency={summary.currency}
          />
        </CurrencySection>
      ))}
    </div>
  )
}

function hasActivity(
  summary: Pick<CurrencyBalance, 'balances' | 'reimbursements'>,
) {
  return (
    summary.reimbursements.length > 0 ||
    Object.values(summary.balances).some((balance) => balance.total !== 0)
  )
}

function SimpleBalanceOverviewContent({
  balances,
  participants,
  currency,
}: {
  balances: Balances
  participants: Participant[]
  currency: Currency
}) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const activeParticipants = participants.filter(
    (participant) => (balances[participant.id]?.total ?? 0) !== 0,
  )

  return (
    <div className="space-y-5">
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
      <SettledParticipants participants={participants} balances={balances} />
    </div>
  )
}

function SimpleSuggestedPaymentsContent({
  balances,
  reimbursements,
  participants,
  currency,
  currencyCode,
  groupId,
  individualSettlementPolicy,
  groupBy = 'pay',
  onGroupByChange,
}: {
  balances: Balances
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  currencyCode?: string
  groupId: string
  individualSettlementPolicy?: IndividualSettlementPolicy
  groupBy?: SettlementDirection
  onGroupByChange: (value: SettlementDirection) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })

  return (
    <div className="space-y-5">
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
        groupBy={groupBy}
        onGroupByChange={onGroupByChange}
      />
    </div>
  )
}

function SettledParticipants({
  participants,
  balances,
}: {
  participants: Participant[]
  balances: Balances
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const settled = participants.filter(
    (participant) => (balances[participant.id]?.total ?? 0) === 0,
  )
  if (settled.length === 0) return null

  return (
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
          </div>
        ))}
      </div>
    </section>
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
  groupBy,
  onGroupByChange,
}: {
  balances: Balances
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  reimbursementCurrencyCode?: string
  groupId: string
  groupBy: SettlementDirection
  onGroupByChange: (value: SettlementDirection) => void
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
  const title =
    groupBy === 'pay' ? t('direction.toPay') : t('direction.toReceive')
  const participantIds = participantIdsWithBalance(
    groupBy === 'pay' ? (total) => total < 0 : (total) => total > 0,
  )
  const groups = buildSettlementGroups(reimbursements, participantIds, groupBy)

  return (
    <section aria-label={title} className="space-y-3">
      <SettlementDirectionPicker
        value={groupBy}
        onChange={onGroupByChange}
        className="w-full sm:w-auto"
      />
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('Reimbursements.noImbursements')}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const participant = participants.find(
              (item) => item.id === group.participantId,
            )
            if (!participant) return null
            const total = sumSettlementLegs(group.legs)
            return (
              <SettlementGroupActions
                key={`${groupBy}-${group.participantId}`}
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
                        i18nKey={`Balances.direction.${groupBy === 'receive' ? 'participantReceives' : 'participantPays'}`}
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
                          item.id === (groupBy === 'pay' ? leg.to : leg.from),
                      )
                      if (!counterparty) return null
                      const counterpartyName = counterparty.name
                      const legAmount = formatCurrency(
                        currency,
                        leg.amount,
                        locale,
                      )
                      const settleAriaLabel = t(
                        groupBy === 'pay'
                          ? 'direction.settlePaymentsBy'
                          : 'direction.settlePaymentsTo',
                        {
                          count: 1,
                          name: participant.name,
                          amount: legAmount,
                        },
                      )
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
                              i18nKey={`Balances.direction.${groupBy === 'receive' ? 'fromParticipant' : 'toParticipant'}`}
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
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto shrink-0 p-0 text-xs"
                              onClick={() => openFor([settlementLegKey(leg)])}
                              aria-label={settleAriaLabel}
                              data-testid={`reimbursement-settle-${groupBy}-${leg.from}-${leg.to}`}
                            >
                              {t('direction.settle')}
                            </Button>
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
      )}
    </section>
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

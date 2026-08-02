import { Check, Info } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CreateReimbursementModal } from '@/app/groups/[groupId]/balances/create-reimbursement-modal'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import type { Currency } from '@/lib/currency'
import {
  type SubgroupSettlementLeg as DomainSubgroupSettlementLeg,
  type SubgroupSettlementPlan,
} from '@spliit/domain/subgroup-settlements'

import {
  SettlementAvatar,
  SettlementBalanceList,
  SettlementGroupCard,
  SettlementLegRow,
  hydrateSettlementUnits,
  type SettlementIdentity,
} from './settlement-ui'

type Participant = {
  id: string
  name: string
  account?: { id: string; name?: string | null; image?: string | null } | null
  removed?: boolean
}

type SubgroupSettlementLeg = DomainSubgroupSettlementLeg & {
  key: string
  fromLabel: string
  toLabel: string
}

type Props = {
  groupId: string
  currency: Currency
  participants: Participant[]
  settlementPlan?: SubgroupSettlementPlan
  onSwitchToIndividual?: () => void
}

export function SubgroupSettlementCard({
  groupId,
  currency,
  participants,
  settlementPlan: serverSettlementPlan,
  onSwitchToIndividual,
}: Props) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const [pendingLeg, setPendingLeg] = useState<SubgroupSettlementLeg | null>(
    null,
  )
  const participantById = useMemo(
    () =>
      new Map(participants.map((participant) => [participant.id, participant])),
    [participants],
  )
  const participantMembers = useCallback(
    (ids: string[]) =>
      ids
        .map((id) => participantById.get(id))
        .filter((participant): participant is Participant =>
          Boolean(participant),
        ),
    [participantById],
  )

  const settlementPlan = serverSettlementPlan ?? {
    units: [],
    legs: [],
    hasInternalBalances: false,
  }
  const unitViews = useMemo(
    () =>
      hydrateSettlementUnits(
        settlementPlan.units,
        participantMembers,
        t('subgroups.unknownParticipant'),
      ),
    [participantMembers, settlementPlan.units, t],
  )

  const subgroupLegs = useMemo<SubgroupSettlementLeg[]>(() => {
    const labelsById = new Map(
      unitViews.map((unit) => [`${unit.kind}:${unit.id}`, unit.name]),
    )

    return settlementPlan.legs.map((leg, index) => {
      return {
        ...leg,
        key: `${leg.from.kind}:${leg.from.id}:${leg.to.kind}:${leg.to.id}:${index}`,
        fromLabel:
          labelsById.get(`${leg.from.kind}:${leg.from.id}`) ??
          t('subgroups.unknownParticipant'),
        toLabel:
          labelsById.get(`${leg.to.kind}:${leg.to.id}`) ??
          t('subgroups.unknownParticipant'),
      }
    })
  }, [settlementPlan.legs, t, unitViews])

  const paymentGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        identity: (typeof unitViews)[number]
        direction: 'pay' | 'receive'
        legs: SubgroupSettlementLeg[]
      }
    >()
    for (const unit of unitViews) {
      const outgoing = subgroupLegs.filter(
        (leg) => leg.from.kind === unit.kind && leg.from.id === unit.id,
      )
      const incoming = subgroupLegs.filter(
        (leg) => leg.to.kind === unit.kind && leg.to.id === unit.id,
      )
      if (outgoing.length > 0) {
        groups.set(`${unit.kind}:${unit.id}:pay`, {
          identity: unit,
          direction: 'pay',
          legs: outgoing,
        })
      }
      if (incoming.length > 0) {
        groups.set(`${unit.kind}:${unit.id}:receive`, {
          identity: unit,
          direction: 'receive',
          legs: incoming,
        })
      }
    }
    return [...groups.values()]
  }, [subgroupLegs, unitViews])

  return (
    <div className="space-y-4" data-testid="subgroup-settlement">
      <section className="space-y-5" aria-label={t('subgroups.balanceTitle')}>
        <div>
          <p className="text-sm font-medium">{t('subgroups.balanceTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('subgroups.balanceDescription')}
          </p>
        </div>

        <SettlementBalanceList
          identities={unitViews}
          currency={currency}
          locale={locale}
          emptyMessage={t('subgroups.emptyBalances')}
          amountLabel={({ amount, isReceiving }) =>
            isReceiving
              ? t('simple.isOwed', { amount })
              : t('simple.owes', { amount })
          }
        />

        {settlementPlan.hasInternalBalances ? (
          <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            <Info
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1">
              {t('subgroups.internalBalancesNote')}{' '}
              {onSwitchToIndividual ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={onSwitchToIndividual}
                >
                  {t('subgroups.viewIndividual')}
                </Button>
              ) : null}
            </p>
          </div>
        ) : null}

        <section
          aria-label={t('subgroups.suggestedPayments')}
          className="space-y-3"
        >
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('subgroups.suggestedPayments')}
          </h3>
          {subgroupLegs.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
              {t('subgroups.emptyPayments')}
            </p>
          ) : (
            <div className="space-y-3">
              {paymentGroups.map((group) => {
                const identity: SettlementIdentity = {
                  id: `${group.identity.kind}:${group.identity.id}`,
                  name: group.identity.name,
                  members: group.identity.members,
                  total: group.identity.total,
                }
                const total = group.legs.reduce(
                  (sum, leg) => sum + leg.amount,
                  0,
                )
                return (
                  <SettlementGroupCard
                    key={`${identity.id}:${group.direction}`}
                    identity={identity}
                    title={
                      <>
                        <strong className="font-semibold text-foreground">
                          {identity.name}
                        </strong>{' '}
                        {group.direction === 'pay'
                          ? t('subgroups.pays')
                          : t('subgroups.receives')}
                      </>
                    }
                    amount={total}
                    currency={currency}
                    locale={locale}
                  >
                    {group.legs.map((leg) => {
                      const counterpartyUnit =
                        group.direction === 'pay' ? leg.to : leg.from
                      const counterpartyMembers = participantMembers(
                        group.direction === 'pay'
                          ? leg.toMemberIds
                          : leg.fromMemberIds,
                      )
                      const counterparty: SettlementIdentity = {
                        id: `${counterpartyUnit.kind}:${counterpartyUnit.id}`,
                        name:
                          group.direction === 'pay'
                            ? leg.toLabel
                            : leg.fromLabel,
                        members: counterpartyMembers,
                        total: 0,
                      }
                      const payerParticipant = participantById.get(leg.payerId)
                      const receiverParticipant = participantById.get(
                        leg.receiverId,
                      )
                      return (
                        <SettlementLegRow
                          key={leg.key}
                          counterparty={counterparty}
                          description={
                            <>
                              {group.direction === 'pay'
                                ? t('subgroups.to')
                                : t('subgroups.from')}{' '}
                              <strong className="font-semibold text-foreground">
                                {counterparty.name}
                              </strong>
                            </>
                          }
                          detail={
                            payerParticipant || receiverParticipant ? (
                              <>
                                {payerParticipant ? (
                                  <>
                                    <SettlementAvatar
                                      members={[payerParticipant]}
                                      label={payerParticipant.name}
                                      size="xs"
                                    />
                                    <span className="min-w-0 font-medium break-words">
                                      {payerParticipant.name}
                                    </span>
                                  </>
                                ) : null}
                                {payerParticipant && receiverParticipant ? (
                                  <span className="px-0.5 text-muted-foreground">
                                    {t('subgroups.personPays')}
                                  </span>
                                ) : null}
                                {receiverParticipant ? (
                                  <>
                                    <SettlementAvatar
                                      members={[receiverParticipant]}
                                      label={receiverParticipant.name}
                                      size="xs"
                                    />
                                    <span className="min-w-0 font-medium break-words">
                                      {receiverParticipant.name}
                                    </span>
                                  </>
                                ) : null}
                              </>
                            ) : null
                          }
                          amount={leg.amount}
                          currency={currency}
                          locale={locale}
                          action={
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto shrink-0 p-0 text-xs"
                              onClick={() => setPendingLeg(leg)}
                            >
                              <Check className="mr-1 size-3.5" />
                              {t('subgroups.settle')}
                            </Button>
                          }
                        />
                      )
                    })}
                  </SettlementGroupCard>
                )
              })}
            </div>
          )}
        </section>
      </section>

      {pendingLeg && (
        <CreateReimbursementModal
          groupId={groupId}
          reimbursement={{
            from: pendingLeg.payerId,
            to: pendingLeg.receiverId,
            amount: pendingLeg.amount,
          }}
          currency={currency}
          participants={participants}
          open
          onOpenChange={(open) => {
            if (!open) setPendingLeg(null)
          }}
        />
      )}
    </div>
  )
}

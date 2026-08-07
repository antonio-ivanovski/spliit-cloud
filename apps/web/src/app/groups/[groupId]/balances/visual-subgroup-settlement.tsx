import { Check, Info } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CreateReimbursementModal } from '@/app/groups/[groupId]/balances/create-reimbursement-modal'
import { ParticipantSegmentBar } from '@/components/participant-segment-bar'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import type { Currency } from '@/lib/currency'
import {
  type SubgroupSettlementPlan,
  type SubgroupSettlementLeg,
} from '@spliit/domain/subgroup-settlements'

import {
  SettlementAvatar,
  SettlementGroupCard,
  SettlementLegList,
  SettlementLegRow,
  hydrateSettlementUnits,
  type SettlementIdentity,
  type SettlementParticipant,
} from './settlement-ui'

type Participant = SettlementParticipant

type Props = {
  groupId: string
  currency: Currency
  participants: Participant[]
  settlementPlan?: SubgroupSettlementPlan
  onSwitchToIndividual?: () => void
}

type VisualLeg = SubgroupSettlementLeg & { key: string }

export function VisualSubgroupSettlement({
  groupId,
  currency,
  participants,
  settlementPlan: serverSettlementPlan,
  onSwitchToIndividual,
}: Props) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const [pendingLeg, setPendingLeg] = useState<VisualLeg | null>(null)
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

  const plan = serverSettlementPlan ?? {
    units: [],
    legs: [],
    hasInternalBalances: false,
  }
  const unitViews = useMemo(
    () =>
      hydrateSettlementUnits(
        plan.units,
        participantMembers,
        t('subgroups.unknownParticipant'),
      ),
    [participantMembers, plan.units, t],
  )
  const unitByKey = useMemo(
    () =>
      new Map(
        unitViews.map((unit) => [`${unit.kind}:${unit.id}`, unit] as const),
      ),
    [unitViews],
  )
  const legs = useMemo<VisualLeg[]>(
    () =>
      plan.legs.map((leg, index) => ({
        ...leg,
        key: `${leg.from.kind}:${leg.from.id}:${leg.to.kind}:${leg.to.id}:${index}`,
      })),
    [plan.legs],
  )

  return (
    <div className="space-y-6" data-testid="visual-subgroup-settlement">
      {plan.hasInternalBalances ? (
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

      {legs.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          {t('subgroups.emptyPayments')}
        </p>
      ) : (
        <div className="space-y-8" data-testid="visual-subgroup-legs">
          <VisualSubgroupDirection
            direction="receive"
            units={unitViews}
            legs={legs}
            unitByKey={unitByKey}
            currency={currency}
            locale={locale}
            onSettle={setPendingLeg}
          />
          <VisualSubgroupDirection
            direction="pay"
            units={unitViews}
            legs={legs}
            unitByKey={unitByKey}
            currency={currency}
            locale={locale}
            onSettle={setPendingLeg}
          />
        </div>
      )}

      {pendingLeg ? (
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
      ) : null}
    </div>
  )
}

function VisualSubgroupDirection({
  direction,
  units,
  legs,
  unitByKey,
  currency,
  locale,
  onSettle,
}: {
  direction: 'pay' | 'receive'
  units: ReturnType<typeof hydrateSettlementUnits>
  legs: VisualLeg[]
  unitByKey: Map<string, ReturnType<typeof hydrateSettlementUnits>[number]>
  currency: Currency
  locale: string
  onSettle: (leg: VisualLeg) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const activeUnits = units.filter((unit) =>
    direction === 'receive' ? unit.total > 0 : unit.total < 0,
  )
  if (activeUnits.length === 0) return null

  return (
    <section
      aria-label={t(
        direction === 'receive' ? 'direction.toReceive' : 'direction.toPay',
      )}
      className="space-y-4"
    >
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t(direction === 'receive' ? 'direction.toReceive' : 'direction.toPay')}
      </h3>
      <p className="-mt-2 text-xs leading-snug text-muted-foreground/70">
        {t(
          direction === 'receive'
            ? 'direction.toReceiveDescription'
            : 'direction.toPayDescription',
        )}
      </p>
      <div className="space-y-5">
        {activeUnits.map((unit) => {
          const unitKey = `${unit.kind}:${unit.id}`
          const unitLegs = legs.filter((leg) =>
            direction === 'receive'
              ? `${leg.to.kind}:${leg.to.id}` === unitKey
              : `${leg.from.kind}:${leg.from.id}` === unitKey,
          )
          if (unitLegs.length === 0) return null
          const total = unitLegs.reduce((sum, leg) => sum + leg.amount, 0)
          const identity: SettlementIdentity = {
            id: unitKey,
            name: unit.name,
            members: unit.members,
            total: unit.total,
            removed: unit.members.some((member) => member.removed),
          }
          const segmentRows = unitLegs.flatMap((leg, index) => {
            const counterparty = unitByKey.get(
              direction === 'receive'
                ? `${leg.from.kind}:${leg.from.id}`
                : `${leg.to.kind}:${leg.to.id}`,
            )
            return counterparty
              ? [
                  {
                    id: leg.key,
                    name: counterparty.name,
                    amount: leg.amount,
                    participant: counterparty.members[0],
                    colorIndex: index,
                  },
                ]
              : []
          })

          return (
            <SettlementGroupCard
              key={`${unitKey}:${direction}`}
              identity={identity}
              title={
                <>
                  <strong className="font-semibold text-foreground">
                    {unit.name}
                  </strong>{' '}
                  {t(
                    direction === 'receive'
                      ? 'subgroups.receives'
                      : 'subgroups.pays',
                  )}
                </>
              }
              amount={total}
              currency={currency}
              locale={locale}
            >
              <div className="space-y-3 p-3">
                <ParticipantSegmentBar
                  rows={segmentRows}
                  currency={currency}
                  locale={locale}
                  showAvatars={false}
                  showSingleParticipantBar
                />
                <SettlementLegList>
                  {unitLegs.map((leg) => {
                    const counterparty = unitByKey.get(
                      direction === 'receive'
                        ? `${leg.from.kind}:${leg.from.id}`
                        : `${leg.to.kind}:${leg.to.id}`,
                    )
                    if (!counterparty) return null
                    const detailPayer = unitByKey
                      .get(`${leg.from.kind}:${leg.from.id}`)
                      ?.members.find((member) => member.id === leg.payerId)
                    const detailReceiver = unitByKey
                      .get(`${leg.to.kind}:${leg.to.id}`)
                      ?.members.find((member) => member.id === leg.receiverId)

                    return (
                      <SettlementLegRow
                        key={leg.key}
                        counterparty={{
                          id: `${counterparty.kind}:${counterparty.id}`,
                          name: counterparty.name,
                          members: counterparty.members,
                          total: 0,
                        }}
                        description={
                          <>
                            {t(
                              direction === 'receive'
                                ? 'subgroups.from'
                                : 'subgroups.to',
                            )}{' '}
                            <strong className="font-semibold text-foreground">
                              {counterparty.name}
                            </strong>
                          </>
                        }
                        detail={
                          detailPayer || detailReceiver ? (
                            <>
                              {detailPayer ? (
                                <>
                                  <SettlementAvatar
                                    members={[detailPayer]}
                                    label={detailPayer.name}
                                    size="xs"
                                  />
                                  <span className="min-w-0 font-medium break-words">
                                    {detailPayer.name}
                                  </span>
                                </>
                              ) : null}
                              {detailPayer && detailReceiver ? (
                                <span className="px-0.5 text-muted-foreground">
                                  {t('subgroups.personPays')}
                                </span>
                              ) : null}
                              {detailReceiver ? (
                                <>
                                  <SettlementAvatar
                                    members={[detailReceiver]}
                                    label={detailReceiver.name}
                                    size="xs"
                                  />
                                  <span className="min-w-0 font-medium break-words">
                                    {detailReceiver.name}
                                  </span>
                                </>
                              ) : null}
                            </>
                          ) : null
                        }
                        amount={leg.amount}
                        currency={currency}
                        locale={locale}
                        showRail={false}
                        action={
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto shrink-0 p-0 text-xs"
                            onClick={() => onSettle(leg)}
                          >
                            <Check className="me-1 size-3.5" />
                            {t('subgroups.settle')}
                          </Button>
                        }
                      />
                    )
                  })}
                </SettlementLegList>
              </div>
            </SettlementGroupCard>
          )
        })}
      </div>
    </section>
  )
}

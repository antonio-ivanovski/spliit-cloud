import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Balances, Reimbursement } from '@/lib/balances'
import { getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type {
  SubgroupDefinition,
  SubgroupSettlementPlan,
} from '@spliit/domain/subgroup-settlements'

import { useCurrentGroup } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { BalanceViewSelector, type BalanceView } from './balance-view-selector'
import { withDisplayCurrencies } from './currency-balances'
import { CurrencyDisplaySelector } from './currency-display-selector'
import { SimpleBalancesCard } from './simple-balances-card'

const balancesRoute = getRouteApi('/groups/$groupId/balances')

type BalanceParticipant = {
  id: string
  name: string
  account?: { id: string; name?: string | null; image?: string | null } | null
  removed?: boolean
}

type CurrencyBalanceBucket = {
  balances: Balances
  reimbursements: Reimbursement[]
}

function mergeBalanceParticipants(
  groupParticipants: BalanceParticipant[],
  balanceParticipants:
    | Array<{ id: string; name: string; removed?: boolean }>
    | undefined,
): BalanceParticipant[] {
  if (!balanceParticipants?.length) return groupParticipants
  const byId = new Map(groupParticipants.map((p) => [p.id, { ...p }]))
  for (const participant of balanceParticipants) {
    const existing = byId.get(participant.id)
    if (!existing) {
      byId.set(participant.id, {
        id: participant.id,
        name: participant.name,
        account: null,
        removed: participant.removed,
      })
      continue
    }
    if (participant.removed) existing.removed = true
    if (participant.name.trim()) {
      // The balances endpoint resolves the current invitation, including its
      // temporary name. Prefer that live value over the cached group summary
      // so settlement units never fall back to a participant id.
      existing.name = participant.name
    }
  }
  return Array.from(byId.values())
}

function appearsOnReimbursementLeg(
  participantId: string,
  reimbursements: Reimbursement[] | undefined,
): boolean {
  return (
    reimbursements?.some(
      (leg) => leg.from === participantId || leg.to === participantId,
    ) ?? false
  )
}

/** Keep soft-removed people only when they still matter for settlement UI. */
function hasUnsettledBalance(
  participantId: string,
  balances: Balances | undefined,
  reimbursements: Reimbursement[] | undefined,
  currencyBalances: CurrencyBalanceBucket[] | undefined,
): boolean {
  if ((balances?.[participantId]?.total ?? 0) !== 0) return true
  if (appearsOnReimbursementLeg(participantId, reimbursements)) return true
  for (const bucket of currencyBalances ?? []) {
    if ((bucket.balances[participantId]?.total ?? 0) !== 0) return true
    if (appearsOnReimbursementLeg(participantId, bucket.reimbursements)) {
      return true
    }
  }
  return false
}

export default function BalancesAndReimbursements() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const utils = trpc.useUtils()
  const { groupId, group } = useCurrentGroup()
  const {
    currencyDisplay = 'group',
    view: viewParam,
    settlementMode: settlementModeParam,
  } = balancesRoute.useSearch()
  const navigate = useNavigate()
  const [storedView, setStoredView] = useState<BalanceView>('simple')
  const settlementMode = settlementModeParam ?? 'individual'
  const linkInviteToken = useLinkInviteToken()
  const { data: balancesData, isLoading: balancesAreLoading } =
    trpc.groups.balances.list.useQuery({
      groupId,
      linkInviteToken,
    })
  const { data: subgroupsData, isLoading: subgroupsAreLoading } =
    trpc.groups.subgroups.list.useQuery({ groupId, linkInviteToken })

  useEffect(() => {
    // Until we use tRPC more widely and can invalidate the cache on expense
    // update, it's easier and safer to invalidate the cache on page load.
    void utils.groups.balances.invalidate()
  }, [utils])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('spliit-balances-view')
      if (saved === 'simple' || saved === 'visual') {
        // oxlint-disable-next-line react/react-compiler -- restore the persisted view after reading browser storage.
        setStoredView(saved)
      }
    } catch {
      // Private browsing and disabled storage should not block the balances page.
    }
  }, [])

  const participants = useMemo(() => {
    const merged = mergeBalanceParticipants(
      group?.participants ?? [],
      balancesData?.participants,
    )
    if (!balancesData) return merged
    return merged.filter(
      (participant) =>
        !participant.removed ||
        hasUnsettledBalance(
          participant.id,
          balancesData.balances,
          balancesData.reimbursements,
          balancesData.currencyBalances,
        ),
    )
  }, [group?.participants, balancesData])

  const isLoading =
    balancesAreLoading || subgroupsAreLoading || !balancesData || !group
  const groupCurrency = group ? getCurrencyFromGroup(group) : undefined
  const currencyBalances =
    !isLoading && groupCurrency
      ? withDisplayCurrencies(balancesData.currencyBalances, groupCurrency)
      : []
  const view = viewParam ?? storedView
  const settlementSubgroups = useMemo<SubgroupDefinition[]>(
    () =>
      subgroupsData?.enabled
        ? subgroupsData.subgroups.map((subgroup) => ({
            id: subgroup.id,
            name: subgroup.name,
            memberIds: subgroup.participantIds,
          }))
        : [],
    [subgroupsData],
  )
  const canUseSubgroupSettlement =
    !isLoading &&
    subgroupsData?.enabled === true &&
    settlementSubgroups.length > 0 &&
    Boolean(groupCurrency)
  const settlementBalances = balancesData?.balances
  const subgroupSettlementPlan = balancesData?.settlement.subgroup as
    | SubgroupSettlementPlan
    | undefined
  const individualSettlementPlan = balancesData?.settlement.individual ?? {
    reimbursements: balancesData?.reimbursements ?? [],
    policy: 'standard' as const,
  }

  const changeView = (next: BalanceView) => {
    setStoredView(next)
    try {
      window.localStorage.setItem('spliit-balances-view', next)
    } catch {
      // The URL remains the source of truth when storage is unavailable.
    }
    void navigate({
      to: '/groups/$groupId/balances',
      params: { groupId },
      replace: true,
      search: {
        currencyDisplay,
        view: next,
        settlementMode,
      },
    })
  }

  const changeCurrency = (next: 'group' | 'original') => {
    void navigate({
      to: '/groups/$groupId/balances',
      params: { groupId },
      replace: true,
      search: {
        currencyDisplay: next,
        view,
        settlementMode,
      },
    })
  }

  const changeSettlementMode = (next: 'individual' | 'subgroups') => {
    void navigate({
      to: '/groups/$groupId/balances',
      params: { groupId },
      replace: true,
      search: {
        currencyDisplay,
        view,
        settlementMode: next,
      },
    })
  }

  return (
    <>
      <div className="mb-3 grid w-full min-w-0 gap-3 sm:mb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <BalanceViewSelector value={view} onChange={changeView} />
        <CurrencyDisplaySelector
          value={currencyDisplay}
          groupCurrency={groupCurrency}
          onChange={changeCurrency}
        />
      </div>
      {currencyDisplay === 'original' && (
        <p
          className="mb-3 border-s-2 border-primary/40 ps-3 text-sm text-muted-foreground sm:mb-4"
          role="note"
        >
          {t('currencyDisplay.originalNote')}
        </p>
      )}
      <SimpleBalancesCard
        isLoading={isLoading}
        participantCount={participants.length}
        currencyDisplay={currencyDisplay}
        balances={settlementBalances}
        reimbursements={
          currencyDisplay === 'group'
            ? individualSettlementPlan.reimbursements
            : undefined
        }
        currencyBalances={currencyBalances}
        participants={participants}
        groupCurrency={groupCurrency}
        groupId={groupId}
        settlementMode={settlementMode}
        onSettlementModeChange={
          canUseSubgroupSettlement ? changeSettlementMode : undefined
        }
        subgroups={settlementSubgroups}
        subgroupSettlementPlan={subgroupSettlementPlan}
        individualSettlementPolicy={individualSettlementPlan.policy}
        view={view}
      />
    </>
  )
}

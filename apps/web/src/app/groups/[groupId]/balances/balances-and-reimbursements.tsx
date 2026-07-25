import type { Balances, Reimbursement } from '@/lib/balances'
import { getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { BalanceViewSelector, type BalanceView } from './balance-view-selector'
import { BalancesCard } from './balances-card'
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
    Array<{ id: string; name: string; removed?: boolean }> | undefined,
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
    } else if (participant.removed) {
      existing.removed = true
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
  const { currencyDisplay = 'group', view: viewParam } =
    balancesRoute.useSearch()
  const navigate = useNavigate()
  const [storedView, setStoredView] = useState<BalanceView>('simple')
  const linkInviteToken = useLinkInviteToken()
  const { data: balancesData, isLoading: balancesAreLoading } =
    trpc.groups.balances.list.useQuery({
      groupId,
      linkInviteToken,
    })

  useEffect(() => {
    // Until we use tRPC more widely and can invalidate the cache on expense
    // update, it's easier and safer to invalidate the cache on page load.
    utils.groups.balances.invalidate()
  }, [utils])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('spliit-balances-view')
      if (saved === 'simple' || saved === 'visual') setStoredView(saved)
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

  const isLoading = balancesAreLoading || !balancesData || !group
  const groupCurrency = group ? getCurrencyFromGroup(group) : undefined
  const currencyBalances =
    !isLoading && groupCurrency
      ? withDisplayCurrencies(balancesData.currencyBalances, groupCurrency)
      : []
  const view = viewParam ?? storedView

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
      search: { currencyDisplay, view: next },
    })
  }

  const changeCurrency = (next: 'group' | 'original') => {
    void navigate({
      to: '/groups/$groupId/balances',
      params: { groupId },
      replace: true,
      search: { currencyDisplay: next, view },
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
          className="mb-3 border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground sm:mb-4"
          role="note"
        >
          {t('currencyDisplay.originalNote')}
        </p>
      )}
      {view === 'simple' ? (
        <SimpleBalancesCard
          isLoading={isLoading}
          participantCount={participants.length}
          currencyDisplay={currencyDisplay}
          balances={balancesData?.balances}
          reimbursements={balancesData?.reimbursements}
          currencyBalances={currencyBalances}
          participants={participants}
          groupCurrency={groupCurrency}
          groupId={groupId}
        />
      ) : (
        <BalancesCard
          isLoading={isLoading}
          participantCount={participants.length}
          currencyDisplay={currencyDisplay}
          balances={balancesData?.balances}
          reimbursements={balancesData?.reimbursements}
          currencyBalances={currencyBalances}
          participants={participants}
          groupCurrency={groupCurrency}
          groupId={groupId}
        />
      )}
    </>
  )
}

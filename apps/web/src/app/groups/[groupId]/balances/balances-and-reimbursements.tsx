import { getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useCurrentGroup } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { BalanceViewSelector, type BalanceView } from './balance-view-selector'
import { BalancesCard } from './balances-card'
import { withDisplayCurrencies } from './currency-balances'
import { CurrencyDisplaySelector } from './currency-display-selector'
import { SimpleBalancesCard } from './simple-balances-card'

const balancesRoute = getRouteApi('/groups/$groupId/balances')

export default function BalancesAndReimbursements() {
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
      {view === 'simple' ? (
        <SimpleBalancesCard
          isLoading={isLoading}
          participantCount={group?.participants.length}
          currencyDisplay={currencyDisplay}
          balances={balancesData?.balances}
          reimbursements={balancesData?.reimbursements}
          currencyBalances={currencyBalances}
          participants={group?.participants ?? []}
          groupCurrency={groupCurrency}
          groupId={groupId}
        />
      ) : (
        <BalancesCard
          isLoading={isLoading}
          participantCount={group?.participants.length}
          currencyDisplay={currencyDisplay}
          balances={balancesData?.balances}
          reimbursements={balancesData?.reimbursements}
          currencyBalances={currencyBalances}
          participants={group?.participants ?? []}
          groupCurrency={groupCurrency}
          groupId={groupId}
        />
      )}
    </>
  )
}

import { getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useCurrentGroup } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { BalancesCard } from './balances-card'
import { withDisplayCurrencies } from './currency-balances'
import { CurrencyDisplaySelector } from './currency-display-selector'
import { ReimbursementsCard } from './reimbursements-card'

const balancesRoute = getRouteApi('/groups/$groupId/balances')

export default function BalancesAndReimbursements() {
  const utils = trpc.useUtils()
  const { groupId, group } = useCurrentGroup()
  const { currencyDisplay = 'group' } = balancesRoute.useSearch()
  const navigate = useNavigate()
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

  const isLoading = balancesAreLoading || !balancesData || !group
  const groupCurrency = group ? getCurrencyFromGroup(group) : undefined
  const currencyBalances =
    !isLoading && groupCurrency
      ? withDisplayCurrencies(balancesData.currencyBalances, groupCurrency)
      : []

  return (
    <>
      <CurrencyDisplaySelector
        value={currencyDisplay}
        groupCurrency={group?.currency}
        onChange={(value) => {
          void navigate({
            to: '/groups/$groupId/balances',
            params: { groupId },
            search: { currencyDisplay: value },
          })
        }}
      />
      <BalancesCard
        isLoading={isLoading}
        participantCount={group?.participants.length}
        currencyDisplay={currencyDisplay}
        balances={balancesData?.balances}
        currencyBalances={currencyBalances}
        participants={group?.participants ?? []}
        groupCurrency={groupCurrency}
      />
      <ReimbursementsCard
        isLoading={isLoading}
        participantCount={group?.participants.length}
        currencyDisplay={currencyDisplay}
        reimbursements={balancesData?.reimbursements}
        currencyBalances={currencyBalances}
        participants={group?.participants ?? []}
        groupCurrency={groupCurrency}
        groupId={groupId}
      />
    </>
  )
}

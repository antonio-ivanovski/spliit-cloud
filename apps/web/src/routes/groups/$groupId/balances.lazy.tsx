import { createLazyFileRoute } from '@tanstack/react-router'

import BalancesAndSettlements from '@/app/groups/[groupId]/balances/balances-and-settlements'

export const Route = createLazyFileRoute('/groups/$groupId/balances')({
  component: BalancesAndSettlements,
})

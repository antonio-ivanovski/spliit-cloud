import { createLazyFileRoute } from '@tanstack/react-router'

import BalancesAndReimbursements from '@/app/groups/[groupId]/balances/balances-and-reimbursements'

export const Route = createLazyFileRoute('/groups/$groupId/balances')({
  component: BalancesAndReimbursements,
})

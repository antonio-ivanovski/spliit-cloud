import BalancesAndReimbursements from '@/app/groups/[groupId]/balances/balances-and-reimbursements'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/groups/$groupId/balances')({
  component: BalancesAndReimbursements,
})

import { createLazyFileRoute } from '@tanstack/react-router'

// The expense list lives on the parent `/groups/$groupId/expenses` layout so it
// stays mounted while the view-expense modal opens and closes.
function ExpensesIndexRoute() {
  return null
}

export const Route = createLazyFileRoute('/groups/$groupId/expenses/')({
  component: ExpensesIndexRoute,
})

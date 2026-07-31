import { createLazyFileRoute } from '@tanstack/react-router'

import GlobalExpensesPage from '@/app/expenses/page'

export const Route = createLazyFileRoute('/expenses')({
  component: GlobalExpensesPage,
})

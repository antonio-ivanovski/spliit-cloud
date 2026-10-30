import { createLazyFileRoute } from '@tanstack/react-router'

import { PersonalBudgetsPage } from '@/app/personal/page-budgets'

export const Route = createLazyFileRoute('/personal/budgets')({
  component: PersonalBudgetsPage,
})

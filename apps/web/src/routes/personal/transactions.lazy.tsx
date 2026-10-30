import { createLazyFileRoute } from '@tanstack/react-router'

import { PersonalTransactionsPage } from '@/app/personal/page-transactions'

export const Route = createLazyFileRoute('/personal/transactions')({
  component: PersonalTransactionsPage,
})

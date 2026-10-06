import { createLazyFileRoute } from '@tanstack/react-router'

import { AccountDeletionPage } from '@/app/account/account-deletion-page'
export const Route = createLazyFileRoute('/account/delete')({
  component: AccountDeletionPage,
})

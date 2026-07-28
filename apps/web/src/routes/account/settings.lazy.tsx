import { createLazyFileRoute } from '@tanstack/react-router'

import { AccountSettingsPage } from '@/app/account/settings'

export const Route = createLazyFileRoute('/account/settings')({
  component: AccountSettingsPage,
})

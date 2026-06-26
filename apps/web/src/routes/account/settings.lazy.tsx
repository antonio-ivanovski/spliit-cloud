import { AccountSettingsPage } from '@/app/account/settings'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/account/settings')({
  component: AccountSettingsPage,
})

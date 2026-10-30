import { createLazyFileRoute } from '@tanstack/react-router'

import { PersonalSettingsPage } from '@/app/personal/page-settings'

export const Route = createLazyFileRoute('/personal/settings')({
  component: PersonalSettingsPage,
})

import { createLazyFileRoute } from '@tanstack/react-router'

import { PersonalRecurringPage } from '@/app/personal/page-recurring'

export const Route = createLazyFileRoute('/personal/recurring')({
  component: PersonalRecurringPage,
})

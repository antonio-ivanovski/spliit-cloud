import { createLazyFileRoute } from '@tanstack/react-router'

import { RecoverAnonymousAccountPage } from '@/app/auth/recover-anonymous'

export const Route = createLazyFileRoute('/auth/recover')({
  component: RecoverAnonymousAccountPage,
})

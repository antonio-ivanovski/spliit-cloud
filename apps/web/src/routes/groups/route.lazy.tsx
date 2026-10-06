import {
  createLazyFileRoute,
  Outlet,
  useLocation,
} from '@tanstack/react-router'
import { Suspense } from 'react'

import { PageShell } from '@/components/layout/page-shell'
import { RequireAuth } from '@/components/require-auth'

function GroupsLayoutRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const bulkCategorize = pathname.startsWith('/groups/bulk-categorize/')
  return (
    <Suspense>
      <RequireAuth>
        <PageShell
          width={bulkCategorize ? 'lg' : 'md'}
          className={`flex-col gap-3 py-4 sm:gap-6 sm:py-6 ${bulkCategorize ? '' : 'overflow-x-hidden'}`}
        >
          <Outlet />
        </PageShell>
      </RequireAuth>
    </Suspense>
  )
}

export const Route = createLazyFileRoute('/groups')({
  component: GroupsLayoutRoute,
})

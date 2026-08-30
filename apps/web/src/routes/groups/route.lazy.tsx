import { createLazyFileRoute, Outlet } from '@tanstack/react-router'
import { Suspense } from 'react'

import { PageShell } from '@/components/layout/page-shell'
import { RequireAuth } from '@/components/require-auth'

function GroupsLayoutRoute() {
  return (
    <Suspense>
      <RequireAuth>
        <PageShell className="flex-col gap-3 overflow-x-hidden py-4 sm:gap-6 sm:py-6">
          <Outlet />
        </PageShell>
      </RequireAuth>
    </Suspense>
  )
}

export const Route = createLazyFileRoute('/groups')({
  component: GroupsLayoutRoute,
})

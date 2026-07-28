import { createLazyFileRoute, Outlet } from '@tanstack/react-router'
import { Suspense } from 'react'

import { RequireAuth } from '@/components/require-auth'

function GroupsLayoutRoute() {
  return (
    <Suspense>
      <RequireAuth>
        <main className="mx-auto flex w-full max-w-(--breakpoint-md) min-w-0 flex-1 flex-col gap-3 overflow-x-hidden px-4 py-4 sm:gap-6 sm:py-6">
          <Outlet />
        </main>
      </RequireAuth>
    </Suspense>
  )
}

export const Route = createLazyFileRoute('/groups')({
  component: GroupsLayoutRoute,
})

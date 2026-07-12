import { RequireAuth } from '@/components/require-auth'
import { createLazyFileRoute, Outlet } from '@tanstack/react-router'
import { Suspense } from 'react'

function GroupsLayoutRoute() {
  return (
    <Suspense>
      <RequireAuth>
        <main className="flex-1 min-w-0 max-w-(--breakpoint-md) w-full mx-auto overflow-x-hidden px-4 py-4 sm:py-6 flex flex-col gap-3 sm:gap-6">
          <Outlet />
        </main>
      </RequireAuth>
    </Suspense>
  )
}

export const Route = createLazyFileRoute('/groups')({
  component: GroupsLayoutRoute,
})

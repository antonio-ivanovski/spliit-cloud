import { RequireAuth } from '@/components/require-auth'
import { createLazyFileRoute, Outlet } from '@tanstack/react-router'
import { Suspense } from 'react'

function GroupsLayoutRoute() {
  return (
    <Suspense>
      <RequireAuth>
        <main className="flex-1 max-w-(--breakpoint-md) w-full mx-auto px-4 py-6 flex flex-col gap-6">
          <Outlet />
        </main>
      </RequireAuth>
    </Suspense>
  )
}

export const Route = createLazyFileRoute('/groups')({
  component: GroupsLayoutRoute,
})

import { CreateGroup } from '@/app/groups/create/create-group'
import { RequireAuth } from '@/components/require-auth'
import { createLazyFileRoute } from '@tanstack/react-router'

function CreateGroupRoute() {
  return (
    <RequireAuth>
      <main className="flex-1 max-w-(--breakpoint-md) w-full mx-auto px-4 py-6 flex flex-col gap-6">
        <CreateGroup />
      </main>
    </RequireAuth>
  )
}

export const Route = createLazyFileRoute('/groups/create')({
  component: CreateGroupRoute,
})

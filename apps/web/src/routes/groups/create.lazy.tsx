import { createLazyFileRoute } from '@tanstack/react-router'

import { CreateGroup } from '@/app/groups/create/create-group'
import { RequireAuth } from '@/components/require-auth'

function CreateGroupRoute() {
  return (
    <RequireAuth>
      <div className="flex w-full flex-col gap-6">
        <CreateGroup />
      </div>
    </RequireAuth>
  )
}

export const Route = createLazyFileRoute('/groups/create')({
  component: CreateGroupRoute,
})

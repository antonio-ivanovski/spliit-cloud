import { createLazyFileRoute } from '@tanstack/react-router'

import { CreateFriend } from '@/app/friends/create/create-friend'
import { PageShell } from '@/components/layout/page-shell'
import { RequireAuth } from '@/components/require-auth'

function CreateFriendRoute() {
  return (
    <RequireAuth>
      <PageShell className="flex-col gap-3 overflow-x-hidden py-4 sm:gap-6 sm:py-6">
        <div className="flex w-full flex-col gap-6">
          <CreateFriend />
        </div>
      </PageShell>
    </RequireAuth>
  )
}

export const Route = createLazyFileRoute('/friends/create')({
  component: CreateFriendRoute,
})

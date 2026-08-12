import { createLazyFileRoute } from '@tanstack/react-router'

import { CreateFriend } from '@/app/friends/create/create-friend'
import { RequireAuth } from '@/components/require-auth'

function CreateFriendRoute() {
  return (
    <RequireAuth>
      <main className="mx-auto flex w-full max-w-(--breakpoint-md) min-w-0 flex-1 flex-col gap-3 overflow-x-hidden px-4 py-4 sm:gap-6 sm:py-6">
        <div className="flex w-full flex-col gap-6">
          <CreateFriend />
        </div>
      </main>
    </RequireAuth>
  )
}

export const Route = createLazyFileRoute('/friends/create')({
  component: CreateFriendRoute,
})

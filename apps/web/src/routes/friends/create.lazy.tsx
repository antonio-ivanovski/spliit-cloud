import { createLazyFileRoute } from '@tanstack/react-router'

import { CreateFriend } from '@/app/friends/create/create-friend'
import { RequireAuth } from '@/components/require-auth'

function CreateFriendRoute() {
  return (
    <RequireAuth>
      <div className="flex w-full flex-col gap-6">
        <CreateFriend />
      </div>
    </RequireAuth>
  )
}

export const Route = createLazyFileRoute('/friends/create')({
  component: CreateFriendRoute,
})

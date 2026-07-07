import { CreateFriend } from '@/app/friends/create/create-friend'
import { RequireAuth } from '@/components/require-auth'
import { createLazyFileRoute } from '@tanstack/react-router'

function CreateFriendRoute() {
  return (
    <RequireAuth>
      <main className="flex-1 max-w-(--breakpoint-md) w-full mx-auto px-4 py-6 flex flex-col gap-6">
        <CreateFriend />
      </main>
    </RequireAuth>
  )
}

export const Route = createLazyFileRoute('/friends/create')({
  component: CreateFriendRoute,
})

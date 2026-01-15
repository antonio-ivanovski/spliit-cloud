import { UnifiedGroupList } from '@/app/groups/unified-group-list'
import { auth } from '@/lib/auth'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Groups',
}

export default async function GroupsPage() {
  const session = await auth()

  // Both authenticated and anonymous users use the same unified list
  // Authenticated groups only appear for authenticated users
  return <UnifiedGroupList isAuthenticated={!!session?.user} />
}

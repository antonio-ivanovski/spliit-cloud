import { JoinGroupCard } from '@/components/groups/join-group-card'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { verifyInviteToken } from '@/lib/invite-links'
import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Join Group',
}

export default async function JoinGroupPage({
  params,
}: {
  params: { token: string }
}) {
  const session = await auth()

  if (!session?.user) {
    // Redirect to sign-in with return URL
    redirect(`/auth/signin?callbackUrl=/groups/join/${params.token}`)
  }

  let groupId: string
  let error: string | null = null

  try {
    const payload = verifyInviteToken(params.token)
    groupId = payload.groupId
  } catch (err) {
    error = err instanceof Error ? err.message : 'Invalid invite link'
    return (
      <main className="container flex min-h-screen items-center justify-center">
        <JoinGroupCard error={error} />
      </main>
    )
  }

  // Check if group exists
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, name: true },
  })

  if (!group) {
    return (
      <main className="container flex min-h-screen items-center justify-center">
        <JoinGroupCard error="Group not found" />
      </main>
    )
  }

  // Check if user is already a member
  const existingMembership = await prisma.userGroup.findUnique({
    where: {
      userId_groupId: {
        userId: session.user.id,
        groupId: group.id,
      },
    },
  })

  if (existingMembership) {
    // Already a member, redirect to group
    redirect(`/groups/${group.id}`)
  }

  return (
    <main className="container flex min-h-screen items-center justify-center">
      <JoinGroupCard group={group} token={params.token} />
    </main>
  )
}

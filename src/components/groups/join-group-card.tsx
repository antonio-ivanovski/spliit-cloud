'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { trpc } from '@/trpc/client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface JoinGroupCardProps {
  group?: { id: string; name: string }
  token?: string
  error?: string
}

export function JoinGroupCard({ group, token, error }: JoinGroupCardProps) {
  const router = useRouter()
  const [isJoining, setIsJoining] = useState(false)
  const joinMutation = trpc.userGroups.join.useMutation()

  if (error) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invalid Invite</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => router.push('/groups')} className="w-full">
            Go to Groups
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!group || !token) {
    return null
  }

  const handleJoin = async () => {
    setIsJoining(true)
    try {
      await joinMutation.mutateAsync({ groupId: group.id })
      router.push(`/groups/${group.id}`)
    } catch (err) {
      console.error('Failed to join group:', err)
      setIsJoining(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Join Group</CardTitle>
        <CardDescription>
          You've been invited to join <strong>{group.name}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          By joining, you'll be able to see group expenses and add your own.
        </p>
        <div className="flex gap-2">
          <Button
            onClick={handleJoin}
            disabled={isJoining}
            className="flex-1"
          >
            {isJoining ? 'Joining...' : 'Join Group'}
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/groups')}
            disabled={isJoining}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

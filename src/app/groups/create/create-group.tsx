'use client'

import { GroupForm } from '@/components/group-form'
import { trpc } from '@/trpc/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'

export const CreateGroup = () => {
  const { mutateAsync } = trpc.groups.create.useMutation()
  const utils = trpc.useUtils()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()

  // Check if explicitly creating a device-only group
  const isDeviceOnly = searchParams.get('type') === 'device'

  return (
    <GroupForm
      isAuthenticated={!!session?.user && !isDeviceOnly}
      currentUserName={session?.user?.name || ''}
      onSubmit={async (groupFormValues) => {
        // Create authenticated group only if:
        // - User is signed in AND
        // - Not explicitly creating a device-only group
        const shouldCreateAuthenticated = !!session?.user && !isDeviceOnly

        const { groupId } = await mutateAsync({
          groupFormValues,
          isAuthenticated: shouldCreateAuthenticated,
        })

        await utils.groups.invalidate()
        // If creating authenticated group, REFETCH userGroups to ensure
        // fresh data is available before navigation. This prevents SaveGroupLocally
        // from seeing stale cached data and incorrectly saving to localStorage.
        if (shouldCreateAuthenticated) {
          await utils.userGroups.list.refetch()
        }

        router.push(`/groups/${groupId}`)
      }}
    />
  )
}

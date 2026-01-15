'use client'

import { GroupForm } from '@/components/group-form'
import { trpc } from '@/trpc/client'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

export const CreateGroup = () => {
  const { mutateAsync } = trpc.groups.create.useMutation()
  const utils = trpc.useUtils()
  const router = useRouter()
  const { data: session } = useSession()

  return (
    <GroupForm
      onSubmit={async (groupFormValues) => {
        const { groupId } = await mutateAsync({
          groupFormValues,
          isAuthenticated: !!session?.user,
        })
        await utils.groups.invalidate()
        router.push(`/groups/${groupId}`)
      }}
    />
  )
}

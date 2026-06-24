'use client'

import { useToast } from '@/components/ui/use-toast'
import { useTranslations } from '@/i18n/react'
import { trpc } from '@/trpc/client'
import { Outlet } from '@tanstack/react-router'
import { PropsWithChildren, useEffect } from 'react'
import { CurrentGroupProvider } from './current-group-context'
import { GroupHeader } from './group-header'
import { SaveGroupLocally } from './save-recent-group'

export function GroupLayoutClient({
  groupId,
  children,
}: PropsWithChildren<{ groupId: string }>) {
  const { data, isLoading } = trpc.groups.get.useQuery({ groupId })
  const tNotFound = useTranslations('Groups.NotFound')
  const { toast } = useToast()

  useEffect(() => {
    if (data && !data.group) {
      toast({
        description: tNotFound('text'),
        variant: 'destructive',
      })
    }
  }, [data])

  const props =
    isLoading || !data?.group
      ? {
          isLoading: true as const,
          groupId,
          group: undefined,
          currentLedgerParticipantId: undefined,
          currentMember: undefined,
          currentInvitation: undefined,
        }
      : {
          isLoading: false as const,
          groupId,
          group: data.group,
          currentLedgerParticipantId: data.currentLedgerParticipantId ?? null,
          currentMember: data.currentMember,
          currentInvitation: data.currentInvitation ?? null,
        }

  return (
    <CurrentGroupProvider {...props}>
      <div className="flex flex-col gap-3">
        <GroupHeader />
        {children ?? <Outlet />}
      </div>
      <SaveGroupLocally />
    </CurrentGroupProvider>
  )
}

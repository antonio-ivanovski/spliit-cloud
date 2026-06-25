'use client'

import { ForceArchiveDialog } from '@/components/force-archive-dialog'
import { GroupForm } from '@/components/group-form'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { Archive, ArchiveRestore } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup, useIsPendingInvitee } from '../current-group-context'

export const EditGroup = () => {
  const { groupId, group, currentMember } = useCurrentGroup()
  const isPendingInvitee = useIsPendingInvitee()
  const { data, isLoading } = trpc.groups.getDetails.useQuery({ groupId })
  const { mutateAsync: updateGroup } = trpc.groups.update.useMutation()
  const { mutateAsync: archiveGroup } = trpc.groups.archive.useMutation()
  const utils = trpc.useUtils()
  const { t } = useTranslation(undefined, { keyPrefix: 'GroupForm' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { toast } = useToast()
  const [archivePending, setArchivePending] = useState(false)
  const [forceArchiveOpen, setForceArchiveOpen] = useState(false)

  async function handleToggleArchive(nextArchived: boolean) {
    setArchivePending(true)
    try {
      await archiveGroup({ groupId, archived: nextArchived })
      await Promise.all([
        utils.account.groups.invalidate(),
        utils.groups.get.invalidate({ groupId }),
      ])
      toast({
        description: nextArchived
          ? tGroups('archiveSuccess')
          : tGroups('unarchiveSuccess'),
      })
    } catch (error) {
      // `PRECONDITION_FAILED` is the typed "has unsettled balances" signal
      // from the archive procedure. Defer the confirmation dialog to the
      // shared `ForceArchiveDialog` so the user can choose to force-archive
      // (which auto-creates settlement expenses) or review balances first.
      if (
        error &&
        typeof error === 'object' &&
        'data' in error &&
        (error as { data?: { code?: string } }).data?.code ===
          'PRECONDITION_FAILED'
      ) {
        setForceArchiveOpen(true)
        return
      }
      toast({
        description:
          error instanceof Error
            ? error.message
            : tGroups('archiveWithBalancesCancel'),
        variant: 'destructive',
      })
    } finally {
      setArchivePending(false)
    }
  }

  if (isLoading) return <></>

  // PENDING invitees are read-only on this group until they accept the
  // invitation. The route is still mounted (so deep links keep working)
  // but the form is replaced with an explanation card. The server rejects
  // the underlying `groups.update`/`groups.archive` mutations anyway.
  if (isPendingInvitee) {
    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{tGroups('pendingInviteeSettingsTitle')}</CardTitle>
          <CardDescription>
            {tGroups('pendingInviteeSettingsDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary">
            <Link href={`/groups/${groupId}`}>{t('readOnlyBack')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // MEMBERs are not allowed to change group settings. The route is still
  // mounted (so deep links keep working) but the form is replaced with an
  // explanation card pointing back to the group's main page.
  if (currentMember?.role === 'MEMBER') {
    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('readOnlyTitle')}</CardTitle>
          <CardDescription>{t('readOnlyNote')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary">
            <Link href={`/groups/${groupId}`}>{t('readOnlyBack')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const canArchive =
    currentMember?.role === 'OWNER' || currentMember?.role === 'ADMIN'
  const isArchived = !!group?.archived

  return (
    <>
      <GroupForm
        group={data?.group}
        currentMemberRole={currentMember?.role}
        archived={!!group?.archived}
        onSubmit={async (groupFormValues) => {
          await updateGroup({ groupId, groupFormValues })
          await utils.groups.invalidate()
        }}
      />

      {canArchive && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{tGroups('archiveSectionTitle')}</CardTitle>
            <CardDescription>
              {tGroups('archiveSectionDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="secondary"
              disabled={archivePending}
              onClick={() => handleToggleArchive(!isArchived)}
            >
              {isArchived ? (
                <>
                  <ArchiveRestore className="w-4 h-4 mr-2" />
                  {tGroups('unarchiveGroup')}
                </>
              ) : (
                <>
                  <Archive className="w-4 h-4 mr-2" />
                  {tGroups('archiveGroup')}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      <ForceArchiveDialog
        groupId={forceArchiveOpen ? groupId : null}
        onClose={() => setForceArchiveOpen(false)}
      />
    </>
  )
}

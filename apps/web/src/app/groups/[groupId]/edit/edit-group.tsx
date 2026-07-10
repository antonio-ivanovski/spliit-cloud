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
import { trpc } from '@/trpc/client'
import { Archive, ArchiveRestore, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup, useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { DeleteGroupDialog } from './delete-group-dialog'
import {
  useArchiveGroupMutation,
  useDeleteGroupMutation,
  useUpdateGroupMutation,
} from './edit-group-mutations'

export const EditGroup = () => {
  const { groupId, group, currentMember } = useCurrentGroup()
  const isPendingInvitee = useIsPendingInvitee()
  const linkInviteToken = useLinkInviteToken()
  const { data, isLoading } = trpc.groups.getDetails.useQuery({
    groupId,
    linkInviteToken,
  })
  const updateMutation = useUpdateGroupMutation()
  const deleteMutation = useDeleteGroupMutation()
  const { data: features } = trpc.features.get.useQuery()
  const { t } = useTranslation(undefined, { keyPrefix: 'GroupForm' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const [forceArchiveOpen, setForceArchiveOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const archiveMutation = useArchiveGroupMutation({
    onUnsettledBalances: () => setForceArchiveOpen(true),
  })

  if (isLoading) return <></>

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

  const isFriendLedger = group?.groupType === 'FRIEND'
  const canArchive = currentMember?.role === 'ADMIN' && !isFriendLedger
  const canDelete = canArchive && !group?.archived && !isFriendLedger
  const isArchived = !!group?.archived

  return (
    <>
      <GroupForm
        group={data?.group}
        currentMemberRole={currentMember?.role}
        archived={!!group?.archived}
        hideNameField={isFriendLedger}
        currencyLocked={!!data?.hasExpenses}
        onSubmit={(groupFormValues) =>
          updateMutation.mutateAsync({ groupId, groupFormValues })
        }
      />

      {canArchive && !isArchived && features?.enableBulkCategorize && (
        <Card className="mb-2">
          <CardHeader>
            <CardTitle>{t('bulkCategorizeSectionTitle')}</CardTitle>
            <CardDescription>
              {t('bulkCategorizeSectionDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary">
              <Link href={`/groups/bulk-categorize/${groupId}`}>
                <Sparkles className="w-4 h-4 mr-2" />
                {t('bulkCategorizeButton')}
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {canArchive && (
        <Card className="mb-2">
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
              disabled={archiveMutation.isPending}
              onClick={() =>
                archiveMutation.mutate({
                  groupId,
                  archived: !isArchived,
                })
              }
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

      {canDelete && (
        <Card className="mb-2 border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">
              {tGroups('delete.sectionTitle')}
            </CardTitle>
            <CardDescription>
              {tGroups('delete.sectionDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {tGroups('delete.button')}
            </Button>
          </CardContent>
        </Card>
      )}

      <ForceArchiveDialog
        groupId={forceArchiveOpen ? groupId : null}
        onClose={() => setForceArchiveOpen(false)}
      />

      <DeleteGroupDialog
        open={deleteDialogOpen}
        groupName={group?.name ?? ''}
        deleting={deleteMutation.isPending}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={() => deleteMutation.mutate({ groupId })}
      />
    </>
  )
}

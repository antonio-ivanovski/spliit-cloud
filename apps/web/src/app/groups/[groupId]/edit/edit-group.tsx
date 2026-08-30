import { Link } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ForceArchiveDialog } from '@/components/force-archive-dialog'
import { GroupForm } from '@/components/group-form'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { trpc } from '@/trpc/client'

import {
  useCurrentGroup,
  useIsReadOnlyGroupViewer,
} from '../current-group-context'
import { ExportOptionsCard } from '../export-options-card'
import { SplitPresetsCard } from '../members/split-presets-card'
import { useGroupAccessSearch } from '../use-group-access-search'
import { DeleteGroupDialog } from './delete-group-dialog'
import {
  useArchiveGroupMutation,
  useDeleteGroupMutation,
  useUpdateGroupMutation,
} from './edit-group-mutations'
import { PublicViewOnlyLinkSection } from './group-view-link-card'

export const EditGroup = () => {
  const { groupId, group, currentMember } = useCurrentGroup()
  const isReadOnlyViewer = useIsReadOnlyGroupViewer()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()
  const { data, isLoading } = trpc.groups.getDetails.useQuery({
    groupId,
    linkInviteToken,
    viewKey,
  })
  const updateMutation = useUpdateGroupMutation()
  const deleteMutation = useDeleteGroupMutation()
  const { data: features } = trpc.features.get.useQuery()
  const { t } = useTranslation(undefined, { keyPrefix: 'GroupForm' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tExpenses } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const [forceArchiveOpen, setForceArchiveOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const archiveMutation = useArchiveGroupMutation({
    onUnsettledBalances: () => setForceArchiveOpen(true),
  })

  if (isLoading) return <></>
  if (!group) return null

  const isFriendLedger = group?.groupType === 'FRIEND'
  const canArchive = currentMember?.role === 'ADMIN' && !isFriendLedger
  const canDelete = canArchive && !group?.archived && !isFriendLedger
  const isArchived = !!group?.archived

  return (
    <div className="flex flex-col gap-3">
      <GroupForm
        group={data?.group}
        currentMemberRole={currentMember?.role}
        readOnly={isReadOnlyViewer || currentMember?.role === 'MEMBER'}
        archived={!!group?.archived}
        hideNameField={isFriendLedger}
        currencyLocked={!!data?.hasExpenses}
        onSubmit={(groupFormValues) =>
          updateMutation.mutateAsync({ groupId, groupFormValues })
        }
      />

      {currentMember ? (
        <SplitPresetsCard
          groupId={groupId}
          group={group}
          canManage={currentMember.role === 'ADMIN'}
          isArchived={isArchived}
        />
      ) : null}

      {currentMember && !isFriendLedger ? (
        <PublicViewOnlyLinkSection groupId={groupId} />
      ) : null}

      {!isReadOnlyViewer ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{tExpenses('export')}</CardTitle>
            <CardDescription>{tGroups('exportDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ExportOptionsCard groupId={groupId} />
          </CardContent>
        </Card>
      ) : null}

      {canArchive && !isArchived && features?.enableBulkCategorize && (
        <Card className="mb-2">
          <CardHeader>
            <CardTitle>{t('bulkCategorizeSectionTitle')}</CardTitle>
            <CardDescription>
              {t('bulkCategorizeSectionDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="secondary"
              nativeButton={false}
              render={
                <Link
                  to="/groups/bulk-categorize/$groupId"
                  params={{ groupId }}
                />
              }
            >
              <Sparkles className="me-2 h-4 w-4" />
              {t('bulkCategorizeButton')}
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
                  <ArchiveRestore className="me-2 h-4 w-4" />
                  {tGroups('unarchiveGroup')}
                </>
              ) : (
                <>
                  <Archive className="me-2 h-4 w-4" />
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
              <Trash2 className="me-2 h-4 w-4" />
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
    </div>
  )
}

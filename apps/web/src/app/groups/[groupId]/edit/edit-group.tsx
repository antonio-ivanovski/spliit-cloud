import { Link } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Trash } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ForceArchiveDialog } from '@/components/force-archive-dialog'
import { GroupForm } from '@/components/group-form'
import { OfflineNeedsConnection } from '@/components/offline-download-status'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOfflineWithoutData, useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

import {
  useCurrentGroup,
  useGroupWriteEligibility,
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
  const { data: account } = useCurrentAccount()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()
  const isOnline = useOnlineStatus()
  const { connectionReadOnly } = useGroupWriteEligibility()
  const { data, isLoading } = trpc.groups.getDetails.useQuery(
    {
      groupId,
      linkInviteToken,
      viewKey,
    },
    { enabled: isOnline },
  )
  const updateMutation = useUpdateGroupMutation()
  const deleteMutation = useDeleteGroupMutation()
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tExpenses } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const [forceArchiveOpen, setForceArchiveOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const archiveMutation = useArchiveGroupMutation({
    onUnsettledBalances: () => setForceArchiveOpen(true),
  })

  const showOfflineEmpty = useOfflineWithoutData(!!data)
  if (!isOnline || showOfflineEmpty) {
    // Group details are not part of the offline snapshot: never initialize
    // an editable form from stale/absent data offline. Archive/delete stay
    // unavailable until reconnect (write guard also rejects).
    return (
      <OfflineNeedsConnection
        backLabel={tGroups('backToGroups')}
        backHref={`/groups/${groupId}`}
      />
    )
  }

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
        hideAppearance={isFriendLedger}
        currencyLocked={!!data?.hasExpenses}
        onSubmit={(groupFormValues) =>
          updateMutation.mutateAsync({ groupId, groupFormValues })
        }
      />

      {account ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {tGroups('groupTabsHint')}{' '}
          <Link
            to="/account/settings"
            hash="account-preference-group-tabs"
            className="underline underline-offset-2"
          >
            {tGroups('groupTabsHintLink')}
          </Link>
        </p>
      ) : null}

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
              disabled={archiveMutation.isPending || connectionReadOnly}
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
              disabled={connectionReadOnly}
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash className="me-2 h-4 w-4" />
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

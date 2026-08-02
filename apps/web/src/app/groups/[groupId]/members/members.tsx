import { Navigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useLocale } from '@/i18n/react'
import { detectDeviceTimeZone } from '@/lib/account-preferences'

import { useCurrentGroup } from '../current-group-context'
import { InviteCard } from './invite-card'
import { LeaveGroupDialog } from './leave-group-dialog'
import { MemberListCard } from './member-list-card'
import { useMembersDialogs } from './members-hooks'
import { PendingInvitationsCard } from './pending-invitations-card'
import { RemoveParticipantDialog } from './remove-participant-dialog'
import { SubgroupsCard } from './subgroups-card'
import { UnlinkedParticipantsSection } from './unlinked-participants-section'

export default function GroupMembers() {
  const { groupId, group } = useCurrentGroup()

  if (group?.groupType === 'FRIEND') {
    return (
      <Navigate to="/groups/$groupId/expenses" params={{ groupId }} replace />
    )
  }

  return <GroupMembersBody />
}

function GroupMembersBody() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const { groupId, group, currentMember } = useCurrentGroup()

  const {
    account,
    isArchived,
    isAdmin,
    canManage,
    canInvite,
    listMembers,
    membersQuery,
    invitations,
    invitationsQuery,
    createMutation,
    createLinkMutation,
    updateRoleMutation,
    removeParticipantMutation,
    participantPendingRemove,
    setParticipantPendingRemove,
    participantRemovePreviewQuery,
    participantRemoveSettleChecked,
    setParticipantRemoveSettleChecked,
    confirmParticipantRemove,
    leaveDialogOpen,
    setLeaveDialogOpen,
    promoteMemberId,
    setPromoteMemberId,
    leavePreviewQuery,
    preview,
    isLastActiveMember,
    hasUnsettledBalance,
    isAdminLeaving,
    otherAdmins,
    promotableMembers,
    needsPromotion,
    canConfirmLeave,
    handleConfirmLeave,
    leaveMutation,
  } = useMembersDialogs()

  const roleLabels = {
    ADMIN: t('role.admin'),
    MEMBER: t('role.member'),
  } as const

  const isOnlyActiveMember = !isArchived && listMembers.length <= 1

  return (
    <div className="flex flex-col gap-6">
      <MemberListCard
        members={listMembers}
        isLoading={membersQuery.isLoading}
        accountId={account?.id}
        currentMemberId={currentMember?.id ?? null}
        canManage={canManage}
        updateRoleMutation={updateRoleMutation}
        onRemove={(participant) => setParticipantPendingRemove(participant)}
        onUpdateRole={(memberId, role) =>
          updateRoleMutation.mutate({ groupId, memberId, role })
        }
        roleLabels={roleLabels}
        locale={locale}
        timeZone={accountTimeZone}
      />

      <SubgroupsCard
        groupId={groupId}
        participants={group?.participants ?? []}
        canManage={canManage}
      />

      <UnlinkedParticipantsSection
        groupId={groupId}
        canManage={canManage}
        onRemove={(participant) => setParticipantPendingRemove(participant)}
      />

      {!canManage && isArchived && (
        <p className="text-sm text-muted-foreground">{t('archivedNotice')}</p>
      )}

      {canInvite && (
        <>
          <InviteCard
            groupId={groupId}
            groupName={group?.name ?? ''}
            canInviteAdmin={isAdmin}
            createMutation={createMutation}
            createLinkMutation={createLinkMutation}
            onInvite={async (values) => {
              await createMutation.mutateAsync({
                groupId,
                email: values.email,
                role: values.role,
                temporaryName: values.temporaryName,
              })
            }}
            onGenerateLink={async (values) => {
              return createLinkMutation.mutateAsync({
                groupId,
                role: values.role,
                temporaryName: values.temporaryName,
              })
            }}
          />

          <PendingInvitationsCard
            invitations={invitations}
            isLoading={invitationsQuery.isLoading}
            onRevoke={(inv) =>
              setParticipantPendingRemove({
                ledgerParticipantId: inv.ledgerParticipantId,
                name: inv.label,
              })
            }
            locale={locale}
            timeZone={accountTimeZone}
          />
        </>
      )}

      <RemoveParticipantDialog
        participantPendingRemove={participantPendingRemove}
        removePreviewQuery={participantRemovePreviewQuery}
        participantRemoveSettleChecked={participantRemoveSettleChecked}
        removeParticipantMutation={removeParticipantMutation}
        onOpenChange={(open) => {
          if (!open) setParticipantPendingRemove(null)
        }}
        onConfirmRemove={confirmParticipantRemove}
        onSettleCheckedChange={setParticipantRemoveSettleChecked}
      />

      {!isArchived && currentMember && (
        <Card>
          <CardHeader>
            <CardTitle>{t('leave.button')}</CardTitle>
            <CardDescription>
              {isOnlyActiveMember
                ? t('leave.descriptionOnlyMember')
                : t('leave.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {isOnlyActiveMember && (
              <p
                className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="note"
              >
                {t('leave.onlyMemberHint')}
              </p>
            )}
            <Button
              variant="outline"
              className="w-fit border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setLeaveDialogOpen(true)}
              disabled={isOnlyActiveMember}
            >
              {t('leave.button')}
            </Button>
          </CardContent>
        </Card>
      )}

      <LeaveGroupDialog
        leaveDialogOpen={leaveDialogOpen}
        leavePreviewQuery={leavePreviewQuery}
        leaveMutation={leaveMutation}
        isLastActiveMember={isLastActiveMember}
        isAdminLeaving={isAdminLeaving}
        hasUnsettledBalance={hasUnsettledBalance}
        needsPromotion={needsPromotion}
        otherAdmins={otherAdmins}
        promotableMembers={promotableMembers}
        promoteMemberId={promoteMemberId}
        canConfirmLeave={canConfirmLeave}
        preview={preview}
        onOpenChange={(open) => {
          setLeaveDialogOpen(open)
          if (!open) setPromoteMemberId(null)
        }}
        onPromoteMemberChange={setPromoteMemberId}
        onConfirmLeave={handleConfirmLeave}
      />
    </div>
  )
}

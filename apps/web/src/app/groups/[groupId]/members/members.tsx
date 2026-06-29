import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useLocale } from '@/i18n/react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup } from '../current-group-context'
import { InviteCard } from './invite-card'
import { LeaveGroupDialog } from './leave-group-dialog'
import { MemberListCard } from './member-list-card'
import { useMembersDialogs } from './members-hooks'
import { PendingInvitationsCard } from './pending-invitations-card'
import { RemoveMemberDialog } from './remove-member-dialog'
import { RevokeInvitationDialog } from './revoke-invitation-dialog'
import { UnlinkedParticipantsSection } from './unlinked-participants-section'

export default function GroupMembers() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const { groupId, group, currentMember } = useCurrentGroup()

  const {
    account,
    isArchived,
    canManage,
    listMembers,
    membersQuery,
    invitations,
    invitationsQuery,
    createMutation,
    createLinkMutation,
    revokeMutation,
    updateRoleMutation,
    removeMemberMutation,
    memberPendingRemove,
    setMemberPendingRemove,
    removePreviewQuery,
    removeSettleChecked,
    setRemoveSettleChecked,
    confirmRemove,
    invitationPendingRevoke,
    setInvitationPendingRevoke,
    revokePreviewQuery,
    revokeSettleChecked,
    setRevokeSettleChecked,
    confirmRevoke,
    leaveDialogOpen,
    setLeaveDialogOpen,
    promoteMemberId,
    setPromoteMemberId,
    confirmDeleteChecked,
    setConfirmDeleteChecked,
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
    archiveForSelfMutation,
  } = useMembersDialogs()

  const roleLabels = {
    ADMIN: t('role.admin'),
    MEMBER: t('role.member'),
  } as const

  return (
    <div className="flex flex-col gap-6">
      <MemberListCard
        members={listMembers}
        isLoading={membersQuery.isLoading}
        accountId={account?.id}
        currentMemberId={currentMember?.id ?? null}
        canManage={canManage}
        updateRoleMutation={updateRoleMutation}
        onRemove={(member) => setMemberPendingRemove(member)}
        onUpdateRole={(memberId, role) =>
          updateRoleMutation.mutate({ groupId, memberId, role })
        }
        roleLabels={roleLabels}
        locale={locale}
      />

      <UnlinkedParticipantsSection groupId={groupId} canManage={canManage} />

      {!canManage && (
        <p className="text-sm text-muted-foreground">
          {isArchived && currentMember?.role === 'ADMIN'
            ? t('archivedNotice')
            : t('noManagePermission')}
        </p>
      )}

      {canManage && (
        <>
          <InviteCard
            groupId={groupId}
            groupName={group?.name ?? ''}
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
              const data = await createLinkMutation.mutateAsync({
                groupId,
                role: values.role,
                temporaryName: values.temporaryName,
              })
              return data
            }}
          />

          <PendingInvitationsCard
            invitations={invitations}
            isLoading={invitationsQuery.isLoading}
            revokeMutation={revokeMutation}
            onRevoke={(inv) => setInvitationPendingRevoke(inv)}
            roleLabels={roleLabels}
            locale={locale}
          />
        </>
      )}

      <RemoveMemberDialog
        memberPendingRemove={memberPendingRemove}
        removePreviewQuery={removePreviewQuery}
        removeSettleChecked={removeSettleChecked}
        removeMemberMutation={removeMemberMutation}
        onOpenChange={(open) => {
          if (!open) setMemberPendingRemove(null)
        }}
        onConfirmRemove={confirmRemove}
        onSettleCheckedChange={setRemoveSettleChecked}
      />

      <RevokeInvitationDialog
        invitationPendingRevoke={invitationPendingRevoke}
        revokePreviewQuery={revokePreviewQuery}
        revokeSettleChecked={revokeSettleChecked}
        revokeMutation={revokeMutation}
        onOpenChange={(open) => {
          if (!open) setInvitationPendingRevoke(null)
        }}
        onConfirmRevoke={confirmRevoke}
        onSettleCheckedChange={setRevokeSettleChecked}
      />

      {!isArchived && currentMember && (
        <Card>
          <CardHeader>
            <CardTitle>{t('leave.button')}</CardTitle>
            <CardDescription>{t('leave.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setLeaveDialogOpen(true)}
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
        archiveForSelfMutation={archiveForSelfMutation}
        isLastActiveMember={isLastActiveMember}
        isAdminLeaving={isAdminLeaving}
        hasUnsettledBalance={hasUnsettledBalance}
        needsPromotion={needsPromotion}
        otherAdmins={otherAdmins}
        promotableMembers={promotableMembers}
        promoteMemberId={promoteMemberId}
        confirmDeleteChecked={confirmDeleteChecked}
        canConfirmLeave={canConfirmLeave}
        preview={preview}
        onOpenChange={setLeaveDialogOpen}
        onPromoteMemberChange={setPromoteMemberId}
        onConfirmDeleteChange={setConfirmDeleteChecked}
        onConfirmLeave={handleConfirmLeave}
      />
    </div>
  )
}

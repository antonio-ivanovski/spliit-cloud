import { Navigate } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { Badge } from '@/components/ui/badge'
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
import { useIdempotentCreate } from '@/lib/use-idempotent-create'

import { useCurrentGroup } from '../current-group-context'
import { InviteCard } from './invite-card'
import { LeaveGroupDialog } from './leave-group-dialog'
import { ManagePendingInvitationDialog } from './manage-pending-invitation-dialog'
import { MemberListCard } from './member-list-card'
import {
  badgeVariantForRole,
  formatDate,
  roleLabel,
  useMembersDialogs,
  type PendingInvitation,
} from './members-hooks'
import { PendingInvitationsCard } from './pending-invitations-card'
import { RegenerateLinkDialog } from './regenerate-link-dialog'
import { RemoveParticipantDialog } from './remove-participant-dialog'
import { SubgroupsCard } from './subgroups-card'

export default function GroupMembers() {
  const { groupId, group, viewer } = useCurrentGroup()

  if (group?.groupType === 'FRIEND') {
    return (
      <Navigate to="/groups/$groupId/expenses" params={{ groupId }} replace />
    )
  }

  if (viewer && !viewer.canMutate) return <ReadOnlyMembers />

  return <GroupMembersBody />
}

function ReadOnlyMembers() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const { groupId, group } = useCurrentGroup()
  if (!group) return null
  const roleLabels = {
    ADMIN: t('role.admin'),
    MEMBER: t('role.member'),
  } as const
  const otherParticipants = group.participants.filter(
    (participant) =>
      participant.account == null && participant.name.trim().length > 0,
  )
  return (
    <div className="flex flex-col gap-4">
      <Card className="mobile-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" aria-hidden="true" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('readOnlyDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {group.members.map((member) => (
            <div
              key={member.id}
              className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
            >
              <AccountAvatar
                account={member.account}
                size="lg"
                className="mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="truncate font-medium">
                    {member.account.name}
                  </span>
                  <Badge
                    variant={badgeVariantForRole(member.role)}
                    className="w-fit shrink-0"
                  >
                    {roleLabel(member.role, roleLabels)}
                  </Badge>
                </div>
                {member.joinedAt && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('joinedOn', {
                      date: formatDate(
                        member.joinedAt,
                        locale,
                        accountTimeZone,
                      ),
                    })}
                  </p>
                )}
              </div>
            </div>
          ))}
          {otherParticipants.map((participant) => (
            <div
              key={participant.id}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="font-medium">{participant.name}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <SubgroupsCard
        groupId={groupId}
        participants={group.participants}
        canManage={false}
      />
    </div>
  )
}

function GroupMembersBody() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const { groupId, group, currentMember } = useCurrentGroup()
  const emailInviteAttempt = useIdempotentCreate()
  const linkInviteAttempt = useIdempotentCreate()
  const participantAttempt = useIdempotentCreate()

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
    createParticipantMutation,
    updatePendingMutation,
    regenerateLinkMutation,
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

  const [manageInvitation, setManageInvitation] =
    useState<PendingInvitation | null>(null)
  const manageButtonRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const manageFocusRef = useRef<HTMLButtonElement | null>(null)

  const [regenerateInvitation, setRegenerateInvitation] =
    useState<PendingInvitation | null>(null)
  const regenerateButtonRefs = useRef(
    new Map<string, HTMLButtonElement | null>(),
  )
  const regenerateFocusRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    manageFocusRef.current = manageInvitation
      ? (manageButtonRefs.current.get(manageInvitation.id) ?? null)
      : null
  }, [manageInvitation])

  useEffect(() => {
    regenerateFocusRef.current = regenerateInvitation
      ? (regenerateButtonRefs.current.get(regenerateInvitation.id) ?? null)
      : null
  }, [regenerateInvitation])

  const roleLabels = {
    ADMIN: t('role.admin'),
    MEMBER: t('role.member'),
  } as const

  const isOnlyActiveMember = !isArchived && listMembers.length <= 1

  return (
    <div className="flex flex-col gap-6">
      <MemberListCard
        groupId={groupId}
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
            createParticipantMutation={createParticipantMutation}
            onInvite={async (values) => {
              const result = await emailInviteAttempt.run((requestId) =>
                createMutation.mutateAsync({
                  groupId,
                  email: values.email,
                  role: values.role,
                  temporaryName: values.temporaryName,
                  requestId,
                }),
              )
              return result !== null
            }}
            onGenerateLink={async (values) => {
              const result = await linkInviteAttempt.run((requestId) =>
                createLinkMutation.mutateAsync({
                  groupId,
                  role: values.role,
                  temporaryName: values.temporaryName,
                  requestId,
                }),
              )
              return result ?? undefined
            }}
            onAddParticipant={async (values) => {
              const result = await participantAttempt.run((requestId) =>
                createParticipantMutation.mutateAsync({
                  groupId,
                  displayName: values.displayName,
                  requestId,
                }),
              )
              return result !== null
            }}
          />

          <PendingInvitationsCard
            invitations={invitations}
            isLoading={invitationsQuery.isLoading}
            onManage={setManageInvitation}
            onManageButtonRef={(invitationId, element) => {
              if (element) {
                manageButtonRefs.current.set(invitationId, element)
              } else {
                manageButtonRefs.current.delete(invitationId)
              }
            }}
            onGenerateLink={setRegenerateInvitation}
            onGenerateButtonRef={(invitationId, element) => {
              if (element) {
                regenerateButtonRefs.current.set(invitationId, element)
              } else {
                regenerateButtonRefs.current.delete(invitationId)
              }
            }}
            onRevoke={(inv) => {
              setParticipantPendingRemove({
                ledgerParticipantId: inv.ledgerParticipantId,
                name: inv.label,
              })
            }}
            locale={locale}
            timeZone={accountTimeZone}
          />
        </>
      )}

      <ManagePendingInvitationDialog
        invitation={manageInvitation}
        groupName={group?.name ?? ''}
        isAdmin={isAdmin}
        updatePending={updatePendingMutation}
        finalFocusRef={manageFocusRef}
        onOpenChange={(open) => {
          if (!open) setManageInvitation(null)
        }}
      />

      <RegenerateLinkDialog
        invitation={regenerateInvitation}
        groupName={group?.name ?? ''}
        regenerateLink={regenerateLinkMutation}
        finalFocusRef={regenerateFocusRef}
        onOpenChange={(open) => {
          if (!open) setRegenerateInvitation(null)
        }}
      />

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

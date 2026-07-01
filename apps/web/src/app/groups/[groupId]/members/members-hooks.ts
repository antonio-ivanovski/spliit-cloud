import { useToast } from '@/components/ui/use-toast'
import { useRouter } from '@/lib/navigation'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { useCurrentGroup } from '../current-group-context'

export type InvitableRole = 'ADMIN' | 'MEMBER'
export type MemberRole = 'ADMIN' | 'MEMBER'

export function roleLabel(
  role: MemberRole,
  labels: { ADMIN: string; MEMBER: string },
) {
  switch (role) {
    case 'ADMIN':
      return labels.ADMIN
    case 'MEMBER':
      return labels.MEMBER
  }
}

export function badgeVariantForRole(role: MemberRole): 'secondary' | 'outline' {
  switch (role) {
    case 'ADMIN':
      return 'secondary'
    case 'MEMBER':
      return 'outline'
  }
}

export const emailFormSchema = z.object({
  email: z.string().email(),
  temporaryName: z.string().trim().max(120).optional(),
})
export type EmailFormValues = z.infer<typeof emailFormSchema>

export const linkFormSchema = z.object({
  temporaryName: z.string().trim().max(120).optional(),
})
export type LinkFormValues = z.infer<typeof linkFormSchema>

export type GeneratedLink = {
  inviteUrl: string
  temporaryName: string | null
  role: InvitableRole
  expiresAt: Date | string
}

export function formatDate(value: string | Date, locale: string) {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function useMembersDialogs() {
  const { groupId, group, currentMember } = useCurrentGroup()
  const { data: account } = useCurrentAccount()
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { toast } = useToast()
  const router = useRouter()

  const membersQuery = trpc.account.members.useQuery({ groupId })
  const invitationsQuery = trpc.invitations.list.useQuery({ groupId })

  const role = currentMember?.role
  const isArchived = !!group?.archived
  const isAdmin = role === 'ADMIN'
  const canManage = !isArchived && isAdmin
  const currentMemberId = currentMember?.id ?? null

  const utils = trpc.useUtils()

  // -- Invite mutations --
  const createMutation = trpc.invitations.create.useMutation({
    onSuccess: async (_data, vars) => {
      toast({ description: t('invitations.created', { email: vars.email }) })
      await Promise.all([
        utils.invitations.list.invalidate({ groupId }),
        utils.groups.get.invalidate({ groupId }),
        utils.groups.getDetails.invalidate({ groupId }),
        utils.account.members.invalidate({ groupId }),
        utils.groups.importLinks.listUnlinked.invalidate({ groupId }),
      ])
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const createLinkMutation = trpc.invitations.createLink.useMutation({
    onSuccess: async (_data) => {
      toast({ description: t('invite.link.created') })
      await Promise.all([
        utils.invitations.list.invalidate({ groupId }),
        utils.groups.get.invalidate({ groupId }),
        utils.groups.getDetails.invalidate({ groupId }),
        utils.account.members.invalidate({ groupId }),
        utils.groups.importLinks.listUnlinked.invalidate({ groupId }),
      ])
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const revokeMutation = trpc.invitations.revoke.useMutation({
    onSuccess: async (_data, vars) => {
      toast({
        description: vars.settleBalances
          ? t('invitations.revokeDialog.unsettled.toast')
          : t('invitations.revoked'),
      })
      await Promise.all([
        utils.invitations.list.invalidate({ groupId }),
        utils.account.members.invalidate({ groupId }),
        utils.groups.get.invalidate({ groupId }),
        utils.groups.getDetails.invalidate({ groupId }),
      ])
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  // -- Member management mutations --
  const updateRoleMutation = trpc.groups.members.updateRole.useMutation({
    onSuccess: async (_data, vars) => {
      toast({
        description: t('roleUpdated', { role: vars.role }),
      })
      await Promise.all([
        utils.account.members.invalidate({ groupId }),
        utils.groups.get.invalidate({ groupId }),
        utils.groups.getDetails.invalidate({ groupId }),
        utils.groups.leavePreview.invalidate({ groupId }),
      ])
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const removeMemberMutation = trpc.groups.members.remove.useMutation({
    onSuccess: async (_data, vars) => {
      toast({
        description: vars.settleBalances
          ? t('removeDialog.unsettled.toast')
          : t('removed'),
      })
      await Promise.all([
        utils.account.members.invalidate({ groupId }),
        utils.groups.get.invalidate({ groupId }),
        utils.groups.getDetails.invalidate({ groupId }),
        utils.groups.leavePreview.invalidate({ groupId }),
      ])
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  // -- Remove dialog state --
  const [memberPendingRemove, setMemberPendingRemove] = useState<{
    id: string
    name: string
  } | null>(null)

  const removePreviewQuery = trpc.groups.members.removePreview.useQuery(
    { groupId, memberId: memberPendingRemove?.id ?? '' },
    { enabled: !!memberPendingRemove },
  )

  const [removeSettleChecked, setRemoveSettleChecked] = useState(false)

  // Reset checkbox when dialog closes (inline during render to avoid
  // set-state-in-effect from the old useEffect pattern).
  if (!memberPendingRemove && removeSettleChecked) {
    setRemoveSettleChecked(false)
  }

  async function confirmRemove(settleBalances?: boolean) {
    if (!memberPendingRemove) return
    await removeMemberMutation.mutateAsync({
      groupId,
      memberId: memberPendingRemove.id,
      settleBalances,
    })
    setMemberPendingRemove(null)
  }

  // -- Revoke dialog state --
  const [invitationPendingRevoke, setInvitationPendingRevoke] = useState<{
    id: string
    email: string
    label: string
  } | null>(null)

  const revokePreviewQuery = trpc.invitations.revokePreview.useQuery(
    { groupId, invitationId: invitationPendingRevoke?.id ?? '' },
    { enabled: !!invitationPendingRevoke },
  )

  const [revokeSettleChecked, setRevokeSettleChecked] = useState(false)

  async function confirmRevoke() {
    if (!invitationPendingRevoke) return
    const settleBalances = revokePreviewQuery.data?.hasUnsettledBalance
      ? true
      : undefined
    await revokeMutation.mutateAsync({
      invitationId: invitationPendingRevoke.id,
      settleBalances,
    })
    setInvitationPendingRevoke(null)
  }

  // -- Leave dialog state --
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [promoteMemberId, setPromoteMemberId] = useState<string | null>(null)
  const [confirmDeleteChecked, setConfirmDeleteChecked] = useState(false)

  const leavePreviewQuery = trpc.groups.leavePreview.useQuery(
    { groupId },
    { enabled: leaveDialogOpen },
  )

  const leaveMutation = trpc.groups.leave.useMutation({
    onSuccess: async (result) => {
      toast({
        description: result.deleted
          ? t('leave.toast.deleted')
          : t('leave.toast.left'),
      })
      setLeaveDialogOpen(false)
      router.push({ href: '/' })
      utils.account.groups.invalidate()
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const archiveForSelfMutation = trpc.groups.archiveForSelf.useMutation({
    onSuccess: async () => {
      toast({ description: t('leave.toast.archived') })
      setLeaveDialogOpen(false)
      router.push({ href: '/' })
      utils.account.groups.invalidate()
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const preview = leavePreviewQuery.data
  const isLastActiveMember = !!preview?.isLastActiveMember
  const isLastAdmin = !!preview?.isLastAdmin
  const hasUnsettledBalance = !!preview?.hasUnsettledBalance
  const isAdminLeaving = preview?.role === 'ADMIN'
  const otherAdmins = preview?.otherAdmins ?? []
  const promotableMembers = preview?.promotableMembers ?? []
  const needsPromotion = isLastAdmin && !isLastActiveMember

  // Derive the effective promote-member id: use the user-selected one when
  // it points to a valid promotable member, otherwise fall back to the first
  // promotable member (only when preview is loaded). This avoids a
  // cascading-render effect by keeping the state for user interactions while
  // computing the default fallback from derived data.
  const effectivePromoteMemberId =
    promoteMemberId !== null &&
    promotableMembers.some((m) => m.id === promoteMemberId)
      ? promoteMemberId
      : preview
        ? (promotableMembers[0]?.id ?? null)
        : promoteMemberId

  const canConfirmLeave =
    !!preview &&
    !leaveMutation.isPending &&
    (!needsPromotion || !!effectivePromoteMemberId) &&
    (!isLastActiveMember || confirmDeleteChecked)

  function handleConfirmLeave() {
    if (!preview) return
    const shouldForce = !isLastActiveMember && preview.hasUnsettledBalance
    leaveMutation.mutate({
      groupId,
      force: shouldForce ? true : undefined,
      promoteMemberId: needsPromotion
        ? (effectivePromoteMemberId ?? undefined)
        : undefined,
      confirmDelete: isLastActiveMember ? confirmDeleteChecked : undefined,
    })
  }

  const listMembers = useMemo(
    () => membersQuery.data?.members ?? [],
    [membersQuery.data],
  )
  const invitations = useMemo(
    () => invitationsQuery.data?.invitations ?? [],
    [invitationsQuery.data],
  )

  return {
    // State
    groupId,
    group,
    account,
    role,
    isArchived,
    isAdmin,
    canManage,
    currentMemberId,
    // Queries
    membersQuery,
    invitationsQuery,
    listMembers,
    invitations,
    // Invite mutations
    createMutation,
    createLinkMutation,
    revokeMutation,
    // Member management
    updateRoleMutation,
    removeMemberMutation,
    // Remove dialog
    memberPendingRemove,
    setMemberPendingRemove,
    removePreviewQuery,
    removeSettleChecked,
    setRemoveSettleChecked,
    confirmRemove,
    // Revoke dialog
    invitationPendingRevoke,
    setInvitationPendingRevoke,
    revokePreviewQuery,
    revokeSettleChecked,
    setRevokeSettleChecked,
    confirmRevoke,
    // Leave dialog
    leaveDialogOpen,
    setLeaveDialogOpen,
    promoteMemberId,
    setPromoteMemberId,
    confirmDeleteChecked,
    setConfirmDeleteChecked,
    leavePreviewQuery,
    preview,
    isLastActiveMember,
    isLastAdmin,
    hasUnsettledBalance,
    isAdminLeaving,
    otherAdmins,
    promotableMembers,
    needsPromotion,
    canConfirmLeave,
    handleConfirmLeave,
    leaveMutation,
    archiveForSelfMutation,
  }
}

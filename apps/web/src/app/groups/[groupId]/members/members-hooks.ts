import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { useMascotController } from '@/components/mascot/mascot-context'
import { useToast } from '@/components/ui/use-toast'
import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import { resolveFormattingLocale } from '@spliit/domain'

import { useCurrentGroup } from '../current-group-context'

export type InvitableRole = 'ADMIN' | 'MEMBER'
export type MemberRole = 'ADMIN' | 'MEMBER'

export type RecipientProfile = {
  id: string
  name: string | null
  image: string | null
}

export type PendingInvitation = {
  id: string
  groupId: string
  type: 'EMAIL' | 'LINK'
  email: string
  temporaryName: string | null
  role: InvitableRole
  status: string
  createdAt: Date | string
  updatedAt: Date | string
  expiresAt: Date | string | null
  ledgerParticipantId: string | null
  canRevoke: boolean
  canManage: boolean
  recipientProfile: RecipientProfile | null
}

export type UpdatePendingInput = {
  invitationId: string
  role: InvitableRole
  temporaryName?: string
  delivery: { type: 'EMAIL'; email: string } | { type: 'LINK' }
}

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

export type RoleSelectItem = {
  value: MemberRole
  label: string
}

/**
 * Base UI Select `items` for role pickers. Passing `items` lets `SelectValue`
 * render the translated label of the selected value in the trigger instead of
 * the raw `"MEMBER"` / `"ADMIN"` value.
 */
export function useRoleSelectItems(): RoleSelectItem[] {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  return useMemo(
    () => [
      { value: 'MEMBER', label: t('role.member') },
      { value: 'ADMIN', label: t('role.admin') },
    ],
    [t],
  )
}

export const emailFormSchema = z.object({
  email: z.email(),
  temporaryName: z.string().trim().max(120).optional(),
})
export type EmailFormValues = z.infer<typeof emailFormSchema>

export const unlinkedParticipantFormSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
})
export type UnlinkedParticipantFormValues = z.infer<
  typeof unlinkedParticipantFormSchema
>

export type LinkFormValues = {
  temporaryName?: string | undefined
}

export type GeneratedLink = {
  inviteUrl: string
  temporaryName: string | null
  role: InvitableRole
  expiresAt: Date | string
}

const dateFormatCache = new Map<string, Intl.DateTimeFormat>()

function getDateFormat(locale: string, timeZone: string) {
  const key = `${locale}:${timeZone}`
  let fmt = dateFormatCache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(resolveFormattingLocale(locale), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone,
    })
    dateFormatCache.set(key, fmt)
  }
  return fmt
}

export function formatDate(
  value: string | Date,
  locale: string,
  timeZone = 'UTC',
) {
  const date = typeof value === 'string' ? new Date(value) : value
  return getDateFormat(locale, timeZone).format(date)
}

export function useMembersDialogs() {
  const { groupId, group, currentMember } = useCurrentGroup()
  const { data: account } = useCurrentAccount()
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { toast } = useToast()
  const mascot = useMascotController()
  const navigate = useNavigate()

  const membersQuery = trpc.account.members.useQuery({ groupId })
  const invitationsQuery = trpc.invitations.list.useQuery({ groupId })

  const role = currentMember?.role
  const isArchived = !!group?.archived
  const isAdmin = role === 'ADMIN'
  const canManage = !isArchived && isAdmin
  const canInvite = !isArchived && !!currentMember
  const currentMemberId = currentMember?.id ?? null

  const utils = trpc.useUtils()

  const invalidateAll = async () => {
    await Promise.all([
      utils.account.members.invalidate({ groupId }),
      utils.groups.get.invalidate({ groupId }),
      utils.groups.getDetails.invalidate({ groupId }),
      utils.groups.leavePreview.invalidate({ groupId }),
      utils.invitations.list.invalidate({ groupId }),
      utils.groups.importLinks.listUnlinked.invalidate({ groupId }),
      utils.groups.balances.list.invalidate({ groupId }),
    ])
  }

  const invalidateInvitationState = async () => {
    await Promise.all([
      utils.invitations.list.invalidate({ groupId }),
      utils.invitations.listForAccount.invalidate(),
      utils.account.members.invalidate({ groupId }),
      utils.groups.get.invalidate({ groupId }),
      utils.groups.getDetails.invalidate({ groupId }),
      utils.groups.importLinks.listUnlinked.invalidate({ groupId }),
      utils.account.friends.invalidate(),
      utils.groups.balances.list.invalidate({ groupId }),
      utils.groups.leavePreview.invalidate({ groupId }),
    ])
  }

  const updatePendingMutation = trpc.invitations.updatePending.useMutation({
    onSuccess: async () => {
      await invalidateInvitationState()
    },
  })

  const regenerateLinkMutation = trpc.invitations.regenerateLink.useMutation({
    onSuccess: async () => {
      await invalidateInvitationState()
    },
  })

  const createMutation = trpc.invitations.create.useMutation({
    onSuccess: async (_data, vars) => {
      toast({ description: t('invitations.created', { email: vars.email }) })
      await Promise.all([
        utils.invitations.list.invalidate({ groupId }),
        utils.groups.get.invalidate({ groupId }),
        utils.groups.getDetails.invalidate({ groupId }),
        utils.account.members.invalidate({ groupId }),
        utils.groups.importLinks.listUnlinked.invalidate({ groupId }),
        utils.account.friends.invalidate(),
      ])
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const createLinkMutation = trpc.invitations.createLink.useMutation({
    onSuccess: async () => {
      toast({ description: t('invite.link.created') })
      await Promise.all([
        utils.invitations.list.invalidate({ groupId }),
        utils.groups.get.invalidate({ groupId }),
        utils.groups.getDetails.invalidate({ groupId }),
        utils.account.members.invalidate({ groupId }),
        utils.groups.importLinks.listUnlinked.invalidate({ groupId }),
        utils.account.friends.invalidate(),
      ])
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const createParticipantMutation = trpc.groups.participants.create.useMutation(
    {
      onSuccess: async (data) => {
        toast({
          description: t('unlinked.created', { name: data.displayName }),
        })
        await Promise.all([
          utils.groups.importLinks.listUnlinked.invalidate({ groupId }),
          utils.groups.get.invalidate({ groupId }),
          utils.groups.getDetails.invalidate({ groupId }),
          utils.groups.balances.list.invalidate({ groupId }),
        ])
      },
      onError: (error) => {
        toast({ description: error.message, variant: 'destructive' })
      },
    },
  )

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

  const removeParticipantMutation = trpc.groups.participants.remove.useMutation(
    {
      onSuccess: async (_data, vars) => {
        mascot.react('acknowledge')
        toast({
          description: vars.settleBalances
            ? t('removeDialog.unsettled.toast')
            : t('removed'),
        })
        await invalidateAll()
      },
      onError: (error) => {
        toast({ description: error.message, variant: 'destructive' })
      },
    },
  )

  const [participantPendingRemove, setParticipantPendingRemove] = useState<{
    ledgerParticipantId: string
    name: string
  } | null>(null)

  const participantRemovePreviewQuery =
    trpc.groups.participants.removePreview.useQuery(
      {
        groupId,
        ledgerParticipantId:
          participantPendingRemove?.ledgerParticipantId ?? '',
      },
      { enabled: !!participantPendingRemove },
    )

  const [participantRemoveSettleChecked, setParticipantRemoveSettleChecked] =
    useState(false)

  if (!participantPendingRemove && participantRemoveSettleChecked) {
    setParticipantRemoveSettleChecked(false)
  }

  async function confirmParticipantRemove(settleBalances?: boolean) {
    if (!participantPendingRemove) return
    await removeParticipantMutation.mutateAsync({
      groupId,
      ledgerParticipantId: participantPendingRemove.ledgerParticipantId,
      settleBalances,
    })
    setParticipantPendingRemove(null)
  }

  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [promoteMemberId, setPromoteMemberId] = useState<string | null>(null)

  const leavePreviewQuery = trpc.groups.leavePreview.useQuery(
    { groupId },
    {
      enabled: leaveDialogOpen,
      staleTime: 0,
      // The dialog may already be mounted when a balance-changing expense
      // mutation lands. `staleTime: 0` only marks the cache stale; it does
      // not refetch on a quiet mount. Force a fresh query each open so the
      // preview always reflects the latest settlement state.
      refetchOnMount: 'always',
    },
  )

  const leaveMutation = trpc.groups.leave.useMutation({
    onSuccess: async () => {
      mascot.react('acknowledge')
      toast({ description: t('leave.toast.left') })
      setLeaveDialogOpen(false)
      await navigate({ to: '/' })
      void invalidateAccountGroupLists(utils)
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
    !isLastActiveMember &&
    (!needsPromotion || !!effectivePromoteMemberId)

  function handleConfirmLeave() {
    if (!preview) return
    const shouldForce = preview.hasUnsettledBalance
    leaveMutation.mutate({
      groupId,
      force: shouldForce ? true : undefined,
      promoteMemberId: needsPromotion
        ? (effectivePromoteMemberId ?? undefined)
        : undefined,
    })
  }

  const listMembers = useMemo(() => {
    const members = membersQuery.data?.members ?? []
    const result: Array<
      (typeof members)[number] & {
        ledgerParticipantId: string
      }
    > = []
    for (const member of members) {
      if (member.ledgerParticipant?.id) {
        result.push({
          ...member,
          ledgerParticipantId: member.ledgerParticipant.id,
        })
      }
    }
    return result
  }, [membersQuery.data])
  const invitations = useMemo(
    () => invitationsQuery.data?.invitations ?? [],
    [invitationsQuery.data],
  )

  return {
    groupId,
    group,
    account,
    role,
    isArchived,
    isAdmin,
    canManage,
    canInvite,
    currentMemberId,
    membersQuery,
    invitationsQuery,
    listMembers,
    invitations,
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
    isLastAdmin,
    hasUnsettledBalance,
    isAdminLeaving,
    otherAdmins,
    promotableMembers,
    needsPromotion,
    canConfirmLeave,
    handleConfirmLeave,
    leaveMutation,
  }
}

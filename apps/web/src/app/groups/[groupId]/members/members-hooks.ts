import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { useMascotController } from '@/components/mascot/mascot-context'
import { useToast } from '@/components/ui/use-toast'
import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { useOptionalOfflineSync } from '@/lib/offline/provider'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'
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

export type QrSessionJoiner = {
  accountId: string
  name: string | null
  image: string | null
  joinedAt: Date | string
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
  isMultiUse: boolean
  useCount: number
  /** Per-link join cap for shared links (`null` = unlimited). */
  maxUses: number | null
  /** Member-facing label for shared links. */
  label: string | null
  /** Whether this is a copyable shared link (raw token stored server-side). */
  isShared: boolean
  /** Derived liveness: 'expired' | 'full' | null (still joinable). */
  endedReason: 'expired' | 'full' | null
  /** Accounts that joined via this QR session, oldest first. */
  recentJoiners: QrSessionJoiner[]
  canRevoke: boolean
  canManage: boolean
  /** Any active member may copy a live shared link's URL. */
  canCopyLink: boolean
  recipientProfile: RecipientProfile | null
}

/** Top-level tabs of the invite card. */
export type InviteTab = 'friends' | 'email' | 'link' | 'qr' | 'unlinked'

/**
 * A live QR session created from this browser: the only place the one-time
 * invite URL exists. Lifted to the invite card so tab switches keep the code.
 * `createdAt` (epoch ms) lets the tab tell "just created, list lags" apart from
 * "loaded from storage, list is authoritative" so revoked sessions cannot
 * survive a reload as zombie codes.
 */
export type QrSession = {
  invitationId: string
  inviteUrl: string
  expiresAt: Date | string | null
  createdAt: number
}

export function isQrSessionExpired(session: {
  expiresAt: Date | string | null
}): boolean {
  if (!session.expiresAt) return true
  const ms =
    typeof session.expiresAt === 'string'
      ? new Date(session.expiresAt).getTime()
      : session.expiresAt.getTime()
  return Date.now() >= ms
}

/**
 * Stamp a freshly created QR session. Module-level (not a component or handler)
 * so the clock read stays outside compiled render scope.
 */
export function createQrSession(input: {
  invitationId: string
  inviteUrl: string
  expiresAt: Date | string | null
}): QrSession {
  return { ...input, createdAt: Date.now() }
}

function qrSessionStorageKey(groupId: string) {
  return `spliit:qr-session:${groupId}`
}

function loadStoredQrSession(groupId: string): QrSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(qrSessionStorageKey(groupId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<QrSession>
    if (!parsed.invitationId || !parsed.inviteUrl || !parsed.expiresAt) {
      return null
    }
    const session: QrSession = {
      invitationId: parsed.invitationId,
      inviteUrl: parsed.inviteUrl,
      expiresAt: parsed.expiresAt,
      // Legacy stored sessions predate createdAt: treat them as stale so the
      // tab drops them on the first fresh list instead of showing a zombie.
      createdAt:
        typeof parsed.createdAt === 'number' && parsed.createdAt > 0
          ? parsed.createdAt
          : 0,
    }
    return isQrSessionExpired(session) ? null : session
  } catch {
    return null
  }
}

/**
 * The one-time QR invite URL lives here so tab switches (which unmount inactive
 * panels) and reloads never lose the displayed code. Revoking or expiring
 * through any path must funnel through the setter so the stored copy cannot
 * outlive the session (zombie codes).
 */
export function useQrSession(groupId: string) {
  const [qrSession, setQrSessionState] = useState<QrSession | null>(() =>
    loadStoredQrSession(groupId),
  )
  // Client-side group navigation reuses the page without remounting: rebind
  // the session when the group changes so group A's code never shows on B.
  const [boundGroupId, setBoundGroupId] = useState(groupId)
  if (boundGroupId !== groupId) {
    setBoundGroupId(groupId)
    setQrSessionState(loadStoredQrSession(groupId))
  }
  const setQrSession = useMemo(
    () => (next: QrSession | null) => {
      setQrSessionState(next)
      try {
        if (next) {
          window.localStorage.setItem(
            qrSessionStorageKey(groupId),
            JSON.stringify(next),
          )
        } else {
          window.localStorage.removeItem(qrSessionStorageKey(groupId))
        }
      } catch {
        // Storage is a convenience cache; the tab works without it.
      }
    },
    [groupId],
  )
  return [qrSession, setQrSession] as const
}

export type UpdatePendingInput = {
  invitationId: string
  role: InvitableRole
  temporaryName?: string
  delivery: { type: 'EMAIL'; email: string } | { type: 'LINK' }
  shared?: {
    label?: string | null
    maxUses?: number | null
    /**
     * Fresh duration from save time; `null` = never expires, `undefined` = no
     * change (the row's `expiresAt` stays untouched).
     */
    expiresIn?: { amount: number; unit: 'hours' | 'days' | 'weeks' } | null
  }
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

export type SharedLinkExpiryUnit = 'hours' | 'days' | 'weeks'

/** A shared-link expiry duration; `null` = never expires. */
export type SharedLinkExpiry = {
  amount: number
  unit: SharedLinkExpiryUnit
} | null

export type SharedLinkFormValues = {
  mode: 'oneTime' | 'shared'
  /** Optional label for a shared link (≤40 chars). */
  label?: string | undefined
  /** Picker preset for the join cap (`other` reveals the custom input). */
  joinLimitPreset: string
  /** Join cap for a shared link; null = unlimited. */
  maxUses: number | null
  /** Picker preset for the expiry (`other` reveals the custom input). */
  expiryPreset: string
  /** Expiry duration for a shared link; null = never expires. */
  expiresIn: SharedLinkExpiry
}

export const SHARED_LINK_DEFAULT_EXPIRY: {
  amount: number
  unit: SharedLinkExpiryUnit
} = { amount: 7, unit: 'days' }
export {
  SHARED_LINK_MIN_USES,
  SHARED_LINK_MAX_USES_LIMIT,
  SHARED_LINK_LABEL_MAX_LENGTH,
} from '@spliit/domain/invitations'

/**
 * Capped join-limit presets for the picker. Unlimited is the default and a
 * separate option; anything else goes through the "Other" custom input.
 */
export const SHARED_LINK_JOIN_PRESETS = [5, 10, 25] as const

/** Expiry presets for the picker (durations from creation/save time). */
export const SHARED_LINK_EXPIRY_PRESETS: ReadonlyArray<{
  key: 'quick24h' | 'quick7d' | 'quick30d'
  amount: number
  unit: SharedLinkExpiryUnit
}> = [
  { key: 'quick24h', amount: 24, unit: 'hours' },
  { key: 'quick7d', amount: 7, unit: 'days' },
  { key: 'quick30d', amount: 30, unit: 'days' },
]

/** The "Other" custom-input fallback when a value matches no preset. */
export const SHARED_LINK_CUSTOM_PRESET = 'other'

/**
 * Resolve the picker preset for a join cap: `null` is unlimited, a preset value
 * maps to its entry, anything else (including out-of-range numbers) falls back
 * to the custom input.
 */
export function joinLimitPresetFor(
  maxUses: number | null,
): 'unlimited' | number | typeof SHARED_LINK_CUSTOM_PRESET {
  if (maxUses == null) return 'unlimited'
  return (SHARED_LINK_JOIN_PRESETS as readonly number[]).includes(maxUses)
    ? maxUses
    : SHARED_LINK_CUSTOM_PRESET
}

export const sharedLinkFormDefaults: SharedLinkFormValues = {
  mode: 'oneTime',
  label: '',
  // New links default to unlimited joins for a limited time (7 days):
  // the caps are opt-in through the pickers, not opt-out checkboxes.
  joinLimitPreset: 'unlimited',
  maxUses: null,
  expiryPreset: 'quick7d',
  expiresIn: SHARED_LINK_DEFAULT_EXPIRY,
}

export type GeneratedLink = {
  inviteUrl: string
  temporaryName: string | null
  role: InvitableRole
  expiresAt: Date | string | null
  /** Present for shared links (label/limits echoed for the summary). */
  isShared?: boolean
  maxUses?: number | null
  label?: string | null
}

const dateFormatCache = new Map<string, Intl.DateTimeFormat>()
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>()

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

function getDateTimeFormat(locale: string, timeZone: string) {
  const key = `${locale}:${timeZone}`
  let fmt = dateTimeFormatCache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(resolveFormattingLocale(locale), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    })
    dateTimeFormatCache.set(key, fmt)
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

/**
 * Exact date + time for invite expiry displays ("Oct 26, 2026, 2:30 PM"):
 * pending rows, the result panel, and the projected summary all pin the moment
 * the link dies, not just the day.
 */
export function formatDateTime(
  value: string | Date,
  locale: string,
  timeZone = 'UTC',
) {
  const date = typeof value === 'string' ? new Date(value) : value
  return getDateTimeFormat(locale, timeZone).format(date)
}

export function useMembersDialogs() {
  const { groupId, group, currentMember } = useCurrentGroup()
  const { data: account } = useCurrentAccount()
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { toast } = useToast()
  const mascot = useMascotController()
  const navigate = useNavigate()
  const isOnline = useOnlineStatus()

  // Member administration is connection-required: never launch member/invite
  // network queries while offline; the body renders OfflineNeedsConnection
  // instead of a false empty list.
  const membersQuery = trpc.account.members.useQuery(
    { groupId },
    { enabled: isOnline },
  )
  const invitationsQuery = trpc.invitations.list.useQuery(
    { groupId },
    { enabled: isOnline },
  )

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
    onSuccess: async (data, vars) => {
      toast({
        description: data.emailDelivered
          ? t('invitations.created', { email: vars.email })
          : t('invitations.createdWithoutEmail', { email: vars.email }),
      })
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

  const createSharedLinkMutation =
    trpc.invitations.createSharedLink.useMutation({
      onSuccess: async () => {
        toast({ description: t('invite.link.sharedCreated') })
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

  const offlineSync = useOptionalOfflineSync()
  const leaveMutation = trpc.groups.leave.useMutation({
    onSuccess: async () => {
      await offlineSync?.handleGroupRemoved({ groupId })
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
    createSharedLinkMutation,
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

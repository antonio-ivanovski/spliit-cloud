'use client'

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { useRouter } from '@/lib/navigation'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link2, Share2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { useCurrentGroup } from '../current-group-context'
import { LinkUnlinkedParticipantDialog } from './link-unlinked-participant-dialog'

// Invited and active members can only be ADMIN or MEMBER. Group creators
// start as ADMIN, and admins promote/demote other members from the
// members page.
type InvitableRole = 'ADMIN' | 'MEMBER'

type MemberRole = 'ADMIN' | 'MEMBER'

function roleLabel(
  role: MemberRole,
  labels: {
    ADMIN: string
    MEMBER: string
  },
) {
  switch (role) {
    case 'ADMIN':
      return labels.ADMIN
    case 'MEMBER':
      return labels.MEMBER
  }
}

function badgeVariantForRole(role: MemberRole): 'secondary' | 'outline' {
  switch (role) {
    case 'ADMIN':
      return 'secondary'
    case 'MEMBER':
      return 'outline'
  }
}

const emailFormSchema = z.object({
  email: z.string().email(),
  // Optional pending-only label. Wins over the email in the participant
  // picker / activity feed while the invitation is still PENDING.
  // After acceptance, `Account.name` resolves the participant.
  temporaryName: z.string().trim().max(120).optional(),
})

type EmailFormValues = z.infer<typeof emailFormSchema>

const linkFormSchema = z.object({
  temporaryName: z.string().trim().max(120).optional(),
})

type LinkFormValues = z.infer<typeof linkFormSchema>

type GeneratedLink = {
  inviteUrl: string
  temporaryName: string | null
  role: InvitableRole
  expiresAt: Date | string
}

function formatDate(value: string | Date, locale: string) {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export default function GroupMembers() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const { toast } = useToast()
  const { groupId, group, currentMember } = useCurrentGroup()
  const { data: account } = useCurrentAccount()

  const membersQuery = trpc.account.members.useQuery({ groupId })
  const invitationsQuery = trpc.invitations.list.useQuery({ groupId })

  const role = currentMember?.role
  const isArchived = !!group?.archived
  const isAdmin = role === 'ADMIN'
  const canManage = !isArchived && isAdmin
  const currentMemberId = currentMember?.id ?? null

  const roleLabels = {
    ADMIN: t('role.admin'),
    MEMBER: t('role.member'),
  } as const

  const form = useForm<EmailFormValues>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { email: '', temporaryName: '' },
  })

  const linkForm = useForm<LinkFormValues>({
    defaultValues: { temporaryName: '' },
  })

  const email = form.watch('email')
  const [roleValue, setRoleValue] = useState<InvitableRole>('MEMBER')
  const [linkRoleValue, setLinkRoleValue] = useState<InvitableRole>('MEMBER')
  const [generatedLink, setGeneratedLink] = useState<GeneratedLink | null>(null)
  const [inviteTab, setInviteTab] = useState<'email' | 'link'>('email')
  // `navigator.share` exists on iOS Safari, Android Chrome, and a few
  // desktop browsers. We probe on mount so SSR doesn't trip and so the
  // Share button only renders on capable devices.
  const [canShare, setCanShare] = useState(false)
  useEffect(() => {
    setCanShare(
      typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    )
  }, [])
  useEffect(() => {
    if (canManage) setRoleValue('MEMBER')
  }, [canManage])
  useEffect(() => {
    if (canManage) setLinkRoleValue('MEMBER')
  }, [canManage])

  const utils = trpc.useUtils()
  const createMutation = trpc.invitations.create.useMutation({
    onSuccess: async (_data, vars) => {
      toast({ description: t('invitations.created', { email: vars.email }) })
      form.reset({ email: '', temporaryName: '' })
      // Invalidate every cache that surfaces the group roster so the
      // newly-invited member appears in the expense form's "paid by" /
      // "paid for" selectors and on the edit page without a manual refresh.
      // `groups.get` and `groups.getDetails` each cache their own `group`
      // payload; `account.members` is what the members tab itself reads.
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
    onSuccess: async (data) => {
      setGeneratedLink({
        inviteUrl: data.inviteUrl,
        temporaryName: data.temporaryName,
        role: data.role as InvitableRole,
        expiresAt: data.expiresAt,
      })
      toast({ description: t('invite.link.created') })
      linkForm.reset({ temporaryName: '' })
      // The pending invitee list and the group roster cache both need
      // to refresh so the new link invitation shows up immediately.
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

  const updateRoleMutation = trpc.groups.members.updateRole.useMutation({
    onSuccess: async (_data, vars) => {
      const newRoleLabel = roleLabel(vars.role, roleLabels)
      toast({
        description: t('roleUpdated', { role: newRoleLabel }),
      })
      await Promise.all([
        utils.account.members.invalidate({ groupId }),
        utils.groups.get.invalidate({ groupId }),
        utils.groups.getDetails.invalidate({ groupId }),
        // The leave-preview snapshot caches role/admin-count/promotable
        // members; without an explicit invalidate, the dialog would keep
        // rendering the pre-change state if the user immediately opens
        // the leave dialog after a role flip.
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

  const [memberPendingRemove, setMemberPendingRemove] = useState<{
    id: string
    name: string
  } | null>(null)

  // ---- Remove-member unsettled-balance confirmation ----
  // When the admin clicks "Remove" on a member we open a dialog that
  // first fetches `removePreview` to decide whether the member has
  // unsettled balances. If they do, the dialog grows an extra warning
  // panel and two confirm options (settle+remove, remove-only) so the
  // admin can pick how the balances are handled before the mutation
  // runs. The query is lazy so it only runs while the dialog is open
  // and re-fetches each time the dialog is reopened with a different
  // target member.
  const removePreviewQuery = trpc.groups.members.removePreview.useQuery(
    { groupId, memberId: memberPendingRemove?.id ?? '' },
    { enabled: !!memberPendingRemove },
  )

  // Checkbox state for the "create settle reimbursement first" option in
  // the remove dialog. Off by default so the destructive action stays
  // one click; opting in prepends a settlement-expense pass to the
  // mutation. Reset every time the dialog opens for a different member.
  const [removeSettleChecked, setRemoveSettleChecked] = useState(false)

  // ---- Revoke-invitation unsettled-balance confirmation ----
  // Mirrors the remove flow: opening the dialog fetches `revokePreview`
  // to decide whether the invitee has unsettled balances. We track
  // `label` (temporaryName ?? email) so the dialog can address the
  // invitee naturally.
  const [invitationPendingRevoke, setInvitationPendingRevoke] = useState<{
    id: string
    email: string
    label: string
  } | null>(null)
  const revokePreviewQuery = trpc.invitations.revokePreview.useQuery(
    {
      groupId,
      invitationId: invitationPendingRevoke?.id ?? '',
    },
    { enabled: !!invitationPendingRevoke },
  )

  // Same pattern as the remove dialog: unchecked by default; opting in
  // prepends a settlement-expense pass to the revoke mutation.
  const [revokeSettleChecked, setRevokeSettleChecked] = useState(false)

  // ---- Leave group flow ----
  // The dialog is opened by the "Leave group" button at the bottom of the
  // page. We fetch the preview lazily so the balance/admin-count queries
  // only run while the dialog is open. The preview drives the conditional
  // sections (delete warning + checkbox, promotion selector, unsettled
  // balance warning) and the confirm-button enablement.
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [promoteMemberId, setPromoteMemberId] = useState<string | null>(null)
  const [confirmDeleteChecked, setConfirmDeleteChecked] = useState(false)
  const router = useRouter()

  const leavePreviewQuery = trpc.groups.leavePreview.useQuery(
    { groupId },
    { enabled: leaveDialogOpen },
  )

  const leaveMutation = trpc.groups.leave.useMutation({
    onSuccess: async (result) => {
      // Navigate FIRST. The user just left (and possibly deleted) the
      // group, so any in-flight refetch of `groups.get({ groupId })` or
      // `groups.getDetails({ groupId })` would now return 403. By
      // navigating away we unmount the group route before those
      // invalidations have a chance to fire. We only refresh the
      // account-scoped group list, which is the only query that still
      // makes sense to refetch.
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

  // Non-destructive alternative to the last-member leave flow. Instead
  // of deleting the group, archives it globally and hides it from the
  // caller's main list. Membership is preserved — the user keeps access
  // to the ledger as a read-only record.
  const archiveForSelfMutation = trpc.groups.archiveForSelf.useMutation({
    onSuccess: async () => {
      // Same reasoning as `leaveMutation.onSuccess`: navigate away
      // before invalidating per-group queries that would now return
      // FORBIDDEN.
      toast({ description: t('leave.toast.archived') })
      setLeaveDialogOpen(false)
      router.push({ href: '/' })
      utils.account.groups.invalidate()
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  // Reset the dialog-scoped state every time it closes so the next open
  // starts from a clean slate (no stale promotion target or checkbox).
  useEffect(() => {
    if (!leaveDialogOpen) {
      setPromoteMemberId(null)
      setConfirmDeleteChecked(false)
    }
  }, [leaveDialogOpen])

  // Reset the "settle before action" checkboxes when their dialogs close
  // so the next open defaults to unchecked (the safe destructive default).
  useEffect(() => {
    if (!memberPendingRemove) setRemoveSettleChecked(false)
  }, [memberPendingRemove])
  useEffect(() => {
    if (!invitationPendingRevoke) setRevokeSettleChecked(false)
  }, [invitationPendingRevoke])

  const preview = leavePreviewQuery.data
  const isLastActiveMember = !!preview?.isLastActiveMember
  const isLastAdmin = !!preview?.isLastAdmin
  const hasUnsettledBalance = !!preview?.hasUnsettledBalance
  // `preview.role` is the caller's role on the group. The "admins in
  // control" note only makes sense when the caller is themselves an ADMIN
  // handing control over; a regular MEMBER leaving doesn't change who is
  // in charge.
  const isAdminLeaving = preview?.role === 'ADMIN'
  const otherAdmins = preview?.otherAdmins ?? []
  const promotableMembers = preview?.promotableMembers ?? []

  // Preselect the oldest active member (preview sorts promotableMembers
  // by `joinedAt ASC, createdAt ASC`) so the user has a sensible default
  // and only needs to confirm unless they want a different admin. Re-runs
  // when the preview's membership list changes (e.g. after a role flip
  // invalidates the cache) so the default stays in sync.
  useEffect(() => {
    if (!preview) return
    const oldest = promotableMembers[0]
    const isCurrentValid =
      !!promoteMemberId &&
      promotableMembers.some((m) => m.id === promoteMemberId)
    if (oldest && !isCurrentValid) {
      setPromoteMemberId(oldest.id)
    }
    // `promoteMemberId` is intentionally excluded — it is the value being
    // reconciled against the freshly-loaded preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

  // The promotion selector only matters when the caller is the last admin
  // AND there are other active members to take over. When the caller is
  // the last active member the group is being deleted, so no promotion
  // is required and the selector is hidden entirely.
  const needsPromotion = isLastAdmin && !isLastActiveMember

  // The confirm button is disabled until every required input is in place.
  // Promotion is only required when `needsPromotion`; the delete checkbox
  // is only required when the caller is the last active member. Force
  // settlement is implicit — we always pass `force: true` when the caller
  // has unsettled balances, and the warning copy in the dialog is the
  // confirmation.
  const canConfirmLeave =
    !!preview &&
    !leaveMutation.isPending &&
    (!needsPromotion || !!promoteMemberId) &&
    (!isLastActiveMember || confirmDeleteChecked)

  function handleConfirmLeave() {
    if (!preview) return
    // Force-settlement is only meaningful when the group is going to
    // survive the leave. For the last-member path the group is deleted,
    // so any settlement expense we wrote would be cascade-removed along
    // with everything else — there is no point in creating them.
    const shouldForce = !isLastActiveMember && preview.hasUnsettledBalance
    leaveMutation.mutate({
      groupId,
      force: shouldForce ? true : undefined,
      promoteMemberId: needsPromotion
        ? (promoteMemberId ?? undefined)
        : undefined,
      confirmDelete: isLastActiveMember ? confirmDeleteChecked : undefined,
    })
  }

  const onInvite = form.handleSubmit(async (values) => {
    const temporaryName = values.temporaryName?.trim()
    await createMutation.mutateAsync({
      groupId,
      email: values.email,
      role: roleValue,
      temporaryName: temporaryName ? temporaryName : undefined,
    })
  })

  const onGenerateLink = linkForm.handleSubmit(async (values) => {
    const temporaryName = values.temporaryName?.trim()
    await createLinkMutation.mutateAsync({
      groupId,
      role: linkRoleValue,
      temporaryName: temporaryName ? temporaryName : undefined,
    })
  })

  // Mobile share via the Web Share API. The share sheet receives a
  // human-friendly text body (not just a bare URL) so the recipient
  // gets context in messaging apps. `navigator.share` is undefined on
  // most desktop browsers; the button is only rendered when probing
  // detected it.
  async function handleShareLink() {
    if (!generatedLink || !canShare) return
    const groupName = group?.name ?? ''
    try {
      await navigator.share({
        title: t('invite.link.shareTitle', { groupName }),
        text: t('invite.link.shareText', {
          groupName,
          inviteUrl: generatedLink.inviteUrl,
        }),
      })
    } catch (err) {
      // `AbortError` means the user dismissed the share sheet — not a
      // real failure. Other errors are logged so they show up in the
      // dev console but don't interrupt the UX.
      if (err instanceof Error && err.name !== 'AbortError') {
        console.warn('[invite] share failed:', err)
      }
    }
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

  async function confirmRevoke() {
    if (!invitationPendingRevoke) return
    // When the invitee has unsettled balances, the API requires
    // `settleBalances: true` (and the button is gated on the checkbox
    // below), so the value is always `true` here when there are
    // balances. When there are no balances, `settleBalances` is left
    // unset — the API treats it as a no-op settle pass.
    const settleBalances = revokePreviewQuery.data?.hasUnsettledBalance
      ? true
      : undefined
    await revokeMutation.mutateAsync({
      invitationId: invitationPendingRevoke.id,
      settleBalances,
    })
    setInvitationPendingRevoke(null)
  }

  const listMembers = useMemo(
    () => membersQuery.data?.members ?? [],
    [membersQuery.data],
  )
  const invitations = useMemo(
    () => invitationsQuery.data?.invitations ?? [],
    [invitationsQuery.data],
  )

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {membersQuery.isLoading ? (
            <div className="flex flex-col gap-3 py-1">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : listMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">{t('empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {listMembers.map((member) => {
                const isMe = !!account?.id && member.account?.id === account.id
                const displayName = member.account?.name || t('unknownMember')
                const isSelfRow =
                  member.id !== undefined && member.id === currentMemberId
                const showAdminControls = canManage && !isSelfRow
                return (
                  <li
                    key={member.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground truncate">
                          {displayName}
                        </span>
                        {isMe && (
                          <Badge variant="outline" className="shrink-0">
                            {t('youBadge')}
                          </Badge>
                        )}
                        <Badge
                          variant={badgeVariantForRole(member.role)}
                          className="shrink-0"
                        >
                          {roleLabel(member.role, roleLabels)}
                        </Badge>
                      </div>
                      {member.account?.email && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {member.account.email}
                        </p>
                      )}
                      {member.joinedAt && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('joinedOn', {
                            date: formatDate(member.joinedAt, locale),
                          })}
                        </p>
                      )}
                    </div>
                    {showAdminControls && member.id && (
                      <div className="flex shrink-0 items-center gap-2">
                        {member.role === 'ADMIN' || member.role === 'MEMBER' ? (
                          <Select
                            value={member.role}
                            disabled={updateRoleMutation.isPending}
                            onValueChange={(value) =>
                              updateRoleMutation.mutate({
                                groupId,
                                memberId: member.id!,
                                role: value as 'ADMIN' | 'MEMBER',
                              })
                            }
                          >
                            <SelectTrigger
                              className="w-[8rem]"
                              aria-label={t('changeRoleAria')}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MEMBER">
                                {t('role.member')}
                              </SelectItem>
                              <SelectItem value="ADMIN">
                                {t('role.admin')}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={removeMemberMutation.isPending}
                          onClick={() =>
                            setMemberPendingRemove({
                              id: member.id!,
                              name: displayName,
                            })
                          }
                        >
                          {t('remove')}
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <UnlinkedParticipantsSection groupId={groupId} canManage={canManage} />

      {!canManage && (
        <p className="text-sm text-muted-foreground">
          {isArchived && isAdmin
            ? t('archivedNotice')
            : t('noManagePermission')}
        </p>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{t('invite.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs
              value={inviteTab}
              onValueChange={(value) => setInviteTab(value as 'email' | 'link')}
              className="flex flex-col gap-4"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="email">{t('invite.tab.email')}</TabsTrigger>
                <TabsTrigger value="link">{t('invite.tab.link')}</TabsTrigger>
              </TabsList>

              <TabsContent value="email" className="mt-0 flex flex-col gap-4">
                <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
                  {t('invite.emailDescription')}
                </p>
                <Form {...form}>
                  <form onSubmit={onInvite} className="flex flex-col gap-3">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('invite.email')}</FormLabel>
                          <FormControl>
                            <Input
                              className="text-base"
                              type="email"
                              inputMode="email"
                              autoComplete="email"
                              spellCheck={false}
                              placeholder={t('invite.emailPlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="temporaryName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('invite.temporaryName')}</FormLabel>
                          <FormControl>
                            <Input
                              className="text-base"
                              type="text"
                              spellCheck={false}
                              autoComplete="off"
                              placeholder={t('invite.temporaryNamePlaceholder')}
                              {...field}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                      <FormItem className="space-y-0 sm:w-[10rem]">
                        <FormLabel className="sm:sr-only">
                          {t('invite.role')}
                        </FormLabel>
                        <FormControl>
                          <Select
                            value={roleValue}
                            onValueChange={(value) =>
                              setRoleValue(value as InvitableRole)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MEMBER">
                                {t('role.member')}
                              </SelectItem>
                              <SelectItem value="ADMIN">
                                {t('role.admin')}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                      </FormItem>
                      <Button
                        type="submit"
                        disabled={createMutation.isPending || !email}
                      >
                        <UserPlus className="w-4 h-4 mr-2" />
                        {t('invite.send')}
                      </Button>
                    </div>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="link" className="mt-0 flex flex-col gap-4">
                <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
                  {t('invite.linkDescription')}
                </p>
                <Form {...linkForm}>
                  <form
                    onSubmit={onGenerateLink}
                    className="flex flex-col gap-3"
                  >
                    <FormField
                      control={linkForm.control}
                      name="temporaryName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('invite.temporaryName')}</FormLabel>
                          <FormControl>
                            <Input
                              className="text-base"
                              type="text"
                              spellCheck={false}
                              autoComplete="off"
                              placeholder={t('invite.temporaryNamePlaceholder')}
                              {...field}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                      <FormItem className="space-y-0 sm:w-[10rem]">
                        <FormLabel className="sm:sr-only">
                          {t('invite.role')}
                        </FormLabel>
                        <FormControl>
                          <Select
                            value={linkRoleValue}
                            onValueChange={(value) =>
                              setLinkRoleValue(value as InvitableRole)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MEMBER">
                                {t('role.member')}
                              </SelectItem>
                              <SelectItem value="ADMIN">
                                {t('role.admin')}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                      </FormItem>
                      <Button
                        type="submit"
                        disabled={createLinkMutation.isPending}
                      >
                        <Link2 className="w-4 h-4 mr-2" />
                        {createLinkMutation.isPending
                          ? t('invite.link.generating')
                          : generatedLink
                            ? t('invite.link.generateNew')
                            : t('invite.link.generate')}
                      </Button>
                    </div>
                  </form>
                </Form>

                {generatedLink && (
                  <div
                    className="mt-4 flex flex-col gap-3"
                    data-testid="generated-invite-link"
                  >
                    <p className="text-sm text-muted-foreground">
                      {t('invite.link.intro', {
                        groupName: group?.name ?? '',
                      })}
                    </p>
                    <p className="border-l-2 border-amber-500/50 pl-3 text-sm text-amber-900 dark:text-amber-200">
                      {t('invite.link.singleUse')}
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={generatedLink.inviteUrl}
                        className="font-mono text-xs"
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <CopyButton text={generatedLink.inviteUrl} />
                      {canShare && (
                        <Button
                          size="icon"
                          variant="secondary"
                          type="button"
                          onClick={handleShareLink}
                          aria-label={t('invite.link.share')}
                        >
                          <Share2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('invite.link.expiresOn', {
                        date: formatDate(generatedLink.expiresAt, locale),
                      })}
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{t('invitations.title')}</CardTitle>
            <CardDescription>{t('invitations.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {invitationsQuery.isLoading ? (
              <div className="flex flex-col gap-3 py-1">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                {t('invitations.empty')}
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {invitations.map((invitation) => {
                  // Pending-only display label. For LINK invitations the
                  // stored email is a synthetic placeholder
                  // (e.g. `tok…@link.placeholder.local`), so the
                  // temporaryName (when present) or the generic
                  // "Invite link" fallback is what the user actually
                  // wants to see. EMAIL invitations still use the raw
                  // email.
                  const isLink = invitation.type === 'LINK'
                  const label = isLink
                    ? (invitation.temporaryName ??
                      t('invitations.link.fallbackLabel'))
                    : (invitation.temporaryName ?? invitation.email)
                  return (
                    <li
                      key={invitation.id}
                      className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground truncate">
                            {label}
                          </span>
                          <Badge variant="secondary" className="shrink-0">
                            {roleLabel(invitation.role, roleLabels)}
                          </Badge>
                          {isLink && (
                            <Badge variant="outline" className="shrink-0">
                              {t('invitations.link.type')}
                            </Badge>
                          )}
                          <Badge variant="outline" className="shrink-0">
                            {invitation.status}
                          </Badge>
                        </div>
                        {invitation.createdAt && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t('invitations.sentOn', {
                              date: formatDate(invitation.createdAt, locale),
                            })}
                          </p>
                        )}
                      </div>
                      {invitation.status === 'PENDING' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive shrink-0"
                          disabled={revokeMutation.isPending}
                          onClick={() =>
                            setInvitationPendingRevoke({
                              id: invitation.id,
                              email: invitation.email,
                              label,
                            })
                          }
                        >
                          {t('invitations.revokeButton')}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!memberPendingRemove}
        onOpenChange={(open) => {
          if (!open) setMemberPendingRemove(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {removePreviewQuery.data?.hasUnsettledBalance
                ? t('removeDialog.unsettled.title')
                : t('removeDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {memberPendingRemove
                ? removePreviewQuery.data?.hasUnsettledBalance
                  ? t('removeDialog.unsettled.description', {
                      name: memberPendingRemove.name,
                    })
                  : t('removeDialog.description', {
                      name: memberPendingRemove.name,
                    })
                : null}
            </DialogDescription>
          </DialogHeader>

          {removePreviewQuery.isLoading ? (
            <div className="flex flex-col gap-2 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : removePreviewQuery.data?.hasUnsettledBalance ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
                <p className="text-sm font-medium">
                  {t('removeDialog.unsettled.warning.title')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('removeDialog.unsettled.warning.description')}
                </p>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={removeSettleChecked}
                    onCheckedChange={(checked) =>
                      setRemoveSettleChecked(checked === true)
                    }
                    disabled={removeMemberMutation.isPending}
                    className="mt-0.5"
                  />
                  <span>{t('removeDialog.unsettled.checkbox')}</span>
                </label>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setMemberPendingRemove(null)}
              disabled={removeMemberMutation.isPending}
            >
              {t('removeDialog.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                confirmRemove(
                  removePreviewQuery.data?.hasUnsettledBalance
                    ? removeSettleChecked
                    : undefined,
                )
              }
              disabled={
                removeMemberMutation.isPending || removePreviewQuery.isLoading
              }
            >
              {t('removeDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!invitationPendingRevoke}
        onOpenChange={(open) => {
          if (!open) setInvitationPendingRevoke(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {revokePreviewQuery.data?.hasUnsettledBalance
                ? t('invitations.revokeDialog.unsettled.title')
                : t('invitations.revokeDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {invitationPendingRevoke
                ? revokePreviewQuery.data?.hasUnsettledBalance
                  ? t('invitations.revokeDialog.unsettled.description', {
                      email: invitationPendingRevoke.label,
                    })
                  : t('invitations.revokeDialog.description', {
                      email: invitationPendingRevoke.label,
                    })
                : null}
            </DialogDescription>
          </DialogHeader>

          {revokePreviewQuery.isLoading ? (
            <div className="flex flex-col gap-2 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : revokePreviewQuery.data?.hasUnsettledBalance ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
                <p className="text-sm font-medium">
                  {t('invitations.revokeDialog.unsettled.warning.title')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('invitations.revokeDialog.unsettled.warning.description')}
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={revokeSettleChecked}
                  onCheckedChange={(checked) =>
                    setRevokeSettleChecked(checked === true)
                  }
                  disabled={revokeMutation.isPending}
                  className="mt-0.5"
                />
                <span>{t('invitations.revokeDialog.unsettled.checkbox')}</span>
              </label>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setInvitationPendingRevoke(null)}
              disabled={revokeMutation.isPending}
            >
              {t('invitations.revokeDialog.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRevoke()}
              disabled={
                revokeMutation.isPending ||
                revokePreviewQuery.isLoading ||
                // When the invitee has unsettled balances, the API
                // rejects any revoke that doesn't settle first, so the
                // button stays disabled until the settle box is ticked.
                (revokePreviewQuery.data?.hasUnsettledBalance === true &&
                  !revokeSettleChecked)
              }
            >
              {t('invitations.revokeDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog
        open={leaveDialogOpen}
        onOpenChange={(open) => {
          if (!open && leaveMutation.isPending) return
          setLeaveDialogOpen(open)
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('leave.title')}</DialogTitle>
            <DialogDescription>{t('leave.description')}</DialogDescription>
          </DialogHeader>

          {leavePreviewQuery.isLoading || !preview ? (
            <div className="flex flex-col gap-3 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {isAdminLeaving && otherAdmins.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('leave.body.otherAdmins', {
                    names: otherAdmins
                      .map((admin) => admin.name || '—')
                      .join(', '),
                  })}
                </p>
              )}

              {needsPromotion && (
                <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
                  <p className="text-sm font-medium">
                    {t('leave.body.lastAdmin.title')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('leave.body.lastAdmin.description')}
                  </p>
                  <div className="flex flex-col gap-1.5 pt-1">
                    <Label htmlFor="promote-member">
                      {t('leave.body.lastAdmin.title')}
                    </Label>
                    <Select
                      value={promoteMemberId ?? ''}
                      onValueChange={(value) => setPromoteMemberId(value)}
                      disabled={leaveMutation.isPending}
                    >
                      <SelectTrigger id="promote-member">
                        <SelectValue
                          placeholder={t('leave.body.lastAdmin.placeholder')}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {promotableMembers.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name || '—'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {hasUnsettledBalance && !isLastActiveMember && (
                <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
                  <p className="text-sm font-medium">
                    {t('leave.body.unsettled.title')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('leave.body.unsettled.description')}
                  </p>
                </div>
              )}

              {isLastActiveMember && (
                <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive">
                    {t('leave.body.lastMember.title')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('leave.body.lastMember.description')}
                  </p>
                  {hasUnsettledBalance && (
                    <p className="text-sm text-muted-foreground">
                      {t('leave.body.lastMember.unsettledInfo')}
                    </p>
                  )}
                  <label className="flex items-start gap-2 pt-1 text-sm cursor-pointer">
                    <Checkbox
                      checked={confirmDeleteChecked}
                      onCheckedChange={(checked) =>
                        setConfirmDeleteChecked(checked === true)
                      }
                      disabled={leaveMutation.isPending}
                      className="mt-0.5"
                    />
                    <span>{t('leave.body.lastMember.checkbox')}</span>
                  </label>
                  <p className="text-xs text-muted-foreground pt-2 border-t border-destructive/20">
                    {t('leave.body.lastMember.suggestion')}
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setLeaveDialogOpen(false)}
              disabled={
                leaveMutation.isPending || archiveForSelfMutation.isPending
              }
            >
              {t('leave.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmLeave}
              disabled={!canConfirmLeave}
            >
              {isLastActiveMember && preview
                ? t('leave.confirmDelete')
                : hasUnsettledBalance && preview
                  ? t('leave.confirmWithForce')
                  : t('leave.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Post-import admin section: render the unlinked
 * `LedgerParticipant` rows in the group (e.g. imported as
 * UNLINKED_PARTICIPANT) and let the admin link each to an account
 * by typing its email. The lookup is server-side via the
 * `importLinks.link` procedure, which falls back to
 * `email → accountId` resolution when only an email is supplied.
 *
 * The section only renders for admins (`canManage`) and only
 * surfaces unlinked rows when the group actually has any — the
 * list is hidden otherwise to keep the Members tab quiet for
 * groups that don't need it.
 */
function UnlinkedParticipantsSection({
  groupId,
  canManage,
}: {
  groupId: string
  canManage: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { data, isLoading } = trpc.groups.importLinks.listUnlinked.useQuery({
    groupId,
  })

  const [linkTarget, setLinkTarget] = useState<{
    id: string
    displayName: string
  } | null>(null)

  if (!canManage) return null
  const unlinked = data?.unlinked ?? []
  if (!isLoading && unlinked.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('unlinked.title')}</CardTitle>
        <CardDescription>{t('unlinked.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-3 py-1">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {unlinked.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {p.displayName || t('unknownMember')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('unlinked.idHint', { id: p.id })}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLinkTarget({
                      id: p.id,
                      displayName: p.displayName || t('unknownMember'),
                    })
                  }
                >
                  {t('unlinked.linkButton')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <LinkUnlinkedParticipantDialog
        groupId={groupId}
        unlinkedParticipantId={linkTarget?.id ?? ''}
        displayName={linkTarget?.displayName ?? ''}
        open={!!linkTarget}
        onOpenChange={(open) => {
          if (!open) setLinkTarget(null)
        }}
      />
    </Card>
  )
}

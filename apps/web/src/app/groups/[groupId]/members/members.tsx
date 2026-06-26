'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { useCurrentGroup } from '../current-group-context'

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
})

type EmailFormValues = z.infer<typeof emailFormSchema>

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
    defaultValues: { email: '' },
  })

  const email = form.watch('email')
  const [roleValue, setRoleValue] = useState<InvitableRole>('MEMBER')
  useEffect(() => {
    if (canManage) setRoleValue('MEMBER')
  }, [canManage])

  const utils = trpc.useUtils()
  const createMutation = trpc.invitations.create.useMutation({
    onSuccess: async (_data, vars) => {
      toast({ description: t('invitations.created', { email: vars.email }) })
      form.reset({ email: '' })
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
      ])
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const revokeMutation = trpc.invitations.revoke.useMutation({
    onSuccess: async () => {
      toast({ description: t('invitations.revoked') })
      await utils.invitations.list.invalidate({ groupId })
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
      ])
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const removeMemberMutation = trpc.groups.members.remove.useMutation({
    onSuccess: async () => {
      toast({ description: t('removed') })
      await Promise.all([
        utils.account.members.invalidate({ groupId }),
        utils.groups.get.invalidate({ groupId }),
        utils.groups.getDetails.invalidate({ groupId }),
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

  const onInvite = form.handleSubmit(async (values) => {
    await createMutation.mutateAsync({
      groupId,
      email: values.email,
      role: roleValue,
    })
  })

  async function confirmRemove() {
    if (!memberPendingRemove) return
    await removeMemberMutation.mutateAsync({
      groupId,
      memberId: memberPendingRemove.id,
    })
    setMemberPendingRemove(null)
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
            <CardDescription>{t('invite.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={onInvite}
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="flex-1">
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
                <FormItem>
                  <FormLabel>{t('invite.role')}</FormLabel>
                  <FormControl>
                    <Select
                      value={roleValue}
                      onValueChange={(value) =>
                        setRoleValue(value as InvitableRole)
                      }
                    >
                      <SelectTrigger className="w-[10rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MEMBER">
                          {t('role.member')}
                        </SelectItem>
                        <SelectItem value="ADMIN">{t('role.admin')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormItem>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || !email}
                  className="sm:self-end"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  {t('invite.send')}
                </Button>
              </form>
            </Form>
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
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground truncate">
                          {invitation.email}
                        </span>
                        <Badge variant="secondary" className="shrink-0">
                          {roleLabel(invitation.role, roleLabels)}
                        </Badge>
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
                          revokeMutation.mutate({
                            invitationId: invitation.id,
                          })
                        }
                      >
                        {t('invitations.revokeButton')}
                      </Button>
                    )}
                  </li>
                ))}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('removeDialog.title')}</DialogTitle>
            <DialogDescription>
              {memberPendingRemove
                ? t('removeDialog.description', {
                    name: memberPendingRemove.name,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
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
              onClick={confirmRemove}
              disabled={removeMemberMutation.isPending}
            >
              {t('removeDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { Settings2, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { isPlaceholderEmail } from '@/lib/account'

import {
  badgeVariantForRole,
  formatDate,
  roleLabel,
  useRoleSelectItems,
} from './members-hooks'
import { ResponsiveParticipantActions } from './responsive-participant-actions'
import { SegmentedActions } from './segmented-actions'
import { UnlinkedParticipantsSection } from './unlinked-participants-section'

type Member = {
  id: string
  account?: {
    id: string
    name?: string
    email?: string
    image?: string | null
  } | null
  role: 'ADMIN' | 'MEMBER'
  ledgerParticipantId: string
  joinedAt?: Date | string | null
}

export function MemberListCard({
  groupId,
  members,
  isLoading,
  accountId,
  currentMemberId,
  canManage,
  updateRoleMutation,
  onRemove,
  onUpdateRole,
  roleLabels,
  locale,
  timeZone,
}: {
  groupId: string
  members: Member[]
  isLoading: boolean
  accountId: string | undefined
  currentMemberId: string | null
  canManage: boolean
  updateRoleMutation: { isPending: boolean }
  onRemove: (participant: { ledgerParticipantId: string; name: string }) => void
  onUpdateRole: (memberId: string, role: 'ADMIN' | 'MEMBER') => void
  roleLabels: { ADMIN: string; MEMBER: string }
  locale: string
  timeZone: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const roleSelectItems = useRoleSelectItems()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-3 py-1">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : members.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {members.map((member) => {
              const isMe = !!accountId && member.account?.id === accountId
              const displayName = member.account?.name || t('unknownMember')
              const isSelfRow = member.id === currentMemberId
              const showAdminControls = canManage && !isSelfRow
              return (
                <li
                  key={member.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 py-3 first:pt-0 last:pb-0 sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {member.account && (
                      <AccountAvatar
                        account={member.account}
                        size="lg"
                        className="mt-0.5 shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                        <span className="truncate font-medium text-foreground">
                          {displayName}
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
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
                        </span>
                      </div>
                      {member.account?.email &&
                        !isPlaceholderEmail(member.account.email) && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {member.account.email}
                          </p>
                        )}
                      {member.joinedAt && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('joinedOn', {
                            date: formatDate(member.joinedAt, locale, timeZone),
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                  {showAdminControls && (
                    <ResponsiveParticipantActions
                      label={t('actionsFor', { name: displayName })}
                      desktopActions={
                        <SegmentedActions>
                          <Select
                            value={member.role}
                            items={roleSelectItems}
                            disabled={updateRoleMutation.isPending}
                            onValueChange={(value) =>
                              onUpdateRole(
                                member.id,
                                value as 'ADMIN' | 'MEMBER',
                              )
                            }
                          >
                            <SelectTrigger
                              className="size-10 w-10 justify-center rounded-none border-0 p-0 shadow-none [&>svg:last-child]:hidden"
                              aria-label={t('changeRoleAria')}
                              title={t('changeRoleAria')}
                            >
                              <Settings2 size={16} aria-hidden="true" />
                              <SelectValue className="sr-only" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {roleSelectItems.map((item) => (
                                  <SelectItem
                                    key={item.value}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-none text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={t('remove')}
                            title={t('remove')}
                            onClick={() =>
                              onRemove({
                                ledgerParticipantId: member.ledgerParticipantId,
                                name: displayName,
                              })
                            }
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </Button>
                        </SegmentedActions>
                      }
                      mobileActions={[
                        {
                          key: 'role-admin',
                          label: roleLabels.ADMIN,
                          icon: ShieldCheck,
                          selected: member.role === 'ADMIN',
                          disabled: updateRoleMutation.isPending,
                          onSelect: () => {
                            if (member.role !== 'ADMIN') {
                              onUpdateRole(member.id, 'ADMIN')
                            }
                          },
                        },
                        {
                          key: 'role-member',
                          label: roleLabels.MEMBER,
                          icon: UserRound,
                          selected: member.role === 'MEMBER',
                          disabled: updateRoleMutation.isPending,
                          onSelect: () => {
                            if (member.role !== 'MEMBER') {
                              onUpdateRole(member.id, 'MEMBER')
                            }
                          },
                        },
                        {
                          key: 'remove',
                          label: t('remove'),
                          icon: Trash2,
                          destructive: true,
                          onSelect: () =>
                            onRemove({
                              ledgerParticipantId: member.ledgerParticipantId,
                              name: displayName,
                            }),
                        },
                      ]}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <UnlinkedParticipantsSection
          groupId={groupId}
          canManage={canManage}
          onRemove={onRemove}
        />
      </CardContent>
    </Card>
  )
}

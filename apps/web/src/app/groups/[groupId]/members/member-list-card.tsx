import { Trash2 } from 'lucide-react'
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
import { SegmentedActions } from './segmented-actions'

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
                  className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  {member.account && (
                    <AccountAvatar
                      account={member.account}
                      size="lg"
                      className="mt-0.5"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-foreground">
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
                  {showAdminControls && (
                    <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                      <Select
                        value={member.role}
                        items={roleSelectItems}
                        disabled={updateRoleMutation.isPending}
                        onValueChange={(value) =>
                          onUpdateRole(member.id, value as 'ADMIN' | 'MEMBER')
                        }
                      >
                        <SelectTrigger
                          className="w-32 shrink-0"
                          aria-label={t('changeRoleAria')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roleSelectItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <SegmentedActions>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 gap-1.5 rounded-none px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() =>
                            onRemove({
                              ledgerParticipantId: member.ledgerParticipantId,
                              name: displayName,
                            })
                          }
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          {t('remove')}
                        </Button>
                      </SegmentedActions>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

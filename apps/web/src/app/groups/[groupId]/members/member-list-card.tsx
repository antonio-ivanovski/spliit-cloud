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
import { useTranslation } from 'react-i18next'
import { badgeVariantForRole, formatDate, roleLabel } from './members-hooks'

type Member = {
  id: string
  account?: { id: string; name?: string; email?: string } | null
  role: 'ADMIN' | 'MEMBER'
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
}: {
  members: Member[]
  isLoading: boolean
  accountId: string | undefined
  currentMemberId: string | null
  canManage: boolean
  updateRoleMutation: { isPending: boolean }
  onRemove: (member: { id: string; name: string }) => void
  onUpdateRole: (memberId: string, role: 'ADMIN' | 'MEMBER') => void
  roleLabels: { ADMIN: string; MEMBER: string }
  locale: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

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
          <p className="text-sm text-muted-foreground py-2">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {members.map((member) => {
              const isMe = !!accountId && member.account?.id === accountId
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
                      <Select
                        value={member.role}
                        disabled={updateRoleMutation.isPending}
                        onValueChange={(value) =>
                          onUpdateRole(member.id!, value as 'ADMIN' | 'MEMBER')
                        }
                      >
                        <SelectTrigger
                          className="w-32"
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={false}
                        onClick={() =>
                          onRemove({ id: member.id!, name: displayName })
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
  )
}

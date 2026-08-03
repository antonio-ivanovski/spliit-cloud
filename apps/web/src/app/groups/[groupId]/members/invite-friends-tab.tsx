import { Loader2, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isPlaceholderEmail } from '@/lib/account'

import type { InvitableRole } from './members-hooks'

type Friend = {
  accountId: string
  name: string
  email: string
  image?: string | null
  sharedGroupCount: number
  isMember: boolean
  isPendingInvite: boolean
}

export function InviteFriendsTab({
  friends,
  isLoading,
  selectedFriendAccountId,
  onSelectFriend,
  friendRoleValue,
  canInviteAdmin,
  onRoleChange,
  isPending,
  onSubmit,
}: {
  friends: Friend[]
  isLoading: boolean
  selectedFriendAccountId: string
  onSelectFriend: (value: string) => void
  friendRoleValue: InvitableRole
  canInviteAdmin: boolean
  onRoleChange: (value: InvitableRole) => void
  isPending: boolean
  onSubmit: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

  return (
    <>
      <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
        {t('invite.friendsDescription')}
      </p>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : friends.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('invite.noFriends')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Select
              value={selectedFriendAccountId}
              onValueChange={(value) => {
                if (value != null) onSelectFriend(value)
              }}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t('invite.selectFriendPlaceholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {friends.map((f) => (
                  <SelectItem
                    key={f.accountId}
                    value={f.accountId}
                    disabled={f.isMember || f.isPendingInvite}
                  >
                    <span className="flex items-center gap-2">
                      <AccountAvatar
                        account={{
                          id: f.accountId,
                          image: f.image,
                          name: f.name,
                        }}
                        size="sm"
                      />
                      <span>{f.name}</span>
                      {!isPlaceholderEmail(f.email) && (
                        <span className="text-xs text-muted-foreground">
                          {f.email}
                        </span>
                      )}
                      {f.isMember && (
                        <span className="text-xs text-muted-foreground">
                          ({t('invite.friendAlreadyMember')})
                        </span>
                      )}
                      {f.isPendingInvite && !f.isMember && (
                        <span className="text-xs text-muted-foreground">
                          ({t('invite.friendAlreadyInvited')})
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            {canInviteAdmin && (
              <div className="sm:w-40">
                <Label className="sm:sr-only">{t('invite.role')}</Label>
                <Select
                  value={friendRoleValue}
                  onValueChange={(value) =>
                    onRoleChange(value as InvitableRole)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MEMBER">{t('role.member')}</SelectItem>
                    <SelectItem value="ADMIN">{t('role.admin')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              type="button"
              disabled={isPending || !selectedFriendAccountId}
              onClick={onSubmit}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              {t('invite.send')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

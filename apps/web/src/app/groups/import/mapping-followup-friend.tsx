import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AuthAccount } from '@/lib/auth'
import type { ParticipantMappingState } from '@spliit/domain/import'
import { useTranslation } from 'react-i18next'

type Friend = {
  accountId: string
  name: string
  email: string
  sharedGroupCount: number
  isMember: boolean
  isPendingInvite: boolean
}

export function FriendFollowUp({
  friends,
  friendAccountId,
  account,
  onChange,
}: {
  friends: Friend[]
  friendAccountId?: string
  account: AuthAccount | null | undefined
  onChange: (patch: Partial<ParticipantMappingState>) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="mt-2 grid gap-1.5">
      <Label>{t('Groups.Import.Mapping.Row.selectFriendLabel')}</Label>
      <Select
        value={friendAccountId ?? ''}
        onValueChange={(value) => {
          const friend = friends.find((f) => f.accountId === value)
          if (friend) {
            onChange({
              mode: 'INVITE_CONTACT',
              contactAccountId: friend.accountId,
              inviteEmail: friend.email,
              linkedAccountId: account?.id,
              existingLedgerParticipantId: undefined,
            })
          }
        }}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={t('Groups.Import.Mapping.Row.selectFriendPlaceholder')}
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
                <span>{f.name}</span>
                <span className="text-xs text-muted-foreground">{f.email}</span>
                {f.isMember && (
                  <span className="text-xs text-muted-foreground">
                    ({t('Groups.Import.Mapping.Row.friendAlreadyMember')})
                  </span>
                )}
                {f.isPendingInvite && !f.isMember && (
                  <span className="text-xs text-muted-foreground">
                    ({t('Groups.Import.Mapping.Row.friendPendingInvite')})
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

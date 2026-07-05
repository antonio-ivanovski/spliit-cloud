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

type Contact = {
  accountId: string
  name: string
  email: string
  sharedGroupCount: number
  isMember: boolean
  isPendingInvite: boolean
}

export function ContactFollowUp({
  contacts,
  contactAccountId,
  account,
  onChange,
}: {
  contacts: Contact[]
  contactAccountId?: string
  account: AuthAccount | null | undefined
  onChange: (patch: Partial<ParticipantMappingState>) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="mt-2 grid gap-1.5">
      <Label>{t('Groups.Import.Mapping.Row.selectContactLabel')}</Label>
      <Select
        value={contactAccountId ?? ''}
        onValueChange={(value) => {
          const contact = contacts.find((c) => c.accountId === value)
          if (contact) {
            onChange({
              mode: 'INVITE_CONTACT',
              contactAccountId: contact.accountId,
              inviteEmail: contact.email,
              linkedAccountId: account?.id,
              existingLedgerParticipantId: undefined,
            })
          }
        }}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={t(
              'Groups.Import.Mapping.Row.selectContactPlaceholder',
            )}
          />
        </SelectTrigger>
        <SelectContent>
          {contacts.map((c) => (
            <SelectItem
              key={c.accountId}
              value={c.accountId}
              disabled={c.isMember || c.isPendingInvite}
            >
              <span className="flex items-center gap-2">
                <span>{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.email}</span>
                {c.isMember && (
                  <span className="text-xs text-muted-foreground">
                    ({t('Groups.Import.Mapping.Row.contactAlreadyMember')})
                  </span>
                )}
                {c.isPendingInvite && !c.isMember && (
                  <span className="text-xs text-muted-foreground">
                    ({t('Groups.Import.Mapping.Row.contactPendingInvite')})
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

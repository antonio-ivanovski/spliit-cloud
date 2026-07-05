import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InvitableRole } from './members-hooks'

type Contact = {
  accountId: string
  name: string
  email: string
  sharedGroupCount: number
  isMember: boolean
  isPendingInvite: boolean
}

export function InviteContactsTab({
  contacts,
  isLoading,
  selectedContactAccountId,
  onSelectContact,
  contactRoleValue,
  onRoleChange,
  isPending,
  onSubmit,
}: {
  contacts: Contact[]
  isLoading: boolean
  selectedContactAccountId: string
  onSelectContact: (value: string) => void
  contactRoleValue: InvitableRole
  onRoleChange: (value: InvitableRole) => void
  isPending: boolean
  onSubmit: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

  return (
    <>
      <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
        {t('invite.contactsDescription')}
      </p>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('invite.noContacts')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Select
              value={selectedContactAccountId}
              onValueChange={onSelectContact}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t('invite.selectContactPlaceholder')}
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
                      <span className="text-xs text-muted-foreground">
                        {c.email}
                      </span>
                      {c.isMember && (
                        <span className="text-xs text-muted-foreground">
                          ({t('invite.contactAlreadyMember')})
                        </span>
                      )}
                      {c.isPendingInvite && !c.isMember && (
                        <span className="text-xs text-muted-foreground">
                          ({t('invite.contactAlreadyInvited')})
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="sm:w-40">
              <Label className="sm:sr-only">{t('invite.role')}</Label>
              <Select
                value={contactRoleValue}
                onValueChange={(value) => onRoleChange(value as InvitableRole)}
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
            <Button
              type="button"
              disabled={isPending || !selectedContactAccountId}
              onClick={onSubmit}
            >
              <UserPlus className="w-4 h-4 mr-2" />
              {t('invite.send')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AuthAccount } from '@/lib/auth'
import type { ParticipantMappingState } from '@spliit/domain/import'

export function EmailFollowUp({
  id,
  inviteEmail,
  normalizedImporterEmail,
  account,
  onChange,
}: {
  id: string
  inviteEmail?: string
  normalizedImporterEmail: string | null
  account: AuthAccount | null | undefined
  onChange: (patch: Partial<ParticipantMappingState>) => void
}) {
  const { t } = useTranslation()

  const isSelfEmail =
    !!normalizedImporterEmail &&
    !!inviteEmail?.trim() &&
    inviteEmail.trim().toLowerCase() === normalizedImporterEmail

  return (
    <div className="mt-2 grid gap-1.5">
      <Label htmlFor={`${id}-email`}>
        {t('Groups.Import.Mapping.Row.inviteeEmailLabel')}
      </Label>
      <Input
        id={`${id}-email`}
        type="email"
        placeholder={t('Groups.Import.Mapping.Row.inviteeEmailPlaceholder')}
        value={inviteEmail ?? ''}
        onChange={(e) => {
          const value = e.target.value
          const normalized = value.trim().toLowerCase()
          if (
            normalized &&
            normalizedImporterEmail &&
            normalized === normalizedImporterEmail
          ) {
            onChange({
              mode: 'LINK_ACCOUNT' as const,
              linkedAccountId: account?.id,
              inviteEmail: undefined,
            })
            return
          }
          onChange({ inviteEmail: value })
        }}
        aria-invalid={isSelfEmail}
      />
      {isSelfEmail && (
        <p className="text-xs text-muted-foreground">
          {t('Groups.Import.Mapping.Row.selfEmailDetected')}
        </p>
      )}
    </div>
  )
}

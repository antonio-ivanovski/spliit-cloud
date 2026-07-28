import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ParticipantMappingState } from '@spliit/domain/import'

type DestinationParticipant = {
  id: string
  name: string
  pending: boolean
  unlinked: boolean
}

export function LinkExistingFollowUp({
  destinationParticipants,
  existingLedgerParticipantId,
  onChange,
}: {
  destinationParticipants: DestinationParticipant[]
  existingLedgerParticipantId?: string
  onChange: (patch: Partial<ParticipantMappingState>) => void
}) {
  const { t } = useTranslation()

  const members = destinationParticipants.filter((p) => !p.pending)
  const pending = destinationParticipants.filter((p) => p.pending)

  return (
    <div className="mt-2 grid gap-1.5">
      <Label>{t('Groups.Import.Mapping.Row.selectExistingMember')}</Label>
      <Select
        value={existingLedgerParticipantId ?? ''}
        onValueChange={(value) =>
          onChange({ existingLedgerParticipantId: value })
        }
      >
        <SelectTrigger>
          <SelectValue
            placeholder={t(
              'Groups.Import.Mapping.Row.selectExistingPlaceholder',
            )}
          />
        </SelectTrigger>
        <SelectContent>
          {members.length > 0 && (
            <SelectGroup>
              <SelectLabel>
                {t('Groups.Import.Mapping.Row.membersLabel')}
              </SelectLabel>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {pending.length > 0 && (
            <SelectGroup>
              <SelectLabel>
                {t('Groups.Import.Mapping.Row.pendingInvitesLabel')}
              </SelectLabel>
              {pending.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} {t('Groups.Import.Mapping.Row.pendingSuffix')}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  )
}

import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AuthAccount } from '@/lib/auth'
import type { ParticipantMappingState } from '@spliit/domain/import'
import { useTranslation } from 'react-i18next'
import {
  EMAIL_VALUE,
  LINK_EXISTING_VALUE,
  LINK_VALUE,
  SELF_VALUE,
  UNLINKED_VALUE,
  getCurrentModeValue,
  modeFromValue,
} from './mapping-mode-select'

export function MappingRow({
  mode,
  account,
  inviteEmail,
  existingLedgerParticipantId,
  linkAccountTakenByOtherRow,
  disabledReasonForCurrentMode,
  onChange,
  name,
  destinationParticipants,
}: {
  mode: ParticipantMappingState['mode']
  account: AuthAccount | null | undefined
  inviteEmail?: string
  existingLedgerParticipantId?: string
  linkAccountTakenByOtherRow: boolean
  disabledReasonForCurrentMode: string | null
  onChange: (patch: Partial<ParticipantMappingState>) => void
  name: string
  destinationParticipants?: Array<{
    id: string
    name: string
    pending: boolean
    unlinked: boolean
  }>
}) {
  const { t } = useTranslation()
  const normalizedImporterEmail = account?.email?.toLowerCase().trim() ?? null

  const options: Array<{
    value: string
    label: string
    description: string
    disabled?: boolean
    followUp?: () => React.ReactNode
  }> = [
    {
      value: SELF_VALUE,
      label: t('Groups.Import.Mapping.Row.linkToMe'),
      description: t('Groups.Import.Mapping.Row.linkToMeDescription'),
      disabled: linkAccountTakenByOtherRow,
      followUp: () => (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('Groups.Import.Mapping.Row.linkToMeFollowUp', { name })}
        </p>
      ),
    },
    {
      value: EMAIL_VALUE,
      label: t('Groups.Import.Mapping.Row.inviteByEmail'),
      description: t('Groups.Import.Mapping.Row.inviteByEmailDescription'),
      followUp: () => {
        const isImporterEmail =
          !!normalizedImporterEmail &&
          !!inviteEmail?.trim() &&
          inviteEmail.trim().toLowerCase() === normalizedImporterEmail
        return (
          <div className="mt-2 grid gap-1.5">
            <Label htmlFor={`${name}-email`}>
              {t('Groups.Import.Mapping.Row.inviteeEmailLabel')}
            </Label>
            <Input
              id={`${name}-email`}
              type="email"
              placeholder={t(
                'Groups.Import.Mapping.Row.inviteeEmailPlaceholder',
              )}
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
              aria-invalid={isImporterEmail}
            />
            {isImporterEmail && (
              <p className="text-xs text-muted-foreground">
                {t('Groups.Import.Mapping.Row.selfEmailDetected')}
              </p>
            )}
          </div>
        )
      },
    },
    {
      value: LINK_VALUE,
      label: t('Groups.Import.Mapping.Row.inviteByLink'),
      description: t('Groups.Import.Mapping.Row.inviteByLinkDescription'),
      followUp: () => (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('Groups.Import.Mapping.Row.inviteByLinkFollowUp', { name })}
        </p>
      ),
    },
    ...(destinationParticipants && destinationParticipants.length > 0
      ? [
          {
            value: LINK_EXISTING_VALUE,
            label: t('Groups.Import.Mapping.Row.linkToExisting'),
            description: t(
              'Groups.Import.Mapping.Row.linkToExistingDescription',
            ),
            followUp: () => {
              const members = destinationParticipants.filter((p) => !p.pending)
              const pending = destinationParticipants.filter((p) => p.pending)
              return (
                <div className="mt-2 grid gap-1.5">
                  <Label>
                    {t('Groups.Import.Mapping.Row.selectExistingMember')}
                  </Label>
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
                              {p.name}{' '}
                              {t('Groups.Import.Mapping.Row.pendingSuffix')}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )
            },
          },
        ]
      : []),
    {
      value: UNLINKED_VALUE,
      label: t('Groups.Import.Mapping.Row.leaveUnlinked'),
      description: t('Groups.Import.Mapping.Row.leaveUnlinkedDescription'),
      followUp: () => (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('Groups.Import.Mapping.Row.leaveUnlinkedFollowUp', { name })}
        </p>
      ),
    },
  ]

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <p className="font-medium">{name}</p>
        </div>
        <RadioGroup
          value={getCurrentModeValue({ mode } as ParticipantMappingState)}
          onValueChange={(value) => {
            const newMode = modeFromValue(value)
            if (newMode === 'UNLINKED_PARTICIPANT') {
              onChange({ mode: newMode })
            } else if (newMode === 'INVITE_BY_EMAIL') {
              onChange({
                mode: newMode,
                linkedAccountId: account?.id,
              })
            } else if (newMode === 'INVITE_BY_LINK') {
              onChange({
                mode: newMode,
                linkedAccountId: account?.id,
              })
            } else if (newMode === 'LINK_EXISTING_PARTICIPANT') {
              onChange({
                mode: newMode,
                linkedAccountId: undefined,
                inviteEmail: undefined,
              })
            } else {
              onChange({
                mode: newMode,
                linkedAccountId: account?.id,
              })
            }
          }}
          className="grid gap-2"
        >
          {options.map((opt) => {
            const isSelected =
              getCurrentModeValue({ mode } as ParticipantMappingState) ===
              opt.value
            const disabled = !!opt.disabled
            return (
              <label
                key={opt.value}
                className={`flex flex-col rounded-md border p-2 ${
                  disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:bg-muted/50 has-data-[state=checked]:border-primary'
                }`}
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem
                    value={opt.value}
                    id={`${name}-${opt.value}`}
                    className="mt-1"
                    disabled={disabled}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {opt.description}
                    </span>
                  </div>
                </div>
                {isSelected && opt.followUp?.()}
              </label>
            )
          })}
        </RadioGroup>
        {disabledReasonForCurrentMode && (
          <p className="text-xs text-destructive">
            {disabledReasonForCurrentMode}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

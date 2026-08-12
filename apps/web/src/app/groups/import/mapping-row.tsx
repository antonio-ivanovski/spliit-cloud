import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { AuthAccount } from '@/lib/auth'
import type { ParticipantMappingState } from '@spliit/domain/import'

import { EmailFollowUp } from './mapping-followup-email'
import { FriendFollowUp } from './mapping-followup-friend'
import { LinkFollowUp } from './mapping-followup-link'
import { LinkExistingFollowUp } from './mapping-followup-link-existing'
import { SelfFollowUp } from './mapping-followup-self'
import { UnlinkedFollowUp } from './mapping-followup-unlinked'
import {
  CONTACT_VALUE,
  EMAIL_VALUE,
  LINK_EXISTING_VALUE,
  LINK_VALUE,
  SELF_VALUE,
  UNLINKED_VALUE,
  getCurrentModeValue,
  modeFromValue,
} from './mapping-mode-select'

type Friend = {
  accountId: string
  name: string
  email: string
  sharedGroupCount: number
  isMember: boolean
  isPendingInvite: boolean
}

export function MappingRow({
  mode,
  account,
  inviteEmail,
  existingLedgerParticipantId,
  contactAccountId,
  linkAccountTakenByOtherRow,
  disabledReasonForCurrentMode,
  onChange,
  name,
  destinationParticipants,
  friends,
  friendLedger = false,
}: {
  mode: ParticipantMappingState['mode']
  account: AuthAccount | null | undefined
  inviteEmail?: string
  existingLedgerParticipantId?: string
  contactAccountId?: string
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
  friends: Friend[]
  friendLedger?: boolean
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
      followUp: () => <SelfFollowUp name={name} />,
    },
    {
      value: CONTACT_VALUE,
      label: t('Groups.Import.Mapping.Row.inviteFriend'),
      description: t('Groups.Import.Mapping.Row.inviteFriendDescription'),
      followUp: () => (
        <FriendFollowUp
          friends={friends}
          friendAccountId={contactAccountId}
          account={account}
          onChange={onChange}
        />
      ),
    },
    {
      value: EMAIL_VALUE,
      label: t('Groups.Import.Mapping.Row.inviteByEmail'),
      description: t('Groups.Import.Mapping.Row.inviteByEmailDescription'),
      followUp: () => (
        <EmailFollowUp
          id={name}
          inviteEmail={inviteEmail}
          normalizedImporterEmail={normalizedImporterEmail}
          account={account}
          onChange={onChange}
        />
      ),
    },
    {
      value: LINK_VALUE,
      label: t('Groups.Import.Mapping.Row.inviteByLink'),
      description: t('Groups.Import.Mapping.Row.inviteByLinkDescription'),
      followUp: () => <LinkFollowUp name={name} />,
    },
    ...(destinationParticipants && destinationParticipants.length > 0
      ? [
          {
            value: LINK_EXISTING_VALUE,
            label: t('Groups.Import.Mapping.Row.linkToExisting'),
            description: t(
              'Groups.Import.Mapping.Row.linkToExistingDescription',
            ),
            followUp: () => (
              <LinkExistingFollowUp
                destinationParticipants={destinationParticipants}
                existingLedgerParticipantId={existingLedgerParticipantId}
                onChange={onChange}
              />
            ),
          },
        ]
      : []),
    ...(!friendLedger
      ? [
          {
            value: UNLINKED_VALUE,
            label: t('Groups.Import.Mapping.Row.leaveUnlinked'),
            description: t(
              'Groups.Import.Mapping.Row.leaveUnlinkedDescription',
            ),
            followUp: () => <UnlinkedFollowUp name={name} />,
          },
        ]
      : []),
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
            } else if (newMode === 'INVITE_CONTACT') {
              onChange({
                mode: newMode,
                linkedAccountId: account?.id,
                existingLedgerParticipantId: undefined,
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
                    : 'cursor-pointer hover:bg-muted/50 has-data-[checked]:border-primary'
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

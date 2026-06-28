'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { randomId } from '@/lib/api'
import type { AuthAccount } from '@/lib/auth'
import type {
  DestinationParticipant,
  NormalizedSource,
  ParticipantMappingState,
} from '@spliit/domain/import'
import { findImportConflicts } from '@spliit/domain/import'
import { useTranslation } from 'react-i18next'

type Props = {
  source: NormalizedSource
  participants: ParticipantMappingState[]
  account: AuthAccount | null | undefined
  destinationParticipants?: DestinationParticipant[]
  onChange: (participants: ParticipantMappingState[]) => void
  onContinue: (resolved: {
    sourceIdToDestId: Record<string, string>
    destIds: Record<string, string>
    resolvedExpenses: NormalizedSource['expenses']
  }) => void
}

const SELF_VALUE = 'LINK_ACCOUNT'
const EMAIL_VALUE = 'INVITE_BY_EMAIL'
const LINK_VALUE = 'INVITE_BY_LINK'
const UNLINKED_VALUE = 'UNLINKED_PARTICIPANT'
const LINK_EXISTING_VALUE = 'LINK_EXISTING_PARTICIPANT'

export function MappingStep({
  source,
  participants,
  account,
  destinationParticipants,
  onChange,
  onContinue,
}: Props) {
  const { t } = useTranslation()
  const translateConflictMessage = (message: string): string => {
    if (message === 'Two source rows are mapped to the same existing member.') {
      return t('Groups.Import.Mapping.Errors.duplicateExistingMember')
    }
    const pendingMatch = message.match(
      /^You're inviting (.+) but they're already a pending invite; link to them instead\.$/,
    )
    if (pendingMatch) {
      return t('Groups.Import.Mapping.Errors.inviteConflictsPending', {
        email: pendingMatch[1],
      })
    }
    const memberMatch = message.match(
      /^You're inviting (.+) but they're already a member of this group; link to them instead\.$/,
    )
    if (memberMatch) {
      return t('Groups.Import.Mapping.Errors.inviteConflictsMember', {
        email: memberMatch[1],
      })
    }
    if (
      message === 'Two existing members look like the same person — pick one.'
    ) {
      return t('Groups.Import.Mapping.Errors.duplicateMemberName')
    }
    return message
  }

  const updateParticipant = (
    key: string,
    patch: Partial<ParticipantMappingState>,
  ) => {
    onChange(participants.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  }

  const rawConflictMap = findImportConflicts(
    participants,
    destinationParticipants,
  )
  const conflictMap = new Map(
    [...rawConflictMap.entries()].map(([k, v]) => [
      k,
      translateConflictMessage(v),
    ]),
  )

  const handleContinue = () => {
    if (conflictMap.size > 0) return
    // Validate that every INVITE_BY_EMAIL row has a non-empty email
    // and every LINK_EXISTING_PARTICIPANT row has a selected member.
    for (const p of participants) {
      if (p.mode === 'INVITE_BY_EMAIL' && !p.inviteEmail?.trim()) {
        return
      }
      if (
        p.mode === 'LINK_EXISTING_PARTICIPANT' &&
        !p.existingLedgerParticipantId
      ) {
        return
      }
    }
    // Build the source→destination id mapping.
    // LINK_EXISTING_PARTICIPANT rows use the destination LP id directly;
    // all other modes get a fresh stable id.
    const sourceIdToDestId: Record<string, string> = {}
    const destIds: Record<string, string> = {}
    for (const p of participants) {
      const destId =
        p.mode === 'LINK_EXISTING_PARTICIPANT' && p.existingLedgerParticipantId
          ? p.existingLedgerParticipantId
          : randomId()
      sourceIdToDestId[p.source.sourceId] = destId
      destIds[p.source.sourceId] = destId
    }
    // Resolved expenses: every source paidBy / paidFor participant
    // has a destination id (we no longer drop anything). The paidFor
    // list keeps the same composition as the source.
    const resolvedExpenses = source.expenses.map((e) => ({
      ...e,
      paidFor: e.paidFor,
    }))
    onContinue({ sourceIdToDestId, destIds, resolvedExpenses })
  }

  // Derive per-row conflict state. A conflict means the row's
  // CURRENTLY SELECTED mode has a disabled reason (e.g. an
  // INVITE_BY_EMAIL row with no email, or the importer's email
  // would self-invite). Other modes that are disabled for this row
  // (e.g. "Link to me" disabled because another row already took
  // the importer's account) don't count as conflicts — the row
  // just isn't allowed to switch to them, but its current choice
  // is fine.
  const linkAccountKey =
    participants.find((p) => p.mode === 'LINK_ACCOUNT')?.key ?? null
  const normalizedImporterEmail = account?.email?.toLowerCase().trim() ?? null

  const getCurrentModeValue = (p: ParticipantMappingState): string =>
    p.mode === 'LINK_ACCOUNT'
      ? SELF_VALUE
      : p.mode === 'INVITE_BY_EMAIL'
        ? EMAIL_VALUE
        : p.mode === 'INVITE_BY_LINK'
          ? LINK_VALUE
          : p.mode === 'LINK_EXISTING_PARTICIPANT'
            ? LINK_EXISTING_VALUE
            : UNLINKED_VALUE

  const disabledReasonForCurrentMode = (
    row: ParticipantMappingState,
  ): string | null => {
    const mapReason = conflictMap.get(row.key)
    if (mapReason) return mapReason
    const currentValue = getCurrentModeValue(row)
    if (
      currentValue === SELF_VALUE &&
      linkAccountKey !== null &&
      row.key !== linkAccountKey
    ) {
      // This row is LINK_ACCOUNT but a different row also is — UI
      // should prevent this but the conflict check covers the
      // race where state isn't synchronized yet.
      return t('Groups.Import.Mapping.Errors.onlyOneLinkedAccount')
    }
    if (currentValue === LINK_EXISTING_VALUE) {
      if (!row.existingLedgerParticipantId) {
        return t('Groups.Import.Mapping.Errors.missingExistingMember')
      }
    }
    if (currentValue === EMAIL_VALUE) {
      if (!row.inviteEmail?.trim()) {
        return t('Groups.Import.Mapping.Errors.missingEmail')
      }
      if (
        normalizedImporterEmail &&
        row.inviteEmail.trim().toLowerCase() === normalizedImporterEmail
      ) {
        return t('Groups.Import.Mapping.Errors.selfEmailAddress')
      }
      const duplicateEmail = participants.some(
        (other) =>
          other.key !== row.key &&
          other.mode === 'INVITE_BY_EMAIL' &&
          other.inviteEmail?.trim().toLowerCase() ===
            row.inviteEmail?.trim().toLowerCase(),
      )
      if (duplicateEmail) {
        return t('Groups.Import.Mapping.Errors.duplicateEmail')
      }
    }
    return null
  }

  const hasConflict = participants.some(
    (p) => disabledReasonForCurrentMode(p) !== null,
  )
  const existingLpIds = participants
    .filter(
      (p) =>
        p.mode === 'LINK_EXISTING_PARTICIPANT' && p.existingLedgerParticipantId,
    )
    .map((p) => p.existingLedgerParticipantId!)
  const hasDuplicateDestId =
    existingLpIds.length !== new Set(existingLpIds).size
  const ready =
    !hasConflict &&
    !hasDuplicateDestId &&
    conflictMap.size === 0 &&
    participants.every(
      (p) =>
        p.mode !== 'INVITE_BY_EMAIL' || (p.inviteEmail?.trim().length ?? 0) > 0,
    )

  return (
    <div className="flex flex-col gap-4">
      {!participants.some((p) => p.mode === 'LINK_ACCOUNT') && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Badge variant="outline" className="shrink-0">
            {t('Groups.Import.Mapping.headsUp')}
          </Badge>
          <p>{t('Groups.Import.Mapping.noLinkAccount')}</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {participants.map((p) => (
          <MappingRow
            key={p.key}
            mode={p.mode}
            account={account}
            inviteEmail={p.inviteEmail}
            existingLedgerParticipantId={p.existingLedgerParticipantId}
            linkAccountTakenByOtherRow={
              linkAccountKey !== null && p.key !== linkAccountKey
            }
            disabledReasonForCurrentMode={disabledReasonForCurrentMode(p)}
            onChange={(patch) => updateParticipant(p.key, patch)}
            name={p.source.sourceName}
            destinationParticipants={destinationParticipants}
          />
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={handleContinue} disabled={!ready}>
          {t('Groups.Import.Mapping.continue')}
        </Button>
      </div>
    </div>
  )
}

function MappingRow({
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

  // The radio's follow-up content (email input, descriptive
  // paragraph, etc.) renders INSIDE the selected option's label,
  // so each radio is self-contained — see the screenshot the user
  // shared. The options list now carries both label + description +
  // a renderFollowUp() callback that produces the inline content
  // when this option is the selected one.
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
        // When the user types their own email, auto-promote to
        // LINK_ACCOUNT. Clear the email field so the UI doesn't
        // show a stale value next to the radio.
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
                    mode: 'LINK_ACCOUNT',
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
          value={
            mode === 'LINK_ACCOUNT'
              ? SELF_VALUE
              : mode === 'INVITE_BY_EMAIL'
                ? EMAIL_VALUE
                : mode === 'INVITE_BY_LINK'
                  ? LINK_VALUE
                  : mode === 'LINK_EXISTING_PARTICIPANT'
                    ? LINK_EXISTING_VALUE
                    : UNLINKED_VALUE
          }
          onValueChange={(value) => {
            if (value === UNLINKED_VALUE) {
              onChange({ mode: 'UNLINKED_PARTICIPANT' })
            } else if (value === EMAIL_VALUE) {
              onChange({
                mode: 'INVITE_BY_EMAIL',
                linkedAccountId: account?.id,
              })
            } else if (value === LINK_VALUE) {
              onChange({
                mode: 'INVITE_BY_LINK',
                linkedAccountId: account?.id,
              })
            } else if (value === LINK_EXISTING_VALUE) {
              onChange({
                mode: 'LINK_EXISTING_PARTICIPANT',
                linkedAccountId: undefined,
                inviteEmail: undefined,
              })
            } else {
              onChange({
                mode: 'LINK_ACCOUNT',
                linkedAccountId: account?.id,
              })
            }
          }}
          className="grid gap-2"
        >
          {options.map((opt) => {
            const isSelected =
              (mode === 'LINK_ACCOUNT' && opt.value === SELF_VALUE) ||
              (mode === 'INVITE_BY_EMAIL' && opt.value === EMAIL_VALUE) ||
              (mode === 'INVITE_BY_LINK' && opt.value === LINK_VALUE) ||
              (mode === 'LINK_EXISTING_PARTICIPANT' &&
                opt.value === LINK_EXISTING_VALUE) ||
              (mode === 'UNLINKED_PARTICIPANT' && opt.value === UNLINKED_VALUE)
            const disabled = !!opt.disabled
            return (
              <label
                key={opt.value}
                className={`flex flex-col rounded-md border p-2 ${
                  disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:bg-muted/50 has-[[data-state=checked]]:border-primary'
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

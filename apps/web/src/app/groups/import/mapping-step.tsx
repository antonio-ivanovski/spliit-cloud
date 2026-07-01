import { Badge } from '@/components/ui/badge'
import { randomId } from '@/lib/api'
import type { AuthAccount } from '@/lib/auth'
import type {
  DestinationParticipant,
  NormalizedSource,
  ParticipantMappingState,
} from '@spliit/domain/import'
import { findImportConflicts } from '@spliit/domain/import'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MappingRow } from './mapping-row'
import { useMappingValidation } from './mapping-validation'

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
  registerStepNav: (
    step: 'mapping',
    nav: { onContinue?: () => void; disabled?: boolean },
  ) => void
}

export function MappingStep({
  source,
  participants,
  account,
  destinationParticipants,
  onChange,
  onContinue,
  registerStepNav,
}: Props) {
  const { t } = useTranslation()
  const { translateConflictMessage, disabledReasonForCurrentMode } =
    useMappingValidation()

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

  const handleContinue = useCallback(() => {
    if (conflictMap.size > 0) return
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
    const resolvedExpenses = source.expenses.map((e) => ({
      ...e,
      paidFor: e.paidFor,
    }))
    onContinue({ sourceIdToDestId, destIds, resolvedExpenses })
  }, [conflictMap, participants, source.expenses, onContinue])

  const linkAccountKey =
    participants.find((p) => p.mode === 'LINK_ACCOUNT')?.key ?? null
  const normalizedImporterEmail = account?.email?.toLowerCase().trim() ?? null

  const ready = useMemo(() => {
    const hasConflict = participants.some(
      (p) =>
        disabledReasonForCurrentMode(
          p,
          conflictMap,
          linkAccountKey,
          normalizedImporterEmail,
          participants,
        ) !== null,
    )
    const existingLpIds = participants
      .filter(
        (p) =>
          p.mode === 'LINK_EXISTING_PARTICIPANT' &&
          p.existingLedgerParticipantId,
      )
      .map((p) => p.existingLedgerParticipantId!)
    const hasDuplicateDestId =
      existingLpIds.length !== new Set(existingLpIds).size
    return (
      !hasConflict &&
      !hasDuplicateDestId &&
      conflictMap.size === 0 &&
      participants.every(
        (p) =>
          p.mode !== 'INVITE_BY_EMAIL' ||
          (p.inviteEmail?.trim().length ?? 0) > 0,
      )
    )
  }, [
    participants,
    conflictMap,
    linkAccountKey,
    normalizedImporterEmail,
    disabledReasonForCurrentMode,
  ])

  useEffect(() => {
    registerStepNav('mapping', {
      onContinue: handleContinue,
      disabled: !ready,
    })
  }, [handleContinue, ready, registerStepNav])

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
            disabledReasonForCurrentMode={disabledReasonForCurrentMode(
              p,
              conflictMap,
              linkAccountKey,
              normalizedImporterEmail,
              participants,
            )}
            onChange={(patch) => updateParticipant(p.key, patch)}
            name={p.source.sourceName}
            destinationParticipants={destinationParticipants}
          />
        ))}
      </div>
    </div>
  )
}

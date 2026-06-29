import { useTranslation } from 'react-i18next'
import {
  EMAIL_VALUE,
  LINK_EXISTING_VALUE,
  SELF_VALUE,
  getCurrentModeValue,
} from './mapping-mode-select'

import type { ParticipantMappingState } from '@spliit/domain/import'

export function useMappingValidation() {
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

  const disabledReasonForCurrentMode = (
    row: ParticipantMappingState,
    conflictMap: Map<string, string>,
    linkAccountKey: string | null,
    normalizedImporterEmail: string | null,
    participants: ParticipantMappingState[],
  ): string | null => {
    const mapReason = conflictMap.get(row.key)
    if (mapReason) return mapReason
    const currentValue = getCurrentModeValue(row)
    if (
      currentValue === SELF_VALUE &&
      linkAccountKey !== null &&
      row.key !== linkAccountKey
    ) {
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

  return { translateConflictMessage, disabledReasonForCurrentMode }
}

export const SELF_VALUE = 'LINK_ACCOUNT'
export const EMAIL_VALUE = 'INVITE_BY_EMAIL'
export const LINK_VALUE = 'INVITE_BY_LINK'
export const UNLINKED_VALUE = 'UNLINKED_PARTICIPANT'
export const LINK_EXISTING_VALUE = 'LINK_EXISTING_PARTICIPANT'

import type { ParticipantMappingState } from '@spliit/domain/import'

export function getCurrentModeValue(p: ParticipantMappingState): string {
  if (p.mode === 'LINK_ACCOUNT') return SELF_VALUE
  if (p.mode === 'INVITE_BY_EMAIL') return EMAIL_VALUE
  if (p.mode === 'INVITE_BY_LINK') return LINK_VALUE
  if (p.mode === 'LINK_EXISTING_PARTICIPANT') return LINK_EXISTING_VALUE
  return UNLINKED_VALUE
}

export function modeFromValue(value: string): ParticipantMappingState['mode'] {
  if (value === SELF_VALUE) return 'LINK_ACCOUNT'
  if (value === EMAIL_VALUE) return 'INVITE_BY_EMAIL'
  if (value === LINK_VALUE) return 'INVITE_BY_LINK'
  if (value === LINK_EXISTING_VALUE) return 'LINK_EXISTING_PARTICIPANT'
  return 'UNLINKED_PARTICIPANT'
}

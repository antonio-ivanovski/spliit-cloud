import type { ComponentType } from 'react'

import type { AccountMascot } from '@/lib/account-preferences'

import { BillCharacter } from './characters/bill/bill-character'
import type { MascotCharacterProps } from './mascot-character'

export type ActiveMascotId = Exclude<AccountMascot, 'off'>

export type MascotDefinition = {
  id: ActiveMascotId
  Character: ComponentType<MascotCharacterProps>
}

export const DEFAULT_MASCOT_ID: ActiveMascotId = 'bill'

const MASCOTS: Record<ActiveMascotId, MascotDefinition> = {
  bill: { id: 'bill', Character: BillCharacter },
}

export function getMascotDefinition(
  id: AccountMascot | undefined,
): MascotDefinition | null {
  if (!id || id === 'off') return null
  return MASCOTS[id] ?? null
}

export function isActiveMascot(id: AccountMascot | undefined) {
  return getMascotDefinition(id) !== null
}

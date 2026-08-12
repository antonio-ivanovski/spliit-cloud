import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MASCOT_ID,
  getMascotDefinition,
  isActiveMascot,
} from '@/components/mascot/mascot-registry'
import type { AccountMascot } from '@/lib/account-preferences'

describe('mascot registry', () => {
  it('treats bill as the active default character', () => {
    expect(isActiveMascot('bill')).toBe(true)
    expect(isActiveMascot(DEFAULT_MASCOT_ID)).toBe(true)
    expect(getMascotDefinition('bill')?.id).toBe('bill')
    expect(getMascotDefinition('bill')?.Character).toBeTypeOf('function')
  })

  it('treats off and unknown ids as inactive', () => {
    expect(isActiveMascot('off')).toBe(false)
    expect(isActiveMascot(undefined)).toBe(false)
    expect(getMascotDefinition('off')).toBeNull()
    expect(getMascotDefinition('ghost' as AccountMascot)).toBeNull()
  })
})

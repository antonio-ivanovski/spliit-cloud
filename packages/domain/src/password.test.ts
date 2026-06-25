import { describe, expect, it } from 'vitest'
import { getPasswordRequirements, isStrongPassword } from './password'

describe('password policy', () => {
  it('requires length, uppercase, lowercase, number, and symbol', () => {
    expect(isStrongPassword('Password1!')).toBe(true)
    expect(isStrongPassword('Password1')).toBe(false)
    expect(isStrongPassword('password1!')).toBe(false)
    expect(isStrongPassword('PASSWORD1!')).toBe(false)
    expect(isStrongPassword('Password!')).toBe(false)
    expect(isStrongPassword('Pass1!')).toBe(false)
  })

  it('reports individual requirement state', () => {
    expect(getPasswordRequirements('pass')).toEqual([
      { id: 'minLength', isMet: false },
      { id: 'uppercase', isMet: false },
      { id: 'lowercase', isMet: true },
      { id: 'number', isMet: false },
      { id: 'symbol', isMet: false },
    ])
  })
})

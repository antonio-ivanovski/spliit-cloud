export type PasswordRequirementId =
  | 'minLength'
  | 'uppercase'
  | 'lowercase'
  | 'number'
  | 'symbol'

export type PasswordRequirement = {
  id: PasswordRequirementId
  isMet: boolean
}

export function getPasswordRequirements(
  password: string,
): PasswordRequirement[] {
  return [
    { id: 'minLength', isMet: password.length >= 8 },
    { id: 'uppercase', isMet: /[A-Z]/.test(password) },
    { id: 'lowercase', isMet: /[a-z]/.test(password) },
    { id: 'number', isMet: /\d/.test(password) },
    { id: 'symbol', isMet: /[^A-Za-z0-9]/.test(password) },
  ]
}

export function isStrongPassword(password: string) {
  return getPasswordRequirements(password).every((item) => item.isMet)
}

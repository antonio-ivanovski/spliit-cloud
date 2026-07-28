export type AccountIdentity = {
  id: string
  name?: string | null
  image?: string | null
}

/** Whether an account still needs a usable display name. */
export function needsDisplayName(account: {
  name?: string | null
  email?: string | null
}): boolean {
  return !account.name || account.name === account.email
}

const PLACEHOLDER_EMAIL_DOMAIN = 'placeholder.local'

/**
 * Whether an email is a generated placeholder (link invite, OAuth without a
 * verified email).
 */
export function isPlaceholderEmail(email?: string | null): boolean {
  if (!email) return false
  return email.toLowerCase().endsWith(`.${PLACEHOLDER_EMAIL_DOMAIN}`)
}

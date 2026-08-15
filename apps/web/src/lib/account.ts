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

/**
 * Whether an anonymous account still needs to save its recovery link.
 *
 * Live sessions may omit `anonymousOnboardingCompleted`. In that case a missing
 * display name is the first-run signal; a real name means onboarding already
 * finished (including last-account snapshots from before this field existed).
 */
export function needsAnonymousOnboarding(account: {
  isAnonymous?: boolean | null
  anonymousOnboardingCompleted?: boolean | null
  name?: string | null
  email?: string | null
}): boolean {
  if (account.isAnonymous !== true) return false
  if (account.anonymousOnboardingCompleted === true) return false
  if (account.anonymousOnboardingCompleted === false) return true
  return needsDisplayName(account)
}

/** Whether the account must finish recovery and/or a display name. */
export function needsAccountOnboarding(account: {
  isAnonymous?: boolean | null
  anonymousOnboardingCompleted?: boolean | null
  name?: string | null
  email?: string | null
}): boolean {
  return needsDisplayName(account) || needsAnonymousOnboarding(account)
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

/** Whether the account has a deliverable, non-synthetic email. */
export function hasRealEmail(email?: string | null): boolean {
  return Boolean(email) && !isPlaceholderEmail(email)
}

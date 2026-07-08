/**
 * Detects whether an account needs a display name to be set.
 *
 * An account needs a display name when:
 * 1. `name` is falsy (empty string, null, undefined) — common after
 *    sign-up flows that don't collect a name.
 * 2. `name` equals `email` — some auth flows default the name to the
 *    email address, which is not a suitable display name.
 */
export function needsDisplayName(account: {
  name?: string | null
  email?: string | null
}): boolean {
  return !account.name || account.name === account.email
}

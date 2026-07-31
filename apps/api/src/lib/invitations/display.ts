/**
 * Generic "Pending invite" fallback label for invitations with no email and no
 * temporary name.
 */
export const PENDING_INVITEE_FALLBACK_LABEL = 'Pending invite'

/** Reserved TLDs used for synthetic placeholder emails. */
export const PLACEHOLDER_EMAIL_DOMAIN = 'placeholder.local'

/** Number of username characters to keep when showing a placeholder email. */
export const PLACEHOLDER_USERNAME_DISPLAY_LENGTH = 8

/** True when the email is a synthetic placeholder, not a real address. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return email.toLowerCase().endsWith(`.${PLACEHOLDER_EMAIL_DOMAIN}`)
}

/**
 * Return a short, non-sensitive label for a synthetic placeholder email.
 * Placeholder local parts contain invite/provider identifiers, so never show
 * the complete synthetic address in a participant label.
 */
export function getPlaceholderEmailDisplayName(
  email: string | null | undefined,
): string | null {
  if (!isPlaceholderEmail(email)) return null
  const username = email?.split('@', 1)[0] ?? ''
  if (!username) return null
  return username.length > PLACEHOLDER_USERNAME_DISPLAY_LENGTH
    ? `${username.slice(0, PLACEHOLDER_USERNAME_DISPLAY_LENGTH)}…`
    : username
}

/** Build a synthetic email for an OAuth provider that did not return one. */
export function buildProviderPlaceholderEmail(
  provider: string,
  providerAccountId: string,
): string {
  const safeProvider = provider.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return `${providerAccountId}@${safeProvider}.${PLACEHOLDER_EMAIL_DOMAIN}`
}

/** Build a synthetic email for a link invitation. `token` must be unique. */
export function buildLinkPlaceholderEmail(token: string): string {
  return `${token}@link.${PLACEHOLDER_EMAIL_DOMAIN}`
}

/**
 * Display name for an invitation row. Priority: `temporaryName` → short
 * placeholder username or full real email →
 * {@link PENDING_INVITEE_FALLBACK_LABEL}.
 */
export function getInvitationDisplayName(invitation: {
  email: string | null
  temporaryName: string | null
}): string {
  if (invitation.temporaryName != null) return invitation.temporaryName
  return (
    getPlaceholderEmailDisplayName(invitation.email) ??
    invitation.email ??
    PENDING_INVITEE_FALLBACK_LABEL
  )
}

/**
 * Display name for a `LedgerParticipant`. Priority: accepted `Account.name` →
 * invitation `temporaryName` → short placeholder username or invitation
 * `email`.
 */
export function resolveParticipantDisplayName(participant: {
  groupMember: { account: { name: string | null } | null } | null
  invitations: Array<{
    email: string | null
    temporaryName: string | null
  }>
  displayName?: string | null
}): string {
  const accountName = participant.groupMember?.account?.name ?? null
  if (accountName) return accountName
  const invitation = participant.invitations[0]
  if (invitation) return getInvitationDisplayName(invitation)
  return participant.displayName ?? ''
}

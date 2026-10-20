import { GroupInvitationStatus } from '@spliit/db'

/** Why a link stopped accepting joins. `null` means the link is still live. */
export type LinkEndedReason = 'expired' | 'full'

/**
 * The columns liveness depends on. Kept structural so every layer (list, accept
 * gate, copy endpoint, preview) derives the same answer from the same fields.
 */
export type LivenessRow = {
  status: GroupInvitationStatus
  isMultiUse: boolean
  expiresAt: Date | null
  useCount: number
  /**
   * Per-link join cap. `null` means **unlimited** — never a fallback to a code
   * constant. A shared link created with "unlimited joins" stores null here and
   * must stay unlimited.
   */
  maxUses: number | null
}

/**
 * A shared link is a copyable, multi-person link: multi-use with a stored
 * plaintext token. This is the single definition used by the pending list, the
 * accept gate, the copy endpoint, and the permission checks.
 */
export function isSharedLinkRow(row: {
  isMultiUse: boolean
  linkToken: string | null
}): boolean {
  return row.isMultiUse && row.linkToken != null
}

/**
 * Whether a multi-use link stopped accepting joins.
 *
 * Expiry wins over the cap: a link that expired at the same moment it filled up
 * is reported as expired. The row's `maxUses` is the cap; a missing (`null`)
 * cap is unlimited and can never report 'full'. Non-PENDING rows report null —
 * their terminal state comes from status, not liveness.
 */
export function endedReasonOf(
  row: LivenessRow,
  now: Date,
): LinkEndedReason | null {
  if (row.status !== GroupInvitationStatus.PENDING) return null
  if (row.expiresAt && row.expiresAt <= now) return 'expired'
  if (row.isMultiUse && row.maxUses != null && row.useCount >= row.maxUses) {
    return 'full'
  }
  return null
}

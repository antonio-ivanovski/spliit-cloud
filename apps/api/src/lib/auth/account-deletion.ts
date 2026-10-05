import {
  GroupInvitationStatus,
  GroupMemberStatus,
  Prisma,
  prisma,
  type GroupType,
} from '@spliit/db'
import {
  bossTransactionDb,
  JOB_NAMES,
  sendJob,
  type SpliitBoss,
} from '@spliit/jobs'

import {
  deleteS3Object,
  isProfileImageUrlForAccount,
} from '../../routes/upload'
import { getApiBoss, getApiBossForWrite } from '../api/boss'
import { deleteGroup, getLeavePreview, leaveGroup } from '../api/members'
import { adjustSplitPresetsForRemovedParticipant } from '../api/split-presets'
import { removeParticipantFromSubgroup } from '../api/subgroups'
import { isEmailAuthEnabled } from '../env'
import { isPlaceholderEmail } from '../invitations'
import { getInvitationDisplayName } from '../invitations/display'
import { sendEmail } from '../mail/send'
import {
  renderAccountDeletionCancelledEmail,
  renderAccountDeletionExecutedEmail,
  renderAccountDeletionRequestedEmail,
} from '../mail/templates/account-deletion'
import { invalidateAccountCache } from './account-cache'
import { revokeAuthorizedClient } from './authorized-clients'
import { SESSION_FRESH_AGE_SECONDS } from './session-policy'

/**
 * Account deletion (right-to-erasure) flow.
 *
 * Shared expense history is preserved so other members' balances never break:
 * the deleter's ledger participants are converted to name-only
 * (`UNLINKED_PARTICIPANT`) rows, expense creators are nulled (already `SetNull`
 * in the schema), and every personally identifying value is scrubbed.
 * Everything account-scoped (sessions, identities, passkeys, preferences,
 * webhooks, push subscriptions, OAuth grants) is removed.
 *
 * Deletion runs in two phases: `requestAccountDeletion` records a PENDING
 * request and schedules `executeAccountDeletion` via a delayed pg-boss job
 * after a 48-hour grace period. `cancelAccountDeletion` aborts while pending.
 * The executor re-checks the request row, so a missed job cancel is safe.
 */

/** Grace period between deletion request and execution. */
export const ACCOUNT_DELETION_GRACE_MS = 48 * 60 * 60 * 1000

/**
 * Display label stored on shared history when the user opts out of keeping
 * their name. A data constant (not translated per viewer): history rows are
 * rendered verbatim for every member.
 */
export const DELETED_MEMBER_DISPLAY_NAME = 'Deleted member'

/** Prefix for denormalized creator references that cannot be nulled. */
export const DELETED_ACCOUNT_MARKER_PREFIX = 'deleted:'

export function deletedAccountMarker(accountId: string): string {
  return `${DELETED_ACCOUNT_MARKER_PREFIX}${accountId}`
}

export class AccountDeletionError extends Error {
  constructor(
    public readonly code:
      | 'emailMismatch'
      | 'alreadyRequested'
      | 'noPendingRequest'
      | 'sessionNotFresh'
      | 'invalidDisplayName',
    message: string,
  ) {
    super(message)
    this.name = 'AccountDeletionError'
  }
}

/** Remnant name rules mirror the profile name field. */
export const DELETION_DISPLAY_NAME_MAX_LENGTH = 100

export type DeletionGroupSummary = {
  groupId: string
  name: string
  groupType: GroupType
  role: 'ADMIN' | 'MEMBER'
  isLastAdmin: boolean
  isLastActiveMember: boolean
  hasUnsettledBalance: boolean
  /** The executor will permanently delete this group (no other members). */
  willDeleteGroup: boolean
}

export type DeletionPreview = {
  displayName: string
  email: string
  signInMethods: string[]
  groups: DeletionGroupSummary[]
  pendingSentInvitations: number
  request: {
    executeAt: Date
    keepDisplayName: boolean
    status: 'PENDING' | 'EXECUTING'
  } | null
}

function providerLabel(providerId: string): string {
  switch (providerId) {
    case 'google':
      return 'Google'
    case 'github':
      return 'GitHub'
    case 'twitter':
      return 'X'
    default:
      return providerId
  }
}

async function listSignInMethods(accountId: string): Promise<string[]> {
  const [account, identities, recovery, passkeyCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: accountId },
      select: { email: true, emailVerified: true },
    }),
    prisma.account.findMany({
      where: { userId: accountId },
      select: { providerId: true, password: true },
    }),
    prisma.anonymousRecoveryCredential.findUnique({
      where: { accountId },
      select: { acknowledgedAt: true, onboardingCompletedAt: true },
    }),
    prisma.passkey.count({ where: { userId: accountId } }),
  ])
  const methods: string[] = []
  if (identities.some((identity) => identity.password != null)) {
    methods.push('Password')
  }
  for (const identity of identities) {
    if (identity.providerId !== 'credential') {
      const label = providerLabel(identity.providerId)
      if (!methods.includes(label)) methods.push(label)
    }
  }
  if (passkeyCount > 0) methods.push('Passkey')
  if (
    recovery?.acknowledgedAt != null &&
    recovery.onboardingCompletedAt != null
  ) {
    methods.push('Recovery link')
  }
  if (
    isEmailAuthEnabled() &&
    account?.email &&
    !isPlaceholderEmail(account.email) &&
    account.emailVerified === true
  ) {
    methods.push('Email link')
  }
  return methods
}

/**
 * Peer-aware label for the preview list. Mirrors `resolveDisplayName` in the
 * group detail endpoint: friend ledgers store a random placeholder in
 * `Group.name`, so returning it raw would render a hex id in the dialog.
 */
export function resolvePreviewGroupName(
  group: {
    name: string
    groupType: GroupType
    members: Array<{
      accountId: string
      account: { name: string | null } | null
    }>
    invitations: Array<{ temporaryName: string | null; email: string | null }>
  },
  viewerAccountId: string,
): string {
  if (group.groupType !== 'FRIEND') return group.name
  const peerMember = group.members.find(
    (member) => member.accountId !== viewerAccountId,
  )
  if (peerMember?.account?.name) return peerMember.account.name
  const pendingInvitation = group.invitations[0]
  if (pendingInvitation?.temporaryName) return pendingInvitation.temporaryName
  if (pendingInvitation?.email)
    return getInvitationDisplayName(pendingInvitation)
  return ''
}

/**
 * Read-only summary the web client renders in the delete-account dialog: every
 * active membership with its leave consequences, pending invites the account
 * sent, sign-in methods that will all be removed, and any pending deletion
 * request. Never throws a precondition — those live in
 * `requestAccountDeletion`.
 */
export async function getDeletionPreview(
  accountId: string,
): Promise<DeletionPreview> {
  const account = await prisma.user.findUnique({
    where: { id: accountId },
    select: { name: true, email: true },
  })
  if (!account) throw new Error('Account not found')

  const [memberships, pendingSentInvitations, signInMethods, request] =
    await Promise.all([
      prisma.groupMember.findMany({
        where: { accountId, status: GroupMemberStatus.ACTIVE },
        select: {
          role: true,
          group: {
            select: {
              id: true,
              name: true,
              groupType: true,
              // Friend ledgers store a random placeholder in `name`; resolve
              // the peer-aware label like the group detail endpoint does.
              members: {
                where: { status: GroupMemberStatus.ACTIVE },
                select: {
                  accountId: true,
                  account: { select: { name: true } },
                },
                take: 2,
              },
              invitations: {
                where: { status: GroupInvitationStatus.PENDING },
                select: { temporaryName: true, email: true },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.groupInvitation.count({
        where: {
          invitedById: accountId,
          status: GroupInvitationStatus.PENDING,
        },
      }),
      listSignInMethods(accountId),
      prisma.accountDeletionRequest.findUnique({
        where: { accountId },
        select: { executeAt: true, keepDisplayName: true, status: true },
      }),
    ])

  const groups: DeletionGroupSummary[] = await Promise.all(
    memberships.map(async (membership) => {
      const preview = await getLeavePreview({
        groupId: membership.group.id,
        accountId,
      })
      return {
        groupId: membership.group.id,
        name: resolvePreviewGroupName(membership.group, accountId),
        groupType: membership.group.groupType,
        role: preview.role,
        isLastAdmin: preview.isLastAdmin,
        isLastActiveMember: preview.isLastActiveMember,
        hasUnsettledBalance: preview.hasUnsettledBalance,
        willDeleteGroup: preview.isLastActiveMember,
      }
    }),
  )

  return {
    displayName: account.name,
    email: account.email,
    signInMethods,
    groups,
    pendingSentInvitations,
    request:
      request?.status === 'PENDING' || request?.status === 'EXECUTING'
        ? {
            executeAt: request.executeAt,
            keepDisplayName: request.keepDisplayName,
            status: request.status,
          }
        : null,
  }
}

async function notifySafely(
  task: () => Promise<unknown>,
  context: string,
): Promise<void> {
  try {
    await task()
  } catch (error) {
    console.warn(`[account-deletion] ${context}:`, error)
  }
}

/**
 * Record a PENDING deletion request and schedule execution after the grace
 * period. The typed email must match the account email (case-insensitive) and
 * the session must be fresh (created within the freshness window), so a stale
 * stolen cookie alone cannot start the flow.
 */
export async function requestAccountDeletion({
  accountId,
  email,
  keepDisplayName,
  displayName,
  settleBalances = true,
  sessionCreatedAt,
  now = new Date(),
}: {
  accountId: string
  email: string
  keepDisplayName: boolean
  /**
   * Custom label kept on shared history. Only stored when `keepDisplayName` is
   * true; blank/overlong values are rejected so history never renders an empty
   * label.
   */
  displayName?: string
  /**
   * When false, group exits skip settlement and debts stay on the remnant.
   * Defaults true (legacy behavior) so direct callers that predate the option
   * keep settling; the tRPC layer always passes an explicit value.
   */
  settleBalances?: boolean
  sessionCreatedAt: Date
  now?: Date
}): Promise<{ executeAt: Date }> {
  if (
    now.getTime() - new Date(sessionCreatedAt).getTime() >
    SESSION_FRESH_AGE_SECONDS * 1000
  ) {
    throw new AccountDeletionError(
      'sessionNotFresh',
      'Your session is too old for this action. Sign out and sign back in, then try again.',
    )
  }

  const account = await prisma.user.findUnique({
    where: { id: accountId },
    select: { name: true, email: true },
  })
  if (!account) throw new Error('Account not found')
  if (account.email.toLowerCase() !== email.trim().toLowerCase()) {
    throw new AccountDeletionError(
      'emailMismatch',
      'The typed email does not match your account email.',
    )
  }

  const existing = await prisma.accountDeletionRequest.findUnique({
    where: { accountId },
    select: { status: true, generation: true },
  })
  if (existing?.status === 'PENDING' || existing?.status === 'EXECUTING') {
    throw new AccountDeletionError(
      'alreadyRequested',
      'A deletion request is already pending for this account.',
    )
  }

  const trimmedDisplayName = displayName?.trim() ?? ''
  if (keepDisplayName && displayName !== undefined) {
    if (
      trimmedDisplayName.length === 0 ||
      trimmedDisplayName.length > DELETION_DISPLAY_NAME_MAX_LENGTH
    ) {
      throw new AccountDeletionError(
        'invalidDisplayName',
        'Enter a name between 1 and 100 characters to keep on shared history.',
      )
    }
  }

  const executeAt = new Date(now.getTime() + ACCOUNT_DELETION_GRACE_MS)
  const generation = crypto.randomUUID()
  const data = {
    generation,
    emailSnapshot: account.email,
    displayNameSnapshot: account.name,
    keepDisplayName,
    displayNameOverride:
      keepDisplayName && trimmedDisplayName ? trimmedDisplayName : null,
    settleBalances,
    requestedAt: now,
    executeAt,
    status: 'PENDING' as const,
    jobId: null as string | null,
    executedAt: null,
    cancelledAt: null,
  }
  // The row and delayed job commit together; a failed enqueue never leaves
  // a pending request without a job, or destroys a previously cancelled row.
  const boss = await getApiBossForWrite()
  try {
    await prisma.$transaction(async (tx) => {
      if (existing) {
        const replaced = await tx.accountDeletionRequest.updateMany({
          where: {
            accountId,
            generation: existing.generation ?? null,
            status: { in: ['CANCELLED', 'EXECUTED'] },
          },
          data,
        })
        if (replaced.count !== 1) {
          throw new AccountDeletionError(
            'alreadyRequested',
            'A deletion request is already pending for this account.',
          )
        }
      } else {
        await tx.accountDeletionRequest.create({ data: { accountId, ...data } })
      }
      const jobId = await sendJob(
        boss,
        JOB_NAMES.EXECUTE_ACCOUNT_DELETION,
        { accountId, generation },
        {
          startAfter: executeAt,
          singletonKey: `account-deletion:${accountId}:${generation}`,
          db: bossTransactionDb(tx),
        },
      )
      if (typeof jobId !== 'string')
        throw new Error('Unable to schedule account deletion')
      await tx.accountDeletionRequest.updateMany({
        where: { accountId, generation, status: 'PENDING' },
        data: { jobId },
      })
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AccountDeletionError(
        'alreadyRequested',
        'A deletion request is already pending for this account.',
      )
    }
    throw error
  }

  const executeAtLabel = executeAt.toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'long',
    timeZone: 'UTC',
  })
  await notifySafely(async () => {
    const rendered = await renderAccountDeletionRequestedEmail({
      executeAtLabel,
      keepDisplayName,
    })
    await sendEmail({ to: account.email, ...rendered })
  }, 'failed to send deletion-requested notice')

  return { executeAt }
}

/** Cancel only an unstarted request, guarded against execution and replacement. */
export async function cancelAccountDeletion(
  accountId: string,
  now = new Date(),
): Promise<{ cancelled: boolean }> {
  const request = await prisma.accountDeletionRequest.findUnique({
    where: { accountId },
    select: {
      status: true,
      generation: true,
      jobId: true,
      emailSnapshot: true,
    },
  })
  if (!request || request.status !== 'PENDING') {
    throw new AccountDeletionError(
      'noPendingRequest',
      'There is no pending deletion request to cancel.',
    )
  }

  const cancelled = await prisma.accountDeletionRequest.updateMany({
    where: {
      accountId,
      generation: request.generation ?? null,
      status: 'PENDING',
    },
    data: { status: 'CANCELLED', cancelledAt: now, jobId: null },
  })
  if (cancelled.count === 0) {
    throw new AccountDeletionError(
      'noPendingRequest',
      'There is no pending deletion request to cancel.',
    )
  }

  // Best-effort: the executor re-checks `status`, so a missed cancel still
  // cannot delete the account.
  if (request.jobId) {
    const boss = await getApiBoss().catch(() => null)
    if (boss) {
      await boss
        .cancel(JOB_NAMES.EXECUTE_ACCOUNT_DELETION, request.jobId)
        .catch((error: unknown) => {
          console.warn(
            '[account-deletion] failed to cancel delayed job:',
            error,
          )
        })
    }
  }

  const recipient = request.emailSnapshot
  await notifySafely(async () => {
    const rendered = await renderAccountDeletionCancelledEmail()
    await sendEmail({ to: recipient, ...rendered })
  }, 'failed to send deletion-cancelled notice')

  return { cancelled: true }
}

export type ExecuteAccountDeletionResult =
  | { executed: true }
  | {
      executed: false
      reason:
        | 'not-found'
        | 'not-due'
        | 'cancelled'
        | 'already-done'
        | 'already-running'
        | 'account-gone'
        | 'superseded'
    }

/**
 * Execute a due deletion request. Idempotent: the request row is claimed with a
 * PostgreSQL advisory lock plus an atomic status transition, so concurrent
 * workers and retries of abandoned EXECUTING requests remain safe. Every step
 * re-reads current state, so a retry after a partial run skips completed work.
 */
export async function executeAccountDeletion(
  accountId: string,
  _boss?: SpliitBoss | null,
  now = new Date(),
  generation?: string,
): Promise<ExecuteAccountDeletionResult> {
  // The transaction holds only an advisory lock; deletion steps commit
  // independently so a retry can resume partial work. PostgreSQL releases the
  // lock when the worker connection dies, unlike a durable EXECUTING flag.
  return prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(
          hashtextextended(${`account-deletion:${accountId}`}, 0)
        ) AS acquired
      `
      if (!lock.acquired) {
        return { executed: false, reason: 'already-running' }
      }
      return executeLockedAccountDeletion(accountId, now, generation)
    },
    { timeout: 15 * 60 * 1000 },
  )
}

async function executeLockedAccountDeletion(
  accountId: string,
  now: Date,
  generation?: string,
): Promise<ExecuteAccountDeletionResult> {
  const claimed = await prisma.accountDeletionRequest.updateMany({
    where: {
      accountId,
      generation: generation ?? null,
      status: { in: ['PENDING', 'EXECUTING'] },
      executeAt: { lte: now },
    },
    data: { status: 'EXECUTING' },
  })
  if (claimed.count === 0) {
    const request = await prisma.accountDeletionRequest.findUnique({
      where: { accountId },
      select: { status: true, executeAt: true, generation: true },
    })
    if (!request) return { executed: false, reason: 'not-found' }
    if ((request.generation ?? null) !== (generation ?? null))
      return { executed: false, reason: 'superseded' }
    if (request.status === 'EXECUTED')
      return { executed: false, reason: 'already-done' }
    if (request.status === 'EXECUTING')
      return { executed: false, reason: 'already-running' }
    if (request.status === 'CANCELLED')
      return { executed: false, reason: 'cancelled' }
    return { executed: false, reason: 'not-due' }
  }

  // Keep EXECUTING on errors: committed steps are irreversible and retries resume.
  const request = await prisma.accountDeletionRequest.findUnique({
    where: { accountId },
  })
  if (!request) return { executed: false, reason: 'not-found' }

  const account = await prisma.user.findUnique({
    where: { id: accountId },
    select: { name: true, email: true, image: true },
  })
  if (!account) {
    // The account is already gone (e.g. removed by an operator); close the
    // request so it never blocks a future re-registration... of the same id
    // (ids are never reused, so this is purely a tombstone).
    await prisma.accountDeletionRequest.update({
      where: {
        accountId,
        generation: generation ?? null,
        status: 'EXECUTING',
      },
      data: { status: 'EXECUTED', executedAt: now },
    })
    return { executed: false, reason: 'account-gone' }
  }

  const replacementName = request.keepDisplayName
    ? (request.displayNameOverride ?? request.displayNameSnapshot)
    : DELETED_MEMBER_DISPLAY_NAME

  await runDeletionSteps(
    accountId,
    request,
    account,
    replacementName,
    request.settleBalances,
  )

  await prisma.accountDeletionRequest.update({
    where: { accountId, generation: generation ?? null, status: 'EXECUTING' },
    data: { status: 'EXECUTED', executedAt: now, jobId: null },
  })

  const recipient = request.emailSnapshot
  await notifySafely(async () => {
    const rendered = await renderAccountDeletionExecutedEmail()
    await sendEmail({ to: recipient, ...rendered })
  }, 'failed to send deletion-executed notice')

  return { executed: true }
}

async function runDeletionSteps(
  accountId: string,
  request: { emailSnapshot: string },
  account: { image: string | null },
  replacementName: string,
  settleBalances: boolean,
): Promise<void> {
  const now = new Date()
  await exitGroups(accountId, settleBalances)
  await revokePendingSentInvitations(accountId, now)
  const commentIds = await scrubAuthoredContent(accountId, replacementName)
  // Scrub membership subjects and invitation labels before detaching links.
  await scrubActivityAttribution(accountId, commentIds, replacementName)
  await migrateParticipants(accountId, replacementName)

  // Revoke OAuth grants before the cascade removes the rows: bumping the
  // authorization generation is what kills already-issued JWT access tokens.
  const consents = await prisma.oauthConsent.findMany({
    where: { userId: accountId },
    select: { id: true },
  })
  for (const consent of consents) {
    await revokeAuthorizedClient({ accountId, consentId: consent.id })
  }

  // Sessions die with the account; deleting them first signs every device
  // out immediately even if a later step failed. Ephemeral verification
  // tokens (magic links, OTPs) are matched only when the email is a full
  // colon-separated identifier segment, so `est@x.com` never matches
  // `test@x.com`.
  await prisma.session.deleteMany({ where: { userId: accountId } })
  await prisma.$executeRaw`
    DELETE FROM "Verification"
    WHERE string_to_array("identifier", ':') @> ARRAY[${request.emailSnapshot}]::text[]
  `

  if (account.image && isProfileImageUrlForAccount(account.image, accountId)) {
    await notifySafely(
      () => deleteS3Object(account.image as string),
      'failed to delete profile image',
    )
  }

  await prisma.user.delete({ where: { id: accountId } })
  invalidateAccountCache(accountId)
}

/**
 * Leave every group following the same rules as the manual leave flow: promote
 * the earliest-joined other member when last admin, and permanently delete
 * groups with no other members (including archived ones — the deleter chose
 * full erasure, and a memberless archived group would otherwise be orphaned
 * forever). Balances are force-settled unless the request opted out, in which
 * case remaining debts stay attributed to the remnant placeholder. Archived
 * active memberships follow the same settlement choice during account erasure.
 */
async function exitGroups(
  accountId: string,
  settleBalances: boolean,
): Promise<void> {
  const memberships = await prisma.groupMember.findMany({
    where: { accountId, status: GroupMemberStatus.ACTIVE },
    select: {
      id: true,
      role: true,
      group: {
        select: { id: true, archived: true, groupType: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  for (const listed of memberships) {
    const membership = await prisma.groupMember.findUnique({
      where: { id: listed.id },
      select: {
        id: true,
        role: true,
        status: true,
        group: { select: { id: true } },
      },
    })
    if (!membership || membership.status !== GroupMemberStatus.ACTIVE) continue
    const group = await prisma.group.findUnique({
      where: { id: membership.group.id },
      select: { id: true },
    })
    if (!group) continue

    const otherActive = await prisma.groupMember.findMany({
      where: {
        groupId: membership.group.id,
        status: GroupMemberStatus.ACTIVE,
        NOT: { id: membership.id },
      },
      select: { id: true, role: true },
      orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
    })
    if (otherActive.length === 0) {
      await deleteGroup({
        groupId: membership.group.id,
        actor: { accountId },
        onlyIfLastActiveMember: true,
      })
      continue
    }
    let promoteMemberId: string | undefined
    if (
      membership.role === 'ADMIN' &&
      otherActive.every((member) => member.role !== 'ADMIN')
    ) {
      promoteMemberId = otherActive[0]?.id
    }
    // `leaveGroup` is group-type agnostic (FRIEND restrictions live in the
    // tRPC procedures only): it flips the membership to LEFT while keeping
    // the participant for history, so the peer keeps seeing the ledger.
    try {
      await leaveGroup({
        groupId: membership.group.id,
        actor: { accountId },
        force: true,
        settle: settleBalances,
        allowArchived: true,
        promoteMemberId,
      })
    } catch (error) {
      const current = await prisma.groupMember.findUnique({
        where: { id: membership.id },
        select: { status: true },
      })
      if (current?.status === GroupMemberStatus.ACTIVE) throw error
      // Another operation already removed the membership or deleted the group.
    }
  }
}

/** Pending invites the account sent are revoked instead of transferred. */
async function revokePendingSentInvitations(
  accountId: string,
  now: Date,
): Promise<void> {
  await prisma.groupInvitation.updateMany({
    where: { invitedById: accountId, status: GroupInvitationStatus.PENDING },
    data: {
      status: GroupInvitationStatus.REVOKED,
      revokedAt: now,
      ledgerParticipantId: null,
    },
  })
}

/**
 * Convert every participant backed by the account's memberships into a
 * name-only row. Splits and balances keep pointing at the participant, so other
 * members' books are untouched — only the account link is severed. Also
 * detaches split presets and subgroup links the leave flow would have removed
 * (covers archived groups that could not be left).
 */
async function migrateParticipants(
  accountId: string,
  replacementName: string,
): Promise<void> {
  const participants = await prisma.ledgerParticipant.findMany({
    where: { groupMember: { accountId } },
    select: { id: true },
  })
  for (const participant of participants) {
    await adjustSplitPresetsForRemovedParticipant(participant.id)
    await removeParticipantFromSubgroup(participant.id)
  }
  if (participants.length > 0) {
    // Accepted invitations retain a participant link and otherwise take
    // precedence over displayName in expense/export label resolution.
    await prisma.groupInvitation.updateMany({
      where: { ledgerParticipantId: { in: participants.map(({ id }) => id) } },
      data: {
        email: 'deleted@account.placeholder.local',
        temporaryName: replacementName,
      },
    })
    await prisma.ledgerParticipant.updateMany({
      where: { groupMember: { accountId } },
      data: {
        kind: 'UNLINKED_PARTICIPANT',
        displayName: replacementName,
        groupMemberId: null,
        removedAt: new Date(),
      },
    })
  }
}

/**
 * Scrub authored content that survives deletion by design. Returns the comment
 * ids for activity attribution scrubbing below.
 */
async function scrubAuthoredContent(
  accountId: string,
  replacementName: string,
): Promise<string[]> {
  const comments = await prisma.expenseComment.findMany({
    where: { authorAccountId: accountId },
    select: { id: true },
  })
  await prisma.expenseComment.updateMany({
    where: { authorAccountId: accountId },
    data: { authorName: replacementName },
  })
  await prisma.groupBudget.updateMany({
    where: { createdByAccountId: accountId },
    data: { createdByAccountId: deletedAccountMarker(accountId) },
  })
  await prisma.expenseFileImportSource.updateMany({
    where: { importedByAccountId: accountId },
    data: { importedByAccountId: null },
  })
  return comments.map((comment) => comment.id)
}

/**
 * Detach activity feed entries from the deleted account and replace stored name
 * snapshots with the replacement label. Matching is by linkage (`actorId`,
 * `expenseCommentId`) — never by name equality — so renames during the grace
 * period and comment activities (`authorName`) are covered. Runs after group
 * exits so MEMBER_LEFT rows are included. Comment excerpts are kept
 * deliberately: they duplicate the comment text, which shared history preserves
 * by design — only the attribution is scrubbed.
 */
async function scrubActivityAttribution(
  accountId: string,
  commentIds: string[],
  replacementName: string,
): Promise<void> {
  // One CASE per key so absent keys are left untouched (jsonb_set would
  // otherwise add them to every row). Each level tests the original row and
  // threads the previous level's result through.
  const replacement = Prisma.sql`to_jsonb(${replacementName}::text)`
  const scrubDisplayName = Prisma.sql`
    CASE WHEN "data" ? 'displayName'
      THEN jsonb_set("data", '{displayName}', ${replacement})
      ELSE "data" END`
  const scrubAuthor = Prisma.sql`
    CASE WHEN "data" ? 'authorName'
      THEN jsonb_set(${scrubDisplayName}, '{authorName}', ${replacement})
      ELSE ${scrubDisplayName} END`

  await prisma.$executeRaw`
    UPDATE "Activity" SET "data" = ${scrubAuthor} WHERE "actorId" = ${accountId}
  `
  await prisma.$executeRaw`
    UPDATE "Activity"
    SET "data" = jsonb_set("data", '{targetDisplayName}', ${replacement})
    WHERE "subjectType" = 'MEMBER' AND "data" ? 'targetDisplayName'
      AND "subjectId" IN (
        SELECT "id" FROM "GroupMember" WHERE "accountId" = ${accountId}
      )
  `
  // Invitation activity labels describe the invitee, not the actor. Include
  // accepted invites and invitations still linked to the member participant.
  await prisma.$executeRaw`
    UPDATE "Activity"
    SET "data" = jsonb_set("data", '{displayLabel}', ${replacement})
    WHERE "subjectType" = 'INVITATION' AND "data" ? 'displayLabel'
      AND "subjectId" IN (
        SELECT "i"."id" FROM "GroupInvitation" AS "i"
        LEFT JOIN "LedgerParticipant" AS "p" ON "p"."id" = "i"."ledgerParticipantId"
        LEFT JOIN "GroupMember" AS "m" ON "m"."id" = "p"."groupMemberId"
        WHERE "i"."acceptedById" = ${accountId} OR "m"."accountId" = ${accountId}
      )
  `
  await prisma.groupInvitation.updateMany({
    where: { acceptedById: accountId },
    data: {
      email: 'deleted@account.placeholder.local',
      temporaryName: replacementName,
    },
  })
  if (commentIds.length > 0) {
    const scrubCommentAuthor = Prisma.sql`
      CASE WHEN "data" ? 'authorName'
        THEN jsonb_set("data", '{authorName}', ${replacement})
        ELSE "data" END`
    await prisma.$executeRaw`
      UPDATE "Activity" SET "data" = ${scrubCommentAuthor}
      WHERE "expenseCommentId" IN (${Prisma.join(commentIds)})
    `
  }
  await prisma.activity.updateMany({
    where: { actorId: accountId },
    data: { actorId: null },
  })
}

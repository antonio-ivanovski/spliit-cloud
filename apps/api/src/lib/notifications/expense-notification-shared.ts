/**
 * Shared building blocks for the expense channel dispatchers (email and push).
 * Both channels walk the same activity pipeline: parse the activity data,
 * resolve a recipient scope (participants + group + actor), and pick up any
 * targeted account that the activity handler flagged. Extracting those
 * primitives here keeps the two dispatchers aligned without forcing either to
 * bend around the other's per-channel shape.
 */
import { prisma } from '@spliit/db'
import type { Expense } from '@spliit/domain'
import { getCurrency } from '@spliit/domain'

import { getAffectedParticipantIds } from '../api/expense-activity-diff'
import type { ActivityNotificationEvent } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Active group member projection used by both channels for friend-ledger
 * display name resolution. Each channel may select a different account subset
 * (email needs `email`, push needs `name`), so additional account fields are
 * kept optional and accessors guard accordingly.
 */
export type ExpenseNotificationMember = {
  account: { id: string; name?: string | null; email?: string | null } | null
}

export type ExpenseNotificationGroup = {
  groupType: string
  name: string
  members: ExpenseNotificationMember[]
  invitations: { temporaryName: string | null }[]
}

export type ExpenseNotificationParticipant = {
  groupMember: {
    status: string
    account: { id: string; name?: string | null; email?: string | null } | null
  } | null
}

export type ExpenseNotificationActorAccount = {
  name: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Shared `prisma.group.findUnique` projection for friend-ledger display name
 * resolution.
 */
export const EXPENSE_GROUP_SELECT = {
  name: true,
  groupType: true,
  members: {
    where: { status: 'ACTIVE' },
    select: { account: { select: { id: true, name: true } } },
    take: 2,
  },
  invitations: {
    where: { status: 'PENDING' },
    select: { temporaryName: true },
    take: 1,
    orderBy: { createdAt: 'desc' as const },
  },
} as const

/**
 * Fields needed to call `getAffectedParticipantIds` without a full Expense
 * hydration.
 */
const EXPENSE_AFFECTED_SELECT = {
  paidByList: { select: { ledgerParticipantId: true, shares: true } },
  paidFor: { select: { ledgerParticipantId: true, shares: true } },
  items: {
    select: {
      id: true,
      paidFor: { select: { ledgerParticipantId: true, shares: true } },
    },
  },
  itemizedRemainder: {
    select: {
      splitMode: true,
      paidFor: { select: { ledgerParticipantId: true, shares: true } },
    },
  },
} as const

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Render a minor-unit amount with its currency code. Falls back to bare digits
 * when no code is provided so callers can stage text without a currency
 * prefix.
 */
export function formatExpenseAmount(
  cents: number,
  currencyCode?: string | null,
): string {
  const currency = currencyCode ? getCurrency(currencyCode) : undefined
  const digits = currency?.decimal_digits ?? 2
  const formatted = (cents / 100).toFixed(digits)
  return currencyCode ? `${currencyCode} ${formatted}` : formatted
}

/**
 * Render an amount that may have been recorded in a foreign currency, showing
 * both original and ledger values when they differ.
 */
export function formatExpenseDualAmount(
  amount: number,
  currencyCode: string | null | undefined,
  originalAmount: number | undefined,
  ledgerCurrencyCode: string | null | undefined,
): string {
  if (
    originalAmount != null &&
    currencyCode &&
    ledgerCurrencyCode &&
    ledgerCurrencyCode !== currencyCode
  ) {
    return `${formatExpenseAmount(originalAmount, currencyCode)} (${formatExpenseAmount(amount, ledgerCurrencyCode)})`
  }
  // When currencyCode is absent (same-currency expense where the
  // originalCurrency is null), fall back to ledgerCurrencyCode so the
  // rendered text shows a currency prefix instead of bare digits.
  return formatExpenseAmount(amount, currencyCode ?? ledgerCurrencyCode)
}

// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------

/**
 * Resolve the human-readable group label from a recipient's perspective.
 * Friend-ledger groups use peer-aware phrasing; all other groups use the raw
 * group name. `recipientAccountId` is optional so broadcast callers (no single
 * recipient) can fall through to the invitation temporary name.
 */
export function resolveGroupDisplayName(
  groupType: string,
  groupName: string,
  members: ExpenseNotificationMember[],
  recipientAccountId: string | undefined,
  pendingTemporaryName: string | undefined,
): string {
  if (groupType !== 'FRIEND') return groupName
  if (recipientAccountId) {
    const peer = members.find(
      (m) => m.account && m.account.id !== recipientAccountId,
    )
    if (peer?.account?.name) {
      return `your friend ledger with ${peer.account.name}`
    }
  }
  if (pendingTemporaryName) {
    return `your friend ledger with ${pendingTemporaryName}`
  }
  return 'your friend ledger'
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

/**
 * Reload the freshly-created expense and return every `ledgerParticipantId`
 * affected by it. Used for `EXPENSE_CREATED` and `RECURRING_EXPENSE_CREATED`
 * where the activity payload does not yet carry a pre-computed
 * `affectedParticipants` union.
 */
export async function resolveCreatedExpenseRecipientIds(
  expenseId: string,
): Promise<string[]> {
  const raw = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: EXPENSE_AFFECTED_SELECT,
  })
  if (!raw) return []
  const expenseForDiff = {
    paidByList: raw.paidByList.map((pb) => ({
      participant: pb.ledgerParticipantId,
      shares: pb.shares,
    })),
    paidFor: raw.paidFor.map((pf) => ({
      participant: pf.ledgerParticipantId,
      shares: pf.shares,
    })),
    items: raw.items.map((item) => ({
      id: item.id,
      paidFor: item.paidFor.map((pf) => ({
        participant: pf.ledgerParticipantId,
        shares: pf.shares,
      })),
    })),
    itemizedRemainder: raw.itemizedRemainder
      ? {
          splitMode: raw.itemizedRemainder.splitMode,
          paidFor: raw.itemizedRemainder.paidFor.map((pf) => ({
            participant: pf.ledgerParticipantId,
            shares: pf.shares,
          })),
        }
      : undefined,
  } as unknown as Expense
  return [...getAffectedParticipantIds({ newExpense: expenseForDiff })]
}

/**
 * Resolve and attach a targeted active member (typically the original series
 * creator) to the participant list when the activity handler flagged them via
 * `includeActorAsRecipient`. Returns the original array unchanged when the
 * account is already present or cannot be found.
 */
export async function ensureAccountIncludedAsParticipant(args: {
  groupId: string
  participants: ExpenseNotificationParticipant[]
  accountId: string
}): Promise<ExpenseNotificationParticipant[]> {
  const hasRecipient = args.participants.some(
    (participant) => participant.groupMember?.account?.id === args.accountId,
  )
  if (hasRecipient) return args.participants
  const member = await prisma.groupMember.findFirst({
    where: {
      groupId: args.groupId,
      accountId: args.accountId,
      status: 'ACTIVE',
    },
    select: {
      status: true,
      account: { select: { id: true, email: true, name: true } },
    },
  })
  if (!member?.account) return args.participants
  return [
    ...args.participants,
    {
      groupMember: {
        status: member.status,
        account: member.account,
      },
    } as ExpenseNotificationParticipant,
  ]
}

// ---------------------------------------------------------------------------
// Parallel fetches
// ---------------------------------------------------------------------------

/**
 * Fetch the participants, group, and actor account in a single `Promise.all`.
 * Both channel dispatchers need this exact trio for their main
 * (`EXPENSE_CREATED/UPDATED/DELETED`) and import-summary code paths.
 */
export async function loadActivityChannelContext(args: {
  groupId: string
  participantIds: string[]
  actor: ActivityNotificationEvent['actor']
}): Promise<{
  participants: ExpenseNotificationParticipant[]
  group: ExpenseNotificationGroup | null
  actorName: string
}> {
  const [participants, group, actorAccount] = await Promise.all([
    prisma.ledgerParticipant.findMany({
      where: { id: { in: args.participantIds } },
      include: { groupMember: { include: { account: true } } },
    }),
    prisma.group.findUnique({
      where: { id: args.groupId },
      select: EXPENSE_GROUP_SELECT,
    }),
    args.actor?.type === 'ACCOUNT'
      ? prisma.account.findUnique({
          where: { id: args.actor.id },
          select: { name: true },
        })
      : Promise.resolve(null),
  ])
  return {
    participants: participants as unknown as ExpenseNotificationParticipant[],
    group: group as ExpenseNotificationGroup | null,
    actorName: actorAccount?.name ?? 'Someone',
  }
}

/**
 * Fetch the group and the actor account only. Used by the summary and
 * recurrence-stopped paths that address a single recipient directly and do not
 * need a participant-list fan-out.
 */
export async function loadActivityGroupAndActor(args: {
  groupId: string
  actor: ActivityNotificationEvent['actor']
}): Promise<{
  group: ExpenseNotificationGroup | null
  actorName: string
}> {
  const [group, actorAccount] = await Promise.all([
    prisma.group.findUnique({
      where: { id: args.groupId },
      select: EXPENSE_GROUP_SELECT,
    }),
    args.actor?.type === 'ACCOUNT'
      ? prisma.account.findUnique({
          where: { id: args.actor.id },
          select: { name: true },
        })
      : Promise.resolve(null),
  ])
  return {
    group: group as ExpenseNotificationGroup | null,
    actorName: actorAccount?.name ?? 'Someone',
  }
}

/**
 * Fetch the recurring-summary / recurrence-stopped subject member for a direct
 * `recipientAccountId`. Both channels look this up with the same shape and use
 * it as the single-recipient participant for their fan-out.
 */
export async function loadActivityRecipientMember(args: {
  groupId: string
  recipientAccountId: string
}): Promise<{
  status: string
  account: { id: string; name: string | null; email: string | null }
} | null> {
  const member = await prisma.groupMember.findFirst({
    where: {
      groupId: args.groupId,
      accountId: args.recipientAccountId,
      status: 'ACTIVE',
    },
    select: {
      status: true,
      account: { select: { id: true, email: true, name: true } },
    },
  })
  return member?.account
    ? {
        status: member.status,
        account: {
          id: member.account.id,
          name: member.account.name,
          email: member.account.email,
        },
      }
    : null
}

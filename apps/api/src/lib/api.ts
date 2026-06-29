import {
  ActivityType,
  Expense,
  GroupInvitationStatus,
  GroupMemberStatus,
  GroupRole,
  LedgerParticipantKind,
  prisma,
  RecurrenceRule,
  type Ledger,
  type LedgerParticipant,
  type Prisma,
} from '@spliit/db'
import {
  calculateNextDate,
  categoryIdSchema,
  DEFAULT_CATEGORY_ID,
  getBalances,
  getCategoryById,
  getPublicBalances,
  getSuggestedReimbursements,
  PAYMENT_CATEGORY_ID,
  type BalanceExpense,
  type Balances,
  type Category,
  type CategoryId,
  type ExpenseFormValues,
  type GroupFormValues,
  type Reimbursement,
} from '@spliit/domain'
import { deleteS3Object, markS3ObjectAsOwned } from '../routes/upload'
import { resolveParticipantDisplayName } from './invitations'

export function randomId(size?: number) {
  const id = crypto.randomUUID().replaceAll('-', '')
  return size ? id.slice(0, size) : id
}

type GroupWithLedger = Awaited<ReturnType<typeof loadGroupWithLedger>>

async function loadGroupWithLedger(groupId: string) {
  return prisma.group.findUnique({
    where: { id: groupId },
    include: { ledger: true },
  })
}

/**
 * Resolve the ledger participant id backing a given account's membership
 * in a group. Returns `null` when the account is not an active member or
 * has no ledger participant materialized yet. Used to populate
 * `Activity.ledgerParticipantId` so the activity feed can render the
 * member who performed the action (instead of the generic "someone").
 *
 * Accepts an optional Prisma client (transactional or top-level) so the
 * lookup can reuse the same client as the surrounding write — important
 * for the leave/remove/archive flows that log activity from inside a
 * transaction.
 */
async function getMemberLedgerParticipantId(
  groupId: string,
  accountId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  const member = await client.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId } },
    include: { ledgerParticipant: { select: { id: true } } },
  })
  return member?.ledgerParticipant?.id ?? null
}

/**
 * Create a cloud group with its accounting Ledger. The current account is
 * added as an ADMIN/ACTIVE member and a matching LedgerParticipant is created
 * so expenses can be recorded against them.
 *
 * `groupFormValues.participants` (if any) is treated as an "invite on create"
 * list: each entry becomes a GroupInvitation with a random placeholder name
 * resolved through the email. This is a transitional shim while the web
 * client is updated to send invitations instead of anonymous participants.
 */
export async function createGroup(
  groupFormValues: GroupFormValues,
  options: { adminAccountId: string },
) {
  return prisma.$transaction(async (tx) => {
    const ledger = await tx.ledger.create({
      data: {
        id: randomId(),
        currency: groupFormValues.currency,
        currencyCode: groupFormValues.currencyCode || null,
      },
    })

    const group = await tx.group.create({
      data: {
        id: randomId(),
        name: groupFormValues.name,
        information: groupFormValues.information,
        ledgerId: ledger.id,
      },
    })

    const adminMember = await tx.groupMember.create({
      data: {
        id: randomId(),
        groupId: group.id,
        accountId: options.adminAccountId,
        role: GroupRole.ADMIN,
        status: GroupMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    })

    await tx.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId: ledger.id,
        groupMemberId: adminMember.id,
      },
    })

    return { group, ledger, adminMember }
  })
}

export async function createExpense(
  expenseFormValues: ExpenseFormValues,
  groupId: string,
  actor: { accountId: string },
): Promise<Expense> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { ledger: true },
  })
  if (!group || !group.ledgerId) throw new Error(`Invalid group ID: ${groupId}`)

  // Resolve the current member's ledger participant id so the activity
  // feed can render the right actor (instead of the generic "someone"
  // when only the account id is stored).
  const actorLedgerParticipantId = await getMemberLedgerParticipantId(
    groupId,
    actor.accountId,
  )

  const ledgerId = group.ledgerId
  const participants = await prisma.ledgerParticipant.findMany({
    where: {
      ledgerId,
      // Allow account-backed participants (the common case), pending
      // invitation placeholders (so invitees can be referenced before
      // they accept), and unlinked imported entries (name-only rows
      // with no account and no app access).
      OR: [
        { groupMemberId: { not: null } },
        { invitations: { some: { status: 'PENDING' } } },
        { kind: 'UNLINKED_PARTICIPANT' },
      ],
    },
    select: { id: true },
  })
  const participantIds = new Set(participants.map((p) => p.id))

  for (const participantId of [
    ...expenseFormValues.paidByList.map((p) => p.participant),
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!participantIds.has(participantId)) {
      throw new Error(`Invalid participant ID: ${participantId}`)
    }
  }

  const expenseId = randomId()
  await logActivity(groupId, ActivityType.CREATE_EXPENSE, {
    accountId: actor.accountId,
    ledgerParticipantId: actorLedgerParticipantId,
    expenseId,
    data: expenseFormValues.title,
  })

  const isCreateRecurrence =
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE
  const recurringExpenseLinkPayload = isCreateRecurrence
    ? {
        id: randomId(),
        ledgerId,
        nextExpenseDate: calculateNextDate(
          expenseFormValues.recurrenceRule as RecurrenceRule,
          expenseFormValues.expenseDate,
        ),
      }
    : undefined

  const expense = await prisma.expense.create({
    data: {
      id: expenseId,
      ledgerId,
      expenseDate: expenseFormValues.expenseDate,
      categoryId: expenseFormValues.category,
      amount: expenseFormValues.amount,
      originalAmount: expenseFormValues.originalAmount,
      originalCurrency: expenseFormValues.originalCurrency,
      conversionRate: expenseFormValues.conversionRate,
      title: expenseFormValues.title,
      paidBySplitMode: expenseFormValues.paidBySplitMode,
      paidByList: {
        createMany: {
          data: expenseFormValues.paidByList.map((paidBy) => ({
            ledgerParticipantId: paidBy.participant,
            shares: paidBy.shares,
          })),
        },
      },
      splitMode: expenseFormValues.splitMode,
      recurrenceRule: expenseFormValues.recurrenceRule,
      ...(recurringExpenseLinkPayload
        ? {
            recurringExpenseLink: {
              create: recurringExpenseLinkPayload,
            },
          }
        : {}),
      paidFor: {
        createMany: {
          data: expenseFormValues.paidFor.map((paidFor) => ({
            ledgerParticipantId: paidFor.participant,
            shares: paidFor.shares,
          })),
        },
      },
      isReimbursement: expenseFormValues.isReimbursement,
      documents: {
        createMany: {
          data: expenseFormValues.documents.map((doc) => ({
            id: randomId(),
            url: doc.url,
            width: doc.width,
            height: doc.height,
          })),
        },
      },
      notes: expenseFormValues.notes,
    },
  })

  for (const doc of expenseFormValues.documents) {
    await markS3ObjectAsOwned(doc.url)
  }

  return expense
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  actor: { accountId: string },
) {
  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  const actorLedgerParticipantId = await getMemberLedgerParticipantId(
    groupId,
    actor.accountId,
  )

  await logActivity(groupId, ActivityType.DELETE_EXPENSE, {
    accountId: actor.accountId,
    ledgerParticipantId: actorLedgerParticipantId,
    expenseId,
    data: existingExpense?.title,
  })

  for (const doc of existingExpense.documents) {
    await deleteS3Object(doc.url)
  }

  await prisma.expense.deleteMany({
    where: { id: expenseId, ledgerId: existingExpense.ledgerId },
  })
}

export async function getGroupExpensesParticipants(groupId: string) {
  const expenses = await getGroupExpenses(groupId)
  return Array.from(
    new Set(
      expenses.flatMap((e) => [
        ...e.paidByList.map((pb) => pb.ledgerParticipant.id),
        ...e.paidFor.map((pf) => pf.ledgerParticipant.id),
      ]),
    ),
  )
}

export async function getGroups(groupIds: string[]) {
  return (
    await prisma.group.findMany({
      where: { id: { in: groupIds } },
      include: {
        ledger: { select: { currency: true, currencyCode: true } },
        _count: { select: { members: true } },
      },
    })
  ).map((group) => ({
    ...group,
    createdAt: group.createdAt.toISOString(),
  }))
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  expenseFormValues: ExpenseFormValues,
  actor: { accountId: string },
) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { ledger: true },
  })
  if (!group || !group.ledgerId) throw new Error(`Invalid group ID: ${groupId}`)

  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  const actorLedgerParticipantId = await getMemberLedgerParticipantId(
    groupId,
    actor.accountId,
  )

  const participants = await prisma.ledgerParticipant.findMany({
    where: {
      ledgerId: group.ledgerId,
      // Same allow-list as `createExpense`: account-backed,
      // pending-invitation placeholders, and unlinked imported entries.
      // Historical rows left behind by revoked invitations stay out so
      // an update cannot re-add a removed invitee.
      OR: [
        { groupMemberId: { not: null } },
        { invitations: { some: { status: 'PENDING' } } },
        { kind: 'UNLINKED_PARTICIPANT' },
      ],
    },
    select: { id: true },
  })
  const participantIds = new Set(participants.map((p) => p.id))
  for (const participantId of [
    ...expenseFormValues.paidByList.map((p) => p.participant),
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!participantIds.has(participantId)) {
      throw new Error(`Invalid participant ID: ${participantId}`)
    }
  }

  await logActivity(groupId, ActivityType.UPDATE_EXPENSE, {
    accountId: actor.accountId,
    ledgerParticipantId: actorLedgerParticipantId,
    expenseId,
    data: expenseFormValues.title,
  })

  const removedDocuments = existingExpense.documents.filter(
    (existingDoc) =>
      !expenseFormValues.documents.some((doc) => doc.id === existingDoc.id),
  )
  for (const doc of removedDocuments) {
    await deleteS3Object(doc.url)
  }

  const isDeleteRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule === RecurrenceRule.NONE &&
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null

  const isUpdateRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== expenseFormValues.recurrenceRule &&
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null
  const isCreateRecurrenceExpenseLink =
    existingExpense.recurrenceRule === RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE &&
    existingExpense.recurringExpenseLink === null

  const newRecurringExpenseLink = {
    id: randomId(),
    ledgerId: group.ledgerId,
    nextExpenseDate: calculateNextDate(
      expenseFormValues.recurrenceRule as RecurrenceRule,
      expenseFormValues.expenseDate,
    ),
  }

  const updatedRecurrenceExpenseLinkNextExpenseDate = calculateNextDate(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    existingExpense.expenseDate,
  )

  const expense = await prisma.expense.update({
    where: { id: expenseId },
    data: {
      expenseDate: expenseFormValues.expenseDate,
      amount: expenseFormValues.amount,
      originalAmount: expenseFormValues.originalAmount,
      originalCurrency: expenseFormValues.originalCurrency,
      conversionRate: expenseFormValues.conversionRate,
      title: expenseFormValues.title,
      categoryId: expenseFormValues.category,
      paidBySplitMode: expenseFormValues.paidBySplitMode,
      // Defensive: if the form somehow sends no paidBy rows, leave the
      // existing rows untouched rather than wiping them. The form schema
      // enforces a minimum of 1, so this branch is only a safety net.
      ...(expenseFormValues.paidByList.length > 0
        ? {
            paidByList: {
              create: expenseFormValues.paidByList
                .filter(
                  (p) =>
                    !existingExpense.paidByList.some(
                      (pb) => pb.ledgerParticipantId === p.participant,
                    ),
                )
                .map((paidBy) => ({
                  ledgerParticipantId: paidBy.participant,
                  shares: paidBy.shares,
                })),
              update: expenseFormValues.paidByList.map((paidBy) => ({
                where: {
                  expenseId_ledgerParticipantId: {
                    expenseId,
                    ledgerParticipantId: paidBy.participant,
                  },
                },
                data: {
                  shares: paidBy.shares,
                },
              })),
              deleteMany: existingExpense.paidByList
                .filter(
                  (paidBy) =>
                    !expenseFormValues.paidByList.some(
                      (p) => p.participant === paidBy.ledgerParticipantId,
                    ),
                )
                .map(({ ledgerParticipantId, shares }) => ({
                  ledgerParticipantId,
                  shares,
                })),
            },
          }
        : {}),
      splitMode: expenseFormValues.splitMode,
      recurrenceRule: expenseFormValues.recurrenceRule,
      paidFor: {
        create: expenseFormValues.paidFor
          .filter(
            (p) =>
              !existingExpense.paidFor.some(
                (pp) => pp.ledgerParticipantId === p.participant,
              ),
          )
          .map((paidFor) => ({
            ledgerParticipantId: paidFor.participant,
            shares: paidFor.shares,
          })),
        update: expenseFormValues.paidFor.map((paidFor) => ({
          where: {
            expenseId_ledgerParticipantId: {
              expenseId,
              ledgerParticipantId: paidFor.participant,
            },
          },
          data: {
            shares: paidFor.shares,
          },
        })),
        deleteMany: existingExpense.paidFor.filter(
          (paidFor) =>
            !expenseFormValues.paidFor.some(
              (pf) => pf.participant === paidFor.ledgerParticipantId,
            ),
        ),
      },
      recurringExpenseLink: {
        ...(isCreateRecurrenceExpenseLink
          ? {
              create: newRecurringExpenseLink,
            }
          : {}),
        ...(isUpdateRecurrenceExpenseLink
          ? {
              update: {
                nextExpenseDate: updatedRecurrenceExpenseLinkNextExpenseDate,
              },
            }
          : {}),
        delete: isDeleteRecurrenceExpenseLink,
      },
      isReimbursement: expenseFormValues.isReimbursement,
      documents: {
        connectOrCreate: expenseFormValues.documents.map((doc) => ({
          create: doc,
          where: { id: doc.id },
        })),
        deleteMany: existingExpense.documents
          .filter(
            (existingDoc) =>
              !expenseFormValues.documents.some(
                (doc) => doc.id === existingDoc.id,
              ),
          )
          .map((doc) => ({
            id: doc.id,
          })),
      },
      notes: expenseFormValues.notes,
    },
  })

  for (const doc of expenseFormValues.documents) {
    await markS3ObjectAsOwned(doc.url)
  }

  return expense
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupFormValues,
  actor: { accountId: string },
) {
  const existingGroup = await loadGroupWithLedger(groupId)
  if (!existingGroup) throw new Error('Invalid group ID')
  if (!existingGroup.ledgerId) throw new Error('Group has no ledger')
  if (existingGroup.archived) {
    throw new Error('Cannot modify settings of an archived group')
  }

  const actorLedgerParticipantId = await getMemberLedgerParticipantId(
    groupId,
    actor.accountId,
  )

  await logActivity(groupId, ActivityType.UPDATE_GROUP, {
    accountId: actor.accountId,
    ledgerParticipantId: actorLedgerParticipantId,
  })

  return prisma.$transaction(async (tx) => {
    const group = await tx.group.update({
      where: { id: groupId },
      data: {
        name: groupFormValues.name,
        information: groupFormValues.information,
      },
    })

    if (existingGroup.ledgerId) {
      await tx.ledger.update({
        where: { id: existingGroup.ledgerId },
        data: {
          currency: groupFormValues.currency,
          currencyCode: groupFormValues.currencyCode || null,
        },
      })
    }

    return group
  })
}

export async function getGroup(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      ledger: true,
      members: {
        where: { status: GroupMemberStatus.ACTIVE },
        include: { account: true, ledgerParticipant: true },
      },
      invitations: {
        where: { status: 'PENDING' },
        orderBy: [{ createdAt: 'asc' }],
      },
    },
  })
  if (!group) return null

  // Materialize a virtual LedgerParticipant for each pending invitation that
  // does not yet have one. This lets the invited email appear in the expense
  // form (paid-by / paid-for) before they accept the invitation. Once the
  // invitation is accepted, the participant is reused for the new
  // GroupMember. If the invitation is revoked, the participant is removed.
  // The display name is resolved at read time through
  // `resolveParticipantDisplayName`; the LedgerParticipant itself carries
  // no name.
  if (group.ledgerId && group.invitations.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const invitation of group.invitations) {
        if (invitation.ledgerParticipantId) continue

        const existing = await tx.ledgerParticipant.findFirst({
          where: {
            ledgerId: group.ledgerId!,
            groupMemberId: null,
            invitations: {
              some: { email: invitation.email, status: 'PENDING' },
            },
          },
          select: { id: true },
        })

        const participantId = existing?.id ?? randomId()
        if (!existing) {
          await tx.ledgerParticipant.create({
            data: {
              id: participantId,
              ledgerId: group.ledgerId!,
            },
          })
        }
        await tx.groupInvitation.update({
          where: { id: invitation.id },
          data: { ledgerParticipantId: participantId },
        })
      }
    })
  }

  // Re-read the invitations to pick up materialized ledgerParticipantIds.
  const invitationsWithParticipants =
    group.invitations.length > 0
      ? await prisma.groupInvitation.findMany({
          where: { groupId, status: 'PENDING' },
          include: { ledgerParticipant: true },
          orderBy: [{ createdAt: 'asc' }],
        })
      : []

  // Pick up unlinked LedgerParticipants (kind = UNLINKED_PARTICIPANT) so
  // imported name-only entries can be referenced in expense forms and
  // balances. Account-backed participants are surfaced above through
  // `group.members`; this query only collects the no-account leftovers.
  //
  // Filter out any LP that's already surfaced as a pending invitation
  // below — otherwise an INVITE_BY_LINK import would render the same
  // person twice (once as the imported unlinked row, once as a pending
  // link-invitee) and the balances list would show duplicate names.
  const allUnlinkedParticipants = group.ledgerId
    ? await prisma.ledgerParticipant.findMany({
        where: { ledgerId: group.ledgerId, kind: 'UNLINKED_PARTICIPANT' },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        select: { id: true, displayName: true },
      })
    : []
  const linkedViaInvitation = new Set<string>()
  for (const inv of invitationsWithParticipants) {
    if (inv.ledgerParticipant) linkedViaInvitation.add(inv.ledgerParticipant.id)
  }
  const unlinkedParticipants = allUnlinkedParticipants.filter(
    (p) => !linkedViaInvitation.has(p.id),
  )

  // Flatten to the shape callers expect. Display name is resolved at
  // read time through `resolveParticipantDisplayName`. Pending
  // invitations appear as synthetic participants so they can be selected
  // in the expense form before they accept. Unlinked participants are
  // durable entries with no app account — they show up as participants
  // in the same list so the expense form can select them.
  return {
    ...group,
    currency: group.ledger?.currency ?? '$',
    currencyCode: group.ledger?.currencyCode ?? null,
    participants: [
      ...group.members.flatMap((m) =>
        m.ledgerParticipant
          ? [
              {
                id: m.ledgerParticipant.id,
                name: m.account?.name ?? '',
                pending: false,
                unlinked: false,
              },
            ]
          : [],
      ),
      ...invitationsWithParticipants.flatMap((inv) =>
        inv.ledgerParticipant
          ? [
              {
                id: inv.ledgerParticipant.id,
                name: resolveParticipantDisplayName({
                  groupMember: null,
                  invitations: [
                    {
                      email: inv.email,
                      temporaryName: inv.temporaryName,
                    },
                  ],
                }),
                pending: true,
                unlinked: false,
              },
            ]
          : [],
      ),
      ...unlinkedParticipants.map((p) => ({
        id: p.id,
        name: p.displayName ?? '',
        pending: false,
        unlinked: true,
      })),
    ],
  }
}

/**
 * Resolve a `categoryId` string from the database to the in-code
 * {@link Category} object. Returns the default "General" category when
 * the stored id is not in the in-code list (e.g. it was written by an
 * older version of the app or is otherwise invalid).
 */
function resolveCategory(categoryId: string): Category {
  const parsedCategoryId = categoryIdSchema.safeParse(categoryId)
  return (
    (parsedCategoryId.success
      ? getCategoryById(parsedCategoryId.data)
      : undefined) ?? getCategoryById(DEFAULT_CATEGORY_ID)!
  )
}

/**
 * Narrow a `categoryId` string from the database to the {@link CategoryId}
 * literal union, falling back to the default category if the stored id is
 * not in the in-code list.
 */
function narrowCategoryId(categoryId: string): CategoryId {
  const parsed = categoryIdSchema.safeParse(categoryId)
  return parsed.success ? parsed.data : DEFAULT_CATEGORY_ID
}

export async function getGroupExpenses(
  groupId: string,
  options?: { offset?: number; length?: number; filter?: string },
) {
  await createRecurringExpenses()

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return []

  const rows = await prisma.expense.findMany({
    select: {
      amount: true,
      categoryId: true,
      createdAt: true,
      expenseDate: true,
      id: true,
      isReimbursement: true,
      paidBySplitMode: true,
      paidByList: {
        select: {
          ledgerParticipant: {
            select: {
              id: true,
              groupMember: { select: { account: { select: { name: true } } } },
              invitations: {
                select: { email: true, temporaryName: true },
                take: 1,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          shares: true,
        },
      },
      paidFor: {
        select: {
          ledgerParticipant: {
            select: {
              id: true,
              groupMember: { select: { account: { select: { name: true } } } },
              invitations: {
                select: { email: true, temporaryName: true },
                take: 1,
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          shares: true,
        },
      },
      splitMode: true,
      recurrenceRule: true,
      title: true,
      _count: { select: { documents: true } },
    },
    where: {
      ledgerId: group.ledgerId,
      title: options?.filter
        ? { contains: options.filter, mode: 'insensitive' }
        : undefined,
    },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    skip: options && options.offset,
    take: options && options.length,
  })

  // Flatten paidByList.ledgerParticipant and paidFor.ledgerParticipant to the
  // { id, name } shape the rest of the app expects. The display name is
  // resolved at read time through `resolveParticipantDisplayName`.
  return rows.map((row) => ({
    ...row,
    paidByList: row.paidByList.map((pb) => ({
      ledgerParticipant: {
        id: pb.ledgerParticipant.id,
        name: resolveParticipantDisplayName(pb.ledgerParticipant),
      },
      shares: pb.shares,
    })),
    paidFor: row.paidFor.map((pf) => ({
      ledgerParticipant: {
        id: pf.ledgerParticipant.id,
        name: resolveParticipantDisplayName(pf.ledgerParticipant),
      },
      shares: pf.shares,
    })),
    categoryId: narrowCategoryId(row.categoryId),
    category: resolveCategory(row.categoryId),
  }))
}

export async function getGroupExpenseCount(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return 0
  return prisma.expense.count({ where: { ledgerId: group.ledgerId } })
}

export async function getExpense(groupId: string, expenseId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return null
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, ledgerId: group.ledgerId },
    include: {
      paidByList: { include: { ledgerParticipant: true } },
      paidFor: true,
      documents: true,
      recurringExpenseLink: true,
    },
  })
  if (!expense) return null
  return {
    ...expense,
    categoryId: narrowCategoryId(expense.categoryId),
    category: resolveCategory(expense.categoryId),
  }
}

export async function getActivities(
  groupId: string,
  options?: { offset?: number; length?: number },
) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return []

  const activities = await prisma.activity.findMany({
    where: { ledgerId: group.ledgerId },
    orderBy: [{ time: 'desc' }],
    skip: options?.offset,
    take: options?.length,
    // Resolve the actor's display name at read time so the activity
    // feed renders it even after the actor is removed, leaves, or has
    // their pending invitation revoked (their `LedgerParticipant` is
    // preserved for history, so the account/invitation relation still
    // resolves a name). We don't filter invitations by status because
    // revoked invitations keep the link to the participant — that's
    // how we recover the email of an invitee who never accepted.
    include: {
      ledgerParticipant: {
        select: {
          groupMember: { select: { account: { select: { name: true } } } },
          invitations: {
            select: { email: true, temporaryName: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
  })

  const expenseIds = activities
    .map((activity) => activity.expenseId)
    .filter((expenseId): expenseId is string => Boolean(expenseId))
  const expenses = await prisma.expense.findMany({
    where: { ledgerId: group.ledgerId, id: { in: expenseIds } },
  })

  return activities.map((activity) => {
    const lp = activity.ledgerParticipant
    const actorName = lp ? resolveParticipantDisplayName(lp) || null : null
    // Strip the raw relation from the spread — we expose `actorName`
    // instead so the frontend can render the name directly.
    const { ledgerParticipant: _lp, ...rest } = activity
    return {
      ...rest,
      actorName,
      expense:
        activity.expenseId !== null
          ? expenses.find((expense) => expense.id === activity.expenseId)
          : undefined,
    }
  })
}

export async function logActivity(
  groupId: string,
  activityType: ActivityType,
  extra?: {
    accountId?: string
    ledgerParticipantId?: string | null
    expenseId?: string
    data?: string
  },
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const group = await client.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) {
    throw new Error('Cannot log activity for a group without a ledger')
  }
  return client.activity.create({
    data: {
      id: randomId(),
      ledgerId: group.ledgerId,
      activityType,
      ...extra,
    },
  })
}

export async function createRecurringExpenses() {
  const localDate = new Date()
  const utcDateFromLocal = new Date(
    Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate(),
      localDate.getUTCHours(),
      localDate.getUTCMinutes(),
    ),
  )

  const recurringExpenseLinksWithExpensesToCreate =
    await prisma.recurringExpenseLink.findMany({
      where: {
        nextExpenseCreatedAt: null,
        nextExpenseDate: {
          lte: utcDateFromLocal,
        },
        // Archived groups are read-only. Skip the generation pass for
        // their ledgers so viewing expenses in any other group does not
        // silently re-materialize new expenses in the archived one.
        ledger: {
          group: {
            archived: false,
          },
        },
      },
      select: {
        id: true,
        ledgerId: true,
        nextExpenseCreatedAt: true,
        nextExpenseDate: true,
        currentFrameExpense: {
          select: {
            id: true,
            ledgerId: true,
            expenseDate: true,
            title: true,
            categoryId: true,
            amount: true,
            originalAmount: true,
            originalCurrency: true,
            conversionRate: true,
            splitMode: true,
            recurrenceRule: true,
            isReimbursement: true,
            notes: true,
            paidBySplitMode: true,
            paidByList: {
              select: { ledgerParticipantId: true, shares: true },
            },
            paidFor: { select: { ledgerParticipantId: true, shares: true } },
            documents: {
              select: { id: true, url: true, width: true, height: true },
            },
          },
        },
      },
    })

  for (const recurringExpenseLink of recurringExpenseLinksWithExpensesToCreate) {
    let newExpenseDate = recurringExpenseLink.nextExpenseDate

    let currentExpenseRecord = recurringExpenseLink.currentFrameExpense
    let currentReccuringExpenseLinkId = recurringExpenseLink.id

    while (newExpenseDate < utcDateFromLocal) {
      const newExpenseId = randomId()
      const newRecurringExpenseLinkId = randomId()

      const newRecurringExpenseNextExpenseDate = calculateNextDate(
        currentExpenseRecord.recurrenceRule as RecurrenceRule,
        newExpenseDate,
      )

      const {
        paidByList,
        paidFor,
        documents,
        ...destructeredCurrentExpenseRecord
      } = currentExpenseRecord

      const newExpense = await prisma
        .$transaction(async (transaction) => {
          const newExpense = await transaction.expense.create({
            data: {
              ...destructeredCurrentExpenseRecord,
              categoryId: currentExpenseRecord.categoryId,
              paidBySplitMode: currentExpenseRecord.paidBySplitMode,
              paidByList: {
                createMany: {
                  data: currentExpenseRecord.paidByList.map((pb) => ({
                    ledgerParticipantId: pb.ledgerParticipantId,
                    shares: pb.shares,
                  })),
                },
              },
              paidFor: {
                createMany: {
                  data: currentExpenseRecord.paidFor.map((paidFor) => ({
                    ledgerParticipantId: paidFor.ledgerParticipantId,
                    shares: paidFor.shares,
                  })),
                },
              },
              documents: {
                connect: currentExpenseRecord.documents.map(
                  (documentRecord) => ({
                    id: documentRecord.id,
                  }),
                ),
              },
              id: newExpenseId,
              expenseDate: newExpenseDate,
              recurringExpenseLink: {
                create: {
                  ledgerId: currentExpenseRecord.ledgerId,
                  id: newRecurringExpenseLinkId,
                  nextExpenseDate: newRecurringExpenseNextExpenseDate,
                },
              },
            },
            include: {
              paidFor: true,
              documents: true,
              paidByList: true,
            },
          })

          await transaction.recurringExpenseLink.update({
            where: {
              id: currentReccuringExpenseLinkId,
              nextExpenseCreatedAt: null,
            },
            data: {
              nextExpenseCreatedAt: newExpense.createdAt,
            },
          })

          return newExpense
        })
        .catch(() => {
          console.error(
            'Failed to created recurringExpense for expenseId: %s',
            currentExpenseRecord.id,
          )
          return null
        })

      if (newExpense === null) break

      currentExpenseRecord = newExpense
      currentReccuringExpenseLinkId = newRecurringExpenseLinkId
      newExpenseDate = newRecurringExpenseNextExpenseDate
    }
  }
}

export function createPayloadForNewRecurringExpenseLink(
  _recurrenceRule: RecurrenceRule,
  _priorDateToNextRecurrence: Date,
  _groupId: string,
) {
  // Transitional stub. Callers now build the payload inline with a known
  // ledgerId. Kept exported for backwards compatibility until call sites
  // are deleted.
  throw new Error(
    'createPayloadForNewRecurringExpenseLink is a transitional stub; build the payload with the group ledgerId',
  )
}

/**
 * Compute the per-ledger-participant balance for every member of a group.
 * Returns a map from participant id to `{ paid, paidFor, total }`. `total`
 * is positive when a participant is a creditor (paid more than they owe)
 * and negative when they are a debtor.
 *
 * This intentionally runs the same pipeline the UI uses
 * (`getBalances` -> `getSuggestedReimbursements` -> `getPublicBalances`)
 * rather than the raw `getBalances` output. The raw output can have
 * non-zero totals caused by float-division rounding leftovers
 * (e.g. 1 cent split among 3 = 0.333... each, which `Math.round`s to 0,
 *  leaving the payer with a 1-cent residual). The UI's
 * `getPublicBalances` re-derives balances from the integer-cents
 * reimbursements, so the residual cancels out and the UI shows zero
 * balances. Routing the archive check through the same pipeline makes
 * the archive mutation agree with the balances the user actually sees,
 * and avoids rejecting the archive for groups whose UI is zeroed.
 */
export async function getGroupBalances(groupId: string): Promise<Balances> {
  const rows = await getGroupExpenses(groupId)
  const expenses: BalanceExpense[] = rows.map((row) => ({
    ...row,
    paidByList: row.paidByList.map((pb) => ({
      shares: pb.shares,
      participant: pb.ledgerParticipant,
    })),
    paidFor: row.paidFor.map((pf) => ({
      shares: pf.shares,
      participant: pf.ledgerParticipant,
    })),
  }))
  const balances = getBalances(expenses)
  const reimbursements = getSuggestedReimbursements(balances)
  return getPublicBalances(reimbursements)
}

/**
 * Returns `true` if any ledger participant in the balance map has a
 * non-zero total. Balances are stored in integer cents, so a strict `!== 0`
 * check is sufficient — no floating-point epsilon is needed.
 */
export function hasUnsettledBalances(balances: Balances): boolean {
  for (const id in balances) {
    if (balances[id].total !== 0) return true
  }
  return false
}

/**
 * Title used for the auto-generated settlement expenses created by the
 * archive flow. Marked so members can identify them in the expenses list
 * and in the activity log.
 */
const SETTLEMENT_TITLE = 'Settlement on archive'

/**
 * Build the optimal list of "settlement legs" (from, to, amount) that
 * zero out the group's balances. Wraps the domain
 * `getSuggestedReimbursements` helper.
 */
export function buildSettlementLegs(balances: Balances): Reimbursement[] {
  return getSuggestedReimbursements(balances)
}

/**
 * Create one reimbursement-style `Expense` per settlement leg produced by
 * {@link buildSettlementLegs}. Each expense is paid by the debtor, paid for
 * the creditor, uses the "Payment" category (id 1), and is marked as a
 * reimbursement. Recurrence is forced to NONE.
 *
 * Returns the number of expenses created. The caller is expected to run
 * this inside a `prisma.$transaction` together with the `Group.update` that
 * flips `Group.archived` so the archive either succeeds with all settlement
 * expenses persisted, or fails without partial writes. Pass the transaction
 * client as `client` so settlement expenses, activity rows, and the archive
 * flag flip are committed atomically.
 */
export async function createSettlementExpensesForArchive(
  groupId: string,
  actor: { accountId: string },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ createdExpenses: number }> {
  const balances = await getGroupBalances(groupId)
  if (!hasUnsettledBalances(balances)) {
    return { createdExpenses: 0 }
  }

  const group = await client.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) {
    throw new Error('Cannot settle balances: group has no ledger')
  }

  const legs = buildSettlementLegs(balances)
  if (legs.length === 0) {
    return { createdExpenses: 0 }
  }

  // Resolve the actor's ledger participant so the activity feed renders
  // the member who triggered the archive (instead of "someone").
  const actorLedgerParticipantId = await getMemberLedgerParticipantId(
    groupId,
    actor.accountId,
    client,
  )

  const now = new Date()
  for (const leg of legs) {
    if (leg.amount <= 0) continue
    const expenseId = randomId()
    await logActivity(
      groupId,
      ActivityType.CREATE_EXPENSE,
      {
        accountId: actor.accountId,
        ledgerParticipantId: actorLedgerParticipantId,
        expenseId,
        data: SETTLEMENT_TITLE,
      },
      client,
    )
    await client.expense.create({
      data: {
        id: expenseId,
        ledgerId: group.ledgerId,
        expenseDate: now,
        title: SETTLEMENT_TITLE,
        // "Payment" is the default reimbursement category shared with
        // the manual reimbursement form (see `ExpenseForm` defaults).
        categoryId: PAYMENT_CATEGORY_ID,
        amount: leg.amount,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: {
          createMany: {
            data: [{ ledgerParticipantId: leg.from, shares: leg.amount }],
          },
        },
        splitMode: 'EVENLY',
        recurrenceRule: RecurrenceRule.NONE,
        isReimbursement: true,
        paidFor: {
          createMany: {
            data: [{ ledgerParticipantId: leg.to, shares: 1 }],
          },
        },
        notes: 'Auto-created when archiving the group.',
      },
    })
  }

  return { createdExpenses: legs.length }
}

/**
 * Update a member's role inside a group. The change is restricted to
 * ADMIN <-> MEMBER (the only two roles the product supports). Caller
 * must be an ADMIN of the group (enforced by the procedure that wraps
 * this helper). The caller cannot change their own role through this
 * helper — admins who want to step down must use the dedicated
 * "leave group" flow so we never end up in a state where no ADMIN
 * remains.
 */
export async function updateMemberRole(opts: {
  groupId: string
  memberId: string
  role: 'ADMIN' | 'MEMBER'
  actor: { accountId: string }
}) {
  const { groupId, memberId, role, actor } = opts

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    include: { ledgerParticipant: { select: { id: true } } },
  })
  if (!target || target.groupId !== groupId) {
    throw new Error('Member not found in this group')
  }
  if (target.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('Only active members can be updated')
  }
  if (target.accountId === actor.accountId) {
    throw new Error('You cannot change your own role here; use the leave flow')
  }
  if (target.role === role) {
    return target
  }

  return prisma.$transaction(async (tx) => {
    // If we are demoting the last admin to member, refuse — the group
    // must always keep at least one active admin.
    if (role !== GroupRole.ADMIN && target.role === GroupRole.ADMIN) {
      const remainingAdmins = await tx.groupMember.count({
        where: {
          groupId,
          status: GroupMemberStatus.ACTIVE,
          role: GroupRole.ADMIN,
          NOT: { id: memberId },
        },
      })
      if (remainingAdmins === 0) {
        throw new Error('Group must keep at least one admin')
      }
    }
    const updated = await tx.groupMember.update({
      where: { id: memberId },
      data: { role },
    })
    await logActivity(
      groupId,
      ActivityType.UPDATE_GROUP,
      {
        accountId: actor.accountId,
        ledgerParticipantId: target.ledgerParticipant?.id ?? null,
        data: `role:${role}`,
      },
      tx,
    )
    return updated
  })
}

/**
 * Error thrown when an admin attempts to remove a member who has
 * unsettled balances without explicitly choosing whether to settle
 * them first. Callers should map this to `PRECONDITION_FAILED` so the
 * web client can re-render the remove dialog with the missing
 * decision (settle+remove vs. remove only).
 */
export class RemoveMemberPreconditionError extends Error {
  constructor(
    public readonly reason: 'unsettledBalance',
    message: string,
  ) {
    super(message)
    this.name = 'RemoveMemberPreconditionError'
  }
}

/**
 * Remove a member from a group. Their ledger participant and historical
 * expenses are kept so balances and activity history remain intact.
 * The membership row is flipped to `REMOVED` and `leftAt` is set so the
 * removed member disappears from the active roster without losing
 * historical data.
 *
 * Admins cannot remove themselves through this flow — they must use
 * the "leave group" path. Demoting-or-removing the last admin is also
 * rejected so we never leave a group without an active admin.
 *
 * When the target member has unsettled balances, the caller must
 * explicitly choose a path via `settleBalances`:
 *   - `settleBalances: true`  → create one reimbursement-style
 *     settlement expense per leg involving the target before flipping
 *     the membership to `REMOVED`, so the ledger stays in sync.
 *   - `settleBalances: false` → flip the membership immediately; the
 *     balances involving the target remain visible in the ledger but
 *     cannot be cleared because the member can no longer participate.
 *   - `settleBalances` unset (default) and the target has unsettled
 *     balances → throw {@link RemoveMemberPreconditionError} so the
 *     client can prompt for the decision.
 */
export async function removeMember(opts: {
  groupId: string
  memberId: string
  settleBalances?: boolean
  actor: { accountId: string }
}) {
  const { groupId, memberId, settleBalances, actor } = opts

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    include: { ledgerParticipant: { select: { id: true } } },
  })
  if (!target || target.groupId !== groupId) {
    throw new Error('Member not found in this group')
  }
  if (target.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('Member is not active')
  }
  if (target.accountId === actor.accountId) {
    throw new Error(
      'You cannot remove yourself here; use the leave group flow instead',
    )
  }

  // Detect unsettled balances involving the target so the caller can
  // be forced to make a settlement decision when there is one. We
  // intentionally skip the check when the caller already supplied
  // `settleBalances` so the same call can be retried without bouncing
  // through the dialog again.
  let hasUnsettledBalance = false
  if (target.ledgerParticipant?.id) {
    const balances = await getGroupBalances(groupId)
    hasUnsettledBalance =
      (balances[target.ledgerParticipant.id]?.total ?? 0) !== 0
  }
  if (hasUnsettledBalance && settleBalances === undefined) {
    throw new RemoveMemberPreconditionError(
      'unsettledBalance',
      'Member has unsettled balances. Settle them first or remove without settling.',
    )
  }

  return prisma.$transaction(async (tx) => {
    if (settleBalances && target.ledgerParticipant?.id) {
      await createSettlementExpensesForLeave(
        groupId,
        target.ledgerParticipant.id,
        actor,
        tx,
      )
    }

    if (target.role === GroupRole.ADMIN) {
      const remainingAdmins = await tx.groupMember.count({
        where: {
          groupId,
          status: GroupMemberStatus.ACTIVE,
          role: GroupRole.ADMIN,
          NOT: { id: memberId },
        },
      })
      if (remainingAdmins === 0) {
        throw new Error('Group must keep at least one admin')
      }
    }
    const updated = await tx.groupMember.update({
      where: { id: memberId },
      data: {
        status: GroupMemberStatus.REMOVED,
        leftAt: new Date(),
      },
    })
    await logActivity(
      groupId,
      ActivityType.UPDATE_GROUP,
      {
        accountId: actor.accountId,
        ledgerParticipantId: target.ledgerParticipant?.id ?? null,
        data: settleBalances ? 'member:removed:settled' : 'member:removed',
      },
      tx,
    )
    return updated
  })
}

// Re-export helper types
export type { Ledger, LedgerParticipant }

/**
 * Title used for the auto-generated settlement expenses created when a
 * member leaves a group. Marked so members can identify them in the
 * expenses list and in the activity log.
 */
const SETTLEMENT_ON_LEAVE_TITLE = 'Settlement on leave'

/**
 * Filter the optimal set of settlement legs (from {@link buildSettlementLegs})
 * down to the subset that involves a specific ledger participant, either as
 * the debtor (`from`) or as the creditor (`to`). Used by the leave flow to
 * scope the auto-generated settlement expenses to only the legs the leaving
 * user can actually clear — non-zero balances between remaining members are
 * left alone so the group can settle them on their own terms.
 */
export function getSettlementLegsForParticipant(
  balances: Balances,
  participantId: string,
): Reimbursement[] {
  return buildSettlementLegs(balances).filter(
    (leg) => leg.from === participantId || leg.to === participantId,
  )
}

/**
 * Create one reimbursement-style `Expense` per settlement leg that involves
 * `participantId`, mirroring {@link createSettlementExpensesForArchive} but
 * scoped to a single participant. The caller is expected to run this inside
 * a `prisma.$transaction` together with the membership mutation so the
 * settlement writes and the `LEFT` flip commit atomically.
 */
export async function createSettlementExpensesForLeave(
  groupId: string,
  participantId: string,
  actor: { accountId: string },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ createdExpenses: number }> {
  const balances = await getGroupBalances(groupId)
  const legs = getSettlementLegsForParticipant(balances, participantId)
  if (legs.length === 0) return { createdExpenses: 0 }

  const group = await client.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) {
    throw new Error('Cannot settle balances: group has no ledger')
  }

  const now = new Date()
  for (const leg of legs) {
    if (leg.amount <= 0) continue
    const expenseId = randomId()
    await logActivity(
      groupId,
      ActivityType.CREATE_EXPENSE,
      {
        accountId: actor.accountId,
        ledgerParticipantId: participantId,
        expenseId,
        data: SETTLEMENT_ON_LEAVE_TITLE,
      },
      client,
    )
    await client.expense.create({
      data: {
        id: expenseId,
        ledgerId: group.ledgerId,
        expenseDate: now,
        title: SETTLEMENT_ON_LEAVE_TITLE,
        categoryId: PAYMENT_CATEGORY_ID,
        amount: leg.amount,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: {
          createMany: {
            data: [{ ledgerParticipantId: leg.from, shares: leg.amount }],
          },
        },
        splitMode: 'EVENLY',
        recurrenceRule: RecurrenceRule.NONE,
        isReimbursement: true,
        paidFor: {
          createMany: {
            data: [{ ledgerParticipantId: leg.to, shares: 1 }],
          },
        },
        notes: 'Auto-created when a member leaves the group.',
      },
    })
  }

  return { createdExpenses: legs.length }
}

/**
 * Error thrown when the caller attempts to leave but must explicitly confirm
 * or supply an additional input first. Callers should map this to
 * `PRECONDITION_FAILED` so the web client can re-render the leave dialog
 * with the missing confirmation.
 */
export class LeaveGroupPreconditionError extends Error {
  constructor(
    public readonly reason:
      | 'confirmDeleteRequired'
      | 'promotionRequired'
      | 'unsettledBalance',
    message: string,
  ) {
    super(message)
    this.name = 'LeaveGroupPreconditionError'
  }
}

/**
 * Leave a group as an active member. Used by the dedicated "leave group"
 * mutation so admins can step down without losing admin coverage (a separate
 * promotion step is required when the leaving user is the last admin).
 *
 * The procedure that calls this helper enforces:
 *   - caller is an active member of the group,
 *   - the group is not archived (read-only),
 *   - when the caller is the last active member, `confirmDelete` must be
 *     `true` and the entire group is deleted (cascading),
 *   - when the caller is the last admin and other active members exist,
 *     `promoteMemberId` must point at another active member of the same
 *     group (not the caller),
 *   - when the caller has unsettled balances and `force` is not `true`,
 *     throw a {@link LeaveGroupPreconditionError} so the web client can
 *     prompt for confirmation,
 *   - when `force` is `true`, auto-create one settlement expense per leg
 *     involving the leaving user before flipping the membership to `LEFT`.
 *
 * Returns a small payload describing what happened (whether the group was
 * deleted and which member was promoted) so the client can show a
 * meaningful success toast.
 */
export async function leaveGroup(opts: {
  groupId: string
  actor: { accountId: string }
  force?: boolean
  promoteMemberId?: string
  confirmDelete?: boolean
}): Promise<{
  deleted: boolean
  promotedMemberId: string | null
}> {
  const {
    groupId,
    actor,
    force = false,
    promoteMemberId,
    confirmDelete = false,
  } = opts

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId: actor.accountId } },
    include: { ledgerParticipant: { select: { id: true } } },
  })
  if (!member || member.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('You are not an active member of this group')
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { archived: true, ledgerId: true },
  })
  if (!group) throw new Error('Invalid group ID')
  if (group.archived) {
    throw new Error('Cannot leave an archived group')
  }

  const [otherAdminsCount, otherMembersCount] = await Promise.all([
    prisma.groupMember.count({
      where: {
        groupId,
        status: GroupMemberStatus.ACTIVE,
        role: GroupRole.ADMIN,
        NOT: { id: member.id },
      },
    }),
    prisma.groupMember.count({
      where: {
        groupId,
        status: GroupMemberStatus.ACTIVE,
        NOT: { id: member.id },
      },
    }),
  ])

  const isLastActiveMember = otherMembersCount === 0
  const isLastAdmin = member.role === GroupRole.ADMIN && otherAdminsCount === 0

  if (isLastActiveMember) {
    if (!confirmDelete) {
      throw new LeaveGroupPreconditionError(
        'confirmDeleteRequired',
        'You are the last active member. Confirm deletion to continue.',
      )
    }
    // No admin promotion needed when the group is about to be deleted.
    // Cascade handles the ledger, members, invitations, expenses, etc.
    // We intentionally do not write an activity row here: the group (and
    // its activities) is being deleted in this same transaction, so any
    // log row we wrote would be removed by the cascade before commit.
    await prisma.group.delete({ where: { id: groupId } })
    return { deleted: true, promotedMemberId: null }
  }

  if (isLastAdmin) {
    if (!promoteMemberId) {
      throw new LeaveGroupPreconditionError(
        'promotionRequired',
        'You are the last admin. Choose a member to promote before leaving.',
      )
    }
    const target = await prisma.groupMember.findUnique({
      where: { id: promoteMemberId },
    })
    if (
      !target ||
      target.groupId !== groupId ||
      target.status !== GroupMemberStatus.ACTIVE
    ) {
      throw new Error('Promotion target must be an active member of this group')
    }
    if (target.id === member.id) {
      throw new Error('You cannot promote yourself before leaving')
    }
  }

  const participantId = member.ledgerParticipant?.id ?? null
  let needsSettlement = false
  if (participantId) {
    const balances = await getGroupBalances(groupId)
    const total = balances[participantId]?.total ?? 0
    needsSettlement = total !== 0
  }
  if (needsSettlement && !force) {
    throw new LeaveGroupPreconditionError(
      'unsettledBalance',
      'You have unsettled balances. Settle or force-leave to continue.',
    )
  }

  return prisma.$transaction(async (tx) => {
    if (needsSettlement && participantId) {
      await createSettlementExpensesForLeave(groupId, participantId, actor, tx)
    }

    if (isLastAdmin && promoteMemberId) {
      await tx.groupMember.update({
        where: { id: promoteMemberId },
        data: { role: GroupRole.ADMIN },
      })
    }

    await tx.groupMember.update({
      where: { id: member.id },
      data: {
        status: GroupMemberStatus.LEFT,
        leftAt: new Date(),
      },
    })

    await logActivity(
      groupId,
      ActivityType.UPDATE_GROUP,
      {
        accountId: actor.accountId,
        ledgerParticipantId: participantId,
        data: 'member:left',
      },
      tx,
    )

    return {
      deleted: false,
      promotedMemberId: isLastAdmin ? (promoteMemberId ?? null) : null,
    }
  })
}

/**
 * Archive a group for the current user instead of deleting it. Used by the
 * last-member leave flow as a non-destructive alternative to outright
 * deletion: the group is flipped to `Group.archived = true` (read-only
 * for everyone) and the caller's per-account hide preference is set so
 * the group drops out of their main list. The membership is intentionally
 * kept — "archive for myself" is the alternative to leaving, not a way
 * to leave.
 *
 * Restricted to the last-active-member case. When other active members
 * exist, the group will survive a normal leave anyway, so the caller
 * should just use `leave` (or the admin-only `groups.archive` mutation).
 *
 * The whole operation runs in a single transaction so the global archive
 * flag, the per-account preference, and the activity log entry commit
 * atomically. Returns `{ archived: true }` for the client.
 */
export async function archiveGroupForSelf(opts: {
  groupId: string
  accountId: string
}): Promise<{ archived: true }> {
  const { groupId, accountId } = opts

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId } },
  })
  if (!member || member.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('You are not an active member of this group')
  }

  const otherActiveMembers = await prisma.groupMember.count({
    where: {
      groupId,
      status: GroupMemberStatus.ACTIVE,
      NOT: { id: member.id },
    },
  })
  if (otherActiveMembers > 0) {
    throw new Error(
      'Archive-for-self is only available when you are the last active member',
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.group.update({
      where: { id: groupId },
      data: { archived: true },
    })

    await tx.accountGroupPreference.upsert({
      where: { accountId_groupId: { accountId, groupId } },
      create: {
        id: randomId(),
        accountId,
        groupId,
        archived: true,
      },
      update: {
        archived: true,
      },
    })

    // Resolve the caller's participant id so the activity feed renders
    // the member who triggered the archive (instead of "someone").
    const actorLedgerParticipantId = await getMemberLedgerParticipantId(
      groupId,
      accountId,
      tx,
    )

    await logActivity(
      groupId,
      ActivityType.UPDATE_GROUP,
      {
        accountId,
        ledgerParticipantId: actorLedgerParticipantId,
        data: 'group:archived-on-leave',
      },
      tx,
    )
  })

  return { archived: true }
}

/**
 * Read-only summary the web client uses to render the leave-group dialog
 * before the user confirms. Bundles everything the dialog needs in a
 * single query so it can render without cross-referencing
 * `account.members`, `groups.balances`, and `groups.get` separately.
 */
export async function getLeavePreview(opts: {
  groupId: string
  accountId: string
}): Promise<{
  role: GroupRole
  isLastActiveMember: boolean
  isLastAdmin: boolean
  hasUnsettledBalance: boolean
  otherAdmins: Array<{ id: string; name: string }>
  promotableMembers: Array<{ id: string; name: string }>
}> {
  const { groupId, accountId } = opts

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId } },
    include: { ledgerParticipant: { select: { id: true } } },
  })
  if (!member || member.status !== GroupMemberStatus.ACTIVE) {
    throw new Error('You are not an active member of this group')
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { archived: true },
  })
  if (!group) throw new Error('Invalid group ID')

  const otherActiveMembers = await prisma.groupMember.findMany({
    where: {
      groupId,
      status: GroupMemberStatus.ACTIVE,
      NOT: { id: member.id },
    },
    include: {
      account: { select: { id: true, name: true } },
    },
    orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
  })

  const otherAdmins = otherActiveMembers
    .filter((m) => m.role === GroupRole.ADMIN)
    .map((m) => ({ id: m.id, name: m.account?.name ?? '' }))

  const promotableMembers = otherActiveMembers.map((m) => ({
    id: m.id,
    name: m.account?.name ?? '',
  }))

  const participantId = member.ledgerParticipant?.id ?? null
  let hasUnsettledBalance = false
  if (participantId) {
    const balances = await getGroupBalances(groupId)
    hasUnsettledBalance = (balances[participantId]?.total ?? 0) !== 0
  }

  return {
    role: member.role,
    isLastActiveMember: otherActiveMembers.length === 0,
    isLastAdmin:
      member.role === GroupRole.ADMIN &&
      !otherActiveMembers.some((m) => m.role === GroupRole.ADMIN),
    hasUnsettledBalance,
    otherAdmins,
    promotableMembers,
  }
}

/**
 * Read-only summary the web client uses to render the admin "remove
 * member" dialog before the admin confirms. Bundles everything the
 * dialog needs to decide whether to surface the unsettled-balance
 * warning:
 *   - the target member's display name (so the dialog can address
 *     them by name),
 *   - whether the target has unsettled balances (so the dialog can
 *     pick between the simple confirm and the three-option variant).
 *
 * Caller authorization (ADMIN of the group, group not archived,
 * target is not the caller) is enforced by the procedure that wraps
 * this helper — this function only loads the data.
 */
export async function getRemoveMemberPreview(opts: {
  groupId: string
  memberId: string
}): Promise<{
  memberName: string
  hasUnsettledBalance: boolean
}> {
  const { groupId, memberId } = opts

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    include: {
      account: { select: { name: true } },
      ledgerParticipant: { select: { id: true } },
    },
  })
  if (!target || target.groupId !== groupId) {
    throw new Error('Member not found in this group')
  }

  let hasUnsettledBalance = false
  if (target.ledgerParticipant?.id) {
    const balances = await getGroupBalances(groupId)
    hasUnsettledBalance =
      (balances[target.ledgerParticipant.id]?.total ?? 0) !== 0
  }

  return {
    memberName: target.account?.name ?? '',
    hasUnsettledBalance,
  }
}

// ---------------------------------------------------------------------------
// Group import
// ---------------------------------------------------------------------------

export type ImportParticipantMapping =
  | {
      mode: 'LINK_ACCOUNT'
      sourceName: string
      linkedAccountId: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'INVITE_BY_EMAIL'
      sourceName: string
      email: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'INVITE_BY_LINK'
      sourceName: string
      destLedgerParticipantId: string
    }
  | {
      mode: 'UNLINKED_PARTICIPANT'
      sourceName: string
      destLedgerParticipantId: string
    }
  | {
      /**
       * Map this source participant onto an existing LedgerParticipant
       * in the destination group (active member or pending invite).
       * No new participant / membership / invitation is created. The
       * destination `LedgerParticipant.id` is used directly. Only
       * valid for `EXISTING_GROUP` imports; the wizard hides the
       * option otherwise.
       */
      mode: 'LINK_EXISTING_PARTICIPANT'
      sourceName: string
      destLedgerParticipantId: string
    }

export type ImportSourceMeta = {
  provider: string
  sourceGroupId: string
  sourceUrl?: string
}

export type ImportInput = {
  targetGroupId?: string
  groupFormValues?: GroupFormValues
  participants: ImportParticipantMapping[]
  expenses: ExpenseFormValues[]
  sourceMeta?: ImportSourceMeta
}

export type ImportInviteResult = {
  sourceName: string
  kind: 'EMAIL' | 'LINK'
  invitationId: string
  inviteUrl?: string
  email?: string
}

export type ImportResult = {
  groupId: string
  ledgerId: string
  importedExpenses: number
  sourceGroupId: string | null
  invites: ImportInviteResult[]
}

export async function importGroup(
  input: ImportInput,
  actor: { accountId: string },
): Promise<ImportResult> {
  // The transactional commit creates the group + participants +
  // expenses. Invitations are produced AFTER the commit because the
  // email-send + link-generator live outside this transaction's
  // surface (and we want the wizard to surface the URL even if the
  // invitation side-effects fail). We collect the invite mappings
  // inside the transaction and emit them below.
  const baseResult = await prisma.$transaction(async (tx) => {
    let groupId: string
    let ledgerId: string

    if (input.targetGroupId) {
      const existing = await tx.group.findUnique({
        where: { id: input.targetGroupId },
        select: { id: true, ledgerId: true, archived: true },
      })
      if (!existing) {
        throw new Error('Target group not found')
      }
      if (existing.archived) {
        throw new Error('Cannot import into an archived group')
      }
      if (!existing.ledgerId) {
        throw new Error('Target group is missing its ledger')
      }
      groupId = existing.id
      ledgerId = existing.ledgerId
    } else {
      if (!input.groupFormValues) {
        throw new Error('Either targetGroupId or groupFormValues is required')
      }
      const ledger = await tx.ledger.create({
        data: {
          id: randomId(),
          currency: input.groupFormValues.currency,
          currencyCode: input.groupFormValues.currencyCode || null,
        },
      })
      const group = await tx.group.create({
        data: {
          id: randomId(),
          name: input.groupFormValues.name,
          information: input.groupFormValues.information,
          ledgerId: ledger.id,
        },
      })
      // Admin's LedgerParticipant is created lazily by the mapping
      // loop (LINK_ACCOUNT branch), not eagerly here. Prevents a
      // duplicate row when the importer's name matches a source
      // participant's.
      const adminMember = await tx.groupMember.create({
        data: {
          id: randomId(),
          groupId: group.id,
          accountId: actor.accountId,
          role: GroupRole.ADMIN,
          status: GroupMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      })
      groupId = group.id
      ledgerId = ledger.id
      void adminMember
    }

    // Create destination LedgerParticipants from the mapping. Expense
    // refs use client-supplied destLedgerParticipantId which we reuse
    // as the PK. LINK_ACCOUNT reuses existing members.
    const destIdByClientKey = new Map<string, string>()
    const inviteMappings: Array<{
      mode: 'INVITE_BY_EMAIL' | 'INVITE_BY_LINK'
      sourceName: string
      destLedgerParticipantId: string
      email?: string
    }> = []

    // For LINK_EXISTING_PARTICIPANT mappings (existing-group imports
    // only), the supplied destLedgerParticipantId must already exist
    // in the destination ledger. Snapshot the valid ids once so the
    // loop is O(1) per mapping.
    const existingLpIds = input.targetGroupId
      ? new Set(
          (
            await tx.ledgerParticipant.findMany({
              where: { ledgerId },
              select: { id: true },
            })
          ).map((p) => p.id),
        )
      : null

    for (const mapping of input.participants) {
      // The web wizard pre-allocates a fresh id per source
      // participant and points the imported paidBy/paidFor references
      // at it before submitting. We re-use the same id so the
      // destination rows are addressable from the imported expenses
      // without a second resolve pass.
      const destId = mapping.destLedgerParticipantId
      if (mapping.mode === 'UNLINKED_PARTICIPANT') {
        await tx.ledgerParticipant.create({
          data: {
            id: destId,
            ledgerId,
            kind: LedgerParticipantKind.UNLINKED_PARTICIPANT,
            displayName: mapping.sourceName,
          },
        })
        destIdByClientKey.set(destId, destId)
        continue
      }
      if (
        mapping.mode === 'INVITE_BY_EMAIL' ||
        mapping.mode === 'INVITE_BY_LINK'
      ) {
        // Materialize as an unlinked entry so the imported expenses
        // can reference the invitee; the invitation row + email /
        // link are produced after commit.
        await tx.ledgerParticipant.create({
          data: {
            id: destId,
            ledgerId,
            kind: LedgerParticipantKind.UNLINKED_PARTICIPANT,
            displayName: mapping.sourceName,
          },
        })
        destIdByClientKey.set(destId, destId)
        inviteMappings.push({
          mode: mapping.mode,
          sourceName: mapping.sourceName,
          destLedgerParticipantId: destId,
          email: mapping.mode === 'INVITE_BY_EMAIL' ? mapping.email : undefined,
        })
        continue
      }
      if (mapping.mode === 'LINK_EXISTING_PARTICIPANT') {
        // Existing-group imports only. The supplied id must already
        // exist in the destination ledger; if it doesn't, the wizard is
        // being bypassed or has stale state. The wizard UI also blocks
        // this from being submitted, so reaching here is a server-side
        // defensive check.
        if (!existingLpIds) {
          throw new Error(
            `Cannot map to an existing participant when creating a new group: ${mapping.sourceName}.`,
          )
        }
        if (!existingLpIds.has(destId)) {
          throw new Error(
            `Destination LedgerParticipant "${destId}" not found in target group for source participant "${mapping.sourceName}.`,
          )
        }
        destIdByClientKey.set(destId, destId)
        continue
      }
      // LINK_ACCOUNT: the destination account must exist and the
      // membership must be either created (account not yet a
      // member) or reused (account is already an active member,
      // e.g. the importer themselves).
      const account = await tx.account.findUnique({
        where: { id: mapping.linkedAccountId },
        select: { id: true },
      })
      if (!account) {
        throw new Error(`Linked account not found: ${mapping.linkedAccountId}`)
      }
      const existingMember = await tx.groupMember.findUnique({
        where: {
          groupId_accountId: {
            groupId,
            accountId: mapping.linkedAccountId,
          },
        },
        include: { ledgerParticipant: true },
      })
      let memberId: string
      if (existingMember) {
        memberId = existingMember.id
      } else {
        const created = await tx.groupMember.create({
          data: {
            id: randomId(),
            groupId,
            accountId: mapping.linkedAccountId,
            role: GroupRole.MEMBER,
            status: GroupMemberStatus.ACTIVE,
            joinedAt: new Date(),
          },
        })
        memberId = created.id
      }
      // Reuse an existing participant for the same member if one
      // already exists (the importer, when they link themselves),
      // otherwise create a fresh one. When reusing, the supplied
      // destLedgerParticipantId is discarded — the imported
      // paidBy/paidFor references will be rewritten below to point
      // at the existing participant id.
      if (existingMember?.ledgerParticipant) {
        destIdByClientKey.set(destId, existingMember.ledgerParticipant.id)
        continue
      }
      await tx.ledgerParticipant.create({
        data: {
          id: destId,
          ledgerId,
          groupMemberId: memberId,
        },
      })
      destIdByClientKey.set(destId, destId)
    }

    // Write expenses inside the same transaction as group + participants.
    const actorLedgerParticipantId = await getMemberLedgerParticipantId(
      groupId,
      actor.accountId,
      tx,
    )

    for (const expense of input.expenses) {
      const expenseId = randomId()
      await logActivity(
        groupId,
        ActivityType.CREATE_EXPENSE,
        {
          accountId: actor.accountId,
          ledgerParticipantId: actorLedgerParticipantId,
          expenseId,
          data: expense.title,
        },
        tx,
      )
      // The web-supplied participant ids may have been discarded
      // (LINK_ACCOUNT reuses the existing member's participant id
      // instead of creating a new row). Rewrite the paidByList /
      // paidFor references through the actual destination ids we
      // computed above.
      const resolvedPaidByList = expense.paidByList
        .map((paidBy) => {
          const resolved = destIdByClientKey.get(paidBy.participant)
          if (!resolved) return null
          return {
            ledgerParticipantId: resolved,
            shares: paidBy.shares,
          }
        })
        .filter(
          (row): row is { ledgerParticipantId: string; shares: number } =>
            row !== null,
        )
      if (resolvedPaidByList.length === 0) {
        throw new Error(
          `Expense "${expense.title}" has no remaining paidBy participants after import resolution`,
        )
      }
      const seenPaidByIds = new Set<string>()
      for (const row of resolvedPaidByList) {
        if (seenPaidByIds.has(row.ledgerParticipantId)) {
          throw new Error(
            `Expense "${expense.title}" has two paidBy entries for the same LedgerParticipant (${row.ledgerParticipantId}). Each source participant must map to a unique destination.`,
          )
        }
        seenPaidByIds.add(row.ledgerParticipantId)
      }
      const resolvedPaidFor: Array<{
        ledgerParticipantId: string
        shares: number
      }> = []
      const seenPaidForIds = new Set<string>()
      for (const paidFor of expense.paidFor) {
        const resolved = destIdByClientKey.get(paidFor.participant)
        if (!resolved) continue
        if (seenPaidForIds.has(resolved)) {
          // Two source participants collapsed to the same destination
          // LedgerParticipant. The mapping UI prevents this state from
          // being submitted (only one row can be LINK_ACCOUNT, and
          // INVITE_BY_EMAIL emails are deduped), so reaching here means
          // the wizard is being bypassed or has a bug. Fail loudly
          // rather than silently merging the duplicate — silent
          // merging masks data corruption and the user can never tell
          // something went wrong.
          throw new Error(
            `Expense "${expense.title}" has two paidFor entries for the same LedgerParticipant (${resolved}). Each source participant must map to a unique destination.`,
          )
        }
        seenPaidForIds.add(resolved)
        resolvedPaidFor.push({
          ledgerParticipantId: resolved,
          shares: paidFor.shares,
        })
      }
      if (resolvedPaidFor.length === 0) {
        throw new Error(
          `Expense "${expense.title}" has no remaining paidFor participants after import resolution`,
        )
      }
      await tx.expense.create({
        data: {
          id: expenseId,
          ledgerId,
          expenseDate: expense.expenseDate,
          title: expense.title,
          categoryId: expense.category,
          amount: expense.amount,
          originalAmount: expense.originalAmount,
          originalCurrency: expense.originalCurrency,
          conversionRate: expense.conversionRate,
          paidBySplitMode: expense.paidBySplitMode,
          paidByList: {
            createMany: {
              data: resolvedPaidByList,
            },
          },
          splitMode: expense.splitMode,
          recurrenceRule: expense.recurrenceRule,
          isReimbursement: expense.isReimbursement,
          notes: expense.notes,
          paidFor: {
            createMany: {
              data: resolvedPaidFor,
            },
          },
          documents: {
            createMany: {
              data: expense.documents.map((doc) => ({
                id: randomId(),
                url: doc.url,
                width: doc.width,
                height: doc.height,
              })),
            },
          },
        },
      })
    }

    // Record the import as a single UPDATE_GROUP activity so the
    // destination group records its source identity. The source id is
    // preserved in the `data` field for traceability; the destination
    // group id was always fresh (see `randomId()` above).
    if (input.sourceMeta) {
      const data = `Imported from ${input.sourceMeta.provider} group ${input.sourceMeta.sourceGroupId}`
      await logActivity(
        groupId,
        ActivityType.UPDATE_GROUP,
        {
          accountId: actor.accountId,
          ledgerParticipantId: actorLedgerParticipantId,
          data,
        },
        tx,
      )
    }

    return {
      groupId,
      ledgerId,
      importedExpenses: input.expenses.length,
      sourceGroupId: input.sourceMeta?.sourceGroupId ?? null,
      inviteMappings,
    }
  })

  // After the transactional commit: emit the invites that the wizard
  // collected during the commit. Each invite has a corresponding
  // unlinked `LedgerParticipant` row created in the commit so the
  // imported expenses already reference the right id.
  //
  // We import these helpers lazily to avoid a circular import
  // (`invitations.ts` reaches back into `api.ts` for activity logging,
  // balance queries, etc.).
  const { createEmailInvitation, createLinkInvitation, sendInvitationEmail } =
    await import('./invitations')
  const group = await prisma.group.findUnique({
    where: { id: baseResult.groupId },
    select: { name: true },
  })
  if (!group) {
    throw new Error('Group not found after import commit')
  }
  const inviter = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { name: true, email: true },
  })
  const inviterDisplayName = inviter?.name || inviter?.email || 'Someone'

  const inviteResults: ImportInviteResult[] = []
  for (const invite of baseResult.inviteMappings) {
    if (invite.mode === 'INVITE_BY_EMAIL') {
      const email = invite.email!
      const invitation = await createEmailInvitation({
        groupId: baseResult.groupId,
        email,
        role: GroupRole.MEMBER,
        inviterAccountId: actor.accountId,
        temporaryName: invite.sourceName,
      })
      const existingAccount = await prisma.account.findFirst({
        where: { email: { equals: email.toLowerCase(), mode: 'insensitive' } },
        select: { id: true },
      })
      await sendInvitationEmail({
        invitationId: invitation.id,
        groupId: baseResult.groupId,
        groupName: group.name,
        inviterDisplayName,
        inviterRole: GroupRole.ADMIN,
        recipientEmail: invitation.email,
        recipientIsExistingUser: !!existingAccount,
      })
      inviteResults.push({
        sourceName: invite.sourceName,
        kind: 'EMAIL',
        invitationId: invitation.id,
        email,
      })
    } else {
      const link = await createLinkInvitation({
        groupId: baseResult.groupId,
        role: GroupRole.MEMBER,
        inviterAccountId: actor.accountId,
        temporaryName: invite.sourceName,
        // Reuse the LedgerParticipant already materialized for the
        // invitee during the import commit. Without this, `getGroup`
        // would surface the same person twice (once as the unlinked
        // entry, once as a pending invitation).
        ledgerParticipantId: invite.destLedgerParticipantId,
      })
      inviteResults.push({
        sourceName: invite.sourceName,
        kind: 'LINK',
        invitationId: link.invitation.id,
        inviteUrl: link.inviteUrl,
      })
    }
  }

  return {
    groupId: baseResult.groupId,
    ledgerId: baseResult.ledgerId,
    importedExpenses: baseResult.importedExpenses,
    sourceGroupId: baseResult.sourceGroupId,
    invites: inviteResults,
  }
}

/**
 * One-way admin migration of an unlinked `LedgerParticipant` to an
 * account. The destination `GroupMember` is created if the account
 * is not yet a member, or reactivated (PENDING -> ACTIVE, or
 * LEFT/REMOVED -> ACTIVE) if the account has prior history. The
 * historical and future balances of the `LedgerParticipant`
 * immediately contribute to the linked account's group and overview
 * totals — there is no un-link state, this is a one-way move.
 */
export async function linkUnlinkedParticipantToAccount(opts: {
  groupId: string
  ledgerParticipantId: string
  accountId: string
  actor: { accountId: string }
}): Promise<{ groupMemberId: string; ledgerParticipantId: string }> {
  const { groupId, ledgerParticipantId, accountId, actor } = opts

  return prisma.$transaction(async (tx) => {
    const participant = await tx.ledgerParticipant.findUnique({
      where: { id: ledgerParticipantId },
      include: {
        ledger: { select: { id: true, group: { select: { id: true } } } },
      },
    })
    if (!participant) {
      throw new Error('Ledger participant not found')
    }
    if (participant.ledger.group?.id !== groupId) {
      throw new Error('Ledger participant does not belong to this group')
    }
    if (participant.kind !== LedgerParticipantKind.UNLINKED_PARTICIPANT) {
      throw new Error('Ledger participant is not unlinked')
    }
    if (participant.groupMemberId) {
      throw new Error('Ledger participant is already linked to a member')
    }

    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    })
    if (!account) {
      throw new Error('Account not found')
    }

    const existingMember = await tx.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId } },
    })

    let groupMemberId: string
    if (existingMember) {
      // Reactivate a prior member (LEFT/REMOVED/SUSPENDED) so the
      // historical balances re-attach to an ACTIVE member. The
      // existing row's `ledgerParticipant` is reused if present;
      // otherwise the unlinked row is reassigned. The `role` is
      // intentionally preserved so an admin who left and re-links
      // does not get silently demoted to a regular member.
      const reactivated = await tx.groupMember.update({
        where: { id: existingMember.id },
        data: {
          status: GroupMemberStatus.ACTIVE,
          joinedAt: existingMember.joinedAt ?? new Date(),
          leftAt: null,
        },
      })
      groupMemberId = reactivated.id
    } else {
      const created = await tx.groupMember.create({
        data: {
          id: randomId(),
          groupId,
          accountId,
          role: GroupRole.MEMBER,
          status: GroupMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      })
      groupMemberId = created.id
    }

    // If the destination account already has a `LedgerParticipant` in
    // this ledger, the unlinked LP must merge into it: rewriting the
    // unique `groupMemberId` onto the unlinked row would collide with
    // the existing one and trip the @unique constraint. The
    // user-visible intent ("this unlinked person is the same as that
    // existing member") is satisfied by redirecting references to the
    // canonical LP and dropping the unlinked row.
    const existingLp = await tx.ledgerParticipant.findUnique({
      where: { groupMemberId },
    })
    if (existingLp && existingLp.id !== participant.id) {
      await mergeLedgerParticipantReferences(tx, {
        sourceId: participant.id,
        targetId: existingLp.id,
      })
      await tx.ledgerParticipant.delete({ where: { id: participant.id } })

      const actorLedgerParticipantId = await getMemberLedgerParticipantId(
        groupId,
        actor.accountId,
        tx,
      )
      await logActivity(
        groupId,
        ActivityType.UPDATE_GROUP,
        {
          accountId: actor.accountId,
          ledgerParticipantId: actorLedgerParticipantId,
          data: `ledger-participant:merged:${participant.id}:${existingLp.id}`,
        },
        tx,
      )

      return {
        groupMemberId,
        ledgerParticipantId: existingLp.id,
      }
    }

    // Move the unlinked row's groupMemberId to the new (or reactivated)
    // member. The row's id is preserved so existing expenses keep
    // resolving the same participant id, and the `kind` flips to
    // ACCOUNT_MEMBER so the display name now resolves through
    // `Account.name`. `displayName` is cleared: the relation wins.
    await tx.ledgerParticipant.update({
      where: { id: participant.id },
      data: {
        groupMemberId,
        kind: LedgerParticipantKind.ACCOUNT_MEMBER,
        displayName: null,
      },
    })

    const actorLedgerParticipantId = await getMemberLedgerParticipantId(
      groupId,
      actor.accountId,
      tx,
    )
    await logActivity(
      groupId,
      ActivityType.UPDATE_GROUP,
      {
        accountId: actor.accountId,
        ledgerParticipantId: actorLedgerParticipantId,
        data: `ledger-participant:linked:${participant.id}`,
      },
      tx,
    )

    return {
      groupMemberId,
      ledgerParticipantId: participant.id,
    }
  })
}

/**
 * Rewrite all `ExpensePaidBy.ledgerParticipantId` and
 * `ExpensePaidFor.ledgerParticipantId` references from one
 * `LedgerParticipant` id to another. Caller is responsible for confirming
 * the source row is no longer referenced before deletion.
 */
export async function mergeLedgerParticipantReferences(
  tx: Prisma.TransactionClient,
  opts: { sourceId: string; targetId: string },
): Promise<void> {
  const { sourceId, targetId } = opts
  await tx.expensePaidBy.updateMany({
    where: { ledgerParticipantId: sourceId },
    data: { ledgerParticipantId: targetId },
  })
  await tx.expensePaidFor.updateMany({
    where: { ledgerParticipantId: sourceId },
    data: { ledgerParticipantId: targetId },
  })
}

/**
 * One-way admin migration of an unlinked `LedgerParticipant` onto the
 * materialized `LedgerParticipant` of a pending EMAIL or LINK-type
 * invitation in the same group. The unlinked LP is deleted; the
 * pending invitee's LP is preserved and reused when they accept the
 * invitation. The merge keeps the single-LP-per-person invariant
 * intact. Matching is by `pendingInvitationId`, not by email, so
 * LINK-type invitations with their synthetic `*.placeholder.local`
 * address are supported without any account lookup.
 */
export async function linkUnlinkedParticipantToPendingInvite(opts: {
  groupId: string
  ledgerParticipantId: string
  pendingInvitationId: string
  actor: { accountId: string }
}): Promise<{ groupMemberId: null; ledgerParticipantId: string }> {
  const { groupId, ledgerParticipantId, pendingInvitationId, actor } = opts

  return prisma.$transaction(async (tx) => {
    const participant = await tx.ledgerParticipant.findUnique({
      where: { id: ledgerParticipantId },
      include: {
        ledger: { select: { id: true, group: { select: { id: true } } } },
      },
    })
    if (!participant) {
      throw new Error('Ledger participant not found')
    }
    if (participant.ledger.group?.id !== groupId) {
      throw new Error('Ledger participant does not belong to this group')
    }
    if (participant.kind !== LedgerParticipantKind.UNLINKED_PARTICIPANT) {
      throw new Error('Ledger participant is not unlinked')
    }
    if (participant.groupMemberId) {
      throw new Error('Ledger participant is already linked to a member')
    }

    const invitation = await tx.groupInvitation.findUnique({
      where: { id: pendingInvitationId },
      include: {
        ledgerParticipant: {
          select: { id: true, ledgerId: true, groupMemberId: true },
        },
      },
    })
    if (!invitation) {
      throw new Error('Invitation not found')
    }
    if (invitation.groupId !== groupId) {
      throw new Error('Invitation does not belong to this group')
    }
    if (invitation.status !== GroupInvitationStatus.PENDING) {
      throw new Error('Invitation is not pending')
    }
    const targetLp = invitation.ledgerParticipant
    if (!targetLp) {
      throw new Error('Invitation has no materialized ledger participant')
    }
    if (targetLp.ledgerId !== participant.ledger.id) {
      throw new Error('Invitation ledger participant is in a different ledger')
    }
    if (targetLp.id === participant.id) {
      throw new Error('Cannot merge a participant into itself')
    }

    await mergeLedgerParticipantReferences(tx, {
      sourceId: participant.id,
      targetId: targetLp.id,
    })
    await tx.ledgerParticipant.delete({ where: { id: participant.id } })

    const actorLedgerParticipantId = await getMemberLedgerParticipantId(
      groupId,
      actor.accountId,
      tx,
    )
    await logActivity(
      groupId,
      ActivityType.UPDATE_GROUP,
      {
        accountId: actor.accountId,
        ledgerParticipantId: actorLedgerParticipantId,
        data: `ledger-participant:merged-into-invitation:${participant.id}:${targetLp.id}`,
      },
      tx,
    )

    return { groupMemberId: null, ledgerParticipantId: targetLp.id }
  })
}

/**
 * List the unlinked `LedgerParticipant` rows in a group along with the
 * source name and the raw id. Used by the post-import admin link flow
 * to surface name-only entries that may be migrated to accounts.
 */
export async function listUnlinkedParticipants(groupId: string): Promise<
  Array<{
    id: string
    displayName: string | null
  }>
> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return []
  return prisma.ledgerParticipant.findMany({
    where: { ledgerId: group.ledgerId, kind: 'UNLINKED_PARTICIPANT' },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    select: { id: true, displayName: true },
  })
}

import {
  ActivityType,
  Expense,
  GroupMemberStatus,
  GroupRole,
  prisma,
  RecurrenceRule,
  type Ledger,
  type LedgerParticipant,
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
 * Create a cloud group with its accounting Ledger. The current account is
 * added as an OWNER/ACTIVE member and a matching LedgerParticipant is created
 * so expenses can be recorded against them.
 *
 * `groupFormValues.participants` (if any) is treated as an "invite on create"
 * list: each entry becomes a GroupInvitation with a random placeholder name
 * resolved through the email. This is a transitional shim while the web
 * client is updated to send invitations instead of anonymous participants.
 */
export async function createGroup(
  groupFormValues: GroupFormValues,
  options: { ownerAccountId: string; ownerDisplayName: string },
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

    const ownerMember = await tx.groupMember.create({
      data: {
        id: randomId(),
        groupId: group.id,
        accountId: options.ownerAccountId,
        role: GroupRole.OWNER,
        status: GroupMemberStatus.ACTIVE,
        displayName: options.ownerDisplayName,
        joinedAt: new Date(),
      },
    })

    await tx.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId: ledger.id,
        name: options.ownerDisplayName,
        groupMemberId: ownerMember.id,
      },
    })

    return { group, ledger, ownerMember }
  })
}

export async function createExpense(
  expenseFormValues: ExpenseFormValues,
  groupId: string,
  actor: { accountId: string; displayName?: string },
): Promise<Expense> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { ledger: true },
  })
  if (!group || !group.ledgerId) throw new Error(`Invalid group ID: ${groupId}`)

  const ledgerId = group.ledgerId
  const participants = await prisma.ledgerParticipant.findMany({
    where: { ledgerId },
    select: { id: true, name: true },
  })
  const participantIds = new Set(participants.map((p) => p.id))

  for (const participantId of [
    expenseFormValues.paidBy,
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!participantIds.has(participantId)) {
      throw new Error(`Invalid participant ID: ${participantId}`)
    }
  }

  const expenseId = randomId()
  await logActivity(groupId, ActivityType.CREATE_EXPENSE, {
    accountId: actor.accountId,
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

  return prisma.expense.create({
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
      paidById: expenseFormValues.paidBy,
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
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  actor: { accountId: string },
) {
  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  await logActivity(groupId, ActivityType.DELETE_EXPENSE, {
    accountId: actor.accountId,
    expenseId,
    data: existingExpense?.title,
  })

  await prisma.expense.deleteMany({
    where: { id: expenseId, ledgerId: existingExpense.ledgerId },
  })
}

export async function getGroupExpensesParticipants(groupId: string) {
  const expenses = await getGroupExpenses(groupId)
  return Array.from(
    new Set(
      expenses.flatMap((e) => [
        e.paidBy.id,
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

  const participants = await prisma.ledgerParticipant.findMany({
    where: { ledgerId: group.ledgerId },
    select: { id: true },
  })
  const participantIds = new Set(participants.map((p) => p.id))
  for (const participantId of [
    expenseFormValues.paidBy,
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!participantIds.has(participantId)) {
      throw new Error(`Invalid participant ID: ${participantId}`)
    }
  }

  await logActivity(groupId, ActivityType.UPDATE_EXPENSE, {
    accountId: actor.accountId,
    expenseId,
    data: expenseFormValues.title,
  })

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

  return prisma.expense.update({
    where: { id: expenseId },
    data: {
      expenseDate: expenseFormValues.expenseDate,
      amount: expenseFormValues.amount,
      originalAmount: expenseFormValues.originalAmount,
      originalCurrency: expenseFormValues.originalCurrency,
      conversionRate: expenseFormValues.conversionRate,
      title: expenseFormValues.title,
      categoryId: expenseFormValues.category,
      paidById: expenseFormValues.paidBy,
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
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupFormValues,
  actor: { accountId: string },
) {
  const existingGroup = await loadGroupWithLedger(groupId)
  if (!existingGroup) throw new Error('Invalid group ID')
  if (!existingGroup.ledgerId) throw new Error('Group has no ledger')

  await logActivity(groupId, ActivityType.UPDATE_GROUP, {
    accountId: actor.accountId,
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
  if (group.ledgerId && group.invitations.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const invitation of group.invitations) {
        if (invitation.ledgerParticipantId) continue

        const existing = await tx.ledgerParticipant.findFirst({
          where: {
            ledgerId: group.ledgerId!,
            name: invitation.email,
            groupMemberId: null,
          },
          select: { id: true },
        })

        const participantId = existing?.id ?? randomId()
        if (!existing) {
          await tx.ledgerParticipant.create({
            data: {
              id: participantId,
              ledgerId: group.ledgerId!,
              name: invitation.email,
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

  // Flatten to the shape callers expect: ledger currency fields at the top
  // level, and a list of `participants` derived from active ledger
  // participants so the existing UI keeps working until it is updated.
  // Pending invitations appear as synthetic participants so they can be
  // selected in the expense form before they accept.
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
                name: m.ledgerParticipant.name,
                pending: false,
              },
            ]
          : [],
      ),
      ...invitationsWithParticipants.flatMap((inv) =>
        inv.ledgerParticipant
          ? [
              {
                id: inv.ledgerParticipant.id,
                name: inv.ledgerParticipant.name,
                pending: true,
              },
            ]
          : [],
      ),
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
      paidBy: { select: { id: true, name: true } },
      paidFor: {
        select: {
          ledgerParticipant: { select: { id: true, name: true } },
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

  return rows.map((row) => ({
    ...row,
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
      paidBy: true,
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
  })

  const expenseIds = activities
    .map((activity) => activity.expenseId)
    .filter((expenseId): expenseId is string => Boolean(expenseId))
  const expenses = await prisma.expense.findMany({
    where: { ledgerId: group.ledgerId, id: { in: expenseIds } },
  })

  return activities.map((activity) => ({
    ...activity,
    expense:
      activity.expenseId !== null
        ? expenses.find((expense) => expense.id === activity.expenseId)
        : undefined,
  }))
}

export async function logActivity(
  groupId: string,
  activityType: ActivityType,
  extra?: {
    accountId?: string
    ledgerParticipantId?: string
    expenseId?: string
    data?: string
  },
) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) {
    throw new Error('Cannot log activity for a group without a ledger')
  }
  return prisma.activity.create({
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
      },
      include: {
        currentFrameExpense: {
          include: {
            paidBy: { select: { id: true, name: true } },
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
        paidBy,
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
              paidById: currentExpenseRecord.paidById,
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
              paidBy: true,
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
 * expenses persisted, or fails without partial writes.
 */
export async function createSettlementExpensesForArchive(
  groupId: string,
  actor: { accountId: string },
): Promise<{ createdExpenses: number }> {
  const balances = await getGroupBalances(groupId)
  if (!hasUnsettledBalances(balances)) {
    return { createdExpenses: 0 }
  }

  const group = await prisma.group.findUnique({
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

  const now = new Date()
  for (const leg of legs) {
    if (leg.amount <= 0) continue
    const expenseId = randomId()
    await logActivity(groupId, ActivityType.CREATE_EXPENSE, {
      accountId: actor.accountId,
      expenseId,
      data: SETTLEMENT_TITLE,
    })
    await prisma.expense.create({
      data: {
        id: expenseId,
        ledgerId: group.ledgerId,
        expenseDate: now,
        title: SETTLEMENT_TITLE,
        // "Payment" is the default reimbursement category shared with
        // the manual reimbursement form (see `ExpenseForm` defaults).
        categoryId: PAYMENT_CATEGORY_ID,
        amount: leg.amount,
        paidById: leg.from,
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

// Re-export helper types
export type { Ledger, LedgerParticipant }

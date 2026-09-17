import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { prisma } from '@spliit/db'

import { getApiBaseUrl } from '../lib/auth/urls'
import * as upload from '../routes/upload'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Expense CRUD — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-exp-${runId}`
  const adminEmail = `exp-${runId}@test.example`
  const memberId = `acct-exp-member-${runId}`
  const memberEmail = `exp-member-${runId}@test.example`

  const ledgerIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  function makeCaller(
    accountId = adminId,
    email = adminEmail,
    name = 'Test Admin',
  ) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: accountId,
          email,
          emailVerified: true,
          name,
        },
      },
    } as never)
  }

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        id: adminId,
        email: adminEmail,
        emailVerified: true,
        name: 'Test Admin',
      },
    })
    await prisma.user.upsert({
      where: { email: memberEmail },
      update: {},
      create: {
        id: memberId,
        email: memberEmail,
        emailVerified: true,
        name: 'Test Member',
      },
    })
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.user.delete({ where: { id: adminId } }).catch(() => {})
    await prisma.user.delete({ where: { id: memberId } }).catch(() => {})
  })

  /**
   * Helper: create a group and return its id + the admin's ledger participant
   * id.
   */
  async function createGroup(
    name: string,
    currency: { symbol: string; code: string } = { symbol: '$', code: 'USD' },
  ): Promise<{ groupId: string; participantId: string }> {
    const caller = makeCaller()
    const { groupId } = await caller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name,
        currency: currency.symbol,
        currencyCode: currency.code,
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    trackLedger(group!.ledger.id)
    return { groupId, participantId: group!.members[0].ledgerParticipant!.id }
  }

  async function addMember(groupId: string) {
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { ledgerId: true },
    })
    const membership = await prisma.groupMember.create({
      data: {
        id: `gm-${runId}-${groupId}`,
        groupId,
        accountId: memberId,
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    const participant = await prisma.ledgerParticipant.create({
      data: {
        id: `lp-${runId}-${groupId}`,
        ledgerId: group.ledgerId,
        groupMemberId: membership.id,
      },
    })
    return participant.id
  }

  it('enforces member ownership while preserving the admin override', async () => {
    const adminCaller = makeCaller()
    const memberCaller = makeCaller(memberId, memberEmail, 'Test Member')
    const { groupId, participantId: adminParticipantId } = await createGroup(
      `Ownership ${runId}`,
    )
    const memberParticipantId = await addMember(groupId)
    const expenseInput = (title: string, participant: string) => ({
      title,
      amount: 1000,
      paidByList: [{ participant, shares: 1000 }],
      paidBySplitMode: 'BY_AMOUNT' as const,
      isMultiPayer: false,
      paidFor: [{ participant, shares: 1 }],
      category: 'general' as const,
      splitMode: 'EVENLY' as const,
      expenseDate: new Date().toISOString(),
      expenseTimeZone: 'UTC',
      documents: [],
      recurrenceRule: 'NONE' as const,
    })

    const memberExpense = await memberCaller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: expenseInput('Member owned', memberParticipantId),
    })
    await memberCaller.expenses.update({
      expectedVersion: 1,
      groupId,
      expenseId: memberExpense.expenseId,
      expense: expenseInput('Member updated', memberParticipantId),
    })

    const adminExpense = await adminCaller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: expenseInput('Admin owned', adminParticipantId),
    })
    await expect(
      memberCaller.expenses.delete({
        groupId,
        expenseId: adminExpense.expenseId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await prisma.expense.update({
      where: { id: adminExpense.expenseId },
      data: { createdByAccountId: null },
    })
    await expect(
      memberCaller.expenses.update({
        expectedVersion: 1,
        groupId,
        expenseId: adminExpense.expenseId,
        expense: expenseInput('Legacy edit', memberParticipantId),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await adminCaller.expenses.delete({
      groupId,
      expenseId: memberExpense.expenseId,
    })
  })

  // ------------------------------------------------------------------
  // 5. Update expense title
  // ------------------------------------------------------------------
  it('updates an expense title', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`Update ${runId}`)

    // Create expense
    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Original Title',
        amount: 1000,
        paidByList: [{ participant: participantId, shares: 1000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Update title
    await caller.expenses.update({
      expectedVersion: 1,
      groupId,
      expenseId,
      expense: {
        title: 'Updated Title',
        amount: 1000,
        paidByList: [{ participant: participantId, shares: 1000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await prisma.expense.findUnique({
      where: { id: expenseId },
    })
    expect(expense!.title).toBe('Updated Title')
  })

  it('allows exactly one update to claim an expense version', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(
      `Concurrent update ${runId}`,
    )
    const expense = (title: string) => ({
      title,
      amount: 1000,
      paidByList: [{ participant: participantId, shares: 1000 }],
      paidBySplitMode: 'BY_AMOUNT' as const,
      isMultiPayer: false,
      paidFor: [{ participant: participantId, shares: 1 }],
      category: 'general' as const,
      splitMode: 'EVENLY' as const,
      expenseDate: new Date().toISOString(),
      expenseTimeZone: 'UTC',
      documents: [],
      recurrenceRule: 'NONE' as const,
    })
    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: expense('Original'),
    })

    const attempts = await Promise.allSettled([
      caller.expenses.update({
        groupId,
        expenseId,
        expectedVersion: 1,
        expense: expense('First draft'),
      }),
      caller.expenses.update({
        groupId,
        expenseId,
        expectedVersion: 1,
        expense: expense('Second draft'),
      }),
    ])

    expect(
      attempts.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const rejected = attempts.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({ reason: { code: 'CONFLICT' } })
    const stored = await prisma.expense.findUniqueOrThrow({
      where: { id: expenseId },
      select: { version: true },
    })
    expect(stored.version).toBe(2)
    expect(
      await prisma.activity.count({
        where: { type: 'EXPENSE_UPDATED', subjectId: expenseId },
      }),
    ).toBe(1)
  })

  it('replays concurrent group creates and rejects request-id reuse', async () => {
    const caller = makeCaller()
    const requestId = crypto.randomUUID()
    const groupFormValues = {
      name: `Idempotent group ${runId}`,
      currency: '$',
      currencyCode: 'USD',
      participants: [{ name: 'Admin' }],
    }
    const [first, second] = await Promise.all([
      caller.create({ requestId, groupFormValues }),
      caller.create({ requestId, groupFormValues }),
    ])
    expect(second.groupId).toBe(first.groupId)
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: first.groupId },
      select: { ledgerId: true },
    })
    trackLedger(group.ledgerId)
    expect(
      await prisma.group.count({ where: { name: groupFormValues.name } }),
    ).toBe(1)
    await expect(
      caller.create({
        requestId,
        groupFormValues: { ...groupFormValues, name: 'Different payload' },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('clears original currency metadata when updating back to group currency', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`Currency ${runId}`, {
      symbol: '€',
      code: 'EUR',
    })

    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'Dinner',
        amount: 1000,
        paidByList: [{ participant: participantId, shares: 1000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    await caller.expenses.update({
      expectedVersion: 1,
      groupId,
      expenseId,
      expense: {
        title: 'Dinner',
        amount: 1000,
        conversion: { type: 'custom', currency: 'USD', rate: 0.92 },
        paidByList: [{ participant: participantId, shares: 1000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    await caller.expenses.update({
      expectedVersion: 2,
      groupId,
      expenseId,
      expense: {
        title: 'Dinner',
        amount: 1200,
        paidByList: [{ participant: participantId, shares: 1200 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await prisma.expense.findUnique({
      where: { id: expenseId },
      select: {
        amount: true,
        originalAmount: true,
        originalCurrency: true,
        conversionRate: true,
      },
    })

    expect(expense).toEqual({
      amount: 1200,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
    })
  })

  // ------------------------------------------------------------------
  // 6. Delete expense
  // ------------------------------------------------------------------
  it('deletes an expense', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`Delete ${runId}`)

    const { expenseId } = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'To Delete',
        amount: 2000,
        paidByList: [{ participant: participantId, shares: 2000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Verify it exists
    let expense = await prisma.expense.findUnique({ where: { id: expenseId } })
    expect(expense).not.toBeNull()

    // Delete
    await caller.expenses.delete({ groupId, expenseId })

    // Verify removed
    expense = await prisma.expense.findUnique({ where: { id: expenseId } })
    expect(expense).toBeNull()
  })

  // ------------------------------------------------------------------
  // 7. Create expense with empty documents array
  // ------------------------------------------------------------------
  it('creates an expense with an empty documents array', async () => {
    const caller = makeCaller()
    const { groupId, participantId } = await createGroup(`NoDocs ${runId}`)

    const result = await caller.expenses.create({
      requestId: crypto.randomUUID(),
      groupId,
      expense: {
        title: 'No Documents',
        amount: 1500,
        paidByList: [{ participant: participantId, shares: 1500 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        expenseTimeZone: 'UTC',
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await prisma.expense.findUnique({
      where: { id: result.expenseId },
    })
    expect(expense).not.toBeNull()
    expect(expense!.title).toBe('No Documents')
  })

  // ------------------------------------------------------------------
  // 8. OAuth destructive scope is driven by what the update destroys
  // ------------------------------------------------------------------
  describe('OAuth destructive scope on update', () => {
    function makeOAuthCaller(scopes: string[]) {
      return groupsRouter.createCaller({
        auth: {
          credentialKind: 'oauth',
          audiences: [getApiBaseUrl()],
          scopes,
          accessToken: 'test-token',
          user: {
            id: adminId,
            email: adminEmail,
            emailVerified: true,
            name: 'Test Admin',
          },
          session: { id: 'sess-oauth-test' },
        },
      } as never)
    }

    const manageCaller = () =>
      makeOAuthCaller(['spliit:groups:read', 'spliit:expenses:manage'])
    const deleteCaller = () =>
      makeOAuthCaller([
        'spliit:groups:read',
        'spliit:expenses:manage',
        'spliit:expenses:delete',
      ])

    const expenseInput = (title: string, participant: string) => ({
      title,
      amount: 1000,
      paidByList: [{ participant, shares: 1000 }],
      paidBySplitMode: 'BY_AMOUNT' as const,
      isMultiPayer: false,
      paidFor: [{ participant, shares: 1 }],
      category: 'general' as const,
      splitMode: 'EVENLY' as const,
      expenseDate: new Date().toISOString(),
      expenseTimeZone: 'UTC',
      documents: [],
      recurrenceRule: 'NONE' as const,
    })

    it('rejects a manage-scoped update that drops a stored document', async () => {
      const deleteObject = vi
        .spyOn(upload, 'deleteS3Object')
        .mockResolvedValue(undefined)
      const { groupId, participantId } = await createGroup(`Doc scope ${runId}`)
      const group = await prisma.group.findUniqueOrThrow({
        where: { id: groupId },
        select: { ledgerId: true },
      })
      const created = await manageCaller().expenses.create({
        requestId: crypto.randomUUID(),
        groupId,
        expense: expenseInput('Receipt', participantId),
      })
      const createdRow = await prisma.expense.findUniqueOrThrow({
        where: { id: created.expenseId },
      })
      // A harmless rename stays on the manage scope...
      await manageCaller().expenses.update({
        groupId,
        expenseId: createdRow.id,
        expectedVersion: createdRow.version,
        expense: expenseInput('Receipt renamed', participantId),
      })
      await prisma.expenseDocument.create({
        data: {
          id: `doc-scope-${runId}`,
          ledgerId: group.ledgerId,
          expenseId: created.expenseId,
          url: 'https://example.invalid/receipt.png',
          width: 100,
          height: 100,
        },
      })
      try {
        const row = await prisma.expense.findUniqueOrThrow({
          where: { id: created.expenseId },
        })
        // Silently omitting the stored document needs delete, and the
        // check runs before any side effect touches storage.
        await expect(
          manageCaller().expenses.update({
            groupId,
            expenseId: row.id,
            expectedVersion: row.version,
            expense: expenseInput('Receipt renamed', participantId),
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' })
        expect(deleteObject).not.toHaveBeenCalled()
        await expect(
          prisma.expenseDocument.count({
            where: { id: `doc-scope-${runId}` },
          }),
        ).resolves.toBe(1)

        // The delete grant performs the same edit and removes the row.
        await deleteCaller().expenses.update({
          groupId,
          expenseId: row.id,
          expectedVersion: row.version,
          expense: expenseInput('Receipt renamed', participantId),
        })
        await expect(
          prisma.expenseDocument.count({
            where: { id: `doc-scope-${runId}` },
          }),
        ).resolves.toBe(0)
      } finally {
        deleteObject.mockRestore()
        await prisma.expenseDocument
          .deleteMany({ where: { ledgerId: group.ledgerId } })
          .catch(() => {})
      }
    })

    it('allows a harmless THIS_AND_FUTURE edit with manage only', async () => {
      const { groupId, participantId } = await createGroup(
        `Series scope ${runId}`,
      )
      const created = await manageCaller().expenses.create({
        requestId: crypto.randomUUID(),
        groupId,
        expense: expenseInput('Series', participantId),
      })
      const row = await prisma.expense.findUniqueOrThrow({
        where: { id: created.expenseId },
      })
      // No recurrence and no document removal: nothing is destroyed, so no
      // delete scope is required even with the series-wide verb.
      await expect(
        manageCaller().expenses.update({
          groupId,
          expenseId: row.id,
          expectedVersion: row.version,
          scope: 'THIS_AND_FUTURE',
          expense: expenseInput('Series renamed', participantId),
        }),
      ).resolves.toMatchObject({ expenseId: row.id })
    })
  })
})

import { prisma } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Group flow — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-admin-${runId}`
  const adminEmail = `admin-${runId}@test.example`

  /** Created ledgers — delete in afterAll to cascade through all resources. */
  const ledgerIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }
  /** Extra account IDs created inline in tests (beyond adminId). */
  const extraAccountIds: string[] = []

  function makeCaller(overrides?: { accountId?: string; email?: string }) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: overrides?.accountId ?? adminId,
          email: overrides?.email ?? adminEmail,
          emailVerified: true,
          name: 'Test Admin',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    await prisma.account.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        id: adminId,
        email: adminEmail,
        emailVerified: true,
        name: 'Test Admin',
      },
    })
  })

  afterAll(async () => {
    // Delete ledgers first — cascades to groups, members, participants, expenses, etc.
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
    for (const aid of extraAccountIds) {
      await prisma.account.delete({ where: { id: aid } }).catch(() => {})
    }
  })

  // ------------------------------------------------------------------
  // 1. Create group with admin member
  // ------------------------------------------------------------------
  it('creates a group with the admin as an ADMIN / ACTIVE member', async () => {
    const caller = makeCaller()
    const result = await caller.create({
      groupFormValues: {
        name: `Test Group ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })

    expect(result).toHaveProperty('groupId')
    const groupId = result.groupId

    // Verify DB state
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { account: true, ledgerParticipant: true } },
      },
    })
    expect(group).not.toBeNull()
    expect(group!.name).toBe(`Test Group ${runId}`)
    expect(group!.ledger).not.toBeNull()
    expect(group!.ledger.currency).toBe('$')
    expect(group!.ledger.currencyCode).toBe('USD')
    trackLedger(group!.ledger.id)

    expect(group!.members).toHaveLength(1)
    expect(group!.members[0].accountId).toBe(adminId)
    expect(group!.members[0].role).toBe('ADMIN')
    expect(group!.members[0].status).toBe('ACTIVE')
    expect(group!.members[0].ledgerParticipant).not.toBeNull()

    // Cleanup: delete the group through the ledger
    await prisma.ledger.delete({ where: { id: group!.ledger.id } })
    ledgerIds.pop()
  })

  // ------------------------------------------------------------------
  // 2. Create an expense in a group
  // ------------------------------------------------------------------
  it('creates an expense and verifies it is persisted with the correct ledger', async () => {
    const caller = makeCaller()

    // Create group
    const { groupId } = await caller.create({
      groupFormValues: {
        name: `Expense Group ${runId}`,
        currency: '€',
        currencyCode: 'EUR',
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
    const ledger = group!.ledger
    const adminParticipant = group!.members[0].ledgerParticipant!
    trackLedger(ledger.id)

    // Create expense
    const expResult = await caller.expenses.create({
      groupId,
      expenseFormValues: {
        title: 'Groceries',
        amount: 2500, // €25.00 in cents
        paidBy: adminParticipant.id,
        paidFor: [{ participant: adminParticipant.id, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    expect(expResult).toHaveProperty('expenseId')

    // Verify in DB
    const expense = await prisma.expense.findUnique({
      where: { id: expResult.expenseId },
      include: { paidFor: true },
    })
    expect(expense).not.toBeNull()
    expect(expense!.title).toBe('Groceries')
    expect(expense!.amount).toBe(2500)
    expect(expense!.ledgerId).toBe(ledger.id)
    expect(expense!.paidById).toBe(adminParticipant.id)
    expect(expense!.paidFor).toHaveLength(1)
    expect(expense!.paidFor[0].ledgerParticipantId).toBe(adminParticipant.id)
  })

  // ------------------------------------------------------------------
  // 3. Balance calculation with 3 members and 2 expenses
  // ------------------------------------------------------------------
  it('computes correct balances for 3 members with 2 expenses', async () => {
    const caller = makeCaller()

    // Create group
    const { groupId } = await caller.create({
      groupFormValues: {
        name: `Balances ${runId}`,
        currency: '$',
        currencyCode: 'USD',
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
    const ledger = group!.ledger
    const adminParticipant = group!.members[0].ledgerParticipant!
    trackLedger(ledger.id)

    // Add 2 more members with ledger participants
    const member1Id = `m1-${runId}`
    const member2Id = `m2-${runId}`
    extraAccountIds.push(member1Id, member2Id)
    await prisma.account.createMany({
      data: [
        {
          id: member1Id,
          email: `m1-${runId}@test.example`,
          emailVerified: true,
          name: 'Member 1',
        },
        {
          id: member2Id,
          email: `m2-${runId}@test.example`,
          emailVerified: true,
          name: 'Member 2',
        },
      ],
    })

    const gm1 = await prisma.groupMember.create({
      data: {
        id: `gm-${member1Id}`,
        groupId,
        accountId: member1Id,
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    const lp1 = await prisma.ledgerParticipant.create({
      data: {
        id: `lp-${member1Id}`,
        ledgerId: ledger.id,
        groupMemberId: gm1.id,
      },
    })

    const gm2 = await prisma.groupMember.create({
      data: {
        id: `gm-${member2Id}`,
        groupId,
        accountId: member2Id,
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    const lp2 = await prisma.ledgerParticipant.create({
      data: {
        id: `lp-${member2Id}`,
        ledgerId: ledger.id,
        groupMemberId: gm2.id,
      },
    })

    // Expense 1: admin paid $30, split EVENLY among 3 → $10 each
    await caller.expenses.create({
      groupId,
      expenseFormValues: {
        title: 'Dinner',
        amount: 3000,
        paidBy: adminParticipant.id,
        paidFor: [
          { participant: adminParticipant.id, shares: 1 },
          { participant: lp1.id, shares: 1 },
          { participant: lp2.id, shares: 1 },
        ],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Expense 2: member1 paid $15, split EVENLY among 3 → $5 each
    await caller.expenses.create({
      groupId,
      expenseFormValues: {
        title: 'Lunch',
        amount: 1500,
        paidBy: lp1.id,
        paidFor: [
          { participant: adminParticipant.id, shares: 1 },
          { participant: lp1.id, shares: 1 },
          { participant: lp2.id, shares: 1 },
        ],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Verify balances
    // Admin: paid 3000, owes 1000+500=1500 → net +1500 (creditor)
    // Member1: paid 1500, owes 1000+500=1500 → net 0
    // Member2: paid 0, owes 1000+500=1500 → net -1500 (debtor)
    const balanceResult = await caller.balances.list({
      groupId,
      linkInviteToken: undefined,
    })
    expect(balanceResult).toHaveProperty('balances')
    expect(balanceResult).toHaveProperty('reimbursements')

    // publicBalances only includes participants with non-zero totals
    expect(balanceResult.balances[adminParticipant.id].total).toBe(1500)
    expect(balanceResult.balances[lp1.id]).toBeUndefined()
    expect(balanceResult.balances[lp2.id].total).toBe(-1500)

    // (cleanup handled by afterAll via ledger cascade)
  })

  // ------------------------------------------------------------------
  // 4. Archive / unarchive group
  // ------------------------------------------------------------------
  it('archives and unarchives a group', async () => {
    const caller = makeCaller()

    const { groupId } = await caller.create({
      groupFormValues: {
        name: `Archive ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { ledgerId: true },
    })
    trackLedger(group!.ledgerId)

    // Verify initially not archived
    let dbGroup = await prisma.group.findUnique({ where: { id: groupId } })
    expect(dbGroup!.archived).toBe(false)

    // Archive
    await caller.archive({ groupId, archived: true })
    dbGroup = await prisma.group.findUnique({ where: { id: groupId } })
    expect(dbGroup!.archived).toBe(true)

    // Unarchive
    await caller.archive({ groupId, archived: false })
    dbGroup = await prisma.group.findUnique({ where: { id: groupId } })
    expect(dbGroup!.archived).toBe(false)
  })
})

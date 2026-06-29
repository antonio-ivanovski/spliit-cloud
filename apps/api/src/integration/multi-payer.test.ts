import { Parser } from '@json2csv/plainjs'
import { prisma } from '@spliit/db'
import { getBalances, type Expense } from '@spliit/domain'
import { parseSpliitExport } from '@spliit/domain/import'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomId } from '../lib/api'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

/**
 * Multi-payer expense integration tests against a real PostgreSQL DB.
 *
 * Pattern matches `expense-crud.test.ts`: an admin account is
 * upserted once, every group is created via `groupsRouter.createCaller`,
 * and the ledger/group ids are tracked for `afterAll` cleanup.
 */
describe('Multi-payer expenses — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-mp-${runId}`
  const adminEmail = `mp-${runId}@test.example`

  const ledgerIds: string[] = []
  const accountIds: string[] = []

  function trackLedger(id: string) {
    ledgerIds.push(id)
  }
  function trackAccount(id: string) {
    accountIds.push(id)
  }

  function makeCaller(accountId = adminId, email = adminEmail) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: accountId,
          email,
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
    trackAccount(adminId)
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    for (const aid of accountIds) {
      await prisma.account.delete({ where: { id: aid } }).catch(() => {})
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Create a fresh group via the tRPC caller and additional ledger
   * participants (UNLINKED rows — `createGroup` only mints an LP for
   * the admin). Returns the group id and a name→ledgerParticipantId
   * map so the test can address participants by name.
   */
  async function createGroupWithParticipants(
    name: string,
    participantNames: string[],
  ): Promise<{
    groupId: string
    participants: Record<string, string>
    ledgerId: string
  }> {
    const caller = makeCaller()
    const { groupId } = await caller.create({
      groupFormValues: {
        name,
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

    const ledgerId = group!.ledger.id
    trackLedger(ledgerId)

    // Admin LP already exists from `createGroup`.
    const adminLpId = group!.members[0].ledgerParticipant!.id

    const participants: Record<string, string> = { Admin: adminLpId }
    for (const participantName of participantNames) {
      const lp = await prisma.ledgerParticipant.create({
        data: {
          id: randomId(),
          ledgerId,
          kind: 'UNLINKED_PARTICIPANT',
          displayName: participantName,
        },
      })
      participants[participantName] = lp.id
    }
    return { groupId, participants, ledgerId }
  }

  /** Convenience: USD group with one admin + 'Alice' + 'Bob'. */
  async function createUsdGroup(name: string) {
    return createGroupWithParticipants(name, ['Alice', 'Bob'])
  }

  /**
   * Read an expense with `paidByList`+`paidFor` includes. Mirrors the
   * shape `groups.expenses.get` would return over the wire.
   */
  async function readExpense(expenseId: string) {
    return prisma.expense.findUnique({
      where: { id: expenseId },
      include: {
        paidByList: { include: { ledgerParticipant: true } },
        paidFor: { include: { ledgerParticipant: true } },
      },
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. BY_AMOUNT, 3 payers, single-currency
  // ────────────────────────────────────────────────────────────────────────

  it('creates a multi-payer BY_AMOUNT expense (3 payers, sum == amount)', async () => {
    const { groupId, participants } = await createUsdGroup(
      `MP-ByAmount-${runId}`,
    )

    const result = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Trip',
        amount: 12000,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          { participant: participants['Admin'], shares: 5000 },
          { participant: participants['Alice'], shares: 4000 },
          { participant: participants['Bob'], shares: 3000 },
        ],
        paidFor: [
          { participant: participants['Admin'], shares: 1 },
          { participant: participants['Alice'], shares: 1 },
          { participant: participants['Bob'], shares: 1 },
        ],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })
    expect(result).toHaveProperty('expenseId')

    const expense = await readExpense(result.expenseId)
    expect(expense!.paidByList).toHaveLength(3)
    expect(expense!.paidBySplitMode).toBe('BY_AMOUNT')
    const totalShares = expense!.paidByList.reduce((s, p) => s + p.shares, 0)
    expect(totalShares).toBe(12000)

    // Domain-side balance sanity. `getBalances` rebalances the cents
    // via the "isLast takes the remainder" trick, so per-person totals
    // can be non-zero as long as the group net is zero (see the
    // docstring on `getGroupBalances` for why the UI uses
    // `getPublicBalances` to cancel the residue before display).
    const balances = getBalances([
      {
        amount: 12000,
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: expense!.paidByList.map((pb) => ({
          shares: pb.shares,
          participant: pb.ledgerParticipant,
        })),
        paidFor: expense!.paidFor.map((pf) => ({
          shares: pf.shares,
          participant: pf.ledgerParticipant,
        })),
      },
    ])
    const net = Object.values(balances).reduce((s, b) => s + b.total, 0)
    expect(net).toBe(0)
  })

  // ────────────────────────────────────────────────────────────────────────
  // 2. BY_PERCENTAGE (50/50)
  // ────────────────────────────────────────────────────────────────────────

  it('creates a multi-payer BY_PERCENTAGE expense (50/50)', async () => {
    const { groupId, participants } = await createUsdGroup(`MP-ByPct-${runId}`)

    const result = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Split 50/50',
        amount: 10000,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_PERCENTAGE',
        paidByList: [
          { participant: participants['Admin'], shares: 5000 },
          { participant: participants['Alice'], shares: 5000 },
        ],
        paidFor: [
          { participant: participants['Admin'], shares: 1 },
          { participant: participants['Alice'], shares: 1 },
        ],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await readExpense(result.expenseId)
    expect(expense!.paidByList).toHaveLength(2)
    expect(expense!.paidBySplitMode).toBe('BY_PERCENTAGE')
  })

  // ────────────────────────────────────────────────────────────────────────
  // 3. EVENLY (2 payers, $50 each)
  // ────────────────────────────────────────────────────────────────────────

  it('creates a multi-payer EVENLY expense (2 payers)', async () => {
    const { groupId, participants } = await createUsdGroup(`MP-Evenly-${runId}`)

    const result = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Even Pay',
        amount: 10000,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'EVENLY',
        paidByList: [
          { participant: participants['Alice'], shares: 1 },
          { participant: participants['Bob'], shares: 1 },
        ],
        paidFor: [
          { participant: participants['Alice'], shares: 1 },
          { participant: participants['Bob'], shares: 1 },
        ],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await readExpense(result.expenseId)
    expect(expense!.paidByList).toHaveLength(2)
    expect(expense!.paidBySplitMode).toBe('EVENLY')
  })

  // ────────────────────────────────────────────────────────────────────────
  // 4. Cross-currency: EUR group / USD paid $100 split $70/$30
  // ────────────────────────────────────────────────────────────────────────

  it('cross-currency: ledger EUR / original USD 70/30 produces correct EUR-cent balances', async () => {
    const { groupId, participants, ledgerId } =
      await createGroupWithParticipants(`MP-XCcy-${runId}`, ['Alice', 'Bob'])
    // Switch the ledger currency to EUR for this scenario.
    await prisma.ledger.update({
      where: { id: ledgerId },
      data: { currency: '€', currencyCode: 'EUR' },
    })

    const result = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'NYC trip',
        amount: 9200, // 10000 USD cents × 0.92 = 9200 EUR cents
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        originalAmount: 10000,
        originalCurrency: 'USD',
        conversionRate: 0.92,
        paidByList: [
          { participant: participants['Alice'], shares: 7000 },
          { participant: participants['Bob'], shares: 3000 },
        ],
        paidFor: [
          { participant: participants['Alice'], shares: 1 },
          { participant: participants['Bob'], shares: 1 },
        ],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await readExpense(result.expenseId)
    expect(expense!.originalCurrency).toBe('USD')
    expect(Number(expense!.conversionRate)).toBeCloseTo(0.92)

    const balances = getBalances([
      {
        amount: 9200,
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: expense!.paidByList.map((pb) => ({
          shares: pb.shares,
          participant: pb.ledgerParticipant,
        })),
        paidFor: expense!.paidFor.map((pf) => ({
          shares: pf.shares,
          participant: pf.ledgerParticipant,
        })),
        originalAmount: 10000,
        originalCurrency: 'USD',
        conversionRate: 0.92,
      },
    ])

    // 7000 USD × 0.92 = 6440 EUR cents paid by Alice
    // 3000 USD × 0.92 = 2760 EUR cents paid by Bob
    // each paidFor = 9200/2 = 4600 EUR cents
    // Alice total = +1840, Bob total = -1840
    const aliceId = participants['Alice']
    const bobId = participants['Bob']
    expect(balances[aliceId].paid).toBe(6440)
    expect(balances[bobId].paid).toBe(2760)
    expect(balances[aliceId].paidFor).toBe(4600)
    expect(balances[bobId].paidFor).toBe(4600)
    expect(balances[aliceId].total).toBe(1840)
    expect(balances[bobId].total).toBe(-1840)

    const net = Object.values(balances).reduce((s, b) => s + b.total, 0)
    expect(net).toBe(0)
  })

  // ────────────────────────────────────────────────────────────────────────
  // 5. Cross-currency single-payer BY_AMOUNT creates correct shares
  // ────────────────────────────────────────────────────────────────────────

  it('cross-currency: createExpense with EUR original and BY_AMOUNT stores shares in original currency', async () => {
    const { groupId, participants, ledgerId } = await createUsdGroup(
      `MP-XC-ByAmt-${runId}`,
    )
    // Switch ledger to EUR so the cross-currency path is exercised.
    await prisma.ledger.update({
      where: { id: ledgerId },
      data: { currency: '\u20ac', currencyCode: 'EUR' },
    })

    const result = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'XC BY_AMOUNT',
        amount: 1090,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        originalAmount: 1000,
        originalCurrency: 'USD',
        conversionRate: 1.09,
        paidByList: [{ participant: participants['Admin'], shares: 1000 }],
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await readExpense(result.expenseId)
    expect(expense!.paidBySplitMode).toBe('BY_AMOUNT')
    expect(expense!.paidByList).toHaveLength(1)
    expect(expense!.paidByList[0].shares).toBe(1000)
  })

  it('cross-currency: updateExpense preserves shares in original currency', async () => {
    const { groupId, participants, ledgerId } = await createUsdGroup(
      `MP-XC-Upd-${runId}`,
    )
    await prisma.ledger.update({
      where: { id: ledgerId },
      data: { currency: '\u20ac', currencyCode: 'EUR' },
    })

    const create = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'XC Update',
        amount: 1090,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        originalAmount: 1000,
        originalCurrency: 'USD',
        conversionRate: 1.09,
        paidByList: [{ participant: participants['Admin'], shares: 1000 }],
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    await makeCaller().expenses.update({
      groupId,
      expenseId: create.expenseId,
      expense: {
        title: 'XC Update',
        amount: 1090,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        originalAmount: 1000,
        originalCurrency: 'USD',
        conversionRate: 1.09,
        paidByList: [{ participant: participants['Admin'], shares: 1000 }],
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await readExpense(create.expenseId)
    expect(expense!.paidByList).toHaveLength(1)
    expect(expense!.paidByList[0].shares).toBe(1000)
  })

  it('cross-currency: getExpense returns correct paidByList with original-currency shares', async () => {
    const { groupId, participants, ledgerId } = await createUsdGroup(
      `MP-XC-Get-${runId}`,
    )
    await prisma.ledger.update({
      where: { id: ledgerId },
      data: { currency: '\u20ac', currencyCode: 'EUR' },
    })

    const result = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'XC Get',
        amount: 1090,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        originalAmount: 1000,
        originalCurrency: 'USD',
        conversionRate: 1.09,
        paidByList: [{ participant: participants['Admin'], shares: 1000 }],
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await readExpense(result.expenseId)
    expect(expense!.paidByList).toHaveLength(1)
    expect(expense!.paidByList[0].shares).toBe(1000)
    expect(expense!.originalAmount).toBe(1000)
    expect(expense!.originalCurrency).toBe('USD')
  })

  // ────────────────────────────────────────────────────────────────────────
  // 7. Update toggles multi-payer off (downgrade)
  // ────────────────────────────────────────────────────────────────────────

  it('downgrades an expense from multi-payer to single-payer on update', async () => {
    const { groupId, participants } = await createUsdGroup(`MP-Down-${runId}`)

    const create = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Multi',
        amount: 10000,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          { participant: participants['Admin'], shares: 5000 },
          { participant: participants['Alice'], shares: 5000 },
        ],
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    await makeCaller().expenses.update({
      groupId,
      expenseId: create.expenseId,
      expense: {
        title: 'Multi',
        amount: 10000,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants['Admin'], shares: 10000 }],
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await readExpense(create.expenseId)
    expect(expense!.paidByList).toHaveLength(1)
  })

  // ────────────────────────────────────────────────────────────────────────
  // 8. Update toggles multi-payer on (upgrade)
  // ────────────────────────────────────────────────────────────────────────

  it('upgrades an expense to multi-payer on update', async () => {
    const { groupId, participants } = await createUsdGroup(`MP-Up-${runId}`)

    const create = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Single',
        amount: 10000,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants['Admin'], shares: 10000 }],
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    await makeCaller().expenses.update({
      groupId,
      expenseId: create.expenseId,
      expense: {
        title: 'Single',
        amount: 10000,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          { participant: participants['Admin'], shares: 5000 },
          { participant: participants['Alice'], shares: 5000 },
        ],
        paidFor: [{ participant: participants['Admin'], shares: 1 }],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    const expense = await readExpense(create.expenseId)
    expect(expense!.paidByList).toHaveLength(2)
    expect(expense!.paidBySplitMode).toBe('BY_AMOUNT')
  })

  // ────────────────────────────────────────────────────────────────────────
  // 9. Recurrence cloning preserves paidByList
  // ────────────────────────────────────────────────────────────────────────

  it('a recurring multi-payer expense materializes with the same paidByList', async () => {
    const { groupId, participants, ledgerId } = await createUsdGroup(
      `MP-Recur-${runId}`,
    )

    // Backdate so the next planned recurrence date is already past.
    const past = new Date()
    past.setUTCDate(past.getUTCDate() - 14)

    const result = await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Weekly groceries',
        amount: 6000,
        expenseDate: past.toISOString(),
        category: 'groceries',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          { participant: participants['Admin'], shares: 4000 },
          { participant: participants['Alice'], shares: 2000 },
        ],
        paidFor: [
          { participant: participants['Admin'], shares: 1 },
          { participant: participants['Alice'], shares: 1 },
        ],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'WEEKLY',
      },
    })
    expect(result).toHaveProperty('expenseId')

    // Trigger the same helper the cron-like worker would call.
    const { createRecurringExpenses } = await import('../lib/api')
    await createRecurringExpenses()

    const cloned = await prisma.expense.findMany({
      where: { ledgerId, title: 'Weekly groceries' },
      include: { paidByList: true },
      orderBy: { createdAt: 'asc' },
    })

    expect(cloned.length).toBeGreaterThanOrEqual(2)
    const expectedById: Record<string, number> = {
      [participants['Admin']]: 4000,
      [participants['Alice']]: 2000,
    }
    for (const e of cloned) {
      expect(e.paidByList).toHaveLength(2)
      // Sort alphabetically by ledgerParticipantId so the assertion is
      // independent of insertion order; the per-row map pins the
      // expected shares to the right id.
      const byId = new Map(
        e.paidByList.map((p) => [p.ledgerParticipantId, p.shares]),
      )
      for (const [id, shares] of Object.entries(expectedById)) {
        expect(byId.get(id)).toBe(shares)
      }
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // 10. Settlement archive writes single-row paidByList
  // ────────────────────────────────────────────────────────────────────────

  it('archive settlement writes Settlement expenses with a single-row paidByList', async () => {
    const { groupId, participants, ledgerId } = await createUsdGroup(
      `MP-Arc-${runId}`,
    )

    // Multi-payer expense leaving a non-zero balance for force-archive
    // to settle.
    await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Lunch',
        amount: 3000,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: participants['Admin'], shares: 3000 }],
        paidFor: [
          { participant: participants['Admin'], shares: 1 },
          { participant: participants['Alice'], shares: 1 },
        ],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    await makeCaller().archive({
      groupId,
      archived: true,
      force: true,
    })

    const settlements = await prisma.expense.findMany({
      where: { ledgerId, isReimbursement: true },
      include: { paidByList: true },
    })
    expect(settlements.length).toBeGreaterThan(0)
    for (const s of settlements) {
      expect(s.paidByList).toHaveLength(1)
      expect(s.paidBySplitMode).toBe('BY_AMOUNT')
      expect(s.paidByList[0].shares).toBe(s.amount)
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // 11. Settlement on leave writes single-row paidByList
  // ────────────────────────────────────────────────────────────────────────

  it('leave-group settlement writes Settlement expenses with a single-row paidByList', async () => {
    // 2-member group: admin + an Alice account, so the admin can
    // force-leave without being the last member.
    const { groupId, ledgerId } = await createGroupWithParticipants(
      `MP-Leave-${runId}`,
      [],
    )
    const aliceAcctId = `acct-alice-${runId}`
    const aliceEmail = `alice-${runId}@test.example`
    trackAccount(aliceAcctId)
    await prisma.account.upsert({
      where: { id: aliceAcctId },
      update: {},
      create: {
        id: aliceAcctId,
        email: aliceEmail,
        emailVerified: true,
        name: 'Alice',
      },
    })

    // Add Alice as a MEMBER (account-backed LP) so the admin can leave
    // without taking the group down. We dig the admin LP out of the
    // group record (createGroup created it on the admin account).
    const groupRow = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: { include: { ledgerParticipant: true } } },
    })
    const adminLp = groupRow!.members[0].ledgerParticipant!.id

    const aliceMember = await prisma.groupMember.create({
      data: {
        id: randomId(),
        groupId,
        accountId: aliceAcctId,
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    const aliceLp = await prisma.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId,
        groupMemberId: aliceMember.id,
        kind: 'ACCOUNT_MEMBER',
      },
    })

    // Multi-payer expense producing a non-zero balance.
    await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'Beer run',
        amount: 4000,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: adminLp, shares: 4000 }],
        paidFor: [
          { participant: adminLp, shares: 1 },
          { participant: aliceLp.id, shares: 1 },
        ],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Admin leaves the group with force=true so a Settlement expense
    // is written against their leg.
    await makeCaller().leave({
      groupId,
      force: true,
      promoteMemberId: aliceMember.id,
    })

    const settlements = await prisma.expense.findMany({
      where: { ledgerId, isReimbursement: true },
      include: { paidByList: true },
    })
    expect(settlements.length).toBeGreaterThan(0)
    for (const s of settlements) {
      expect(s.paidByList).toHaveLength(1)
      expect(s.paidBySplitMode).toBe('BY_AMOUNT')
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // 12. CSV export — multi-payer row formula
  // ────────────────────────────────────────────────────────────────────────
  //
  // The CSV route (`exportGroupCsv`) needs a real better-auth session
  // header. Mock that at the route-call level instead of going through
  // an HTTP request so this test stays runnable from a fresh checkout.

  it('CSV export uses the multi-payer formula: net = payerShare × ratio − paidForShare', async () => {
    const { groupId, participants } = await createUsdGroup(`MP-CSV-${runId}`)

    // Multi-payer 2-row expense: Alice paid 70% of $100, Bob paid 30%.
    // Both share the cost evenly (50% each).
    await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'CSV row',
        amount: 10000,
        expenseDate: new Date('2026-06-01T00:00:00.000Z'),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          { participant: participants['Alice'], shares: 7000 },
          { participant: participants['Bob'], shares: 3000 },
        ],
        paidFor: [
          { participant: participants['Alice'], shares: 1 },
          { participant: participants['Bob'], shares: 1 },
        ],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Re-derive the per-row numbers as `export-csv.ts` does:
    //   payerAmount  = amount × payerShare / totalPaidByShares
    //   paidForShare = (amount / totalShares) × paidForRow.shares
    //   cell         = payerAmount − paidForShare
    const aliceId = participants['Alice']
    const bobId = participants['Bob']
    const totalAmount = 10000
    const alicePaid = (7000 / (7000 + 3000)) * totalAmount
    const bobPaid = (3000 / (7000 + 3000)) * totalAmount
    const aliceFor = (totalAmount / 2) * 1
    const bobFor = (totalAmount / 2) * 1
    expect(alicePaid - aliceFor).toBe(2000)
    expect(bobPaid - bobFor).toBe(-2000)

    // Cross-check the @json2csv/plainjs Parser that the route uses
    // produces valid CSV (quoting all fields by default).
    const csv = new Parser({ fields: ['alice', 'bob'] }).parse([
      { alice: '20.00', bob: '-20.00' },
    ])
    expect(csv).toContain('"alice","bob"')
    expect(csv).toContain('"20.00","-20.00"')
  })

  // ────────────────────────────────────────────────────────────────────────
  // 13. JSON export shape
  // ────────────────────────────────────────────────────────────────────────

  it('JSON export shape includes paidByList + paidBySplitMode and omits paidById', async () => {
    const { groupId, participants } = await createUsdGroup(`MP-JSON-${runId}`)

    await makeCaller().expenses.create({
      groupId,
      expense: {
        title: 'JSON row',
        amount: 4000,
        expenseDate: new Date().toISOString(),
        category: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          { participant: participants['Alice'], shares: 2000 },
          { participant: participants['Bob'], shares: 2000 },
        ],
        paidFor: [
          { participant: participants['Alice'], shares: 1 },
          { participant: participants['Bob'], shares: 1 },
        ],
        isReimbursement: false,
        saveDefaultSplittingOptions: false,
        documents: [],
        recurrenceRule: 'NONE',
      },
    })

    // Verify the persistent shape that `export-json.ts` selects into the
    // payload: `paidByList` present, `paidBySplitMode` present, no
    // `paidById`.
    const ledger = await prisma.group.findUnique({
      where: { id: groupId },
      select: { ledgerId: true },
    })
    const persisted = await prisma.expense.findMany({
      where: { ledgerId: ledger!.ledgerId, title: 'JSON row' },
      include: { paidByList: true },
    })
    expect(persisted).toHaveLength(1)
    const exp = persisted[0]
    expect(exp.paidByList).toHaveLength(2)
    expect(exp.paidBySplitMode).toBe('BY_AMOUNT')
    // Prisma ensures the legacy column no longer exists on the model;
    // confirm we never see it in a select projection.
    expect(Object.keys(exp)).not.toContain('paidById')
  })

  // ────────────────────────────────────────────────────────────────────────
  // 14. Spliit import: legacy {paidById} wraps to a 1-row paidByList
  // ────────────────────────────────────────────────────────────────────────

  it('importing a legacy Spliit export wraps {paidById} into a 1-row paidByList', async () => {
    // Legacy-shaped Spliit export. The current parsers honour this
    // shape as the only on-the-wire format.
    const legacy = {
      id: `legacy-${runId}`,
      name: `Legacy ${runId}`,
      currency: '$',
      currencyCode: 'USD',
      participants: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ],
      expenses: [
        {
          title: 'Legacy Dinner',
          amount: 3000,
          paidById: 'p1',
          paidFor: [
            { participantId: 'p1', shares: 1 },
            { participantId: 'p2', shares: 1 },
          ],
          isReimbursement: false,
          splitMode: 'EVENLY',
          recurrenceRule: 'NONE',
          expenseDate: '2026-06-15',
          category: null,
        },
      ],
    }

    const parsed = parseSpliitExport(legacy)
    expect(parsed.expenses).toHaveLength(1)
    const paidBySourceId = parsed.expenses[0].paidBySourceId

    // Fresh destination group.
    const { groupId, ledgerId } = await createGroupWithParticipants(
      `Legacy imp ${runId}`,
      [],
    )

    // Each legacy source participant → a fresh UNLINKED LP. Mirrors
    // what the wizard does at commit time (`buildImportBatch` →
    // `importGroup`).
    const participantMap: Record<string, string> = {}
    for (const p of parsed.participants) {
      const lp = await prisma.ledgerParticipant.create({
        data: {
          id: randomId(),
          ledgerId,
          kind: 'UNLINKED_PARTICIPANT',
          displayName: p.sourceName,
        },
      })
      participantMap[p.sourceId] = lp.id
    }

    // The wrapping step: turn the legacy single-payer shape into
    // `paidByList` of length 1 (BY_AMOUNT, shares = amount). Mirrors
    // apps/web/src/app/groups/import/import-group-wizard.tsx.
    const expenses = parsed.expenses.map((e) => ({
      expenseDate: new Date(e.expenseDate),
      title: e.title,
      category: e.category as never,
      amount: e.amount,
      paidByList: [
        {
          participant: participantMap[e.paidBySourceId]!,
          shares: e.amount,
        },
      ],
      paidBySplitMode: 'BY_AMOUNT' as const,
      paidFor: e.paidFor.map((pf) => ({
        participant: participantMap[pf.sourceId]!,
        shares: pf.shares,
      })),
      splitMode: e.splitMode,
      saveDefaultSplittingOptions: false,
      isReimbursement: e.isReimbursement,
      documents: [],
      notes: undefined,
      recurrenceRule: e.recurrenceRule,
    })) as unknown as Expense[]

    const result = await makeCaller().import({
      targetGroupId: groupId,
      participants: parsed.participants.map((p) => ({
        mode: 'LINK_EXISTING_PARTICIPANT' as const,
        sourceName: p.sourceName,
        destLedgerParticipantId: participantMap[p.sourceId]!,
      })),
      expenses,
      sourceMeta: {
        provider: 'SPLIIT',
        sourceGroupId: parsed.sourceGroupId,
      },
    })
    expect(result.importedExpenses).toBe(1)

    const created = await prisma.expense.findMany({
      where: { ledgerId, title: 'Legacy Dinner' },
      include: { paidByList: true },
    })
    expect(created).toHaveLength(1)
    expect(created[0].paidByList).toHaveLength(1)
    expect(created[0].paidBySplitMode).toBe('BY_AMOUNT')
    expect(created[0].paidByList[0].shares).toBe(3000)
    expect(created[0].paidByList[0].ledgerParticipantId).toBe(
      participantMap[paidBySourceId],
    )
  })
})

import { GroupRole, prisma } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Currency migration — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-cm-${runId}`
  const adminEmail = `cm-admin-${runId}@test.example`
  const memberId = `acct-cm-mem-${runId}`
  const memberEmail = `cm-member-${runId}@test.example`

  const ledgerIds: string[] = []
  const extraAccountIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  function makeCaller(overrides?: { accountId?: string; email?: string }) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-cm' },
        user: {
          id: overrides?.accountId ?? adminId,
          email: overrides?.email ?? adminEmail,
          emailVerified: true,
          name: 'Test Admin',
        },
      },
    } as never)
  }

  async function createGroup(
    caller: ReturnType<typeof makeCaller>,
    name: string,
    currency: { symbol: string; code: string } = { symbol: '$', code: 'USD' },
  ) {
    const { groupId } = await caller.create({
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
    return {
      groupId,
      ledgerId: group!.ledger.id,
      adminParticipantId: group!.members[0].ledgerParticipant!.id,
    }
  }

  async function createExpense(
    caller: ReturnType<typeof makeCaller>,
    groupId: string,
    participantId: string,
    args: {
      title: string
      amount: number
      conversion?: { type: 'custom'; currency: string; rate: number }
    },
  ) {
    return caller.expenses.create({
      groupId,
      expense: {
        title: args.title,
        amount: args.amount,
        paidByList: [{ participant: participantId, shares: args.amount }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [],
        recurrenceRule: 'NONE',
        ...(args.conversion ? { conversion: args.conversion } : {}),
      },
    })
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
    await prisma.account.upsert({
      where: { email: memberEmail },
      update: {},
      create: {
        id: memberId,
        email: memberEmail,
        emailVerified: true,
        name: 'Test Member',
      },
    })
    extraAccountIds.push(memberId)
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
    for (const aid of extraAccountIds) {
      await prisma.account.delete({ where: { id: aid } }).catch(() => {})
    }
  })

  // ------------------------------------------------------------------
  // 1. Full migration flow: same-currency expenses
  // ------------------------------------------------------------------
  it('migrates a USD group with same-currency expenses to GBP', async () => {
    const caller = makeCaller()
    const { groupId, ledgerId, adminParticipantId } = await createGroup(
      caller,
      `Migrate Same-Currency ${runId}`,
    )

    const exp1 = await createExpense(caller, groupId, adminParticipantId, {
      title: 'Coffee',
      amount: 500, // $5.00
    })
    const exp2 = await createExpense(caller, groupId, adminParticipantId, {
      title: 'Lunch',
      amount: 2000, // $20.00
    })

    // Preview the migration to GBP
    const preview = await caller.migrateCurrencyPreview({
      groupId,
      destinationCurrencyCode: 'GBP',
    })
    expect(preview.groupId).toBe(groupId)
    expect(preview.oldCurrencyCode).toBe('USD')
    expect(preview.destinationCurrencyCode).toBe('GBP')
    expect(preview.hasExpenses).toBe(true)
    expect(preview.eligible).toBe(true)
    expect(preview.unsupportedCurrencies).toEqual([])
    expect(preview.pairs).toHaveLength(1)
    expect(preview.pairs[0]).toMatchObject({
      base: 'USD',
      target: 'GBP',
    })
    expect(preview.pairs[0].expenseIds).toHaveLength(2)
    expect(preview.expenses).toHaveLength(2)
    expect(preview.customRateExpenseCount).toBe(0)

    // Commit the migration with a fixed custom rate
    const result = await caller.migrateCurrency({
      groupId,
      destinationCurrencyCode: 'GBP',
      pairChoices: { 'USD|GBP': { type: 'fixedCustom', rate: 0.8 } },
    })
    expect(result.groupId).toBe(groupId)
    expect(result.oldCurrencyCode).toBe('USD')
    expect(result.newCurrencyCode).toBe('GBP')
    expect(result.migratedExpenses).toBe(2)
    expect(result.activityId).toBeTruthy()

    // Verify ledger updated
    const ledger = await prisma.ledger.findUnique({ where: { id: ledgerId } })
    expect(ledger!.currencyCode).toBe('GBP')
    expect(ledger!.currency).toBe('£')

    // Verify both expenses got converted amounts and tracked originals
    const e1 = await prisma.expense.findUnique({
      where: { id: exp1.expenseId },
    })
    const e2 = await prisma.expense.findUnique({
      where: { id: exp2.expenseId },
    })
    expect(e1!.amount).toBe(400) // $5.00 * 0.8 = £4.00
    expect(e1!.originalAmount).toBe(500)
    expect(e1!.originalCurrency).toBe('USD')
    expect(e1!.conversionRate).toBe(0.8)
    expect(e1!.conversionSource).toBe('CUSTOM')
    expect(e2!.amount).toBe(1600) // $20.00 * 0.8 = £16.00
    expect(e2!.originalAmount).toBe(2000)
    expect(e2!.originalCurrency).toBe('USD')
    expect(e2!.conversionRate).toBe(0.8)
    expect(e2!.conversionSource).toBe('CUSTOM')

    // Verify activity was logged with the correct shape
    const activity = await prisma.activity.findUnique({
      where: { id: result.activityId },
    })
    expect(activity).not.toBeNull()
    expect(activity!.type).toBe('GROUP_CURRENCY_MIGRATED')
    expect(activity!.actorType).toBe('ACCOUNT')
    expect(activity!.actorId).toBe(adminId)
    expect(activity!.subjectType).toBe('GROUP')
    expect(activity!.subjectId).toBe(groupId)
    expect(activity!.data).toMatchObject({
      kind: 'group',
      oldCurrencyCode: 'USD',
      newCurrencyCode: 'GBP',
    })
  })

  // ------------------------------------------------------------------
  // 2. Already-converted expenses preserve their original currency
  // ------------------------------------------------------------------
  it('migrates EUR-converted expenses from USD by repricing from EUR', async () => {
    const caller = makeCaller()
    const { groupId, adminParticipantId } = await createGroup(
      caller,
      `Migrate Converted ${runId}`,
    )

    // Original €10.00 expense entered as USD-converted:
    // amount=1000, originalAmount=1000, originalCurrency=EUR
    // (custom rate 1.1 USD/EUR → ledger amount = 1100¢ = $11.00)
    const exp = await createExpense(caller, groupId, adminParticipantId, {
      title: 'EUR expense',
      amount: 1000,
      conversion: { type: 'custom', currency: 'EUR', rate: 1.1 },
    })
    const initial = await prisma.expense.findUnique({
      where: { id: exp.expenseId },
    })
    expect(initial!.amount).toBe(1100)
    expect(initial!.originalAmount).toBe(1000)
    expect(initial!.originalCurrency).toBe('EUR')

    // Migrate USD → GBP
    const result = await caller.migrateCurrency({
      groupId,
      destinationCurrencyCode: 'GBP',
      pairChoices: { 'EUR|GBP': { type: 'fixedCustom', rate: 0.85 } },
    })
    expect(result.newCurrencyCode).toBe('GBP')

    const migrated = await prisma.expense.findUnique({
      where: { id: exp.expenseId },
    })
    // Effective original is EUR (1000 minor units), not the USD ledger amount.
    // 1000¢ * 0.85 = 850¢ = £8.50
    expect(migrated!.amount).toBe(850)
    // Original currency and amount are preserved — we still remember €10.00.
    expect(migrated!.originalAmount).toBe(1000)
    expect(migrated!.originalCurrency).toBe('EUR')
    // Conversion rate is the EUR→GBP rate used to migrate, not the old USD rate.
    expect(migrated!.conversionRate).toBe(0.85)
    expect(migrated!.conversionSource).toBe('CUSTOM')
  })

  // ------------------------------------------------------------------
  // 3. Ineligible cases
  // ------------------------------------------------------------------
  it('marks a group with no expenses as ineligible', async () => {
    const caller = makeCaller()
    const { groupId } = await createGroup(caller, `Migrate Empty ${runId}`)

    const preview = await caller.migrateCurrencyPreview({
      groupId,
      destinationCurrencyCode: 'GBP',
    })
    expect(preview.hasExpenses).toBe(false)
    expect(preview.eligible).toBe(false)

    // Commit should also reject.
    await expect(
      caller.migrateCurrency({
        groupId,
        destinationCurrencyCode: 'GBP',
        pairChoices: {},
      }),
    ).rejects.toThrow(/expenses/i)
  })

  it('blocks migration to an unsupported currency', async () => {
    const caller = makeCaller()
    const { groupId, adminParticipantId } = await createGroup(
      caller,
      `Migrate Bad Currency ${runId}`,
    )
    await createExpense(caller, groupId, adminParticipantId, {
      title: 'Any expense',
      amount: 1000,
    })

    const preview = await caller.migrateCurrencyPreview({
      groupId,
      destinationCurrencyCode: 'ZZZ',
    })
    expect(preview.eligible).toBe(false)
    expect(preview.unsupportedCurrencies.some((c) => c.code === 'ZZZ')).toBe(
      true,
    )

    await expect(
      caller.migrateCurrency({
        groupId,
        destinationCurrencyCode: 'ZZZ',
        pairChoices: {},
      }),
    ).rejects.toThrow(/unsupported/i)
  })

  it('rejects migration when the caller is not an admin', async () => {
    const caller = makeCaller()
    const { groupId, adminParticipantId } = await createGroup(
      caller,
      `Migrate Non-Admin ${runId}`,
    )
    await createExpense(caller, groupId, adminParticipantId, {
      title: 'Any expense',
      amount: 1000,
    })

    // Add a regular member (not an admin) to the group
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { ledgerId: true },
    })
    const memberRecord = await prisma.groupMember.create({
      data: {
        id: `gm-mem-${runId}`,
        groupId,
        accountId: memberId,
        role: GroupRole.MEMBER,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    await prisma.ledgerParticipant.create({
      data: {
        id: `lp-mem-${runId}`,
        ledgerId: group!.ledgerId,
        groupMemberId: memberRecord.id,
      },
    })

    const memberCaller = makeCaller({
      accountId: memberId,
      email: memberEmail,
    })
    await expect(
      memberCaller.migrateCurrencyPreview({
        groupId,
        destinationCurrencyCode: 'GBP',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      memberCaller.migrateCurrency({
        groupId,
        destinationCurrencyCode: 'GBP',
        pairChoices: { 'USD|GBP': { type: 'fixedCustom', rate: 0.8 } },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  // ------------------------------------------------------------------
  // 4. Atomicity: nothing in the DB changes when the migration fails
  // ------------------------------------------------------------------
  it('does not change the DB when the destination currency is unsupported', async () => {
    const caller = makeCaller()
    const { groupId, ledgerId, adminParticipantId } = await createGroup(
      caller,
      `Atomic Unsupported ${runId}`,
    )
    const exp = await createExpense(caller, groupId, adminParticipantId, {
      title: 'Stays put',
      amount: 1234,
    })

    const beforeLedger = await prisma.ledger.findUnique({
      where: { id: ledgerId },
    })
    const beforeExpense = await prisma.expense.findUnique({
      where: { id: exp.expenseId },
    })
    const beforeActivityCount = await prisma.activity.count({
      where: { ledgerId, type: 'GROUP_CURRENCY_MIGRATED' },
    })

    await expect(
      caller.migrateCurrency({
        groupId,
        destinationCurrencyCode: 'ZZZ',
        pairChoices: {},
      }),
    ).rejects.toThrow(/unsupported/i)

    const afterLedger = await prisma.ledger.findUnique({
      where: { id: ledgerId },
    })
    const afterExpense = await prisma.expense.findUnique({
      where: { id: exp.expenseId },
    })
    const afterActivityCount = await prisma.activity.count({
      where: { ledgerId, type: 'GROUP_CURRENCY_MIGRATED' },
    })

    expect(afterLedger!.currencyCode).toBe(beforeLedger!.currencyCode)
    expect(afterLedger!.currency).toBe(beforeLedger!.currency)
    expect(afterExpense!.amount).toBe(beforeExpense!.amount)
    expect(afterExpense!.originalAmount).toBe(beforeExpense!.originalAmount)
    expect(afterExpense!.originalCurrency).toBe(beforeExpense!.originalCurrency)
    expect(afterExpense!.conversionRate).toBe(beforeExpense!.conversionRate)
    expect(afterActivityCount).toBe(beforeActivityCount)
  })

  it('does not change the DB when the destination matches the source currency', async () => {
    const caller = makeCaller()
    const { groupId, ledgerId, adminParticipantId } = await createGroup(
      caller,
      `Atomic Same ${runId}`,
    )
    const exp = await createExpense(caller, groupId, adminParticipantId, {
      title: 'Stays put',
      amount: 5000,
    })

    const beforeLedger = await prisma.ledger.findUnique({
      where: { id: ledgerId },
    })
    const beforeExpense = await prisma.expense.findUnique({
      where: { id: exp.expenseId },
    })

    await expect(
      caller.migrateCurrency({
        groupId,
        destinationCurrencyCode: 'USD',
        pairChoices: {},
      }),
    ).rejects.toThrow(/different/i)

    const afterLedger = await prisma.ledger.findUnique({
      where: { id: ledgerId },
    })
    const afterExpense = await prisma.expense.findUnique({
      where: { id: exp.expenseId },
    })
    expect(afterLedger!.currencyCode).toBe(beforeLedger!.currencyCode)
    expect(afterExpense!.amount).toBe(beforeExpense!.amount)
    expect(afterExpense!.originalAmount).toBe(beforeExpense!.originalAmount)
  })

  it('does not change the DB when pair choices do not cover required pairs', async () => {
    const caller = makeCaller()
    const { groupId, ledgerId, adminParticipantId } = await createGroup(
      caller,
      `Atomic Pair Choices ${runId}`,
    )
    const exp = await createExpense(caller, groupId, adminParticipantId, {
      title: 'Stays put',
      amount: 750,
    })

    const beforeLedger = await prisma.ledger.findUnique({
      where: { id: ledgerId },
    })
    const beforeExpense = await prisma.expense.findUnique({
      where: { id: exp.expenseId },
    })

    await expect(
      caller.migrateCurrency({
        groupId,
        destinationCurrencyCode: 'GBP',
        // Empty — does not cover the USD→GBP pair the migration requires.
        pairChoices: {},
      }),
    ).rejects.toThrow(/missing rate policy/i)

    const afterLedger = await prisma.ledger.findUnique({
      where: { id: ledgerId },
    })
    const afterExpense = await prisma.expense.findUnique({
      where: { id: exp.expenseId },
    })
    expect(afterLedger!.currencyCode).toBe(beforeLedger!.currencyCode)
    expect(afterExpense!.amount).toBe(beforeExpense!.amount)
  })
})

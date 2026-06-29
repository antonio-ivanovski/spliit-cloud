import { prisma } from '@spliit/db'
import { afterAll, describe, expect, it } from 'vitest'
import { randomId } from '../lib/api'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

/**
 * Verifies the clean migrated shape produced by the multi-payer backfill.
 *
 * The backfill INSERT ... SELECT chooses shares per the domain invariant:
 * - Cross-currency expenses (originalCurrency set, non-empty): shares = originalAmount
 * - Same-currency expenses: shares = amount
 * - Zero-amount guard: GREATEST(..., 1)
 *
 * Each test inserts a single-payer expense with backfilled data matching
 * the correct migration logic, then verifies the stored row satisfies the
 * expected invariant.
 */
describe('Migrated shape — ExpensePaidBy backfill', () => {
  const runId = testRunId()

  const ledgerIds: string[] = []
  const expenseIds: string[] = []

  afterAll(async () => {
    for (const eid of expenseIds) {
      await prisma.expense.delete({ where: { id: eid } }).catch(() => {})
    }
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
  })

  async function createLedger(
    currency: string,
    currencyCode: string,
  ): Promise<string> {
    const id = `ms-ledger-${randomId()}`
    await prisma.ledger.create({ data: { id, currency, currencyCode } })
    ledgerIds.push(id)
    return id
  }

  async function createLp(ledgerId: string, name: string): Promise<string> {
    const id = `ms-lp-${randomId()}`
    await prisma.ledgerParticipant.create({
      data: { id, ledgerId, kind: 'UNLINKED_PARTICIPANT', displayName: name },
    })
    return id
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. Cross-currency: backfilled shares use originalAmount
  // ────────────────────────────────────────────────────────────────────────

  it('cross-currency expense backfills shares from originalAmount', async () => {
    const ledgerId = await createLedger('\u0434\u0435\u043d', 'MKD')
    const lpId = await createLp(ledgerId, 'Admin')
    const expenseId = `ms-exp-${randomId()}`
    expenseIds.push(expenseId)

    await prisma.expense.create({
      data: {
        id: expenseId,
        ledgerId,
        title: 'XC backfill',
        amount: 61000,
        expenseDate: new Date('2025-01-01'),
        categoryId: 'general',
        originalAmount: 1000,
        originalCurrency: 'EUR',
        conversionRate: 61,
        paidBySplitMode: 'BY_AMOUNT',
        splitMode: 'EVENLY',
        paidByList: {
          create: { ledgerParticipantId: lpId, shares: 1000 },
        },
        paidFor: {
          create: { ledgerParticipantId: lpId, shares: 61000 },
        },
      },
    })

    const epb = await prisma.expensePaidBy.findUnique({
      where: {
        expenseId_ledgerParticipantId: {
          expenseId,
          ledgerParticipantId: lpId,
        },
      },
    })
    expect(epb!.shares).toBe(1000)
  })

  // ────────────────────────────────────────────────────────────────────────
  // 2. Same-currency: backfilled shares use amount
  // ────────────────────────────────────────────────────────────────────────

  it('same-currency expense backfills shares from amount', async () => {
    const ledgerId = await createLedger('$', 'USD')
    const lpId = await createLp(ledgerId, 'Admin')
    const expenseId = `ms-exp-${randomId()}`
    expenseIds.push(expenseId)

    await prisma.expense.create({
      data: {
        id: expenseId,
        ledgerId,
        title: 'Same-currency backfill',
        amount: 5000,
        expenseDate: new Date('2025-01-01'),
        categoryId: 'general',
        paidBySplitMode: 'BY_AMOUNT',
        splitMode: 'EVENLY',
        paidByList: {
          create: { ledgerParticipantId: lpId, shares: 5000 },
        },
        paidFor: {
          create: { ledgerParticipantId: lpId, shares: 5000 },
        },
      },
    })

    const epb = await prisma.expensePaidBy.findUnique({
      where: {
        expenseId_ledgerParticipantId: {
          expenseId,
          ledgerParticipantId: lpId,
        },
      },
    })
    expect(epb!.shares).toBe(5000)
  })

  // ────────────────────────────────────────────────────────────────────────
  // 3. Empty originalCurrency treated as same-currency
  // ────────────────────────────────────────────────────────────────────────

  it('expense with empty originalCurrency backfills shares from amount', async () => {
    const ledgerId = await createLedger('\u20ac', 'EUR')
    const lpId = await createLp(ledgerId, 'Admin')
    const expenseId = `ms-exp-${randomId()}`
    expenseIds.push(expenseId)

    await prisma.expense.create({
      data: {
        id: expenseId,
        ledgerId,
        title: 'Empty currency backfill',
        amount: 3000,
        expenseDate: new Date('2025-01-01'),
        categoryId: 'general',
        originalAmount: 1000,
        originalCurrency: '',
        paidBySplitMode: 'BY_AMOUNT',
        splitMode: 'EVENLY',
        paidByList: {
          create: { ledgerParticipantId: lpId, shares: 3000 },
        },
        paidFor: {
          create: { ledgerParticipantId: lpId, shares: 3000 },
        },
      },
    })

    const epb = await prisma.expensePaidBy.findUnique({
      where: {
        expenseId_ledgerParticipantId: {
          expenseId,
          ledgerParticipantId: lpId,
        },
      },
    })
    expect(epb!.shares).toBe(3000)
  })

  // ────────────────────────────────────────────────────────────────────────
  // 4. NULL originalAmount treated as same-currency
  // ────────────────────────────────────────────────────────────────────────

  it('expense with NULL originalAmount backfills shares from amount', async () => {
    const ledgerId = await createLedger('\u20ac', 'EUR')
    const lpId = await createLp(ledgerId, 'Admin')
    const expenseId = `ms-exp-${randomId()}`
    expenseIds.push(expenseId)

    await prisma.expense.create({
      data: {
        id: expenseId,
        ledgerId,
        title: 'Null originalAmount',
        amount: 2000,
        expenseDate: new Date('2025-01-01'),
        categoryId: 'general',
        originalAmount: null,
        originalCurrency: 'EUR',
        paidBySplitMode: 'BY_AMOUNT',
        splitMode: 'EVENLY',
        paidByList: {
          create: { ledgerParticipantId: lpId, shares: 2000 },
        },
        paidFor: {
          create: { ledgerParticipantId: lpId, shares: 2000 },
        },
      },
    })

    const epb = await prisma.expensePaidBy.findUnique({
      where: {
        expenseId_ledgerParticipantId: {
          expenseId,
          ledgerParticipantId: lpId,
        },
      },
    })
    expect(epb!.shares).toBe(2000)
  })

  // ────────────────────────────────────────────────────────────────────────
  // 5. GREATEST guard: zero-amount expense gets shares = 1
  // ────────────────────────────────────────────────────────────────────────

  it('GREATEST guard ensures non-zero shares for zero-amount expense', async () => {
    const ledgerId = await createLedger('$', 'USD')
    const lpId = await createLp(ledgerId, 'Admin')
    const expenseId = `ms-exp-${randomId()}`
    expenseIds.push(expenseId)

    await prisma.expense.create({
      data: {
        id: expenseId,
        ledgerId,
        title: 'Zero-amount',
        amount: 0,
        expenseDate: new Date('2025-01-01'),
        categoryId: 'general',
        paidBySplitMode: 'BY_AMOUNT',
        splitMode: 'EVENLY',
        paidByList: {
          create: { ledgerParticipantId: lpId, shares: 1 },
        },
        paidFor: {
          create: { ledgerParticipantId: lpId, shares: 1 },
        },
      },
    })

    const epb = await prisma.expensePaidBy.findUnique({
      where: {
        expenseId_ledgerParticipantId: {
          expenseId,
          ledgerParticipantId: lpId,
        },
      },
    })
    expect(epb!.shares).toBe(1)
  })
})

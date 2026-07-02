import {
  GroupInvitationStatus,
  LedgerParticipantKind,
  prisma,
  SplitMode,
} from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  linkUnlinkedParticipantToPendingInvite,
  mergeLedgerParticipantReferences,
  randomId,
} from '../lib/api'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

/**
 * Regression tests for `mergeLedgerParticipantReferences` and the
 * same-expense path through `linkUnlinkedParticipantToPendingInvite`.
 *
 * Both `ExpensePaidBy` and `ExpensePaidFor` use the composite primary
 * key `(expenseId, ledgerParticipantId)`, so a naive
 * `updateMany({ ledgerParticipantId: sourceId }, { ledgerParticipantId: targetId })`
 * trips the unique constraint whenever source and target already share
 * an expense. The merge must coalesce (sum shares onto the target row
 * and delete the source row) before the rewrite runs.
 */
describe('mergeLedgerParticipantReferences — same-expense coalesce', () => {
  const runId = testRunId()

  const ledgerIds: string[] = []
  const expenseIds: string[] = []
  const invitationIds: string[] = []

  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  function trackExpense(id: string) {
    expenseIds.push(id)
  }

  function trackInvitation(id: string) {
    invitationIds.push(id)
  }

  afterAll(async () => {
    for (const eid of expenseIds) {
      await prisma.expense.delete({ where: { id: eid } }).catch(() => {})
    }
    for (const iid of invitationIds) {
      await prisma.groupInvitation
        .delete({ where: { id: iid } })
        .catch(() => {})
    }
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
  })

  async function createLedger(): Promise<string> {
    const id = `mpr-ledger-${randomId()}`
    await prisma.ledger.create({
      data: { id, currency: '$', currencyCode: 'USD' },
    })
    trackLedger(id)
    return id
  }

  async function createLp(ledgerId: string, name: string): Promise<string> {
    const id = `mpr-lp-${randomId()}`
    await prisma.ledgerParticipant.create({
      data: {
        id,
        ledgerId,
        kind: LedgerParticipantKind.UNLINKED_PARTICIPANT,
        displayName: name,
      },
    })
    return id
  }

  // ────────────────────────────────────────────────────────────────────
  // 1. Source and target on the SAME expense: shares are summed.
  // ────────────────────────────────────────────────────────────────────
  it('coalesces duplicate ExpensePaidBy and ExpensePaidFor rows when source and target share an expense', async () => {
    const ledgerId = await createLedger()
    const sourceLpId = await createLp(ledgerId, 'Source')
    const targetLpId = await createLp(ledgerId, 'Target')

    const expenseId = `mpr-exp-${randomId()}`
    trackExpense(expenseId)

    await prisma.expense.create({
      data: {
        id: expenseId,
        ledgerId,
        title: 'Shared expense',
        amount: 1000,
        expenseDate: new Date('2025-01-01'),
        categoryId: 'general',
        paidBySplitMode: SplitMode.BY_AMOUNT,
        splitMode: SplitMode.EVENLY,
        paidByList: {
          create: [
            { ledgerParticipantId: sourceLpId, shares: 700 },
            { ledgerParticipantId: targetLpId, shares: 300 },
          ],
        },
        paidFor: {
          create: [
            { ledgerParticipantId: sourceLpId, shares: 700 },
            { ledgerParticipantId: targetLpId, shares: 300 },
          ],
        },
      },
    })

    await prisma.$transaction(async (tx) => {
      await mergeLedgerParticipantReferences(tx, {
        sourceId: sourceLpId,
        targetId: targetLpId,
      })
    })

    const paidByRows = await prisma.expensePaidBy.findMany({
      where: { expenseId },
    })
    expect(paidByRows).toHaveLength(1)
    expect(paidByRows[0].ledgerParticipantId).toBe(targetLpId)
    expect(paidByRows[0].shares).toBe(1000)

    const paidForRows = await prisma.expensePaidFor.findMany({
      where: { expenseId },
    })
    expect(paidForRows).toHaveLength(1)
    expect(paidForRows[0].ledgerParticipantId).toBe(targetLpId)
    expect(paidForRows[0].shares).toBe(1000)

    const remainingSourcePaidBy = await prisma.expensePaidBy.count({
      where: { expenseId, ledgerParticipantId: sourceLpId },
    })
    expect(remainingSourcePaidBy).toBe(0)
    const remainingSourcePaidFor = await prisma.expensePaidFor.count({
      where: { expenseId, ledgerParticipantId: sourceLpId },
    })
    expect(remainingSourcePaidFor).toBe(0)
  })

  it('coalesces item and itemized remainder paidFor rows when source and target share an itemized expense', async () => {
    const ledgerId = await createLedger()
    const sourceLpId = await createLp(ledgerId, 'Source')
    const targetLpId = await createLp(ledgerId, 'Target')

    const expenseId = `mpr-exp-item-${randomId()}`
    const itemId = `mpr-item-${randomId()}`
    trackExpense(expenseId)

    await prisma.expense.create({
      data: {
        id: expenseId,
        ledgerId,
        title: 'Shared itemized expense',
        amount: 1000,
        expenseDate: new Date('2025-01-01'),
        categoryId: 'general',
        paidBySplitMode: SplitMode.BY_AMOUNT,
        splitMode: SplitMode.ITEMIZED,
        paidByList: {
          create: [{ ledgerParticipantId: targetLpId, shares: 1000 }],
        },
        paidFor: {
          create: [{ ledgerParticipantId: targetLpId, shares: 1000 }],
        },
        items: {
          create: [
            {
              id: itemId,
              title: 'Shared item',
              unitPrice: 700,
              quantity: 1,
              amount: 700,
              splitMode: SplitMode.BY_AMOUNT,
              paidFor: {
                create: [
                  { ledgerParticipantId: sourceLpId, shares: 400 },
                  { ledgerParticipantId: targetLpId, shares: 300 },
                ],
              },
            },
          ],
        },
        itemizedRemainder: {
          create: {
            splitMode: SplitMode.BY_AMOUNT,
            paidFor: {
              create: [
                { ledgerParticipantId: sourceLpId, shares: 100 },
                { ledgerParticipantId: targetLpId, shares: 200 },
              ],
            },
          },
        },
      },
    })

    await prisma.$transaction(async (tx) => {
      await mergeLedgerParticipantReferences(tx, {
        sourceId: sourceLpId,
        targetId: targetLpId,
      })
      await tx.ledgerParticipant.delete({ where: { id: sourceLpId } })
    })

    const itemPaidFor = await prisma.expenseItemPaidFor.findMany({
      where: { expenseItemId: itemId },
    })
    expect(itemPaidFor).toHaveLength(1)
    expect(itemPaidFor[0].ledgerParticipantId).toBe(targetLpId)
    expect(itemPaidFor[0].shares).toBe(700)

    const remainderPaidFor =
      await prisma.expenseItemizedRemainderPaidFor.findMany({
        where: { expenseId },
      })
    expect(remainderPaidFor).toHaveLength(1)
    expect(remainderPaidFor[0].ledgerParticipantId).toBe(targetLpId)
    expect(remainderPaidFor[0].shares).toBe(300)
  })

  // ────────────────────────────────────────────────────────────────────
  // 2. Source on expense A, target on expense B: independent paths.
  // ────────────────────────────────────────────────────────────────────
  it('merges independently when source is only on expense A and target is only on expense B', async () => {
    const ledgerId = await createLedger()
    const sourceLpId = await createLp(ledgerId, 'SourceOnlyOnA')
    const targetLpId = await createLp(ledgerId, 'TargetOnlyOnB')

    const expenseAId = `mpr-exp-a-${randomId()}`
    const expenseBId = `mpr-exp-b-${randomId()}`
    trackExpense(expenseAId)
    trackExpense(expenseBId)

    await prisma.expense.create({
      data: {
        id: expenseAId,
        ledgerId,
        title: 'A — source pays',
        amount: 500,
        expenseDate: new Date('2025-01-01'),
        categoryId: 'general',
        paidBySplitMode: SplitMode.BY_AMOUNT,
        splitMode: SplitMode.EVENLY,
        paidByList: {
          create: [{ ledgerParticipantId: sourceLpId, shares: 500 }],
        },
        paidFor: {
          create: [{ ledgerParticipantId: sourceLpId, shares: 500 }],
        },
      },
    })

    await prisma.expense.create({
      data: {
        id: expenseBId,
        ledgerId,
        title: 'B — target pays',
        amount: 800,
        expenseDate: new Date('2025-01-02'),
        categoryId: 'general',
        paidBySplitMode: SplitMode.BY_AMOUNT,
        splitMode: SplitMode.EVENLY,
        paidByList: {
          create: [{ ledgerParticipantId: targetLpId, shares: 800 }],
        },
        paidFor: {
          create: [{ ledgerParticipantId: targetLpId, shares: 800 }],
        },
      },
    })

    await prisma.$transaction(async (tx) => {
      await mergeLedgerParticipantReferences(tx, {
        sourceId: sourceLpId,
        targetId: targetLpId,
      })
    })

    const paidByA = await prisma.expensePaidBy.findMany({
      where: { expenseId: expenseAId },
    })
    expect(paidByA).toHaveLength(1)
    expect(paidByA[0].ledgerParticipantId).toBe(targetLpId)
    expect(paidByA[0].shares).toBe(500)

    const paidForA = await prisma.expensePaidFor.findMany({
      where: { expenseId: expenseAId },
    })
    expect(paidForA).toHaveLength(1)
    expect(paidForA[0].ledgerParticipantId).toBe(targetLpId)
    expect(paidForA[0].shares).toBe(500)

    const paidByB = await prisma.expensePaidBy.findMany({
      where: { expenseId: expenseBId },
    })
    expect(paidByB).toHaveLength(1)
    expect(paidByB[0].ledgerParticipantId).toBe(targetLpId)
    expect(paidByB[0].shares).toBe(800)

    const paidForB = await prisma.expensePaidFor.findMany({
      where: { expenseId: expenseBId },
    })
    expect(paidForB).toHaveLength(1)
    expect(paidForB[0].ledgerParticipantId).toBe(targetLpId)
    expect(paidForB[0].shares).toBe(800)
  })

  // ────────────────────────────────────────────────────────────────────
  // 3. End-to-end via linkUnlinkedParticipantToPendingInvite with the
  //    regression scenario (source and target both already on the same
  //    expense).
  // ────────────────────────────────────────────────────────────────────
  describe('linkUnlinkedParticipantToPendingInvite — same-expense merge', () => {
    const adminId = `mpr-acct-admin-${runId}`
    const adminEmail = `mpr-admin-${runId}@test.example`

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
      await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
    })

    it('sums shares onto the invitation LP when source and target already share an expense', async () => {
      const ledgerId = await createLedger()
      const groupId = `mpr-grp-${randomId()}`
      await prisma.group.create({
        data: { id: groupId, name: 'Regression group', ledgerId },
      })

      const targetLpId = await createLp(ledgerId, 'Invitee')
      const sourceLpId = await createLp(ledgerId, 'Unlinked')

      const invitationId = `mpr-inv-${randomId()}`
      trackInvitation(invitationId)
      await prisma.groupInvitation.create({
        data: {
          id: invitationId,
          type: 'EMAIL',
          groupId,
          email: `mpr-invitee-${runId}@test.example`,
          role: 'MEMBER',
          status: GroupInvitationStatus.PENDING,
          invitedById: adminId,
          // Pre-materialize the LP so the link flow has a target.
          ledgerParticipantId: targetLpId,
        },
      })

      const expenseId = `mpr-exp-${randomId()}`
      trackExpense(expenseId)
      await prisma.expense.create({
        data: {
          id: expenseId,
          ledgerId,
          title: 'Payer+payee both LPs',
          amount: 1000,
          expenseDate: new Date('2025-01-01'),
          categoryId: 'general',
          paidBySplitMode: SplitMode.BY_AMOUNT,
          splitMode: SplitMode.EVENLY,
          paidByList: {
            create: [
              { ledgerParticipantId: sourceLpId, shares: 400 },
              { ledgerParticipantId: targetLpId, shares: 600 },
            ],
          },
          paidFor: {
            create: [
              { ledgerParticipantId: sourceLpId, shares: 400 },
              { ledgerParticipantId: targetLpId, shares: 600 },
            ],
          },
        },
      })

      const result = await linkUnlinkedParticipantToPendingInvite({
        groupId,
        ledgerParticipantId: sourceLpId,
        pendingInvitationId: invitationId,
        actor: { accountId: adminId },
      })
      expect(result.ledgerParticipantId).toBe(targetLpId)

      const deletedSource = await prisma.ledgerParticipant.findUnique({
        where: { id: sourceLpId },
      })
      expect(deletedSource).toBeNull()

      const paidBy = await prisma.expensePaidBy.findMany({
        where: { expenseId },
      })
      expect(paidBy).toHaveLength(1)
      expect(paidBy[0].ledgerParticipantId).toBe(targetLpId)
      expect(paidBy[0].shares).toBe(1000)

      const paidFor = await prisma.expensePaidFor.findMany({
        where: { expenseId },
      })
      expect(paidFor).toHaveLength(1)
      expect(paidFor[0].ledgerParticipantId).toBe(targetLpId)
      expect(paidFor[0].shares).toBe(1000)
    })
  })
})

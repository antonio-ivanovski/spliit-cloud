import { expect, test } from '@playwright/test'
import { prisma } from '@spliit/db'
import { randomId } from '@spliit/domain'
import { createGroup, navigateToGroup } from '../helpers'

test.describe('Recurring Expense Instances', () => {
  test('Verify instances created for recurring expense', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `recurring verify ${randomId(4)}`,
      participants: ['Alice', 'Bob'],
    })

    // Get the first ledger participant to use as payer
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: { ledgerParticipant: true },
        },
      },
    })

    const payer = group?.members[0]?.ledgerParticipant
    expect(payer).toBeDefined()

    const ledgerParticipants = group?.members
      .map((m) => m.ledgerParticipant)
      .filter((lp): lp is NonNullable<typeof lp> => lp !== null)
    const ledgerId = group?.ledgerId
    expect(ledgerId).toBeDefined()

    // Create a recurring expense with a past date to trigger instance creation
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    yesterday.setUTCHours(0, 0, 0, 0)

    const expenseTitle = `Recurring Verify ${randomId(4)}`

    const recurringExpense = await prisma.expense.create({
      data: {
        id: `recurring-${randomId()}`,
        ledgerId: ledgerId!,
        expenseDate: yesterday,
        title: expenseTitle,
        amount: 2500,
        paidById: payer!.id,
        splitMode: 'EVENLY',
        recurrenceRule: 'DAILY',
        recurringExpenseLink: {
          create: {
            id: `link-${randomId()}`,
            ledgerId: ledgerId!,
            nextExpenseDate: yesterday,
          },
        },
        paidFor: {
          createMany: {
            data: ledgerParticipants!.map((lp) => ({
              ledgerParticipantId: lp.id,
              shares: 1,
            })),
          },
        },
      },
      include: { recurringExpenseLink: true },
    })

    // Verify only one expense exists initially
    const initialExpenseCount = await prisma.expense.count({
      where: { ledgerId: ledgerId!, title: expenseTitle },
    })
    expect(initialExpenseCount).toBe(1)

    // Navigate to the group page
    await navigateToGroup(page, groupId)

    // Verify the expense is visible
    await expect(page.getByText(expenseTitle).first()).toBeVisible()

    // Reload to trigger instance creation
    await page.reload()

    // Verify a new instance was created
    const updatedExpenseCount = await prisma.expense.count({
      where: { ledgerId: ledgerId!, title: expenseTitle },
    })
    expect(updatedExpenseCount).toBeGreaterThan(initialExpenseCount)

    // Verify the new expense has the correct date
    const newExpense = await prisma.expense.findFirst({
      where: {
        ledgerId: ledgerId!,
        title: expenseTitle,
        id: { not: recurringExpense.id },
      },
      orderBy: { createdAt: 'desc' },
    })

    expect(newExpense).toBeDefined()
    expect(newExpense!.expenseDate.getTime()).toBeGreaterThanOrEqual(
      recurringExpense.recurringExpenseLink!.nextExpenseDate.getTime(),
    )
  })

  test('Multiple recurring expenses create instances independently', async ({
    page,
  }) => {
    const groupId = await createGroup({
      page,
      groupName: `multiple recurring ${randomId(4)}`,
      participants: ['Alice', 'Bob'],
    })

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: { ledgerParticipant: true },
        },
      },
    })

    const payer = group?.members[0]?.ledgerParticipant
    expect(payer).toBeDefined()

    const ledgerParticipants = group?.members
      .map((m) => m.ledgerParticipant)
      .filter((lp): lp is NonNullable<typeof lp> => lp !== null)
    const ledgerId = group?.ledgerId
    expect(ledgerId).toBeDefined()

    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    yesterday.setUTCHours(0, 0, 0, 0)

    const expense1Title = `Recurring 1 ${randomId(4)}-1`
    const expense2Title = `Recurring 2 ${randomId(4)}-2`

    // Create two separate recurring expenses
    await prisma.expense.create({
      data: {
        id: `recurring-1-${randomId()}`,
        ledgerId: ledgerId!,
        expenseDate: yesterday,
        title: expense1Title,
        amount: 1000,
        paidById: payer!.id,
        splitMode: 'EVENLY',
        recurrenceRule: 'DAILY',
        recurringExpenseLink: {
          create: {
            id: `link-1-${randomId()}`,
            ledgerId: ledgerId!,
            nextExpenseDate: yesterday,
          },
        },
        paidFor: {
          createMany: {
            data: ledgerParticipants!.map((lp) => ({
              ledgerParticipantId: lp.id,
              shares: 1,
            })),
          },
        },
      },
    })

    await prisma.expense.create({
      data: {
        id: `recurring-2-${randomId()}`,
        ledgerId: ledgerId!,
        expenseDate: yesterday,
        title: expense2Title,
        amount: 2000,
        paidById: payer!.id,
        splitMode: 'EVENLY',
        recurrenceRule: 'WEEKLY',
        recurringExpenseLink: {
          create: {
            id: `link-2-${randomId()}`,
            ledgerId: ledgerId!,
            nextExpenseDate: yesterday,
          },
        },
        paidFor: {
          createMany: {
            data: ledgerParticipants!.map((lp) => ({
              ledgerParticipantId: lp.id,
              shares: 1,
            })),
          },
        },
      },
    })

    const initialCount1 = await prisma.expense.count({
      where: { ledgerId: ledgerId!, title: expense1Title },
    })
    const initialCount2 = await prisma.expense.count({
      where: { ledgerId: ledgerId!, title: expense2Title },
    })

    expect(initialCount1).toBe(1)
    expect(initialCount2).toBe(1)

    // Navigate to group and reload to trigger instance creation
    await navigateToGroup(page, groupId)
    await page.reload()
    await page.waitForResponse('**groups.expenses.list**')

    // Verify both expenses created new instances
    const updatedCount1 = await prisma.expense.count({
      where: { ledgerId: ledgerId!, title: expense1Title },
    })
    const updatedCount2 = await prisma.expense.count({
      where: { ledgerId: ledgerId!, title: expense2Title },
    })

    expect(updatedCount1).toBeGreaterThan(initialCount1)
    expect(updatedCount2).toBeGreaterThan(initialCount2)
  })
})

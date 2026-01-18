import { prisma } from '@/lib/prisma'
import { expect, test } from '@playwright/test'
import { createGroup, navigateToGroup } from '../helpers'

test.describe('Recurring Expense Instances', () => {
  test('Verify instances created for recurring expense', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E recurring verify ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    // Get the first participant to use as payer
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { participants: true },
    })

    const payer = group?.participants[0]
    expect(payer).toBeDefined()

    // Create a recurring expense with a past date to trigger instance creation
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    yesterday.setUTCHours(0, 0, 0, 0)

    const expenseTitle = `Recurring Verify ${Date.now()}`

    const recurringExpense = await prisma.expense.create({
      data: {
        id: `recurring-${Date.now()}`,
        groupId,
        expenseDate: yesterday,
        title: expenseTitle,
        amount: 2500,
        paidById: payer!.id,
        splitMode: 'EVENLY',
        recurrenceRule: 'DAILY',
        recurringExpenseLink: {
          create: {
            id: `link-${Date.now()}`,
            groupId,
            nextExpenseDate: yesterday,
          },
        },
        paidFor: {
          createMany: {
            data: group!.participants.map((p) => ({
              participantId: p.id,
              shares: 1,
            })),
          },
        },
      },
      include: { recurringExpenseLink: true },
    })

    // Verify only one expense exists initially
    const initialExpenseCount = await prisma.expense.count({
      where: { groupId, title: expenseTitle },
    })
    expect(initialExpenseCount).toBe(1)

    // Navigate to the group page
    await navigateToGroup(page, groupId)

    // Verify the expense is visible
    await expect(page.getByText(expenseTitle).first()).toBeVisible()

    // Reload to trigger instance creation
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Verify a new instance was created
    const updatedExpenseCount = await prisma.expense.count({
      where: { groupId, title: expenseTitle },
    })
    expect(updatedExpenseCount).toBeGreaterThan(initialExpenseCount)

    // Verify the new expense has the correct date
    const newExpense = await prisma.expense.findFirst({
      where: {
        groupId,
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
      groupName: `PW E2E multiple recurring ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { participants: true },
    })

    const payer = group?.participants[0]
    expect(payer).toBeDefined()

    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    yesterday.setUTCHours(0, 0, 0, 0)

    const expense1Title = `Recurring 1 ${Date.now()}`
    const expense2Title = `Recurring 2 ${Date.now() + 1}`

    // Create two separate recurring expenses
    await prisma.expense.create({
      data: {
        id: `recurring-1-${Date.now()}`,
        groupId,
        expenseDate: yesterday,
        title: expense1Title,
        amount: 1000,
        paidById: payer!.id,
        splitMode: 'EVENLY',
        recurrenceRule: 'DAILY',
        recurringExpenseLink: {
          create: {
            id: `link-1-${Date.now()}`,
            groupId,
            nextExpenseDate: yesterday,
          },
        },
        paidFor: {
          createMany: {
            data: group!.participants.map((p) => ({
              participantId: p.id,
              shares: 1,
            })),
          },
        },
      },
    })

    await prisma.expense.create({
      data: {
        id: `recurring-2-${Date.now()}`,
        groupId,
        expenseDate: yesterday,
        title: expense2Title,
        amount: 2000,
        paidById: payer!.id,
        splitMode: 'EVENLY',
        recurrenceRule: 'WEEKLY',
        recurringExpenseLink: {
          create: {
            id: `link-2-${Date.now()}`,
            groupId,
            nextExpenseDate: yesterday,
          },
        },
        paidFor: {
          createMany: {
            data: group!.participants.map((p) => ({
              participantId: p.id,
              shares: 1,
            })),
          },
        },
      },
    })

    const initialCount1 = await prisma.expense.count({
      where: { groupId, title: expense1Title },
    })
    const initialCount2 = await prisma.expense.count({
      where: { groupId, title: expense2Title },
    })

    expect(initialCount1).toBe(1)
    expect(initialCount2).toBe(1)

    // Navigate to group and reload to trigger instance creation
    await navigateToGroup(page, groupId)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Verify both expenses created new instances
    const updatedCount1 = await prisma.expense.count({
      where: { groupId, title: expense1Title },
    })
    const updatedCount2 = await prisma.expense.count({
      where: { groupId, title: expense2Title },
    })

    expect(updatedCount1).toBeGreaterThan(initialCount1)
    expect(updatedCount2).toBeGreaterThan(initialCount2)
  })
})

import { expect, test } from '@playwright/test'
import {
  createExpense,
  openExpenseForEdit,
  verifyExpenseRecurrence,
} from '../helpers/expense'
import { createGroup, navigateToGroup } from '../helpers'

test.describe('Recurring Expense Creation', () => {
  test('Create daily recurring expense', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E daily recurring ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    const expenseTitle = `Daily Recurring ${Date.now()}`

    await createExpense(page, {
      title: expenseTitle,
      amount: '25.00',
      payer: 'Alice',
      recurrence: 'Daily',
    })

    // Verify expense was created and is visible
    await navigateToGroup(page, groupId)
    await expect(page.getByText(expenseTitle)).toBeVisible()

    // Verify recurrence is set correctly in the edit form
    await openExpenseForEdit(page, expenseTitle)
    await verifyExpenseRecurrence(page, 'Daily')
  })

  test('Create weekly recurring expense', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E weekly recurring ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    const expenseTitle = `Weekly Recurring ${Date.now()}`

    await createExpense(page, {
      title: expenseTitle,
      amount: '50.00',
      payer: 'Bob',
      recurrence: 'Weekly',
    })

    // Verify expense was created and is visible
    await navigateToGroup(page, groupId)
    await expect(page.getByText(expenseTitle)).toBeVisible()

    // Verify recurrence is set correctly in the edit form
    await openExpenseForEdit(page, expenseTitle)
    await verifyExpenseRecurrence(page, 'Weekly')
  })

  test('Create monthly recurring expense', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E monthly recurring ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    const expenseTitle = `Monthly Recurring ${Date.now()}`

    await createExpense(page, {
      title: expenseTitle,
      amount: '100.00',
      payer: 'Charlie',
      recurrence: 'Monthly',
    })

    // Verify expense was created and is visible
    await navigateToGroup(page, groupId)
    await expect(page.getByText(expenseTitle)).toBeVisible()

    // Verify recurrence is set correctly in the edit form
    await openExpenseForEdit(page, expenseTitle)
    await verifyExpenseRecurrence(page, 'Monthly')
  })
})

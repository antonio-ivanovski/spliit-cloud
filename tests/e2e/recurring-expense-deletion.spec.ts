import { expect, test } from '@playwright/test'
import { createExpense } from '../helpers/expense'
import { createGroup, navigateToGroup } from '../helpers'

test.describe('Recurring Expense Deletion', () => {
  test('Delete single expense - other expenses remain', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E delete expense ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    const expenseTitle1 = `Expense 1 ${Date.now()}`
    const expenseTitle2 = `Expense 2 ${Date.now() + 1}`

    // Create two separate expenses
    await createExpense(page, {
      title: expenseTitle1,
      amount: '25.00',
      payer: 'Alice',
    })

    await createExpense(page, {
      title: expenseTitle2,
      amount: '30.00',
      payer: 'Bob',
    })

    // Navigate to group and verify both expenses are visible
    await navigateToGroup(page, groupId)
    await expect(page.getByText(expenseTitle1)).toBeVisible()
    await expect(page.getByText(expenseTitle2)).toBeVisible()

    // Click on first expense to edit
    await page.getByText(expenseTitle1).first().click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)
    await page.waitForLoadState('networkidle')

    // Delete the first expense
    const deleteButton = page.getByRole('button', { name: /delete/i })
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    // Confirm deletion in dialog
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const confirmDeleteButton = dialog.getByRole('button', { name: /yes/i })
    await expect(confirmDeleteButton).toBeVisible()
    await confirmDeleteButton.click()

    // Wait for navigation back to expense list
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)
    await page.waitForLoadState('networkidle')

    // Verify first expense is deleted and second remains
    await expect(page.getByText(expenseTitle1)).not.toBeVisible()
    await expect(page.getByText(expenseTitle2)).toBeVisible()
  })

  test('Delete recurring expense instance - others remain', async ({
    page,
  }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E delete recurring instance ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    const recurringTitle = `Recurring Expense ${Date.now()}`
    const regularTitle = `Regular Expense ${Date.now()}`

    // Create a recurring expense
    await createExpense(page, {
      title: recurringTitle,
      amount: '50.00',
      payer: 'Alice',
      recurrence: 'Daily',
    })

    // Create a regular expense
    await createExpense(page, {
      title: regularTitle,
      amount: '25.00',
      payer: 'Bob',
    })

    // Verify both expenses exist
    await navigateToGroup(page, groupId)
    await expect(page.getByText(recurringTitle)).toBeVisible()
    await expect(page.getByText(regularTitle)).toBeVisible()

    // Delete the recurring expense
    await page.getByText(recurringTitle).first().click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)
    await page.waitForLoadState('networkidle')

    const deleteButton = page.getByRole('button', { name: /delete/i })
    await deleteButton.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const confirmDeleteButton = dialog.getByRole('button', { name: /yes/i })
    await confirmDeleteButton.click()

    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)
    await page.waitForLoadState('networkidle')

    // Verify recurring expense is deleted but regular expense remains
    await expect(page.getByText(recurringTitle)).not.toBeVisible()
    await expect(page.getByText(regularTitle)).toBeVisible()
  })

  test('Cancel deletion dialog - expense remains', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E cancel delete ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    const expenseTitle = `Expense ${Date.now()}`

    await createExpense(page, {
      title: expenseTitle,
      amount: '40.00',
      payer: 'Alice',
    })

    await navigateToGroup(page, groupId)
    await expect(page.getByText(expenseTitle)).toBeVisible()

    // Open expense for editing
    await page.getByText(expenseTitle).first().click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Click delete button
    const deleteButton = page.getByRole('button', { name: /delete/i })
    await deleteButton.click()

    // Cancel deletion in dialog
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const cancelButton = dialog.getByRole('button', { name: /cancel|no/i })
    await expect(cancelButton).toBeVisible()
    await cancelButton.click()

    // Dialog should close and we should still be on edit page
    await expect(dialog).not.toBeVisible()
    await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Navigate back and verify expense still exists
    await page.goBack()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(expenseTitle)).toBeVisible()
  })
})

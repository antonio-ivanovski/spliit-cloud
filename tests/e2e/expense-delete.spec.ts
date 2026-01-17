import { expect, test } from '@playwright/test'
import { createExpense, createGroup, navigateToGroup } from '../helpers'

test.describe('Expense Deletion', () => {
  test('deletes expense with confirmation dialog', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Delete Test ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    await navigateToGroup(page, groupId)

    const expenseTitle = 'Expense to Delete'
    const expenseAmount = '50.00'

    await createExpense(page, {
      title: expenseTitle,
      amount: expenseAmount,
      payer: 'Alice',
    })

    // Verify expense exists
    await expect(page.getByText(expenseTitle)).toBeVisible()

    // Click expense to edit
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Click delete button
    const deleteButton = page.getByRole('button', { name: /delete/i })
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    // Verify confirmation dialog appears
    const dialogTitle = page.getByRole('heading').filter({ hasText: /delete/i })
    await expect(dialogTitle).toBeVisible()

    // Verify dialog has confirmation text
    await expect(page.getByText(/do you really want to delete/i)).toBeVisible()

    // Click confirm delete
    const confirmButton = page.getByRole('button', { name: /yes/i })
    await expect(confirmButton).toBeVisible()
    await confirmButton.click()

    // Wait for navigation back to expenses list
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Verify expense is deleted
    await expect(page.getByText(expenseTitle)).not.toBeVisible()
  })

  test('cancels deletion when clicking cancel', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Cancel Delete ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    const expenseTitle = 'Expense to Keep'
    const expenseAmount = '75.00'

    await createExpense(page, {
      title: expenseTitle,
      amount: expenseAmount,
      payer: 'Alice',
    })

    // Click expense to edit
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Click delete button
    const deleteButton = page.getByRole('button', { name: /delete/i })
    await deleteButton.click()

    // Verify confirmation dialog appears
    const dialogTitle = page.getByRole('heading').filter({ hasText: /delete/i })
    await expect(dialogTitle).toBeVisible()

    // Click cancel/no button
    const cancelButton = page.getByRole('button', { name: /no|cancel/i })
    await expect(cancelButton).toBeVisible()
    await cancelButton.click()

    // Should still be on edit page
    await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Navigate back to list
    await page.goto(`/groups/${groupId}/expenses`)

    // Verify expense still exists
    await expect(page.getByText(expenseTitle)).toBeVisible()
    await expect(page.getByText('$75.00')).toBeVisible()
  })

  test('deletes one of multiple expenses', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Multi Delete ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    await navigateToGroup(page, groupId)

    // Create multiple expenses
    const expense1 = 'First Expense'
    const expense2 = 'Second Expense'
    const expense3 = 'Third Expense'

    await createExpense(page, {
      title: expense1,
      amount: '100.00',
      payer: 'Alice',
    })

    await createExpense(page, {
      title: expense2,
      amount: '200.00',
      payer: 'Bob',
    })

    await createExpense(page, {
      title: expense3,
      amount: '300.00',
      payer: 'Charlie',
    })

    // Verify all expenses exist
    await expect(page.getByText(expense1)).toBeVisible()
    await expect(page.getByText(expense2)).toBeVisible()
    await expect(page.getByText(expense3)).toBeVisible()

    // Delete the second expense
    await page.getByText(expense2).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    const deleteButton = page.getByRole('button', { name: /delete/i })
    await deleteButton.click()

    const confirmButton = page.getByRole('button', { name: /yes/i })
    await confirmButton.click()

    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Verify only the deleted expense is gone
    await expect(page.getByText(expense1)).toBeVisible()
    await expect(page.getByText(expense2)).not.toBeVisible()
    await expect(page.getByText(expense3)).toBeVisible()

    // Verify amounts of remaining expenses
    await expect(page.getByText('$100.00')).toBeVisible()
    await expect(page.getByText('$200.00')).not.toBeVisible()
    await expect(page.getByText('$300.00')).toBeVisible()
  })

  test('deletes reimbursement expense', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Delete Reimbursement ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    // First create a regular expense
    await createExpense(page, {
      title: 'Regular Expense',
      amount: '200.00',
      payer: 'Alice',
    })

    // Create reimbursement
    await createExpense(page, {
      title: 'Reimbursement to Delete',
      amount: '100.00',
      payer: 'Bob',
      isReimbursement: true,
    })

    const reimbursementTitle = 'Reimbursement to Delete'
    await expect(page.getByText(reimbursementTitle)).toBeVisible()

    // Delete the reimbursement
    await page.getByText(reimbursementTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    const deleteButton = page.getByRole('button', { name: /delete/i })
    await deleteButton.click()

    const confirmButton = page.getByRole('button', { name: /yes/i })
    await confirmButton.click()

    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Verify reimbursement is deleted but regular expense remains
    await expect(page.getByText(reimbursementTitle)).not.toBeVisible()
    await expect(page.getByText('Regular Expense')).toBeVisible()
  })

  test('delete button is visible in edit form', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Delete Button ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    const expenseTitle = 'Check Delete Button'

    await createExpense(page, {
      title: expenseTitle,
      amount: '25.00',
      payer: 'Alice',
    })

    // Click expense to edit
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Verify delete button is visible and properly styled
    const deleteButton = page.getByRole('button', { name: /delete/i })
    await expect(deleteButton).toBeVisible()
    await expect(deleteButton).toBeEnabled()
  })
})

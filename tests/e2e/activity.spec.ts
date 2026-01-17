import { expect, test } from '@playwright/test'
import {
  createExpense,
  createExpensesViaAPI,
  createGroup,
  navigateToGroup,
  navigateToTab,
} from '../helpers'

test('View activity page', async ({ page }) => {
  // Setup: Create group with 3 participants and immediately create an expense
  // (if group has no activity, the page shows empty state which doesn't have activity-list testid)
  const groupId = await createGroup({
    page,
    groupName: `PW E2E activity test ${Date.now()}`,
    participants: ['Alice', 'Bob', 'Charlie'],
  })
  await navigateToGroup(page, groupId)

  // Create an expense so activity list will be populated
  await createExpense(page, {
    title: 'Activity Test Expense',
    amount: '10.00',
    payer: 'Alice',
  })

  // Navigate to Activity tab
  await navigateToTab(page, 'Activity')

  // Verify Activity page loads with correct heading
  const activityHeading = page.getByRole('heading', {
    name: 'Activity',
    exact: true,
  })
  await expect(activityHeading).toBeVisible()

  // Since we created an expense, activity-list should be visible (not empty state)
  const activityListWrapper = page.getByTestId('activity-list')
  await expect(activityListWrapper).toBeVisible()

  // Verify the test expense appears in the list
  await expect(page.getByText('Activity Test Expense')).toBeVisible()
})

test('Log shows create', async ({ page }) => {
  // Setup: Create group with 2 participants and expense
  const groupName = `PW E2E activity create ${Date.now()}`
  const expenseTitle = `Test Expense ${Date.now()}`
  const expenseAmount = '25.00'

  const groupId = await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob'],
  })

  await createExpense(page, {
    title: expenseTitle,
    amount: expenseAmount,
    payer: 'Alice',
  })

  // Navigate to Activity tab
  await navigateToTab(page, 'Activity')

  // Verify activity list wrapper is visible
  const activityListWrapper = page.getByTestId('activity-list')
  await expect(activityListWrapper).toBeVisible()

  // Verify expense title appears in activity
  await expect(page.getByText(expenseTitle)).toBeVisible()

  // Verify "created" action text appears in activity (e.g., "Alice created Test Expense")
  await expect(page.getByText(/created/i)).toBeVisible()
})

test('Log shows update', async ({ page }) => {
  // Setup: Create group and expense
  const groupName = `PW E2E activity update ${Date.now()}`
  const expenseTitle = `Update Test Expense ${Date.now()}`
  const updatedTitle = `Updated Expense ${Date.now()}`
  const originalAmount = '30.00'
  const updatedAmount = '50.00'

  const groupId = await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob'],
  })

  await navigateToGroup(page, groupId)

  await createExpense(page, {
    title: expenseTitle,
    amount: originalAmount,
    payer: 'Alice',
  })

  // Wait for the expense to be visible and clickable
  const expenseRow = page.getByText(expenseTitle)
  await expect(expenseRow).toBeVisible()
  await page.waitForTimeout(500) // Brief pause to ensure DOM is stable

  // Click on the expense to open edit page
  await expenseRow.click()
  await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

  // Update the expense title
  const titleInput = page.locator('input[name="title"]')
  await expect(titleInput).toBeVisible()
  await titleInput.clear()
  await titleInput.fill(updatedTitle)

  // Update the amount
  const amountInput = page.locator('input[name="amount"]')
  await expect(amountInput).toBeVisible()
  await amountInput.clear()
  await amountInput.fill(updatedAmount)

  // Submit the form using semantic role selector
  const submitButton = page.getByRole('button', { name: /save|update/i })
  await expect(submitButton).toBeVisible()
  await submitButton.click()

  // Wait for navigation back to group page
  await page.waitForURL(/\/groups\/[^/]+/)

  // Navigate to Activity tab to verify update was logged
  // Note: After editing and saving, ensure we're on the expenses page first
  await page.waitForURL(/\/groups\/[^/]+\/expenses$/, { timeout: 10000 })
  await navigateToTab(page, 'Activity')

  // Wait for updated expense title to appear in activity
  await expect(page.getByText(updatedTitle)).toBeVisible()

  // Verify "updated" or "edit" action text appears (e.g., "Alice updated Updated Expense")
  await expect(page.getByText(/updated|edit/i)).toBeVisible()
})

test('Log shows delete', async ({ page }) => {
  // Setup: Create group and expense
  const groupName = `PW E2E activity delete ${Date.now()}`
  const expenseTitle = `Delete Test Expense ${Date.now()}`

  const groupId = await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob'],
  })

  await navigateToGroup(page, groupId)

  await createExpense(page, {
    title: expenseTitle,
    amount: '40.00',
    payer: 'Bob',
  })

  // Click on the expense to open edit page
  await page.getByText(expenseTitle).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

  // Click delete button
  const deleteButton = page.getByRole('button', { name: /delete/i })
  await expect(deleteButton).toBeVisible()
  await deleteButton.click()

  // Verify confirmation dialog appears - wait for the dialog heading with "delete"
  const deleteDialogTitle = page
    .getByRole('heading')
    .filter({ hasText: /delete/i })
  await expect(deleteDialogTitle).toBeVisible()

  // Click confirm delete button using the button with "Yes" text
  const confirmButton = page.getByRole('button', { name: /yes/i })
  await expect(confirmButton).toBeVisible()
  await confirmButton.click()

  // Wait for navigation back to group page
  await page.waitForURL(/\/groups\/[^/]+/)

  // Verify expense is no longer visible in the main list
  await expect(page.getByText(expenseTitle)).not.toBeVisible()

  // Navigate to Activity tab to verify delete was logged
  await navigateToTab(page, 'Activity')

  // Verify delete action text appears in activity
  // The activity list component renders the delete activity with the word "deleted"
  const deleteActivity = page.getByText(/deleted/i)
  await expect(deleteActivity).toBeVisible()
})

test('Log pagination', async ({ page }) => {
  // Setup: Create group and many expenses to trigger pagination
  const groupName = `PW E2E activity pagination ${Date.now()}`
  const numExpenses = 25

  const groupId = await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob'],
  })

  await navigateToGroup(page, groupId)

  // Create 25 expenses via API to populate activity log
  const createdExpenses = await createExpensesViaAPI(page, groupId, numExpenses)
  expect(createdExpenses).toHaveLength(numExpenses)

  // Navigate to Activity tab
  await navigateToTab(page, 'Activity')

  // Verify activity list is loaded
  const activityListWrapper = page.getByTestId('activity-list')
  await expect(activityListWrapper).toBeVisible()

  // Verify the most recent expense appears (last in array)
  const mostRecentExpense = createdExpenses[createdExpenses.length - 1]
  await expect(page.getByText(mostRecentExpense)).toBeVisible()

  // Scroll down to trigger infinite scroll pagination
  await page.mouse.wheel(0, 1000)
  await page.waitForLoadState('networkidle')

  // Verify all created expenses are loaded after scrolling
  for (const expenseTitle of createdExpenses) {
    await expect(page.getByText(expenseTitle)).toBeVisible()
  }
})

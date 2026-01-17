import { expect, test } from '@playwright/test'
import {
  createExpense,
  createGroup,
  navigateToExpenseCreate,
  navigateToGroup,
} from '../helpers'

test.describe('Expense Creation', () => {
  test('creates basic expense with correct values', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Expense Create ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    await navigateToGroup(page, groupId)

    const expenseTitle = 'Dinner at Restaurant'
    const expenseAmount = '150.00'

    await createExpense(page, {
      title: expenseTitle,
      amount: expenseAmount,
      payer: 'Alice',
    })

    // Verify expense appears in list with correct title
    const expenseCard = page.getByText(expenseTitle)
    await expect(expenseCard).toBeVisible()

    // Verify amount is displayed correctly (formatted with currency)
    await expect(page.getByText('$150.00')).toBeVisible()

    // Verify payer info is shown
    await expect(page.getByText(/paid by/i).first()).toBeVisible()
  })

  test('creates expense with category', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Category Test ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)
    await navigateToExpenseCreate(page)

    const expenseTitle = 'Grocery Shopping'
    const expenseAmount = '85.50'

    // Fill expense form
    await page.locator('input[name="title"]').fill(expenseTitle)
    await page.locator('input[name="amount"]').fill(expenseAmount)

    // Select payer
    const paidBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await paidBySelect.click()
    await page.getByRole('option', { name: 'Alice' }).click()

    // Select category (Food & Drink)
    const categorySelect = page
      .getByRole('combobox')
      .filter({ hasText: /general/i })
    if (await categorySelect.isVisible()) {
      await categorySelect.click()
      const foodOption = page.getByRole('option', { name: /food|groceries/i })
      if (await foodOption.count()) {
        await foodOption.first().click()
      }
    }

    // Submit
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Verify expense created
    await expect(page.getByText(expenseTitle)).toBeVisible()
    await expect(page.getByText('$85.50')).toBeVisible()
  })

  test('creates expense with specific date', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Date Test ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)
    await navigateToExpenseCreate(page)

    const expenseTitle = 'Historical Expense'
    const expenseAmount = '50.00'
    const testDate = '2024-06-15'

    // Fill expense form
    await page.locator('input[name="title"]').fill(expenseTitle)
    await page.locator('input[name="amount"]').fill(expenseAmount)

    // Select payer
    const paidBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await paidBySelect.click()
    await page.getByRole('option', { name: 'Alice' }).click()

    // Set date
    await page.locator('input[type="date"]').fill(testDate)

    // Submit
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Verify expense created
    await expect(page.getByText(expenseTitle)).toBeVisible()

    // Click to edit and verify date was saved
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    const dateInput = page.locator('input[type="date"]')
    await expect(dateInput).toHaveValue(testDate)
  })

  test('creates expense with notes', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Notes Test ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)
    await navigateToExpenseCreate(page)

    const expenseTitle = 'Expense with Notes'
    const expenseAmount = '75.00'
    const expenseNotes = 'This is a test note for the expense'

    // Fill expense form
    await page.locator('input[name="title"]').fill(expenseTitle)
    await page.locator('input[name="amount"]').fill(expenseAmount)

    // Select payer
    const paidBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await paidBySelect.click()
    await page.getByRole('option', { name: 'Alice' }).click()

    // Add notes
    await page.locator('textarea').fill(expenseNotes)

    // Submit
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Verify expense created
    await expect(page.getByText(expenseTitle)).toBeVisible()

    // Click to edit and verify notes were saved
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    const notesTextarea = page.locator('textarea')
    await expect(notesTextarea).toHaveValue(expenseNotes)
  })

  test('creates reimbursement expense', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Reimbursement Test ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    await navigateToGroup(page, groupId)

    // First create a regular expense
    await createExpense(page, {
      title: 'Initial Expense',
      amount: '300.00',
      payer: 'Alice',
    })

    // Create reimbursement
    await navigateToExpenseCreate(page)

    const reimbursementTitle = 'Bob pays Alice'
    const reimbursementAmount = '100.00'

    await page.locator('input[name="title"]').fill(reimbursementTitle)
    await page.locator('input[name="amount"]').fill(reimbursementAmount)

    // Select Bob as payer
    const paidBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await paidBySelect.click()
    await page.getByRole('option', { name: 'Bob' }).click()

    // Check reimbursement checkbox
    const reimbursementCheckbox = page.getByRole('checkbox', {
      name: /reimbursement/i,
    })
    await reimbursementCheckbox.check()

    // Submit
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Verify reimbursement created (should appear in italics)
    await expect(page.getByText(reimbursementTitle)).toBeVisible()
    await expect(page.getByText('$100.00')).toBeVisible()
  })

  test('verifies expense data persists after creation', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Persistence Test ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    await navigateToGroup(page, groupId)

    const expenseTitle = 'Persistence Check'
    const expenseAmount = '123.45'
    const expenseNotes = 'Checking data persistence'
    const expenseDate = '2024-07-20'

    await navigateToExpenseCreate(page)

    // Fill all fields
    await page.locator('input[name="title"]').fill(expenseTitle)
    await page.locator('input[name="amount"]').fill(expenseAmount)
    await page.locator('input[type="date"]').fill(expenseDate)
    await page.locator('textarea').fill(expenseNotes)

    // Select payer
    const paidBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await paidBySelect.click()
    await page.getByRole('option', { name: 'Bob' }).click()

    // Submit
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Click to open edit form
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Verify all values persisted correctly
    await expect(page.locator('input[name="title"]')).toHaveValue(expenseTitle)
    await expect(page.locator('input[name="amount"]')).toHaveValue(
      expenseAmount,
    )
    await expect(page.locator('input[type="date"]')).toHaveValue(expenseDate)
    await expect(page.locator('textarea')).toHaveValue(expenseNotes)

    // Verify payer selection persisted (Bob should be selected)
    // The payer combobox shows the participant name when selected
    await expect(
      page.getByRole('combobox').filter({ hasText: 'Bob' }),
    ).toBeVisible()
  })
})

import { expect, test } from '@playwright/test'
import { createExpense, createGroup, navigateToGroup } from '../helpers'

test.describe('Expense Editing', () => {
  test('updates expense title and amount', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Edit Test ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    await navigateToGroup(page, groupId)

    const originalTitle = 'Original Expense'
    const originalAmount = '100.00'

    await createExpense(page, {
      title: originalTitle,
      amount: originalAmount,
      payer: 'Alice',
    })

    // Click expense to edit
    await page.getByText(originalTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Update title
    const newTitle = 'Updated Expense Title'
    const titleInput = page.locator('input[name="title"]')
    await titleInput.clear()
    await titleInput.fill(newTitle)

    // Update amount
    const newAmount = '250.00'
    const amountInput = page.locator('input[name="amount"]')
    await amountInput.clear()
    await amountInput.fill(newAmount)

    // Submit
    const saveButton = page.getByRole('button', { name: /save/i })
    await saveButton.click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Verify updated values in list
    await expect(page.getByText(newTitle)).toBeVisible()
    await expect(page.getByText('$250.00')).toBeVisible()
    await expect(page.getByText(originalTitle)).not.toBeVisible()
  })

  test('updates expense payer', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Payer Update ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    await navigateToGroup(page, groupId)

    const expenseTitle = 'Payer Change Test'

    await createExpense(page, {
      title: expenseTitle,
      amount: '60.00',
      payer: 'Alice',
    })

    // Click expense to edit
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Change payer from Alice to Bob
    const payerSelect = page.getByRole('combobox').filter({ hasText: 'Alice' })
    await payerSelect.click()
    await page.getByRole('option', { name: 'Bob' }).click()

    // Submit
    const saveButton = page.getByRole('button', { name: /save/i })
    await saveButton.click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Verify payer updated in list
    const expenseCard = page.getByText(expenseTitle).locator('..')
    await expect(page.getByText(/Bob/)).toBeVisible()
  })

  test('updates expense date', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Date Update ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    const expenseTitle = 'Date Change Test'
    const originalDate = '2024-05-15'
    const newDate = '2024-06-20'

    await createExpense(page, {
      title: expenseTitle,
      amount: '45.00',
      payer: 'Alice',
      date: originalDate,
    })

    // Click expense to edit
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Verify original date
    await expect(page.locator('input[type="date"]')).toHaveValue(originalDate)

    // Update date
    await page.locator('input[type="date"]').fill(newDate)

    // Submit
    const saveButton = page.getByRole('button', { name: /save/i })
    await saveButton.click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Click again to verify date was saved
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)
    await expect(page.locator('input[type="date"]')).toHaveValue(newDate)
  })

  test('updates expense notes', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Notes Update ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    const expenseTitle = 'Notes Update Test'
    const originalNotes = 'Original notes content'
    const newNotes = 'Updated notes with new information'

    await createExpense(page, {
      title: expenseTitle,
      amount: '30.00',
      payer: 'Alice',
      notes: originalNotes,
    })

    // Click expense to edit
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Verify original notes
    await expect(page.locator('textarea')).toHaveValue(originalNotes)

    // Update notes
    const notesTextarea = page.locator('textarea')
    await notesTextarea.clear()
    await notesTextarea.fill(newNotes)

    // Submit
    const saveButton = page.getByRole('button', { name: /save/i })
    await saveButton.click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Click again to verify notes were saved
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)
    await expect(page.locator('textarea')).toHaveValue(newNotes)
  })

  test('updates all fields simultaneously', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Full Update ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    await navigateToGroup(page, groupId)

    // Create initial expense
    const originalTitle = 'Initial Full Test'
    await createExpense(page, {
      title: originalTitle,
      amount: '100.00',
      payer: 'Alice',
      notes: 'Original notes',
    })

    // Click expense to edit
    await page.getByText(originalTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Update all fields
    const newTitle = 'Completely Updated Expense'
    const newAmount = '350.00'
    const newDate = '2024-08-10'
    const newNotes = 'Completely new notes'

    await page.locator('input[name="title"]').clear()
    await page.locator('input[name="title"]').fill(newTitle)

    await page.locator('input[name="amount"]').clear()
    await page.locator('input[name="amount"]').fill(newAmount)

    await page.locator('input[type="date"]').fill(newDate)

    await page.locator('textarea').clear()
    await page.locator('textarea').fill(newNotes)

    // Change payer
    const payerSelect = page.getByRole('combobox').filter({ hasText: 'Alice' })
    await payerSelect.click()
    await page.getByRole('option', { name: 'Charlie' }).click()

    // Submit
    const saveButton = page.getByRole('button', { name: /save/i })
    await saveButton.click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Verify in list
    await expect(page.getByText(newTitle)).toBeVisible()
    await expect(page.getByText('$350.00')).toBeVisible()
    await expect(page.getByText(originalTitle)).not.toBeVisible()

    // Click to verify all values persisted
    await page.getByText(newTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    await expect(page.locator('input[name="title"]')).toHaveValue(newTitle)
    // Amount may lose trailing zeros
    await expect(page.locator('input[name="amount"]')).toHaveValue(/350(\.00)?/)
    await expect(page.locator('input[type="date"]')).toHaveValue(newDate)
    await expect(page.locator('textarea')).toHaveValue(newNotes)
    await expect(
      page.getByRole('combobox').filter({ hasText: 'Charlie' }),
    ).toBeVisible()
  })

  test('toggles reimbursement status', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Reimbursement Toggle ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    const expenseTitle = 'Reimbursement Toggle Test'

    await createExpense(page, {
      title: expenseTitle,
      amount: '75.00',
      payer: 'Alice',
    })

    // Click expense to edit
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    // Check reimbursement
    const reimbursementCheckbox = page.getByRole('checkbox', {
      name: /reimbursement/i,
    })
    await expect(reimbursementCheckbox).not.toBeChecked()
    await reimbursementCheckbox.check()
    await expect(reimbursementCheckbox).toBeChecked()

    // Submit
    const saveButton = page.getByRole('button', { name: /save/i })
    await saveButton.click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses$/)

    // Click again to verify reimbursement status persisted
    await page.getByText(expenseTitle).click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

    await expect(
      page.getByRole('checkbox', { name: /reimbursement/i }),
    ).toBeChecked()
  })
})

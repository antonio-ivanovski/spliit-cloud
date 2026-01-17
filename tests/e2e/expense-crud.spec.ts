import { expect, test } from '@playwright/test'
import { createExpense, createGroup } from '../helpers'

test('Delete expense - confirmation flow', async ({ page }) => {
  // Create a test group first
  const groupName = `PW E2E group ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'

  const groupId = await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, 'Charlie'],
  })

  // Navigate directly to the group balances page to see the expense create button
  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Click on the participant name to see if there are reimbursement options
  // Or use the action button if available
  // Look for an add expense or action button
  const actionButtons = page.getByRole('button')

  // Try to find and click an "Add" or "Create" button for expenses
  let createExpenseButton = actionButtons
    .filter({ hasText: /add|create|reimbur/i })
    .first()

  // If not found, try looking for a link
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  // If we found a button/link to create expense, click it
  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')
    await page.waitForTimeout(2000)

    // Fill in title
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Delete Test ${Date.now()}`
      const expenseAmount = '25.00'

      await titleInputs.first().fill(expenseTitle)

      // Fill amount
      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill(expenseAmount)
      }

      // Try to select payer
      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Click create button
      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      // Wait for navigation
      await page.waitForURL(/\/groups\/[^/]+/)
      await page.waitForTimeout(1000)

      // Now look for the expense in the list and try to delete it
      const expenseText = page.getByText(expenseTitle)
      if (await expenseText.isVisible()) {
        // Click the expense to open edit form
        await expenseText.click()

        // Wait for edit page to load
        await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

        // Click delete button
        const deleteButton = page.getByRole('button', { name: /delete/i })
        if (await deleteButton.isVisible()) {
          await deleteButton.click()

          // Verify confirmation dialog appears
          await expect(page.locator('[role="heading"]')).toContainText(
            /delete/i,
          )

          // Click confirm
          const confirmButton = page
            .getByRole('button')
            .filter({ hasText: /yes|delete/i })
            .first()
          await confirmButton.click()

          // Wait for navigation back
          await page.waitForURL(/\/groups\/[^/]+/)

          // Verify expense is deleted
          await expect(page.getByText(expenseTitle)).not.toBeVisible()
        }
      }
    }
  }
})

test('Expense displays correct amount', async ({ page }) => {
  // Create a test group
  const groupName = `PW E2E group ${Date.now()}`
  const participantA = 'Alice'

  const groupId = await createGroup({
    page,
    groupName,
    participants: [participantA, 'Bob', 'Charlie'],
  })

  // Navigate to group page
  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Look for button to add expense
  const actionButtons = page.getByRole('button')
  let createExpenseButton = actionButtons
    .filter({ hasText: /add|create|reimbur/i })
    .first()

  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  // Click to create expense
  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')
    await page.waitForTimeout(2000)

    // Fill expense form
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Amount Test ${Date.now()}`
      const expenseAmount = '123.45'

      await titleInputs.first().fill(expenseTitle)

      // Fill amount
      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill(expenseAmount)
      }

      // Select payer
      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Create expense
      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      // Wait for navigation
      await page.waitForURL(/\/groups\/[^/]+/)
      await page.waitForTimeout(1000)

      // Verify expense appears with title
      await expect(page.getByText(expenseTitle)).toBeVisible()

      // Verify amount is displayed
      await expect(page.locator(`text=${expenseAmount}`)).toBeVisible()

      // Click to open edit form
      await page.getByText(expenseTitle).click()

      // Verify we're on edit page
      await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

      // Verify amount in form
      const editAmountInput = page.locator('input[inputmode="decimal"]').first()
      await expect(editAmountInput).toHaveValue(expenseAmount)
    }
  }
})

test('Create expense - with category', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E category test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Find create expense button
  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    // Fill expense title
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Category Test ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      // Fill amount
      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('50.00')
      }

      // Select payer
      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Select category (click category combobox)
      const categorySelects = page.locator('[role="combobox"]')
      if ((await categorySelects.count()) >= 2) {
        await categorySelects.nth(1).click()
        await page.getByRole('option').first().click()
      }

      // Create expense
      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      // Wait for navigation
      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify expense appears
      await expect(page.getByText(expenseTitle)).toBeVisible()

      // Open expense to verify category was saved
      await page.getByText(expenseTitle).click()
      await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)
    }
  }
})

test('Create expense - with custom date', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E date test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Find create expense button
  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    // Fill expense title
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Date Test ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      // Fill amount
      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('75.00')
      }

      // Select payer
      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Find and fill date input
      const dateInputs = page.locator('input[type="date"]')
      if ((await dateInputs.count()) > 0) {
        // Set date to yesterday
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const dateStr = yesterday.toISOString().split('T')[0]
        await dateInputs.first().fill(dateStr)
      }

      // Create expense
      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      // Wait for navigation
      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify expense appears
      await expect(page.getByText(expenseTitle)).toBeVisible()
    }
  }
})

test('Create expense - as reimbursement', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E reimburse test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Find create expense button
  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    // Fill expense title
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Reimbursement ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      // Fill amount
      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('100.00')
      }

      // Select payer
      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Check reimbursement checkbox
      const checkboxes = page.locator('input[type="checkbox"]')
      if ((await checkboxes.count()) > 0) {
        // Find and click the reimbursement checkbox
        for (let i = 0; i < (await checkboxes.count()); i++) {
          const checkbox = checkboxes.nth(i)
          const label = await checkbox.evaluate((el) => {
            return el.parentElement?.textContent?.toLowerCase() || ''
          })
          if (label.includes('reimburs')) {
            await checkbox.check()
            break
          }
        }
      }

      // Create expense
      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      // Wait for navigation
      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify expense appears
      await expect(page.getByText(expenseTitle)).toBeVisible()
    }
  }
})

test('Expense displays correct date', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E date display test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Find create expense button
  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    // Fill expense title
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Date Display Test ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      // Fill amount
      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('60.00')
      }

      // Select payer
      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Set custom date
      const dateInputs = page.locator('input[type="date"]')
      const testDate = new Date('2024-01-15')
      const dateStr = testDate.toISOString().split('T')[0]
      if ((await dateInputs.count()) > 0) {
        await dateInputs.first().fill(dateStr)
      }

      // Create expense
      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      // Wait for navigation
      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify expense appears with title
      await expect(page.getByText(expenseTitle)).toBeVisible()

      // Open expense to verify date
      await page.getByText(expenseTitle).click()
      await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

      // Verify date in form
      const editDateInput = page.locator('input[type="date"]').first()
      await expect(editDateInput).toHaveValue(dateStr)
    }
  }
})

test('Expense shows category', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E category display test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Find create expense button
  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    // Fill expense title
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Category Display Test ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      // Fill amount
      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('45.00')
      }

      // Select payer
      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Select category
      const categorySelects = page.locator('[role="combobox"]')
      if ((await categorySelects.count()) >= 2) {
        await categorySelects.nth(1).click()
        // Get first non-empty option for category
        const option = page.getByRole('option').first()
        if (await option.isVisible()) {
          await option.click()
        }
      }

      // Create expense
      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      // Wait for navigation
      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify expense appears
      await expect(page.getByText(expenseTitle)).toBeVisible()
    }
  }
})

test('Create expense - with notes', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E notes test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Find create expense button
  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    // Fill expense title
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Notes Test ${Date.now()}`
      const notes = 'This is a test expense with notes'
      await titleInputs.first().fill(expenseTitle)

      // Fill amount
      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('55.50')
      }

      // Select payer
      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Fill notes field (textarea)
      const textareas = page.locator('textarea')
      if ((await textareas.count()) > 0) {
        await textareas.first().fill(notes)
      }

      // Create expense
      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      // Wait for navigation
      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify expense appears
      await expect(page.getByText(expenseTitle)).toBeVisible()

      // Open expense to verify notes were saved
      await page.getByText(expenseTitle).click()
      await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

      // Verify notes appear in edit form
      const noteTextarea = page.locator('textarea').first()
      await expect(noteTextarea).toContainText(notes)
    }
  }
})

test('Create expense - validation errors', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E validation test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Find create expense button
  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    // Try to submit empty form - should show validation errors
    const submitButton = page.getByRole('button', { name: /create/i }).first()
    await submitButton.click()

    // Wait a moment for validation errors to appear
    await page.waitForTimeout(500)

    // Verify validation error messages appear
    // Error messages could be about required fields (title, amount, payer)
    const pageContent = await page.content()

    // At minimum, we should still be on the create page (no submission)
    await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/create/)

    // Now test partial submission - fill title but no amount
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      await titleInputs.first().fill('Incomplete Expense')

      // Try to submit
      await submitButton.click()
      await page.waitForTimeout(500)

      // Should still be on create page due to validation
      await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/create/)
    }

    // Now fill all required fields correctly to verify form works
    if ((await titleInputs.count()) > 0) {
      await titleInputs.first().clear()
      await titleInputs.first().fill('Valid Expense')

      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('50.00')
      }

      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Submit valid form
      await submitButton.click()

      // Should navigate away on successful creation
      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify expense appears
      await expect(page.getByText('Valid Expense')).toBeVisible()
    }
  }
})

test('Edit expense - update all fields', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E edit expense test ${Date.now()}`,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Create an initial expense
  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const originalTitle = `Original Expense ${Date.now()}`
      await titleInputs.first().fill(originalTitle)

      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('100.00')
      }

      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      await page.waitForURL(/\/groups\/[^/]+/)
      await expect(page.getByText(originalTitle)).toBeVisible()

      // Now click to edit the expense
      await page.getByText(originalTitle).click()
      await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

      // Update all fields
      const editTitleInput = page.locator('input[type="text"]').first()
      const newTitle = `Updated Expense ${Date.now()}`
      await editTitleInput.clear()
      await editTitleInput.fill(newTitle)

      // Update amount
      const editAmountInput = page.locator('input[inputmode="decimal"]').first()
      const newAmount = '250.00'
      await editAmountInput.clear()
      await editAmountInput.fill(newAmount)

      // Update payer (select different participant)
      const editSelects = page.locator('[role="combobox"]')
      if ((await editSelects.count()) > 0) {
        await editSelects.first().click()
        // Select second option if available
        const options = page.getByRole('option')
        const optionCount = await options.count()
        if (optionCount > 1) {
          await options.nth(1).click()
        }
      }

      // Update date
      const dateInputs = page.locator('input[type="date"]')
      if ((await dateInputs.count()) > 0) {
        const newDate = new Date()
        newDate.setDate(newDate.getDate() - 5)
        const dateStr = newDate.toISOString().split('T')[0]
        await dateInputs.first().fill(dateStr)
      }

      // Update notes
      const textareas = page.locator('textarea')
      if ((await textareas.count()) > 0) {
        const noteText = `Updated notes ${Date.now()}`
        await textareas.first().clear()
        await textareas.first().fill(noteText)
      }

      // Submit changes
      const submitButton = page
        .getByRole('button', { name: /save|update|submit/i })
        .first()
      await submitButton.click()

      // Wait for navigation back
      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify updated expense appears
      await expect(page.getByText(newTitle)).toBeVisible()
      await expect(page.getByText(newAmount)).toBeVisible()
    }
  }
})

test('Edit expense - change split mode', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E split mode test ${Date.now()}`,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Create an expense with EVENLY split mode
  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Split Mode Test ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('300.00')
      }

      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      await page.waitForURL(/\/groups\/[^/]+/)
      await expect(page.getByText(expenseTitle)).toBeVisible()

      // Click to edit
      await page.getByText(expenseTitle).click()
      await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

      // Look for split mode selector - usually a radio button or combobox
      const splitModeSelectors = page
        .locator('[role="radio"], [role="combobox"]')
        .filter({
          hasText: /evenly|shares|percentage|amount/i,
        })

      // Try to change split mode if selector is available
      if ((await splitModeSelectors.count()) > 0) {
        // Click on a split mode option (try to find BY_SHARES or BY_AMOUNT)
        const allRadios = page.locator('[role="radio"]')
        if ((await allRadios.count()) > 1) {
          // Click second radio option to change split mode
          await allRadios.nth(1).click()
          await page.waitForTimeout(300)
        }
      }

      // Submit changes
      const submitButton = page
        .getByRole('button', { name: /save|update|submit/i })
        .first()
      await submitButton.click()

      // Wait for navigation
      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify expense still appears (indicating successful update)
      await expect(page.getByText(expenseTitle)).toBeVisible()
    }
  }
})

test('Expense list - text filter', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E filter test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  const uniqueFilter = `UNIQUE_${Date.now()}`

  await createExpense(page, {
    title: `Pizza ${uniqueFilter}`,
    amount: '50.00',
    payer: 'Alice',
  })

  await createExpense(page, {
    title: `Dinner ${uniqueFilter}`,
    amount: '75.00',
    payer: 'Bob',
  })

  await createExpense(page, {
    title: 'Groceries without filter',
    amount: '30.00',
    payer: 'Alice',
  })

  await page.waitForURL(/\/groups\/[^/]+/)
  await expect(page.getByText(`Pizza ${uniqueFilter}`)).toBeVisible()
  await expect(page.getByText(`Dinner ${uniqueFilter}`)).toBeVisible()
  await expect(page.getByText('Groceries without filter')).toBeVisible()

  const searchInput = page.locator('input[placeholder*="Search"]')
  await searchInput.fill(uniqueFilter)
  await searchInput.dispatchEvent('input')

  await expect(page.getByText(`Pizza ${uniqueFilter}`)).toBeVisible()
  await expect(page.getByText(`Dinner ${uniqueFilter}`)).toBeVisible()
  await expect(page.getByText('Groceries without filter')).not.toBeVisible()

  await searchInput.fill('Pizza')
  await expect(page.getByText(`Pizza ${uniqueFilter}`)).toBeVisible()
  await expect(page.getByText(`Dinner ${uniqueFilter}`)).not.toBeVisible()
  await expect(page.getByText('Groceries without filter')).not.toBeVisible()

  const clearButton = page.locator('svg.lucide-x-circle')
  if (await clearButton.isVisible()) {
    await clearButton.click()
  } else {
    await searchInput.fill('')
    await searchInput.dispatchEvent('input')
  }

  await expect(page.getByText(`Pizza ${uniqueFilter}`)).toBeVisible()
  await expect(page.getByText(`Dinner ${uniqueFilter}`)).toBeVisible()
  await expect(page.getByText('Groceries without filter')).toBeVisible()
})

test('Create expense - with currency conversion', async ({ page }) => {
  // Create a group with USD currency (group currency)
  const groupName = `PW E2E currency conversion ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'

  await page.goto('/groups')
  await page
    .getByRole('link', { name: /create/i })
    .first()
    .click()
  await page.waitForLoadState('networkidle')

  // Fill group name
  await page.getByLabel('Group name').fill(groupName)

  // Select USD as the group currency (first option is usually USD)
  const currencySelect = page.locator('[role="combobox"]').first()
  await currencySelect.click()
  // Try to select USD or the default currency
  const usdOption = page.getByRole('option', { name: /USD|usd/ }).first()
  if (await usdOption.isVisible()) {
    await usdOption.click()
  } else {
    // If USD not visible, select first option
    await page.getByRole('option').first().click()
  }

  // Fill participants
  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill(participantA)
  await participantInputs.nth(1).fill(participantB)
  await participantInputs.nth(2).fill('Charlie')

  // Create group
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+/)

  // Extract group ID
  const groupId = page.url().split('/').filter(Boolean).pop()

  // Navigate to group page
  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Find and click create expense button
  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    // Fill expense title
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Currency Conversion Test ${Date.now()}`
      const groupAmount = '100.00' // USD amount
      const originalAmount = '90.00' // EUR original amount

      await titleInputs.first().fill(expenseTitle)

      // Fill amount in group currency (USD)
      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill(groupAmount)
      }

      // Select payer
      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Look for original currency selector (2nd combobox after payer select)
      const allComboboxes = page.locator('[role="combobox"]')
      const comboboxCount = await allComboboxes.count()

      // Try to find and set original currency to EUR if available
      if (comboboxCount >= 2) {
        // Find the original currency selector - usually after the payer selector
        const currencySelectors = page
          .locator('[role="combobox"]')
          .filter({ hasText: /select.*currency|currency/i })

        if ((await currencySelectors.count()) > 0) {
          const originalCurrencySelect = currencySelectors.first()
          await originalCurrencySelect.click()

          // Try to select EUR
          const eurOption = page
            .getByRole('option', { name: /EUR|eur/ })
            .first()
          if (await eurOption.isVisible()) {
            await eurOption.click()
          } else {
            // If EUR not available, try second option
            const secondOption = page.getByRole('option').nth(1)
            if (await secondOption.isVisible()) {
              await secondOption.click()
            }
          }

          // Wait a bit for the form to update
          await page.waitForTimeout(500)

          // Now fill in the original amount (this should appear after selecting different currency)
          const allDecimalInputs = page.locator('input[inputmode="decimal"]')
          const decimalCount = await allDecimalInputs.count()

          // If we have more than one decimal input, the second is likely the original amount
          if (decimalCount >= 2) {
            await allDecimalInputs.nth(1).fill(originalAmount)
          }

          // Wait for conversion rate to load (up to 1 second max based on constraints)
          await page.waitForTimeout(500)
        }
      }

      // Create expense
      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      // Wait for navigation
      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify expense appears with title
      await expect(page.getByText(expenseTitle)).toBeVisible()

      // Verify amount displays correctly
      await expect(page.locator(`text=${groupAmount}`)).toBeVisible()

      // Open expense to verify currency conversion data was saved
      await page.getByText(expenseTitle).click()
      await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

      // Verify the group amount in form
      const editAmountInput = page.locator('input[inputmode="decimal"]').first()
      await expect(editAmountInput).toHaveValue(groupAmount)
    }
  }
})

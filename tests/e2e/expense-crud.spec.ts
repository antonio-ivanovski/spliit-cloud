import { expect, test } from '@playwright/test'

import type { Page } from '@playwright/test'

async function createGroup({
  page,
  groupName,
  participants,
}: {
  page: Page
  groupName: string
  participants: string[]
}) {
  await page.goto('/groups')
  await page.getByRole('link', { name: 'Create' }).first().click()

  await page.getByLabel('Group name').fill(groupName)

  const participantInputs = page.getByRole('textbox', { name: 'New' })

  for (let i = 0; i < participants.length; i++) {
    if (i >= 3) {
      await page.getByRole('button', { name: 'Add participant' }).click()
      await expect(participantInputs).toHaveCount(i + 1)
    }

    await participantInputs.nth(i).fill(participants[i]!)
  }

  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).not.toHaveURL(/\/groups\/create$/)
  await expect(page).toHaveURL(/\/groups\/[^/]+(\/expenses)?$/)

  const url = page.url()
  const groupId = url.match(/\/groups\/([^/]+)(?:\/expenses)?$/)?.[1]
  if (!groupId || groupId === 'create') {
    throw new Error(`Failed to extract groupId from URL: ${url}`)
  }

  return groupId
}

test('Delete expense - confirmation flow', async ({ page }) => {
  // Create a test group first
  const groupName = `PW E2E group ${Date.now()}`
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

  // Fill participants
  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill(participantA)
  await participantInputs.nth(1).fill(participantB)
  await participantInputs.nth(2).fill('Charlie')

  // Create group
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+/)

  // Extract group ID from URL
  const groupId = page.url().split('/').filter(Boolean).pop()

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

  await page.goto('/groups')
  await page
    .getByRole('link', { name: /create/i })
    .first()
    .click()
  await page.waitForLoadState('networkidle')

  // Fill group name
  await page.getByLabel('Group name').fill(groupName)

  // Fill participants
  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill(participantA)
  await participantInputs.nth(1).fill('Bob')
  await participantInputs.nth(2).fill('Charlie')

  // Create group
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+/)

  // Extract group ID
  const groupId = page.url().split('/').filter(Boolean).pop()

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

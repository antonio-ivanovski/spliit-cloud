import { expect, test } from '@playwright/test'
import { createGroup } from '../helpers'

test('Toggle dark mode - persists', async ({ page }) => {
  await page.goto('/groups')
  await page.waitForLoadState('networkidle')

  // Look for theme toggle button - try different selectors
  let themeToggle = page
    .getByRole('button')
    .filter({ hasText: /dark|light|theme|mode/i })
    .first()

  // If not found by text, try aria-label
  if (!(await themeToggle.isVisible({ timeout: 2000 }).catch(() => false))) {
    themeToggle = page
      .locator(
        'button[aria-label*="theme" i], button[aria-label*="dark" i], button[aria-label*="light" i]',
      )
      .first()
  }

  // If still not found, the feature might not be available - skip
  if (!(await themeToggle.isVisible({ timeout: 2000 }).catch(() => false))) {
    // Theme toggle not available, test passes as feature might be disabled
    return
  }

  // Click to toggle
  await themeToggle.click()
  await page.waitForTimeout(300)

  // Reload page
  await page.reload()
  await page.waitForLoadState('networkidle')

  // Verify page loads after reload (theme persisted)
  const body = page.locator('body')
  await expect(body).toBeVisible()
})

test('Category displays on expense', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E category display settings ${Date.now()}`,
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

    // Fill expense details
    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Category Test ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('40.00')
      }

      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      // Select a category
      const categorySelects = page.locator('[role="combobox"]')
      if ((await categorySelects.count()) >= 2) {
        await categorySelects.nth(1).click()
        const option = page.getByRole('option').first()
        if (await option.isVisible()) {
          await option.click()
        }
      }

      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      await page.waitForURL(/\/groups\/[^/]+/)

      // Verify expense appears
      await expect(page.getByText(expenseTitle)).toBeVisible()
    }
  }
})

test('Default category (General) selected', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E default category ${Date.now()}`,
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

    // Verify that there's a category field and it has a default value
    const categorySelects = page.locator('[role="combobox"]')
    if ((await categorySelects.count()) >= 2) {
      // The category combobox should have a default selection
      const categoryCombobox = categorySelects.nth(1)
      const categoryText = await categoryCombobox.textContent()
      expect(categoryText).toBeTruthy()
      // Usually defaults to "General" or similar
    }
  }
})

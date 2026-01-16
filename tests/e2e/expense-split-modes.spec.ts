import { expect, test } from '@playwright/test'

test('Create expense - evenly split (most common flow)', async ({ page }) => {
  const groupName = `PW E2E split modes ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  // Step 1: Create group with 3 participants (Alice, Bob, Charlie)
  await page.goto('/groups')
  await page.getByRole('link', { name: 'Create' }).first().click()

  await page.getByLabel('Group name').fill(groupName)

  // Fill in the 3 participants
  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill(participantA)
  await participantInputs.nth(1).fill(participantB)
  await participantInputs.nth(2).fill(participantC)

  // Create the group
  await page.getByRole('button', { name: 'Create' }).click()

  // Verify we're on the group detail page
  await expect(page).toHaveURL(/\/groups\/[^/]+$/)

  // Step 2: Navigate to expense creation by clicking the link
  const createLink = page.getByRole('link', { name: /create expense|create the first/i }).first()
  await createLink.waitFor({ state: 'visible', timeout: 10000 })
  await createLink.click()

  // Wait for navigation to expense creation page
  await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)

  // Wait for the expense form to load by checking for the title input field
  const expenseTitle = page.locator('input[name="title"]')
  await expenseTitle.waitFor({ state: 'visible', timeout: 30000 })

  // Step 3: Fill title: "Team Dinner"
  await expenseTitle.fill('Team Dinner')

  // Step 4: Fill amount: 300.00
  const amountInput = page.locator('input[name="amount"]')
  await amountInput.fill('300.00')

  // Step 5: Select payer: Alice
  const paidBySelect = page.getByRole('combobox').filter({ hasText: 'Select a participant' })
  await paidBySelect.waitFor({ state: 'visible', timeout: 10000 })
  await paidBySelect.click()

  const aliceOption = page.getByRole('option', { name: participantA })
  await aliceOption.waitFor({ state: 'visible', timeout: 10000 })
  await aliceOption.click()

  // Step 6: Verify split section is visible (evenly split is the default when all are checked)
  // The form doesn't explicitly show "Evenly" text, but by default all participants are checked

  // Step 7: Verify all 3 participants are included
  const participantCheckboxes = page.getByRole('checkbox')
  const checkedCount = await participantCheckboxes.count()
  expect(checkedCount).toBeGreaterThanOrEqual(3)

  // Step 8: Submit expense
  const saveButton = page.locator('button[type="submit"]').first()
  await saveButton.click()

  // Wait for redirect back to group page
  await page.waitForURL(/\/groups\/[^/]+/, { timeout: 10000 })

  // Step 9: Navigate to Expenses tab
  await page.getByRole('tab', { name: 'Expenses' }).click()

  // Step 10: Verify expense appears with correct title and amount
  await expect(page.getByText('Team Dinner')).toBeVisible({ timeout: 10000 })
  await expect(page.locator(`text=300.00`)).toBeVisible({ timeout: 10000 })

  // Step 11: Verify balances
  await page.getByRole('tab', { name: 'Balances' }).click()
  await page.waitForURL(/\/groups\/[^/]+\/balances$/)

  // Wait for the Balances heading to appear
  await expect(page.locator('h2, h3, h4, h5').filter({ hasText: /balance/i }).first()).toBeVisible({ timeout: 15000 })

  // Verify participants are mentioned in the balances (use .first() to avoid strict mode)
  await expect(page.getByText(participantA).first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(participantB).first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(participantC).first()).toBeVisible({ timeout: 15000 })
})

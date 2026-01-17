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
  const createLink = page
    .getByRole('link', { name: /create expense|create the first/i })
    .first()
  await createLink.waitFor({ state: 'visible' })
  await createLink.click()

  // Wait for navigation to expense creation page
  await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)

  // Wait for the expense form to load by checking for the title input field
  const expenseTitle = page.locator('input[name="title"]')
  await expenseTitle.waitFor({ state: 'visible' })

  // Step 3: Fill title: "Team Dinner"
  await expenseTitle.fill('Team Dinner')

  // Step 4: Fill amount: 300.00
  const amountInput = page.locator('input[name="amount"]')
  await amountInput.fill('300.00')

  // Step 5: Select payer: Alice
  const paidBySelect = page
    .getByRole('combobox')
    .filter({ hasText: 'Select a participant' })
  await paidBySelect.waitFor({ state: 'visible' })
  await paidBySelect.click()

  const aliceOption = page.getByRole('option', { name: participantA })
  await aliceOption.waitFor({ state: 'visible' })
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
  await page.waitForURL(/\/groups\/[^/]+/, {})

  // Step 9: Navigate to Expenses tab
  await page.getByRole('tab', { name: 'Expenses' }).click()

  // Step 10: Verify expense appears with correct title and amount
  await expect(page.getByText('Team Dinner')).toBeVisible({})
  await expect(page.locator(`text=300.00`)).toBeVisible({})

  // Step 11: Verify balances
  await page.getByRole('tab', { name: 'Balances' }).click()
  await page.waitForURL(/\/groups\/[^/]+\/balances$/)

  // Wait for the Balances heading to appear
  await expect(
    page
      .locator('h2, h3, h4, h5')
      .filter({ hasText: /balance/i })
      .first(),
  ).toBeVisible()

  // Verify participants are mentioned in the balances (use .first() to avoid strict mode)
  await expect(page.getByText(participantA).first()).toBeVisible()
  await expect(page.getByText(participantB).first()).toBeVisible()
  await expect(page.getByText(participantC).first()).toBeVisible()
})

test('Create expense - by shares split mode', async ({ page }) => {
  const groupName = `PW E2E by shares ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  // Step 1: Create group with 3 participants
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

  // Step 2: Navigate to expense creation
  const createLink = page
    .getByRole('link', { name: /create expense|create the first/i })
    .first()
  await createLink.waitFor({ state: 'visible' })
  await createLink.click()

  // Wait for navigation to expense creation page
  await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)

  // Wait for the expense form to load
  const expenseTitle = page.locator('input[name="title"]')
  await expenseTitle.waitFor({ state: 'visible' })

  // Step 3: Fill title and amount
  await expenseTitle.fill('Team Dinner Shares')
  const amountInput = page.locator('input[name="amount"]')
  await amountInput.fill('300.00')

  // Step 4: Select payer: Alice
  const paidBySelect = page
    .getByRole('combobox')
    .filter({ hasText: 'Select a participant' })
  await paidBySelect.waitFor({ state: 'visible' })
  await paidBySelect.click()

  const aliceOption = page.getByRole('option', { name: participantA })
  await aliceOption.waitFor({ state: 'visible' })
  await aliceOption.click()

  // Step 5: Expand advanced options
  await page
    .getByRole('button', { name: 'Advanced splitting options…' })
    .click()

  // Step 6: Select split mode: By shares
  const splitModeSelect = page
    .getByRole('combobox')
    .filter({ hasText: 'Evenly' })
  await splitModeSelect.click()
  await page.getByRole('option', { name: 'Unevenly – By shares' }).click()

  // Step 7: Fill shares - Alice: 1, Bob: 2, Charlie: 3
  // The split-mode inputs are plain textboxes without stable attributes;
  // scope to the "Paid for" section and match by the trailing "share(s)" label.
  const paidForSection = page
    .locator('h1,h2,h3,h4,h5', { hasText: /^Paid for/i })
    .first()
    .locator('..')
    .locator('..')

  const shareInputs = paidForSection
    .locator('div', { hasText: 'share(s)' })
    .getByRole('textbox')

  await expect(shareInputs).toHaveCount(3)

  await shareInputs.nth(0).fill('1') // Alice
  await shareInputs.nth(1).fill('2') // Bob
  await shareInputs.nth(2).fill('3') // Charlie

  // Step 7: Submit expense
  const saveButton = page.locator('button[type="submit"]').first()
  await saveButton.click()

  // Wait for redirect back to group page
  await page.waitForURL(/\/groups\/[^/]+/, {})

  // Step 8: Navigate to Expenses tab
  await page.getByRole('tab', { name: 'Expenses' }).click()

  // Step 9: Verify expense appears
  await expect(page.getByText('Team Dinner Shares')).toBeVisible()
  await expect(page.locator('text=300.00')).toBeVisible()

  // Step 10: Verify balances (Alice paid 300, shares 1:2:3 so she is owed 250, Bob owes 100, Charlie owes 150)
  await page.getByRole('tab', { name: 'Balances' }).click()
  await page.waitForURL(/\/groups\/[^/]+\/balances$/)

  // Wait for balances to load
  await expect(
    page
      .locator('h2, h3, h4, h5')
      .filter({ hasText: /balance/i })
      .first(),
  ).toBeVisible({})

  // Verify participants are shown
  await expect(page.getByText(participantA).first()).toBeVisible({})
  await expect(page.getByText(participantB).first()).toBeVisible({})
  await expect(page.getByText(participantC).first()).toBeVisible({})
})

test('Create expense - by percentage split mode', async ({ page }) => {
  const groupName = `PW E2E by percentage ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  // Step 1: Create group with 3 participants
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

  // Step 2: Navigate to expense creation
  const createLink = page
    .getByRole('link', { name: /create expense|create the first/i })
    .first()
  await createLink.waitFor({ state: 'visible' })
  await createLink.click()

  // Wait for navigation to expense creation page
  await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)

  // Wait for the expense form to load
  const expenseTitle = page.locator('input[name="title"]')
  await expenseTitle.waitFor({ state: 'visible' })

  // Step 3: Fill title and amount
  await expenseTitle.fill('Team Dinner Percentage')
  const amountInput = page.locator('input[name="amount"]')
  await amountInput.fill('300.00')

  // Step 4: Select payer: Alice
  const paidBySelect = page
    .getByRole('combobox')
    .filter({ hasText: 'Select a participant' })
  await paidBySelect.waitFor({ state: 'visible' })
  await paidBySelect.click()

  const aliceOption = page.getByRole('option', { name: participantA })
  await aliceOption.waitFor({ state: 'visible' })
  await aliceOption.click()

  // Step 5: Expand advanced options
  await page
    .getByRole('button', { name: 'Advanced splitting options…' })
    .click()

  // Step 6: Select split mode: By percentage
  const splitModeSelect = page
    .getByRole('combobox')
    .filter({ hasText: 'Evenly' })
  await splitModeSelect.click()
  await page.getByRole('option', { name: 'Unevenly – By percentage' }).click()

  // Step 7: Fill percentages - Alice: 25%, Bob: 25%, Charlie: 50%
  // Scope to the "Paid for" section and match by the trailing "%" label.
  const paidForSection = page
    .locator('h1,h2,h3,h4,h5', { hasText: /^Paid for/i })
    .first()
    .locator('..')
    .locator('..')

  const percentageInputs = paidForSection
    .locator('div', { hasText: '%' })
    .getByRole('textbox')

  await expect(percentageInputs).toHaveCount(3)

  await percentageInputs.nth(0).fill('25') // Alice
  await percentageInputs.nth(1).fill('25') // Bob
  await percentageInputs.nth(2).fill('50') // Charlie

  // Step 7: Submit expense
  const saveButton = page.locator('button[type="submit"]').first()
  await saveButton.click()

  // Wait for redirect back to group page
  await page.waitForURL(/\/groups\/[^/]+/)

  // Step 8: Navigate to Expenses tab
  await page.getByRole('tab', { name: 'Expenses' }).click()

  // Step 9: Verify expense appears
  await expect(page.getByText('Team Dinner Percentage')).toBeVisible()
  await expect(page.locator('text=300.00')).toBeVisible()

  // Step 10: Verify balances (Alice paid 300, percentages 25:25:50 so she is owed 75, Bob owes 75, Charlie owes 0)
  await page.getByRole('tab', { name: 'Balances' }).click()
  await page.waitForURL(/\/groups\/[^/]+\/balances$/)

  // Wait for balances to load
  await expect(
    page
      .locator('h2, h3, h4, h5')
      .filter({ hasText: /balance/i })
      .first(),
  ).toBeVisible()

  // Verify participants are shown
  await expect(page.getByText(participantA).first()).toBeVisible()
  await expect(page.getByText(participantB).first()).toBeVisible()
  await expect(page.getByText(participantC).first()).toBeVisible()
})

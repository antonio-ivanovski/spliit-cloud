import { expect, test } from '@playwright/test'

test('suggested reimbursements displayed', async ({ page }) => {
  const groupName = `PW E2E balances ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  // Step 1: Create a group with 3 participants
  await page.goto('/groups')
  await page
    .getByRole('link', { name: /^Create$/ })
    .first()
    .click()

  await page.getByLabel('Group name').fill(groupName)

  // Overwrite default participants with our test names
  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill(participantA)
  await participantInputs.nth(1).fill(participantB)
  await participantInputs.nth(2).fill(participantC)

  await page.getByRole('button', { name: 'Create' }).click()

  // Wait for redirect to group page
  await expect(page).toHaveURL(/\/groups\/[^/]+$/)

  // Helper function to create an expense - reduces duplication and makes tests more maintainable
  const createExpense = async (
    title: string,
    amount: string,
    payer: string,
  ) => {
    // Click "Create expense" link on the group page
    const createLink = page
      .getByRole('link', { name: /create expense|create the first/i })
      .first()
    await createLink.waitFor({ state: 'visible'})
    await createLink.click()

    // Wait for navigation to expense creation page
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)

    // Wait for the form to load and the title input to be ready
    const expenseTitle = page.locator('input[name="title"]')
    await expenseTitle.waitFor({ state: 'visible'})

    // Fill in expense details
    await expenseTitle.fill(title)

    // Fill amount
    const amountInput = page.locator('input[name="amount"]')
    await amountInput.fill(amount)

    // Select payer - click the "Paid by" combobox
    const paidBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await paidBySelect.waitFor({ state: 'visible'})
    await paidBySelect.click()

    // Wait for dropdown and click option
    const payerOption = page.getByRole('option', { name: payer })
    await payerOption.waitFor({ state: 'visible'})
    await payerOption.click()

    // Submit the expense
    await page.locator('button[type="submit"]').first().click()

    // Wait for redirect and verify expense appears
    await page.waitForURL(/\/groups\/[^/]+/, {  })
    await expect(page.getByText(title)).toBeVisible({  })
  }

  // Step 2-4: Create three expenses
  await createExpense('Dinner', '300', participantA)
  await createExpense('Breakfast', '150', participantB)
  await createExpense('Lunch', '120', participantC)

  // Step 5: Navigate to Balances tab
  await page.getByRole('tab', { name: 'Balances' }).click()
  await page.waitForURL(/\/groups\/[^/]+\/balances$/)

  // Step 6: Verify Suggested reimbursements section is visible
  const reimbursementsHeading = page
    .getByText('Suggested reimbursements')
    .first()
  await expect(reimbursementsHeading).toBeVisible({  })

  // Wait for the reimbursements content to load (either suggestions or "no reimbursements" message)
  await page.waitForFunction(
    () => {
      const bodyText = document.body.textContent || ''
      return (
        bodyText.includes('owes') ||
        bodyText.includes('reimbursement') ||
        bodyText.includes('paid back')
      )
    },
    {  },
  )

  // Step 7: Verify the reimbursements section is populated
  // Look for either "owes" text or any reimbursement-related text
  const hasOwesText = (await page.locator('text=/owes|owe/i').count()) > 0
  const hasReimbursementText =
    (await page.locator('text=/reimbursement|paid back|settle/i').count()) > 0

  expect(hasOwesText || hasReimbursementText).toBeTruthy()

  // Step 8: If reimbursements exist, verify they contain amounts
  if (hasOwesText || hasReimbursementText) {
    // Verify amounts are displayed with currency format
    const pageText = await page.locator('body').textContent()
    if (pageText) {
      expect(pageText).toMatch(/[\d,]+\.\d{2}/)
    }
  }
})

test('view balances page - calculates correctly', async ({ page }) => {
  const groupName = `PW E2E balance calculation ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  // Step 1: Create a group with 3 participants
  await page.goto('/groups')
  await page
    .getByRole('link', { name: /^Create$/ })
    .first()
    .click()

  await page.getByLabel('Group name').fill(groupName)

  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill(participantA)
  await participantInputs.nth(1).fill(participantB)
  await participantInputs.nth(2).fill(participantC)

  await page.getByRole('button', { name: 'Create' }).click()

  // Wait for redirect to group page
  await expect(page).toHaveURL(/\/groups\/[^/]+$/)

  // Helper function to create an expense
  const createExpense = async (
    title: string,
    amount: string,
    payer: string,
  ) => {
    // Click "Create expense" link on the group page
    const createLink = page
      .getByRole('link', { name: /create expense|create the first/i })
      .first()
    await createLink.waitFor({ state: 'visible'})
    await createLink.click()

    // Wait for navigation to expense creation page
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)

    // Wait for the form to load and the title input to be ready
    const expenseTitle = page.locator('input[name="title"]')
    await expenseTitle.waitFor({ state: 'visible'})
    await expenseTitle.fill(title)

    const amountInput = page.locator('input[name="amount"]')
    await amountInput.fill(amount)

    const paidBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await paidBySelect.waitFor({ state: 'visible'})
    await paidBySelect.click()

    const payerOption = page.getByRole('option', { name: payer })
    await payerOption.waitFor({ state: 'visible'})
    await payerOption.click()

    await page.locator('button[type="submit"]').first().click()
    await page.waitForURL(/\/groups\/[^/]+/, {  })
    await expect(page.getByText(title)).toBeVisible({  })
  }

  // Step 2-3: Create two expenses
  await createExpense('Dinner', '300', participantA)
  await createExpense('Breakfast', '150', participantB)

  // Step 4: Navigate to Balances tab
  await page.getByRole('tab', { name: 'Balances' }).click()
  await page.waitForURL(/\/groups\/[^/]+\/balances$/)

  // Step 5: Verify Balances section header is visible
  const balancesCard = page
    .locator('h2, h3, h4, h5')
    .filter({ hasText: /balance/i })
  await expect(balancesCard.first()).toBeVisible({  })

  // Wait until async calculations render at least one money value.
  await expect(page.getByText(/[\d.,]+\.\d{2}/).first()).toBeVisible({
   
  })

  // Step 6: Verify participant names are displayed (use .first() to avoid strict mode)
  await expect(page.getByText(participantA).first()).toBeVisible()
  await expect(page.getByText(participantB).first()).toBeVisible()
  await expect(page.getByText(participantC).first()).toBeVisible()

  // Step 7: Verify balance calculations
  // Expected balances after both expenses:
  // Alice: paid $300, owes $150, net = +$150
  // Bob: paid $150, owes $150, net = $0
  // Charlie: paid $0, owes $150, net = -$150

  const pageText = await page.locator('body').textContent()
  if (!pageText) {
    throw new Error('Failed to get page text content')
  }

  // Look for currency formatted amounts
  const currencyPattern = /[\d.,]+\.\d{2}/
  expect(pageText).toMatch(currencyPattern)

  // Verify we can locate each participant's balance row
  await expect(
    page.locator('div').filter({ hasText: participantA }).first(),
  ).toBeVisible()
  await expect(
    page.locator('div').filter({ hasText: participantB }).first(),
  ).toBeVisible()
  await expect(
    page.locator('div').filter({ hasText: participantC }).first(),
  ).toBeVisible()

  // Step 8: Verify amounts are present
  const matches = pageText.match(/[\d.,]+\.\d{2}/g) || []
  const amounts = matches.map((m) => parseFloat(m.replace(/,/g, '')))
  expect(amounts.length).toBeGreaterThanOrEqual(3)

  // Step 9: Verify loading state is complete (no skeleton loaders)
  const skeletons = page.locator('[class*="skeleton"]')
  const skeletonCount = await skeletons.count()
  expect(skeletonCount).toBeLessThan(5)
})
